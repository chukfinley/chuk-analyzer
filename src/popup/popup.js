'use strict';
const api = typeof browser !== 'undefined' ? browser : chrome;

const $ = (s) => document.querySelector(s);
let current = null; // last result

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function emptyMsg(node, ...lines) {
  clear(node);
  const d = el('div', 'empty');
  lines.forEach((l, i) => { if (i) d.appendChild(document.createElement('br')); d.appendChild(document.createTextNode(l)); });
  node.appendChild(d);
}

function iconURL(icon) {
  if (!icon) return null;
  return api.runtime.getURL('icons/tech/' + icon.replace(/\.[^.]+$/, '') + '.webp');
}

function techRow(t) {
  const a = document.createElement('a');
  a.className = 'row';
  if (t.website) { a.href = t.website; a.target = '_blank'; a.rel = 'noopener'; }

  const ico = document.createElement('img');
  ico.className = 'ico';
  ico.width = 22; ico.height = 22; ico.alt = '';
  const url = iconURL(t.icon);
  if (url) {
    ico.src = url;
    ico.onerror = () => { const s = document.createElement('span'); s.className = 'ico'; s.textContent = t.name[0]; a.replaceChild(s, ico); };
  } else { ico.replaceWith(Object.assign(document.createElement('span'), { className: 'ico', textContent: t.name[0] })); }
  a.appendChild(ico);

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = t.name;
  a.appendChild(name);

  if (t.version) { const v = document.createElement('span'); v.className = 'ver'; v.textContent = t.version; a.appendChild(v); }
  a.appendChild(Object.assign(document.createElement('span'), { className: 'grow' }));
  if (t.implied) a.appendChild(Object.assign(document.createElement('span'), { className: 'imp', textContent: 'implied' }));
  else if (t.confidence < 100) a.appendChild(Object.assign(document.createElement('span'), { className: 'conf', textContent: t.confidence + '%' }));
  return a;
}

function render(result) {
  current = result;
  const techs = result.techs || [];
  const summary = $('#summary');
  clear(summary);
  if (techs.length) {
    summary.appendChild(el('b', null, String(techs.length)));
    summary.appendChild(document.createTextNode(' technologies detected'));
  } else {
    summary.textContent = 'No technologies detected on this page.';
  }

  const main = $('#results');
  if (!techs.length) { emptyMsg(main, 'Nothing to show.', 'Open a normal website and re-scan.'); return; }
  clear(main);

  // group by primary category, keep priority order from the engine
  const groups = new Map();
  for (const t of techs) {
    const cat = t.cats[0] || { name: 'Other', priority: 99 };
    if (!groups.has(cat.name)) groups.set(cat.name, []);
    groups.get(cat.name).push(t);
  }
  for (const [cat, list] of groups) {
    const wrap = el('section', 'cat');
    const head = el('div', 'cat-head');
    head.appendChild(el('span', null, cat));
    head.appendChild(el('span', 'count', String(list.length)));
    wrap.appendChild(head);
    for (const t of list) wrap.appendChild(techRow(t));
    main.appendChild(wrap);
  }
}

// --- export -----------------------------------------------------------------
function download(name, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportData(fmt) {
  if (!current) return;
  const host = (() => { try { return new URL(current.url).hostname; } catch { return 'page'; } })();
  const techs = current.techs || [];
  if (fmt === 'json') {
    download(`chuk-analyzer-${host}.json`, 'application/json', JSON.stringify({ url: current.url, scanned: new Date(current.ts).toISOString(), technologies: techs }, null, 2));
  } else if (fmt === 'csv' || fmt === 'copy') {
    const rows = [['Technology', 'Version', 'Categories', 'Confidence', 'Website']];
    for (const t of techs) rows.push([t.name, t.version, t.cats.map((c) => c.name).join('; '), t.confidence + '%', t.website]);
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    if (fmt === 'csv') download(`chuk-analyzer-${host}.csv`, 'text/csv', csv);
    else navigator.clipboard.writeText(csv);
  }
}

// --- wire up ----------------------------------------------------------------
async function scan() {
  emptyMsg($('#results'), 'Scanning…');
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || '')) {
    $('#summary').textContent = '';
    emptyMsg($('#results'), "This page can't be analyzed.", 'Open a website (http/https).');
    return;
  }
  const result = await api.runtime.sendMessage({ type: 'analyze', tabId: tab.id, url: tab.url });
  render(result || { url: tab.url, techs: [], ts: Date.now() });
}

$('#rescan').addEventListener('click', scan);
$('#exportBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#exportMenu').hidden = !$('#exportMenu').hidden; });
$('#exportMenu').addEventListener('click', (e) => { const f = e.target.dataset.fmt; if (f) { exportData(f); $('#exportMenu').hidden = true; } });
document.addEventListener('click', () => { $('#exportMenu').hidden = true; });

api.runtime.sendMessage({ type: 'meta' }).then((m) => {
  if (!m || !m.techCount) return;
  const f = $('#footer');
  clear(f);
  f.appendChild(el('span', null, m.techCount.toLocaleString() + ' fingerprints'));
  const credit = el('a', null, 'data: webappanalyzer');
  credit.href = 'https://github.com/enthec/webappanalyzer';
  credit.target = '_blank';
  credit.rel = 'noopener';
  credit.title = 'Fingerprint database by enthec/webappanalyzer (GPL-3.0) — DB ' + m.generated;
  f.appendChild(credit);
}).catch(() => {});

scan();
