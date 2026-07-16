#!/usr/bin/env node
// Smoke test for the detection engine against fabricated page evidence.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { Analyzer } = require(join(ROOT, 'src/engine/analyzer.js'));

const D = join(ROOT, 'data');
const a = new Analyzer();
a.init({
  technologies: JSON.parse(readFileSync(join(D, 'technologies.json'))),
  categories: JSON.parse(readFileSync(join(D, 'categories.json'))),
  groups: JSON.parse(readFileSync(join(D, 'groups.json'))),
});

const evidence = {
  url: 'https://example.com/',
  html: '<html><head><meta name="generator" content="WordPress 6.5.2"><link rel="stylesheet" href="/wp-content/themes/twentytwentyfour/style.css"></head><body><script src="/wp-includes/js/jquery/jquery.min.js?ver=3.7.1"></script></body></html>',
  headers: { server: 'nginx/1.25.3', 'x-powered-by': 'PHP/8.2.10' },
  cookies: { wordpress_test_cookie: 'WP Cookie check' },
  metas: { generator: ['WordPress 6.5.2'] },
  scriptSrc: ['https://example.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1'],
  scriptsText: [],
  js: { 'jQuery.fn.jquery': '3.7.1', jQuery: '' },
  dom: {},
};

const res = a.analyze(evidence);
const names = res.map((t) => t.name);
const want = ['WordPress', 'PHP', 'Nginx', 'jQuery', 'MySQL'];
const missing = want.filter((w) => !names.includes(w));

console.log(`Detected ${res.length}: ${names.join(', ')}`);
const wp = res.find((t) => t.name === 'WordPress');
if (!wp || wp.version !== '6.5.2') { console.error('FAIL: WordPress version not resolved'); process.exit(1); }
if (missing.length) { console.error('FAIL: missing ' + missing.join(', ')); process.exit(1); }

// Regression: a blank page (no headers/meta/js) must detect NOTHING. Absent
// meta/cookie/js keys must never match an empty ("presence") pattern.
const blank = a.analyze({ url: 'https://example.com/', html: '<html><head></head><body></body></html>' });
if (blank.length !== 0) { console.error('FAIL: blank page detected ' + blank.map((t) => t.name).join(', ')); process.exit(1); }

console.log('OK: core detections, version resolution, and blank-page regression pass');
