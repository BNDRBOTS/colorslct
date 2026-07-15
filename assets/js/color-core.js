/* ============================================================
   ColorSLCT · color-core.js
   Pure color science. No DOM. Loadable in browser + Node.
   sRGB ↔ OKLab/OKLCH (Björn Ottosson matrices), WCAG 2.x
   contrast, palette generation, ramps, quantization, CVD.
   ============================================================ */
(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ColorCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── Hex parsing / formatting ───────────────────────────── */

  /** Normalize any user/AI-supplied hex to '#rrggbb' (lowercase), or null. */
  function normalizeHex(input) {
    if (typeof input !== 'string') return null;
    var s = input.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(s)) {
      s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    } else if (/^[0-9a-fA-F]{8}$/.test(s)) {
      s = s.slice(0, 6); // drop alpha
    } else if (!/^[0-9a-fA-F]{6}$/.test(s)) {
      return null;
    }
    return '#' + s.toLowerCase();
  }

  function hexToRgb(hex) {
    var n = normalizeHex(hex) || '#000000';
    var c = n.slice(1);
    return [
      parseInt(c.substring(0, 2), 16),
      parseInt(c.substring(2, 4), 16),
      parseInt(c.substring(4, 6), 16)
    ];
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      v = Math.max(0, Math.min(255, Math.round(v)));
      return v.toString(16).padStart(2, '0');
    }).join('');
  }

  /* ── sRGB transfer ──────────────────────────────────────── */

  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(c) {
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

  /* ── OKLab / OKLCH (Ottosson 2020) ──────────────────────── */

  function rgbToOklab(r, g, b) {
    var lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
    var l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    var m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    var s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
    l = Math.cbrt(l); m = Math.cbrt(m); s = Math.cbrt(s);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    ];
  }

  function oklabToRgb(L, a, b) {
    var l = L + 0.3963377774 * a + 0.2158037573 * b;
    var m = L - 0.1055613458 * a - 0.0638541728 * b;
    var s = L - 0.0894841775 * a - 1.2914855480 * b;
    l = l * l * l; m = m * m * m; s = s * s * s;
    var lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    var lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    var lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    return [
      Math.round(Math.max(0, Math.min(1, linearToSrgb(lr))) * 255),
      Math.round(Math.max(0, Math.min(1, linearToSrgb(lg))) * 255),
      Math.round(Math.max(0, Math.min(1, linearToSrgb(lb))) * 255)
    ];
  }

  function oklabToOklch(L, a, b) {
    var C = Math.sqrt(a * a + b * b);
    var h = Math.atan2(b, a) * 180 / Math.PI;
    if (h < 0) h += 360;
    return [L, C, h];
  }

  function oklchToOklab(L, C, h) {
    var rad = h * Math.PI / 180;
    return [L, C * Math.cos(rad), C * Math.sin(rad)];
  }

  function hexToOklch(hex) {
    var rgb = hexToRgb(hex);
    var lab = rgbToOklab(rgb[0], rgb[1], rgb[2]);
    return oklabToOklch(lab[0], lab[1], lab[2]);
  }

  function oklchToHex(L, C, h) {
    var lab = oklchToOklab(L, C, h);
    var rgb = oklabToRgb(lab[0], lab[1], lab[2]);
    return rgbToHex(rgb[0], rgb[1], rgb[2]);
  }

  /* ── Other syntaxes (for copy chips) ────────────────────── */

  function hexToRgbString(hex) {
    var c = hexToRgb(hex);
    return 'rgb(' + c[0] + ', ' + c[1] + ', ' + c[2] + ')';
  }

  function hexToHslString(hex) {
    var c = hexToRgb(hex);
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return 'hsl(' + Math.round(h * 360) + ', ' + Math.round(s * 100) + '%, ' + Math.round(l * 100) + '%)';
  }

  function hexToOklchString(hex) {
    var lch = hexToOklch(hex);
    return 'oklch(' + (lch[0] * 100).toFixed(1) + '% ' + lch[1].toFixed(3) + ' ' + lch[2].toFixed(1) + ')';
  }

  /* ── WCAG 2.x ───────────────────────────────────────────── */

  function luminance(hex) {
    var c = hexToRgb(hex);
    return 0.2126 * srgbToLinear(c[0]) + 0.7152 * srgbToLinear(c[1]) + 0.0722 * srgbToLinear(c[2]);
  }

  function contrast(hex1, hex2) {
    var l1 = luminance(hex1), l2 = luminance(hex2);
    var light = Math.max(l1, l2), dark = Math.min(l1, l2);
    return (light + 0.05) / (dark + 0.05);
  }

  /** WCAG level for normal-size text. */
  function wcagLevel(ratio) {
    return ratio >= 7 ? 'AAA' : (ratio >= 4.5 ? 'AA' : 'FAIL');
  }

  /** '#000000' or '#ffffff' — whichever reads better on the given color. */
  function bestTextOn(hex) {
    return contrast('#000000', hex) >= contrast('#ffffff', hex) ? '#000000' : '#ffffff';
  }

  /* ── Palette model ──────────────────────────────────────── */

  var TOKENS = ['bgLight', 'textPrimary', 'primary', 'accent1', 'bgDark'];

  var TOKEN_INFO = {
    bgLight:     { label: 'Background',     hint: 'Pages & cards',            cssVar: '--bg-light' },
    textPrimary: { label: 'Text',           hint: 'Headings & body copy',     cssVar: '--text-primary' },
    primary:     { label: 'Primary',        hint: 'Buttons, links, focus',    cssVar: '--primary' },
    accent1:     { label: 'Accent',         hint: 'CTAs & highlights',        cssVar: '--accent-1' },
    bgDark:      { label: 'Dark surface',   hint: 'Dark sections & footers',  cssVar: '--bg-dark' }
  };

  /** Coerce any object into a valid palette, or null if unusable. */
  function sanitizePalette(obj) {
    if (!obj || typeof obj !== 'object') return null;
    var out = {};
    for (var i = 0; i < TOKENS.length; i++) {
      var hex = normalizeHex(obj[TOKENS[i]]);
      if (!hex) return null;
      out[TOKENS[i]] = hex;
    }
    return out;
  }

  /* ── Curated presets (every one verified in unit tests) ─── */

  var PRESETS = [
    { id: 'professional', name: 'Professional',
      colors: { bgLight: '#f4f4f6', textPrimary: '#1d1d1f', primary: '#0057ad', accent1: '#c20043', bgDark: '#000000' } },
    { id: 'bndr', name: 'BNDR',
      colors: { bgLight: '#e8e4df', textPrimary: '#0a0a0b', primary: '#3b6b00', accent1: '#c2003f', bgDark: '#020202' } },
    { id: 'editorial', name: 'Editorial',
      colors: { bgLight: '#f4f1ea', textPrimary: '#141412', primary: '#40551b', accent1: '#a33200', bgDark: '#0a0a09' } },
    { id: 'ocean', name: 'Ocean',
      colors: { bgLight: '#eef4f4', textPrimary: '#0c2430', primary: '#00688c', accent1: '#9b2c5e', bgDark: '#04141c' } },
    { id: 'terra', name: 'Terra',
      colors: { bgLight: '#f6f0e8', textPrimary: '#2a1c10', primary: '#8a4500', accent1: '#5f6c00', bgDark: '#140d06' } },
    { id: 'noir', name: 'Noir',
      colors: { bgLight: '#efeff1', textPrimary: '#111114', primary: '#3d3d8f', accent1: '#8f003d', bgDark: '#060608' } }
  ];

  /* ── WCAG enforcement (bidirectional; minimal shift) ──────
     v1 only ever darkened tokens, which failed on dark
     backgrounds. This walks lightness AWAY from the background
     lightness in small steps until the target ratio is met,
     trimming chroma if the gamut clips.                        */

  function fitContrast(hex, bgHex, target) {
    if (contrast(hex, bgHex) >= target) return { hex: normalizeHex(hex), ok: true };
    var lch = hexToOklch(hex);
    var L = lch[0], C = lch[1], H = lch[2];
    var darkenFirst = luminance(bgHex) >= 0.5; // light bg → push token darker
    var dirs = darkenFirst ? [-1, 1] : [1, -1];
    for (var d = 0; d < dirs.length; d++) {
      var dir = dirs[d];
      var l = L, c = C;
      for (var i = 0; i < 120; i++) {
        l = l + dir * 0.008;
        if (l < 0.02 || l > 0.995) { // out of headroom: also shed chroma
          c = Math.max(0, c - 0.02);
          l = Math.max(0.02, Math.min(0.995, l));
          if (c <= 0 && (l <= 0.02 || l >= 0.995)) break;
        }
        var candidate = oklchToHex(l, c, H);
        if (contrast(candidate, bgHex) >= target) {
          return { hex: candidate, ok: true };
        }
      }
    }
    // absolute fallback: black or white, whichever wins
    var bw = bestTextOn(bgHex);
    return { hex: bw, ok: contrast(bw, bgHex) >= target };
  }

  /**
   * Enforce WCAG on a palette: text ≥7:1, primary/accent ≥4.5:1
   * against bgLight. Returns { palette, failed: [tokenNames] }.
   */
  function enforceWCAG(pal) {
    var p = sanitizePalette(pal);
    if (!p) return { palette: null, failed: TOKENS.slice() };
    var failed = [];
    var jobs = [['textPrimary', 7], ['primary', 4.5], ['accent1', 4.5]];
    for (var i = 0; i < jobs.length; i++) {
      var token = jobs[i][0], target = jobs[i][1];
      var res = fitContrast(p[token], p.bgLight, target);
      p[token] = res.hex;
      if (!res.ok) failed.push(token);
    }
    return { palette: p, failed: failed };
  }

  /* ── Generation ─────────────────────────────────────────── */

  function randomPalette(rng, locks, current) {
    rng = rng || Math.random;
    var baseH = rng() * 360;
    var pal = {
      bgLight:     oklchToHex(0.955, 0.02 + rng() * 0.015, (baseH + 20) % 360),
      textPrimary: oklchToHex(0.17, 0.03, (baseH + 180) % 360),
      primary:     oklchToHex(0.55 + rng() * 0.1, 0.16 + rng() * 0.06, baseH),
      accent1:     oklchToHex(0.55 + rng() * 0.1, 0.16 + rng() * 0.06, (baseH + 120 + rng() * 90) % 360),
      bgDark:      oklchToHex(0.13, 0.015 + rng() * 0.02, (baseH + 200) % 360)
    };
    if (locks && current) {
      for (var i = 0; i < TOKENS.length; i++) {
        if (locks[TOKENS[i]]) pal[TOKENS[i]] = current[TOKENS[i]];
      }
    }
    return enforceWCAG(pal).palette;
  }

  /** Rotate every unlocked hue by `shift` degrees (v1 "Harmony"). */
  function rotateHues(pal, shift, locks) {
    var p = sanitizePalette(pal);
    if (!p) return null;
    var out = {};
    for (var i = 0; i < TOKENS.length; i++) {
      var t = TOKENS[i];
      if (locks && locks[t]) { out[t] = p[t]; continue; }
      var lch = hexToOklch(p[t]);
      out[t] = oklchToHex(lch[0], lch[1], (lch[2] + shift) % 360);
    }
    return out;
  }

  /* ── Shade ramps (50–950, 11 steps) ─────────────────────── */

  var RAMP_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  var RAMP_L =     [0.975, 0.94, 0.885, 0.815, 0.735, 0.645, 0.555, 0.465, 0.37, 0.275, 0.205];

  /** 11-step tonal scale that keeps the color's hue; chroma eases
      toward 0 at both extremes so ends stay printable/neutral.   */
  function ramp(hex) {
    var lch = hexToOklch(hex);
    var C = lch[1], H = lch[2];
    var steps = [];
    for (var i = 0; i < RAMP_STEPS.length; i++) {
      var L = RAMP_L[i];
      // chroma bell: full near mid, tapered at the ends
      var t = 1 - Math.abs(i - 5) / 5.5;
      var c = Math.min(C, C * (0.35 + 0.65 * t));
      steps.push({ step: RAMP_STEPS[i], hex: oklchToHex(L, c, H) });
    }
    return steps;
  }

  /* ── Color-blindness simulation matrices ──────────────────
     Machado, Oliveira & Fernandes (2009), severity 1.0 —
     the matrices commonly used for full-dichromacy simulation.
     Applied via SVG feColorMatrix in the UI.                   */

  var CVD_MATRICES = {
    none: null,
    protanopia: [
      0.152286, 1.052583, -0.204868,
      0.114503, 0.786281, 0.099216,
      -0.003882, -0.048116, 1.051998
    ],
    deuteranopia: [
      0.367322, 0.860646, -0.227968,
      0.280085, 0.672501, 0.047413,
      -0.011820, 0.042940, 0.968881
    ],
    tritanopia: [
      1.255528, -0.076749, -0.178779,
      -0.078411, 0.930809, 0.147602,
      0.004733, 0.691367, 0.303900
    ],
    achromatopsia: [
      0.2126, 0.7152, 0.0722,
      0.2126, 0.7152, 0.0722,
      0.2126, 0.7152, 0.0722
    ]
  };

  /** feColorMatrix "values" string (4×5 matrix) for a CVD type. */
  function cvdFilterValues(type) {
    var m = CVD_MATRICES[type];
    if (!m) return null;
    return [
      m[0], m[1], m[2], 0, 0,
      m[3], m[4], m[5], 0, 0,
      m[6], m[7], m[8], 0, 0,
      0, 0, 0, 1, 0
    ].join(' ');
  }

  /* ── Image → palette (median cut) ───────────────────────── */

  /**
   * pixels: flat RGBA Uint8ClampedArray. Returns `count` dominant
   * colors as hex, most-populous box first.
   */
  function quantize(pixels, count) {
    count = count || 5;
    var pts = [];
    for (var i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue; // skip transparent
      pts.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
    }
    if (!pts.length) return [];
    var boxes = [pts];
    while (boxes.length < count) {
      // split the box with the largest channel range
      var bestIdx = -1, bestRange = -1, bestCh = 0;
      for (var b = 0; b < boxes.length; b++) {
        if (boxes[b].length < 2) continue;
        for (var ch = 0; ch < 3; ch++) {
          var mn = 255, mx = 0;
          for (var p = 0; p < boxes[b].length; p++) {
            var v = boxes[b][p][ch];
            if (v < mn) mn = v;
            if (v > mx) mx = v;
          }
          if (mx - mn > bestRange) { bestRange = mx - mn; bestIdx = b; bestCh = ch; }
        }
      }
      if (bestIdx < 0 || bestRange <= 4) break;
      var box = boxes.splice(bestIdx, 1)[0];
      box.sort(function (a, b2) { return a[bestCh] - b2[bestCh]; });
      // split at the middle of the VALUE range (mean-cut): keeps distinct
      // clusters pure instead of averaging them into mud
      var midValue = (box[0][bestCh] + box[box.length - 1][bestCh]) / 2;
      var mid = box.findIndex(function (pt) { return pt[bestCh] > midValue; });
      if (mid <= 0 || mid >= box.length) mid = box.length >> 1;
      boxes.push(box.slice(0, mid), box.slice(mid));
    }
    boxes.sort(function (a, b3) { return b3.length - a.length; });
    return boxes.map(function (bx) {
      var r = 0, g = 0, bl = 0;
      for (var j = 0; j < bx.length; j++) { r += bx[j][0]; g += bx[j][1]; bl += bx[j][2]; }
      var n = bx.length || 1;
      return rgbToHex(r / n, g / n, bl / n);
    }).slice(0, count);
  }

  /**
   * Map extracted swatches onto the 5 token roles:
   * lightest→bgLight, darkest→bgDark, most chromatic→primary,
   * next distinct chroma→accent1, textPrimary derived dark.
   * Always returns a WCAG-enforced palette.
   */
  function paletteFromSwatches(hexes) {
    if (!hexes || !hexes.length) return null;
    var info = hexes.map(function (h) {
      var lch = hexToOklch(h);
      return { hex: h, L: lch[0], C: lch[1], H: lch[2] };
    });
    var byL = info.slice().sort(function (a, b) { return b.L - a.L; });
    var lightest = byL[0], darkest = byL[byL.length - 1];
    var byC = info.slice().sort(function (a, b) { return b.C - a.C; });
    var prim = byC[0] || lightest;
    var accent = null;
    for (var i = 1; i < byC.length; i++) {
      var dh = Math.abs(((byC[i].H - prim.H + 540) % 360) - 180); // 0..180 hue distance
      if (dh > 40 && byC[i].C > 0.03) { accent = byC[i]; break; }
    }
    if (!accent) accent = byC[1] || prim;
    var pal = {
      bgLight: oklchToHex(Math.max(0.93, lightest.L), Math.min(0.035, lightest.C), lightest.H),
      textPrimary: oklchToHex(Math.min(0.22, Math.max(0.14, darkest.L)), Math.min(0.05, darkest.C), darkest.H),
      primary: oklchToHex(Math.min(0.68, Math.max(0.45, prim.L)), Math.max(0.12, prim.C), prim.H),
      accent1: oklchToHex(Math.min(0.68, Math.max(0.45, accent.L)), Math.max(0.1, accent.C), accent.H),
      bgDark: oklchToHex(0.13, Math.min(0.03, darkest.C), darkest.H)
    };
    return enforceWCAG(pal).palette;
  }

  return {
    normalizeHex: normalizeHex,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    hexToOklch: hexToOklch,
    oklchToHex: oklchToHex,
    hexToRgbString: hexToRgbString,
    hexToHslString: hexToHslString,
    hexToOklchString: hexToOklchString,
    luminance: luminance,
    contrast: contrast,
    wcagLevel: wcagLevel,
    bestTextOn: bestTextOn,
    TOKENS: TOKENS,
    TOKEN_INFO: TOKEN_INFO,
    PRESETS: PRESETS,
    sanitizePalette: sanitizePalette,
    fitContrast: fitContrast,
    enforceWCAG: enforceWCAG,
    randomPalette: randomPalette,
    rotateHues: rotateHues,
    RAMP_STEPS: RAMP_STEPS,
    ramp: ramp,
    CVD_MATRICES: CVD_MATRICES,
    cvdFilterValues: cvdFilterValues,
    quantize: quantize,
    paletteFromSwatches: paletteFromSwatches
  };
});
