/* ============================================================
   ColorSLCT · app.js — studio logic
   Everything the studio does. State is local-first; nothing
   leaves the device except the optional BYO-key AI call and
   optional Gumroad license verification.
   ============================================================ */
(function () {
  'use strict';

  var Core = window.ColorCore, Ex = window.Exporters, Lic = window.License;
  var S = window.CSLCT; // shell: store/toast/modals/…
  var CONFIG = window.CSLCT_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  /* ── State ──────────────────────────────────────────────── */
  var DEFAULT_PRESET = Core.PRESETS[0].colors; // Professional
  var state = {
    palette: Object.assign({}, DEFAULT_PRESET),
    locks: {},
    wcagAuto: false,
    undoStack: [],
    redoStack: [],
    compare: [],
    library: [],
    cvd: 'none',
    editingToken: null,
    exportFormat: 'css',
    exportWithRamps: false
  };
  var HISTORY_MAX = 50;

  /* ── Persistence ────────────────────────────────────────── */
  function persist() {
    S.store.set('cslct.palette', { palette: state.palette, locks: state.locks, wcagAuto: state.wcagAuto });
    S.store.set('cslct.compare', state.compare);
  }
  function persistLibrary() { S.store.set('cslct.library', state.library); }

  function restore() {
    var saved = S.store.get('cslct.palette', null);
    if (saved && Core.sanitizePalette(saved.palette)) {
      state.palette = Core.sanitizePalette(saved.palette);
      state.locks = saved.locks || {};
      state.wcagAuto = !!saved.wcagAuto;
    }
    state.compare = (S.store.get('cslct.compare', []) || []).filter(function (c) {
      return c && Core.normalizeHex(c.hex);
    }).slice(0, 4);
    var lib = S.store.get('cslct.library', []);
    state.library = Array.isArray(lib) ? lib.filter(function (item) {
      return item && Core.sanitizePalette(item.palette);
    }) : [];
  }

  /* ── Entitlements ───────────────────────────────────────── */
  function isPro() { return Lic.can('ramps'); }

  function refreshPlanUI() {
    var st = Lic.getState();
    var badge = $('planBadge');
    if (st.pro && !st.graceExpired) {
      badge.textContent = st.plan === 'studio' ? 'STUDIO' : 'PRO';
      badge.classList.add('badge-volt');
      $('upgradeLink').textContent = 'Manage license';
    } else {
      badge.textContent = 'FREE';
      badge.classList.remove('badge-volt');
      $('upgradeLink').textContent = 'Unlock Pro';
    }
    document.querySelectorAll('[data-pro-tag]').forEach(function (el) {
      el.hidden = st.pro && !st.graceExpired;
    });
    document.querySelectorAll('[data-pro-feature]').forEach(function (el) {
      el.classList.toggle('chip-pro-locked', !(st.pro && !st.graceExpired));
    });
    $('rampsVeil').hidden = isPro();
    $('rampsGrid').style.filter = isPro() ? '' : 'blur(7px)';
    $('rampsGrid').style.pointerEvents = isPro() ? '' : 'none';
    $('rampsGrid').setAttribute('aria-hidden', isPro() ? 'false' : 'true');
  }

  function gate(featureLabel) {
    $('gateBody').textContent = featureLabel + ' is part of ColorSLCT Pro — one payment, no subscription, yours forever on this device.';
    S.openModal('gateModal');
  }

  /* ── Clipboard ──────────────────────────────────────────── */
  function copyText(text, okMsg) {
    var done = function () { S.toast(okMsg || 'Copied.'); };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? done() : S.toast('Copying is blocked here — select the text and copy it yourself.', 'warn');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* ── History (fixes v1: nothing is ever lost) ───────────── */
  function pushUndo() {
    state.undoStack.push({ palette: Object.assign({}, state.palette) });
    if (state.undoStack.length > HISTORY_MAX) state.undoStack.shift();
    state.redoStack = [];
  }
  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push({ palette: Object.assign({}, state.palette) });
    state.palette = state.undoStack.pop().palette;
    renderAll();
    persist();
  }
  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push({ palette: Object.assign({}, state.palette) });
    state.palette = state.redoStack.pop().palette;
    renderAll();
    persist();
  }

  /* ── Palette application pipeline (v1 semantics kept) ───── */
  function applyNewPalette(pal, opts) {
    opts = opts || {};
    var clean = Core.sanitizePalette(pal);
    if (!clean) { S.toast('Those colors didn’t make sense — nothing was changed.', 'warn'); return false; }
    if (state.wcagAuto && !opts.skipWcag) {
      var res = Core.enforceWCAG(clean);
      clean = res.palette;
      if (res.failed.length) {
        S.toast('Readability check: ' + res.failed.join(', ') + ' still needs a manual nudge.', 'warn');
      }
    }
    pushUndo();
    state.palette = clean;
    renderAll();
    persist();
    return true;
  }

  /* ── Rail ───────────────────────────────────────────────── */
  function renderRail() {
    var bars = Core.TOKENS.map(function (t) {
      var hex = state.palette[t];
      var info = Core.TOKEN_INFO[t];
      var fg = Core.bestTextOn(hex);
      var ratio = Core.contrast(hex === state.palette.bgLight ? state.palette.textPrimary : hex, state.palette.bgLight);
      var level = Core.wcagLevel(ratio);
      var showBadge = t === 'primary' || t === 'accent1' || t === 'textPrimary';
      return '<button type="button" class="rail-bar" data-token="' + t + '" style="background:' + hex + ';color:' + fg + '" aria-label="' + info.label + ' — ' + hex + '. Tap to edit.">' +
        '<span><span class="rb-role">' + info.label + '</span><br><span class="rb-hex">' + hex.toUpperCase() + '</span></span>' +
        '<span class="rb-side">' +
        (state.locks[t] ? '<svg class="rb-lock" viewBox="0 0 24 24" aria-label="locked"><path d="M17 8h-1V6a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zm-7-2a2 2 0 0 1 4 0v2h-4V6z"/></svg>' : '') +
        (showBadge ? '<span class="rb-badge">' + level + '</span>' : '') +
        '<span class="rb-edit">Edit ↗</span>' +
        '</span></button>';
    }).join('');
    $('railBars').innerHTML = bars;
    $('railBars').querySelectorAll('.rail-bar').forEach(function (bar) {
      bar.addEventListener('click', function () { openEditor(bar.dataset.token); });
    });
  }

  /* ── Token editor ───────────────────────────────────────── */
  function openEditor(token) {
    state.editingToken = token;
    var info = Core.TOKEN_INFO[token];
    $('editorTitle').textContent = 'Edit · ' + info.label;
    $('editorHint').textContent = info.hint + '. Pick with the swatch, or type a hex code.';
    $('editorEyedrop').hidden = !('EyeDropper' in window);
    syncEditor();
    S.openModal('editorModal');
  }

  function syncEditor() {
    var t = state.editingToken;
    if (!t) return;
    var hex = state.palette[t];
    var sw = $('editorSwatch');
    sw.style.background = hex;
    sw.style.color = Core.bestTextOn(hex);
    $('editorSwatchHex').textContent = hex.toUpperCase();
    $('editorColor').value = hex;
    if (document.activeElement !== $('editorHex')) $('editorHex').value = hex;
    var lock = !!state.locks[t];
    $('editorLock').classList.toggle('is-on', lock);
    $('editorLock').setAttribute('aria-pressed', String(lock));
    $('editorLockLabel').textContent = lock ? 'Locked' : 'Lock';
    var ratio = Core.contrast(hex, t === 'bgLight' ? state.palette.textPrimary : state.palette.bgLight);
    var level = Core.wcagLevel(ratio);
    var badge = $('editorContrast');
    badge.textContent = ratio.toFixed(1) + ':1 ' + level + (t === 'bgLight' ? ' vs text' : ' vs background');
    badge.className = 'badge ' + (level === 'AAA' ? 'badge-ok' : level === 'AA' ? 'badge-warn' : 'badge-bad');
    $('editorCopyChips').innerHTML = [
      ['HEX', hex.toUpperCase()],
      ['RGB', Core.hexToRgbString(hex)],
      ['HSL', Core.hexToHslString(hex)],
      ['OKLCH', Core.hexToOklchString(hex)]
    ].map(function (pair) {
      return '<button type="button" class="chip" data-copy="' + pair[1] + '">' + pair[0] + '</button>';
    }).join('');
    $('editorCopyChips').querySelectorAll('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () { copyText(b.dataset.copy, b.dataset.copy + ' copied.'); });
    });
  }

  function setToken(token, hex, commit) {
    var clean = Core.normalizeHex(hex);
    if (!clean) return false;
    if (commit) pushUndo();
    state.palette[token] = clean;
    renderAll();
    persist();
    return true;
  }

  /* editor events — one undo step per drag, live preview while dragging */
  var dragStartPalette = null;
  $('editorColor').addEventListener('input', function () {
    if (!dragStartPalette) dragStartPalette = Object.assign({}, state.palette);
    state.palette[state.editingToken] = this.value;
    renderAll({ light: true });
  });
  $('editorColor').addEventListener('change', function () {
    var before = dragStartPalette || Object.assign({}, state.palette);
    dragStartPalette = null;
    state.palette[state.editingToken] = this.value;
    state.undoStack.push({ palette: before });
    if (state.undoStack.length > HISTORY_MAX) state.undoStack.shift();
    state.redoStack = [];
    renderAll();
    persist();
  });
  $('editorHex').addEventListener('input', function () {
    var clean = Core.normalizeHex(this.value);
    this.style.borderColor = clean ? '' : 'var(--bad)';
    if (clean) {
      state.palette[state.editingToken] = clean;
      renderAll({ light: true });
    }
  });
  $('editorHex').addEventListener('change', function () {
    var clean = Core.normalizeHex(this.value);
    if (!clean) {
      this.value = state.palette[state.editingToken];
      this.style.borderColor = '';
      S.toast('Hex codes look like #22AACC — six letters or numbers.', 'warn');
      return;
    }
    setToken(state.editingToken, clean, true);
  });
  $('editorEyedrop').addEventListener('click', function () {
    if (!('EyeDropper' in window)) return;
    var picker = new window.EyeDropper();
    picker.open().then(function (res) {
      setToken(state.editingToken, res.sRGBHex, true);
      S.toast('Picked ' + res.sRGBHex.toUpperCase() + '.');
    }).catch(function () { /* user cancelled — fine */ });
  });
  $('editorLock').addEventListener('click', function () {
    var t = state.editingToken;
    state.locks[t] = !state.locks[t];
    S.toast(state.locks[t]
      ? Core.TOKEN_INFO[t].label + ' is locked — Shuffle and Harmony will leave it alone.'
      : Core.TOKEN_INFO[t].label + ' is unlocked.');
    renderAll();
    persist();
  });
  $('editorCompare').addEventListener('click', function () {
    addToCompare(state.palette[state.editingToken], state.editingToken);
  });

  /* ── Preview ────────────────────────────────────────────── */
  function mockHTML(bg, text, primary, accent, label) {
    var onPrimary = Core.bestTextOn(primary);
    var onAccent = Core.bestTextOn(accent);
    var sub = 'color:' + text + ';';
    return '<div class="mock" style="background:' + bg + ';color:' + text + '">' +
      '<div class="mock-top"><span class="mock-brand">Aurora ' + label + '</span>' +
      '<span class="mock-dots"><i style="background:' + primary + '"></i><i style="background:' + accent + '"></i><i style="background:' + text + ';opacity:.4"></i></span></div>' +
      '<div class="mock-h1">Design that stays readable.</div>' +
      '<p class="mock-p" style="' + sub + '">Every piece of this little page is painted with your five colors — so you can judge them doing real work.</p>' +
      '<div class="mock-btn-row">' +
      '<button class="mock-btn" style="background:' + primary + ';color:' + onPrimary + '" tabindex="-1">Get started</button>' +
      '<button class="mock-btn" style="background:transparent;color:' + text + ';box-shadow:inset 0 0 0 1px ' + text + '55" tabindex="-1">Learn more</button>' +
      '</div>' +
      '<div class="mock-card" style="background:' + text + '14;">' +
      '<span>Monthly report ready</span>' +
      '<span class="mock-tag" style="background:' + accent + ';color:' + onAccent + '">New</span>' +
      '</div></div>';
  }

  function renderPreview() {
    var p = state.palette;
    $('previewGrid').innerHTML =
      mockHTML(p.bgLight, p.textPrimary, p.primary, p.accent1, 'Day') +
      mockHTML(p.bgDark, p.bgLight, p.primary, p.accent1, 'Night');
    var filter = state.cvd !== 'none' ? 'url(#cvd-' + state.cvd + ')' : '';
    $('previewGrid').style.filter = filter;
    $('railBars').style.filter = filter;
  }

  /* ── Contrast matrix ────────────────────────────────────── */
  function renderContrast() {
    var p = state.palette;
    var pairs = [
      { label: 'Text on background', fg: p.textPrimary, bg: p.bgLight, target: 7 },
      { label: 'Primary on background', fg: p.primary, bg: p.bgLight, target: 4.5 },
      { label: 'Accent on background', fg: p.accent1, bg: p.bgLight, target: 4.5 },
      { label: 'Background on dark', fg: p.bgLight, bg: p.bgDark, target: 4.5 },
      { label: 'Primary on dark', fg: p.primary, bg: p.bgDark, target: 4.5 },
      { label: 'Accent on dark', fg: p.accent1, bg: p.bgDark, target: 4.5 },
      { label: 'Text on primary (buttons)', fg: Core.bestTextOn(p.primary), bg: p.primary, target: 4.5 },
      { label: 'Text on accent (badges)', fg: Core.bestTextOn(p.accent1), bg: p.accent1, target: 4.5 }
    ];
    $('contrastList').innerHTML = pairs.map(function (pair) {
      var ratio = Core.contrast(pair.fg, pair.bg);
      var level = Core.wcagLevel(ratio);
      var cls = level === 'AAA' ? 'badge-ok' : level === 'AA' ? 'badge-warn' : 'badge-bad';
      if (level === 'AA' && ratio >= pair.target) cls = 'badge-ok';
      return '<div class="contrast-row">' +
        '<span class="contrast-pair">' +
        '<span class="cp-chip" style="background:' + pair.bg + ';color:' + pair.fg + '">Aa</span>' +
        '<span class="cp-label">' + pair.label + '</span></span>' +
        '<span class="badge contrast-badge ' + cls + '">' + ratio.toFixed(1) + ':1 ' + level + '</span>' +
        '</div>';
    }).join('');
  }

  /* ── Ramps ──────────────────────────────────────────────── */
  function renderRamps() {
    var html = Core.TOKENS.map(function (t) {
      var cells = Core.ramp(state.palette[t]).map(function (s) {
        var fg = Core.bestTextOn(s.hex);
        return '<button type="button" class="ramp-cell" style="background:' + s.hex + ';color:' + fg + '" data-copy="' + s.hex + '" title="' + Core.TOKEN_INFO[t].label + ' ' + s.step + ' — ' + s.hex.toUpperCase() + ' (tap to copy)"><span>' + s.step + '</span></button>';
      }).join('');
      return '<div class="ramp-row"><span class="ramp-title">' + Core.TOKEN_INFO[t].label + '</span><div class="ramp-cells">' + cells + '</div></div>';
    }).join('');
    $('rampsGrid').innerHTML = html;
    $('rampsGrid').querySelectorAll('[data-copy]').forEach(function (b) {
      b.addEventListener('click', function () { copyText(b.dataset.copy.toUpperCase(), b.dataset.copy.toUpperCase() + ' copied.'); });
    });
  }

  /* ── Compare (v1 drag-reorder kept) ─────────────────────── */
  function addToCompare(hex, role) {
    if (state.compare.length >= 4) { S.toast('Compare is full — remove one first (max 4).', 'warn'); return; }
    state.compare.push({ hex: hex, role: role, id: Date.now() + Math.floor(Math.random() * 1e4) });
    renderCompare();
    persist();
    S.toast('Added to Compare.');
  }

  function renderCompare() {
    var slots = $('compareSlots');
    $('compareCount').textContent = state.compare.length + ' / 4';
    $('compareHint').hidden = state.compare.length > 0;
    slots.innerHTML = state.compare.map(function (s) {
      var fg = Core.bestTextOn(s.hex);
      var ratio = Core.contrast(s.hex, state.palette.bgLight);
      return '<div class="compare-swatch" style="background:' + s.hex + ';color:' + fg + '" data-id="' + s.id + '" tabindex="0" role="group" aria-label="Swatch ' + s.hex + ' from ' + (s.role || 'palette') + '">' +
        '<span class="cs-wcag">' + ratio.toFixed(1) + ':1</span>' +
        '<span>' + s.hex.toUpperCase() + '</span>' +
        '<button type="button" class="remove-sw" data-id="' + s.id + '" aria-label="Remove ' + s.hex + ' from compare">×</button>' +
        '</div>';
    }).join('');
    initCompareDrag();
  }

  function initCompareDrag() {
    var slots = $('compareSlots');
    var dragEl = null;
    slots.querySelectorAll('.compare-swatch').forEach(function (sw) {
      sw.addEventListener('pointerdown', function (e) {
        if (e.target.classList.contains('remove-sw')) return;
        dragEl = sw;
        sw.setPointerCapture(e.pointerId);
        sw.classList.add('dragging');
        e.preventDefault();
      });
      sw.addEventListener('pointermove', function (e) {
        if (!dragEl) return;
        var target = document.elementFromPoint(e.clientX, e.clientY);
        target = target && target.closest ? target.closest('.compare-swatch') : null;
        if (target && target !== dragEl) {
          var from = state.compare.findIndex(function (s) { return String(s.id) === dragEl.dataset.id; });
          var to = state.compare.findIndex(function (s) { return String(s.id) === target.dataset.id; });
          if (from > -1 && to > -1) {
            var moved = state.compare.splice(from, 1)[0];
            state.compare.splice(to, 0, moved);
            renderCompare();
            dragEl = slots.querySelector('[data-id="' + moved.id + '"]');
            if (dragEl) dragEl.classList.add('dragging');
            persist();
          }
        }
      });
      var up = function (e) {
        if (!dragEl) return;
        dragEl.classList.remove('dragging');
        try { dragEl.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
        dragEl = null;
      };
      sw.addEventListener('pointerup', up);
      sw.addEventListener('pointercancel', up);
    });
    slots.querySelectorAll('.remove-sw').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        state.compare = state.compare.filter(function (s) { return String(s.id) !== btn.dataset.id; });
        renderCompare();
        persist();
      });
    });
  }

  /* ── History strip (v1 kept, restore no longer loses work) ─ */
  function renderHistoryStrip() {
    var strip = $('historyStrip');
    var recent = state.undoStack.slice(-8).reverse();
    strip.innerHTML = recent.map(function (item, i) {
      var sw = Core.TOKENS.map(function (t) {
        return '<span class="history-swatch" style="background:' + item.palette[t] + '"></span>';
      }).join('');
      return '<button type="button" class="history-dot" data-hidx="' + (state.undoStack.length - 1 - i) + '" aria-label="Bring back palette ' + (i + 1) + ' steps ago">' + sw + '</button>';
    }).join('');
    strip.querySelectorAll('.history-dot').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.hidx, 10);
        var target = state.undoStack[idx];
        if (!target) return;
        pushUndo();
        state.palette = Object.assign({}, target.palette);
        renderAll();
        persist();
        S.toast('Palette restored.');
      });
    });
    $('actUndo').disabled = !state.undoStack.length;
    $('actRedo').disabled = !state.redoStack.length;
  }

  /* ── Render orchestrator ────────────────────────────────── */
  function renderAll(opts) {
    opts = opts || {};
    renderRail();
    renderPreview();
    renderContrast();
    renderRamps();
    if (!opts.light) {
      renderCompare();
      renderHistoryStrip();
      renderLibrary();
    }
    if (state.editingToken && $('editorModal').classList.contains('open')) syncEditor();
  }

  /* ── Deck actions ───────────────────────────────────────── */
  $('actRandom').addEventListener('click', function () {
    var pal = Core.randomPalette(Math.random, state.locks, state.palette);
    applyNewPalette(pal, { skipWcag: true }); // generator is already WCAG-safe
    S.toast('Five fresh colors. Tap Shuffle again for another set.');
  });
  $('actUndo').addEventListener('click', undo);
  $('actRedo').addEventListener('click', redo);
  $('actHarmony').addEventListener('click', function () {
    applyNewPalette(Core.rotateHues(state.palette, 30, state.locks));
    S.toast('Every hue turned 30°.');
  });
  $('actWcag').addEventListener('click', function () {
    state.wcagAuto = !state.wcagAuto;
    this.setAttribute('aria-pressed', String(state.wcagAuto));
    this.classList.toggle('is-on', state.wcagAuto);
    $('wcagState').textContent = state.wcagAuto ? 'ON' : 'OFF';
    if (state.wcagAuto) {
      var res = Core.enforceWCAG(state.palette);
      if (JSON.stringify(res.palette) !== JSON.stringify(state.palette)) {
        pushUndo();
        state.palette = res.palette;
        renderAll();
      }
      S.toast('Readability guard is ON — new palettes get auto-fixed to pass WCAG.');
    } else {
      S.toast('Readability guard is OFF.');
    }
    persist();
  });
  $('actFixContrast').addEventListener('click', function () {
    var res = Core.enforceWCAG(state.palette);
    if (JSON.stringify(res.palette) === JSON.stringify(state.palette)) {
      S.toast('Already passing — nothing to fix.');
      return;
    }
    pushUndo();
    state.palette = res.palette;
    renderAll();
    persist();
    S.toast(res.failed.length ? 'Improved, but ' + res.failed.join(', ') + ' needs a manual nudge.' : 'Fixed — everything passes now.');
  });

  /* presets */
  $('actPresets').addEventListener('click', function () {
    var grid = $('presetGrid');
    grid.innerHTML = Core.PRESETS.map(function (pr) {
      var strip = Core.TOKENS.map(function (t) { return '<i style="background:' + pr.colors[t] + '"></i>'; }).join('');
      return '<button type="button" class="preset-card" data-preset="' + pr.id + '">' +
        '<span class="lib-strip">' + strip + '</span>' +
        '<span class="preset-name">' + pr.name + '</span></button>';
    }).join('');
    grid.querySelectorAll('[data-preset]').forEach(function (b) {
      b.addEventListener('click', function () {
        var preset = Core.PRESETS.find(function (p) { return p.id === b.dataset.preset; });
        if (preset) {
          applyNewPalette(preset.colors);
          S.closeModal('presetsModal');
          S.toast(preset.name + ' loaded.');
        }
      });
    });
    S.openModal('presetsModal', this);
  });

  /* ── Export ─────────────────────────────────────────────── */
  function currentExportText() {
    var withRamps = state.exportWithRamps && isPro();
    switch (state.exportFormat) {
      case 'css': return Ex.toCSS(state.palette, withRamps);
      case 'scss': return Ex.toSCSS(state.palette, withRamps);
      case 'tw4': return Ex.toTailwind4(state.palette, withRamps);
      case 'tw3': return Ex.toTailwind3(state.palette, withRamps);
      case 'json': return Ex.toTokensJSON(state.palette, withRamps, {});
      case 'js': return Ex.toJS(state.palette, withRamps);
      case 'svg': return Ex.toSVG(state.palette, 'ColorSLCT palette');
      default: return Ex.toCSS(state.palette, withRamps);
    }
  }

  function renderExport() {
    var list = $('formatList');
    list.innerHTML = Ex.FORMATS.map(function (f) {
      var locked = f.pro && !isPro();
      return '<button type="button" class="chip" role="radio" aria-checked="' + String(f.id === state.exportFormat) + '" data-format="' + f.id + '" data-locked="' + locked + '">' +
        f.label + (locked ? ' <svg class="chip-lock" viewBox="0 0 24 24" aria-label="Pro"><path d="M17 8h-1V6a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zm-7-2a2 2 0 0 1 4 0v2h-4V6z"/></svg>' : '') +
        '</button>';
    }).join('');
    list.querySelectorAll('[data-format]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.locked === 'true') { gate('This export format'); return; }
        state.exportFormat = b.dataset.format;
        renderExport();
      });
    });
    var rampsBox = $('exportRamps');
    rampsBox.checked = state.exportWithRamps && isPro();
    $('exportOutput').textContent = currentExportText();
  }

  $('actExport').addEventListener('click', function () {
    if (!isPro()) state.exportFormat = 'css';
    renderExport();
    S.openModal('exportModal', this);
  });
  $('exportRamps').addEventListener('change', function () {
    if (!isPro()) { this.checked = false; gate('Shade-scale export'); return; }
    state.exportWithRamps = this.checked;
    renderExport();
  });
  $('exportCopy').addEventListener('click', function () {
    copyText(currentExportText(), 'Export copied — paste it straight into your project.');
  });
  $('exportDownload').addEventListener('click', function () {
    var f = Ex.FORMATS.find(function (x) { return x.id === state.exportFormat; });
    download('colorslct-palette.' + (f ? f.ext : 'txt'), currentExportText(), f ? f.mime : 'text/plain');
    S.toast('Downloading your file…');
  });
  $('exportPng').addEventListener('click', function () {
    if (!isPro()) { gate('PNG palette cards'); return; }
    var W = 1200, H = 630, n = Core.TOKENS.length;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    Core.TOKENS.forEach(function (t, i) {
      ctx.fillStyle = state.palette[t];
      ctx.fillRect(Math.floor(i * W / n), 0, Math.ceil(W / n) + 1, H);
      ctx.fillStyle = Core.bestTextOn(state.palette[t]);
      ctx.font = '600 26px monospace';
      ctx.fillText(state.palette[t].toUpperCase(), i * W / n + 24, H - 64);
      ctx.globalAlpha = 0.75;
      ctx.font = '20px sans-serif';
      ctx.fillText(Core.TOKEN_INFO[t].label, i * W / n + 24, H - 30);
      ctx.globalAlpha = 1;
    });
    ctx.fillStyle = Core.bestTextOn(state.palette.bgLight);
    ctx.font = '700 34px sans-serif';
    ctx.fillText('ColorSLCT palette', 24, 52);
    canvas.toBlob(function (blob) {
      if (!blob) { S.toast('PNG failed in this browser — try the SVG card instead.', 'bad'); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'colorslct-palette.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      S.toast('PNG card on its way.');
    }, 'image/png');
  });

  /* ── AI (v1 flow kept: DeepSeek, BYO key) ───────────────── */
  var aiAbort = null;
  $('actAI').addEventListener('click', function () {
    $('aiRememberWrap').hidden = S.consentChoice() !== 'all';
    var savedKey = S.store.get('cslct.aikey', '');
    if (savedKey) { $('aiKey').value = savedKey; $('aiRemember').checked = true; }
    S.openModal('aiModal', this);
  });
  $('aiPrompt').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('aiGenerate').click(); }
  });
  document.addEventListener('cslct:modal-close', function (e) {
    if (e.detail === 'aiModal' && aiAbort) { aiAbort.abort(); aiAbort = null; }
  });
  $('aiGenerate').addEventListener('click', function () {
    var key = $('aiKey').value.trim();
    var prompt = $('aiPrompt').value.trim() || 'professional SaaS brand';
    var status = $('aiStatus');
    status.classList.remove('is-error');
    if (!key) {
      status.textContent = 'Add your DeepSeek API key first — it starts with “sk-”.';
      status.classList.add('is-error');
      return;
    }
    if ($('aiRemember').checked && S.consentChoice() === 'all') S.store.set('cslct.aikey', key);
    else S.store.remove('cslct.aikey');

    status.textContent = 'Mixing colors…';
    var btn = $('aiGenerate');
    btn.disabled = true;
    aiAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      signal: aiAbort ? aiAbort.signal : undefined,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'You are a design token generator. You output only a JSON object with keys "bgLight", "textPrimary", "primary", "accent1", "bgDark". Each value is a hex color like "#AABBCC". No extra text, no markdown fences.\n\nToken roles:\n- "bgLight": lightest background (aim Oklch L≈0.95, C≈0.03)\n- "textPrimary": darkest text/foreground (aim Oklch L≈0.18, C≈0.04)\n- "primary": vibrant accent (medium lightness, Oklch C≥0.15)\n- "accent1": secondary accent (vibrant, medium lightness, Oklch C≥0.15, hue >90° from primary)\n- "bgDark": deepest dark background (near black, distinct from textPrimary; avoid pure #000000)\n\nEnsure strong chroma for accents, distinct hues (≥120° apart), and clear luminance hierarchy.\nExample: {"bgLight":"#F4F4F6","textPrimary":"#1D1D1F","primary":"#0066CC","accent1":"#E0004D","bgDark":"#0A0A1A"}' },
          { role: 'user', content: 'Current palette: ' + JSON.stringify(state.palette) + '\nModify this palette according to: ' + prompt + '\nReturn only the modified JSON.' }
        ],
        temperature: 0.8
      })
    }).then(function (res) {
      if (res.status === 401) throw new Error('That key was rejected — double-check it on platform.deepseek.com.');
      if (res.status === 402) throw new Error('Your DeepSeek account is out of credit.');
      if (res.status === 429) throw new Error('DeepSeek is rate-limiting you — wait a moment and try again.');
      if (!res.ok) throw new Error('DeepSeek answered with an error (HTTP ' + res.status + ').');
      return res.json();
    }).then(function (data) {
      var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error('DeepSeek sent back an empty answer — try again.');
      var match = content.match(/\{[\s\S]*\}/);
      var json = JSON.parse(match ? match[0] : content);
      var clean = Core.sanitizePalette(json);
      if (!clean) throw new Error('The AI answered with something that wasn’t a palette — try rewording.');
      applyNewPalette(clean);
      S.closeModal('aiModal');
      status.textContent = '';
      S.toast('AI palette applied — Undo brings the old one back.');
    }).catch(function (err) {
      if (err && err.name === 'AbortError') { status.textContent = ''; return; }
      status.textContent = (err && err.message) || 'Something went wrong — check your key and connection.';
      status.classList.add('is-error');
    }).finally(function () {
      btn.disabled = false;
      aiAbort = null;
    });
  });

  /* ── Import ─────────────────────────────────────────────── */
  $('actImport').addEventListener('click', function () {
    $('importStatus').textContent = '';
    S.openModal('importModal', this);
  });
  $('importApply').addEventListener('click', function () {
    var res = Ex.parseImport($('importText').value);
    var status = $('importStatus');
    if (!res.palette) {
      status.textContent = res.error;
      status.classList.add('is-error');
      return;
    }
    status.classList.remove('is-error');
    applyNewPalette(res.palette);
    S.closeModal('importModal');
    $('importText').value = '';
    S.toast('Imported — five roles filled in for you.');
  });

  /* ── Image extraction (Pro) ─────────────────────────────── */
  var extracted = [];
  $('actImage').addEventListener('click', function () {
    if (!Lic.can('image')) { gate('Palette-from-image'); return; }
    extracted = [];
    $('extractStrip').innerHTML = '';
    $('imageApply').disabled = true;
    $('dropZoneLabel').innerHTML = 'Tap to choose an image<br><small>or drag one in</small>';
    S.openModal('imageModal', this);
  });
  function handleImageFile(file) {
    if (!file || !file.type || file.type.indexOf('image/') !== 0) {
      S.toast('That file isn’t an image — try a JPG or PNG.', 'warn');
      return;
    }
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      var c = document.createElement('canvas');
      var size = 72;
      c.width = size; c.height = size;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      var data;
      try { data = ctx.getImageData(0, 0, size, size).data; }
      catch (e) { S.toast('This browser blocked reading that image. Try another file.', 'bad'); return; }
      extracted = Core.quantize(data, 6);
      if (!extracted.length) { S.toast('Couldn’t find usable colors in that image.', 'warn'); return; }
      $('extractStrip').innerHTML = extracted.map(function (hex) {
        return '<button type="button" style="background:' + hex + '" data-copy="' + hex + '" title="' + hex.toUpperCase() + ' — tap to copy" aria-label="Copy ' + hex + '"></button>';
      }).join('');
      $('extractStrip').querySelectorAll('[data-copy]').forEach(function (b) {
        b.addEventListener('click', function () { copyText(b.dataset.copy.toUpperCase()); });
      });
      $('imageApply').disabled = false;
      $('dropZoneLabel').innerHTML = 'Nice — here’s what we found.<br><small>Choose another image any time.</small>';
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      S.toast('That image couldn’t be opened.', 'bad');
    };
    img.src = url;
  }
  $('imageFile').addEventListener('change', function () { handleImageFile(this.files && this.files[0]); });
  var dz = $('dropZone');
  ['dragover', 'dragenter'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('is-over'); });
  });
  dz.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    handleImageFile(f);
  });
  $('imageApply').addEventListener('click', function () {
    var pal = Core.paletteFromSwatches(extracted);
    if (!pal) { S.toast('Couldn’t build a palette from those colors.', 'warn'); return; }
    applyNewPalette(pal, { skipWcag: true });
    S.closeModal('imageModal');
    S.toast('Palette built from your image — readable out of the box.');
  });

  /* ── CVD simulation (Pro) ───────────────────────────────── */
  (function initCvdFilters() {
    ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'].forEach(function (type) {
      var el = document.getElementById('cvdM-' + type);
      if (el) el.setAttribute('values', Core.cvdFilterValues(type));
    });
  })();
  $('cvdSelect').addEventListener('change', function () {
    if (this.value !== 'none' && !Lic.can('cvd')) {
      this.value = 'none';
      gate('Color-blindness preview');
      return;
    }
    state.cvd = this.value;
    renderPreview();
    S.toast(state.cvd === 'none' ? 'Back to typical vision.' : 'Previewing ' + this.options[this.selectedIndex].text + '.');
  });

  /* ── Share ──────────────────────────────────────────────── */
  function shareURL() {
    var base = CONFIG.SITE_URL
      ? CONFIG.SITE_URL.replace(/\/$/, '') + '/app.html'
      : location.href.split('#')[0];
    return base + '#p=' + Ex.encodeShare(state.palette);
  }
  $('actShare').addEventListener('click', function () {
    $('shareUrl').value = shareURL();
    $('shareNative').hidden = !navigator.share;
    S.openModal('shareModal', this);
  });
  $('shareCopy').addEventListener('click', function () {
    copyText($('shareUrl').value, 'Link copied — send it to anyone.');
  });
  $('shareNative').addEventListener('click', function () {
    navigator.share({ title: 'My ColorSLCT palette', url: $('shareUrl').value }).catch(function () { /* user cancelled */ });
  });

  /* ── Save / Library ─────────────────────────────────────── */
  $('actSave').addEventListener('click', function () {
    $('saveStatus').textContent = '';
    var limit = Lic.libraryLimit();
    if (state.library.length >= limit) {
      gate('More than ' + limit + ' saved palettes');
      return;
    }
    $('saveName').value = '';
    S.openModal('saveModal', this);
  });
  $('saveName').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('saveConfirm').click(); }
  });
  $('saveConfirm').addEventListener('click', function () {
    var name = $('saveName').value.trim() || 'Untitled palette';
    state.library.unshift({
      id: Date.now(),
      name: name.slice(0, 60),
      palette: Object.assign({}, state.palette),
      created: new Date().toISOString()
    });
    persistLibrary();
    renderLibrary();
    S.closeModal('saveModal');
    if (!S.store.allowed()) {
      S.toast('Saved for this visit. Turn on saving (footer → storage choices) to keep it for good.', 'warn');
    } else {
      S.toast('“' + name + '” saved to your library.');
    }
  });

  function renderLibrary() {
    var grid = $('libraryGrid');
    var limit = Lic.libraryLimit();
    $('libraryCount').textContent = state.library.length + (limit === Infinity ? '' : ' / ' + limit);
    $('libraryHint').hidden = state.library.length > 0;
    grid.innerHTML = state.library.map(function (item) {
      var strip = Core.TOKENS.map(function (t) { return '<i style="background:' + item.palette[t] + '"></i>'; }).join('');
      var date = new Date(item.created);
      var dateStr = isNaN(date) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      return '<div class="lib-card" data-id="' + item.id + '">' +
        '<div class="lib-strip">' + strip + '</div>' +
        '<div class="lib-meta">' +
        '<span class="lib-name"></span>' +
        '<span class="lib-date">' + dateStr + '</span>' +
        '<span class="lib-actions">' +
        '<button type="button" class="chip" data-lib-apply>Apply</button>' +
        '<button type="button" class="chip" data-lib-rename>Rename</button>' +
        '<button type="button" class="chip" data-lib-dup>Duplicate</button>' +
        '<button type="button" class="chip chip-danger" data-lib-del>Delete</button>' +
        '</span></div></div>';
    }).join('');
    // names via textContent (never trust stored strings as HTML)
    grid.querySelectorAll('.lib-card').forEach(function (card) {
      var item = state.library.find(function (x) { return String(x.id) === card.dataset.id; });
      if (!item) return;
      card.querySelector('.lib-name').textContent = item.name;
      card.querySelector('[data-lib-apply]').addEventListener('click', function () {
        applyNewPalette(item.palette, { skipWcag: true });
        S.toast('“' + item.name + '” applied.');
      });
      card.querySelector('[data-lib-rename]').addEventListener('click', function () {
        var next = window.prompt('New name for this palette:', item.name);
        if (next === null) return;
        item.name = next.trim().slice(0, 60) || item.name;
        persistLibrary();
        renderLibrary();
      });
      card.querySelector('[data-lib-dup]').addEventListener('click', function () {
        var limit = Lic.libraryLimit();
        if (state.library.length >= limit) { gate('More than ' + limit + ' saved palettes'); return; }
        state.library.unshift({
          id: Date.now(),
          name: (item.name + ' copy').slice(0, 60),
          palette: Object.assign({}, item.palette),
          created: new Date().toISOString()
        });
        persistLibrary();
        renderLibrary();
      });
      card.querySelector('[data-lib-del]').addEventListener('click', function () {
        if (!window.confirm('Delete “' + item.name + '”? This can’t be undone.')) return;
        state.library = state.library.filter(function (x) { return x.id !== item.id; });
        persistLibrary();
        renderLibrary();
        S.toast('Deleted.');
      });
    });
  }

  /* ── Preferences ────────────────────────────────────────── */
  function syncPrefsUI() {
    var theme = document.documentElement.getAttribute('data-theme');
    $('prefDark').classList.toggle('is-on', theme !== 'light');
    $('prefLight').classList.toggle('is-on', theme === 'light');
    $('prefMotion').checked = document.documentElement.getAttribute('data-motion') === 'reduced';
    var choice = S.consentChoice();
    $('prefStorageNote').textContent = choice === 'all'
      ? 'Saving is ON — palettes and settings stay on this device.'
      : choice === 'essential'
        ? 'Saving is limited to essentials — your work lasts until the tab closes.'
        : 'You haven’t chosen yet — the banner will ask you.';
  }
  $('actPrefs').addEventListener('click', function () {
    syncPrefsUI();
    S.openModal('prefsModal', this);
  });
  $('prefDark').addEventListener('click', function () {
    document.documentElement.setAttribute('data-theme', 'dark');
    S.store.set('cslct.theme', 'dark');
    syncPrefsUI();
  });
  $('prefLight').addEventListener('click', function () {
    document.documentElement.setAttribute('data-theme', 'light');
    S.store.set('cslct.theme', 'light');
    syncPrefsUI();
  });
  $('prefMotion').addEventListener('change', function () {
    S.setMotionPref(this.checked);
    S.toast(this.checked ? 'Calm mode on — animations are off.' : 'Animations are back on.');
  });
  $('prefTour').addEventListener('click', function () {
    S.closeModal('prefsModal');
    startTour();
  });
  $('prefWipe').addEventListener('click', function () {
    if (!window.confirm('Erase every palette, setting and license stored in this browser? This can’t be undone.')) return;
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('cslct.') === 0) kill.push(k);
      }
      kill.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* storage unavailable — nothing to erase */ }
    location.reload();
  });
  document.addEventListener('cslct:theme', renderAll.bind(null, { light: true }));
  document.addEventListener('cslct:consent', function () {
    persist(); persistLibrary();
    maybeStartTour();
  });

  /* ── Help ───────────────────────────────────────────────── */
  $('helpBtn').addEventListener('click', function () { S.openModal('helpModal', this); });
  $('helpTour').addEventListener('click', function () {
    S.closeModal('helpModal');
    startTour();
  });

  /* ── Keyboard shortcuts ─────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (mod) return;
    if (document.querySelector('.modal.open') || document.querySelector('.tour-veil')) {
      return;
    }
    switch (e.key.toLowerCase()) {
      case 'r': e.preventDefault(); $('actRandom').click(); break;
      case 'h': e.preventDefault(); $('actHarmony').click(); break;
      case 'e': e.preventDefault(); $('actExport').click(); break;
      case 's': e.preventDefault(); $('actSave').click(); break;
      case '?': e.preventDefault(); S.openModal('helpModal'); break;
    }
  });

  /* ── Tour ───────────────────────────────────────────────── */
  function startTour() {
    var steps = [
      { target: null, title: 'Welcome to ColorSLCT', body: 'This is your color studio. In one minute you’ll know everything you need. Use Next, or the → key.' },
      { target: '.rail-bars', title: 'These five bars are your palette', body: 'Background, text, two accents and a dark tone — the five colors every design needs. Tap any bar to change it.' },
      { target: '#actRandom', title: 'Stuck? Shuffle.', body: 'Tap Shuffle and five colors that already work together appear. Try it as often as you like — Undo always brings the old set back.' },
      { target: '#actWcag', title: 'The readability guard', body: 'Turn this on and every new palette is auto-checked so text stays easy to read — for everyone, on any screen.' },
      { target: '#contrastList', title: 'Proof, not guesswork', body: 'This table scores every color pair. Green means comfortable to read. One tap on Auto-fix repairs anything that fails.' },
      { target: '#actExport', title: 'Take it with you', body: 'Export hands you ready-to-paste code — CSS free forever, and a full pack for Tailwind, SCSS and design tokens in Pro.' },
      { target: '#actSave', title: 'Keep what you love', body: 'Save stores a palette in your Library on this device. Share makes a link anyone can open.' },
      {
        target: null, title: 'Make it yours', body: 'Two quick choices and you’re done — you can change them any time in Preferences.',
        custom:
          '<div class="pref-theme-row">' +
          '<button type="button" class="pref-theme" data-tp="dark">Dark look</button>' +
          '<button type="button" class="pref-theme" data-tp="light">Light look</button>' +
          '</div>' +
          '<label class="check"><input type="checkbox" id="tourMotion"> Calm mode — no animations</label>',
        onShow: function (card) {
          var theme = document.documentElement.getAttribute('data-theme');
          card.querySelectorAll('[data-tp]').forEach(function (b) {
            b.classList.toggle('is-on', b.dataset.tp === theme);
            b.addEventListener('click', function () {
              document.documentElement.setAttribute('data-theme', b.dataset.tp);
              S.store.set('cslct.theme', b.dataset.tp);
              card.querySelectorAll('[data-tp]').forEach(function (x) { x.classList.toggle('is-on', x === b); });
            });
          });
          var mo = card.querySelector('#tourMotion');
          mo.checked = document.documentElement.getAttribute('data-motion') === 'reduced';
          mo.addEventListener('change', function () { S.setMotionPref(mo.checked); });
        }
      }
    ];
    var tour = new window.CSLCTTour(steps, {
      onDone: function () {
        S.store.set('cslct.tour', 'done');
        S.toast('You’re ready. Have fun — nothing you do here can break anything.');
      }
    });
    tour.start();
  }

  function maybeStartTour() {
    if (S.store.get('cslct.tour', null) === 'done') return;
    if (document.getElementById('cslctConsent')) return; // wait for the banner
    if (document.querySelector('.tour-veil')) return;
    setTimeout(startTour, 450);
  }

  /* ── Boot ───────────────────────────────────────────────── */
  function boot() {
    restore();

    // license deep-link (gift keys land here too)
    var urlKey = Lic.keyFromLocation();
    if (urlKey) {
      location.href = 'unlock.html#key=' + encodeURIComponent(urlKey);
      return;
    }

    // shared palette link
    var m = (location.hash || '').match(/[#&]p=([^&]+)/);
    if (m) {
      var decoded = Ex.decodeShare(m[1]);
      if (decoded) {
        pushUndo();
        state.palette = decoded.palette;
        S.toast(decoded.name ? '“' + decoded.name + '” loaded from your link.' : 'Shared palette loaded from your link.');
      } else {
        S.toast('That share link was damaged — showing your own palette instead.', 'warn');
      }
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* file:// may refuse */ }
    }

    // WCAG toggle visual state
    $('actWcag').setAttribute('aria-pressed', String(state.wcagAuto));
    $('actWcag').classList.toggle('is-on', state.wcagAuto);
    $('wcagState').textContent = state.wcagAuto ? 'ON' : 'OFF';

    refreshPlanUI();
    renderAll();

    // re-verify provisional Gumroad activations quietly
    Lic.reverifyIfNeeded().then(function (res) {
      if (res.changed) {
        refreshPlanUI();
        if (res.verified) S.toast('Your license is now fully verified with Gumroad. Thanks!');
        if (res.revoked) S.toast('Your Gumroad key stopped verifying (' + (res.detail || 'refunded') + ') — Pro is off.', 'bad');
      }
    });

    var st = Lic.getState();
    if (st.provisional && st.graceExpired) {
      S.toast('We still can’t verify your Gumroad key. Go online once to re-check — Pro is paused until then.', 'warn');
    }

    maybeStartTour();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
