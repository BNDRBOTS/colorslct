/* ============================================================
   ColorSLCT — OWNER CONFIGURATION
   This is the ONLY file you need to edit to go live.
   Drop your keys/links into the quoted strings below.
   Full instructions: README.md (section "Going live")
   ============================================================ */
window.CSLCT_CONFIG = {
  product: {
    name: "ColorSLCT",
    tagline: "WCAG-safe brand palettes, built in your browser.",
    version: "2.0.0",
    proPriceUSD: 29, // one-time. Keep in sync with your Stripe/Gumroad price.
  },

  company: {
    name: "BNDR LLC",
    website: "https://bndrllc.com",
    supportEmail: "support@bndrllc.com", // <-- change to your real support inbox
    legalRegion: "Arizona, USA", // used in Terms; adjust if needed
  },

  /* ---- STRIPE ------------------------------------------------
     Create a Payment Link in your Stripe dashboard
     (Products -> Payment links) and paste it here.
     Example: "https://buy.stripe.com/xxxxxxxxxxxxx"           */
  stripe: {
    paymentLink: "",
  },

  /* ---- BUY ME A COFFEE ----------------------------------------
     Paste your page or Extras product link, e.g.
     "https://buymeacoffee.com/bndr" or "https://buymeacoffee.com/bndr/e/12345".
     BMAC doesn't issue license keys — unlock those buyers by emailing
     them a gift code (see giftCodeHashes below).                  */
  buyMeACoffee: {
    buyUrl: "",
  },

  /* ---- GUMROAD -----------------------------------------------
     1) buyUrl: your product page, e.g. "https://bndr.gumroad.com/l/colorslct"
     2) productId: Gumroad product ID (Product -> Settings -> Advanced,
        or from the API). Needed for automatic license-key unlocking. */
  gumroad: {
    buyUrl: "",
    productId: "",
  },

  /* ---- GIFT CODES (payment-gate bypass) -----------------------
     Give these away to anyone you like. Codes are stored ONLY as
     SHA-256 hashes, so nobody can read working codes from source.
     Generate more hashes with tools/gift-codes.html (runs locally).
     The starter code below is documented in README.md — replace it
     before you ship if you don't want it active.                 */
  giftCodeHashes: [
    "9199d11b450626874bd80abcd9d5ee66778f31e4f2a25b18b129b2f6f44986df", // code: BNDR-GIFT-2049 (see README)
  ],
};
