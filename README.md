# ColorSLCT — the palette studio that proves its work

A frontend-only, sellable SaaS for building **WCAG-safe, five-token brand palettes**:
OKLCH color science, live mock-up previews, a full contrast matrix with one-tap
auto-fix, shade scales, color-blindness simulation, image extraction, ten export
formats — wrapped in a savage editorial UI. **No backend. No accounts. No build
step.** Deploy the folder, or sell the zip.

by BNDR LLC · v2.0

---

## The pages

| Page | What it is |
|---|---|
| `index.html` | Marketing landing page (hero, live demo, pricing, FAQ) |
| `app.html` | The studio — the actual product |
| `unlock.html` | Checkout links + license/gift-key activation + license management |
| `privacy.html`, `terms.html` | Plain-language legal, matching what the product actually does |
| `404.html` | Not-found page for static hosts |
| `tools/keygen.html` | **Owner console** — mint license & gift keys (never link it publicly; `robots.txt` already excludes `/tools/`) |
| `tools/keygen.mjs` | Same minting power as a Node CLI |

Everything works from `file://` (double-click `index.html`) **and** from any
static host — GitHub Pages, Netlify, Cloudflare Pages, S3, a $3 VPS.

---

## Going live in ~10 minutes

All owner setup happens in **one file: `config.js`**.

### 1 · Create your signing keys (2 min)

Open `tools/keygen.html` in your browser → **Create signing keys** →
**Download backup** (guard that file like a password) → copy the **public key**
into `config.js → LICENSE_PUBLIC_KEY`.

The matching private key never ships with the product; it stays with you and is
what makes license keys unforgeable (ECDSA P-256 signatures, verified in the
buyer's browser via WebCrypto).

### 2 · Wire up payments (5 min)

**Stripe** — Dashboard → Products → create "ColorSLCT Pro" ($29) and
"ColorSLCT Studio" ($79) → create a **Payment Link** for each → paste the two
URLs into `STRIPE_PAYMENT_LINK_PRO` / `STRIPE_PAYMENT_LINK_STUDIO`.
When a sale lands, mint a key (step 3) and email it to the buyer — that's the
entire fulfilment for a static product. (You can automate it later with Zapier
/ Make + the CLI, but manual works from day one.)

**Gumroad** — create the product → enable **"Generate a unique license key per
sale"** → paste the product URL into `GUMROAD_PRODUCT_URL` and the product ID
(product → Advanced) into `GUMROAD_PRODUCT_ID`. Gumroad buyers self-activate
instantly: their receipt shows a key, the unlock page verifies it against
Gumroad's license API. **Zero manual fulfilment.**

Until a link is configured, its buy button shows an honest "checkout isn't open
yet" message instead of a dead link — the key-activation path always works.

### 3 · Mint keys, gift copies, bypass the gate

This is your giveaway mechanism:

- **Browser:** `tools/keygen.html` → Step 2 → tick **gift** → mint → send the
  key, or (with your site URL filled in) copy the **one-tap gift link** —
  `unlock.html#key=…` — which activates the moment it's opened.
- **CLI:** `node tools/keygen.mjs mint --gift --name "Mom" --site https://your.site`
- Optional expiry (`--days 30`) makes time-boxed review/press copies.
- Studio keys: `--plan studio`.

Verification is local and cryptographic, so gift keys work even offline.

### 4 · Optional polish

- `SUPPORT_EMAIL` — contact links render only when this is set (nothing fake is ever shown).
- `SITE_URL` — makes share links absolute (otherwise they use the current address).
- `PRICING` — change the numbers once, every page updates.

---

## Pricing (and why)

Defaults: **Free / $29 Pro one-time / $79 Studio one-time (5 seats)**.

Rationale: the dominant paid competitor (Coolors Pro) rents at roughly
$3/month billed annually (~$36+/year, forever); most other palette tools are
free but stop at "pretty colors" without WCAG enforcement, token roles, ramps
and production exports. A **one-time $29** undercuts one year of the market
leader while promising ownership — a clean competitive wedge for a local-first
tool — and $79/5-seat Studio prices team licensing at ~2.7 seats' worth.
(Figures from publicly known 2025 pricing; live web verification was
unavailable when this was written — glance at coolors.co/pricing before launch
and nudge `config.js` if the market moved.)

---

## Feature map

**Free (everything v1 had, plus):** five-token editor (picker, typed hex,
eyedropper on supporting browsers, per-token lock), OKLCH shuffle, harmony
rotation, undo/redo + history strip, WCAG guard + full contrast matrix +
auto-fix, live day/night mock-ups, compare tray (drag to reorder), presets,
AI assistant (bring-your-own DeepSeek key), import (hex list / CSS vars /
tokens JSON), share links, CSS variables export, 3 saved palettes, dark/light
theme, welcome tour, preferences.

**Pro / Studio:** all 10 export formats (CSS, SCSS, Tailwind v3 + v4, W3C
design-tokens JSON, TS module, SVG + PNG cards) with optional 11-step shade
scales, color-blindness preview (protan/deutan/tritan/grayscale), image →
palette extraction, unlimited library.

---

## Testing

```bash
cd tests
npm install          # installs Playwright (uses the repo's pinned browser path if set)
npm run test:unit    # pure logic: color math, WCAG enforcement, exporters, licensing, share codec
npm run test:e2e     # full browser suite: every page, every button, gates, activation, mobile viewports
```

The unit suite runs in plain Node (no browser). The e2e suite serves the folder
over localhost and drives Chromium through every user-facing flow, including
minting a real key and activating it.

---

## Honest limitations (read before selling)

- **Client-side licensing is a lock on an honest door.** Signed keys are
  cryptographically unforgeable, but a determined person can edit the JS in
  their copy. This is the standard trade-off for backend-free products —
  the same one every Gumroad zip lives with.
- **Gumroad verification needs Gumroad reachable.** If the API can't be
  reached at activation, the app activates *provisionally*, says so out loud,
  and re-verifies automatically (grace window: `GUMROAD_OFFLINE_GRACE_DAYS`).
  An explicit "refunded/invalid" answer revokes.
- **Stripe fulfilment is manual by default** (mint + email a key). Gumroad is
  the zero-touch path.
- **Storage is per-browser.** No accounts means no sync; export anything precious.
- The CVD preview uses the standard Machado et al. simulation matrices — a
  strong approximation, labeled as such in-app.

---

## Architecture notes

- Plain HTML/CSS/JS, zero dependencies, zero build. Classic scripts (no
  modules) so `file://` distribution works.
- `assets/js/color-core.js` and `exporters.js` are pure UMD modules — the unit
  tests load them straight into Node.
- Fonts are self-hosted variable woff2 (Space Grotesk, JetBrains Mono — OFL,
  licenses bundled). No external requests at runtime except the two opt-in
  features documented in `privacy.html`.
- All animation is transform/opacity, honors `prefers-reduced-motion`, and the
  in-app "Calm mode" forces it off for everyone else.
- Storage is consent-gated: nothing optional persists until the visitor allows
  it (the banner), matching the privacy page exactly.
