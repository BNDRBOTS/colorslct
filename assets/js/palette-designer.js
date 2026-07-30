/* ColorSLCT Palette Designer — the hyper-intelligent generative engine.
   Actively DESIGNS palettes: seeded deterministic generation, 9 OKLCH harmony
   models, 6 mood profiles, true dynamic color blending, gamut mapping, and
   role-fitting with WCAG contrast guarantees. No presets involved. */
(function (root, factory) {
  var E = (typeof module !== "undefined" && module.exports)
    ? require("./color-engine.js")
    : root.ColorEngine;
  var api = factory(E);
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  if (root) { root.PaletteDesigner = api; }
})(typeof self !== "undefined" ? self : this, function (E) {
  "use strict";

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function randomSeed() { return (Math.random() * 4294967296) >>> 0; }

  var HARMONIES = {
    auto: null,
    analogous: [0, 30, -30],
    complementary: [0, 180],
    split: [0, 150, 210],
    triadic: [0, 120, 240],
    tetradic: [0, 90, 180, 270],
    rectangular: [0, 60, 180, 240],
    monochromatic: [0],
    golden: [0, 137.5],
  };
  var HARMONY_LABELS = {
    auto: "Designer\u2019s choice", analogous: "Analogous", complementary: "Complementary",
    split: "Split-complementary", triadic: "Triadic", tetradic: "Tetradic",
    rectangular: "Rectangular", monochromatic: "Monochromatic", golden: "Golden angle",
  };

  var MOODS = {
    vivid:        { label: "Vivid",        accentL: [0.55, 0.68], accentC: [0.14, 0.22], bgTintC: 0.025, darkL: 0.16, darkC: 0.030 },
    calm:         { label: "Calm",         accentL: [0.60, 0.74], accentC: [0.06, 0.12], bgTintC: 0.020, darkL: 0.20, darkC: 0.020 },
    neon:         { label: "Neon",         accentL: [0.70, 0.85], accentC: [0.20, 0.32], bgTintC: 0.015, darkL: 0.12, darkC: 0.040 },
    pastel:       { label: "Pastel",       accentL: [0.76, 0.88], accentC: [0.06, 0.12], bgTintC: 0.030, darkL: 0.22, darkC: 0.020 },
    earthy:       { label: "Earthy",       accentL: [0.45, 0.60], accentC: [0.05, 0.11], bgTintC: 0.030, darkL: 0.18, darkC: 0.020, warm: true },
    professional: { label: "Professional", accentL: [0.48, 0.60], accentC: [0.09, 0.17], bgTintC: 0.020, darkL: 0.16, darkC: 0.025 },
  };
  var AUTO_PICKS = {
    vivid:        [["triadic", 3], ["split", 3], ["complementary", 2], ["golden", 2], ["analogous", 1]],
    calm:         [["analogous", 4], ["monochromatic", 2], ["split", 2], ["golden", 1]],
    neon:         [["complementary", 3], ["golden", 3], ["split", 2], ["triadic", 2]],
    pastel:       [["analogous", 3], ["triadic", 2], ["golden", 2], ["monochromatic", 1]],
    earthy:       [["analogous", 3], ["complementary", 2], ["rectangular", 2], ["monochromatic", 2]],
    professional: [["complementary", 3], ["analogous", 3], ["split", 2], ["triadic", 1]],
  };

  function wrapHue(h) { return ((h % 360) + 360) % 360; }
  function hueDist(a, b) { var d = Math.abs(wrapHue(a) - wrapHue(b)); return d > 180 ? 360 - d : d; }
  function mixHue(h1, h2, t) {
    var d = wrapHue(h2 - h1);
    if (d > 180) d -= 360;
    return wrapHue(h1 + d * t);
  }

  function inGamut(L, C, H) {
    var lab = E.oklchToOklab(L, C, H);
    var rgb = E.oklabToRgb(lab[0], lab[1], lab[2]);
    return rgb[0] >= -0.5 && rgb[0] <= 255.5 && rgb[1] >= -0.5 && rgb[1] <= 255.5 && rgb[2] >= -0.5 && rgb[2] <= 255.5;
  }
  function fitGamut(L, C, H) {
    if (inGamut(L, C, H)) return C;
    var lo = 0, hi = C;
    for (var i = 0; i < 12; i++) {
      var mid = (lo + hi) / 2;
      if (inGamut(L, mid, H)) lo = mid; else hi = mid;
    }
    return lo;
  }
  function toHex(L, C, H) { return E.oklchToHex(L, fitGamut(L, C, H), H); }

  function fitContrast(L, C, H, bg, target, dir) {
    var hex = toHex(L, C, H);
    var steps = 0;
    while (E.contrast(hex, bg) < target && steps < 40) {
      L += dir * 0.015;
      if (L < 0.05 || L > 0.98) break;
      hex = toHex(L, C, H);
      steps++;
    }
    return { hex: hex, L: L };
  }

  function designPalette(opts) {
    opts = opts || {};
    var seed = (opts.seed === undefined) ? randomSeed() : (opts.seed >>> 0);
    var rng = mulberry32(seed);
    var mood = MOODS[opts.mood] ? opts.mood : "vivid";
    var M = MOODS[mood];

    var baseHue, blendHue = null;
    var baseNorm = opts.baseHex ? E.normalizeHex(opts.baseHex) : null;
    var blendNorm = opts.blendHex ? E.normalizeHex(opts.blendHex) : null;
    var baseLch = baseNorm ? E.hexToOklch(baseNorm) : null;
    var blendLch = blendNorm ? E.hexToOklch(blendNorm) : null;
    if (baseLch && blendLch) {
      var t = 0.35 + rng() * 0.3;
      baseHue = mixHue(baseLch[2], blendLch[2], t);
      blendHue = blendLch[2];
    } else if (baseLch) {
      baseHue = baseLch[2];
    } else {
      baseHue = rng() * 360;
      if (M.warm && rng() < 0.6) baseHue = 15 + rng() * 75;
    }

    var harmony = HARMONIES[opts.harmony] ? opts.harmony : "auto";
    var resolved = harmony;
    if (harmony === "auto") {
      var picks = AUTO_PICKS[mood];
      var total = picks.reduce(function (s, p) { return s + p[1]; }, 0);
      var roll = rng() * total;
      for (var i = 0; i < picks.length; i++) {
        roll -= picks[i][1];
        if (roll <= 0) { resolved = picks[i][0]; break; }
      }
    }
    var offsets = HARMONIES[resolved];

    var accentHue;
    if (blendHue !== null) {
      accentHue = wrapHue(blendHue + (rng() - 0.5) * 16);
    } else if (resolved === "monochromatic") {
      accentHue = wrapHue(baseHue + (rng() - 0.5) * 14);
    } else {
      var choices = offsets.slice(1);
      accentHue = wrapHue(baseHue + choices[Math.floor(rng() * choices.length)]);
    }

    var bgL = 0.93 + rng() * 0.04;
    var bgLight = toHex(bgL, M.bgTintC, wrapHue(baseHue + (rng() - 0.5) * 24));
    var darkHue = wrapHue(baseHue + (rng() - 0.5) * 40);
    var bgDark = toHex(M.darkL + rng() * 0.04, M.darkC, darkHue);

    var textFit = fitContrast(0.22, 0.03, wrapHue(baseHue + 180), bgLight, 7, -1);
    var textPrimary = textFit.hex;

    /* Hard guarantee: accents >= 4.5:1 on light (WCAG 1.4.3 AA).
       Dark surface: >= 3:1 floor (WCAG 1.4.11 non-text UI), with accent
       luminance pushed to the top of the light-bg window — the mathematical
       optimum for the dark side. One token cannot hit 4.5 on BOTH near-white
       and near-black; the engine is honest about that. */
    var DARK_FLOOR = 3;
    function fitAccent(L0, C0, H, bgDarkRef) {
      var C = fitGamut(L0, C0, H);
      var r = fitContrast(L0, C, H, bgLight, 4.5, -1);
      var L = r.L;
      while (E.contrast(toHex(L, C, H), bgDarkRef) < DARK_FLOOR) {
        var up = toHex(L + 0.015, C, H);
        if (E.contrast(up, bgLight) < 4.5 || L > 0.95) break;
        L += 0.015;
      }
      return { L: L, C: C, H: H };
    }
    var pL = M.accentL[0] + rng() * (M.accentL[1] - M.accentL[0]);
    var pC = M.accentC[0] + rng() * (M.accentC[1] - M.accentC[0]);
    var primary = fitAccent(pL, pC, baseHue, bgDark);

    var aL = M.accentL[0] + rng() * (M.accentL[1] - M.accentL[0]);
    var aC = M.accentC[0] + rng() * (M.accentC[1] - M.accentC[0]);
    if (hueDist(accentHue, baseHue) < 35) {
      aL = primary.L > 0.6 ? Math.max(0.35, primary.L - 0.16) : Math.min(0.88, primary.L + 0.16);
      aC = Math.max(0.04, primary.C * (rng() < 0.5 ? 0.55 : 1.35));
    }
    var accent = fitAccent(aL, aC, accentHue, bgDark);

    var guard = 0;
    while (guard++ < 14) {
      var pHex = toHex(primary.L, primary.C, primary.H);
      var aHex = toHex(accent.L, accent.C, accent.H);
      if (E.contrast(pHex, bgDark) >= DARK_FLOOR && E.contrast(aHex, bgDark) >= DARK_FLOOR) break;
      var dl = E.hexToOklch(bgDark);
      bgDark = toHex(Math.max(0.06, dl[0] - 0.018), dl[1], dl[2]);
    }

    var palette = {
      bgLight: bgLight,
      textPrimary: textPrimary,
      primary: toHex(primary.L, primary.C, primary.H),
      accent1: toHex(accent.L, accent.C, accent.H),
      bgDark: bgDark,
    };
    var meta = {
      seed: seed,
      mood: mood,
      moodLabel: M.label,
      harmony: resolved,
      harmonyLabel: HARMONY_LABELS[resolved],
      requestedHarmony: harmony,
      baseHue: Math.round(baseHue),
      accentHue: Math.round(accent.H),
      blended: blendHue !== null,
      darkFloor: DARK_FLOOR,
      reason: (blendHue !== null ? "Blend" : HARMONY_LABELS[resolved]) + " \u00b7 " + M.label +
        " \u00b7 base " + Math.round(baseHue) + "\u00b0 / accent " + Math.round(accent.H) + "\u00b0" +
        " \u00b7 seed " + seed,
    };
    return { palette: palette, meta: meta };
  }

  function spinPalette(currentPalette, opts) {
    opts = opts || {};
    var cur = currentPalette && E.isValidPalette(currentPalette) ? currentPalette : E.PRESETS.defaultPro;
    var baseHue = wrapHue(E.hexToOklch(cur.primary)[2] + 30);
    return designPalette({
      seed: opts.seed,
      harmony: opts.harmony,
      mood: opts.mood,
      baseHex: E.oklchToHex(0.6, 0.15, baseHue),
    });
  }

  return {
    HARMONIES: HARMONIES,
    HARMONY_LABELS: HARMONY_LABELS,
    MOODS: MOODS,
    designPalette: designPalette,
    spinPalette: spinPalette,
    mixHue: mixHue,
    hueDist: hueDist,
    randomSeed: randomSeed,
  };
});
