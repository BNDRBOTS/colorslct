/* ColorSLCT copy scan — run with: node tests/copy-scan.mjs (Node 18+, no deps)
   1. Scans user-visible copy on index.html and app.html against tests/banned-lexicon.json.
   2. Checks the heading outline on both pages: one h1, no skipped levels.
   Visible copy = rendered text, alt/aria-label/placeholder/title attributes,
   and string literals shown to users from the page's inline scripts. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const lexicon = JSON.parse(fs.readFileSync(path.join(here, "banned-lexicon.json"), "utf8"));
const terms = (Array.isArray(lexicon) ? lexicon : lexicon.terms).map((t) => String(t).toLowerCase());

let failed = 0;
const report = [];

function visibleText(html) {
  let out = html;
  out = out.replace(/<script[\s\S]*?<\/script>/gi, " ");
  out = out.replace(/<style[\s\S]*?<\/style>/gi, " ");
  const attrs = [];
  const attrRe = /\b(?:alt|aria-label|placeholder|title|data-tooltip)="([^"]*)"/gi;
  let m;
  while ((m = attrRe.exec(out))) attrs.push(m[1]);
  out = out.replace(/<[^>]+>/g, " ");
  out = out.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
  return out + " " + attrs.join(" ");
}

function jsStrings(html) {
  const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");
  const strs = [...scripts.matchAll(/(["'])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
  /* keep only strings that look like sentences shown to people */
  return strs.filter((s) => /\s/.test(s) && /[a-z]{3}/i.test(s)).join(" ");
}

function scan(label, text) {
  const lower = text.toLowerCase();
  const hits = new Set();
  for (const term of terms) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("(^|[^a-z0-9])" + esc + "($|[^a-z0-9])", "i");
    if (re.test(lower)) hits.add(term);
  }
  if (hits.size) { failed++; report.push(`${label}: ${[...hits].sort().join(", ")}`); }
  else { report.push(`${label}: clear`); }
}

function headingOutline(label, html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
  const hs = [...body.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  const h1s = hs.filter((h) => h === 1).length;
  if (h1s !== 1) { failed++; report.push(`${label}: expected one h1, found ${h1s}`); }
  let prev = 0;
  for (const h of hs) {
    if (h > prev + 1) { failed++; report.push(`${label}: heading level skips to h${h} after h${prev}`); break; }
    if (h > prev) prev = h;
  }
  report.push(`${label}: outline ${hs.join(" ")}`);
}

for (const file of ["index.html", "app.html"]) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  scan(file + " (rendered copy)", visibleText(html));
  scan(file + " (inline script strings)", jsStrings(html));
  headingOutline(file, html);
}

/* user-facing strings in the shared runtime (toasts, consent, tour) */
for (const js of ["assets/js/app.js", "assets/js/shared.js"]) {
  const src = fs.readFileSync(path.join(root, js), "utf8");
  const strs = [...src.matchAll(/(["'])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
  const prose = strs
    .filter((s) => !s.startsWith("You are a design token generator")) /* API payload sent to DeepSeek — never rendered to a person */
    .filter((s) => /\s.*\s/.test(s) && /[.!?…]|\u2014/.test(s))
    .join(" ");
  scan(js + " (user-facing strings)", prose);
}

console.log(report.join("\n"));
console.log(failed ? `\nCopy scan: ${failed} problem group(s)` : "\nCopy scan: all clear");
if (failed) process.exit(1);
