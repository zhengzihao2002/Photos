# HANDOFF-RETURN-M15: Live Photo pairing by Content Identifier

## 1. Repository state snapshot (facts from git history and files; nothing fixed or finished here)
`PRAGMA user_version` before M15: 17 (migrations.js highest = 17). Branch main, tags v1.0.0, v1.0.1. CI status (green or not): UNKNOWN, not checked.

| Module | State | Evidence |
|---|---|---|
| M13 landmarks | Present, apparently complete | commits 1a8b1cc (finder, resolver, migration 17), c551eaa, eec0171; `resources/geo/landmarks.json` + `.sha256`; `tools/build-landmarks-dataset.js`; `test/landmarks.test.js` |
| M14 localization | Present, apparently complete | commits 4e8361c, d80a1a2, 3d22ef2; `src/shared/i18n/{en,zh-Hans,i18n,init}.js`, `src/main/i18n.js`; `tools/check-i18n.js` (361 keys in both languages, OK); `test/i18n.test.js`, `test/menu.test.js` |
| M8d scale tests | Present | commits de9dc12, 8f39572; `tools/make-synthetic-db.js`, `tools/bench-scale.js`; `docs/PERFORMANCE.md`; `./dev test|bench`. 100,000-row benchmark not run by me |
| M11 zero-writes and hardening | Present | commits 700aed0, 0289bbe, 6d69bc3; `src/main/write-guard.js`, `safe-exec.js`; `tools/audit-writes.js`, `verify-readonly.js`, `residue-audit.sh`; `docs/ZERO-WRITES-AUDIT.md`; `test/write-guard.test.js`, `scan-integration.test.js` |
| M9 packaging | Present, release 1.0.1 | commits c5a2622, 88df9d4, eddf240; `install.sh`, `build/` (icon, after-pack.js), `.github/workflows/{ci,release}.yml`, LICENSE, SECURITY.md, THIRD_PARTY_NOTICES.md. A packaged `Photos.app` sits in the project root |

## 2. What changed
New: `src/main/index/live-identifier.js`, `live-pairing-pass.js`, `live-identifier-backfill.js`; tests `live-identifier.test.js` (13), `live-pairing-pass.test.js` (10), `live-identifier-backfill.test.js` (1). Modified: `extract-image.js`, `extract-video.js` (+`readVideoIdentifier`), `extract.js`, `migrations.js`, `upsert-item.js`, `scan-directory-batch.js`, `worker-scan.js`; M15.9: `src/renderer/info.js`, both i18n catalogs. `group-siblings.js` unchanged (`findLivePhotoPairs` is now unused). Migration 18: `content_identifier TEXT`, `live_pairing_version INTEGER`, indexes `idx_items_content_identifier`, `idx_items_live_unpaired`. Suite: 75 tests pass. Commits 28152bd, dbb8e97, then M15.9 and docs.

## 3. Design as built, and differences from the handoff
- Still parser layout, verified on a real file: after `Apple iOS\0` + 2 version bytes + `MM`, the entry count follows directly (no IFD offset); value offsets are relative to the start of the note.
- The pass recomputes the whole source each scan and writes only differences (no "touched rows" tracking).
- Batch step stops writing the live columns; stills with an identifier are excluded from burst grouping.
- Fallback matches stems with exact case (index use). Videos that become components keep thumbnails and faces; hidden by the existing visibility clause.
- Added at the user's request: Info buttons (M15.9), outside the "no new UI" rule.

## 4. Measurements
Backfill on a copy of the real library: 1,078 files read in 28.2 s (about 26 ms per file, ffprobe-dominated), 818 identifiers found; rerun 1 ms. Stills alone: about 0.2 ms each. 100,000-item projection and synthetic run: NOT measured, by the user's decision. Steady-state scan overhead: not separately measured.

## 5. Test matrix
1 passed (scratch, 5 pairs). 2 passed (unit + duplicates folders test). 3 passed (scoped scans, both orders). 4 passed (half deleted/restored; F11 with a real EACCES folder). 5 passed (rename keeps favorite/title, no duplicate). 6 passed (unit test). 7 passed. 8 passed (unit). 9 passed on a database copy (405 pairs, no orphan in counts). 10 partly: counts and links consistent; search, Info for several items and Favorites view not exercised; People and Storage with a hidden video that has faces reviewed by grep only. 11 real library only. 12 sources unmodified (0 files changed in 24 h in both folders); residue audit see section 6.

## 6. Zero-writes and audit evidence
Source folders: 0 files modified in the last 24 h. Write guard: no violation in any scratch scan. Audit marker taken 2026-10-18 21:50; report output is pasted by the user after this commit.

## 7. Known limits
Files with no identifier fall back to same-stem with a video of 5 s or less (never exercised on real data). Cross-source pairs and Android Motion Photos are not handled. Copies whose capture times tie stay unpaired (4 files in the user's folder). `itemCount` in the source list counts hidden videos (the UI never shows it). `PhotosData/library.db` was still at version 17 when this was written. The Info buttons were not confirmed by the user at the time of writing. Until the backfill runs, a legacy name-paired Live Photo appears split.

## 8. For the user
Run `./dev test`; open Library and the Live filter (405 on the dev library); press and hold a Live Photo; open Info on one and look for two Finder buttons.
