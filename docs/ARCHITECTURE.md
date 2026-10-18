# Architecture (short)

- **Electron 44, arm64.** Main process `src/main`, pages in `src/renderer` (Preact, no build step), shared language code in `src/shared/i18n`. All data paths come from `src/main/paths.js`, all packaged resource paths from `src/main/resource-paths.js`.
- **SQLite** (better-sqlite3, WAL, `PRAGMA user_version` migrations, latest **17**). Visibility clause shared by every query; keyset paging; partial indexes. Selections travel as `::sel:` tokens, never id lists.
- **Workers** (own connections): scan, thumbnails, faces, size. FSEvents watcher + scan queue; an unreadable folder never causes deletions.
- **Media**: sharp, ffmpeg/ffprobe (bundled), macOS `sips`; pages read images only through `photos-media://item|thumb|crop/...`.
- **Places**: offline reverse geocoding (cities500) + offline landmarks (GeoNames subset), MapLibre with OpenFreeMap tiles (the only network use).
- **People**: YuNet + SFace through onnxruntime-node, two-level clustering.
- **Language**: `src/shared/i18n` (catalogs `en.js`, `zh-Hans.js`), main-process owner `src/main/i18n.js`, pages reload on change.
- **Zero writes**: `write-guard.js` (first in every thread), `safe-exec.js`, `storage/safe-delete.js`, `security.js`; see `docs/ZERO-WRITES-AUDIT.md`.
