/* ============================================================
   ColorSLCT · landing.js
   Hero chroma field, cycling palette strip, the real live
   demo (same engine as the studio), pricing from config.
   ============================================================ */
(function () {
  'use strict';

  var Core = window.ColorCore, Ex = window.Exporters;
  var S = window.CSLCT;
  var CONFIG = window.CSLCT_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  document.addEventListener('DOMContentLoaded', function () {

    /* ── Hero entrance ──────────────────────────────────── */
    var hero = document.querySelector('.hero');
    if (hero) {
      var title = hero.querySelector('[data-split]');
      if (title) S.splitLines(title);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { hero.classList.add('lines-in'); });
      });
    }

    /* ── Hero canvas: brand chroma field ────────────────── */
    var field = S.chromaField($('heroCanvas'), function () {
      return ['#CCFF00', '#FF0055', '#2F6BFF', '#F2EFE9'];
    });

    /* ── Hero strip: cycling curated palettes ───────────── */
    var strip = $('heroStrip');
    var presetIdx = 0;
    function paintStrip(colors) {
      if (!strip.children.length) {
        strip.innerHTML = Core.TOKENS.map(function () { return '<i></i>'; }).join('');
      }
      Core.TOKENS.forEach(function (t, i) {
        strip.children[i].style.background = colors[t];
      });
    }
    if (strip) {
      paintStrip(Core.PRESETS[0].colors);
      if (!S.prefersReducedMotion()) {
        setInterval(function () {
          presetIdx = (presetIdx + 1) % Core.PRESETS.length;
          var colors = Core.PRESETS[presetIdx].colors;
          paintStrip(colors);
          field.setColors([colors.primary, colors.accent1, colors.bgLight, colors.textPrimary]);
        }, 3400);
      }
    }

    /* ── Live demo: the actual engine ───────────────────── */
    var demoStrip = $('demoStrip');
    var demoPal = null;
    function renderDemo(pal) {
      demoPal = pal;
      demoStrip.innerHTML = Core.TOKENS.map(function (t) {
        var fg = Core.bestTextOn(pal[t]);
        return '<i style="background:' + pal[t] + ';color:' + fg + '">' + pal[t].toUpperCase() + '</i>';
      }).join('');
      var ratio = Core.contrast(pal.textPrimary, pal.bgLight);
      $('demoBadge').textContent = 'Text contrast ' + ratio.toFixed(1) + ':1 — ' + Core.wcagLevel(ratio);
      $('demoOpen').href = 'app.html#p=' + Ex.encodeShare(pal);
    }
    if (demoStrip) {
      renderDemo(Core.PRESETS[1].colors); // BNDR palette first — brand moment
      $('demoShuffle').addEventListener('click', function () {
        renderDemo(Core.randomPalette());
      });
    }

    /* ── Pricing from config ────────────────────────────── */
    var pricing = CONFIG.PRICING || {};
    Object.keys(pricing).forEach(function (tier) {
      var p = pricing[tier];
      document.querySelectorAll('[data-price="' + tier + '"]').forEach(function (el) {
        el.textContent = '$' + p.price;
      });
      document.querySelectorAll('[data-suffix="' + tier + '"]').forEach(function (el) {
        el.textContent = p.suffix;
      });
    });
  });
})();
