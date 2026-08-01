/* ColorSLCT Studio — preserves every verified v1 behavior, fixes v1 defects,
   adds library, multi-format export, share links, licensing, and guided tour. */
(function () {
  "use strict";
  var E = window.ColorEngine;
  var UI = window.CslctUI;
  var License = window.CslctLicense;
  var Designer = window.PaletteDesigner || null;
  var CONFIG = window.CSLCT_CONFIG || {};
  var Store = UI.Store;
  var $ = function (id) { return document.getElementById(id); };
  var showToast = UI.showToast;

  /* ================= State ================= */
  var currentPalette = null;
  /* Persistence stays disarmed until boot finishes painting. A transient
     boot-time read-miss of saved state must never overwrite good data with a
     freshly-designed opening palette — only genuine post-boot activity writes. */
  var persistArmed = false;
  var lastMeta = null;
  var historyStack = [];
  var compareSwatches = [];
  var wcagMode = false;
  var savedPalettes = Store.get("cslct-palettes", []);
  if (!Array.isArray(savedPalettes)) savedPalettes = [];
  savedPalettes = savedPalettes.filter(function (p) { return p && typeof p.name === "string" && E.isValidPalette(p.palette); });
  var FREE_SAVE_LIMIT = 3;
  var sessionAiKey = ""; // never persisted — keeps the "session only" promise true
  var designerState = { harmony: "auto", mood: "vivid" };

  /* ================= Boot palette (share link > saved > default) ============ */
  (function initPalette() {
    var fromHash = readHashPalette();
    if (fromHash) {
      currentPalette = fromHash;
      showToast("Shared palette loaded — it\u2019s all yours to tweak.");
      return;
    }
    var saved = Store.get("cslct-state", null);
    if (saved && E.isValidPalette(saved.palette)) {
      currentPalette = E.cleanPalette(saved.palette);
      wcagMode = !!saved.wcagMode;
      if (saved.designer && Designer) {
        if (Designer.HARMONIES[saved.designer.harmony]) designerState.harmony = saved.designer.harmony;
        if (Designer.MOODS[saved.designer.mood]) designerState.mood = saved.designer.mood;
      }
      if (Array.isArray(saved.history)) {
        historyStack = saved.history.filter(E.isValidPalette).map(E.cleanPalette).slice(0, 5);
      }
    }
    if (!currentPalette) {
      /* Fresh visit: the designer builds the opening palette live, on the spot. */
      if (Designer) {
        var opening = Designer.designPalette({ harmony: designerState.harmony, mood: designerState.mood });
        currentPalette = opening.palette;
        lastMeta = opening.meta;
      } else {
        var bootHue = Math.random() * 360;
        currentPalette = E.cleanPalette({
          bgLight: E.oklchToHex(0.96, 0.01, bootHue),
          textPrimary: E.oklchToHex(0.22, 0.02, bootHue),
          primary: E.oklchToHex(0.55, 0.12, bootHue),
          accent1: E.oklchToHex(0.6, 0.12, (bootHue + 150) % 360),
          bgDark: E.oklchToHex(0.16, 0.02, bootHue),
        });
      }
    }
  })();

  function readHashPalette() {
    var m = /[#&]p=([0-9a-fA-F-]+)/.exec(window.location.hash || "");
    if (!m) return null;
    return E.decodePalette(m[1]);
  }

  function persistState() {
    if (!persistArmed) return;
    Store.set("cslct-state", { palette: currentPalette, history: historyStack, wcagMode: wcagMode, designer: designerState });
  }

  /* ================= WCAG enforcement (preserved) ================= */
  function enforceWCAG(pal, quiet) {
    var newPal = Object.assign({}, pal);
    var targetText = 7, targetUI = 4.5;
    var bgLight = newPal.bgLight;
    var failing = [];
    function adjustToken(token, target) {
      if (E.contrast(newPal[token], bgLight) < target) {
        var lch = E.hexToOklch(newPal[token]);
        var L = lch[0], C = lch[1], H = lch[2];
        var steps = 0;
        while (E.contrast(E.oklchToHex(L, C, H), bgLight) < target && L > 0.05 && steps < 60) {
          L = Math.max(0.05, L - 0.02);
          steps++;
        }
        newPal[token] = E.oklchToHex(L, C, H);
        if (E.contrast(newPal[token], bgLight) < target) failing.push(token);
      }
    }
    adjustToken("textPrimary", targetText);
    adjustToken("primary", targetUI);
    adjustToken("accent1", targetUI);
    /* dark-surface floor (WCAG 1.4.11 non-text UI): lift accents toward 3:1 on bgDark
       without breaking their 4.5:1 standing on the light surface */
    function adjustTokenDark(token, target) {
      if (E.contrast(newPal[token], newPal.bgDark) < target) {
        var lch = E.hexToOklch(newPal[token]);
        var L = lch[0], C = lch[1], H = lch[2];
        var steps = 0;
        while (E.contrast(E.oklchToHex(L, C, H), newPal.bgDark) < target &&
               E.contrast(E.oklchToHex(L + 0.015, C, H), bgLight) >= targetUI - 0.02 && L < 0.95 && steps < 40) {
          L += 0.015; steps++;
        }
        var candidate = E.oklchToHex(L, C, H);
        if (E.contrast(candidate, newPal.bgDark) >= target - 0.02) newPal[token] = candidate;
      }
    }
    adjustTokenDark("primary", 3);
    adjustTokenDark("accent1", 3);
    if (failing.length && !quiet) {
      showToast("WCAG enforcement: could not fully meet contrast for " + failing.join(", ") + ". Adjust manually.");
    }
    return newPal;
  }

  /* ================= Apply pipeline (preserved) ================= */
  function applyPalette(pal) {
    currentPalette = E.cleanPalette(pal);
    renderTokens();
    updateAll();
  }
  function applyNewPalette(pal) {
    var finalPal = wcagMode ? enforceWCAG(pal) : pal;
    pushHistory(currentPalette);
    applyPalette(finalPal);
  }

  function syncCSSVariables() {
    var root = document.documentElement;
    root.style.setProperty("--bg-light", currentPalette.bgLight);
    root.style.setProperty("--text-primary", currentPalette.textPrimary);
    root.style.setProperty("--primary", currentPalette.primary);
    root.style.setProperty("--accent-1", currentPalette.accent1);
    root.style.setProperty("--bg-dark", currentPalette.bgDark);
    /* FIX(v1): readable text on primary/accent buttons instead of hardcoded #000/#fff */
    root.style.setProperty("--primary-contrast", E.idealTextColor(currentPalette.primary));
    root.style.setProperty("--accent-1-contrast", E.idealTextColor(currentPalette.accent1));
  }

  function updateAll() {
    syncCSSVariables();
    updatePreview();
    updateContrast();
    renderCompare();
    updateHistoryStrip();
    updateCompareButtonStates();
    $("backBtn").disabled = historyStack.length === 0;
    persistState();
  }

  /* ================= Token grid ================= */
  function renderTokens() {
    var tokenGrid = $("tokenGrid");
    var eyedropperSupported = "EyeDropper" in window;
    tokenGrid.innerHTML = E.TOKENS.map(function (t) {
      var info = E.TOKEN_INFO[t];
      return (
        '<div class="token-item">' +
        '<div class="token-header">' +
        '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="' + currentPalette[t] + '" stroke="var(--border)"/></svg>' +
        '<span>' + info.label + '</span>' +
        '<span class="token-hint" style="margin-left:auto;">' + info.hint + "</span>" +
        "</div>" +
        '<div class="color-wrap">' +
        '<input type="color" id="color-' + t + '" value="' + currentPalette[t] + '" aria-label="Select ' + info.label + ' color">' +
        '<input type="text" class="hex-input" id="hex-' + t + '" value="' + currentPalette[t] + '" spellcheck="false" autocomplete="off" inputmode="text" maxlength="7" aria-label="' + info.label + ' hex value">' +
        (eyedropperSupported
          ? '<button type="button" class="icon-btn eyedrop-btn" data-token="' + t + '" aria-label="Pick ' + info.label + ' from screen" title="Pick from screen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/></svg></button>'
          : "") +
        "</div>" +
        '<div class="token-tools">' +
        '<button class="compare-add-btn" data-token="' + t + '" type="button" aria-label="Add ' + info.label + ' to compare">' +
        '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="5" y="0" width="2" height="12"/><rect x="0" y="5" width="12" height="2"/></svg>Compare</button>' +
        '<button class="compare-add-btn copy-hex-btn" data-token="' + t + '" type="button" aria-label="Copy ' + info.label + ' hex">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</button>' +
        "</div></div>"
      );
    }).join("");

    E.TOKENS.forEach(function (t) {
      var input = $("color-" + t);
      var hexInput = $("hex-" + t);
      input.addEventListener("input", function () {
        currentPalette[t] = input.value;
        hexInput.value = input.value;
        hexInput.classList.remove("invalid");
        updateAll();
      });
      /* NEW: typeable hex with validation + normalization (3- and 6-digit) */
      hexInput.addEventListener("input", function () {
        var norm = E.normalizeHex(hexInput.value);
        if (norm) {
          hexInput.classList.remove("invalid");
          currentPalette[t] = norm;
          input.value = norm;
          updateAll();
        } else {
          hexInput.classList.add("invalid");
        }
      });
      hexInput.addEventListener("blur", function () {
        var norm = E.normalizeHex(hexInput.value);
        hexInput.value = norm || currentPalette[t];
        hexInput.classList.remove("invalid");
      });
      hexInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); hexInput.blur(); }
      });
    });

    tokenGrid.querySelectorAll(".compare-add-btn:not(.copy-hex-btn)").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        addToCompare(currentPalette[btn.dataset.token], btn.dataset.token);
      });
    });
    tokenGrid.querySelectorAll(".copy-hex-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        UI.copyText(currentPalette[btn.dataset.token], function () {
          showToast(currentPalette[btn.dataset.token] + " copied");
        });
      });
    });
    tokenGrid.querySelectorAll(".eyedrop-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        try {
          new window.EyeDropper().open().then(function (result) {
            var norm = E.normalizeHex(result.sRGBHex);
            if (norm) {
              var pal = Object.assign({}, currentPalette);
              pal[btn.dataset.token] = norm;
              applyNewPalette(pal);
              showToast(norm + " picked");
            }
          }).catch(function () { /* user cancelled — fine */ });
        } catch (err) {
          showToast("Your browser doesn\u2019t support screen picking.");
        }
      });
    });

    updateCompareButtonStates();
  }

  function updateCompareButtonStates() {
    var full = compareSwatches.length >= 4;
    document.querySelectorAll(".compare-add-btn:not(.copy-hex-btn)").forEach(function (btn) {
      btn.disabled = full;
    });
  }

  /* ================= Previews (FIX: dynamic readable button text) ========= */
  function updatePreview() {
    var p = currentPalette;
    var cRgb = E.hexToRgb(p.textPrimary).join(",");
    var bRgb = E.hexToRgb(p.bgLight).join(",");
    var primaryText = E.idealTextColor(p.primary);
    var accentText = E.idealTextColor(p.accent1);
    $("previewContainer").innerHTML =
      '<div class="preview-card" style="background:' + p.bgLight + ';" data-preview="light">' +
      '<div class="preview-ui">' +
      '<div style="color:' + p.textPrimary + '; font-weight:600;">Primary text on light bg</div>' +
      '<div style="color:rgba(' + cRgb + ',0.6);">Secondary</div>' +
      '<div class="preview-dock">' +
      '<button class="preview-btn" type="button" tabindex="-1" style="color:rgba(' + cRgb + ',0.6);">Default</button>' +
      '<button class="preview-btn" type="button" tabindex="-1" style="background:' + p.primary + "; color:" + primaryText + ';">Primary</button>' +
      '<button class="preview-btn" type="button" tabindex="-1" style="background:' + p.accent1 + "; color:" + accentText + ';">Accent</button>' +
      "</div>" +
      '<div class="preview-node" style="color:' + p.textPrimary + ';">Aa Bb Cc — 0123456789</div>' +
      "</div></div>" +
      '<div class="preview-card" style="background:' + p.bgDark + ';" data-preview="dark">' +
      '<div class="preview-ui">' +
      '<div style="color:' + p.bgLight + '; font-weight:600;">Light text on dark bg</div>' +
      '<div style="color:rgba(' + bRgb + ',0.6);">Secondary</div>' +
      '<div class="preview-dock" style="background:rgba(' + cRgb + ',0.4);">' +
      '<button class="preview-btn" type="button" tabindex="-1" style="color:rgba(' + bRgb + ',0.7);">Default</button>' +
      '<button class="preview-btn" type="button" tabindex="-1" style="background:' + p.primary + "; color:" + primaryText + ';">Primary</button>' +
      '<button class="preview-btn" type="button" tabindex="-1" style="background:' + p.accent1 + "; color:" + accentText + ';">Accent</button>' +
      "</div>" +
      '<div class="preview-node" style="background:rgba(' + cRgb + ',0.8); color:' + p.bgLight + ';">Aa Bb Cc — 0123456789</div>' +
      "</div></div>";
  }

  /* ============ Contrast table (FIX: correct labels + true dark-bg pairs) === */
  function updateContrast() {
    var p = currentPalette;
    var darkFirst = lastMeta && lastMeta.contrastRef === "dark";
    /* calm/earthy ease the dark-section chase: accents keep their depth.
       judge dark-section rows at the floor the palette was built to. */
    var darkUIFloor = lastMeta && lastMeta.darkFloor ? Math.min(lastMeta.darkFloor, 3.48) : 3;
    /* UI rows judge at 3:1 — WCAG 1.4.11's threshold for non-text components.
       Neon palettes design accents for the dark surface — their light-side
       rows show the measured value with no pass/fail verdict. */
    var pairs = [
      { label: "Text on light bg", fg: p.textPrimary, bg: p.bgLight, min: 7 },
      { label: "Primary on light bg (UI)", fg: p.primary, bg: p.bgLight, min: 3, info: darkFirst },
      { label: "Accent on light bg (UI)", fg: p.accent1, bg: p.bgLight, min: 3, info: darkFirst },
      { label: "Light bg text on dark bg", fg: p.bgLight, bg: p.bgDark, min: 7 },
      { label: "Primary on dark bg (UI)", fg: p.primary, bg: p.bgDark, min: darkUIFloor },
      { label: "Accent on dark bg (UI)", fg: p.accent1, bg: p.bgDark, min: darkUIFloor },
    ];
    $("contrastList").innerHTML = pairs.map(function (pair) {
      var ratio = E.contrast(pair.fg, pair.bg);
      var pass = ratio >= pair.min;
      var level = pair.info ? "dark-surface design" : pass ? (pair.min === 3 ? "OK" : ratio >= 7 ? "AAA" : "AA") : "FAIL";
      var cls = pair.info ? "aa" : pass ? (ratio >= 7 ? "aaa" : "aa") : "fail";
      return (
        '<div class="contrast-row">' +
        '<div class="contrast-pair">' +
        '<span class="contrast-swatch" style="background:' + pair.fg + ';" aria-hidden="true"></span>' +
        '<span class="contrast-swatch" style="background:' + pair.bg + ';" aria-hidden="true"></span>' +
        "<span>" + pair.label + "</span></div>" +
        '<span class="contrast-badge"><span class="badge-dot ' + cls + '" aria-hidden="true"></span>' + (Math.floor(ratio * 100) / 100).toFixed(2) + ":1 " + level + "</span>" +
        "</div>"
      );
    }).join("");
  }

  /* ================= Compare bucket (preserved + hex labels) ============== */
  var compareIdSeq = 1;
  function addToCompare(hex, role) {
    if (compareSwatches.length >= 4) { showToast("Compare bucket full (max 4)"); return; }
    compareSwatches.push({ hex: hex, role: role, id: "sw" + compareIdSeq++ });
    renderCompare();
    updateCompareButtonStates();
  }

  function renderCompare() {
    var slots = $("compareSlots");
    if (!compareSwatches.length) {
      slots.innerHTML = '<div class="compare-empty">Nothing here yet — press “Compare” under any color to line swatches up side by side.</div>';
      return;
    }
    slots.innerHTML = compareSwatches.map(function (s) {
      return (
        '<div class="compare-swatch" style="background:' + s.hex + ';" data-id="' + s.id + '" role="button" tabindex="0" aria-label="Swatch ' + s.role + " " + s.hex + '">' +
        '<span class="compare-hex">' + s.hex + "</span>" +
        '<span class="remove-sw" data-id="' + s.id + '" aria-label="Remove swatch" role="button" tabindex="0">&times;</span>' +
        "</div>"
      );
    }).join("");
    initCompareDrag();
    updateCompareButtonStates();
  }

  function initCompareDrag() {
    var slots = $("compareSlots");
    var swatches = slots.querySelectorAll(".compare-swatch");
    var dragEl = null;

    function onPointerDown(e) {
      if (e.target.classList.contains("remove-sw")) return;
      dragEl = e.currentTarget;
      try { dragEl.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      dragEl.classList.add("dragging");
      e.preventDefault();
    }
    function onPointerMove(e) {
      if (!dragEl) return;
      var target = document.elementFromPoint(e.clientX, e.clientY);
      if (target && !target.classList.contains("compare-swatch")) target = target.closest ? target.closest(".compare-swatch") : null;
      if (target && target !== dragEl) {
        var dragId = dragEl.dataset.id;
        var fromIdx = compareSwatches.findIndex(function (s) { return s.id === dragId; });
        var toIdx = compareSwatches.findIndex(function (s) { return s.id === target.dataset.id; });
        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          var moved = compareSwatches.splice(fromIdx, 1)[0];
          compareSwatches.splice(toIdx, 0, moved);
          renderCompare();
          dragEl = slots.querySelector('[data-id="' + dragId + '"]');
          if (dragEl) dragEl.classList.add("dragging");
        }
      }
    }
    function onPointerUp(e) {
      if (!dragEl) return;
      dragEl.classList.remove("dragging");
      try { dragEl.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
      dragEl = null;
    }

    swatches.forEach(function (sw) {
      sw.addEventListener("pointerdown", onPointerDown);
      sw.addEventListener("pointermove", onPointerMove);
      sw.addEventListener("pointerup", onPointerUp);
      sw.addEventListener("pointercancel", onPointerUp);
      sw.addEventListener("click", function (e) {
        if (e.target.classList.contains("remove-sw")) return;
        UI.copyText(sw.querySelector(".compare-hex").textContent, function () {
          showToast(sw.querySelector(".compare-hex").textContent + " copied");
        });
      });
    });

    slots.querySelectorAll(".remove-sw").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        compareSwatches = compareSwatches.filter(function (s) { return s.id !== btn.dataset.id; });
        renderCompare();
        updateCompareButtonStates();
      });
      btn.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); btn.click(); }
      });
    });
  }

  /* ================= History (FIX: restore direction) ================= */
  function pushHistory(pal) {
    historyStack.unshift(Object.assign({}, pal));
    if (historyStack.length > 5) historyStack.pop();
  }

  function updateHistoryStrip() {
    var strip = $("historyStrip");
    if (!historyStack.length) {
      strip.innerHTML = '<span class="history-label">Your last 5 palettes will appear here as you explore.</span>';
      return;
    }
    strip.innerHTML = '<span class="history-label">History:</span>' + historyStack.map(function (pal, i) {
      var colors = [pal.bgLight, pal.textPrimary, pal.primary, pal.accent1, pal.bgDark];
      var swatchesHTML = colors.map(function (c) { return '<span class="history-swatch" style="background:' + c + ';"></span>'; }).join("");
      return '<button class="history-dot" data-index="' + i + '" type="button" aria-label="Restore palette ' + (i + 1) + '">' + swatchesHTML + "</button>";
    }).join("");

    strip.querySelectorAll(".history-dot").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = parseInt(btn.dataset.index, 10);
        var restored = historyStack[idx];
        /* FIX(v1): keep only entries OLDER than the restored one (stack is newest-first) */
        historyStack = historyStack.slice(idx + 1);
        applyPalette(Object.assign({}, restored));
      });
    });
  }

  /* ================= Designer engine wiring ================= */
  function designerWhy(meta) {
    lastMeta = meta || null;
    var el = $("designerWhy");
    if (!el) return;
    el.textContent = meta ? meta.reason : "";
  }
  function randomOklchPalette() {
    /* v1 fallback, used only if the designer module failed to load */
    var baseH = Math.random() * 360;
    var palette = {
      bgLight: E.oklchToHex(0.95, 0.03, (baseH + 20) % 360),
      textPrimary: E.oklchToHex(0.18, 0.04, (baseH + 180) % 360),
      primary: E.oklchToHex(0.62, 0.18, baseH),
      accent1: E.oklchToHex(0.62, 0.18, (baseH + 150) % 360),
      bgDark: "#020202",
    };
    if (E.contrast(palette.textPrimary, palette.bgLight) < 7) {
      palette.textPrimary = E.oklchToHex(0.15, 0.02, (baseH + 180) % 360);
    }
    return enforceWCAG(palette, true);
  }

  /* ================= Core action buttons ================= */
  $("randomBtn").addEventListener("click", function () {
    if (Designer) {
      var r = Designer.designPalette({ harmony: designerState.harmony, mood: designerState.mood });
      applyNewPalette(r.palette);
      designerWhy(r.meta);
      showToast("New palette designed — " + r.meta.harmonyLabel + ", " + r.meta.moodLabel.toLowerCase() + " mood.");
    } else {
      applyNewPalette(randomOklchPalette());
    }
  });
  $("backBtn").addEventListener("click", function () {
    if (historyStack.length) {
      var prev = historyStack.shift();
      applyPalette(prev);
    }
  });
  $("harmonyBtn").addEventListener("click", function () {
    if (Designer) {
      var r = Designer.spinPalette(currentPalette, { harmony: designerState.harmony, mood: designerState.mood });
      applyNewPalette(r.palette);
      designerWhy(r.meta);
      showToast("Re-harmonized — " + r.meta.harmonyLabel + " around your base color.");
    } else {
      var pal = Object.assign({}, currentPalette);
      ["bgLight", "textPrimary", "primary", "accent1"].forEach(function (t) {
        var lch = E.hexToOklch(pal[t]);
        pal[t] = E.oklchToHex(lch[0], lch[1], (lch[2] + 30) % 360);
      });
      applyNewPalette(pal);
    }
  });
  $("wcagBtn").addEventListener("click", function () {
    wcagMode = !wcagMode;
    syncWcagBtn();
    if (wcagMode) {
      var enforced = enforceWCAG(currentPalette);
      if (JSON.stringify(enforced) !== JSON.stringify(currentPalette)) applyPalette(enforced);
      showToast("WCAG enforcement ON – any new palette will be adjusted");
    } else {
      showToast("WCAG enforcement OFF");
    }
    persistState();
  });
  function syncWcagBtn() {
    var btn = $("wcagBtn");
    btn.setAttribute("aria-pressed", String(wcagMode));
    btn.textContent = wcagMode ? "WCAG Auto: ON" : "WCAG Auto: OFF";
    btn.classList.toggle("wcag-active", wcagMode);
    var tourSwitch = $("prefWcag");
    if (tourSwitch) tourSwitch.checked = wcagMode;
  }

  /* ================= Designer panel (harmony / mood / blend) ================= */
  (function initDesignerPanel() {
    var select = $("harmonySelect");
    if (!Designer || !select) return;
    Object.keys(Designer.HARMONIES).forEach(function (key) {
      var opt = document.createElement("option");
      opt.value = key;
      opt.textContent = Designer.HARMONY_LABELS[key];
      select.appendChild(opt);
    });
    function syncDesignerControls() {
      select.value = designerState.harmony;
      document.querySelectorAll(".mood-chip").forEach(function (chip) {
        var on = chip.dataset.mood === designerState.mood;
        chip.classList.toggle("active", on);
        chip.setAttribute("aria-pressed", String(on));
      });
    }
    syncDesignerControls();
    if (currentPalette) {
      if ($("blendA")) $("blendA").value = currentPalette.primary;
      if ($("blendB")) $("blendB").value = currentPalette.accent1;
    }
    if (lastMeta) designerWhy(lastMeta);
    select.addEventListener("change", function () {
      designerState.harmony = select.value;
      syncDesignerControls();
      var r = Designer.designPalette({ seed: Designer.randomSeed(), harmony: designerState.harmony, mood: designerState.mood, baseHex: currentPalette.primary });
      applyNewPalette(r.palette);
      designerWhy(r.meta);
      persistState();
    });
    document.querySelectorAll(".mood-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        designerState.mood = chip.dataset.mood;
        syncDesignerControls();
        var r = Designer.designPalette({ seed: Designer.randomSeed(), harmony: designerState.harmony, mood: designerState.mood, baseHex: currentPalette.primary });
        applyNewPalette(r.palette);
        designerWhy(r.meta);
        persistState();
      });
    });
    $("blendBtn").addEventListener("click", function () {
      var a = E.normalizeHex($("blendA").value);
      var b = E.normalizeHex($("blendB").value);
      if (!a || !b) {
        showToast("Type two hex codes to blend — e.g. #1a936f and #274690.");
        (!a ? $("blendA") : $("blendB")).classList.add("invalid");
        return;
      }
      $("blendA").classList.remove("invalid");
      $("blendB").classList.remove("invalid");
      var r = Designer.designPalette({ seed: Designer.randomSeed(), harmony: designerState.harmony, mood: designerState.mood, baseHex: a, blendHex: b });
      applyNewPalette(r.palette);
      designerWhy(r.meta);
      showToast("Blended " + a + " with " + b + " into a full palette.");
      persistState();
    });
  })();

  /* ================= Share link ================= */
  $("shareBtn").addEventListener("click", function () {
    var base = window.location.href.split("#")[0];
    var url = base + "#p=" + E.encodePalette(currentPalette);
    UI.copyText(url, function () { showToast("Share URL copied — anyone who opens it sees this palette."); });
  });

  /* ================= Export modal (multi-format, Pro-gated) ============== */
  var activeFormat = "css";
  function renderExportTabs() {
    var pro = License.isPro();
    $("formatTabs").innerHTML = E.EXPORT_FORMATS.map(function (f) {
      var locked = f.pro && !pro;
      return (
        '<button type="button" role="tab" class="format-tab" data-format="' + f.id + '" aria-selected="' + String(f.id === activeFormat) + '">' +
        f.label + (locked ? ' <span class="lock" aria-label="Pro feature">\uD83D\uDD12</span>' : "") +
        "</button>"
      );
    }).join("");
    $("formatTabs").querySelectorAll(".format-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        var f = E.EXPORT_FORMATS.find(function (x) { return x.id === tab.dataset.format; });
        if (f.pro && !License.isPro()) {
          UI.closeModal("exportModal");
          openUpgrade("The " + f.label + " export is a Pro feature.");
          return;
        }
        activeFormat = f.id;
        renderExportTabs();
        renderExportOutput();
      });
    });
  }
  function renderExportOutput() {
    $("exportOutput").textContent = E.exportAs(activeFormat, currentPalette);
    var f = E.EXPORT_FORMATS.find(function (x) { return x.id === activeFormat; });
    $("exportModalLabel").textContent = "Export — " + f.label;
  }
  $("exportBtn").addEventListener("click", function (e) {
    activeFormat = License.isPro() ? activeFormat : "css";
    renderExportTabs();
    renderExportOutput();
    UI.openModal("exportModal", e.currentTarget);
  });
  $("copyExport").addEventListener("click", function () {
    var btn = $("copyExport");
    var orig = btn.textContent;
    UI.copyText($("exportOutput").textContent, function () {
      btn.textContent = "Copied!";
      setTimeout(function () { btn.textContent = orig; }, 1500);
    });
  });
  $("downloadExport").addEventListener("click", function () {
    var f = E.EXPORT_FORMATS.find(function (x) { return x.id === activeFormat; });
    var mime = f.id === "json" ? "application/json" : f.id === "svg" ? "image/svg+xml" : "text/plain";
    if (UI.downloadText(f.filename, $("exportOutput").textContent, mime + ";charset=utf-8")) {
      showToast(f.filename + " downloaded");
    }
  });

  /* ================= Save & Library ================= */
  function persistPalettes() { Store.set("cslct-palettes", savedPalettes); }

  $("saveBtn").addEventListener("click", function (e) {
    if (!License.isPro() && savedPalettes.length >= FREE_SAVE_LIMIT) {
      openUpgrade("The free plan stores " + FREE_SAVE_LIMIT + " palettes. Go Pro for an unlimited library.");
      return;
    }
    $("paletteNameInput").value = "";
    $("savePreview").innerHTML = E.TOKENS.map(function (t) {
      return '<span style="background:' + currentPalette[t] + ';"></span>';
    }).join("");
    UI.openModal("saveModal", e.currentTarget);
  });

  $("confirmSave").addEventListener("click", function () {
    var name = $("paletteNameInput").value.trim() || "Untitled palette";
    savedPalettes.unshift({ id: "p" + Date.now(), name: name.slice(0, 60), palette: Object.assign({}, currentPalette), savedAt: new Date().toISOString() });
    persistPalettes();
    UI.closeModal("saveModal");
    if (!Store.allowed()) {
      showToast("Saved for this visit only — you asked us not to store data between visits.");
    } else {
      showToast("\u201C" + name + "\u201D saved to your library.");
    }
  });
  $("paletteNameInput") && $("paletteNameInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); $("confirmSave").click(); }
  });

  function renderLibrary() {
    var list = $("libraryList");
    var pro = License.isPro();
    $("libraryCount").textContent = pro
      ? savedPalettes.length + " saved · unlimited (Pro)"
      : savedPalettes.length + " of " + FREE_SAVE_LIMIT + " free slots used";
    if (!savedPalettes.length) {
      list.innerHTML = '<div class="library-empty">No palettes saved yet.<br>Press <strong>Save</strong> and your current colors land here.</div>';
      return;
    }
    list.innerHTML = savedPalettes.map(function (item) {
      var sw = E.TOKENS.map(function (t) { return '<span style="background:' + item.palette[t] + ';"></span>'; }).join("");
      return (
        '<div class="library-item" data-id="' + item.id + '">' +
        '<span class="library-swatches">' + sw + "</span>" +
        '<span class="library-name"></span>' +
        '<button type="button" class="btn" data-load="' + item.id + '">Load</button>' +
        '<button type="button" class="btn btn-ghost" data-del="' + item.id + '" aria-label="Delete palette">Delete</button>' +
        "</div>"
      );
    }).join("");
    /* names set via textContent to avoid HTML injection from user-typed names */
    savedPalettes.forEach(function (item) {
      var row = list.querySelector('[data-id="' + item.id + '"] .library-name');
      if (row) row.textContent = item.name;
    });
    list.querySelectorAll("[data-load]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var item = savedPalettes.find(function (x) { return x.id === btn.dataset.load; });
        if (item) {
          applyNewPalette(item.palette);
          UI.closeModal("libraryModal");
          showToast("\u201C" + item.name + "\u201D loaded.");
        }
      });
    });
    list.querySelectorAll("[data-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.dataset.armed === "1") {
          savedPalettes = savedPalettes.filter(function (x) { return x.id !== btn.dataset.del; });
          persistPalettes();
          renderLibrary();
          showToast("Palette deleted.");
        } else {
          btn.dataset.armed = "1";
          btn.textContent = "Sure?";
          btn.classList.add("btn-danger");
          setTimeout(function () {
            btn.dataset.armed = "";
            btn.textContent = "Delete";
            btn.classList.remove("btn-danger");
          }, 2500);
        }
      });
    });
  }
  $("libraryBtn").addEventListener("click", function (e) {
    renderLibrary();
    UI.openModal("libraryModal", e.currentTarget);
  });

  /* ================= AI Suggest (preserved + timeout & abort) ============= */
  $("aiBtn").addEventListener("click", function (e) {
    $("apiKeyInput").value = sessionAiKey;
    UI.openModal("aiModal", e.currentTarget);
  });
  $("generateAI").addEventListener("click", function () {
    var key = $("apiKeyInput").value.trim();
    var prompt = $("aiPrompt").value.trim() || "professional SaaS brand";
    var status = $("aiStatus");
    status.className = "modal-status";
    if (!key) { status.textContent = "Please enter your API key."; status.classList.add("err"); return; }
    sessionAiKey = key;
    status.textContent = "Generating\u2026 (this usually takes a few seconds)";
    var btn = $("generateAI");
    btn.disabled = true;
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 25000) : null;
    fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      signal: controller ? controller.signal : undefined,
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: 'You are a design token generator. You output only a JSON object with keys "bgLight", "textPrimary", "primary", "accent1", "bgDark". Each value is a hex color like "#AABBCC". No extra text, no markdown fences.\n\nToken roles:\n- "bgLight": a light background with real color character. Prefer luminous colored paper \u2014 peach, cream, mint, sky, lavender, pink (Oklch L 0.86-0.92, chroma near the sRGB gamut limit for that lightness). Reserve near-white (L\u22480.95, C\u22640.03) for briefs that demand strict minimalism.\n- "textPrimary": darkest text/foreground (aim Oklch L\u22480.18, C\u22480.04); must hit 7:1 contrast on bgLight\n- "primary": vibrant accent (medium lightness, Oklch C\u22650.15); must hit 4.5:1 on bgLight\n- "accent1": secondary accent (vibrant, medium lightness, Oklch C\u22650.15, hue >90\u00b0 from primary); must hit 4.5:1 on bgLight\n- "bgDark": deep dark background \u2014 may carry rich color (plum, petrol, moss); must hit 7:1 contrast against bgLight; avoid pure #000000\n\nPair the paper across the wheel from the accents so they merge as a pair rather than echoing each other \u2014 e.g. warm peach paper under violet accents, mint paper under magenta, cream under deep blue.\nEnsure strong chroma for accents, distinct hues (\u2265120\u00b0 apart), and clear luminance hierarchy.\nExample: {"bgLight":"#FFD9BC","textPrimary":"#221109","primary":"#6A1FB8","accent1":"#B00A54","bgDark":"#1E1030"}' },
          { role: "user", content: "Current palette: " + JSON.stringify(currentPalette) + "\nModify this palette according to: " + prompt + "\nReturn only the modified JSON." },
        ],
        temperature: 0.8,
      }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("API error " + res.status);
        return res.json();
      })
      .then(function (data) {
        var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!content) throw new Error("Empty response");
        var jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) content = jsonMatch[0];
        var json = JSON.parse(content);
        if (E.isValidPalette(json)) {
          applyNewPalette(E.cleanPalette(json));
          UI.closeModal("aiModal");
          status.textContent = "";
          showToast("AI palette applied");
        } else {
          throw new Error("Invalid palette structure");
        }
      })
      .catch(function (e2) {
        var msg = e2 && e2.name === "AbortError" ? "Request timed out — give it another go." : "AI error: " + (e2 && e2.message ? e2.message : "unknown");
        status.textContent = msg;
        status.classList.add("err");
        showToast("AI failed – check API key or prompt");
      })
      .then(function () {
        if (timer) clearTimeout(timer);
        btn.disabled = false;
      });
  });

  /* ================= Upgrade / license modal ================= */
  function openUpgrade(reason) {
    $("upgradeReason").textContent = reason || "Get every export format and an unlimited palette library.";
    var stripeBtn = $("buyStripe");
    var gumroadBtn = $("buyGumroad");
    var bmacBtn = $("buyBmac");
    var stripeLink = (CONFIG.stripe || {}).paymentLink;
    var gumroadLink = (CONFIG.gumroad || {}).buyUrl;
    var bmacLink = (CONFIG.buyMeACoffee || {}).buyUrl;
    stripeBtn.dataset.configured = stripeLink ? "1" : "0";
    gumroadBtn.dataset.configured = gumroadLink ? "1" : "0";
    bmacBtn.dataset.configured = bmacLink ? "1" : "0";
    $("licenseStatus").textContent = "";
    $("licenseStatus").className = "modal-status";
    syncProUi();
    UI.openModal("upgradeModal");
  }
  window.CslctOpenUpgrade = openUpgrade;

  $("upgradeBtn").addEventListener("click", function () { openUpgrade(); });
  $("buyStripe").addEventListener("click", function () {
    var link = (CONFIG.stripe || {}).paymentLink;
    if (link) { window.open(link, "_blank", "noopener"); }
    else { showToast("Stripe checkout isn\u2019t connected yet — the seller has yet to add a payment URL."); }
  });
  $("buyGumroad").addEventListener("click", function () {
    var link = (CONFIG.gumroad || {}).buyUrl;
    if (link) { window.open(link, "_blank", "noopener"); }
    else { showToast("Gumroad checkout isn\u2019t connected yet — the seller has yet to add a product URL."); }
  });
  $("buyBmac").addEventListener("click", function () {
    var link = (CONFIG.buyMeACoffee || {}).buyUrl;
    if (link) { window.open(link, "_blank", "noopener"); }
    else { showToast("Buy Me a Coffee checkout isn\u2019t connected yet — the seller has yet to add a product URL."); }
  });

  function setLicenseStatus(msg, ok) {
    var el = $("licenseStatus");
    el.textContent = msg;
    el.className = "modal-status " + (ok ? "ok" : "err");
  }

  $("redeemGift").addEventListener("click", function () {
    var btn = $("redeemGift");
    btn.disabled = true;
    License.redeemGiftCode($("giftCodeInput").value).then(function (r) {
      btn.disabled = false;
      setLicenseStatus(r.message, r.ok);
      if (r.ok) { onProChanged(); }
    });
  });
  $("verifyLicense").addEventListener("click", function () {
    var btn = $("verifyLicense");
    btn.disabled = true;
    setLicenseStatus("Checking your license\u2026", true);
    License.verifyGumroadLicense($("licenseKeyInput").value).then(function (r) {
      btn.disabled = false;
      setLicenseStatus(r.message, r.ok);
      if (r.ok) { onProChanged(); }
    });
  });
  $("deactivateLicense").addEventListener("click", function () {
    License.deactivate();
    onProChanged();
    setLicenseStatus("Pro deactivated on this browser.", true);
    showToast("Pro deactivated.");
  });

  function onProChanged() {
    syncProUi();
    renderExportTabs();
  }
  function syncProUi() {
    var pro = License.isPro();
    $("upgradeBtn").style.display = pro ? "none" : "";
    $("proBadge").style.display = pro ? "" : "none";
    $("licenseActive").style.display = pro ? "" : "none";
    $("licenseForms").style.display = pro ? "none" : "";
    if (pro) {
      var st = License.getState() || {};
      $("licenseActiveDetail").textContent =
        "Unlocked via " + (st.method === "gift" ? "gift code" : st.method === "gumroad" ? "Gumroad license" : "license") +
        (st.activatedAt ? " on " + new Date(st.activatedAt).toLocaleDateString() : "") + ".";
    }
  }

  /* ================= Guided tour ================= */
  var TOUR_STEPS = [
    { target: null, title: "Welcome to ColorSLCT!", body: "This little studio helps you pick five colors that belong together — and are easy for everyone to read. Let\u2019s take a quick walk. It takes about a minute." },
    { target: "tokenGrid", title: "Your five colors", body: "Every brand kit here has five jobs: a light background, a text color, two accent colors, and a dark background. Tap any swatch to change it, or type a code like #0066CC." },
    { target: "actionBar", title: "The designer buttons", body: "\u201CGenerate\u201D designs a fresh palette using real color theory — harmony models, moods, and readability built in. \u201CRe-harmonize\u201D spins your base color into a matching new mood. \u201CBack\u201D undoes. Push them as much as you like — nothing breaks." },
    { target: "previewContainer", title: "See it like your visitors will", body: "These two cards show your colors on a light page and a dark page, with real buttons and text. If it looks good here, it looks good live." },
    { target: "contrastPanel", title: "The readability report", body: "Green dots mean easy to read. Red means squint city. Turn on \u201CWCAG Auto\u201D and the studio fixes low-contrast colors for you, automatically." },
    { target: "exportBtn", title: "Take your colors home", body: "When you\u2019re happy, press \u201CExport\u201D to copy or download your colors as ready-to-use code. \u201CSave\u201D keeps palettes in your library; \u201CShare\u201D packs the palette into a URL for friends." },
    { target: null, title: "Set it up your way", body: "Two quick preferences and you\u2019re done. You can change these anytime.", prefs: true },
  ];
  var tourIndex = 0;

  function tourEls() {
    return { overlay: $("tourOverlay"), spotlight: $("tourSpotlight"), card: $("tourCard") };
  }

  function startTour() {
    tourIndex = 0;
    tourEls().overlay.classList.add("open");
    renderTourStep();
  }

  function endTour(completed) {
    tourEls().overlay.classList.remove("open");
    Store.set("cslct-tour-done", true);
    if (completed) showToast("You\u2019re all set. Go make something beautiful!");
  }

  function renderTourStep() {
    var els = tourEls();
    var step = TOUR_STEPS[tourIndex];
    var isLast = tourIndex === TOUR_STEPS.length - 1;

    var dots = TOUR_STEPS.map(function (_, i) {
      return '<span class="' + (i === tourIndex ? "active" : "") + '"></span>';
    }).join("");

    els.card.innerHTML =
      '<div class="tour-step-label">Step ' + (tourIndex + 1) + " of " + TOUR_STEPS.length + "</div>" +
      '<div class="tour-title"></div>' +
      '<div class="tour-body"></div>' +
      (step.prefs
        ? '<div class="tour-pref"><span class="pref-text">Dark mode<span class="pref-sub">Easier on the eyes at night</span></span><label class="switch"><input type="checkbox" id="prefDark"' + (document.documentElement.getAttribute("data-theme") === "dark" ? " checked" : "") + '><span class="slider"></span></label></div>' +
          '<div class="tour-pref"><span class="pref-text">WCAG Auto<span class="pref-sub">Automatically keep colors readable</span></span><label class="switch"><input type="checkbox" id="prefWcag"' + (wcagMode ? " checked" : "") + '><span class="slider"></span></label></div>'
        : "") +
      '<div class="tour-dots">' + dots + "</div>" +
      '<div class="tour-actions">' +
      (tourIndex > 0 ? '<button type="button" class="btn" id="tourPrev">Back</button>' : "") +
      '<button type="button" class="btn btn-primary" id="tourNext">' + (isLast ? "Finish" : "Next") + "</button>" +
      (!isLast ? '<button type="button" class="btn btn-ghost" id="tourSkip">Skip tour</button>' : "") +
      "</div>";
    els.card.querySelector(".tour-title").textContent = step.title;
    els.card.querySelector(".tour-body").textContent = step.body;

    /* spotlight */
    var target = step.target ? $(step.target) : null;
    if (target) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(function () {
        var r = target.getBoundingClientRect();
        els.spotlight.style.display = "";
        els.spotlight.style.top = Math.max(4, r.top - 8) + "px";
        els.spotlight.style.left = Math.max(4, r.left - 8) + "px";
        els.spotlight.style.width = Math.min(window.innerWidth - 8, r.width + 16) + "px";
        els.spotlight.style.height = r.height + 16 + "px";
        positionTourCard(r);
      }, 250);
    } else {
      els.spotlight.style.display = "none";
      els.card.style.top = "50%";
      els.card.style.left = "50%";
      els.card.style.transform = "translate(-50%, -50%)";
    }

    var nextBtn = $("tourNext");
    nextBtn.addEventListener("click", function () {
      if (isLast) { endTour(true); }
      else { tourIndex++; renderTourStep(); }
    });
    var prevBtn = $("tourPrev");
    if (prevBtn) prevBtn.addEventListener("click", function () { tourIndex--; renderTourStep(); });
    var skipBtn = $("tourSkip");
    if (skipBtn) skipBtn.addEventListener("click", function () { endTour(false); });
    var prefDark = $("prefDark");
    if (prefDark) prefDark.addEventListener("change", function () { UI.setTheme(prefDark.checked ? "dark" : "light"); });
    var prefWcag = $("prefWcag");
    if (prefWcag) prefWcag.addEventListener("change", function () { $("wcagBtn").click(); });
    nextBtn.focus();
  }

  function positionTourCard(targetRect) {
    var els = tourEls();
    var card = els.card;
    card.style.transform = "none";
    var ch = card.offsetHeight || 220;
    var cw = Math.min(window.innerWidth * 0.92, 360);
    var top = targetRect.bottom + 20;
    if (top + ch > window.innerHeight - 12) top = Math.max(12, targetRect.top - ch - 20);
    var left = Math.min(Math.max(12, targetRect.left), window.innerWidth - cw - 12);
    card.style.top = top + "px";
    card.style.left = left + "px";
  }

  $("helpBtn").addEventListener("click", startTour);

  /* ================= Boot ================= */
  syncWcagBtn();
  renderTokens();
  updateAll();
  /* Boot paint is done and did not persist; from here on, real activity saves. */
  persistArmed = true;
  onProChanged();

  /* deep links: #redeem opens the upgrade modal (used by pricing page) */
  if (/redeem/.test(window.location.hash)) {
    setTimeout(function () { openUpgrade("Redeem your gift code or license key below."); }, 350);
  }

  /* first-run tour (after consent banner has settled).
     Skipped when arriving via a #redeem deep link so the tour overlay and the
     upgrade modal never fight for the screen — replay anytime via "Show me around". */
  if (!Store.get("cslct-tour-done", false) && !/redeem/.test(window.location.hash)) {
    var startWhenReady = function () { setTimeout(startTour, 500); };
    if (Store.consent() === "accepted") { startWhenReady(); }
    else if (!Store.consent()) {
      /* never auto-start the tour after a DECLINE — the visitor opted out of
         persistence, so the tour-done flag cannot be saved anyway. The tour
         remains available anytime via "Show me around". */
      document.addEventListener("cslct:consent", function onConsent(ev) {
        if (ev && ev.detail !== "declined") startWhenReady();
      }, { once: true });
    }
  }

  /* react to palette hash changes while open (e.g. pasted share link) */
  window.addEventListener("hashchange", function () {
    var pal = readHashPalette();
    if (pal) { applyNewPalette(pal); showToast("Shared palette loaded."); }
  });
})();
