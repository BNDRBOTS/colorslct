#!/usr/bin/env node
/* ============================================================
   ColorSLCT · keygen.mjs — owner CLI (Node 18+)
   Same cryptography as tools/keygen.html, for people who
   prefer a terminal or want to script batches.

   Usage:
     node tools/keygen.mjs init
         → creates colorslct-signing-keys.json next to this file
           and prints the public key for config.js

     node tools/keygen.mjs mint [options]
         --plan pro|studio      (default pro)
         --name "Jane D."       (optional, shown on unlock page)
         --gift                 (mark as gift key)
         --days 365             (expiry in days; default: never)
         --count 5              (how many keys; default 1)
         --site https://you.com (also print one-tap gift links)
         --keys path.json       (key file; default alongside script)

     node tools/keygen.mjs verify "CSLCT2.xxxx.yyyy" [--keys path.json]
   ============================================================ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;
const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_KEYS = join(here, 'colorslct-signing-keys.json');

const b64url = (bytes) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return new Uint8Array(Buffer.from(b, 'base64'));
};

function args() {
  const [, , cmd, ...rest] = process.argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      const name = rest[i].slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith('--')) { opts[name] = next; i++; }
      else opts[name] = true;
    } else opts._.push(rest[i]);
  }
  return { cmd, opts };
}

function loadKeys(path) {
  if (!existsSync(path)) {
    console.error(`No key file at ${path} — run: node tools/keygen.mjs init`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function init(path) {
  if (existsSync(path)) {
    console.error(`Refusing to overwrite ${path}.`);
    console.error('Delete it yourself first if you truly want a new pair — old keys will stop verifying.');
    process.exit(1);
  }
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64url(new Uint8Array(await subtle.exportKey('spki', kp.publicKey)));
  const priv = b64url(new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey)));
  writeFileSync(path, JSON.stringify({ product: 'ColorSLCT', created: new Date().toISOString(), publicKey: pub, privateKey: priv }, null, 2));
  console.log(`Key pair written to ${path} — keep this file PRIVATE (it can mint licenses).`);
  console.log('\nPaste this into config.js → LICENSE_PUBLIC_KEY:\n');
  console.log(pub + '\n');
}

async function mint(opts) {
  const keys = loadKeys(opts.keys || DEFAULT_KEYS);
  const priv = await subtle.importKey('pkcs8', fromB64url(keys.privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const count = Math.max(1, Math.min(1000, parseInt(opts.count, 10) || 1));
  const out = [];
  for (let i = 0; i < count; i++) {
    const body = {
      p: opts.plan === 'studio' ? 'studio' : 'pro',
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      iat: Date.now()
    };
    if (opts.name) body.n = String(opts.name).slice(0, 80);
    if (opts.gift) body.gift = true;
    if (opts.days) body.exp = Date.now() + parseInt(opts.days, 10) * 86400000;
    const payload = b64url(Buffer.from(JSON.stringify(body), 'utf8'));
    const input = `CSLCT2.${payload}`;
    const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, Buffer.from(input, 'utf8')));
    const key = `${input}.${b64url(sig)}`;
    out.push(key);
    console.log(key);
    if (opts.site) {
      console.log(`  gift link: ${String(opts.site).replace(/\/$/, '')}/unlock.html#key=${encodeURIComponent(key)}`);
    }
  }
  console.error(`\n${out.length} key(s) minted (${opts.plan === 'studio' ? 'studio' : 'pro'}${opts.gift ? ', gift' : ''}).`);
}

async function verify(key, opts) {
  const keys = loadKeys(opts.keys || DEFAULT_KEYS);
  const pub = await subtle.importKey('spki', fromB64url(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const parts = String(key || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'CSLCT2') {
    console.error('✗ Not a ColorSLCT key (expected CSLCT2.<payload>.<sig>).');
    process.exit(1);
  }
  const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64url(parts[2]), Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'));
  if (!ok) { console.error('✗ Signature invalid for this public key.'); process.exit(1); }
  const payload = JSON.parse(Buffer.from(fromB64url(parts[1])).toString('utf8'));
  if (payload.exp && Date.now() > payload.exp) {
    console.error(`✗ Expired on ${new Date(payload.exp).toISOString()}.`);
    process.exit(1);
  }
  console.log(`✓ Valid ${payload.p.toUpperCase()}${payload.gift ? ' gift' : ''} key${payload.n ? ` for ${payload.n}` : ''}${payload.exp ? `, expires ${new Date(payload.exp).toISOString()}` : ', never expires'}.`);
}

const { cmd, opts } = args();
if (cmd === 'init') await init(opts.keys || DEFAULT_KEYS);
else if (cmd === 'mint') await mint(opts);
else if (cmd === 'verify') await verify(opts._[0], opts);
else {
  console.log('ColorSLCT keygen — commands: init | mint | verify. See header of this file for options.');
  process.exit(cmd ? 1 : 0);
}
