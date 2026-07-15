/* ============================================================
   ColorSLCT · exporters.js
   Pure string/data generators: export formats, share-link
   codec, import parsing. No DOM. Browser + Node.
   Depends on ColorCore.
   ============================================================ */
(function (root, factory) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./color-core.js'));
  } else {
    root.Exporters = factory(root.ColorCore);
  }
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';

  var TOKENS = Core.TOKENS;

  var VAR_NAMES = {
    bgLight: 'bg-light',
    textPrimary: 'text-primary',
    primary: 'primary',
    accent1: 'accent-1',
    bgDark: 'bg-dark'
  };

  function rampsFor(pal) {
    var out = {};
    for (var i = 0; i < TOKENS.length; i++) out[TOKENS[i]] = Core.ramp(pal[TOKENS[i]]);
    return out;
  }

  /* ── CSS (free tier — identical shape to v1 output) ─────── */
  function toCSS(pal, includeRamps) {
    var lines = [':root {'];
    TOKENS.forEach(function (t) {
      lines.push('  --' + VAR_NAMES[t] + ': ' + pal[t] + ';');
    });
    if (includeRamps) {
      var ramps = rampsFor(pal);
      TOKENS.forEach(function (t) {
        lines.push('');
        ramps[t].forEach(function (s) {
          lines.push('  --' + VAR_NAMES[t] + '-' + s.step + ': ' + s.hex + ';');
        });
      });
    }
    lines.push('}');
    return lines.join('\n');
  }

  /* ── SCSS ───────────────────────────────────────────────── */
  function toSCSS(pal, includeRamps) {
    var lines = [];
    TOKENS.forEach(function (t) {
      lines.push('$' + VAR_NAMES[t].replace(/-/g, '_') + ': ' + pal[t] + ';');
    });
    if (includeRamps) {
      var ramps = rampsFor(pal);
      TOKENS.forEach(function (t) {
        lines.push('');
        lines.push('$' + VAR_NAMES[t].replace(/-/g, '_') + '_scale: (');
        lines.push(ramps[t].map(function (s) {
          return '  ' + s.step + ': ' + s.hex;
        }).join(',\n'));
        lines.push(');');
      });
    }
    return lines.join('\n');
  }

  /* ── Tailwind v4 (@theme) ───────────────────────────────── */
  function toTailwind4(pal, includeRamps) {
    var lines = ['@theme {'];
    TOKENS.forEach(function (t) {
      lines.push('  --color-' + VAR_NAMES[t] + ': ' + pal[t] + ';');
    });
    if (includeRamps) {
      var ramps = rampsFor(pal);
      TOKENS.forEach(function (t) {
        lines.push('');
        ramps[t].forEach(function (s) {
          lines.push('  --color-' + VAR_NAMES[t] + '-' + s.step + ': ' + s.hex + ';');
        });
      });
    }
    lines.push('}');
    return lines.join('\n');
  }

  /* ── Tailwind v3 (tailwind.config.js excerpt) ───────────── */
  function toTailwind3(pal, includeRamps) {
    var obj = {};
    TOKENS.forEach(function (t) {
      if (includeRamps) {
        var scale = { DEFAULT: pal[t] };
        Core.ramp(pal[t]).forEach(function (s) { scale[String(s.step)] = s.hex; });
        obj[VAR_NAMES[t]] = scale;
      } else {
        obj[VAR_NAMES[t]] = pal[t];
      }
    });
    return '// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: ' +
      JSON.stringify(obj, null, 6).replace(/\n/g, '\n      ').replace(/"([a-zA-Z0-9-]+)":/g, '"$1":') +
      '\n    }\n  }\n};';
  }

  /* ── W3C Design Tokens JSON (usable in Figma token tools) ─ */
  function toTokensJSON(pal, includeRamps, meta) {
    var doc = { $schema: 'https://design-tokens.github.io/community-group/format/', color: {} };
    TOKENS.forEach(function (t) {
      var entry = { $type: 'color', $value: pal[t], $description: Core.TOKEN_INFO[t].label };
      doc.color[VAR_NAMES[t]] = entry;
      if (includeRamps) {
        var scaleGroup = {};
        Core.ramp(pal[t]).forEach(function (s) {
          scaleGroup[String(s.step)] = { $type: 'color', $value: s.hex };
        });
        doc.color[VAR_NAMES[t] + '-scale'] = scaleGroup;
      }
    });
    if (meta && meta.name) doc.$description = meta.name + ' — exported from ColorSLCT';
    return JSON.stringify(doc, null, 2);
  }

  /* ── JS / TS module ─────────────────────────────────────── */
  function toJS(pal, includeRamps) {
    var body = {};
    TOKENS.forEach(function (t) { body[t] = pal[t]; });
    var out = 'export const palette = ' + JSON.stringify(body, null, 2) + ' as const;\n';
    if (includeRamps) {
      var ramps = {};
      TOKENS.forEach(function (t) {
        var scale = {};
        Core.ramp(pal[t]).forEach(function (s) { scale[s.step] = s.hex; });
        ramps[t] = scale;
      });
      out += '\nexport const scales = ' + JSON.stringify(ramps, null, 2) + ' as const;\n';
    }
    return out;
  }

  /* ── SVG palette card (1200×630, self-contained) ────────── */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function toSVG(pal, name) {
    var W = 1200, H = 630, n = TOKENS.length, bw = W / n;
    var bars = TOKENS.map(function (t, i) {
      var x = i * bw;
      var text = Core.bestTextOn(pal[t]);
      return '<rect x="' + x + '" y="0" width="' + Math.ceil(bw) + '" height="' + H + '" fill="' + pal[t] + '"/>' +
        '<text x="' + (x + 24) + '" y="' + (H - 64) + '" font-family="monospace" font-size="26" fill="' + text + '">' + esc(pal[t]) + '</text>' +
        '<text x="' + (x + 24) + '" y="' + (H - 28) + '" font-family="sans-serif" font-size="20" fill="' + text + '" opacity="0.75">' + esc(Core.TOKEN_INFO[t].label) + '</text>';
    }).join('');
    var title = esc(name || 'ColorSLCT palette');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + title + '">' +
      '<title>' + title + '</title>' + bars +
      '<text x="24" y="52" font-family="sans-serif" font-weight="700" font-size="34" fill="' + Core.bestTextOn(pal[TOKENS[0]]) + '">' + title + '</text>' +
      '</svg>';
  }

  /* ── Format registry (drives the export UI) ─────────────── */
  var FORMATS = [
    { id: 'css',  label: 'CSS variables',   ext: 'css',  mime: 'text/css',         pro: false, gen: toCSS },
    { id: 'scss', label: 'SCSS',            ext: 'scss', mime: 'text/x-scss',      pro: true,  gen: toSCSS },
    { id: 'tw4',  label: 'Tailwind v4',     ext: 'css',  mime: 'text/css',         pro: true,  gen: toTailwind4 },
    { id: 'tw3',  label: 'Tailwind v3',     ext: 'js',   mime: 'text/javascript',  pro: true,  gen: toTailwind3 },
    { id: 'json', label: 'Design tokens (W3C JSON)', ext: 'json', mime: 'application/json', pro: true, gen: toTokensJSON },
    { id: 'js',   label: 'JS / TS module',  ext: 'ts',   mime: 'text/typescript',  pro: true,  gen: toJS },
    { id: 'svg',  label: 'SVG card',        ext: 'svg',  mime: 'image/svg+xml',    pro: true,  gen: null } // handled via toSVG(name)
  ];

  /* ── Share-link codec (#p=<base64url payload>) ──────────── */

  function b64urlEncode(str) {
    var b64;
    if (typeof btoa === 'function') {
      b64 = btoa(unescape(encodeURIComponent(str)));
    } else {
      b64 = Buffer.from(str, 'utf8').toString('base64');
    }
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(s) {
    var b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    if (typeof atob === 'function') {
      return decodeURIComponent(escape(atob(b64)));
    }
    return Buffer.from(b64, 'base64').toString('utf8');
  }

  function encodeShare(pal, name) {
    var payload = { v: 1, p: {} };
    TOKENS.forEach(function (t) { payload.p[t] = pal[t]; });
    if (name) payload.n = String(name).slice(0, 60);
    return b64urlEncode(JSON.stringify(payload));
  }

  function decodeShare(fragment) {
    try {
      var json = JSON.parse(b64urlDecode(fragment));
      if (!json || json.v !== 1) return null;
      var pal = Core.sanitizePalette(json.p);
      if (!pal) return null;
      return { palette: pal, name: typeof json.n === 'string' ? json.n.slice(0, 60) : '' };
    } catch (e) {
      return null;
    }
  }

  /* ── Import parser: accepts CSS vars, JSON, or hex lists ── */

  function parseImport(text) {
    if (typeof text !== 'string' || !text.trim()) return { palette: null, error: 'Nothing to import yet — paste some colors first.' };
    var t = text.trim();

    // 1) JSON with token keys (our export / AI shape)
    try {
      var json = JSON.parse(t);
      var direct = Core.sanitizePalette(json);
      if (direct) return { palette: direct, source: 'json' };
      if (json && json.color) { // W3C tokens doc
        var fromDoc = {};
        var map = { 'bg-light': 'bgLight', 'text-primary': 'textPrimary', 'primary': 'primary', 'accent-1': 'accent1', 'bg-dark': 'bgDark' };
        Object.keys(map).forEach(function (k) {
          var node = json.color[k];
          if (node && node.$value) fromDoc[map[k]] = node.$value;
        });
        var sane = Core.sanitizePalette(fromDoc);
        if (sane) return { palette: sane, source: 'tokens-json' };
      }
    } catch (e) { /* not JSON — fall through */ }

    // 2) CSS custom properties (our own var names, any order)
    var cssMap = { 'bg-light': 'bgLight', 'text-primary': 'textPrimary', 'primary': 'primary', 'accent-1': 'accent1', 'bg-dark': 'bgDark' };
    var found = {}, foundAny = false;
    t.replace(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g, function (_, name, hex) {
      if (cssMap[name]) { found[cssMap[name]] = hex; foundAny = true; }
      return _;
    });
    if (foundAny) {
      var saneCss = Core.sanitizePalette(found);
      if (saneCss) return { palette: saneCss, source: 'css' };
    }

    // 3) Plain hex list (first 5 valid hexes, mapped by role heuristic)
    var hexes = [];
    var m = t.match(/#?[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || [];
    for (var i = 0; i < m.length && hexes.length < 8; i++) {
      var h = Core.normalizeHex(m[i]);
      if (h && hexes.indexOf(h) === -1) hexes.push(h);
    }
    if (hexes.length >= 2) {
      var pal = Core.paletteFromSwatches(hexes);
      if (pal) return { palette: pal, source: 'hexlist' };
    }

    return { palette: null, error: 'Couldn’t find colors in that. Paste hex codes (like #22AACC), our CSS variables, or an exported JSON.' };
  }

  return {
    VAR_NAMES: VAR_NAMES,
    FORMATS: FORMATS,
    toCSS: toCSS,
    toSCSS: toSCSS,
    toTailwind4: toTailwind4,
    toTailwind3: toTailwind3,
    toTokensJSON: toTokensJSON,
    toJS: toJS,
    toSVG: toSVG,
    encodeShare: encodeShare,
    decodeShare: decodeShare,
    parseImport: parseImport
  };
});
