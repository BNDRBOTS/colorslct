/* ColorSLCT License Manager — Gumroad license verification, gift codes (SHA-256),
   and local Pro state. No server required; state lives in this browser only. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  if (root) { root.CslctLicense = api; }
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  var STORAGE_KEY = "cslct-license";

  /* ---------- Pure-JS SHA-256 (fallback for non-secure contexts) ---------- */
  /* Based on the public-domain implementation by Geraint Luff. */
  function sha256Sync(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }
    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var i, j;
    var result = "";
    var words = [];
    var asciiBitLength = ascii.length * 8;
    var hash = sha256Sync.h = sha256Sync.h || [];
    var k = sha256Sync.k = sha256Sync.k || [];
    var primeCounter = k.length;
    var isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) { isComposite[i] = candidate; }
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    ascii += "\x80";
    while (ascii.length % 64 - 56) { ascii += "\x00"; }
    for (i = 0; i < ascii.length; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) { return null; } // non-ASCII: caller must UTF-8 encode first
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, (j += 16));
      var oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];
        var a = hash[0], e = hash[4];
        var temp1 = hash[7] +
          (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
          ((e & hash[5]) ^ (~e & hash[6])) +
          k[i] +
          (w[i] = i < 16 ? w[i] : (w[i - 16] +
            (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
            w[i - 7] +
            (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0);
        var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
          ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) { hash[i] = (hash[i] + oldHash[i]) | 0; }
    }
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        result += (b < 16 ? "0" : "") + b.toString(16);
      }
    }
    return result;
  }

  /* Async SHA-256: prefers WebCrypto, falls back to pure JS. Always resolves. */
  function sha256(text) {
    var ascii = unescape(encodeURIComponent(String(text))); // UTF-8 safe for JS path
    if (root && root.crypto && root.crypto.subtle && typeof TextEncoder !== "undefined") {
      return root.crypto.subtle
        .digest("SHA-256", new TextEncoder().encode(String(text)))
        .then(function (buf) {
          return Array.prototype.map
            .call(new Uint8Array(buf), function (x) { return x.toString(16).padStart(2, "0"); })
            .join("");
        })
        .catch(function () { return sha256Sync(ascii); });
    }
    return Promise.resolve(sha256Sync(ascii));
  }

  function normalizeCode(code) {
    return String(code || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  /* ---------- persistence (never throws — private mode safe) ---------- */
  function readState() {
    try {
      var raw = root.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var st = JSON.parse(raw);
      return st && st.plan === "pro" ? st : null;
    } catch (e) { return null; }
  }
  function writeState(state) {
    try { root.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
    catch (e) { return false; }
  }
  var memoryState = null; // fallback if storage is unavailable

  function config() { return (root && root.CSLCT_CONFIG) || {}; }

  var api = {
    sha256: sha256,
    sha256Sync: sha256Sync,
    normalizeCode: normalizeCode,

    isPro: function () { return !!(readState() || memoryState); },
    getState: function () { return readState() || memoryState; },

    activate: function (method, keyMasked) {
      var state = { plan: "pro", method: method, key: keyMasked || null, activatedAt: new Date().toISOString() };
      if (!writeState(state)) { memoryState = state; }
      return state;
    },

    deactivate: function () {
      try { root.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
      memoryState = null;
    },

    /* Gift-code redemption (owner-issued bypass). Resolves {ok, message}. */
    redeemGiftCode: function (code) {
      var normalized = normalizeCode(code);
      if (!normalized) {
        return Promise.resolve({ ok: false, message: "Please type a code first." });
      }
      var hashes = (config().giftCodeHashes || []).filter(function (h) {
        return typeof h === "string" && /^[0-9a-f]{64}$/.test(h);
      });
      if (!hashes.length) {
        return Promise.resolve({ ok: false, message: "No gift codes are set up yet. Ask the seller for a valid code." });
      }
      return sha256(normalized).then(function (digest) {
        if (digest && hashes.indexOf(digest) !== -1) {
          api.activate("gift", normalized.slice(0, 4) + "\u2026");
          return { ok: true, message: "Gift code accepted — Pro unlocked. Enjoy!" };
        }
        return { ok: false, message: "That code didn\u2019t match. Check the spelling and try again." };
      });
    },

    /* Gumroad license verification. Resolves {ok, message}. Never rejects. */
    verifyGumroadLicense: function (licenseKey) {
      var key = String(licenseKey || "").trim();
      if (!key) {
        return Promise.resolve({ ok: false, message: "Please paste your license key first." });
      }
      var productId = (config().gumroad || {}).productId;
      if (!productId) {
        return Promise.resolve({
          ok: false,
          message: "License checking isn\u2019t set up yet (missing Gumroad product ID). If you bought ColorSLCT, contact support and we\u2019ll unlock you with a gift code.",
        });
      }
      var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
      return fetch("https://api.gumroad.com/v2/licenses/verify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "product_id=" + encodeURIComponent(productId) + "&license_key=" + encodeURIComponent(key) + "&increment_uses_count=false",
        signal: controller ? controller.signal : undefined,
      })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; }); })
        .then(function (r) {
          if (timer) clearTimeout(timer);
          if (r.res.ok && r.data && r.data.success) {
            var refunded = r.data.purchase && (r.data.purchase.refunded || r.data.purchase.chargebacked);
            if (refunded) {
              return { ok: false, message: "This license was refunded, so it can\u2019t be used. Contact support if that\u2019s a mistake." };
            }
            api.activate("gumroad", key.slice(0, 8) + "\u2026");
            return { ok: true, message: "License verified — Pro unlocked. Thank you for your purchase!" };
          }
          return { ok: false, message: "That license key wasn\u2019t recognized. Check it and try again, or contact support." };
        })
        .catch(function () {
          if (timer) clearTimeout(timer);
          return { ok: false, message: "Couldn\u2019t reach the license server (are you offline?). Try again later, or use a gift code." };
        });
    },
  };

  return api;
});
