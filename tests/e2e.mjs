/* ColorSLCT end-to-end tests — run with: node tests/e2e.mjs
   Requires: playwright (npm i playwright) + a Chromium binary. */
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const URLS = {
  landing: pathToFileURL(path.join(root, "index.html")).href,
  app: pathToFileURL(path.join(root, "app.html")).href,
  terms: pathToFileURL(path.join(root, "terms.html")).href,
  privacy: pathToFileURL(path.join(root, "privacy.html")).href,
  giftTool: pathToFileURL(path.join(root, "tools/gift-codes.html")).href,
};

function findChromium() {
  for (const bin of ["chromium", "chromium-browser", "google-chrome"]) {
    try { return execSync(`which ${bin}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null; }
    catch { /* keep looking */ }
  }
  return null; // fall back to Playwright's bundled browser
}

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; failures.push(name + (detail ? " — " + detail : "")); console.error("FAIL: " + name + (detail ? " — " + detail : "")); }
}

const executablePath = findChromium();
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

/* Each test group gets a fresh context. seed=true pre-accepts consent + marks tour done. */
async function newPage({ seed = true, viewport = { width: 1280, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  if (seed) {
    await context.addInitScript(() => {
      localStorage.setItem("cslct-consent", "accepted");
      localStorage.setItem("cslct-tour-done", "true");
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  return { page, context, errors };
}
const hexOf = (page, token) => page.$eval(`#hex-${token}`, (el) => el.value);
const toastText = (page) => page.$eval("#toast", (el) => el.textContent);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============ A. Landing: consent, demo, pricing, links ============ */
{
  const { page, context, errors } = await newPage({ seed: false });
  await page.goto(URLS.landing);
  check("landing title", /ColorSLCT/.test(await page.title()));
  await page.waitForSelector("#consentBanner", { timeout: 5000 });
  check("landing consent banner shown", await page.isVisible("#consentBanner"));
  await page.click("#consentAccept");
  await sleep(400);
  check("consent banner dismissed", !(await page.$("#consentBanner")) || !(await page.isVisible("#consentBanner")));
  check("consent persisted", (await page.evaluate(() => localStorage.getItem("cslct-consent"))) === "accepted");
  await page.reload();
  await sleep(600);
  check("consent banner not shown after accept + reload", !(await page.$("#consentBanner")));

  check("demo strip has 5 swatches", (await page.$$eval("#demoRow > div", (d) => d.length)) === 5);
  const before = await page.$eval("#demoRow", (el) => el.innerHTML);
  await page.click("#demoShuffle");
  const after = await page.$eval("#demoRow", (el) => el.innerHTML);
  check("demo shuffle changes palette", before !== after);

  await page.click("#pricingGumroad");
  await sleep(300);
  check("gumroad button graceful when unconfigured", /isn’t connected yet/.test(await toastText(page)));
  await page.click("#pricingStripe");
  await sleep(300);
  check("stripe button graceful when unconfigured", /isn’t connected yet/.test(await toastText(page)));

  for (const sel of ['a[href="app.html"]', 'a[href="terms.html"]', 'a[href="privacy.html"]', 'a[href="app.html#redeem"]']) {
    check(`landing link present: ${sel}`, !!(await page.$(sel)));
  }
  check("landing FAQ expands", await page.$$eval(".faq details", (ds) => { ds[0].open = true; return ds[0].open; }));
  check("landing year stamped", (await page.$eval("[data-year]", (el) => el.textContent)) === String(new Date().getFullYear()));
  check("landing: no console errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ============ B. Landing mobile: no horizontal overflow ============ */
{
  const { page, context, errors } = await newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(URLS.landing);
  await sleep(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("landing 390px: no horizontal overflow", overflow <= 1, `overflow ${overflow}px`);
  check("landing 390px: CTA visible", await page.isVisible("#navOpenApp"));
  check("landing mobile: no console errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ============ C. Legal pages + theme toggle ============ */
for (const [name, url] of [["terms", URLS.terms], ["privacy", URLS.privacy]]) {
  const { page, context, errors } = await newPage();
  await page.goto(url);
  check(`${name} loads with content`, (await page.$eval(".legal-content", (el) => el.textContent.length)) > 1500);
  check(`${name} links home`, !!(await page.$('a[href="index.html"]')));
  const themeBefore = await page.getAttribute("html", "data-theme");
  await page.click("[data-theme-toggle]");
  const themeAfter = await page.getAttribute("html", "data-theme");
  check(`${name} theme toggle flips`, themeBefore !== themeAfter, `${themeBefore} -> ${themeAfter}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${name}: no horizontal overflow`, overflow <= 1);
  check(`${name}: support email derives from config`, await page.$$eval("a[data-support-email]", (as) => {
    const want = "mailto:" + window.CSLCT_CONFIG.company.supportEmail;
    return as.length === 2 && as.every((a) => a.getAttribute("href") === want);
  }));
  check(`${name}: no console errors`, errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ============ D. Studio first run: consent -> full tour ============ */
{
  const { page, context, errors } = await newPage({ seed: false });
  await page.goto(URLS.app);
  await page.waitForSelector("#consentBanner", { timeout: 5000 });
  await page.click("#consentAccept");
  await page.waitForSelector("#tourOverlay.open", { timeout: 5000 });
  check("tour auto-starts on first run", true);
  let steps = 0;
  for (let i = 0; i < 10; i++) {
    steps++;
    const label = await page.$eval("#tourCard .tour-step-label", (el) => el.textContent);
    check(`tour step label ${steps}`, new RegExp(`^Step ${steps} of 7$`).test(label), label);
    const isLast = /Step 7 of 7/.test(label);
    if (isLast) {
      check("tour final step has dark-mode pref", !!(await page.$("#prefDark")));
      check("tour final step has WCAG pref", !!(await page.$("#prefWcag")));
      await page.check("#prefWcag");
      await sleep(200);
      check("tour WCAG pref drives real toggle", /ON/.test(await page.$eval("#wcagBtn", (el) => el.textContent)));
      await page.click("#tourNext"); // Finish
      break;
    }
    await page.click("#tourNext");
    await sleep(350);
  }
  check("tour walked all 7 steps", steps === 7, `walked ${steps}`);
  await sleep(300);
  check("tour closes after finish", !(await page.isVisible("#tourOverlay.open")));
  check("tour completion persisted", (await page.evaluate(() => localStorage.getItem("cslct-tour-done"))) === "true");
  await page.reload();
  await sleep(900);
  check("tour does not restart after completion", !(await page.$("#tourOverlay.open")));
  /* replay via help button */
  await page.click("#helpBtn");
  await page.waitForSelector("#tourOverlay.open", { timeout: 3000 });
  await page.click("#tourSkip");
  await sleep(200);
  check("tour replay + skip works", !(await page.isVisible("#tourOverlay.open")));
  check("studio first-run: no console errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ============ E. Consent declined: app still fully works, nothing persisted ============ */
{
  const { page, context, errors } = await newPage({ seed: false });
  await page.goto(URLS.app);
  await page.waitForSelector("#consentBanner", { timeout: 5000 });
  await page.click("#consentDecline");
  await sleep(400);
  const beforeHex = await hexOf(page, "primary");
  await page.click("#randomBtn");
  await sleep(200);
  check("declined: random still works", (await hexOf(page, "primary")) !== beforeHex);
  check("declined: state not persisted", (await page.evaluate(() => localStorage.getItem("cslct-state"))) === null);
  check("declined: choice remembered", (await page.evaluate(() => localStorage.getItem("cslct-consent"))) === "declined");
  check("studio declined: no console errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ============ F. Studio core controls ============ */
{
  const { page, context, errors } = await newPage();
  await page.goto(URLS.app);
  await sleep(400);
  const bootHex = await hexOf(page, "primary");
  check("boot palette is a designed palette, not canned", /^#[0-9a-f]{6}$/.test(bootHex) && bootHex !== "#ccff00" && bootHex !== "#0066cc");
  check("boot palette passes engine validation", await page.evaluate(() => {
    const E = window.ColorEngine; const pal = {};
    E.TOKENS.forEach((t) => { pal[t] = document.getElementById("hex-" + t).value; });
    return E.isValidPalette(pal);
  }));
  check("engine exposes no canned palettes", await page.evaluate(() => !("PRESETS" in window.ColorEngine)));
  check("boot explains its design decision", /\u00b0|°/.test(await page.$eval("#designerWhy", (el) => el.textContent)));
  {
    const second = await newPage();
    await second.page.goto(URLS.app);
    await sleep(400);
    const otherHex = await hexOf(second.page, "primary");
    check("two fresh boots design distinct palettes", otherHex !== bootHex, bootHex + " vs " + otherHex);
    await second.context.close();
  }
  check("back disabled initially", await page.$eval("#backBtn", (el) => el.disabled));

  check("preset buttons removed from action bar", (await page.$("#loadBNDR")) === null && (await page.$("#resetPro")) === null);
  check("preview mockups carry no BNDR branding", !/BNDR/.test(await page.$eval("#previewContainer", (el) => el.textContent)));

  const beforeRandom = await hexOf(page, "primary");
  await page.click("#randomBtn");
  const afterRandom = await hexOf(page, "primary");
  check("Random changes palette", afterRandom !== beforeRandom);
  check("back enabled after change", !(await page.$eval("#backBtn", (el) => el.disabled)));
  await page.click("#backBtn");
  check("Back restores previous palette", (await hexOf(page, "primary")) === beforeRandom);

  const beforeHarmony = await hexOf(page, "primary");
  await page.click("#harmonyBtn");
  check("Harmony shifts hues", (await hexOf(page, "primary")) !== beforeHarmony);

  /* history strip: restore + correct direction (v1 defect fix) */
  await page.click("#randomBtn");
  await page.click("#randomBtn");
  const dots = await page.$$("#historyStrip .history-dot");
  check("history dots appear", dots.length >= 3, `${dots.length} dots`);
  const historyLenBefore = await page.$$eval("#historyStrip .history-dot", (d) => d.length);
  await page.click('#historyStrip .history-dot[data-index="1"]');
  await sleep(150);
  const historyLenAfter = await page.$$eval("#historyStrip .history-dot", (d) => d.length);
  check("history restore trims newer entries only", historyLenAfter === historyLenBefore - 2, `${historyLenBefore} -> ${historyLenAfter}`);

  /* WCAG auto-enforcement really enforces */
  await page.fill("#hex-bgLight", "#ffffff");
  await page.fill("#hex-primary", "#ffff00"); // terrible contrast on white
  const wcagOn = /ON/.test(await page.$eval("#wcagBtn", (el) => el.textContent));
  if (!wcagOn) await page.click("#wcagBtn");
  await page.click("#randomBtn"); // any new palette must be enforced
  await sleep(150);
  const ratios = await page.evaluate(() => {
    const E = window.ColorEngine;
    const hex = (t) => document.getElementById("hex-" + t).value;
    return {
      text: E.contrast(hex("textPrimary"), hex("bgLight")),
      primary: E.contrast(hex("primary"), hex("bgLight")),
      accent: E.contrast(hex("accent1"), hex("bgLight")),
    };
  });
  check("WCAG auto: text ≥ 7:1", ratios.text >= 6.95, String(ratios.text));
  check("WCAG auto: primary ≥ 4.5:1", ratios.primary >= 4.45, String(ratios.primary));
  check("WCAG auto: accent ≥ 4.5:1", ratios.accent >= 4.45, String(ratios.accent));
  await page.click("#wcagBtn"); // off again

  /* hex typing validation */
  await page.fill("#hex-primary", "zzz");
  check("invalid hex flagged", await page.$eval("#hex-primary", (el) => el.classList.contains("invalid")));
  await page.$eval("#hex-primary", (el) => el.blur());
  check("invalid hex reverts on blur", await page.$eval("#hex-primary", (el) => /^#[0-9a-f]{6}$/.test(el.value) && !el.classList.contains("invalid")));
  await page.fill("#hex-primary", "#123456");
  check("valid hex syncs color input", (await page.$eval("#color-primary", (el) => el.value)) === "#123456");
  await page.fill("#hex-primary", "abc");
  check("3-digit hex expands", (await page.$eval("#color-primary", (el) => el.value)) === "#aabbcc");

  /* preview + contrast render */
  check("previews render (light + dark)", (await page.$$eval(".preview-card", (d) => d.length)) === 2);
  check("preview Primary button uses readable text", await page.evaluate(() => {
    const btns = [...document.querySelectorAll(".preview-btn")].filter((b) => b.textContent === "Primary");
    const t = window.ColorEngine.idealTextColor(document.getElementById("hex-primary").value);
    const want = t === "#000000" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)";
    return btns.length === 2 && btns.every((b) => getComputedStyle(b).color === want);
  }));
  check("contrast table has 6 pairs incl. dark bg", (await page.$$eval(".contrast-row", (d) => d.length)) === 6);
  check("contrast table labels dark-bg pairs", await page.$$eval(".contrast-row", (rows) => rows.some((r) => /on dark bg/.test(r.textContent))));

  /* compare bucket: add 4, cap, remove */
  const compareBtns = await page.$$(".compare-add-btn:not(.copy-hex-btn)");
  for (let i = 0; i < 4; i++) await compareBtns[i].click();
  check("compare holds 4 swatches", (await page.$$eval(".compare-swatch", (d) => d.length)) === 4);
  check("compare add disabled at cap", await page.$eval(".compare-add-btn:not(.copy-hex-btn)", (el) => el.disabled));
  await page.click(".compare-swatch .remove-sw");
  check("compare swatch removable", (await page.$$eval(".compare-swatch", (d) => d.length)) === 3);
  check("compare add re-enabled", !(await page.$eval(".compare-add-btn:not(.copy-hex-btn)", (el) => el.disabled)));

  /* copy hex button */
  await page.click(".copy-hex-btn");
  await sleep(300);
  check("copy hex shows toast", /#[0-9a-f]{6}|copied/i.test(await toastText(page)));

  check("studio controls: no console errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ============ G. Save, library, free cap ============ */
{
  const { page, context, errors } = await newPage();
  await page.goto(URLS.app);
  await sleep(400);
  for (let i = 1; i <= 3; i++) {
    await page.click("#randomBtn");
    await page.click("#saveBtn");
    await page.waitForSelector("#saveModal.open");
    await page.fill("#paletteNameInput", `Test palette ${i}`);
    await page.click("#confirmSave");
    await sleep(200);
  }
  check("3 palettes persisted", (await page.evaluate(() => JSON.parse(localStorage.getItem("cslct-palettes")).length)) === 3);
  await page.click("#saveBtn");
  await sleep(300);
  check("4th save hits free cap -> upgrade modal", await page.isVisible("#upgradeModal.open"));
  check("cap reason mentions limit", /3 palettes/.test(await page.$eval("#upgradeReason", (el) => el.textContent)));
  await page.keyboard.press("Escape");
  await sleep(200);

  await page.click("#libraryBtn");
  await page.waitForSelector("#libraryModal.open");
  check("library shows count", /3 of 3/.test(await page.$eval("#libraryCount", (el) => el.textContent)));
  check("library lists 3 items", (await page.$$eval(".library-item", (d) => d.length)) === 3);
  await page.click('.library-item [data-load]');
  await sleep(250);
  check("library load applies + closes", !(await page.isVisible("#libraryModal.open")) && /loaded/i.test(await toastText(page)));

  await page.click("#libraryBtn");
  await page.waitForSelector("#libraryModal.open");
  const delBtn = await page.$('.library-item [data-del]');
  await delBtn.click();
  check("delete requires confirm", /Sure\?/.test(await page.$eval('.library-item [data-del]', (el) => el.textContent)));
  await page.click('.library-item [data-del]');
  await sleep(200);
  check("delete after confirm removes item", (await page.$$eval(".library-item", (d) => d.length)) === 2);
  check("save/library: no console errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ============ H. Share link round-trip ============ */
{
  const { page, context, errors } = await newPage();
  await page.goto(URLS.app);
  await sleep(400);
  await page.click("#shareBtn");
  await sleep(400);
  check("share shows toast", /URL copied/i.test(await toastText(page)));
  const enc = await page.evaluate(() => {
    const E = window.ColorEngine;
    const pal = {};
    E.TOKENS.forEach((t) => { pal[t] = document.getElementById("hex-" + t).value; });
    return E.encodePalette(pal);
  });
  const page2 = await context.newPage();
  await page2.goto(URLS.app + "#p=" + enc);
  await sleep(500);
  check("share link restores palette", (await page2.$eval("#hex-primary", (el) => el.value)) === "#" + enc.split("-")[2]);
  check("share link toast confirms", /shared palette/i.test(await page2.$eval("#toast", (el) => el.textContent)));
  /* corrupted share link falls back gracefully */
  const page3 = await context.newPage();
  const p3errors = [];
  page3.on("pageerror", (e) => p3errors.push(e.message));
  await page3.goto(URLS.app + "#p=not-a-real-palette");
  await sleep(500);
  check("corrupt share link: app still boots", /^#[0-9a-f]{6}$/.test(await page3.$eval("#hex-primary", (el) => el.value)));
  check("corrupt share link: no crash", p3errors.length === 0, p3errors.join(" | "));
  check("share: no console errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ============ I. Export modal: formats, gating, copy, download ============ */
{
  const { page, context, errors } = await newPage();
  await page.goto(URLS.app);
  await sleep(400);
  await page.click("#exportBtn");
  await page.waitForSelector("#exportModal.open");
  check("export defaults to CSS", (await page.$eval("#exportOutput", (el) => el.textContent)).startsWith(":root {"));
  check("export contains current primary", (await page.$eval("#exportOutput", (el) => el.textContent)).includes(await hexOf(page, "primary")));
  check("5 format tabs", (await page.$$eval(".format-tab", (d) => d.length)) === 5);
  check("pro formats locked for free users", (await page.$$eval(".format-tab .lock", (d) => d.length)) === 4);
  await page.click('.format-tab[data-format="scss"]');
  await sleep(300);
  check("locked format opens upgrade modal", await page.isVisible("#upgradeModal.open"));
  check("upgrade reason names the format", /SCSS/.test(await page.$eval("#upgradeReason", (el) => el.textContent)));
  await page.keyboard.press("Escape");
  await page.click("#exportBtn");
  await page.waitForSelector("#exportModal.open");
  await page.click("#copyExport");
  await sleep(400);
  check("copy export gives feedback", (await page.$eval("#copyExport", (el) => el.textContent)) === "Copied!");
  const dl = page.waitForEvent("download", { timeout: 5000 });
  await page.click("#downloadExport");
  const download = await dl;
  check("download export produces css file", download.suggestedFilename() === "colorslct-tokens.css");
  check("export: no console errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ============ J. Gift code -> Pro unlock -> deactivate ============ */
{
  const { page, context, errors } = await newPage();
  await page.goto(URLS.app);
  await sleep(400);
  await page.click("#upgradeBtn");
  await page.waitForSelector("#upgradeModal.open");
  /* buy buttons graceful without keys */
  await page.click("#buyGumroad");
  await sleep(250);
  check("studio gumroad buy graceful", /isn’t connected yet/.test(await toastText(page)));
  /* license verify without productId is graceful */
  await page.fill("#licenseKeyInput", "FAKE-KEY-1234");
  await page.click("#verifyLicense");
  await sleep(600);
  check("license verify graceful without productId", /isn’t set up yet/.test(await page.$eval("#licenseStatus", (el) => el.textContent)));
  /* wrong gift code */
  await page.fill("#giftCodeInput", "WRONG-CODE-999");
  await page.click("#redeemGift");
  await sleep(600);
  check("wrong gift code rejected", /didn’t match/.test(await page.$eval("#licenseStatus", (el) => el.textContent)));
  /* correct gift code (starter, case-insensitive w/ spaces) */
  await page.fill("#giftCodeInput", "  bndr-gift-2049 ");
  await page.click("#redeemGift");
  await page.waitForFunction(() => /Pro unlocked/.test(document.getElementById("licenseStatus").textContent), { timeout: 5000 });
  check("gift code unlocks Pro", true);
  check("pro badge shown", await page.isVisible("#proBadge"));
  check("upgrade button hidden when pro", !(await page.isVisible("#upgradeBtn")));
  check("active-license panel shown", await page.isVisible("#licenseActive"));
  await page.keyboard.press("Escape");
  /* pro exports now unlocked */
  await page.click("#exportBtn");
  await page.waitForSelector("#exportModal.open");
  check("no locks when pro", (await page.$$eval(".format-tab .lock", (d) => d.length)) === 0);
  await page.click('.format-tab[data-format="tailwind"]');
  await sleep(200);
  check("tailwind export renders for pro", (await page.$eval("#exportOutput", (el) => el.textContent)).includes("module.exports"));
  await page.click('.format-tab[data-format="svg"]');
  await sleep(200);
  check("svg export renders for pro", (await page.$eval("#exportOutput", (el) => el.textContent)).startsWith("<svg"));
  await page.keyboard.press("Escape");
  /* pro survives reload */
  await page.reload();
  await sleep(900);
  check("pro persists across reload", await page.isVisible("#proBadge"));
  /* unlimited saves when pro */
  for (let i = 1; i <= 4; i++) {
    await page.click("#saveBtn");
    await page.waitForSelector("#saveModal.open");
    await page.fill("#paletteNameInput", `Pro save ${i}`);
    await page.click("#confirmSave");
    await sleep(150);
  }
  check("pro allows 4+ saves", (await page.evaluate(() => JSON.parse(localStorage.getItem("cslct-palettes")).length)) === 4);
  /* deactivate */
  await page.evaluate(() => window.CslctOpenUpgrade && window.CslctOpenUpgrade());
  await page.waitForSelector("#upgradeModal.open");
  await page.click("#deactivateLicense");
  await sleep(300);
  check("deactivate restores free state", (await page.evaluate(() => localStorage.getItem("cslct-license"))) === null);
  check("gift/pro: no console errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ============ K. #redeem deep link ============ */
{
  const { page, context, errors } = await newPage();
  await page.goto(URLS.app + "#redeem");
  await page.waitForSelector("#upgradeModal.open", { timeout: 5000 });
  check("#redeem opens upgrade modal", true);
  check("redeem deep link reason", /gift code or license/i.test(await page.$eval("#upgradeReason", (el) => el.textContent)));
  check("redeem: no console errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ============ K2. #redeem on a first run: tour must not collide ============ */
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await context.addInitScript(() => { localStorage.setItem("cslct-consent", "accepted"); }); // consent yes, tour NOT done
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(URLS.app + "#redeem");
  await page.waitForSelector("#upgradeModal.open", { timeout: 5000 });
  await sleep(900); // well past the tour's 500ms first-run delay
  check("first-run redeem: tour overlay stays closed", !(await page.$eval("#tourOverlay", (el) => el.classList.contains("open"))));
  check("first-run redeem: tour not marked done", (await page.evaluate(() => localStorage.getItem("cslct-tour-done"))) === null);
  await page.keyboard.press("Escape");
  await sleep(300);
  await page.click("#helpBtn");
  await sleep(300);
  check("first-run redeem: tour still available via help button", await page.$eval("#tourOverlay", (el) => el.classList.contains("open")));
  check("first-run redeem: no console errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ============ L. AI modal validation (no network) ============ */
{
  const { page, context, errors } = await newPage();
  await page.goto(URLS.app);
  await sleep(400);
  await page.click("#aiBtn");
  await page.waitForSelector("#aiModal.open");
  await page.click("#generateAI");
  await sleep(200);
  check("AI requires key", /enter your API key/i.test(await page.$eval("#aiStatus", (el) => el.textContent)));
  check("AI session-only promise present", await page.$eval("#aiModal", (el) => /only in this session/.test(el.textContent)));
  await page.keyboard.press("Escape");
  check("escape closes AI modal", !(await page.isVisible("#aiModal.open")));
  check("ai modal: no console errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ============ M. Studio mobile 390px ============ */
{
  const { page, context, errors } = await newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(URLS.app);
  await sleep(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("studio 390px: no horizontal overflow", overflow <= 1, `overflow ${overflow}px`);
  const before = await hexOf(page, "primary");
  await page.click("#randomBtn");
  check("studio 390px: random works", (await hexOf(page, "primary")) !== before);
  await page.click("#exportBtn");
  await page.waitForSelector("#exportModal.open");
  const modalFits = await page.$eval("#exportModal .modal-card", (el) => el.getBoundingClientRect().width <= window.innerWidth);
  check("studio 390px: modal fits viewport", modalFits);
  check("studio mobile: no console errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ============ N. Gift-code owner tool ============ */
{
  const { page, context, errors } = await newPage();
  await page.goto(URLS.giftTool);
  await sleep(300);
  await page.fill("#codesInput", "MY-NEW-CODE-01\nFRIEND PASS 22");
  await page.click("#hashBtn");
  await page.waitForSelector(".hash-table", { timeout: 4000 });
  const hashes = await page.$$eval(".hash-table tbody td:last-child", (tds) => tds.map((t) => t.textContent));
  check("gift tool produces 2 hashes", hashes.length === 2 && hashes.every((h) => /^[0-9a-f]{64}$/.test(h)));
  check("gift tool snippet ready", /giftCodeHashes: \[/.test(await page.$eval("#snippetOut", (el) => el.textContent)));
  await page.fill("#testInput", "BNDR-GIFT-2049");
  await page.click("#testBtn");
  await sleep(500);
  check("gift tool validates starter code against config", /Valid/.test(await page.$eval("#testResult", (el) => el.textContent)));
  await page.fill("#testInput", "NOT-A-CODE");
  await page.click("#testBtn");
  await sleep(500);
  check("gift tool rejects unknown code", /NOT work/.test(await page.$eval("#testResult", (el) => el.textContent)));
  check("gift tool: no console errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ============ O. State persistence across reload ============ */
{
  /* Seed consent through the real UI, NOT addInitScript. addInitScript re-runs
     before page scripts on every navigation; on reload it can populate a fresh
     DOM Storage area before the origin's committed data re-attaches, so a prior
     write reads back as null. Accepting consent once via the banner persists it
     the way a real user does and reflects genuine reload behavior. */
  const { page, context, errors } = await newPage({ seed: false });
  await page.goto(URLS.app);
  await page.click("#consentAccept");
  await sleep(400);
  await page.fill("#hex-primary", "#7722aa");
  await page.waitForFunction(() => (localStorage.getItem("cslct-state") || "").includes("#7722aa"), null, { timeout: 5000 });
  await page.reload();
  await sleep(900);
  check("palette persists across reload", (await hexOf(page, "primary")) === "#7722aa");
  check("persistence: no console errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

/* ============ P. Palette designer panel ============ */
{
  const { page, context, errors } = await newPage();
  await page.goto(URLS.app);
  await sleep(500);
  check("designer panel visible", await page.isVisible(".designer-panel"));
  check("harmony select has 9 options", (await page.$$eval("#harmonySelect option", (o) => o.length)) === 9);
  check("vivid mood chip active by default", await page.$eval('.mood-chip[data-mood="vivid"]', (el) => el.classList.contains("active")));
  const before1 = await hexOf(page, "primary");
  await page.click("#randomBtn");
  await sleep(250);
  check("Generate designs a new palette", (await hexOf(page, "primary")) !== before1);
  check("designer why-line explains itself", (await page.$eval("#designerWhy", (el) => el.textContent)).length > 10);
  await page.selectOption("#harmonySelect", "triadic");
  await sleep(250);
  check("harmony select regenerates with chosen model", (await page.$eval("#designerWhy", (el) => el.textContent)).includes("Triadic"));
  const beforeMood = await hexOf(page, "primary");
  await page.click('.mood-chip[data-mood="neon"]');
  await sleep(250);
  check("mood chip regenerates palette", (await hexOf(page, "primary")) !== beforeMood);
  check("neon chip active", await page.$eval('.mood-chip[data-mood="neon"]', (el) => el.classList.contains("active")));
  const beforeBlend = await hexOf(page, "primary");
  await page.click("#blendBtn");
  await sleep(250);
  check("blend produces new palette flagged Blend", (await hexOf(page, "primary")) !== beforeBlend && (await page.$eval("#designerWhy", (el) => el.textContent)).includes("Blend"));
  check("designer state persists", await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("cslct-state")); return s && s.designer && s.designer.mood === "neon" && s.designer.harmony === "triadic"; }));
  await page.reload();
  await sleep(900);
  check("designer controls restored after reload", (await page.$eval("#harmonySelect", (el) => el.value)) === "triadic" && (await page.$eval('.mood-chip[data-mood="neon"]', (el) => el.classList.contains("active"))));
  check("studio defaults to dark theme", (await page.getAttribute("html", "data-theme")) === "dark");
  await page.fill("#blendA", "zzz");
  await page.click("#blendBtn");
  await sleep(200);
  check("blend rejects invalid hex gracefully", /two hex codes/i.test(await toastText(page)) && (await page.$eval("#blendA", (el) => el.classList.contains("invalid"))));
  check("designer: no console errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

await browser.close();
console.log(`\nE2E tests: ${passed} passed, ${failed} failed`);
if (failed) { console.error("\nFailures:\n- " + failures.join("\n- ")); process.exit(1); }
