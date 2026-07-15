/* ============================================================
   ColorSLCT · unlock.js — checkout + activation page
   Buy buttons come from config (with an honest state when a
   link isn’t configured yet). Key redemption covers signed
   ColorSLCT keys, gift keys and Gumroad keys. Gift deep links
   (#key=…) auto-fill and auto-activate.
   ============================================================ */
(function () {
  'use strict';

  var Lic = window.License;
  var S = window.CSLCT;
  var CONFIG = window.CSLCT_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  function wireBuyButton(el, url, label) {
    if (!el) return;
    if (url) {
      el.href = url;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    } else {
      el.removeAttribute('target');
      el.classList.add('btn-unconfigured');
      el.href = '#';
      el.setAttribute('title', label + ' checkout is being set up');
      el.addEventListener('click', function (e) {
        e.preventDefault();
        S.toast(label + ' checkout isn’t open yet. If you have a key, paste it below — that always works.', 'warn');
        $('keyInput').focus();
      });
    }
  }

  function renderStatus() {
    var st = Lic.getState();
    var panel = $('statusPanel');
    var buyGrid = $('buyGrid');
    if (st.pro) {
      panel.hidden = false;
      $('statusPlan').textContent = st.plan === 'studio' ? 'STUDIO' : 'PRO';
      var when = st.activatedAt ? new Date(st.activatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
      var bits = [];
      bits.push(st.gift ? 'This copy was unlocked with a gift key' : 'This copy is licensed');
      if (st.name) bits.push('for ' + st.name);
      if (when) bits.push('since ' + when);
      var text = bits.join(' ') + '.';
      if (st.provisional && !st.graceExpired) {
        text += ' Your Gumroad key is verified provisionally — we’ll re-check automatically when you’re online.';
      }
      if (st.graceExpired) {
        text += ' We haven’t been able to re-verify your Gumroad key for a while, so Pro is paused — connect to the internet and reload.';
      }
      $('statusText').textContent = text;
      buyGrid.style.opacity = '0.55';
    } else {
      panel.hidden = true;
      buyGrid.style.opacity = '';
    }
  }

  function redeem(key) {
    var status = $('redeemStatus');
    var btn = $('redeemBtn');
    status.classList.remove('is-error');
    status.textContent = 'Checking your key…';
    btn.disabled = true;
    Lic.redeem(key).then(function (res) {
      btn.disabled = false;
      status.textContent = res.message;
      if (!res.ok) {
        status.classList.add('is-error');
        return;
      }
      renderStatus();
      S.toast(res.message);
      setTimeout(function () { location.href = 'app.html'; }, 1600);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    // pricing labels from config
    var pricing = CONFIG.PRICING || {};
    Object.keys(pricing).forEach(function (tier) {
      var p = pricing[tier];
      document.querySelectorAll('[data-price="' + tier + '"]').forEach(function (el) { el.textContent = '$' + p.price; });
      document.querySelectorAll('[data-suffix="' + tier + '"]').forEach(function (el) { el.textContent = p.suffix; });
    });

    wireBuyButton($('buyProStripe'), CONFIG.STRIPE_PAYMENT_LINK_PRO, 'Card');
    wireBuyButton($('buyStudioStripe'), CONFIG.STRIPE_PAYMENT_LINK_STUDIO, 'Card');
    wireBuyButton($('buyProGumroad'), CONFIG.GUMROAD_PRODUCT_URL, 'Gumroad');
    wireBuyButton($('buyStudioGumroad'), CONFIG.GUMROAD_PRODUCT_URL, 'Gumroad');

    renderStatus();

    $('redeemBtn').addEventListener('click', function () {
      redeem($('keyInput').value);
    });
    $('keyInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); redeem(this.value); }
    });

    $('deactivateBtn').addEventListener('click', function () {
      if (!window.confirm('Deactivate the license on this device? You can re-activate with the same key any time.')) return;
      Lic.deactivate();
      renderStatus();
      S.toast('Deactivated. Your key still works whenever you want it back.');
    });

    // gift / license deep link
    var urlKey = Lic.keyFromLocation();
    if (urlKey) {
      $('keyInput').value = urlKey;
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* file:// may refuse */ }
      redeem(urlKey);
    }

    // scroll hint for #studio anchor
    if (location.hash === '#studio') {
      var el = $('tierStudio');
      if (el) el.scrollIntoView({ block: 'center' });
    }
  });
})();
