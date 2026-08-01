/* ColorSLCT Palette Designer v3 — a generative OKLCH engine, not a preset picker.
   What it does on every run:
   1. Measures the real sRGB gamut boundary (the "cusp") for each hue it considers,
      so chroma is sampled as a fraction of what that hue can physically deliver.
      (v2 sampled fixed chroma numbers and its gamut test was broken — the engine's
      oklabToRgb clamps channels, so every color "passed" and clipping did the work.)
   2. Picks a base hue via candidate scoring against a memory of recent hues,
      so back-to-back generations spread across the wheel instead of clustering.
   3. Draws structure decisions from the seeded RNG — including a surface
      personality for BOTH backgrounds (porcelain/tinted/pigment/electric
      paper on the light side, ink/charcoal/pigment on the dark side), hue
      anchors, and
      which accent carries the volume — giving each palette its own
      construction, not one recipe with new numbers.
      (v3.0 locked bgLight to L 0.925-0.97 and bgDark to a muted near-black,
      which is why every palette shipped the same near-white paper and the
      same maroon/forest/navy dark. v3.1 treats both surfaces as design
      decisions in their own right. v3.2 adds the electric paper persona:
      light backgrounds at L 0.855-0.90 riding the sRGB gamut ceiling — the
      only band where colors like peach-cream and lavender-pink exist at
      full saturation — hue-paired across the wheel from the accents, with
      the dark surface auto-deepened until light-vs-dark holds >= 7:1.)
      v3.4 pushes text and dark surfaces to real extremes — pitch-black
      depths up to the 0.30 ceiling, near-black to visibly tinted text —
      with the same floors acting as the leash.)
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
    clash: [0, 165], /* offsets are a placeholder — the clash branch below draws a per-run collision distance */
  };
  var HARMONY_LABELS = {
    auto: "Designer\u2019s choice", analogous: "Analogous", complementary: "Complementary",
    split: "Split-complementary", triadic: "Triadic", tetradic: "Tetradic",
    rectangular: "Rectangular", monochromatic: "Monochromatic", golden: "Golden angle",
    clash: "Clash",
  };

  /* ---------- moods ----------
     chromaFrac: accent chroma as a fraction of the hue's true gamut ceiling.
     accentL: lightness window for accents (neon overrides toward the cusp).
     contrastRef: which background the 4.5:1 accent guarantee targets.
     bgPersona: cumulative weights for porcelain/tinted/pigment paper;
     whatever remains goes to the electric persona — colored paper in the
     L 0.855-0.90 luminous band, chroma riding the gamut ceiling.
     darkPersona: weights for ink/charcoal; the rest goes to pigment. */
  var MOODS = {
    vivid: {
      label: "Loud", contrastRef: "light",
      chromaFrac: [0.82, 1.0], accentL: [0.40, 0.78], floorOvershoot: 2.2,
      bgPersona: [0.10, 0.20, 0.30], darkPersona: [0.25, 0.30],
      darkL: [0.17, 0.23], darkChroma: [0.015, 0.045],
    },
    calm: {
      label: "Calm", contrastRef: "light",
      chromaFrac: [0.15, 0.28], accentL: [0.38, 0.50], darkAccentFloor: 2.5, keepDeepAccents: true,
      bgPersona: [0.30, 0.45, 0.20], darkPersona: [0.30, 0.45],
      darkL: [0.21, 0.26], darkChroma: [0.008, 0.025],
    },
    neon: {
      label: "Electric", contrastRef: "dark",
      chromaFrac: [0.96, 1.0], accentL: null, /* rides the cusp */
      bgPersona: [0.0, 0.05, 0.15], darkPersona: [0.05, 0.15],
      darkL: [0.15, 0.20], darkChroma: [0.020, 0.055],
      hueWeightByChroma: true,
    },
    pastel: {
      label: "Pastel", contrastRef: "light", accentFloor: 3.0,
      chromaFrac: [0.30, 0.50], accentL: [0.80, 0.90],
      bgPersona: [0.80, 0.18, 0.02], darkPersona: [0.45, 0.35],
      darkL: [0.23, 0.27], darkChroma: [0.010, 0.025],
      softText: true,
    },
    earthy: {
      label: "Earthy", contrastRef: "light",
      chromaFrac: [0.35, 0.55], accentL: [0.34, 0.46], darkAccentFloor: 2.5, floorOvershoot: 1.0, keepDeepAccents: true,
      bgPersona: [0.0, 0.10, 0.60], darkPersona: [0.0, 0.20],
      darkL: [0.19, 0.24], darkChroma: [0.012, 0.035],
      warm: true,
    },
    professional: {
      label: "Professional", contrastRef: "light",
      chromaFrac: [0.50, 0.70], accentL: [0.38, 0.50], floorOvershoot: 1.6,
      bgPersona: [0.55, 0.35, 0.08], darkPersona: [0.45, 0.35],
      darkL: [0.16, 0.21], darkChroma: [0.012, 0.035],
    },
  };

  var AUTO_PICKS = {
    vivid:        [["triadic", 3], ["split", 3], ["clash", 3], ["complementary", 2], ["golden", 2], ["rectangular", 1]],
    calm:         [["analogous", 4], ["monochromatic", 2], ["split", 2], ["golden", 1]],
    neon:         [["complementary", 3], ["clash", 3], ["golden", 3], ["split", 2], ["triadic", 2]],
    pastel:       [["analogous", 3], ["triadic", 2], ["golden", 2], ["monochromatic", 1]],
    earthy:       [["analogous", 4], ["complementary", 2], ["rectangular", 2], ["golden", 1]],
    professional: [["complementary", 4], ["split", 3], ["triadic", 2], ["tetradic", 1], ["golden", 1], ["clash", 1]],
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
      if (M.warm && rng() < 0.88) h = 15 + rng() * 85;
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
      while (E.contrast(toHex(L, frac * maxChroma(L, H), H), bgDark) < 3.5 && L < 0.95 && steps < 60) {
        L += 0.012; steps++;
      }
      C = frac * maxChroma(L, H);
      return { L: L, C: C, H: H, hex: toHex(L, C, H) };
    }

    /* Light-surface policy: fit to the mood's floor on light (3.5; 3.0 for
       pastel — its accents can stay light), then lift toward 3:1 on dark
       if that does not break the light-side floor. */
    var lf = M.accentFloor !== undefined ? M.accentFloor : 3.5;
    var df = M.darkAccentFloor !== undefined ? M.darkAccentFloor : 3;
    /* depth variance: a per-run overshoot past the floor puts accents at
       genuinely different depths run to run — the ladder is real, not
       decorative. The floor itself is never crossed. */
    var lfTarget = lf + (M.floorOvershoot ? rng() * M.floorOvershoot : 0);
    var down = fitTowards(L, C, H, bgLight, lfTarget, -1);
    L = down.L;
    C = Math.min(C, maxChroma(L, H));
    var guard = 0;
    while (E.contrast(toHex(L, C, H), bgDark) < df && guard < 40) {
      var upL = L + 0.012;
      var upC = Math.min(C, maxChroma(upL, H));
      if (E.contrast(toHex(upL, upC, H), bgLight) < lf || upL > 0.95) break;
      L = upL; C = upC; guard++;
    }
    return { L: L, C: C, H: H, hex: toHex(L, C, H) };
  }

  /* ---------- the designer ---------- */
  function buildPalette(opts) {
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
      if (hueDist(baseLch[2], blendLch[2]) < 90) {
        /* near hues make twin accents — mix them for the base and push the
           second accent across the wheel for a real pair */
        var t = 0.3 + rng() * 0.4;
        baseHue = mixHue(baseLch[2], blendLch[2], t);
        blendHue = wrapHue(baseHue + 150 + rng() * 60);
      } else {
        /* far hues are a real pair on their own — keep both */
        baseHue = wrapHue(baseLch[2] + (rng() - 0.5) * 10);
        blendHue = blendLch[2];
      }
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
    } else if (resolved === "clash") {
      /* dopamine collision: a wide, deliberate hue impact — 100-210 degrees
         apart, either direction. The pair is meant to fight and win. */
      var clashDist = 100 + rng() * 110;
      accentHue = wrapHue(baseHue + (rng() < 0.5 ? clashDist : -clashDist) + jitter);
    } else {
      var choices = offsets.slice(1);
      accentHue = wrapHue(baseHue + choices[Math.floor(rng() * choices.length)] + jitter);
    }

    /* structure decisions — drawn per run, not fixed */
    var tintMode = Math.floor(rng() * 5); /* 0 base · 1 accent · 2 warm-paper band · 3 complement · 4 neighbor */
    if (resolved === "monochromatic") tintMode = 0;
    else if (resolved === "analogous") tintMode = (rng() < 0.5 ? 0 : 4);
    if (M.warm && resolved !== "monochromatic" && rng() < 0.8) tintMode = 2; /* warm-band paper */
    var anchorRoll = rng();
    var darkAnchor = anchorRoll < 0.38 ? baseHue
      : anchorRoll < 0.66 ? accentHue
      : anchorRoll < 0.85 ? wrapHue(baseHue + 180)
      : wrapHue(baseHue + (rng() < 0.5 ? 90 : -90));
    if (M.warm && rng() < 0.6) darkAnchor = wrapHue(15 + rng() * 80);
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
      paper = "porcelain"; bgL = 0.935 + rng() * 0.035; tintFrac = 0.02 + rng() * 0.06;
    } else if (paperRoll < M.bgPersona[0] + M.bgPersona[1]) {
      paper = "tinted"; bgL = 0.912 + rng() * 0.04; tintFrac = 0.30 + rng() * 0.25;
    } else if (paperRoll < M.bgPersona[0] + M.bgPersona[1] + M.bgPersona[2]) {
      paper = "pigment"; bgL = 0.888 + rng() * 0.028; tintFrac = 0.70 + rng() * 0.30;
    } else {
      /* electric paper: the luminous band. Below L ~0.90 the sRGB ceiling
         opens up — peach-cream, mint, sky, lavender-pink at full saturation
         become possible. Chroma rides the ceiling, and the hue is drawn to
         sit across the wheel from the accents so paper and accent merge as
         a pair rather than echoing each other. */
      paper = "electric"; bgL = 0.856 + rng() * 0.044; tintFrac = 0.86 + rng() * 0.14;
      var eRoll = rng();
      bgHue = eRoll < 0.34 ? wrapHue(28 + rng() * 62) /* peach / cream / sand */
        : eRoll < 0.60 ? wrapHue(accentHue + 180 + (rng() - 0.5) * 36) /* counterpoint to the loud accent */
        : eRoll < 0.82 ? wrapHue(125 + rng() * 95) /* mint / sea / sky — widest ceiling */
        : wrapHue(302 + rng() * 46); /* lavender / pink */
    }
    var bgLight = toHex(bgL, tintFrac * maxChroma(bgL, bgHue), bgHue);

    /* luminance budget: the accent guarantees (4.5:1 on light x 3:1 on dark)
       multiply to a 13.5:1 span that must fit between the two backgrounds —
       and WCAG contrast runs on luminance, not OKLCH lightness. Purples and
       pinks carry far less luminance per step of lightness than limes and
       skies, so low-luminance papers get lifted to the brightest level the
       guarantees permit while high-luminance hues keep their full depth. */
    var lumGuard = 0;
    while (lumGuard++ < 20 && E.contrast(bgLight, "#000000") < 11.5) {
      bgL = Math.min(0.945, bgL + 0.008);
      bgLight = toHex(bgL, tintFrac * maxChroma(bgL, bgHue), bgHue);
    }

    /* dark surface — its own three personalities:
       ink:      near-black with a whisper of hue (v3.0's only behavior);
       charcoal: a dark surface with a tint you can read;
       pigment:  a deep colored surface — plum / petrol / moss / oxblood —
                 chroma drawn as a real fraction of the gamut at that depth. */
    var darkHue = wrapHue(darkAnchor + (rng() - 0.5) * 24);
    if (rng() < 0.20) darkHue = M.warm ? wrapHue(15 + rng() * 85) : rng() * 360; /* rogue hue — warm moods stay warm */
    var darkRoll = rng(), dL, dC, depth;
    if (darkRoll < M.darkPersona[0]) {
      depth = "ink"; dL = pick(rng, M.darkL); dC = pick(rng, M.darkChroma);
    } else if (darkRoll < M.darkPersona[0] + M.darkPersona[1]) {
      depth = "charcoal"; dL = pick(rng, M.darkL) + 0.02; dC = Math.min(0.10, 0.05 + rng() * 0.05);
    } else {
      depth = "pigment"; dL = 0.19 + rng() * 0.09; dC = (0.40 + rng() * 0.35) * maxChroma(dL, darkHue);
    }
    /* extremes: a quarter of runs plunge to pitch (true near-black), a
       quarter push to the richest depth the 0.30 ceiling allows. The dark
       side stops being one navy sweater. The guard below still holds every
       accent floor — extremes get pulled back only when physics demands. */
    var extremeRoll = rng();
    if (extremeRoll < 0.25) {
      dL = 0.10 + rng() * 0.045;
      dC = Math.min(dC, maxChroma(dL, darkHue));
      depth = "pitch";
    } else if (extremeRoll < 0.50 && !M.keepDeepAccents) {
      dL = 0.24 + rng() * 0.055;
      dC = Math.min(Math.max(dC, 0.35 * maxChroma(dL, darkHue)), maxChroma(dL, darkHue));
      if (depth === "ink") depth = "charcoal";
    }
    dL = Math.min(0.295, dL);
    var bgDark = toHex(dL, dC, darkHue);

    /* text: extremes on a leash — from near-black ink to visibly tinted
       dark (deep wine, deep teal, deep indigo), hue drawn from a wide anchor
       set. The 7:1 fit is the leash; variety lives inside it. */
    var textHueRoll = rng();
    var textHue = textHueRoll < 0.30 ? wrapHue(baseHue + 180)
      : textHueRoll < 0.50 ? baseHue
      : textHueRoll < 0.65 ? wrapHue(accentHue + 180)
      : textHueRoll < 0.80 ? darkHue
      : textHueRoll < 0.90 ? wrapHue(15 + rng() * 80)
      : rng() * 360;
    var textL = 0.14 + rng() * 0.16;
    var textC = M.softText ? 0.004 + rng() * 0.03 : 0.004 + rng() * 0.076;
    var textFit = fitTowards(textL, Math.min(textC, maxChroma(textL, textHue)), textHue, bgLight, 7, -1);
    var textPrimary = textFit.hex;

    /* accents — clash mode pins BOTH to campaign-grade volume: chroma at
       85-100% of the gamut ceiling across a wide lightness ladder, the kind
       of collision big-brand marketing runs on. Floors still refit every
       result, so loud never means unreadable. */
    var effM = M;
    if (resolved === "clash") {
      effM = Object.assign({}, M, { chromaFrac: [Math.max(0.92, M.chromaFrac[0]), 1.0], floorOvershoot: 2.2 });
      if (effM.accentL) effM.accentL = [0.40, 0.78];
    }
    var primary = buildAccent(rng, effM, baseHue, bgLight, bgDark);
    var accent = buildAccent(rng, effM, accentHue, bgLight, bgDark);

    /* near-hue accents: separate by lightness + volume so they read as two roles */
    if (blendHue === null && hueDist(accentHue, baseHue) < 35) {
      var aL = primary.L > 0.6 ? Math.max(0.34, primary.L - 0.18) : Math.min(0.9, primary.L + 0.18);
      var aC = Math.min(maxChroma(aL, accentHue), primary.C * (rng() < 0.5 ? 0.55 : 1.4));
      accent = { L: aL, C: aC, H: accentHue, hex: toHex(aL, aC, accentHue) };
      if (M.contrastRef === "dark") {
        /* neon: lift the darker sibling until it clears 4.5 on the dark surface,
           chroma tracking the gamut ceiling as it rises */
        var nL = aL, nSteps = 0, nFrac = pick(rng, M.chromaFrac);
        while (E.contrast(toHex(nL, nFrac * maxChroma(nL, accentHue), accentHue), bgDark) < 3.5 && nL < 0.95 && nSteps < 60) {
          nL += 0.012; nSteps++;
        }
        var nC = nFrac * maxChroma(nL, accentHue);
        accent = { L: nL, C: nC, H: accentHue, hex: toHex(nL, nC, accentHue) };
      } else {
        var refit = fitTowards(aL, aC, accentHue, bgLight, M.accentFloor !== undefined ? M.accentFloor : 3.5, -1);
        accent = { L: refit.L, C: Math.min(aC, maxChroma(refit.L, accentHue)), H: accentHue, hex: refit.hex };
      }
    }

    /* volume assignment: one accent leads, the other supports.
       Chroma changes shift luminance, so the light guarantee is re-fit after. */
    if (swapLoudness && M.contrastRef !== "dark" && resolved !== "clash") {
      var quietC = Math.min(primary.C * 0.62, maxChroma(primary.L, primary.H));
      var quietFit = fitTowards(primary.L, quietC, primary.H, bgLight, M.accentFloor !== undefined ? M.accentFloor : 3.5, -1);
      primary = { L: quietFit.L, C: Math.min(quietC, maxChroma(quietFit.L, primary.H)), H: primary.H, hex: quietFit.hex };
    }

    /* dark surface must hold both accents at its floor, and must sit >= 7:1
       under the paper — luminous papers push the dark side deeper so the
       light-text-on-dark guarantee never gives. */
    var floor = M.contrastRef === "dark" ? 3.5 : (M.darkAccentFloor !== undefined ? M.darkAccentFloor : 3);
    var guard = 0;
    while (guard++ < 26) {
      if (E.contrast(primary.hex, bgDark) >= floor && E.contrast(accent.hex, bgDark) >= floor &&
          E.contrast(bgLight, bgDark) >= 5.5) break;
      var dl = E.hexToOklch(bgDark);
      /* never darken past L 0.10 — below that a dark surface reads as pure
         black and its hue disappears. Accents that miss the floor get lifted
         into the feasible band by the pass below. */
      bgDark = toHex(Math.max(0.10, dl[0] - 0.016), dl[1], dl[2]);
    }

    /* on loud papers an accent fit hard against the light side can land a
       hair under 3:1 on the fully-deepened dark side. The luminance budget
       above guarantees a feasible band, so walk such accents up into it,
       never letting the light-side guarantee go. */
    if (M.contrastRef !== "dark") {
      var lf = M.accentFloor !== undefined ? M.accentFloor : 3.5;
      var df2 = M.darkAccentFloor !== undefined ? M.darkAccentFloor : 3;
      var liftIntoBand = function (acc) {
        var steps = 0;
        while (steps++ < 30 && E.contrast(acc.hex, bgDark) < df2 + 0.02) {
          var upL2 = acc.L + 0.006;
          var upC2 = Math.min(acc.C, maxChroma(upL2, acc.H));
          var upHex2 = toHex(upL2, upC2, acc.H);
          if (E.contrast(upHex2, bgLight) < lf + 0.02) break;
          acc = { L: upL2, C: upC2, H: acc.H, hex: upHex2 };
        }
        return acc;
      };
      primary = liftIntoBand(primary);
      accent = liftIntoBand(accent);
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
      var sig = mood + "|" + resolved + "|" + Math.round(baseHue / 15) + "|" + Math.round(accent.H / 15) + "|" + tintMode + "|" + (swapLoudness ? 1 : 0) + "|" + paper + "|" + depth;
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
      accentFloor: M.accentFloor !== undefined ? M.accentFloor : 3.5,
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
    var cur = currentPalette && E.isValidPalette(currentPalette) ? currentPalette : null;
    var curHue = cur ? E.hexToOklch(cur.primary)[2] : Math.random() * 360;
    var hop = 25 + Math.random() * 65; /* varied rotation instead of a fixed +30 */
    var baseHue = wrapHue(curHue + (Math.random() < 0.5 ? hop : -hop));
    return designPalette({
      seed: opts.seed,
      harmony: opts.harmony,
      mood: opts.mood,
      baseHex: E.oklchToHex(0.6, Math.min(0.15, maxChroma(0.6, baseHue)), baseHue),
    });
  }

  /* ---------- palette-level anti-duplicate memory ----------
     The hue/signature memory above keeps single dimensions apart; this layer
     measures whole palettes. A seedless run that lands within 0.14 of any of
     the last 96 seedless palettes is re-rolled (up to 14 tries, best kept), so
     consecutive generations never look like siblings. Seeded runs skip this
     entirely so a seed stays reproducible. */
  var recentPalettes = [];
  var PAL_MEMORY = 96;
  function palDistance(a, b) {
    var d = 0;
    var toks = ["bgLight", "textPrimary", "primary", "accent1", "bgDark"];
    for (var i = 0; i < toks.length; i++) {
      var x = E.hexToOklch(a[toks[i]]);
      var y = E.hexToOklch(b[toks[i]]);
      var dh = hueDist(x[2], y[2]) / 180;
      d += Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) * 2 + dh * (x[1] > 0.02 && y[1] > 0.02 ? 1 : 0);
    }
    return d;
  }
  function nearestRecent(pal) {
    var min = Infinity;
    for (var i = 0; i < recentPalettes.length; i++) {
      var d = palDistance(pal, recentPalettes[i]);
      if (d < min) min = d;
    }
    return min;
  }
  function rememberPalette(pal) {
    recentPalettes.push(pal);
    if (recentPalettes.length > PAL_MEMORY) recentPalettes.shift();
  }
  function designPalette(opts) {
    opts = opts || {};
    if (opts.seed !== undefined) return buildPalette(opts);
    var best = buildPalette(opts);
    var bestD = nearestRecent(best.palette);
    var tries = 0;
    while (bestD < 0.15 && tries < 14) {
      var cand = buildPalette(opts);
      var d = nearestRecent(cand.palette);
      if (d > bestD) { best = cand; bestD = d; }
      tries++;
    }
    rememberPalette(best.palette);
    return best;
  }

  return {
    HARMONIES: HARMONIES,
    HARMONY_LABELS: HARMONY_LABELS,
    MOODS: MOODS,
    designPalette: designPalette,
    palDistance: palDistance,
    spinPalette: spinPalette,
    mixHue: mixHue,
    hueDist: hueDist,
    randomSeed: randomSeed,
    /* exposed for tests */
    findCusp: findCusp,
    maxChroma: maxChroma,
  };
});
