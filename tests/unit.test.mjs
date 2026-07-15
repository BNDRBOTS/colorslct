/* ============================================================
   ColorSLCT unit suite — pure logic, plain Node.
   Run: node --test unit.test.mjs
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Core = require('../assets/js/color-core.js');
const Ex = require('../assets/js/exporters.js');
const Lic = require('../assets/js/license.js');

/* ── Hex parsing ────────────────────────────────────────── */
test('normalizeHex handles 3/6/8-digit, case, junk', () => {
  assert.equal(Core.normalizeHex('#AbC'), '#aabbcc');
  assert.equal(Core.normalizeHex('aabbcc'), '#aabbcc');
  assert.equal(Core.normalizeHex(' #AABBCCDD '), '#aabbcc');
  assert.equal(Core.normalizeHex('#12345'), null);
  assert.equal(Core.normalizeHex('red'), null);
  assert.equal(Core.normalizeHex(''), null);
  assert.equal(Core.normalizeHex(null), null);
  assert.equal(Core.normalizeHex(42), null);
});

test('hex ↔ rgb round trip', () => {
  assert.deepEqual(Core.hexToRgb('#ff8001'), [255, 128, 1]);
  assert.equal(Core.rgbToHex(255, 128, 1), '#ff8001');
  assert.equal(Core.rgbToHex(300, -5, 12.6), '#ff000d'); // clamps + rounds
});

/* ── OKLCH ──────────────────────────────────────────────── */
test('oklch round trip stays within 1 RGB step per channel', () => {
  const samples = ['#000000', '#ffffff', '#cc0044', '#0066cc', '#ccff00', '#123456', '#e8e4df'];
  for (const hex of samples) {
    const [L, C, H] = Core.hexToOklch(hex);
    const back = Core.oklchToHex(L, C, H);
    const a = Core.hexToRgb(hex), b = Core.hexToRgb(back);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(a[i] - b[i]) <= 1, `${hex} → ${back} channel ${i}`);
    }
  }
});

test('oklch lightness ordering is sane', () => {
  assert.ok(Core.hexToOklch('#ffffff')[0] > 0.99);
  assert.ok(Core.hexToOklch('#000000')[0] < 0.01);
  assert.ok(Core.hexToOklch('#888888')[0] > 0.4);
});

/* ── WCAG ───────────────────────────────────────────────── */
test('contrast matches canonical values', () => {
  assert.equal(Core.contrast('#000000', '#ffffff'), 21);
  assert.equal(Core.contrast('#ffffff', '#ffffff'), 1);
  const midGray = Core.contrast('#767676', '#ffffff'); // canonical ≈4.54:1
  assert.ok(midGray > 4.5 && midGray < 4.6, String(midGray));
});

test('wcagLevel thresholds', () => {
  assert.equal(Core.wcagLevel(7.0), 'AAA');
  assert.equal(Core.wcagLevel(4.5), 'AA');
  assert.equal(Core.wcagLevel(4.49), 'FAIL');
});

test('bestTextOn picks the readable ink', () => {
  assert.equal(Core.bestTextOn('#000000'), '#ffffff');
  assert.equal(Core.bestTextOn('#ffffff'), '#000000');
  assert.equal(Core.bestTextOn('#ccff00'), '#000000'); // volt needs ink (v1 shipped white-adjacent bugs here)
  assert.equal(Core.bestTextOn('#0057ad'), '#ffffff');
});

/* ── Palette model ──────────────────────────────────────── */
test('sanitizePalette accepts good, rejects bad', () => {
  const good = { bgLight: '#fff', textPrimary: '#111', primary: '#0057AD', accent1: '#C20043', bgDark: '#000' };
  const clean = Core.sanitizePalette(good);
  assert.equal(clean.bgLight, '#ffffff');
  assert.equal(clean.primary, '#0057ad');
  assert.equal(Core.sanitizePalette({ ...good, primary: 'blue' }), null);
  assert.equal(Core.sanitizePalette(null), null);
  assert.equal(Core.sanitizePalette({}), null);
});

test('every shipped preset passes its own WCAG bar', () => {
  for (const preset of Core.PRESETS) {
    const p = preset.colors;
    assert.ok(Core.contrast(p.textPrimary, p.bgLight) >= 7, `${preset.id} text ${Core.contrast(p.textPrimary, p.bgLight)}`);
    assert.ok(Core.contrast(p.primary, p.bgLight) >= 4.5, `${preset.id} primary ${Core.contrast(p.primary, p.bgLight)}`);
    assert.ok(Core.contrast(p.accent1, p.bgLight) >= 4.5, `${preset.id} accent ${Core.contrast(p.accent1, p.bgLight)}`);
  }
});

/* ── Enforcement ────────────────────────────────────────── */
test('enforceWCAG fixes a failing palette on a light bg', () => {
  const bad = { bgLight: '#f4f4f6', textPrimary: '#cccccc', primary: '#dddddd', accent1: '#eeeeee', bgDark: '#000000' };
  const { palette, failed } = Core.enforceWCAG(bad);
  assert.equal(failed.length, 0);
  assert.ok(Core.contrast(palette.textPrimary, palette.bgLight) >= 7);
  assert.ok(Core.contrast(palette.primary, palette.bgLight) >= 4.5);
  assert.ok(Core.contrast(palette.accent1, palette.bgLight) >= 4.5);
});

test('enforceWCAG works when the “light” background is dark (v1 could not)', () => {
  const inverted = { bgLight: '#101014', textPrimary: '#2a2a2e', primary: '#333340', accent1: '#40332e', bgDark: '#000000' };
  const { palette, failed } = Core.enforceWCAG(inverted);
  assert.equal(failed.length, 0);
  assert.ok(Core.contrast(palette.textPrimary, palette.bgLight) >= 7, 'text must lighten on dark bg');
});

test('fitContrast leaves already-passing colors untouched', () => {
  const res = Core.fitContrast('#111111', '#ffffff', 7);
  assert.equal(res.hex, '#111111');
  assert.equal(res.ok, true);
});

/* ── Generation ─────────────────────────────────────────── */
test('randomPalette is always WCAG-safe (200 rolls)', () => {
  for (let i = 0; i < 200; i++) {
    const p = Core.randomPalette();
    assert.ok(Core.contrast(p.textPrimary, p.bgLight) >= 7, `roll ${i} text`);
    assert.ok(Core.contrast(p.primary, p.bgLight) >= 4.5, `roll ${i} primary`);
    assert.ok(Core.contrast(p.accent1, p.bgLight) >= 4.5, `roll ${i} accent`);
  }
});

test('randomPalette respects locks', () => {
  const current = Core.PRESETS[0].colors;
  const p = Core.randomPalette(Math.random, { primary: true }, current);
  assert.equal(p.primary, current.primary);
});

test('rotateHues shifts hue and honors locks', () => {
  const p = Core.PRESETS[0].colors;
  const rotated = Core.rotateHues(p, 30, { bgDark: true });
  assert.equal(rotated.bgDark, p.bgDark);
  const h1 = Core.hexToOklch(p.primary)[2];
  const h2 = Core.hexToOklch(rotated.primary)[2];
  const shift = Math.abs(((h2 - h1 + 540) % 360) - 180); // 0..180 hue distance
  assert.ok(Math.abs(shift - 30) < 12, `expected ≈30° shift, got ${shift}`);
});

/* ── Ramps ──────────────────────────────────────────────── */
test('ramp: 11 steps, strictly darkening', () => {
  const steps = Core.ramp('#0057ad');
  assert.equal(steps.length, 11);
  assert.deepEqual(steps.map(s => s.step), [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]);
  for (let i = 1; i < steps.length; i++) {
    assert.ok(Core.luminance(steps[i].hex) < Core.luminance(steps[i - 1].hex), `step ${steps[i].step} darker than ${steps[i - 1].step}`);
  }
});

/* ── CVD ────────────────────────────────────────────────── */
test('cvd filter values are 4×5 matrices', () => {
  for (const type of ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia']) {
    const v = Core.cvdFilterValues(type).split(' ').map(Number);
    assert.equal(v.length, 20);
    assert.ok(v.every(n => Number.isFinite(n)));
  }
  assert.equal(Core.cvdFilterValues('none'), null);
});

/* ── Quantize / image ───────────────────────────────────── */
test('quantize finds the dominant colors of synthetic pixels', () => {
  // 60% red, 30% blue, 10% white
  const px = [];
  for (let i = 0; i < 600; i++) px.push(200, 20, 20, 255);
  for (let i = 0; i < 300; i++) px.push(20, 20, 200, 255);
  for (let i = 0; i < 100; i++) px.push(250, 250, 250, 255);
  const out = Core.quantize(new Uint8ClampedArray(px), 3);
  assert.ok(out.length >= 2);
  const [r] = Core.hexToRgb(out[0]);
  assert.ok(r > 150, `dominant should be reddish, got ${out[0]}`);
});

test('quantize ignores transparent pixels and empty input', () => {
  assert.deepEqual(Core.quantize(new Uint8ClampedArray([10, 10, 10, 0]), 3), []);
  assert.deepEqual(Core.quantize(new Uint8ClampedArray([]), 3), []);
});

test('paletteFromSwatches returns a WCAG-safe palette', () => {
  const pal = Core.paletteFromSwatches(['#dd3355', '#3355dd', '#f0ead8', '#22201c']);
  assert.ok(pal);
  assert.ok(Core.contrast(pal.textPrimary, pal.bgLight) >= 7);
  assert.ok(Core.contrast(pal.primary, pal.bgLight) >= 4.5);
  assert.equal(Core.paletteFromSwatches([]), null);
});

/* ── Exporters ──────────────────────────────────────────── */
const pal = Core.PRESETS[0].colors;

test('toCSS matches v1 variable names; ramps opt-in', () => {
  const css = Ex.toCSS(pal, false);
  for (const v of ['--bg-light', '--text-primary', '--primary', '--accent-1', '--bg-dark']) {
    assert.ok(css.includes(v + ': #'), v);
  }
  assert.ok(!css.includes('-500:'));
  const withRamps = Ex.toCSS(pal, true);
  assert.ok(withRamps.includes('--primary-500:'));
  assert.ok(withRamps.includes('--bg-dark-950:'));
});

test('toSCSS / toTailwind4 / toTailwind3 shapes', () => {
  assert.ok(Ex.toSCSS(pal, false).includes('$bg_light: #'));
  assert.ok(Ex.toSCSS(pal, true).includes('$primary_scale: ('));
  assert.ok(Ex.toTailwind4(pal, false).startsWith('@theme {'));
  assert.ok(Ex.toTailwind4(pal, true).includes('--color-primary-500:'));
  const tw3 = Ex.toTailwind3(pal, true);
  assert.ok(tw3.includes('module.exports'));
  assert.ok(tw3.includes('"500"'));
});

test('toTokensJSON is valid W3C-style JSON', () => {
  const doc = JSON.parse(Ex.toTokensJSON(pal, true, { name: 'Test' }));
  assert.equal(doc.color['bg-light'].$type, 'color');
  assert.equal(doc.color['bg-light'].$value, pal.bgLight);
  assert.ok(doc.color['primary-scale']['500'].$value.startsWith('#'));
});

test('toJS and toSVG are well-formed', () => {
  const js = Ex.toJS(pal, true);
  assert.ok(js.includes('export const palette'));
  assert.ok(js.includes('export const scales'));
  const svg = Ex.toSVG(pal, 'My <palette> & co');
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('&lt;palette&gt; &amp; co')); // escaped
  assert.ok(!svg.includes('<palette>'));
});

/* ── Share codec ────────────────────────────────────────── */
test('share codec round-trips, rejects garbage', () => {
  const enc = Ex.encodeShare(pal, 'Bränd — name ✓');
  const dec = Ex.decodeShare(enc);
  assert.deepEqual(dec.palette, Core.sanitizePalette(pal));
  assert.equal(dec.name, 'Bränd — name ✓');
  assert.equal(Ex.decodeShare('not-base64!!'), null);
  assert.equal(Ex.decodeShare(Buffer.from('{"v":9}').toString('base64url')), null);
});

/* ── Import parser ──────────────────────────────────────── */
test('parseImport: our own CSS export round-trips', () => {
  const res = Ex.parseImport(Ex.toCSS(pal, false));
  assert.equal(res.source, 'css');
  assert.deepEqual(res.palette, Core.sanitizePalette(pal));
});

test('parseImport: exported tokens JSON round-trips', () => {
  const res = Ex.parseImport(Ex.toTokensJSON(pal, false, {}));
  assert.equal(res.source, 'tokens-json');
  assert.deepEqual(res.palette, Core.sanitizePalette(pal));
});

test('parseImport: raw palette JSON and hex lists', () => {
  assert.equal(Ex.parseImport(JSON.stringify(pal)).source, 'json');
  const hexRes = Ex.parseImport('here: #dd3355 and #3355dd plus #f0ead8, #22201c.');
  assert.equal(hexRes.source, 'hexlist');
  assert.ok(Core.sanitizePalette(hexRes.palette));
  assert.ok(Ex.parseImport('nothing here').error);
  assert.ok(Ex.parseImport('').error);
});

/* ── Licensing ──────────────────────────────────────────── */
test('sign → verify round-trip; tamper and wrong-key rejection', async () => {
  const pair = await Lic.generateKeyPair();
  const key = await Lic.signKey({ p: 'pro', n: 'Unit Test', gift: true }, pair.privateKey);
  assert.ok(key.startsWith('CSLCT2.'));

  const ok = await Lic.verifySignedKey(key, pair.publicKey);
  assert.equal(ok.valid, true);
  assert.equal(ok.payload.p, 'pro');
  assert.equal(ok.payload.gift, true);
  assert.equal(ok.payload.n, 'Unit Test');

  // tampered payload (upgrade attempt) must fail
  const parts = key.split('.');
  const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  payload.p = 'studio';
  const forged = [parts[0], Buffer.from(JSON.stringify(payload)).toString('base64url'), parts[2]].join('.');
  const bad = await Lic.verifySignedKey(forged, pair.publicKey);
  assert.equal(bad.valid, false);
  assert.equal(bad.reason, 'signature');

  // wrong public key must fail
  const other = await Lic.generateKeyPair();
  const wrong = await Lic.verifySignedKey(key, other.publicKey);
  assert.equal(wrong.valid, false);
});

test('expired keys are rejected with reason', async () => {
  const pair = await Lic.generateKeyPair();
  const key = await Lic.signKey({ p: 'pro', exp: Date.now() - 1000 }, pair.privateKey);
  const res = await Lic.verifySignedKey(key, pair.publicKey);
  assert.equal(res.valid, false);
  assert.equal(res.reason, 'expired');
});

test('malformed keys and missing config fail gracefully', async () => {
  const pair = await Lic.generateKeyPair();
  assert.equal((await Lic.verifySignedKey('CSLCT2.onlyonepart', pair.publicKey)).reason, 'format');
  assert.equal((await Lic.verifySignedKey('WRONG.a.b', pair.publicKey)).reason, 'format');
  assert.equal((await Lic.verifySignedKey('CSLCT2.!!!.###', pair.publicKey)).reason, 'format');
  assert.equal((await Lic.verifySignedKey('CSLCT2.a.b', '')).reason, 'not-configured');
});

test('gumroad key format detection', () => {
  assert.equal(Lic.looksLikeGumroadKey('85DB562A-C11D4B06-A2335A6B-8C079166'), true);
  assert.equal(Lic.looksLikeGumroadKey('85db562a-c11d4b06-a2335a6b-8c079166'), true);
  assert.equal(Lic.looksLikeGumroadKey('CSLCT2.aaa.bbb'), false);
  assert.equal(Lic.looksLikeGumroadKey('short'), false);
});

test('keyFromLocation parses hash and query forms', () => {
  assert.equal(Lic.keyFromLocation({ hash: '#key=abc%20def', search: '' }), 'abc def');
  assert.equal(Lic.keyFromLocation({ hash: '#p=xyz&key=k2', search: '' }), 'k2');
  assert.equal(Lic.keyFromLocation({ hash: '', search: '?key=q1' }), 'q1');
  assert.equal(Lic.keyFromLocation({ hash: '', search: '' }), null);
});
