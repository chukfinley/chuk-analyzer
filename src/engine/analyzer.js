/*
 * Chuk Analyzer — detection engine.
 *
 * Pure logic, no browser APIs, so it can run in the background page and be
 * unit-tested in plain Node. Implements the Wappalyzer-style fingerprint
 * format used by enthec/webappanalyzer: pattern strings of the form
 *     "regex\;confidence:50\;version:\1"
 * matched against evidence collected from a page (headers, html, meta,
 * cookies, script sources, JS globals, DOM).
 */
(function (root) {
  'use strict';

  // Split "regex\;confidence:50\;version:\1" on the literal "\;" delimiter.
  function parsePattern(str) {
    const parts = String(str).split('\\;');
    const out = { value: parts[0], confidence: 100, version: '', regex: null };
    for (let i = 1; i < parts.length; i++) {
      const [k, v] = parts[i].split(':');
      if (k === 'confidence') out.confidence = parseInt(v, 10) || 0;
      else if (k === 'version') out.version = v || '';
    }
    try {
      // Case-insensitive; guard against catastrophic patterns with a length cap.
      out.regex = new RegExp(out.value || '', 'i');
    } catch {
      out.regex = null;
    }
    return out;
  }

  // Normalise a field that may be a string, array, or object of patterns.
  function toPatternList(field) {
    if (!field) return [];
    if (typeof field === 'string') return [parsePattern(field)];
    if (Array.isArray(field)) return field.map(parsePattern);
    return [];
  }

  // Resolve a version template ("\1", "\1?a:b") against a regex match.
  function resolveVersion(template, match) {
    if (!template) return '';
    let out = template;
    for (let i = 1; i < match.length; i++) {
      const g = match[i];
      const tern = new RegExp('\\\\' + i + '\\?([^:]*):([^\\\\]*)');
      const tm = out.match(tern);
      if (tm) out = out.replace(tern, g ? tm[1] : tm[2]);
      else out = out.replace(new RegExp('\\\\' + i, 'g'), g || '');
    }
    return out.trim();
  }

  // Compare two version strings, return the "better" (longer/greater) one.
  function betterVersion(a, b) {
    if (!a) return b;
    if (!b) return a;
    const pa = a.split('.').map((n) => parseInt(n, 10));
    const pb = b.split('.').map((n) => parseInt(n, 10));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x > y ? a : b;
    }
    return a.length >= b.length ? a : b;
  }

  function Analyzer() {
    this.tech = {};
    this.categories = {};
    this.groups = {};
  }

  Analyzer.prototype.init = function (db) {
    this.tech = db.technologies || {};
    this.categories = db.categories || {};
    this.groups = db.groups || {};
  };

  // Everything the in-page collector needs to probe: JS global paths and the
  // set of DOM selectors (with the attributes/properties/text to read).
  Analyzer.prototype.probePlan = function () {
    const jsPaths = new Set();
    const dom = {}; // selector -> { text:bool, attrs:[], props:[] }
    const need = (sel) => (dom[sel] = dom[sel] || { text: false, attrs: [], props: [] });

    for (const t of Object.values(this.tech)) {
      if (t.js) for (const p of Object.keys(t.js)) jsPaths.add(p);
      if (!t.dom) continue;
      const doms = Array.isArray(t.dom) ? t.dom : typeof t.dom === 'string' ? [t.dom] : [t.dom];
      for (const d of doms) {
        if (typeof d === 'string') { need(d); continue; }
        for (const [sel, spec] of Object.entries(d)) {
          const n = need(sel);
          if (spec && typeof spec === 'object') {
            if ('exists' in spec) { /* existence only */ }
            if ('text' in spec) n.text = true;
            if (spec.attributes) for (const a of Object.keys(spec.attributes)) if (!n.attrs.includes(a)) n.attrs.push(a);
            if (spec.properties) for (const p of Object.keys(spec.properties)) if (!n.props.includes(p)) n.props.push(p);
          }
        }
      }
    }
    return { jsPaths: [...jsPaths], dom };
  };

  // Test a single technology against the evidence. Returns null or
  // { confidence, version } aggregated across all matching patterns.
  Analyzer.prototype._match = function (name, t, ev) {
    let confidence = 0;
    let version = '';
    const hit = (patterns, subject) => {
      if (subject == null) return;
      for (const p of patterns) {
        if (!p.regex) { confidence += p.confidence; continue; }
        const m = p.regex.exec(subject);
        if (m) {
          confidence += p.confidence;
          if (p.version) version = betterVersion(version, resolveVersion(p.version, m));
        }
      }
    };

    if (t.url) hit(toPatternList(t.url), ev.url);
    if (t.html) hit(toPatternList(t.html), ev.html);

    if (t.headers) for (const [h, pat] of Object.entries(t.headers)) hit(toPatternList(pat), ev.headers[h.toLowerCase()]);
    if (t.cookies) for (const [c, pat] of Object.entries(t.cookies)) {
      const val = ev.cookies[c.toLowerCase()];
      if (val !== undefined) hit(toPatternList(pat), val || 'true');
    }
    if (t.meta) for (const [m, pat] of Object.entries(t.meta)) hit(toPatternList(pat), (ev.metas[m.toLowerCase()] || []).join(' '));
    if (t.scriptSrc) { const ps = toPatternList(t.scriptSrc); for (const s of ev.scriptSrc) hit(ps, s); }
    if (t.scripts) { const ps = toPatternList(t.scripts); for (const s of ev.scriptsText) hit(ps, s); }
    if (t.js) for (const [path, pat] of Object.entries(t.js)) {
      const val = ev.js[path];
      if (val !== undefined) hit(toPatternList(pat), val || 'true');
    }
    if (t.dom) this._matchDom(t.dom, ev.dom, hit);

    if (confidence <= 0) return null;
    return { confidence: Math.min(100, confidence), version };
  };

  Analyzer.prototype._matchDom = function (dom, domEv, hit) {
    const doms = Array.isArray(dom) ? dom : typeof dom === 'string' ? [dom] : [dom];
    for (const d of doms) {
      if (typeof d === 'string') {
        const r = domEv[d];
        if (r && r.exists) hit([{ regex: null, confidence: 100, version: '' }], 'true');
        continue;
      }
      for (const [sel, spec] of Object.entries(d)) {
        const r = domEv[sel];
        if (!r || !r.exists) continue;
        if (!spec || typeof spec !== 'object') continue;
        if ('exists' in spec) hit([{ regex: null, confidence: 100, version: '' }], 'true');
        if ('text' in spec) hit(toPatternList(spec.text), r.text);
        if (spec.attributes) for (const [a, pat] of Object.entries(spec.attributes)) hit(toPatternList(pat), (r.attrs || {})[a]);
        if (spec.properties) for (const [p, pat] of Object.entries(spec.properties)) hit(toPatternList(pat), (r.props || {})[p]);
      }
    }
  };

  // Full analysis: detect, then resolve implies / excludes / requires.
  Analyzer.prototype.analyze = function (ev) {
    ev = Object.assign({ url: '', html: '', headers: {}, cookies: {}, metas: {}, scriptSrc: [], scriptsText: [], js: {}, dom: {} }, ev);
    const detected = {}; // name -> { confidence, version }

    for (const [name, t] of Object.entries(this.tech)) {
      const r = this._match(name, t, ev);
      if (r) detected[name] = r;
    }

    // implies (to a fixpoint, following chains)
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 20) {
      changed = false;
      for (const name of Object.keys(detected)) {
        const t = this.tech[name];
        if (!t || !t.implies) continue;
        const imps = Array.isArray(t.implies) ? t.implies : [t.implies];
        for (const imp of imps) {
          const p = parsePattern(imp);
          const impName = p.value;
          if (!this.tech[impName]) continue;
          const conf = Math.min(detected[name].confidence, p.confidence);
          if (!detected[impName]) { detected[impName] = { confidence: conf, version: '', implied: true }; changed = true; }
          else if (detected[impName].confidence < conf) { detected[impName].confidence = conf; }
        }
      }
    }

    // excludes
    for (const name of Object.keys(detected)) {
      const t = this.tech[name];
      if (!t || !t.excludes) continue;
      const exs = Array.isArray(t.excludes) ? t.excludes : [t.excludes];
      for (const ex of exs) delete detected[parsePattern(ex).value];
    }

    // requires / requiresCategory (drop if requirement unmet)
    const detectedCats = new Set();
    for (const name of Object.keys(detected)) for (const c of (this.tech[name].cats || [])) detectedCats.add(c);
    for (const name of Object.keys(detected)) {
      const t = this.tech[name];
      if (t.requires) {
        const reqs = Array.isArray(t.requires) ? t.requires : [t.requires];
        if (!reqs.every((r) => detected[r])) { delete detected[name]; continue; }
      }
      if (t.requiresCategory) {
        const reqs = Array.isArray(t.requiresCategory) ? t.requiresCategory : [t.requiresCategory];
        if (!reqs.every((c) => detectedCats.has(c))) { delete detected[name]; }
      }
    }

    // shape output
    const out = [];
    for (const [name, r] of Object.entries(detected)) {
      const t = this.tech[name];
      out.push({
        name,
        version: r.version || '',
        confidence: r.confidence,
        implied: !!r.implied,
        icon: t.icon || '',
        website: t.website || '',
        cpe: t.cpe || '',
        description: t.description || '',
        cats: (t.cats || []).map((id) => ({ id, name: (this.categories[id] || {}).name || 'Other', priority: (this.categories[id] || {}).priority || 99 })),
      });
    }
    out.sort((a, b) => (a.cats[0]?.priority || 99) - (b.cats[0]?.priority || 99) || a.name.localeCompare(b.name));
    return out;
  };

  root.ChukAnalyzer = Analyzer;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Analyzer, parsePattern, resolveVersion };
})(typeof self !== 'undefined' ? self : globalThis);
