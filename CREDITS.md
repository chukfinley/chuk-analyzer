# Credits & Attribution

Chuk Analyzer stands on the shoulders of open-source work. Full credit to the
projects and people below.

## Fingerprint database & icons

The technology fingerprint database and the technology icons bundled with this
extension come from:

**[enthec/webappanalyzer](https://github.com/enthec/webappanalyzer)** — a
community-maintained, open-source continuation of the original Wappalyzer
fingerprint dataset, licensed under **GPL-3.0**.

- Database: `src/technologies/*.json`, `src/categories.json`, `src/groups.json`
- Icons: `src/images/icons/*`

All fingerprints and icons are used under the GPL-3.0 license. Huge thanks to
the enthec maintainers and every contributor who keeps that dataset current.
Without their work this extension would not exist.

## Lineage

The fingerprint *format* (pattern strings, `implies` / `excludes` / `requires`,
version back-references) originates from the original **Wappalyzer** project,
which was open source (GPL-3.0) before it went closed. `webappanalyzer` carries
that open dataset forward. Chuk Analyzer implements an **independent** detection
engine (`src/engine/analyzer.js`) that reads that format.

Chuk Analyzer is **not affiliated with, endorsed by, or derived from the
proprietary Wappalyzer product**. No proprietary Wappalyzer code is used.

## Supplemental fingerprints

`data/extra-technologies.json` contains a small set of fingerprints authored
independently by this project (Chuk Development). Their detection patterns are
derived solely from each vendor's **public first-party domain** or **open-source
signatures** (e.g. a dedicated CDN host, a documented script path, a custom
element name). They are original work and are **not** copied from any
proprietary technology-detection database. Licensed GPL-3.0-or-later like the
rest of the project.

## This project

- Detection engine, extension, build tooling: Chuk Development.
- Licensed **GPL-3.0-or-later** to remain compatible with the bundled dataset.
