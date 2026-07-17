#!/usr/bin/env node
// Builds the bundled fingerprint DB + icons for Chuk Analyzer from the
// enthec/webappanalyzer source tree (GPL-3.0).
//
//   node scripts/build-db.mjs
//
// Source resolution order:
//   1. $WAA_DIR                    (explicit path to a webappanalyzer checkout)
//   2. .cache/webappanalyzer       (cloned automatically if missing)
//
// Outputs:
//   data/technologies.json   merged { name: fingerprint }
//   data/categories.json     { id: {name, priority, groups} }
//   data/groups.json         { id: {name} }
//   data/meta.json           { generated, techCount, source, commit }
//   icons/tech/<name>.webp   every icon rasterised to a tiny 48px webp

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/enthec/webappanalyzer.git';

function resolveSource() {
  if (process.env.WAA_DIR && existsSync(process.env.WAA_DIR)) return process.env.WAA_DIR;
  const cache = join(ROOT, '.cache', 'webappanalyzer');
  if (!existsSync(cache)) {
    console.log('Cloning webappanalyzer...');
    mkdirSync(dirname(cache), { recursive: true });
    execSync(`git clone --depth 1 ${REPO} "${cache}"`, { stdio: 'inherit' });
  } else {
    // Always pull the latest fingerprints from the open dataset.
    console.log('Updating webappanalyzer to latest...');
    try { execSync('git fetch --depth 1 origin && git reset --hard origin/HEAD', { cwd: cache, stdio: 'inherit' }); }
    catch { console.warn('  (update skipped — using cached copy)'); }
  }
  return cache;
}

const SRC = resolveSource();
const SRC_TECH = join(SRC, 'src', 'technologies');
const SRC_ICONS = join(SRC, 'src', 'images', 'icons');

// --- merge technologies -----------------------------------------------------
const tech = {};
for (const file of readdirSync(SRC_TECH).sort()) {
  if (!file.endsWith('.json')) continue;
  Object.assign(tech, JSON.parse(readFileSync(join(SRC_TECH, file), 'utf8')));
}
const upstreamCount = Object.keys(tech).length;
console.log(`Merged ${upstreamCount} technologies from webappanalyzer`);

// Independently-authored supplemental fingerprints (our own work, GPL-3.0).
// Patterns are derived from each vendor's public first-party domain / open
// signatures — NOT copied from any proprietary database.
const extraPath = join(ROOT, 'data', 'extra-technologies.json');
let extraCount = 0;
if (existsSync(extraPath)) {
  const extra = JSON.parse(readFileSync(extraPath, 'utf8'));
  Object.assign(tech, extra);
  extraCount = Object.keys(extra).length;
  console.log(`Merged ${extraCount} supplemental technologies (chuk-authored)`);
}
const names = Object.keys(tech);

mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(join(ROOT, 'data', 'technologies.json'), JSON.stringify(tech));
writeFileSync(join(ROOT, 'data', 'categories.json'), readFileSync(join(SRC, 'src', 'categories.json')));
writeFileSync(join(ROOT, 'data', 'groups.json'), readFileSync(join(SRC, 'src', 'groups.json')));

let commit = 'unknown';
try { commit = execSync('git rev-parse HEAD', { cwd: SRC }).toString().trim(); } catch {}
writeFileSync(join(ROOT, 'data', 'meta.json'), JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  techCount: names.length,
  upstreamCount,
  extraCount,
  source: 'enthec/webappanalyzer',
  commit,
}, null, 2));

// --- icons: rasterise everything to a tiny uniform webp ---------------------
const OUT_ICONS = join(ROOT, 'icons', 'tech');
rmSync(OUT_ICONS, { recursive: true, force: true });
mkdirSync(OUT_ICONS, { recursive: true });

const SIZE = 48;         // display is ~20px; 48 covers hidpi
const QUALITY = 80;

// Unique icon files actually referenced by a technology.
const referenced = new Set();
for (const t of Object.values(tech)) if (t.icon) referenced.add(t.icon);

const iconFiles = [...referenced].filter((f) => existsSync(join(SRC_ICONS, f)));
console.log(`Rasterising ${iconFiles.length} icons -> ${SIZE}px webp...`);

let done = 0, failed = 0, bytes = 0;
const CONCURRENCY = 16;
async function worker(queue) {
  for (;;) {
    const file = queue.pop();
    if (!file) return;
    const out = join(OUT_ICONS, basename(file).replace(/\.[^.]+$/, '') + '.webp');
    try {
      const buf = await sharp(join(SRC_ICONS, file), { density: 96 })
        .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: false, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: QUALITY, effort: 6 })
        .toBuffer();
      writeFileSync(out, buf);
      bytes += buf.length;
    } catch (e) {
      failed++;
    }
    if (++done % 500 === 0) console.log(`  ${done}/${iconFiles.length}`);
  }
}
const queue = iconFiles.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
console.log(`Icons done: ${done - failed} ok, ${failed} failed, ${(bytes / 1048576).toFixed(1)} MB total`);
