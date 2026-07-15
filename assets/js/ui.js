/* ============================================================
   ColorSLCT · ui.js — shared page shell
   Storage + consent, theme, toasts, modals (focus-trapped),
   nav, scroll reveals, marquee, magnetic buttons, chroma
   canvas. Loaded on every page after config.js/color-core.js.
   ============================================================ */
(function () {
  'use strict';

  var root = document.documentElement;
  var CONFIG = window.CSLCT_CONFIG || {};
  var reduceMotionMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  function prefersReducedMotion() {
    return reduceMotionMQ.matches || root.getAttribute('data-motion') === 'reduced';
  }

  /* ── Safe storage with consent gate ─────────────────────
     Essential keys always work (consent choice, license).
     Everything else persists only after "Allow saving".      */
  var ESSENTIAL = { 'cslct.consent': 1, 'cslct.license': 1 };
  var memoryStore = {};

  function rawGet(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return memoryStore[k] !== undefined ? memoryStore[k] : null; }
  }
  function rawSet(k, v) {
    try { window.localStorage.setItem(k, v); return true; } catch (e) { memoryStore[k] = v; return false; }
  }
  function rawRemove(k) {
    try { window.localStorage.removeItem(k); } catch (e) { /* noop */ }
    delete memoryStore[k];
  }

  function consentChoice() { return rawGet('cslct.consent'); } // 'all' | 'essential' | null
  function storageAllowed() { return consentChoice() === 'all'; }

  var store = {
    get: function (k, fallback) {
      var raw = storageAllowed() || ESSENTIAL[k] ? rawGet(k) : (memoryStore[k] !== undefined ? memoryStore[k] : null);
      if (raw === null || raw === undefined) return fallback;
      try { return JSON.parse(raw); } catch (e) { return fallback; }
    },
    set: function (k, v) {
      var raw = JSON.stringify(v);
      if (storageAllowed() || ESSENTIAL[k]) return rawSet(k, raw);
      memoryStore[k] = raw; // session-only until allowed
      return false;
    },
    remove: rawRemove,
    allowed: storageAllowed,
    /** flush session-only values into real storage after consent */
    persistMemory: function () {
      Object.keys(memoryStore).forEach(function (k) { rawSet(k, memoryStore[k]); });
      memoryStore = {};
    },
    /** wipe every non-essential cslct key (consent withdrawn) */
    clearOptional: function () {
      var kill = [];
      try {
        for (var i = 0; i < window.localStorage.length; i++) {
          var k = window.localStorage.key(i);
          if (k && k.indexOf('cslct.') === 0 && !ESSENTIAL[k]) kill.push(k);
        }
      } catch (e) { /* storage unreadable */ }
      kill.forEach(rawRemove);
      memoryStore = {};
    }
  };

  /* ── Theme ──────────────────────────────────────────────── */
  function applyTheme(theme) {
    root.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    document.querySelectorAll('.theme-toggle').forEach(function (b) {
      b.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
    });
  }
  function initTheme() {
    var saved = store.get('cslct.theme', null);
    applyTheme(saved === 'light' ? 'light' : 'dark'); // dark-first brand default
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        applyTheme(next);
        store.set('cslct.theme', next);
        document.dispatchEvent(new CustomEvent('cslct:theme', { detail: next }));
      });
    });
  }

  /* ── Motion preference (user override from tour/prefs) ──── */
  function initMotionPref() {
    if (store.get('cslct.motion', null) === 'reduced') root.setAttribute('data-motion', 'reduced');
  }
  function setMotionPref(reduced) {
    if (reduced) { root.setAttribute('data-motion', 'reduced'); store.set('cslct.motion', 'reduced'); }
    else { root.removeAttribute('data-motion'); store.set('cslct.motion', 'full'); }
  }

  /* ── Toast ──────────────────────────────────────────────── */
  var toastEl = null, toastTimer = null;
  function toast(msg, kind) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.remove('toast-warn', 'toast-bad');
    if (kind === 'warn') toastEl.classList.add('toast-warn');
    if (kind === 'bad') toastEl.classList.add('toast-bad');
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 3200);
  }

  /* ── Modal manager with focus trap ──────────────────────── */
  var openStack = [];
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function openModal(id, opener) {
    var m = document.getElementById(id);
    if (!m) return;
    m.classList.add('open');
    m.__opener = opener || document.activeElement;
    openStack.push(m);
    var first = m.querySelector('[data-autofocus]') || m.querySelector(FOCUSABLE);
    if (first) setTimeout(function () { first.focus(); }, 30);
    document.dispatchEvent(new CustomEvent('cslct:modal-open', { detail: id }));
  }
  function closeModal(id) {
    var m = typeof id === 'string' ? document.getElementById(id) : id;
    if (!m || !m.classList.contains('open')) return;
    m.classList.remove('open');
    openStack = openStack.filter(function (x) { return x !== m; });
    if (m.__opener && typeof m.__opener.focus === 'function') m.__opener.focus();
    document.dispatchEvent(new CustomEvent('cslct:modal-close', { detail: m.id }));
  }
  function topModal() { return openStack[openStack.length - 1] || null; }

  document.addEventListener('keydown', function (e) {
    var m = topModal();
    if (!m) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(m); return; }
    if (e.key === 'Tab') {
      var items = Array.prototype.filter.call(m.querySelectorAll(FOCUSABLE), function (el) {
        return el.offsetParent !== null || el === document.activeElement;
      });
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('click', function (e) {
    if (e.target.classList && e.target.classList.contains('modal')) closeModal(e.target);
    var closer = e.target.closest && e.target.closest('[data-close-modal]');
    if (closer) closeModal(closer.closest('.modal'));
  });

  /* ── Nav behaviour ───────────────────────────────────────── */
  function initNav() {
    var nav = document.querySelector('.site-nav');
    if (!nav) return;
    var onScroll = function () {
      nav.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    var burger = nav.querySelector('.nav-burger');
    var menu = document.querySelector('.mobile-menu');
    if (burger && menu) {
      burger.addEventListener('click', function () {
        var open = burger.getAttribute('aria-expanded') === 'true';
        burger.setAttribute('aria-expanded', String(!open));
        menu.classList.toggle('open', !open);
      });
      menu.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function () {
          burger.setAttribute('aria-expanded', 'false');
          menu.classList.remove('open');
        });
      });
    }
  }

  /* ── Scroll reveals ─────────────────────────────────────── */
  function initReveals() {
    var els = document.querySelectorAll('[data-reveal]');
    if (!els.length) return;
    if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
      els.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ── Split-line kinetic type ────────────────────────────── */
  function splitLines(el) {
    var lines = el.querySelectorAll('.split-line');
    lines.forEach(function (l, i) {
      if (!l.querySelector('span')) {
        var span = document.createElement('span');
        span.innerHTML = l.innerHTML;
        l.innerHTML = '';
        l.appendChild(span);
      }
      l.style.setProperty('--line-i', i);
    });
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add('lines-in'); });
    });
  }

  /* ── Magnetic buttons (fine pointers only) ──────────────── */
  function initMagnetic() {
    if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches || prefersReducedMotion()) return;
    document.querySelectorAll('[data-magnetic]').forEach(function (el) {
      var strength = 0.22;
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var x = (e.clientX - r.left - r.width / 2) * strength;
        var y = (e.clientY - r.top - r.height / 2) * strength;
        el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      });
      el.addEventListener('pointerleave', function () {
        el.style.transform = '';
      });
    });
  }

  /* ── Chroma field canvas (hero) ─────────────────────────── */
  function chromaField(canvas, getColors) {
    if (!canvas || !canvas.getContext) return { setColors: function () {} };
    var ctx = canvas.getContext('2d');
    var particles = [], W = 0, H = 0, DPR = 1, raf = null, running = false;
    var colors = getColors();

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.max(1, W * DPR);
      canvas.height = Math.max(1, H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    function spawn() {
      particles = [];
      var n = Math.min(140, Math.max(50, Math.floor(W * H / 16000)));
      for (var i = 0; i < n; i++) {
        particles.push({
          x: Math.random() * W, y: Math.random() * H,
          r: 1 + Math.random() * 2.4,
          c: colors[i % colors.length],
          a: Math.random() * Math.PI * 2,
          s: 0.15 + Math.random() * 0.5
        });
      }
    }
    function tick(t) {
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        // flow field: cheap trig noise
        var ang = Math.sin(p.x * 0.004 + t * 0.00012) + Math.cos(p.y * 0.004 - t * 0.00009);
        p.x += Math.cos(ang + p.a) * p.s;
        p.y += Math.sin(ang + p.a) * p.s;
        if (p.x < -8) p.x = W + 8; if (p.x > W + 8) p.x = -8;
        if (p.y < -8) p.y = H + 8; if (p.y > H + 8) p.y = -8;
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    }
    function start() {
      if (running || prefersReducedMotion()) return;
      running = true;
      resize(); spawn();
      raf = requestAnimationFrame(tick);
    }
    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    }
    window.addEventListener('resize', function () { if (running) { resize(); spawn(); } });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) {
        en[0].isIntersecting ? start() : stop();
      }, { threshold: 0.02 }).observe(canvas);
    } else {
      start();
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });
    if (prefersReducedMotion()) {
      // static composition for reduced motion: scatter once
      resize(); spawn();
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        ctx.globalAlpha = 0.7; ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    return {
      setColors: function (next) {
        colors = next && next.length ? next : colors;
        particles.forEach(function (p, i) { p.c = colors[i % colors.length]; });
      }
    };
  }

  /* ── Consent banner ─────────────────────────────────────── */
  function buildConsent() {
    if (document.getElementById('cslctConsent')) return;
    var wrap = document.createElement('div');
    wrap.id = 'cslctConsent';
    wrap.className = 'consent';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'Saving preferences on this device');
    wrap.innerHTML =
      '<h2>Can we remember your work?</h2>' +
      '<p>ColorSLCT has no accounts, no tracking and no third-party cookies. Everything runs on your device. ' +
      'With your OK, we save your palettes and settings in this browser so they’re here when you come back. ' +
      '<a href="privacy.html">How your data is handled</a>.</p>' +
      '<div class="consent-actions">' +
      '<button type="button" class="btn btn-volt" id="consentAll">Allow saving</button>' +
      '<button type="button" class="btn btn-ghost" id="consentEssential">Only what’s essential</button>' +
      '</div>';
    document.body.appendChild(wrap);
    requestAnimationFrame(function () { requestAnimationFrame(function () { wrap.classList.add('show'); }); });

    function choose(kind) {
      rawSet('cslct.consent', JSON.stringify(kind));
      wrap.classList.remove('show');
      setTimeout(function () { wrap.remove(); }, 700);
      if (kind === 'all') store.persistMemory();
      else store.clearOptional();
      document.dispatchEvent(new CustomEvent('cslct:consent', { detail: kind }));
      toast(kind === 'all'
        ? 'Saving is on — your palettes will be remembered on this device.'
        : 'OK — nothing optional is saved. Your work lasts until you close the tab.');
    }
    wrap.querySelector('#consentAll').addEventListener('click', function () { choose('all'); });
    wrap.querySelector('#consentEssential').addEventListener('click', function () { choose('essential'); });
  }
  function initConsent() {
    if (!consentChoice()) buildConsent();
    // footer "storage settings" reopener
    document.querySelectorAll('[data-open-consent]').forEach(function (el) {
      el.addEventListener('click', function () {
        rawRemove('cslct.consent');
        buildConsent();
      });
    });
  }

  /* ── Config-driven footer bits ──────────────────────────── */
  function initConfigBits() {
    document.querySelectorAll('[data-support-email]').forEach(function (el) {
      if (CONFIG.SUPPORT_EMAIL) {
        el.href = 'mailto:' + CONFIG.SUPPORT_EMAIL;
        el.textContent = el.getAttribute('data-label') || 'Contact support';
      } else {
        el.remove(); // never render a fake address
      }
    });
    document.querySelectorAll('[data-year]').forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });
  }

  /* ── Boot ───────────────────────────────────────────────── */
  initMotionPref();
  initTheme();

  document.addEventListener('DOMContentLoaded', function () {
    initNav();
    initReveals();
    initMagnetic();
    initConsent();
    initConfigBits();
    document.querySelectorAll('[data-split]').forEach(splitLines);
  });

  window.CSLCT = {
    config: CONFIG,
    store: store,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    chromaField: chromaField,
    splitLines: splitLines,
    setMotionPref: setMotionPref,
    prefersReducedMotion: prefersReducedMotion,
    consentChoice: consentChoice
  };
})();
