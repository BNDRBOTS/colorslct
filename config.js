/* ============================================================
   BNDR ColorSLCT — OWNER CONFIGURATION
   ------------------------------------------------------------
   This is the ONLY file you need to edit to go live.
   Every value below is read at runtime by every page.

   QUICK START (5 minutes):
   1. PAYMENTS  — paste your Stripe Payment Links and/or your
                  Gumroad product URL + product ID below.
   2. LICENSING — open tools/keygen.html in your browser once,
                  click "Create signing keys", then paste the
                  Public key it gives you into LICENSE_PUBLIC_KEY.
                  (Keep the Private key to yourself — it is what
                  lets you mint license + gift keys.)
   3. Deploy the folder to any static host — or zip it and sell
      the zip. Everything runs client-side.

   Full walkthrough: see README.md → "Going live".
   ============================================================ */
(function () {
  'use strict';

  var CONFIG = {

    /* ── Product identity ─────────────────────────────────── */
    PRODUCT_NAME: 'ColorSLCT',
    COMPANY: 'BNDR LLC',
    COMPANY_URL: 'https://bndrllc.com',

    /* Where this site lives once deployed (no trailing slash).
       Used for share links + canonical hints. Leave '' to have
       share links use the current address automatically.       */
    SITE_URL: '',

    /* Support email. Leave '' to hide contact links everywhere
       (nothing will render a fake address).                    */
    SUPPORT_EMAIL: '',

    /* ── Payments: Stripe ─────────────────────────────────────
       Create Payment Links in your Stripe dashboard
       (Products → Payment Links) and paste them here.
       Leave '' and the Stripe buttons show an honest
       "checkout not open yet" state instead of a dead link.    */
    STRIPE_PAYMENT_LINK_PRO: '',      // e.g. 'https://buy.stripe.com/xxxx'
    STRIPE_PAYMENT_LINK_STUDIO: '',   // e.g. 'https://buy.stripe.com/yyyy'

    /* ── Payments: Gumroad ────────────────────────────────────
       GUMROAD_PRODUCT_URL  → your product page, e.g.
                              'https://bndr.gumroad.com/l/colorslct'
       GUMROAD_PRODUCT_ID   → Product settings → Advanced →
                              "Product ID" (needed to verify the
                              license keys Gumroad issues).
       Enable "Generate a unique license key per sale" on the
       product so buyers can self-activate instantly.           */
    GUMROAD_PRODUCT_URL: '',
    GUMROAD_PRODUCT_ID: '',

    /* ── Licensing (signed keys + gifting) ────────────────────
       Paste the PUBLIC key from tools/keygen.html here.
       The matching PRIVATE key (which only you hold) signs
       every license/gift key. With this empty, key redemption
       tells users activation isn't configured yet.             */
    LICENSE_PUBLIC_KEY: '',

    /* Days a Gumroad activation may stay "provisional" when the
       verification API can't be reached (offline install etc.)
       before the app asks the user to re-verify online.        */
    GUMROAD_OFFLINE_GRACE_DAYS: 14,

    /* ── Pricing shown across the site (display only) ─────────
       Change the numbers here and every page updates.
       Keys are matched by the unlock + landing pages.          */
    PRICING: {
      free:   { label: 'Free',   price: 0,  suffix: 'forever' },
      pro:    { label: 'Pro',    price: 29, suffix: 'one-time' },
      studio: { label: 'Studio', price: 79, suffix: 'one-time · 5 seats' }
    },

    /* Free-tier limit on saved palettes (Pro/Studio: unlimited) */
    FREE_LIBRARY_LIMIT: 3
  };

  /* Runtime override hook — used by automated tests and staging.
     If a script that runs BEFORE this file sets
     window.CSLCT_CONFIG_OVERRIDE = {...}, those fields win.     */
  var root = typeof self !== 'undefined' ? self : this;
  if (root && root.CSLCT_CONFIG_OVERRIDE) {
    for (var k in root.CSLCT_CONFIG_OVERRIDE) {
      if (Object.prototype.hasOwnProperty.call(root.CSLCT_CONFIG_OVERRIDE, k)) {
        CONFIG[k] = root.CSLCT_CONFIG_OVERRIDE[k];
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
  if (root) root.CSLCT_CONFIG = CONFIG;
})();
