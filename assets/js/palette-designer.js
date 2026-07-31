/* ColorSLCT Palette Designer v3 — a generative OKLCH engine, not a preset picker.
   What it does on every run:
   1. Measures the real sRGB gamut boundary (the "cusp") for each hue it considers,
      so chroma is sampled as a fraction of what that hue can physically deliver.
      (v2 sampled fixed chroma numbers and its gamut test was broken — the engine's
      oklabToRgb clamps channels, so every color "passed" and clipping did the work.)
   2. Picks a base hue via candidate scoring against a memory of recent hues,
      so back-to-back generations spread across the wheel instead of clustering.
   3. Draws structure decisions from the seeded RNG — including a surface
      personality for BOTH backgrounds (porcelain/tinted/pigment paper on the
      light side, ink/charcoal/pigment on the dark side), hue anchors, and
      which accent carries the volume — giving each palette its own
      construction, not one recipe with new numbers.
      (v3.0 locked bgLight to L 0.925-0.97 and bgDark to a muted near-black,
      which is why every palette shipped the same near-white paper and the
      same maroon/forest/navy dark. v3.1 treats both surfaces as design
      decisions in their own right.)
   4. Applies a per-mood contrast policy. Neon is dark-surface-first: accents ride
      the gamut ceiling and are guaranteed >= 4.5:1 against the dark background,
      because a fluorescent color that also hits 4.5:1 on near-white cannot exist.
      Every other mood guarantees accents >= 4.5:1 on the light background and
      >= 3:1 on the dark one. Text is always >= 7:1 on the light background. */
(function (root, factory) {
  var E = (typeof module !== "undefined" && module.exports)
    ? require("./color-engine.js")
    : root.ColorEngine;
  var api = factory(E);
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  if (root) { root.PaletteDesigner = api; }
})(typeof self !== "undefined" ? self : this, function (E) {
  "use strict";

  /* ---------- seeded RNG (deterministic when a seed is supplied) ---------- */
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

  /* ---------- hue math ---------- */
  function wrapHue(h) { return ((h % 360) + 360) % 360; }
  function hueDist(a, b) { var d = Math.abs(wrapHue(a) - wrapHue(b)); return d > 180 ? 360 - d : d; }
  function mixHue(h1, h2, t) {
    var d = wrapHue(h2 - h1);
    if (d > 180) d -= 360;
    return wrapHue(h1 + d * t);
  }

  /* ---------- true gamut boundary (unclamped OKLCH -> linear sRGB) ----------
     The engine's oklabToRgb clamps channels, which makes it useless as a gamut
     test. This is the same Oklab math without the clamp. */
  function oklchInGamut(L, C, H) {
    var rad = (H * Math.PI) / 180;
    var a = C * Math.cos(rad), b = C * Math.sin(rad);
    var l = L + 0.3963377774 * a + 0.2158037573 * b;
    var m = L - 0.1055613458 * a - 0.0638541728 * b;
    var s = L - 0.0894841775 * a - 1.2914855480 * b;
    l = l * l * l; m = m * m * m; s = s * s * s;
    var lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    var lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    var lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
    var eps = 0.0005;
    return lr >= -eps && lr <= 1 + eps && lg >= -eps && lg <= 1 + eps && lb >= -eps && lb <= 1 + eps;
  }

  /* Max chroma available at a given lightness + hue. */
  function maxChroma(L, H) {
    if (!oklchInGamut(L, 0, H)) return 0;
    var lo = 0, hi = 0.42;
    for (var i = 0; i < 18; i++) {
      var mid = (lo + hi) / 2;
      if (oklchInGamut(L, mid, H)) lo = mid; else hi = mid;
    }
    return lo;
  }

  /* The cusp: the (L, C) pair where this hue is at its most saturated.
     Cached per whole degree — the scan is not free. */
  var cuspCache = {};
  function findCusp(H) {
    var key = Math.round(wrapHue(H));
    if (cuspCache[key]) return cuspCache[key];
    var bestL = 0.6, bestC = 0;
    for (var L = 0.28; L <= 0.94; L += 0.045) {
      var c = maxChroma(L, key);
      if (c > bestC) { bestC = c; bestL = L; }
    }
    for (var L2 = Math.max(0.2, bestL - 0.05); L2 <= Math.min(0.96, bestL + 0.05); L2 += 0.01) {
      var c2 = maxChroma(L2, key);
      if (c2 > bestC) { bestC = c2; bestL = L2; }
    }
    var cusp = { L: bestL, C: bestC };
    cuspCache[key] = cusp;
    return cusp;
  }

  function toHex(L, C, H) {
    var fitted = Math.min(C, maxChroma(L, H));
    return E.oklchToHex(L, fitted, H);
  }

  /* ---------- harmonies ---------- */
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

  /* ---------- moods ----------
     chromaFrac: accent chroma as a fraction of the hue's true gamut ceiling.
     accentL: lightness window for accents (neon overrides toward the cusp).
     contrastRef: which background the 4.5:1 accent guarantee targets.
     bgPersona / darkPersona: probability weights for two of the surface
     personalities (porcelain/tinted for the light side, ink/charcoal for
     the dark side); whatever remains goes to the pigment persona. */
  var MOODS = {
    vivid: {
      label: "Vivid", contrastRef: "light",
      chromaFrac: [0.78, 0.95], accentL: [0.52, 0.66],
      bgPersona: [0.28, 0.42], darkPersona: [0.30, 0.35],
      darkL: [0.15, 0.20], darkChroma: [0.015, 0.045],
    },
    calm: {
      label: "Calm", contrastRef: "light",
      chromaFrac: [0.24, 0.42], accentL: [0.56, 0.70],
      bgPersona: [0.30, 0.45], darkPersona: [0.35, 0.40],
      darkL: [0.19, 0.24], darkChroma: [0.010, 0.030],
    },
    neon: {
      label: "Neon", contrastRef: "dark",
      chromaFrac: [0.96, 1.0], accentL: null, /* rides the cusp */
      bgPersona: [0.45, 0.35], darkPersona: [0.40, 0.35],
      darkL: [0.10, 0.14], darkChroma: [0.020, 0.055],
      hueWeightByChroma: true,
    },
    pastel: {
      label: "Pastel", contrastRef: "light",
      chromaFrac: [0.45, 0.75], accentL: [0.78, 0.88],
      bgPersona: [0.10, 0.38], darkPersona: [0.35, 0.40],
      darkL: [0.20, 0.25], darkChroma: [0.012, 0.032],
      softText: true,
    },
    earthy: {
      label: "Earthy", contrastRef: "light",
      chromaFrac: [0.35, 0.58], accentL: [0.44, 0.60],
      bgPersona: [0.12, 0.40], darkPersona: [0.20, 0.35],
      darkL: [0.17, 0.22], darkChroma: [0.012, 0.035],
      warm: true,
    },
    professional: {
      label: "Professional", contrastRef: "light",
      chromaFrac: [0.50, 0.72], accentL: [0.45, 0.58],
      bgPersona: [0.45, 0.40], darkPersona: [0.40, 0.40],
      darkL: [0.15, 0.20], darkChroma: [0.012, 0.035],
    },
  };

  var AUTO_PICKS = {
    vivid:        [["triadic", 3], ["split", 3], ["complementary", 2], ["golden", 2], ["rectangular", 1]],
    calm:         [["analogous", 4], ["monochromatic", 2], ["split", 2], ["golden", 1]],
    neon:         [["complementary", 3], ["golden", 3], ["split", 2], ["triadic", 2]],
    pastel:       [["analogous", 3], ["triadic", 2], ["golden", 2], ["monochromatic", 1]],
    earthy:       [["analogous", 3], ["complementary", 2], ["rectangular", 2], ["monochromatic", 2]],
    professional: [["complementary", 3], ["analogous", 3], ["split", 2], ["triadic", 1]],
  };

  function pick(rng, range) { return range[0] + rng() * (range[1] - range[0]); }

  /* ---------- anti-repetition memory ----------
     Session-scoped. Seedless runs (the Generate button) score 24 candidate hues
     by distance from recent picks and take the farthest, warped by mood weighting.
     Seeded runs skip the memory entirely so a seed stays reproducible. */
  var recentHues = [];
  var MEMORY = 12;
  function rememberHue(h) {
    recentHues.push(wrapHue(h));
    if (recentHues.length > MEMORY) recentHues.shift();
  }
  /* Coarse construction signatures. A seedless run whose hue pair + structure
     matches a recent one gets one re-roll, so no two nearby generations share
     both geometry and build plan. */
  var recentSigs = [];
  var SIG_MEMORY = 40;
  function sigSeen(sig) { return recentSigs.indexOf(sig) !== -1; }
  function rememberSig(sig) {
    recentSigs.push(sig);
    if (recentSigs.length > SIG_MEMORY) recentSigs.shift();
  }
  function chooseBaseHue(rng, mood, useMemory) {
    var M = MOODS[mood];
    var candidates = 24, bestHue = rng() * 360, bestScore = -1;
    for (var i = 0; i < candidates; i++) {
      var h = rng() * 360;
      if (M.warm && rng() < 0.62) h = 15 + rng() * 85;
      var score = 1;
      if (M.hueWeightByChroma) {
        var c = findCusp(h).C;
        score *= (c * c) / (0.32 * 0.32); /* favor hues with real fluorescent range */
      }
      if (useMemory && recentHues.length) {
        var minD = 180;
        for (var j = 0; j < recentHues.length; j++) {
          var d = hueDist(h, recentHues[j]);
          if (d < minD) minD = d;
        }
        score *= 0.06 + (minD / 180) * 0.94;
      }
      score *= 0.85 + rng() * 0.3; /* keep ties from resolving identically */
      if (score > bestScore) { bestScore = score; bestHue = h; }
    }
    if (useMemory) rememberHue(bestHue);
    return bestHue;
  }

  /* ---------- contrast fitting ---------- */
  function fitTowards(L, C, H, bg, target, dir) {
    var hex = toHex(L, C, H);
    var steps = 0;
    while (E.contrast(hex, bg) < target && steps < 60) {
      L += dir * 0.012;
      if (L < 0.05 || L > 0.97) break;
      hex = toHex(L, C, H);
      steps++;
    }
    return { hex: hex, L: L };
  }

  /* Accent constructor. Chroma tracks the gamut ceiling as lightness moves,
     so contrast fitting never washes an accent out. */
  function buildAccent(rng, M, H, bgLight, bgDark) {
    var frac = pick(rng, M.chromaFrac);
    var L;
    if (M.accentL === null) {
      var cusp = findCusp(H);
      L = Math.min(0.92, Math.max(0.55, cusp.L + rng() * 0.06));
    } else {
      L = pick(rng, M.accentL);
    }
    var C = frac * maxChroma(L, H);

    if (M.contrastRef === "dark") {
      /* Neon policy: guarantee 4.5:1 against the dark surface, chroma pinned
         to the ceiling the whole way up. */
      var steps = 0;
      while (E.contrast(toHex(L, frac * maxChroma(L, H), H), bgDark) < 4.5 && L < 0.95 && steps < 60) {
        L += 0.012; steps++;
      }
      C = frac * maxChroma(L, H);
      return { L: L, C: C, H: H, hex: toHex(L, C, H) };
    }

    /* Light-surface policy: 4.5:1 on light, then lift toward a 3:1 floor on
       dark if that does not break the light guarantee. */
    var down = fitTowards(L, C, H, bgLight, 4.5, -1);
    L = down.L;
    C = Math.min(C, maxChroma(L, H));
    var guard = 0;
    while (E.contrast(toHex(L, C, H), bgDark) < 3 && guard < 40) {
      var upL = L + 0.012;
      var upC = Math.min(C, maxChroma(upL, H));
      if (E.contrast(toHex(upL, upC, H), bgLight) < 4.5 || upL > 0.95) break;
      L = upL; C = upC; guard++;
    }
    return { L: L, C: C, H: H, hex: toHex(L, C, H) };
  }

  /* ---------- the designer ---------- */
  function designPalette(opts) {
    opts = opts || {};
    var seeded = (opts.seed !== undefined);
    var seed = seeded ? (opts.seed >>> 0) : randomSeed();
    var rng = mulberry32(seed);
    var mood = MOODS[opts.mood] ? opts.mood : "vivid";
    var M = MOODS[mood];

    /* base + optional blend */
    var baseHue, blendHue = null;
    var baseNorm = opts.baseHex ? E.normalizeHex(opts.baseHex) : null;
    var blendNorm = opts.blendHex ? E.normalizeHex(opts.blendHex) : null;
    var baseLch = baseNorm ? E.hexToOklch(baseNorm) : null;
    var blendLch = blendNorm ? E.hexToOklch(blendNorm) : null;
    if (baseLch && blendLch) {
      var t = 0.3 + rng() * 0.4;
      baseHue = mixHue(baseLch[2], blendLch[2], t);
      blendHue = blendLch[2];
    } else if (baseLch) {
      baseHue = wrapHue(baseLch[2] + (rng() - 0.5) * 10);
    } else {
      baseHue = chooseBaseHue(rng, mood, !seeded);
    }

    /* harmony resolution with per-run jitter */
    var harmony = HARMONIES[opts.harmony] !== undefined && opts.harmony !== undefined ? opts.harmony : "auto";
    if (!HARMONIES[harmony] && harmony !== "monochromatic" && harmony !== "auto") harmony = "auto";
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
    var offsets = HARMONIES[resolved] || [0];
    var jitter = (rng() - 0.5) * 14;

    var accentHue;
    if (blendHue !== null) {
      accentHue = wrapHue(blendHue + (rng() - 0.5) * 16);
    } else if (resolved === "monochromatic") {
      accentHue = wrapHue(baseHue + (rng() - 0.5) * 14);
    } else {
      var choices = offsets.slice(1);
      accentHue = wrapHue(baseHue + choices[Math.floor(rng() * choices.length)] + jitter);
    }

    /* structure decisions — drawn per run, not fixed */
    var tintMode = Math.floor(rng() * 5); /* 0 base · 1 accent · 2 warm-paper band · 3 complement · 4 neighbor */
    var anchorRoll = rng();
    var darkAnchor = anchorRoll < 0.38 ? baseHue
      : anchorRoll < 0.66 ? accentHue
      : anchorRoll < 0.85 ? wrapHue(baseHue + 180)
      : wrapHue(baseHue + (rng() < 0.5 ? 90 : -90));
    var swapLoudness = rng() < 0.5;

    /* light surface — three personalities, drawn per run:
       porcelain: barely-there tint (v3.0's only behavior, now the minority);
       tinted:    a color cast you can name;
       pigment:   colored paper — light peach / mint / lavender territory.
       Text and accent fitting run against whatever comes out, so every
       contrast guarantee holds no matter how loud the paper gets. */
    var bgHue = tintMode === 0 ? baseHue
      : tintMode === 1 ? accentHue
      : tintMode === 2 ? wrapHue(25 + rng() * 75) /* peach / cream / sand band, independent of base hue */
      : tintMode === 3 ? wrapHue(baseHue + 180)
      : wrapHue(baseHue + (rng() < 0.5 ? 60 : -60));
    bgHue = wrapHue(bgHue + (rng() - 0.5) * 18);
    var paperRoll = rng(), bgL, tintFrac, paper;
    if (paperRoll < M.bgPersona[0]) {
      paper = "porcelain"; bgL = 0.935 + rng() * 0.035; tintFrac = 0.05 + rng() * 0.12;
    } else if (paperRoll < M.bgPersona[0] + M.bgPersona[1]) {
      paper = "tinted"; bgL = 0.912 + rng() * 0.04; tintFrac = 0.30 + rng() * 0.25;
    } else {
      paper = "pigment"; bgL = 0.892 + rng() * 0.03; tintFrac = 0.55 + rng() * 0.40;
    }
    var bgLight = toHex(bgL, tintFrac * maxChroma(bgL, bgHue), bgHue);

    /* dark surface — its own three personalities:
       ink:      near-black with a whisper of hue (v3.0's only behavior);
       charcoal: a dark surface with a tint you can read;
       pigment:  a deep colored surface — plum / petrol / moss / oxblood —
                 chroma drawn as a real fraction of the gamut at that depth. */
    var darkHue = wrapHue(darkAnchor + (rng() - 0.5) * 24);
    var darkRoll = rng(), dL, dC, depth;
    if (darkRoll < M.darkPersona[0]) {
      depth = "ink"; dL = pick(rng, M.darkL); dC = pick(rng, M.darkChroma);
    } else if (darkRoll < M.darkPersona[0] + M.darkPersona[1]) {
      depth = "charcoal"; dL = pick(rng, M.darkL) + 0.02; dC = Math.min(0.10, 0.05 + rng() * 0.05);
    } else {
      depth = "pigment"; dL = 0.19 + rng() * 0.09; dC = (0.40 + rng() * 0.35) * maxChroma(dL, darkHue);
    }
    var bgDark = toHex(dL, dC, darkHue);

    /* text: tinted toward the base's complement, always >= 7:1 on light */
    var textC = M.softText ? 0.015 + rng() * 0.02 : 0.02 + rng() * 0.025;
    var textFit = fitTowards(0.24, textC, wrapHue(baseHue + (rng() < 0.5 ? 180 : 0)), bgLight, 7, -1);
    var textPrimary = textFit.hex;

    /* accents */
    var primary = buildAccent(rng, M, baseHue, bgLight, bgDark);
    var accent = buildAccent(rng, M, accentHue, bgLight, bgDark);

    /* near-hue accents: separate by lightness + volume so they read as two roles */
    if (blendHue === null && hueDist(accentHue, baseHue) < 35) {
      var aL = primary.L > 0.6 ? Math.max(0.34, primary.L - 0.18) : Math.min(0.9, primary.L + 0.18);
      var aC = Math.min(maxChroma(aL, accentHue), primary.C * (rng() < 0.5 ? 0.55 : 1.4));
      accent = { L: aL, C: aC, H: accentHue, hex: toHex(aL, aC, accentHue) };
      if (M.contrastRef === "dark") {
        /* neon: lift the darker sibling until it clears 4.5 on the dark surface,
           chroma tracking the gamut ceiling as it rises */
        var nL = aL, nSteps = 0, nFrac = pick(rng, M.chromaFrac);
        while (E.contrast(toHex(nL, nFrac * maxChroma(nL, accentHue), accentHue), bgDark) < 4.5 && nL < 0.95 && nSteps < 60) {
          nL += 0.012; nSteps++;
        }
        var nC = nFrac * maxChroma(nL, accentHue);
        accent = { L: nL, C: nC, H: accentHue, hex: toHex(nL, nC, accentHue) };
      } else {
        var refit = fitTowards(aL, aC, accentHue, bgLight, 4.5, -1);
        accent = { L: refit.L, C: Math.min(aC, maxChroma(refit.L, accentHue)), H: accentHue, hex: refit.hex };
      }
    }

    /* volume assignment: one accent leads, the other supports.
       Chroma changes shift luminance, so the light guarantee is re-fit after. */
    if (swapLoudness && M.contrastRef !== "dark") {
      var quietC = Math.min(primary.C * 0.62, maxChroma(primary.L, primary.H));
      var quietFit = fitTowards(primary.L, quietC, primary.H, bgLight, 4.5, -1);
      primary = { L: quietFit.L, C: Math.min(quietC, maxChroma(quietFit.L, primary.H)), H: primary.H, hex: quietFit.hex };
    }

    /* dark surface must hold both accents at its floor */
    var floor = M.contrastRef === "dark" ? 4.5 : 3;
    var guard = 0;
    while (guard++ < 16) {
      if (E.contrast(primary.hex, bgDark) >= floor && E.contrast(accent.hex, bgDark) >= floor) break;
      var dl = E.hexToOklch(bgDark);
      bgDark = toHex(Math.max(0.055, dl[0] - 0.016), dl[1], dl[2]);
    }

    var palette = {
      bgLight: bgLight,
      textPrimary: textPrimary,
      primary: primary.hex,
      accent1: accent.hex,
      bgDark: bgDark,
    };
    /* uniqueness re-roll for seedless runs */
    if (!seeded) {
      var sig = mood + "|" + Math.round(baseHue / 15) + "|" + Math.round(accent.H / 15) + "|" + tintMode + "|" + (swapLoudness ? 1 : 0) + "|" + paper + "|" + depth;
      if (sigSeen(sig) && !opts._reroll) {
        return designPalette({ mood: opts.mood, harmony: opts.harmony, baseHex: opts.baseHex, blendHex: opts.blendHex, _reroll: true });
      }
      rememberSig(sig);
    }

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
      contrastRef: M.contrastRef,
      darkFloor: floor,
      paper: paper,
      depth: depth,
      reason: (blendHue !== null ? "Blend" : HARMONY_LABELS[resolved]) + " \u00b7 " + M.label +
        (M.contrastRef === "dark" ? " (dark-surface first)" : "") +
        " \u00b7 base " + Math.round(baseHue) + "\u00b0 / accent " + Math.round(accent.H) + "\u00b0" +
        " \u00b7 " + paper + " paper / " + depth + " dark" +
        " \u00b7 seed " + seed,
    };
    return { palette: palette, meta: meta };
  }

  function spinPalette(currentPalette, opts) {
    opts = opts || {};
    var cur = currentPalette && E.isValidPalette(currentPalette) ? currentPalette : E.PRESETS.defaultPro;
    var curHue = E.hexToOklch(cur.primary)[2];
    var hop = 25 + Math.random() * 65; /* varied rotation instead of a fixed +30 */
    var baseHue = wrapHue(curHue + (Math.random() < 0.5 ? hop : -hop));
    return designPalette({
      seed: opts.seed,
      harmony: opts.harmony,
      mood: opts.mood,
      baseHex: E.oklchToHex(0.6, Math.min(0.15, maxChroma(0.6, baseHue)), baseHue),
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
    /* exposed for tests */
    findCusp: findCusp,
    maxChroma: maxChroma,
  };
});
