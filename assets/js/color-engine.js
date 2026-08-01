/* ColorSLCT Color Engine — OKLCH math, WCAG contrast, palette codecs & exporters.
   Preserves the verified conversion matrices from ColorSLCT v1. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  if (root) { root.ColorEngine = api; }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- hex helpers ---------- */
  function normalizeHex(input) {
    if (typeof input !== "string") return null;
    var c = input.trim().replace(/^#/, "").toLowerCase();
    if (/^[0-9a-f]{3}$/.test(c)) {
      c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    }
    if (!/^[0-9a-f]{6}$/.test(c)) return null;
    return "#" + c;
  }

  function hexToRgb(hex) {
    var c = normalizeHex(hex);
    if (!c) return [0, 0, 0];
    c = c.slice(1);
    return [
      parseInt(c.substring(0, 2), 16),
      parseInt(c.substring(2, 4), 16),
      parseInt(c.substring(4, 6), 16),
    ];
  }

  function rgbToHex(r, g, b) {
    return (
      "#" +
      [r, g, b].map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"); }).join("")
    );
  }

  /* ---------- sRGB <-> linear ---------- */
  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(c) {
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }

  /* ---------- Oklab / Oklch (verified matrices, preserved) ---------- */
  function rgbToOklab(r, g, b) {
    var lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
    var l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    var m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    var s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
    l = Math.cbrt(l); m = Math.cbrt(m); s = Math.cbrt(s);
    return [
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
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
      Math.round(Math.max(0, Math.min(1, linearToSrgb(lb))) * 255),
    ];
  }

  function oklabToOklch(L, a, b) {
    var C = Math.sqrt(a * a + b * b);
    var h = (Math.atan2(b, a) * 180) / Math.PI;
    if (h < 0) h += 360;
    return [L, C, h];
  }

  function oklchToOklab(L, C, h) {
    var rad = (h * Math.PI) / 180;
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

  /* ---------- WCAG ---------- */
  function luminance(hex) {
    var rgb = hexToRgb(hex);
    var rs = srgbToLinear(rgb[0]), gs = srgbToLinear(rgb[1]), bs = srgbToLinear(rgb[2]);
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  function contrast(hex1, hex2) {
    var l1 = luminance(hex1), l2 = luminance(hex2);
    var light = Math.max(l1, l2), dark = Math.min(l1, l2);
    return (light + 0.05) / (dark + 0.05);
  }

  function wcagLevel(ratio) {
    return ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : "FAIL";
  }

  /* Best-readable text color (fixes v1 hardcoded #000 on primary buttons) */
  function idealTextColor(bgHex) {
    return contrast("#000000", bgHex) >= contrast("#ffffff", bgHex) ? "#000000" : "#ffffff";
  }

  /* ---------- Token model & presets (preserved) ---------- */
  var TOKENS = ["bgLight", "textPrimary", "primary", "accent1", "bgDark"];
  var TOKEN_INFO = {
    bgLight: { label: "Background Light", hint: "Page & card backgrounds", cssVar: "--bg-light" },
    textPrimary: { label: "Text / Foreground", hint: "Primary text, headings", cssVar: "--text-primary" },
    primary: { label: "Primary Accent", hint: "Buttons, links, active UI", cssVar: "--primary" },
    accent1: { label: "Secondary Accent", hint: "CTAs, warnings, highlights", cssVar: "--accent-1" },
    bgDark: { label: "Background Dark / Void", hint: "Dark sections, deepest shadows", cssVar: "--bg-dark" },
  };
  function isValidPalette(pal) {
    if (!pal || typeof pal !== "object") return false;
    return TOKENS.every(function (t) { return normalizeHex(pal[t]) !== null; });
  }

  function cleanPalette(pal) {
    var out = {};
    TOKENS.forEach(function (t) { out[t] = normalizeHex(pal[t]); });
    return out;
  }

  /* ---------- share-link codec ---------- */
  function encodePalette(pal) {
    return TOKENS.map(function (t) { return normalizeHex(pal[t]).slice(1); }).join("-");
  }
  function decodePalette(str) {
    if (typeof str !== "string") return null;
    var parts = str.trim().split("-");
    if (parts.length !== TOKENS.length) return null;
    var pal = {};
    for (var i = 0; i < TOKENS.length; i++) {
      var hex = normalizeHex(parts[i]);
      if (!hex) return null;
      pal[TOKENS[i]] = hex;
    }
    return pal;
  }

  /* ---------- exporters ---------- */
  var EXPORT_FORMATS = [
    { id: "css", label: "CSS", pro: false, filename: "colorslct-tokens.css" },
    { id: "scss", label: "SCSS", pro: true, filename: "colorslct-tokens.scss" },
    { id: "tailwind", label: "Tailwind", pro: true, filename: "colorslct-tailwind.js" },
    { id: "json", label: "JSON Tokens", pro: true, filename: "colorslct-tokens.json" },
    { id: "svg", label: "SVG Card", pro: true, filename: "colorslct-palette.svg" },
  ];

  function exportCss(p) {
    return ":root {\n  --bg-light: " + p.bgLight + ";\n  --text-primary: " + p.textPrimary +
      ";\n  --primary: " + p.primary + ";\n  --accent-1: " + p.accent1 + ";\n  --bg-dark: " + p.bgDark + ";\n}";
  }

  function exportScss(p) {
    return "$bg-light: " + p.bgLight + ";\n$text-primary: " + p.textPrimary + ";\n$primary: " + p.primary +
      ";\n$accent-1: " + p.accent1 + ";\n$bg-dark: " + p.bgDark + ";\n";
  }

  function exportTailwind(p) {
    return "/** ColorSLCT tokens — merge into tailwind.config.js */\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n        'bg-light': '" + p.bgLight + "',\n        'text-primary': '" + p.textPrimary + "',\n        primary: '" + p.primary + "',\n        'accent-1': '" + p.accent1 + "',\n        'bg-dark': '" + p.bgDark + "',\n      },\n    },\n  },\n};\n";
  }

  function exportJson(p) {
    var tokens = {};
    TOKENS.forEach(function (t) {
      tokens[t] = { $type: "color", $value: p[t], $description: TOKEN_INFO[t].hint };
    });
    return JSON.stringify({ $schema: "https://design-tokens.github.io/community-group/format/", colorslct: tokens }, null, 2);
  }

  function exportSvg(p) {
    var sw = 120, h = 160, pad = 0;
    var rects = TOKENS.map(function (t, i) {
      var x = pad + i * sw;
      var textCol = idealTextColor(p[t]);
      return '<rect x="' + x + '" y="0" width="' + sw + '" height="' + h + '" fill="' + p[t] + '"/>' +
        '<text x="' + (x + 10) + '" y="' + (h - 14) + '" font-family="monospace" font-size="13" fill="' + textCol + '">' + p[t] + "</text>";
    }).join("");
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + (sw * TOKENS.length) + '" height="' + h + '" viewBox="0 0 ' + (sw * TOKENS.length) + " " + h + '" role="img" aria-label="ColorSLCT palette">' + rects + "</svg>";
  }

  function exportAs(formatId, palette) {
    var p = cleanPalette(palette);
    switch (formatId) {
      case "css": return exportCss(p);
      case "scss": return exportScss(p);
      case "tailwind": return exportTailwind(p);
      case "json": return exportJson(p);
      case "svg": return exportSvg(p);
      default: return exportCss(p);
    }
  }

  return {
    normalizeHex: normalizeHex,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    srgbToLinear: srgbToLinear,
    linearToSrgb: linearToSrgb,
    rgbToOklab: rgbToOklab,
    oklabToRgb: oklabToRgb,
    oklabToOklch: oklabToOklch,
    oklchToOklab: oklchToOklab,
    hexToOklch: hexToOklch,
    oklchToHex: oklchToHex,
    luminance: luminance,
    contrast: contrast,
    wcagLevel: wcagLevel,
    idealTextColor: idealTextColor,
    TOKENS: TOKENS,
    TOKEN_INFO: TOKEN_INFO,
    isValidPalette: isValidPalette,
    cleanPalette: cleanPalette,
    encodePalette: encodePalette,
    decodePalette: decodePalette,
    EXPORT_FORMATS: EXPORT_FORMATS,
    exportAs: exportAs,
  };
});
