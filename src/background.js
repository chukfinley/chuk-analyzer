/* Chuk Analyzer — background (event page).
 * Loads the bundled DB, captures response headers, drives an in-page collector
 * in the MAIN world, runs the engine, and exposes results to the popup. */
'use strict';

const api = typeof browser !== 'undefined' ? browser : chrome;

const analyzer = new self.ChukAnalyzer();
let ready = null;         // Promise resolving once DB + probe plan are loaded
let probePlan = null;     // { jsPaths, dom }
const headersByTab = {};  // tabId -> { lowerHeaderName: "value\nvalue" }
const scriptsByTab = {};  // tabId -> Set of script request URLs (incl. dynamically loaded)
const xhrByTab = {};      // tabId -> Set of XHR/fetch request hostnames

async function loadDB() {
  const [technologies, categories, groups] = await Promise.all([
    fetch(api.runtime.getURL('data/technologies.json')).then((r) => r.json()),
    fetch(api.runtime.getURL('data/categories.json')).then((r) => r.json()),
    fetch(api.runtime.getURL('data/groups.json')).then((r) => r.json()),
  ]);
  analyzer.init({ technologies, categories, groups });
  probePlan = analyzer.probePlan();
}
function ensureReady() { return (ready = ready || loadDB()); }

// --- response headers -------------------------------------------------------
api.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const h = {};
    for (const { name, value } of details.responseHeaders || []) {
      const k = name.toLowerCase();
      h[k] = h[k] ? h[k] + '\n' + value : value;
    }
    headersByTab[details.tabId] = h;
  },
  { urls: ['<all_urls>'], types: ['main_frame'] },
  ['responseHeaders']
);

// Track script request URLs per tab — catches libraries loaded dynamically
// after the initial HTML (Wappalyzer sees these too). Reset on new navigation.
api.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (details.type === 'main_frame') { scriptsByTab[details.tabId] = new Set(); xhrByTab[details.tabId] = new Set(); return; }
    if (details.type === 'script') {
      let set = scriptsByTab[details.tabId] || (scriptsByTab[details.tabId] = new Set());
      if (set.size < 500) set.add(details.url);
    } else { // xmlhttprequest — match fingerprints against the request hostname
      let set = xhrByTab[details.tabId] || (xhrByTab[details.tabId] = new Set());
      if (set.size < 500) { try { set.add(new URL(details.url).hostname); } catch {} }
    }
  },
  { urls: ['<all_urls>'], types: ['main_frame', 'script', 'xmlhttprequest'] }
);

// --- in-page collector (runs in the MAIN world, serialized to the tab) ------
function collectPage(jsPaths, domReq) {
  const out = {
    url: location.href,
    html: (document.documentElement ? document.documentElement.outerHTML : '').slice(0, 300000),
    metas: {},
    scriptSrc: [],
    scriptsText: [],
    text: '',
    cookies: {},
    js: {},
    dom: {},
  };
  try { out.text = (document.body ? document.body.innerText : '').slice(0, 200000); } catch {}
  try {
    for (const m of document.querySelectorAll('meta[name], meta[property], meta[http-equiv]')) {
      const name = (m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv') || '').toLowerCase();
      const content = m.getAttribute('content');
      if (!name || content == null) continue;
      (out.metas[name] = out.metas[name] || []).push(content);
    }
  } catch {}
  try {
    let inline = 0;
    for (const s of document.querySelectorAll('script')) {
      if (s.src) out.scriptSrc.push(s.src);
      else if (inline < 40 && s.textContent) { out.scriptsText.push(s.textContent.slice(0, 20000)); inline++; }
    }
  } catch {}
  try {
    for (const c of document.cookie.split(';')) {
      const i = c.indexOf('=');
      if (i < 0) continue;
      out.cookies[c.slice(0, i).trim().toLowerCase()] = decodeURIComponent(c.slice(i + 1).trim());
    }
  } catch {}
  for (const path of jsPaths) {
    try {
      let v = window;
      for (const part of path.split('.')) { if (v == null) { v = undefined; break; } v = v[part]; }
      if (v !== undefined && v !== null) {
        const t = typeof v;
        out.js[path] = t === 'string' || t === 'number' || t === 'boolean' ? String(v) : '';
      }
    } catch {}
  }
  for (const sel in domReq) {
    try {
      const el = document.querySelector(sel);
      if (!el) continue;
      const rec = { exists: true };
      const req = domReq[sel];
      if (req.text) rec.text = (el.textContent || '').slice(0, 2000);
      if (req.attrs && req.attrs.length) { rec.attrs = {}; for (const a of req.attrs) rec.attrs[a] = el.getAttribute(a); }
      if (req.props && req.props.length) { rec.props = {}; for (const p of req.props) { try { rec.props[p] = String(el[p]); } catch {} } }
      out.dom[sel] = rec;
    } catch {}
  }
  return out;
}

// --- analysis ---------------------------------------------------------------
async function analyzeTab(tabId, url) {
  await ensureReady();
  if (!/^https?:/.test(url || '')) return null;

  let page;
  try {
    const [res] = await api.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: collectPage,
      args: [probePlan.jsPaths, probePlan.dom],
    });
    page = res && res.result;
  } catch (e) {
    return null; // privileged page, no host permission yet, etc.
  }
  if (!page) return null;

  page.headers = headersByTab[tabId] || {};
  const netScripts = scriptsByTab[tabId];
  if (netScripts && netScripts.size) {
    const seen = new Set(page.scriptSrc);
    for (const u of netScripts) if (!seen.has(u)) page.scriptSrc.push(u);
  }
  page.xhr = xhrByTab[tabId] ? [...xhrByTab[tabId]] : [];
  const techs = analyzer.analyze(page);
  const result = { url: page.url, techs, ts: Date.now() };

  try { await api.storage.session.set({ ['tab_' + tabId]: result }); } catch {}
  const n = techs.length;
  try {
    await api.action.setBadgeText({ tabId, text: n ? String(n) : '' });
    await api.action.setBadgeBackgroundColor({ tabId, color: '#4f46e5' });
  } catch {}
  return result;
}

// Re-analyze on navigation completion (keeps the badge fresh), then once more
// shortly after to catch libraries loaded lazily after the initial render.
api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    analyzeTab(tabId, tab.url);
    setTimeout(() => { api.tabs.get(tabId).then((t) => { if (t && t.url) analyzeTab(tabId, t.url); }).catch(() => {}); }, 2500);
  }
});
// Pre-warm the cache when switching to a tab, so the popup opens instantly.
api.tabs.onActivated.addListener(({ tabId }) => {
  api.tabs.get(tabId).then((tab) => {
    if (!tab || !tab.url) return;
    const key = 'tab_' + tabId;
    api.storage.session.get(key).then((s) => { if (!s[key]) analyzeTab(tabId, tab.url); });
  }).catch(() => {});
});
api.tabs.onRemoved.addListener((tabId) => {
  delete headersByTab[tabId];
  delete scriptsByTab[tabId];
  delete xhrByTab[tabId];
  try { api.storage.session.remove('tab_' + tabId); } catch {}
});

// --- popup messaging --------------------------------------------------------
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'analyze') {
    (async () => {
      await ensureReady();
      const key = 'tab_' + msg.tabId;
      const stored = (await api.storage.session.get(key))[key];
      const fresh = await analyzeTab(msg.tabId, msg.url);
      sendResponse(fresh || stored || { url: msg.url, techs: [], ts: Date.now() });
    })();
    return true; // async response
  }
  if (msg && msg.type === 'meta') {
    fetch(api.runtime.getURL('data/meta.json')).then((r) => r.json()).then(sendResponse).catch(() => sendResponse({}));
    return true;
  }
});
