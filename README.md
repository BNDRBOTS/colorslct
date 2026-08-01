# ColorSLCT — WCAG-safe brand palette studio

A local-first, dependency-free color palette SaaS by **BNDR LLC**. Five-token palettes (light bg, text, primary, accent, dark bg) built on a true OKLCH engine, with live light/dark previews, WCAG contrast auto-enforcement, compare & history, share links, a saved-palette library, multi-format exports, optional AI suggestions, and a one-time Pro license sold through Gumroad, Buy Me a Coffee, or Stripe.

Everything is static HTML/CSS/JS. **No build step, no framework, no backend, no analytics.** It runs from any static host — or straight off a `file://` double-click.

---

## File map

```
colorslct/
├─ index.html              Landing page (features, pricing, FAQ, checkout buttons)
├─ app.html                The studio (the actual product)
├─ terms.html              Terms of Service
├─ privacy.html            Privacy Policy
├─ tools/
│  └─ gift-codes.html      OWNER TOOL — generate gift-code hashes. Keep private.
├─ assets/
│  ├─ css/base.css         Design system (mobile-first, light/dark, reduced-motion aware)
│  └─ js/
│     ├─ config.js         ⭐ THE ONLY FILE YOU EDIT to go live (keys, links, codes)
│     ├─ color-engine.js   OKLCH math, contrast, presets, exporters, share encoding
│     ├─ palette-designer.js Generative engine: 9 harmony models, 6 moods, OKLCH blending, gamut-mapped WCAG role-fitting
│     ├─ license.js        Pro licensing: Gumroad key verify + gift codes (SHA-256)
│     ├─ shared.js         Theme, modals, toasts, consent banner, storage gate
│     └─ app.js            Studio logic
├─ tests/
│  ├─ unit.mjs             Node unit tests (color math, designer engine, exporters, hashing, licensing)
│  └─ e2e.mjs              Playwright end-to-end tests (every page, every button, designer panel)
└─ README.md
```

---

## Going live — the 4 things to configure

All owner configuration lives in **`assets/js/config.js`**. Nothing else needs editing.

### 1. Gumroad (recommended — issues license keys automatically)

1. Create a product on Gumroad (suggested: **ColorSLCT Pro, $29, one-time**).
2. In the product settings, enable **“Generate a unique license key per sale”**.
3. In `config.js`, set:
   ```js
   gumroad: {
     buyUrl: "https://YOURNAME.gumroad.com/l/colorslct",  // your product page
     productId: "YOUR_PRODUCT_ID",                        // from product settings
   },
   ```
4. Done. Buyers paste their license key into the studio’s **Go Pro** dialog; the app verifies it directly against Gumroad’s license API (`increment_uses_count` is off, so verifying never burns activations) and unlocks Pro on that browser. Refunded/chargebacked keys are rejected.

### 2. Buy Me a Coffee (optional second checkout)

1. On your BMAC page, add ColorSLCT Pro as an **Extras** item ($29 one-time), or point buyers at your page directly.
2. In `config.js`, set:
   ```js
   buyMeACoffee: { buyUrl: "https://buymeacoffee.com/YOURNAME/e/XXXXX" },
   ```
3. BMAC doesn't issue license keys. Fulfil each order by emailing the buyer a **gift code** (section 4). Until a link is set, the button shows a "not connected yet" message instead of failing.

### 3. Stripe (optional third checkout — no backend needed)

1. Create a **Payment Link** in the Stripe dashboard (Products → Payment Links) for a $29 one-time price.
2. In `config.js`, set:
   ```js
   stripe: { paymentLink: "https://buy.stripe.com/XXXXXXXX" },
   ```
3. Note: Stripe Payment Links don’t issue license keys. Fulfil Stripe orders by sending the buyer a **gift code** (below) — Stripe emails you on every sale, or turn on the Payment Link's post-purchase confirmation page/redirect and put redemption instructions there. Until a link is set, the Stripe buttons show a friendly “not connected yet” message instead of failing.

### 4. Gift codes — your payment-gate bypass

Give Pro away to anyone you choose, no purchase needed.

1. Open **`tools/gift-codes.html`** in your browser (works offline; **do not deploy it** with your store, or deploy it under a secret path).
2. Type any codes you like, one per line → **Generate hashes** → **Copy config snippet**.
3. Paste the snippet into `giftCodeHashes` in `config.js` and redeploy.
4. Recipients open the studio → **Go Pro** → “Have a gift code?” → instant Pro. (The pricing page’s “Have a code?” link deep-links there via `app.html#redeem`.)

Only SHA-256 hashes ship in the source, so nobody can extract usable codes from your site. Codes are case-insensitive; spaces are ignored.

> **A starter code is pre-configured: `BNDR-GIFT-2049`** — use it to test the flow end-to-end, then **replace it** with your own codes before selling.

---

## Pricing rationale

- Coolors Pro (closest comparable) charges ~$3/month ≈ **$36+/year, recurring**.
- ColorSLCT Pro is **$29 once, lifetime** — cheaper than one year of the incumbent, with no churn management for you and a clean “no subscription” selling point. Free tier stays genuinely useful (full editor + CSS export + 3 saves) to drive adoption; Pro gates the team/professional outputs (SCSS, Tailwind, JSON tokens, SVG) and unlimited library.

Change the displayed price by editing `product.proPriceUSD` in `config.js` **and** the pricing section in `index.html`.

---

## Free vs Pro

| Capability | Free | Pro |
|---|---|---|
| Full studio (OKLCH random, harmony, history, compare, WCAG auto) | ✓ | ✓ |
| Light/dark live previews + contrast report | ✓ | ✓ |
| CSS variables export (copy + download) | ✓ | ✓ |
| Share links | ✓ | ✓ |
| AI suggestions (own DeepSeek key) | ✓ | ✓ |
| Saved palettes | 3 | Unlimited |
| SCSS / Tailwind / W3C JSON / SVG exports | — | ✓ |

---

## Privacy model (what makes this sellable as “local-first”)

- No accounts, no analytics, no cookies, no server of yours.
- Local storage is used **only after the visitor accepts the consent banner**; declining keeps the app fully working, session-only, and wipes prior data.
- The only network calls the app can make, both user-triggered and direct from the browser: DeepSeek (AI, user’s own key, session-only) and Gumroad (license verification).

---

## Deploying

Any static host works: Cloudflare Pages, Netlify, Vercel, GitHub Pages, S3/R2, or plain nginx. Upload the `colorslct/` folder contents (minus `tests/`, and minus `tools/` unless you want the gift tool at a secret URL). No headers, functions, or rewrites required. It also runs from `file://` for offline/demo use.

**Pre-launch checklist**

1. `config.js`: set Gumroad `buyUrl` + `productId` (and/or `buyMeACoffee.buyUrl`, Stripe `paymentLink`).
2. `config.js`: replace the starter gift-code hash with your own codes.
3. Optionally update `company` name/email and legal pages if your details differ.
4. Run the tests (below). Deploy.

---

## Testing

Unit tests (no dependencies beyond Node 18+):

```bash
node tests/unit.mjs
```

End-to-end tests (requires Playwright + a Chromium binary):

```bash
npm i playwright   # once
node tests/e2e.mjs
```

The e2e suite drives every page over `file://`: every studio button, the designer panel (harmony models, mood chips, blending, persistence), the guided tour, consent accept/decline, hex validation, share-link round-trip, library limits, gift-code unlock → Pro exports, pricing/nav buttons, legal pages, the gift-code tool, mobile (390px) overflow checks, and fails on any console error.

---

## Browser support

Modern evergreen browsers (Chrome, Edge, Firefox, Safari, iOS/Android). Progressive enhancement: the screen eyedropper appears only where the EyeDropper API exists; clipboard falls back to `execCommand`; storage falls back to memory when blocked; reduced-motion preferences are respected everywhere.

---

© BNDR LLC. All rights reserved.
