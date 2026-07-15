/* ============================================================
   ColorSLCT e2e suite — drives the real product in Chromium.
   Covers: every page loading clean, consent both ways, all
   studio actions, pro gates, licensing (mint→activate→gift→
   deactivate), share round-trip, tour, prefs, mobile.
   ============================================================ */
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

const require = createRequire(import.meta.url);
const Lic = require('../assets/js/license.js');

/* Pre-seed: consent given + tour done, so studio tests aren't blocked.
   Individual tests override when they test the banner/tour themselves. */
const seeded = (extra = {}) => ({
  storageState: {
    cookies: [],
    origins: [{
      origin: 'http://127.0.0.1:8899',
      localStorage: [
        { name: 'cslct.consent', value: '"all"' },
        { name: 'cslct.tour', value: '"done"' },
        ...Object.entries(extra).map(([name, value]) => ({ name, value }))
      ]
    }]
  }
});

function collectErrors(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

/* ─────────────────────── Pages load clean ─────────────────── */
test.describe('every page loads without errors', () => {
  test.use(seeded());
  for (const path of ['/index.html', '/app.html', '/unlock.html', '/privacy.html', '/terms.html', '/404.html', '/tools/keygen.html']) {
    test(`loads clean: ${path}`, async ({ page }) => {
      const errors = collectErrors(page);
      const res = await page.goto(path);
      expect(res.status()).toBe(200);
      await page.waitForLoadState('networkidle');
      expect(errors).toEqual([]);
    });
  }

  test('unknown path serves the 404 page', async ({ page }) => {
    const res = await page.goto('/definitely-not-a-page');
    expect(res.status()).toBe(404);
    await expect(page.locator('.err-code')).toHaveText('404');
    await page.click('text=Go home');
    await expect(page).toHaveURL(/index\.html/);
  });
});

/* ─────────────────────── Consent banner ───────────────────── */
test.describe('consent', () => {
  test('accept → persists and unlocks storage', async ({ page }) => {
    await page.goto('/index.html');
    const banner = page.locator('#cslctConsent');
    await expect(banner).toBeVisible();
    await page.click('#consentAll');
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(page.locator('#cslctConsent')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('cslct.consent'))).toBe('"all"');
  });

  test('essentials-only → optional keys are not persisted', async ({ page }) => {
    await page.goto('/index.html');
    await page.click('#consentEssential');
    expect(await page.evaluate(() => localStorage.getItem('cslct.consent'))).toBe('"essential"');
    await page.evaluate(() => CSLCT.store.set('cslct.theme', 'light'));
    expect(await page.evaluate(() => localStorage.getItem('cslct.theme'))).toBe(null);
  });

  test('footer "Storage choices" reopens the banner', async ({ page }) => {
    await page.goto('/index.html');
    await page.click('#consentAll');
    await page.locator('.site-footer [data-open-consent]').click();
    await expect(page.locator('#cslctConsent')).toBeVisible();
  });
});

/* ─────────────────────── Landing page ─────────────────────── */
test.describe('landing', () => {
  test.use(seeded());

  test('hero, marquee, pricing from config, demo works', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page).toHaveTitle(/ColorSLCT/);
    await expect(page.locator('.hero-title')).toContainText(/Color is/i);

    // pricing rendered from config
    await expect(page.locator('#tierGrid [data-price="pro"]')).toHaveText('$29');
    await expect(page.locator('#tierGrid [data-price="studio"]')).toHaveText('$79');

    // live demo actually generates
    const firstHex = await page.locator('#demoStrip i').first().textContent();
    await page.click('#demoShuffle');
    const secondHex = await page.locator('#demoStrip i').first().textContent();
    expect(secondHex).not.toBe(firstHex);
    await expect(page.locator('#demoBadge')).toContainText(/:1/);
    expect(await page.locator('#demoOpen').getAttribute('href')).toContain('#p=');

    // FAQ accordion
    const faq = page.locator('.faq-list details').first();
    await faq.locator('summary').click();
    await expect(faq).toHaveAttribute('open', '');
  });

  test('internal links all resolve', async ({ page, request }) => {
    await page.goto('/index.html');
    const hrefs = await page.$$eval('a[href]', (as) => as.map(a => a.getAttribute('href')));
    const internal = [...new Set(hrefs.filter(h => h && !h.startsWith('http') && !h.startsWith('mailto') && !h.startsWith('#')))];
    for (const href of internal) {
      const res = await request.get('/' + href.split('#')[0]);
      expect(res.status(), href).toBe(200);
    }
  });

  test('theme toggle flips and persists', async ({ page }) => {
    await page.goto('/index.html');
    await page.locator('.nav-cta .theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});

/* ─────────────────────── Studio: core loop ────────────────── */
test.describe('studio core', () => {
  test.use(seeded());

  test('rail renders 5 tokens with the default preset', async ({ page }) => {
    await page.goto('/app.html');
    await expect(page.locator('.rail-bar')).toHaveCount(5);
    await expect(page.locator('.rail-bar').first()).toContainText('#F4F4F6');
  });

  test('shuffle → undo → redo → history strip', async ({ page }) => {
    await page.goto('/app.html');
    const hexOf = () => page.locator('.rail-bar[data-token="primary"] .rb-hex').textContent();
    const before = await hexOf();
    await page.click('#actRandom');
    const after = await hexOf();
    expect(after).not.toBe(before);

    await expect(page.locator('#actUndo')).toBeEnabled();
    await page.click('#actUndo');
    expect(await hexOf()).toBe(before);
    await page.click('#actRedo');
    expect(await hexOf()).toBe(after);

    await expect(page.locator('.history-dot').first()).toBeVisible();
    await page.click('#actRandom');
    await page.locator('.history-dot').first().click();
    await expect(page.locator('#toast, .toast')).toContainText(/restored/i);
  });

  test('keyboard shortcuts: R shuffles, Ctrl+Z undoes', async ({ page }) => {
    await page.goto('/app.html');
    const hexOf = () => page.locator('.rail-bar[data-token="primary"] .rb-hex').textContent();
    const before = await hexOf();
    await page.keyboard.press('r');
    expect(await hexOf()).not.toBe(before);
    await page.keyboard.press('Control+z');
    expect(await hexOf()).toBe(before);
  });

  test('harmony rotates hues', async ({ page }) => {
    await page.goto('/app.html');
    const before = await page.locator('.rail-bar[data-token="primary"] .rb-hex').textContent();
    await page.click('#actHarmony');
    const after = await page.locator('.rail-bar[data-token="primary"] .rb-hex').textContent();
    expect(after).not.toBe(before);
  });

  test('WCAG auto toggle enforces immediately and on new palettes', async ({ page }) => {
    await page.goto('/app.html');
    // break the text color via editor
    await page.click('.rail-bar[data-token="textPrimary"]');
    await page.fill('#editorHex', '#cccccc');
    await page.press('#editorHex', 'Enter');
    await page.click('#editorModal .modal-x');
    await page.click('#actWcag');
    await expect(page.locator('#wcagState')).toHaveText('ON');
    const fixed = await page.locator('.rail-bar[data-token="textPrimary"] .rb-hex').textContent();
    expect(fixed.toLowerCase()).not.toBe('#cccccc');
    // contrast list shows all pass for text row
    await expect(page.locator('.contrast-row').first().locator('.badge')).toContainText(/AA/);
  });

  test('auto-fix button repairs a failing palette', async ({ page }) => {
    await page.goto('/app.html');
    await page.click('.rail-bar[data-token="primary"]');
    await page.fill('#editorHex', '#eeeeee');
    await page.press('#editorHex', 'Enter');
    await page.click('#editorModal .modal-x');
    await page.click('#actFixContrast');
    const hex = await page.locator('.rail-bar[data-token="primary"] .rb-hex').textContent();
    expect(hex.toLowerCase()).not.toBe('#eeeeee');
  });

  test('editor: typed hex applies, invalid reverts, lock survives shuffle', async ({ page }) => {
    await page.goto('/app.html');
    await page.click('.rail-bar[data-token="accent1"]');
    await page.fill('#editorHex', '123456');
    await page.press('#editorHex', 'Enter');
    await expect(page.locator('.rail-bar[data-token="accent1"] .rb-hex')).toHaveText('#123456');

    await page.fill('#editorHex', 'zzz');
    await page.press('#editorHex', 'Enter');
    await expect(page.locator('#editorHex')).toHaveValue('#123456'); // reverted

    await page.click('#editorLock');
    await expect(page.locator('#editorLockLabel')).toHaveText('Locked');
    await page.click('#editorModal .modal-x');
    await page.click('#actRandom');
    await expect(page.locator('.rail-bar[data-token="accent1"] .rb-hex')).toHaveText('#123456');
  });

  test('editor copy chips and compare', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/app.html');
    await page.click('.rail-bar[data-token="primary"]');
    await expect(page.locator('#editorCopyChips .chip')).toHaveCount(4);
    await page.locator('#editorCopyChips .chip').first().click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toMatch(/^#[0-9A-F]{6}$/i);

    await page.click('#editorCompare');
    await page.click('#editorModal .modal-x');
    await expect(page.locator('#compareCount')).toHaveText('1 / 4');
    await page.locator('.compare-swatch .remove-sw').click();
    await expect(page.locator('#compareCount')).toHaveText('0 / 4');
  });

  test('presets modal applies BNDR', async ({ page }) => {
    await page.goto('/app.html');
    await page.click('#actPresets');
    await page.click('[data-preset="bndr"]');
    await expect(page.locator('.rail-bar[data-token="bgLight"] .rb-hex')).toHaveText('#E8E4DF');
  });

  test('import: pasted hexes become a palette', async ({ page }) => {
    await page.goto('/app.html');
    await page.click('#actImport');
    await page.fill('#importText', '#dd3355 #3355dd #f0ead8 #22201c');
    await page.click('#importApply');
    await expect(page.locator('#importModal')).toBeHidden();
    await expect(page.locator('.toast')).toContainText(/Imported/);
  });

  test('import: garbage shows friendly error, modal stays', async ({ page }) => {
    await page.goto('/app.html');
    await page.click('#actImport');
    await page.fill('#importText', 'the cat sat on the mat');
    await page.click('#importApply');
    await expect(page.locator('#importStatus')).toContainText(/Couldn’t find colors/);
  });

  test('AI modal: validates key requirement, closes clean', async ({ page }) => {
    await page.goto('/app.html');
    await page.click('#actAI');
    await page.click('#aiGenerate');
    await expect(page.locator('#aiStatus')).toContainText(/API key/i);
    await page.keyboard.press('Escape');
    await expect(page.locator('#aiModal')).toBeHidden();
  });

  test('share link round-trips into a fresh page', async ({ page, context }) => {
    await page.goto('/app.html');
    await page.click('#actRandom');
    const hex = (await page.locator('.rail-bar[data-token="primary"] .rb-hex').textContent()).toLowerCase();
    await page.click('#actShare');
    const url = await page.locator('#shareUrl').inputValue();
    expect(url).toContain('#p=');
    const page2 = await context.newPage();
    await page2.goto(url);
    await expect(page2.locator('.rail-bar[data-token="primary"] .rb-hex')).toHaveText(hex.toUpperCase());
    await page2.close();
  });

  test('save → library card → apply/rename/duplicate/delete', async ({ page }) => {
    await page.goto('/app.html');
    await page.click('#actSave');
    await page.fill('#saveName', 'Client X');
    await page.click('#saveConfirm');
    await expect(page.locator('.lib-card')).toHaveCount(1);
    await expect(page.locator('.lib-name')).toHaveText('Client X');

    page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Client Y' : undefined));
    await page.click('[data-lib-rename]');
    await expect(page.locator('.lib-name')).toHaveText('Client Y');

    await page.click('[data-lib-dup]');
    await expect(page.locator('.lib-card')).toHaveCount(2);

    await page.click('[data-lib-apply]');
    await expect(page.locator('.toast')).toContainText(/applied/i);

    await page.locator('[data-lib-del]').first().click();
    await expect(page.locator('.lib-card')).toHaveCount(1);
  });

  test('free library limit gates at 3', async ({ page }) => {
    await page.goto('/app.html');
    for (let i = 0; i < 3; i++) {
      await page.click('#actSave');
      await page.fill('#saveName', `Pal ${i}`);
      await page.click('#saveConfirm');
    }
    await expect(page.locator('.lib-card')).toHaveCount(3);
    await page.click('#actSave');
    await expect(page.locator('#gateModal')).toBeVisible();
  });

  test('export: CSS free, locked formats gate, download fires', async ({ page }) => {
    await page.goto('/app.html');
    await page.click('#actExport');
    await expect(page.locator('#exportOutput')).toContainText('--bg-light:');
    await page.locator('[data-format="tw4"]').click();
    await expect(page.locator('#gateModal')).toBeVisible();
    await page.click('#gateModal .modal-x');

    const dl = page.waitForEvent('download');
    await page.click('#exportDownload');
    expect((await dl).suggestedFilename()).toBe('colorslct-palette.css');
  });

  test('pro gates: image chip, CVD select, ramps veil, PNG', async ({ page }) => {
    await page.goto('/app.html');
    await expect(page.locator('#rampsVeil')).toBeVisible();

    await page.click('#actImage');
    await expect(page.locator('#gateModal')).toBeVisible();
    await page.click('#gateModal .modal-x');

    await page.selectOption('#cvdSelect', 'protanopia');
    await expect(page.locator('#gateModal')).toBeVisible();
    expect(await page.locator('#cvdSelect').inputValue()).toBe('none');
    await page.click('#gateModal .modal-x');

    await page.click('#actExport');
    await page.click('#exportPng');
    await expect(page.locator('#gateModal')).toBeVisible();
  });

  test('preferences: light theme + calm mode persist', async ({ page }) => {
    await page.goto('/app.html');
    await page.click('#actPrefs');
    await page.click('#prefLight');
    await page.check('#prefMotion');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  });

  test('help modal lists shortcuts', async ({ page }) => {
    await page.goto('/app.html');
    await page.click('#helpBtn');
    await expect(page.locator('.shortcut-table')).toContainText('Shuffle');
    await page.keyboard.press('Escape');
  });

  test('modal focus trap holds Tab inside', async ({ page }) => {
    await page.goto('/app.html');
    await page.click('#actExport');
    for (let i = 0; i < 30; i++) await page.keyboard.press('Tab');
    const inModal = await page.evaluate(() => !!document.activeElement.closest('#exportModal'));
    expect(inModal).toBe(true);
  });
});

/* ─────────────────────── Tour ─────────────────────────────── */
test.describe('welcome tour', () => {
  test('runs on first visit after consent, completes, never re-runs', async ({ page }) => {
    await page.goto('/app.html');
    await page.click('#consentAll'); // banner first
    await expect(page.locator('.tour-card')).toBeVisible();
    await expect(page.locator('.tour-card h3')).toContainText(/Welcome/);

    // walk every step
    for (let i = 0; i < 12; i++) {
      const btn = page.locator('[data-tour-next]');
      const label = await btn.textContent();
      await btn.click();
      if (label.trim() === 'Finish') break;
    }
    await expect(page.locator('.tour-veil')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('cslct.tour'))).toBe('"done"');

    await page.reload();
    await page.waitForTimeout(900);
    await expect(page.locator('.tour-veil')).toHaveCount(0);
  });

  test('replay from help, skip works', async ({ page, context }) => {
    await context.addInitScript(() => {
      localStorage.setItem('cslct.consent', '"all"');
      localStorage.setItem('cslct.tour', '"done"');
    });
    await page.goto('/app.html');
    await page.click('#helpBtn');
    await page.click('#helpTour');
    await expect(page.locator('.tour-card')).toBeVisible();
    await page.click('[data-tour-skip]');
    await expect(page.locator('.tour-veil')).toHaveCount(0);
  });
});

/* ─────────────────────── Licensing ────────────────────────── */
test.describe('licensing', () => {
  let pair, proKey, giftKey, studioKey;

  test.beforeAll(async () => {
    pair = await Lic.generateKeyPair();
    proKey = await Lic.signKey({ p: 'pro', n: 'E2E Buyer' }, pair.privateKey);
    giftKey = await Lic.signKey({ p: 'pro', gift: true, n: 'Giftee' }, pair.privateKey);
    studioKey = await Lic.signKey({ p: 'studio' }, pair.privateKey);
  });

  const withPubkey = async (context) => {
    await context.addInitScript((pub) => {
      window.CSLCT_CONFIG_OVERRIDE = { LICENSE_PUBLIC_KEY: pub };
      localStorage.setItem('cslct.consent', '"all"');
      localStorage.setItem('cslct.tour', '"done"');
    }, pair.publicKey);
  };

  test('paste a minted key → Pro unlocks everything', async ({ page, context }) => {
    await withPubkey(context);
    await page.goto('/unlock.html');
    await page.fill('#keyInput', proKey);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemStatus')).toContainText(/You’re in/);
    await expect(page.locator('#statusPanel')).toBeVisible();
    await expect(page.locator('#statusText')).toContainText('E2E Buyer');

    // auto-redirects to the studio
    await page.waitForURL(/app\.html/);
    await expect(page.locator('#planBadge')).toHaveText('PRO');
    await expect(page.locator('#rampsVeil')).toBeHidden();

    // pro features now live
    await page.selectOption('#cvdSelect', 'protanopia');
    await expect(page.locator('#gateModal')).toBeHidden();
    const filter = await page.locator('#previewGrid').evaluate((el) => el.style.filter);
    expect(filter).toContain('cvd-protanopia');

    await page.click('#actExport');
    await page.locator('[data-format="tw4"]').click();
    await expect(page.locator('#exportOutput')).toContainText('@theme {');
    await page.check('#exportRamps');
    await expect(page.locator('#exportOutput')).toContainText('-500:');

    const dl = page.waitForEvent('download');
    await page.click('#exportPng');
    expect((await dl).suggestedFilename()).toBe('colorslct-palette.png');
  });

  test('gift deep link auto-activates with the warm message', async ({ page, context }) => {
    await withPubkey(context);
    await page.goto('/unlock.html#key=' + encodeURIComponent(giftKey));
    await expect(page.locator('#redeemStatus')).toContainText(/Gift accepted/);
    await page.waitForURL(/app\.html/);
    await expect(page.locator('#planBadge')).toHaveText('PRO');
  });

  test('studio key shows STUDIO badge; deactivate returns to FREE', async ({ page, context }) => {
    await withPubkey(context);
    await page.goto('/unlock.html');
    await page.fill('#keyInput', studioKey);
    await page.click('#redeemBtn');
    await page.waitForURL(/app\.html/);
    await expect(page.locator('#planBadge')).toHaveText('STUDIO');

    await page.goto('/unlock.html');
    page.on('dialog', (d) => d.accept());
    await page.click('#deactivateBtn');
    await expect(page.locator('#statusPanel')).toBeHidden();
    await page.goto('/app.html');
    await expect(page.locator('#planBadge')).toHaveText('FREE');
  });

  test('tampered and malformed keys are refused with human messages', async ({ page, context }) => {
    await withPubkey(context);
    await page.goto('/unlock.html');
    const forged = proKey.slice(0, -6) + 'AAAAAA';
    await page.fill('#keyInput', forged);
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemStatus')).toContainText(/isn’t valid/);

    await page.fill('#keyInput', 'hello there');
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemStatus')).toContainText(/format isn’t recognised/);
  });

  test('unconfigured buy buttons stay honest (no dead links)', async ({ page, context }) => {
    await withPubkey(context);
    await page.goto('/unlock.html');
    await expect(page.locator('#buyProStripe')).toHaveAttribute('aria-disabled', 'true');
    await page.click('#buyProStripe');
    await expect(page).toHaveURL(/unlock\.html/); // did not navigate
    await expect(page.locator('.toast')).toContainText(/isn’t open yet/);
  });

  test('configured buy buttons become real links', async ({ page, context }) => {
    await context.addInitScript(() => {
      window.CSLCT_CONFIG_OVERRIDE = {
        STRIPE_PAYMENT_LINK_PRO: 'https://buy.stripe.com/test_pro',
        GUMROAD_PRODUCT_URL: 'https://bndr.gumroad.com/l/colorslct'
      };
      localStorage.setItem('cslct.consent', '"all"');
    });
    await page.goto('/unlock.html');
    await expect(page.locator('#buyProStripe')).toHaveAttribute('href', 'https://buy.stripe.com/test_pro');
    await expect(page.locator('#buyProGumroad')).toHaveAttribute('href', /gumroad\.com/);
    await expect(page.locator('#buyProStripe')).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('gumroad-shaped key without config explains itself', async ({ page, context }) => {
    await withPubkey(context);
    await page.goto('/unlock.html');
    await page.fill('#keyInput', '85DB562A-C11D4B06-A2335A6B-8C079166');
    await page.click('#redeemBtn');
    await expect(page.locator('#redeemStatus')).toContainText(/isn’t switched on/);
  });
});

/* ─────────────────────── Owner keygen console ─────────────── */
test.describe('owner console', () => {
  test('create keys → mint gift key → sanity-check verifies it', async ({ page }) => {
    await page.goto('/tools/keygen.html');
    await page.click('#genKeys');
    await expect(page.locator('#kpState')).toHaveText('READY');
    const pub = await page.locator('#pubKey').textContent();
    expect(pub.length).toBeGreaterThan(80);

    await page.check('#mintGift');
    await page.fill('#siteUrl', 'https://colorslct.example.com');
    await page.click('#mintBtn');
    await expect(page.locator('.kg-out-item')).toHaveCount(1);
    const minted = await page.locator('.kg-out-item .kg-key').first().textContent();
    expect(minted.startsWith('CSLCT2.')).toBe(true);
    await expect(page.locator('.kg-out-item')).toContainText('unlock.html#key=');

    await page.fill('#checkKey', minted);
    await page.click('#checkBtn');
    await expect(page.locator('#checkStatus')).toContainText('✓ Valid PRO gift key');
  });
});

/* ─────────────────────── Mobile ───────────────────────────── */
test.describe('mobile (390×844)', () => {
  test.use({ ...seeded(), viewport: { width: 390, height: 844 } });

  test('landing: no horizontal scroll, burger menu navigates', async ({ page }) => {
    await page.goto('/index.html');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.click('.nav-burger');
    await expect(page.locator('.mobile-menu')).toBeVisible();
    await page.click('.mobile-menu a[href="app.html"]');
    await expect(page).toHaveURL(/app\.html/);
  });

  test('studio: usable, no horizontal scroll, deck scrolls', async ({ page }) => {
    await page.goto('/app.html');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator('.rail-bar')).toHaveCount(5);
    await page.click('#actRandom');
    await page.click('.rail-bar[data-token="primary"]');
    await expect(page.locator('#editorModal')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('tiny viewport 320px still fits', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    for (const path of ['/index.html', '/app.html', '/unlock.html']) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
