/* ColorSLCT shared UI runtime — consent banner, safe storage, theme, toasts,
   modals with focus trap, scroll reveal. Used by every page. */
(function () {
  "use strict";
  var root = document.documentElement;
  var CONSENT_KEY = "cslct-consent";

  /* ---------- raw storage (never throws) ---------- */
  function rawGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function rawSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function rawRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* noop */ }
  }

  /* ---------- consent-gated store ---------- */
  var Store = {
    consent: function () { return rawGet(CONSENT_KEY); }, // 'accepted' | 'declined' | null
    allowed: function () { return rawGet(CONSENT_KEY) === "accepted"; },
    get: function (key, fallback) {
      var v = rawGet(key);
      if (v === null || v === undefined) return fallback;
      try { return JSON.parse(v); } catch (e) { return fallback; }
    },
    set: function (key, value) {
      if (!Store.allowed()) return false; // respect declined consent
      return rawSet(key, JSON.stringify(value));
    },
    remove: rawRemove,
    setConsent: function (value) {
      rawSet(CONSENT_KEY, value); // the choice itself must persist
      if (value === "declined") {
        // honor the choice: wipe everything we previously saved
        ["cslct-state", "cslct-palettes", "cslct-tour-done", "bndr-theme"].forEach(rawRemove);
      }
    },
  };

  /* ---------- theme (preserves legacy 'bndr-theme' key) ---------- */
  function currentTheme() {
    var saved = rawGet("bndr-theme");
    if (saved === "dark" || saved === "light") return saved;
    return "dark"; // brand default: dark everywhere until the visitor chooses light
  }
  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      var dark = theme === "dark";
      btn.setAttribute("aria-pressed", String(dark));
      var label = btn.querySelector("[data-theme-label]");
      if (label) label.textContent = dark ? "Light mode" : "Dark mode";
      var sun = btn.querySelector("[data-icon-sun]");
      var moon = btn.querySelector("[data-icon-moon]");
      if (sun) sun.style.display = dark ? "" : "none";
      if (moon) moon.style.display = dark ? "none" : "";
    });
  }
  function setTheme(theme) {
    applyTheme(theme);
    if (Store.allowed()) rawSet("bndr-theme", theme);
  }
  function toggleTheme() {
    setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
  }

  /* ---------- toast ---------- */
  var toastEl = null;
  function ensureToast() {
    if (!toastEl) {
      toastEl = document.getElementById("toast");
      if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.id = "toast";
        toastEl.className = "toast";
        toastEl.setAttribute("role", "status");
        toastEl.setAttribute("aria-live", "polite");
        toastEl.setAttribute("aria-atomic", "true");
        document.body.appendChild(toastEl);
      }
    }
    return toastEl;
  }
  function showToast(msg) {
    var t = ensureToast();
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timeout);
    t._timeout = setTimeout(function () { t.classList.remove("show"); }, 2800);
  }

  /* ---------- modals with focus trap ---------- */
  var lastFocused = null;
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function openModal(id, trigger) {
    var modal = document.getElementById(id);
    if (!modal) return;
    lastFocused = trigger || document.activeElement;
    modal.classList.add("open");
    modal.removeAttribute("aria-hidden");
    var first = modal.querySelector("[data-autofocus]") || modal.querySelector(FOCUSABLE);
    if (first) setTimeout(function () { first.focus(); }, 30);
    document.body.classList.add("modal-open");
  }

  function closeModal(id) {
    var modal = typeof id === "string" ? document.getElementById(id) : id;
    if (!modal || !modal.classList.contains("open")) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".modal.open")) document.body.classList.remove("modal-open");
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  }

  function closeAllModals() {
    document.querySelectorAll(".modal.open").forEach(function (m) { closeModal(m); });
  }

  document.addEventListener("click", function (e) {
    if (e.target.classList && e.target.classList.contains("modal")) closeModal(e.target);
    var dismiss = e.target.closest && e.target.closest("[data-close-modal]");
    if (dismiss) closeModal(dismiss.closest(".modal"));
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeAllModals(); return; }
    if (e.key !== "Tab") return;
    var open = document.querySelector(".modal.open");
    if (!open) return;
    var focusables = Array.prototype.filter.call(open.querySelectorAll(FOCUSABLE), function (el) {
      return el.offsetParent !== null || el === document.activeElement;
    });
    if (!focusables.length) return;
    var first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ---------- clipboard with fallback (preserved from v1) ---------- */
  function copyText(text, onDone) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) { if (onDone) onDone(); else showToast("Copied to clipboard"); }
      else { showToast("Copy failed — please copy manually"); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { if (onDone) onDone(); }).catch(fallback);
    } else { fallback(); }
  }

  /* ---------- file download ---------- */
  function downloadText(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      return true;
    } catch (e) {
      showToast("Download failed — your browser blocked it.");
      return false;
    }
  }

  /* ---------- cookie / storage consent banner ---------- */
  function initConsentBanner() {
    if (Store.consent()) return; // already answered
    var banner = document.createElement("div");
    banner.id = "consentBanner";
    banner.className = "consent-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Privacy choice");
    banner.innerHTML =
      '<div class="consent-inner">' +
      '<p class="consent-text"><strong>Your colors stay on your device.</strong> ColorSLCT uses your browser\u2019s local storage to remember palettes and settings — no cookies, no tracking, nothing leaves this browser. Is that okay?</p>' +
      '<div class="consent-actions">' +
      '<button type="button" class="btn btn-primary" id="consentAccept">Yes, remember my work</button>' +
      '<button type="button" class="btn" id="consentDecline">No, don\u2019t save anything</button>' +
      '<a class="consent-link" href="privacy.html">Privacy policy</a>' +
      "</div></div>";
    document.body.appendChild(banner);
    requestAnimationFrame(function () { banner.classList.add("show"); });
    document.getElementById("consentAccept").addEventListener("click", function () {
      Store.setConsent("accepted");
      banner.classList.remove("show");
      setTimeout(function () { banner.remove(); }, 400);
      showToast("Great — your palettes and settings will be remembered here.");
      document.dispatchEvent(new CustomEvent("cslct:consent", { detail: "accepted" }));
    });
    document.getElementById("consentDecline").addEventListener("click", function () {
      Store.setConsent("declined");
      banner.classList.remove("show");
      setTimeout(function () { banner.remove(); }, 400);
      showToast("Okay — nothing will be saved between visits.");
      document.dispatchEvent(new CustomEvent("cslct:consent", { detail: "declined" }));
    });
  }

  /* ---------- scroll reveal (respects reduced motion) ---------- */
  function initReveal() {
    var els = document.querySelectorAll("[data-reveal]");
    if (!els.length) return;
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("revealed"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- support email links from config (single source of truth) ---------- */
  function initSupportEmails() {
    var cfg = window.CSLCT_CONFIG || {};
    var support = (cfg.company || {}).supportEmail;
    if (!support) return;
    document.querySelectorAll("a[data-support-email]").forEach(function (a) {
      a.href = "mailto:" + support;
      if (a.textContent.indexOf("@") !== -1) a.textContent = support;
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    applyTheme(currentTheme());
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      btn.addEventListener("click", toggleTheme);
    });
    document.querySelectorAll("[data-year]").forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });
    initConsentBanner();
    initReveal();
    initSupportEmails();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.CslctUI = {
    Store: Store,
    showToast: showToast,
    openModal: openModal,
    closeModal: closeModal,
    closeAllModals: closeAllModals,
    copyText: copyText,
    downloadText: downloadText,
    setTheme: setTheme,
    toggleTheme: toggleTheme,
  };
})();
