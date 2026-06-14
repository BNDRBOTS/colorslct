# BNDR ColorSLCT Core

**UI/UX Developer Palette Engine**

BNDR ColorSLCT is a dependency-free, pure-client web application designed to build, compare, mathematically verify, and export WCAG-safe design tokens. Engineered for professional workflows, it utilizes OKLCH color-space calculations to maintain precise luminance and chroma scaling.

---

## Core Features & Setup

### 1. Token Management & Locking System

* **5-Core Token System:** Explicit tracking for Background Light, Text Primary, Brand Primary, Warning Accent (`accent1`), and Background Dark.
* **Non-Destructive Locking:** Individual tokens can be locked. The engine strictly respects locked tokens during Randomization, AI Generation, and WCAG enforcement. State updates are executed in-place to prevent DOM reconstruction and preserve keyboard focus.
* **1-Click Copy:** Hex and OKLCH values are exposed in a monospace interface. Clicking instantly fires a robust, iframe-safe clipboard extraction (`document.execCommand` fallback).
* **Pure OS-Bypass Swatches:** Circumvents buggy native OS/browser color picker border rendering by expanding an `opacity: 0` input over an exact JS-driven CSS background.

### 2. Generative Engines

* **Smart OKLCH Randomizer:** Randomization isn't blind. If a primary or background token is locked, the engine mathematically derives the baseline Hue from the locked token and intelligently orbits the remaining generated tokens to guarantee visual harmony.
* **DeepSeek AI Integration:** Direct API pipeline to `deepseek-chat`. Accepts natural language prompts and strictly outputs structured JSON. Safely maps results around user-locked tokens.
* **Hue Shifting (Harmony):** A 1-click utility that iterates all unlocked tokens exactly 45° across the OKLCH color wheel while maintaining existing luminance constraints.

### 3. Verification & Context Canvas

* **Live UI Previews:** High-fidelity mockups of Light and Dark environments. Utilizes CSS `color-mix(in srgb)` to dynamically calculate translucent hover states and alert borders directly from the active tokens.
* **Real-Time WCAG Matrix:** Auto-calculates luminance contrast ratios matching exact WCAG AA/AAA parameters (Target 7:1 for Text, 4.5:1 for UI elements).
* **Auto-Enforcement:** A toggleable `WCAG Engine`. When active, it traverses the luminance math positively or negatively (depending on background/foreground relationship) to surgically shift failing tokens until they pass, without crushing them into absolute black/white voids.
* **Comparison Sandbox:** A spatial drag-and-drop comparison bucket (max 8 swatches). Touch-friendly for mobile, and features precision hover-states for desktop.

### 4. Enterprise Output & State

* **History Strip:** Visual undo stack tracking the last 8 iterations. Click any node to time-travel back to a previous palette state.
* **Native Export:** Compiles the exact palette into raw CSS Custom Properties (`:root { ... }`). Ready for direct paste into any standard web environment with zero pre-processors.
* **Dark/Light IDE Themes:** The application shell itself toggles between pure achromatic professional neutrals (`#F5F5F5` / `#121212`) to eliminate simultaneous contrast deception.

---

## Mobile-First Layout Engineering

The workspace is engineered to operate flawlessly on any viewport:

* **Mobile (<1024px):** Renders as a native scrolling flex-column. Overlays and comparison sandboxes switch from desktop hover mechanics to persistent, touch-optimized visibility. Modals respect safe area heights (`max-height: 90vh`) and toasts anchor to the bottom-center.
* **Desktop (≥1024px):** Snaps to a strict `100vh` split-screen IDE. A fixed 380px control sidebar on the left, with an independently scrollable verification canvas on the right.

---

## Technical Foundations

* **Zero Dependencies:** Written entirely in Vanilla HTML, CSS, and JS.
* **Color Math Pipeline:** Custom functions convert Hex → sRGB → Linear RGB → Oklab → Oklch to execute uniform lightness manipulation without shifting hues or blowing out saturation.
* **A11y (Accessibility):** Fully aria-labeled, focus-trapped modals, `<output>` regions (`aria-live`), and `prefers-reduced-motion` compliance.

*Engineered by BNDR LLC.*
