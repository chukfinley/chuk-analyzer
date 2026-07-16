# Chuk Analyzer

A Firefox extension that identifies the technologies running on any website —
CMS, JavaScript frameworks, web servers, analytics, ecommerce platforms, CDNs
and thousands more. Click the toolbar icon on any page and see the full stack,
grouped by category, with versions where detectable.

**100% free. No account, no sign-up, no paywall, no "unlock with Pro".**
Everything runs locally in your browser — no page data ever leaves your machine.

## Features

- **7,500+ fingerprints** from the community-maintained
  [`enthec/webappanalyzer`](https://github.com/enthec/webappanalyzer) dataset,
  bundled offline — detection works with no network calls.
- Version detection and confidence scores.
- Detects via response headers, HTML, `<meta>` tags, cookies, script sources,
  JS globals and the DOM.
- `implies` / `excludes` / `requires` resolution (e.g. WordPress ⇒ PHP + MySQL).
- Export results as **JSON** or **CSV**, or copy to clipboard.
- Light and dark theme.

## How it works

On page load the background page collects evidence from the tab (in the page's
`MAIN` world so it can read JS globals and DOM properties) plus the response
headers captured via `webRequest`. The bundled engine
(`src/engine/analyzer.js`) matches that evidence against the Wappalyzer-style
pattern database and resolves implied/excluded technologies. Nothing is sent to
any server.

## Build from source

Requires Node 18+.

```bash
npm install
npm run build:db      # fetch + bundle the fingerprint DB and rasterise icons
npm test              # engine smoke test
npm run start         # launch a temporary Firefox with the extension loaded
npm run build         # produce web-ext-artifacts/*.zip for AMO submission
```

`scripts/build-db.mjs` clones `enthec/webappanalyzer`, merges the technology
JSON into `data/technologies.json`, and rasterises every icon to a tiny 48px
WebP under `icons/tech/`. These generated files are git-ignored; run the build
to regenerate them.

To update the fingerprint database, just re-run `npm run build:db` and bump the
extension version.

## Updating fingerprints

The database is a snapshot bundled at build time (so detection works offline).
Re-running `npm run build:db` pulls the latest `webappanalyzer` and rebuilds it.

## License & attribution

Licensed under **GPL-3.0-or-later**. The fingerprint database and icons are
derived from [`enthec/webappanalyzer`](https://github.com/enthec/webappanalyzer)
(GPL-3.0). This project is an independent implementation and is not affiliated
with Wappalyzer or enthec.
