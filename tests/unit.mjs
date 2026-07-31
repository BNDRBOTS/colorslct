/* ColorSLCT unit tests — run with: node tests/unit.mjs (Node 18+, no deps) */
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const E = require(path.join(here, "../assets/js/color-engine.js"));
const License = require(path.join(here, "../assets/js/license.js"));

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(name + (detail ? " — " + detail : "")); console.error("FAIL: " + name + (detail ? " — " + detail : "")); }
}
function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function near(name, actual, expected, tol) {
  check(name, Math.abs(actual - expected) <= tol, `expected ≈${expected}±${tol}, got ${actual}`);
}

/* ---------- normalizeHex ---------- */
eq("normalizeHex 6-digit", E.normalizeHex("#0066CC"), "#0066cc");
eq("normalizeHex no hash", E.normalizeHex("ff0055"), "#ff0055");
eq("normalizeHex 3-digit", E.normalizeHex("#abc"), "#aabbcc");
eq("normalizeHex 3-digit no hash", E.normalizeHex("fff"), "#ffffff");
eq("normalizeHex whitespace", E.normalizeHex("  #123456  "), "#123456");
eq("normalizeHex invalid chars", E.normalizeHex("#zzzzzz"), null);
eq("normalizeHex wrong length", E.normalizeHex("#12345"), null);
eq("normalizeHex empty", E.normalizeHex(""), null);
eq("normalizeHex non-string", E.normalizeHex(12345), null);

/* ---------- rgb <-> hex ---------- */
eq("hexToRgb white", E.hexToRgb("#ffffff").join(","), "255,255,255");
eq("hexToRgb black", E.hexToRgb("#000000").join(","), "0,0,0");
eq("rgbToHex roundtrip", E.rgbToHex(...E.hexToRgb("#3fa7c9")), "#3fa7c9");
eq("rgbToHex clamps", E.rgbToHex(300, -5, 128.4), "#ff0080");

/* ---------- OKLCH roundtrip ---------- */
for (const hex of ["#0066cc", "#e0004d", "#ccff00", "#f4f4f6", "#1d1d1f", "#808080", "#ff0055"]) {
  const [L, C, H] = E.hexToOklch(hex);
  const back = E.oklchToHex(L, C, H);
  const a = E.hexToRgb(hex);
  const b = E.hexToRgb(back);
  const delta = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  check(`oklch roundtrip ${hex}`, delta <= 1, `channel delta ${delta} (${back})`);
}
check("oklch hue in [0,360)", (() => { const [, , h] = E.hexToOklch("#0000ff"); return h >= 0 && h < 360; })());

/* ---------- WCAG ---------- */
near("contrast black/white = 21", E.contrast("#000000", "#ffffff"), 21, 0.01);
near("contrast symmetric", E.contrast("#0066cc", "#f4f4f6"), E.contrast("#f4f4f6", "#0066cc"), 1e-9);
near("contrast self = 1", E.contrast("#808080", "#808080"), 1, 1e-9);
eq("wcagLevel AAA", E.wcagLevel(7), "AAA");
eq("wcagLevel AA", E.wcagLevel(4.5), "AA");
eq("wcagLevel AA upper edge", E.wcagLevel(6.99), "AA");
eq("wcagLevel FAIL", E.wcagLevel(4.49), "FAIL");

/* ---------- idealTextColor (the v1 hardcoded-#000 fix) ---------- */
eq("idealTextColor on #0066cc is white", E.idealTextColor("#0066cc"), "#ffffff");
eq("idealTextColor on #ccff00 is black", E.idealTextColor("#ccff00"), "#000000");
eq("idealTextColor on white is black", E.idealTextColor("#ffffff"), "#000000");
eq("idealTextColor on black is white", E.idealTextColor("#000000"), "#ffffff");
check("idealTextColor always meets max contrast", ["#e0004d", "#ff0055", "#f4f4f6", "#123456"].every((h) => {
  const t = E.idealTextColor(h);
  const other = t === "#000000" ? "#ffffff" : "#000000";
  return E.contrast(t, h) >= E.contrast(other, h);
}));

/* ---------- palette validation / codec ---------- */
check("defaultPro preset valid", E.isValidPalette(E.PRESETS.defaultPro));
check("bndrColors preset valid", E.isValidPalette(E.PRESETS.bndrColors));
check("invalid palette rejected (missing token)", !E.isValidPalette({ bgLight: "#fff" }));
check("invalid palette rejected (bad hex)", !E.isValidPalette({ ...E.PRESETS.defaultPro, primary: "blue" }));
check("invalid palette rejected (null)", !E.isValidPalette(null));
eq("cleanPalette normalizes", E.cleanPalette({ bgLight: "FFF", textPrimary: "#1D1D1F", primary: "#0066CC", accent1: "#e0004d", bgDark: "000" }).bgLight, "#ffffff");

const enc = E.encodePalette(E.PRESETS.defaultPro);
eq("encodePalette format", enc, "f4f4f6-1d1d1f-0066cc-e0004d-000000");
check("decodePalette roundtrip", JSON.stringify(E.decodePalette(enc)) === JSON.stringify(E.cleanPalette(E.PRESETS.defaultPro)));
eq("decodePalette wrong length", E.decodePalette("aabbcc-112233"), null);
eq("decodePalette bad hex", E.decodePalette("zzzzzz-1d1d1f-0066cc-e0004d-000000"), null);
eq("decodePalette non-string", E.decodePalette(42), null);

/* ---------- exporters ---------- */
const pal = E.PRESETS.defaultPro;
const hexes = Object.values(E.cleanPalette(pal));
for (const f of E.EXPORT_FORMATS) {
  const out = E.exportAs(f.id, pal);
  check(`export ${f.id} contains all hexes`, hexes.every((h) => out.toLowerCase().includes(h)), f.id);
}
check("export css structure", E.exportAs("css", pal).startsWith(":root {") && E.exportAs("css", pal).includes("--bg-light:"));
check("export scss structure", E.exportAs("scss", pal).includes("$primary:"));
check("export tailwind structure", E.exportAs("tailwind", pal).includes("module.exports"));
check("export json parses", (() => { const j = JSON.parse(E.exportAs("json", pal)); return j.colorslct.primary.$value === "#0066cc" && j.colorslct.primary.$type === "color"; })());
check("export svg structure", E.exportAs("svg", pal).startsWith("<svg") && E.exportAs("svg", pal).includes('role="img"'));
check("unknown format falls back to css", E.exportAs("nope", pal) === E.exportAs("css", pal));
eq("css export is free", E.EXPORT_FORMATS.find((f) => f.id === "css").pro, false);
check("all other exports are pro", E.EXPORT_FORMATS.filter((f) => f.id !== "css").every((f) => f.pro === true));

/* ---------- SHA-256 (pure JS vs node:crypto) ---------- */
const nodeSha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const vectors = [
  "",
  "abc",
  "BNDR-GIFT-2049",
  "a".repeat(55), // padding boundary
  "a".repeat(56), // padding boundary
  "a".repeat(63),
  "a".repeat(64), // block boundary
  "a".repeat(65),
  "a".repeat(200),
  "The quick brown fox jumps over the lazy dog",
];
for (const v of vectors) {
  eq(`sha256Sync(${JSON.stringify(v.length > 20 ? v.slice(0, 10) + "…len" + v.length : v)})`, License.sha256Sync(v), nodeSha(v));
}
eq("sha256Sync known vector abc", License.sha256Sync("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
/* async path (falls back to pure JS in Node — no window.crypto root) */
const asyncHash = await License.sha256("BNDR-GIFT-2049");
eq("sha256 async matches node:crypto", asyncHash, nodeSha("BNDR-GIFT-2049"));
const unicodeHash = await License.sha256("café — äöü ☃");
eq("sha256 async unicode matches node:crypto", unicodeHash, nodeSha("café — äöü ☃"));

/* ---------- license helpers ---------- */
eq("normalizeCode trims/uppercases/strips spaces", License.normalizeCode("  bndr gift 2049  "), "BNDRGIFT2049");
eq("normalizeCode null-safe", License.normalizeCode(null), "");
const emptyRedeem = await License.redeemGiftCode("   ");
check("redeemGiftCode empty code rejected", emptyRedeem.ok === false && /type a code/i.test(emptyRedeem.message));
const noConfigRedeem = await License.redeemGiftCode("SOMECODE");
check("redeemGiftCode without config rejected gracefully", noConfigRedeem.ok === false);
const emptyVerify = await License.verifyGumroadLicense("");
check("verifyGumroadLicense empty key rejected", emptyVerify.ok === false && /paste/i.test(emptyVerify.message));
const noProductVerify = await License.verifyGumroadLicense("ABCD-1234");
check("verifyGumroadLicense without productId rejected gracefully", noProductVerify.ok === false && /isn’t set up/.test(noProductVerify.message));

/* ---------- config.js starter gift code wiring ---------- */
const configSrc = fs.readFileSync(path.join(here, "../assets/js/config.js"), "utf8");
check("config.js has no placeholder hashes", !configSrc.includes("__STARTER_HASH__"));
const hashMatches = configSrc.match(/"([0-9a-f]{64})"/g) || [];
check("config.js contains at least one 64-hex gift hash", hashMatches.length >= 1);
const starterHash = nodeSha(License.normalizeCode("BNDR-GIFT-2049"));
check("starter code BNDR-GIFT-2049 hash present in config.js", configSrc.includes(starterHash));
eq("pure-JS hash of starter code matches config", License.sha256Sync(License.normalizeCode("bndr-gift-2049")), starterHash);

/* ---------- token model ---------- */
eq("5 tokens", E.TOKENS.length, 5);
check("TOKEN_INFO covers all tokens", E.TOKENS.every((t) => E.TOKEN_INFO[t] && E.TOKEN_INFO[t].label && E.TOKEN_INFO[t].hint && E.TOKEN_INFO[t].cssVar));

/* ---------- palette designer ---------- */
const D = require(path.join(here, "../assets/js/palette-designer.js"));
{
  const a = D.designPalette({ seed: 42, mood: "vivid", harmony: "triadic" });
  const b = D.designPalette({ seed: 42, mood: "vivid", harmony: "triadic" });
  eq("designer deterministic by seed", JSON.stringify(a.palette), JSON.stringify(b.palette));
  const c = D.designPalette({ seed: 43, mood: "vivid", harmony: "triadic" });
  check("different seeds produce different palettes", JSON.stringify(a.palette) !== JSON.stringify(c.palette));
  check("designer palette valid", E.isValidPalette(a.palette));
  check("meta reason present", typeof a.meta.reason === "string" && a.meta.reason.length > 10);
  /* Per-mood contrast policy: neon is dark-surface-first (accents >= 4.5 on
     bgDark; a fluorescent color cannot also hit 4.5 on near-white). Every
     other mood guarantees accents >= 4.5 on bgLight and >= 3 on bgDark. */
  let sweepFails = 0;
  for (const h of Object.keys(D.HARMONIES)) for (const m of Object.keys(D.MOODS)) for (let s = 1; s <= 6; s++) {
    const { palette: p, meta } = D.designPalette({ seed: s * 7919, harmony: h, mood: m });
    if (!E.isValidPalette(p)) { sweepFails++; continue; }
    if (E.contrast(p.textPrimary, p.bgLight) < 6.98) sweepFails++;
    if (meta.contrastRef === "dark") {
      if (E.contrast(p.primary, p.bgDark) < 4.48) sweepFails++;
      if (E.contrast(p.accent1, p.bgDark) < 4.48) sweepFails++;
    } else {
      if (E.contrast(p.primary, p.bgLight) < 4.48) sweepFails++;
      if (E.contrast(p.accent1, p.bgLight) < 4.48) sweepFails++;
      if (E.contrast(p.primary, p.bgDark) < 2.98) sweepFails++;
      if (E.contrast(p.accent1, p.bgDark) < 2.98) sweepFails++;
    }
    if (E.contrast(p.bgLight, p.bgDark) < 6.98) sweepFails++;
  }
  eq("designer sweep: contrast guarantees hold (324 cases)", sweepFails, 0);
  /* Neon must be fluorescent: accent chroma pinned to the sRGB gamut ceiling. */
  let neonFails = 0;
  for (let s = 1; s <= 20; s++) {
    const { palette: p } = D.designPalette({ seed: s * 104729, mood: "neon" });
    for (const tok of ["primary", "accent1"]) {
      const [L, C, H] = E.hexToOklch(p[tok]);
      const ceil = D.maxChroma(L, H);
      if (ceil > 0 && C < 0.82 * ceil) neonFails++;
    }
  }
  eq("neon accents ride the gamut ceiling (40 cases)", neonFails, 0);
  /* Seedless generations must spread across the wheel (anti-repetition memory). */
  {
    const hues = [];
    for (let i = 0; i < 18; i++) hues.push(D.designPalette({ mood: "vivid" }).meta.baseHue);
    const sectors = new Set(hues.map((x) => Math.floor(((x % 360) + 360) % 360 / 45)));
    check("seedless base hues span >= 5 of 8 wheel sectors", sectors.size >= 5);
  }
  const g = D.designPalette({ seed: 7, harmony: "golden", mood: "vivid" });
  near("golden angle hue distance", D.hueDist(E.hexToOklch(g.palette.primary)[2], E.hexToOklch(g.palette.accent1)[2]), 137.5, 12);
  const comp = D.designPalette({ seed: 7, harmony: "complementary", mood: "vivid" });
  near("complementary hue distance", D.hueDist(E.hexToOklch(comp.palette.primary)[2], E.hexToOklch(comp.palette.accent1)[2]), 180, 12);
  const mono = D.designPalette({ seed: 7, harmony: "monochromatic", mood: "vivid" });
  check("monochromatic stays in hue family", D.hueDist(E.hexToOklch(mono.palette.primary)[2], E.hexToOklch(mono.palette.accent1)[2]) < 35);
  const blend = D.designPalette({ seed: 9, baseHex: "#ccff00", blendHex: "#0066cc", mood: "vivid" });
  check("blend marked blended", blend.meta.blended === true);
  check("blend produces valid palette", E.isValidPalette(blend.palette));
  const earthy = D.designPalette({ seed: 11, harmony: "analogous", mood: "earthy" });
  check("earthy mood keeps chroma muted", E.hexToOklch(earthy.palette.primary)[1] < 0.16);
  const spin = D.spinPalette(E.PRESETS.defaultPro, { seed: 5, harmony: "triadic", mood: "vivid" });
  check("spinPalette changes primary", spin.palette.primary !== E.PRESETS.defaultPro.primary);
  check("spinPalette valid", E.isValidPalette(spin.palette));
  const seedRange = D.randomSeed();
  check("randomSeed is uint32", Number.isInteger(seedRange) && seedRange >= 0 && seedRange < 4294967296);
}

/* ---------- summary ---------- */
console.log(`\nUnit tests: ${passed} passed, ${failed} failed`);
if (failed) { console.error("\nFailures:\n- " + failures.join("\n- ")); process.exit(1); }
