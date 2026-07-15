/* ============================================================
   ColorSLCT · license.js
   Client-side licensing for a static product.

   Two key types are accepted on the unlock page:

   1. Signed ColorSLCT keys — "CSLCT2.<payload>.<signature>"
      ECDSA P-256 / SHA-256, minted by the owner with
      tools/keygen.html (or tools/keygen.mjs). Verified locally
      against CSLCT_CONFIG.LICENSE_PUBLIC_KEY. This is also the
      gifting/bypass path: gift keys are just signed keys with
      gift:true (and an optional expiry).

   2. Gumroad license keys — verified against Gumroad's license
      API when GUMROAD_PRODUCT_ID is configured. If the network
      is unreachable the activation is stored as PROVISIONAL and
      re-verified automatically on later visits (grace window in
      config). An explicit "invalid / refunded" answer from
      Gumroad rejects or revokes the key. This is stated to the
      user — nothing is silently faked.

   Honest scope: this is client-side licensing. It deters casual
   sharing and enables instant self-serve activation; it is not
   DRM. README documents this plainly.
   ============================================================ */
(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.License = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY_PREFIX = 'CSLCT2';
  var STORE_KEY = 'cslct.license';
  var subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;

  /* ── base64url helpers (browser + Node) ─────────────────── */
  function bytesToB64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlToBytes(s) {
    var b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin;
    if (typeof atob === 'function') {
      bin = atob(b64);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  function strToBytes(s) { return new TextEncoder().encode(s); }
  function bytesToStr(b) { return new TextDecoder().decode(b); }

  /* ── Safe storage (never throws; license storage is an
        essential function, exempt from the optional-storage
        consent gate) ─────────────────────────────────────── */
  function storeGet() {
    try {
      var raw = (typeof localStorage !== 'undefined') && localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function storeSet(obj) {
    try {
      if (typeof localStorage === 'undefined') return false;
      if (obj === null) localStorage.removeItem(STORE_KEY);
      else localStorage.setItem(STORE_KEY, JSON.stringify(obj));
      return true;
    } catch (e) { return false; }
  }

  /* ── ECDSA P-256 signed keys ────────────────────────────── */

  function importPublicKey(spkiB64) {
    return subtle.importKey(
      'spki', b64urlToBytes(spkiB64).buffer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false, ['verify']
    );
  }

  /**
   * Verify a "CSLCT2.<payload>.<sig>" key against the configured
   * public key. Resolves to { valid, reason?, payload? }.
   * Payload: { p:'pro'|'studio', id, iat, exp?, gift?, n? }
   */
  function verifySignedKey(keyString, publicKeyB64) {
    keyString = String(keyString || '').trim();
    if (!subtle) {
      return Promise.resolve({ valid: false, reason: 'crypto-unavailable' });
    }
    if (!publicKeyB64) {
      return Promise.resolve({ valid: false, reason: 'not-configured' });
    }
    var parts = keyString.split('.');
    if (parts.length !== 3 || parts[0] !== KEY_PREFIX) {
      return Promise.resolve({ valid: false, reason: 'format' });
    }
    var payloadBytes, sigBytes, payload;
    try {
      payloadBytes = b64urlToBytes(parts[1]);
      sigBytes = b64urlToBytes(parts[2]);
      payload = JSON.parse(bytesToStr(payloadBytes));
    } catch (e) {
      return Promise.resolve({ valid: false, reason: 'format' });
    }
    if (!payload || (payload.p !== 'pro' && payload.p !== 'studio')) {
      return Promise.resolve({ valid: false, reason: 'format' });
    }
    return importPublicKey(publicKeyB64).then(function (pub) {
      return subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        pub,
        sigBytes.buffer,
        strToBytes(parts[0] + '.' + parts[1]).buffer
      );
    }).then(function (ok) {
      if (!ok) return { valid: false, reason: 'signature' };
      if (payload.exp && Date.now() > payload.exp) {
        return { valid: false, reason: 'expired', payload: payload };
      }
      return { valid: true, payload: payload };
    }).catch(function () {
      return { valid: false, reason: 'signature' };
    });
  }

  /* Signing — used only by the owner's keygen tools (needs the
     private key, which never ships with the product).          */
  function generateKeyPair() {
    return subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
      .then(function (kp) {
        return Promise.all([
          subtle.exportKey('spki', kp.publicKey),
          subtle.exportKey('pkcs8', kp.privateKey)
        ]).then(function (exported) {
          return {
            publicKey: bytesToB64url(new Uint8Array(exported[0])),
            privateKey: bytesToB64url(new Uint8Array(exported[1]))
          };
        });
      });
  }

  function signKey(payload, privateKeyB64) {
    var body = {
      p: payload.p === 'studio' ? 'studio' : 'pro',
      id: payload.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
      iat: Date.now()
    };
    if (payload.n) body.n = String(payload.n).slice(0, 80);
    if (payload.gift) body.gift = true;
    if (payload.exp) body.exp = payload.exp;
    var payloadB64 = bytesToB64url(strToBytes(JSON.stringify(body)));
    var signingInput = KEY_PREFIX + '.' + payloadB64;
    return subtle.importKey(
      'pkcs8', b64urlToBytes(privateKeyB64).buffer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false, ['sign']
    ).then(function (priv) {
      return subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, strToBytes(signingInput).buffer);
    }).then(function (sig) {
      return signingInput + '.' + bytesToB64url(new Uint8Array(sig));
    });
  }

  /* ── Gumroad keys ───────────────────────────────────────── */

  var GUMROAD_RE = /^[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}$/i;
  function looksLikeGumroadKey(s) { return GUMROAD_RE.test(String(s || '').trim()); }

  /**
   * Resolves to { status: 'valid'|'invalid'|'network', detail? }.
   * 'network' = could not reach Gumroad (offline/CORS/blocked);
   * caller decides on provisional activation.
   */
  function verifyGumroadKey(key, productId, increment) {
    if (typeof fetch !== 'function') return Promise.resolve({ status: 'network' });
    var body = 'product_id=' + encodeURIComponent(productId) +
      '&license_key=' + encodeURIComponent(String(key).trim()) +
      '&increment_uses_count=' + (increment ? 'true' : 'false');
    return fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    }).then(function (res) {
      if (res.status === 404) return { status: 'invalid', detail: 'That key doesn’t match this product.' };
      if (!res.ok) {
        // 4xx = Gumroad answered "no"; 5xx = treat as unreachable
        return res.status >= 500 ? { status: 'network' } : { status: 'invalid', detail: 'Gumroad rejected the key (HTTP ' + res.status + ').' };
      }
      return res.json().then(function (json) {
        if (!json || json.success !== true) return { status: 'invalid', detail: 'Gumroad could not verify that key.' };
        var p = json.purchase || {};
        if (p.refunded || p.chargebacked || p.disputed) {
          return { status: 'invalid', detail: 'That purchase was refunded or disputed.' };
        }
        return { status: 'valid', detail: p.email || '' };
      }).catch(function () { return { status: 'network' }; });
    }).catch(function () { return { status: 'network' }; });
  }

  /* ── Activation state ───────────────────────────────────── */

  function config() {
    var root2 = typeof self !== 'undefined' ? self : {};
    return root2.CSLCT_CONFIG || {};
  }

  function graceMs() {
    var days = Number(config().GUMROAD_OFFLINE_GRACE_DAYS) || 14;
    return days * 24 * 60 * 60 * 1000;
  }

  /** Current entitlement snapshot (synchronous, from storage). */
  function getState() {
    var rec = storeGet();
    if (!rec || !rec.plan) {
      return { plan: 'free', pro: false, source: null, provisional: false };
    }
    var provisional = rec.source === 'gumroad' && rec.verified !== true;
    var expiredGrace = provisional && rec.activatedAt && (Date.now() - rec.activatedAt > graceMs());
    return {
      plan: rec.plan,
      pro: rec.plan === 'pro' || rec.plan === 'studio',
      source: rec.source,
      gift: !!rec.gift,
      name: rec.name || '',
      provisional: provisional,
      graceExpired: !!expiredGrace,
      activatedAt: rec.activatedAt || null,
      keyTail: rec.keyTail || ''
    };
  }

  function activate(record) {
    var rec = {
      plan: record.plan,
      source: record.source,
      gift: !!record.gift,
      name: record.name || '',
      verified: record.verified !== false,
      activatedAt: Date.now(),
      keyTail: record.key ? String(record.key).slice(-8) : '',
      key: record.source === 'gumroad' ? String(record.key) : undefined
    };
    return storeSet(rec);
  }

  function deactivate() { return storeSet(null); }

  /**
   * Redeem any pasted key. Resolves to
   * { ok, plan?, message, provisional? }.
   * Messages are written for humans, not logs.
   */
  function redeem(keyString) {
    var key = String(keyString || '').trim();
    var cfg = config();
    if (!key) {
      return Promise.resolve({ ok: false, message: 'Paste your key first — it’s in your purchase email or receipt.' });
    }
    if (key.indexOf(KEY_PREFIX + '.') === 0) {
      if (!subtle) {
        return Promise.resolve({ ok: false, message: 'This browser can’t verify keys on an insecure (http://) address. Open the site over https, or open the files directly from your computer.' });
      }
      if (!cfg.LICENSE_PUBLIC_KEY) {
        return Promise.resolve({ ok: false, message: 'Key activation isn’t switched on for this copy yet. If you just bought, contact the seller — they can finish setup in one step.' });
      }
      return verifySignedKey(key, cfg.LICENSE_PUBLIC_KEY).then(function (res) {
        if (!res.valid) {
          var msgs = {
            format: 'That doesn’t look like a complete key. Copy the whole line, including both dots.',
            signature: 'That key isn’t valid for this product. Check for missing characters, or contact support.',
            expired: 'That key has expired. Ask the person who sent it for a fresh one.',
            'crypto-unavailable': 'This browser can’t verify keys here. Try over https.',
            'not-configured': 'Key activation isn’t configured on this copy yet.'
          };
          return { ok: false, message: msgs[res.reason] || 'That key could not be verified.' };
        }
        activate({ plan: res.payload.p, source: 'signed', gift: !!res.payload.gift, name: res.payload.n || '', key: key });
        return { ok: true, plan: res.payload.p, gift: !!res.payload.gift, message: res.payload.gift ? 'Gift accepted — everything is unlocked. Enjoy!' : 'You’re in. Every Pro feature is now unlocked on this device.' };
      });
    }
    if (looksLikeGumroadKey(key)) {
      if (!cfg.GUMROAD_PRODUCT_ID) {
        return Promise.resolve({ ok: false, message: 'Gumroad activation isn’t switched on for this copy yet. Contact the seller with your receipt and they’ll sort you out.' });
      }
      return verifyGumroadKey(key, cfg.GUMROAD_PRODUCT_ID, true).then(function (res) {
        if (res.status === 'valid') {
          activate({ plan: 'pro', source: 'gumroad', key: key, verified: true, name: res.detail || '' });
          return { ok: true, plan: 'pro', message: 'Verified with Gumroad — you’re all set. Every Pro feature is unlocked.' };
        }
        if (res.status === 'invalid') {
          return { ok: false, message: res.detail || 'Gumroad says that key isn’t valid for this product.' };
        }
        // network: provisional, stated honestly
        activate({ plan: 'pro', source: 'gumroad', key: key, verified: false });
        return {
          ok: true, plan: 'pro', provisional: true,
          message: 'We couldn’t reach Gumroad to double-check the key, so you’re unlocked provisionally. We’ll re-check automatically next time you’re online.'
        };
      });
    }
    return Promise.resolve({ ok: false, message: 'That key format isn’t recognised. Keys look like "CSLCT2.xxxx.xxxx" or "XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX".' });
  }

  /** Re-verify a provisional Gumroad activation in the background. */
  function reverifyIfNeeded() {
    var rec = storeGet();
    if (!rec || rec.source !== 'gumroad' || rec.verified === true || !rec.key) {
      return Promise.resolve({ changed: false });
    }
    var cfg = config();
    if (!cfg.GUMROAD_PRODUCT_ID) return Promise.resolve({ changed: false });
    return verifyGumroadKey(rec.key, cfg.GUMROAD_PRODUCT_ID, false).then(function (res) {
      if (res.status === 'valid') {
        rec.verified = true;
        storeSet(rec);
        return { changed: true, verified: true };
      }
      if (res.status === 'invalid') {
        storeSet(null);
        return { changed: true, revoked: true, detail: res.detail };
      }
      return { changed: false }; // still offline — grace window applies
    });
  }

  /** Pull a #key=… from the URL (gift deep links). Returns key or null. */
  function keyFromLocation(loc) {
    try {
      var hash = (loc || (typeof location !== 'undefined' ? location : null) || {}).hash || '';
      var m = hash.match(/[#&]key=([^&]+)/);
      if (m) return decodeURIComponent(m[1]);
      var search = (loc || (typeof location !== 'undefined' ? location : null) || {}).search || '';
      var q = search.match(/[?&]key=([^&]+)/);
      return q ? decodeURIComponent(q[1]) : null;
    } catch (e) { return null; }
  }

  /* ── Feature gates ──────────────────────────────────────── */

  var PRO_FEATURES = ['ramps', 'image', 'cvd', 'export-pro', 'png', 'svg', 'library-unlimited'];

  function can(feature) {
    var st = getState();
    if (st.graceExpired) return false; // provisional lapsed → free until re-verified
    if (st.pro) return true;
    return PRO_FEATURES.indexOf(feature) === -1;
  }

  function libraryLimit() {
    var st = getState();
    if (st.pro && !st.graceExpired) return Infinity;
    return Number(config().FREE_LIBRARY_LIMIT) || 3;
  }

  return {
    KEY_PREFIX: KEY_PREFIX,
    verifySignedKey: verifySignedKey,
    generateKeyPair: generateKeyPair,
    signKey: signKey,
    looksLikeGumroadKey: looksLikeGumroadKey,
    verifyGumroadKey: verifyGumroadKey,
    getState: getState,
    activate: activate,
    deactivate: deactivate,
    redeem: redeem,
    reverifyIfNeeded: reverifyIfNeeded,
    keyFromLocation: keyFromLocation,
    can: can,
    libraryLimit: libraryLimit
  };
});
