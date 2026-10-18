# Development

## The self-containment rule

Everything Photos uses lives inside the project folder: every tool, download,
cache, and file it writes. The project runs using only what is inside this
folder plus the tools built into macOS. Deleting the folder removes the project
with nothing left elsewhere on the disk.

There are no global installs, no Homebrew packages, no `sudo`, and no compiling.
Xcode Command Line Tools are not required.

## Commands

Run everything through `./dev`, from the project root.

| Command | What it does |
|---|---|
| `./dev setup` | Downloads the pinned Node.js if missing, verifies its checksum, installs packages exactly as `package-lock.json` lists them, then clears the download caches. Does nothing if already set up, so it works offline after the first run. |
| `./dev start` | Runs the app. |
| `./dev dist` | Builds the packaged **arm64** app into `dist/mac-arm64/Photos.app` (ad-hoc signed), then clears the download caches. |
| `./dev test` | Runs the regression tests (`test/*.test.js`: migrations, query filters, selection tokens, landmarks, i18n, menus, write guard, safe-exec, safe delete, scan integration). |
| `./dev bench` | Read-only benchmark of the key queries on a **copy** of your real `.dev-data/library.db` (or pass another database file). |
| `./dev verify-readonly <record\|compare\|check> ...` | Fingerprints your photo folders (names, sizes, nanosecond mtimes, attributes, optional SHA-256) before and after a session to prove nothing changed. See below. |
| `./dev npm <args>` | Runs npm from the project's own Node. |
| `./dev node <args>` | Runs Node from the project's own copy, for example `./dev node tools/build-map-styles.js`. |
| `./dev audit <mark, report, or known>` | Runs the residue audit (see below). |
| `./dev clean` | Clears the download caches by hand. |

Plain `npm start`, `npm run dist`, and `npm install` stop with a message
pointing to `./dev`. They would use whatever Node is installed on the Mac and
write to shared caches in the home folder.

## How `./dev` keeps things inside the folder

- **Node.js** is pinned to an exact version and checksum inside `dev`, and
  unpacked into `.toolchain/node/`. To change the version, edit the version and
  both checksums at the top of `dev`.
- **Search path:** `./dev` sees only the project's Node, the project's
  `node_modules/.bin`, and the macOS tool folders. A Node or Homebrew installed
  on the Mac is never used.
- **Caches:** npm, the Electron download, and electron-builder are pointed at
  `.cache/`. Tools that write under the home folder with no setting to change it
  (such as `ffmpeg-static`) are given a private home folder,
  `.cache/home/`, during `setup`, `dist`, `npm`, and `node`. `./dev start` uses
  the real home folder so the app behaves normally.
- **No compiling:** package install steps are skipped for every npm command.
  `setup` then runs the two that are needed, the `ffmpeg` download and the
  Electron download. `better-sqlite3` and `sharp` ship ready-made binaries.
- **Nothing stores the project's location.** `./dev` works out where it is on
  every run, so the folder can be moved, renamed, or copied freely.

Set `PHOTOS_KEEP_CACHE=1` before a command to keep the download caches for
inspection.

## What is inside the folder

| Folder | Contents | Size |
|---|---|---|
| `.toolchain/` | The project's Node.js | about 200 MB |
| `node_modules/` | Packages, including Electron and ffmpeg | about 835 MB |
| `.cache/` | Download caches and the audit marker | empty at rest; about 330 MB during setup |
| `.dev-data/` | The app's data in development: database, thumbnails, display cache, logs, `electron-data/`, `tmp/`, `crash-dumps/` | depends on the library; about 300 MB for 1,300 items |
| `dist/` | Packaged apps, only after `./dev dist` | about 1.2 GB |

All five are ignored by git and can be deleted. `./dev setup` recreates the
first three; the app recreates `.dev-data/` as an empty library.

## What the running app writes

All data paths come from `src/main/paths.js`. At startup `src/main/main.js`
points Electron's `userData`, `sessionData`, `crashDumps`, `temp`, and logs path
into the data folder, sets the temp-folder variable for worker threads and child
processes (`sips`, `ffmpeg`, `ffprobe`), and turns on Chromium's mock keychain
so no Keychain item is created.

## What macOS writes outside the folder

macOS files a few small items under the app's identifier that an app cannot
redirect. The app removes them about three seconds after each normal quit
(`src/main/residue-cleanup.js`). After a crash or force-quit they remain until
the next normal quit.

The identifier is `com.github.Electron` when running from source, which is
shared with any other Electron app run from source, and `io.github.zhengzihao2002.photos-clone` for
the packaged app.

| Item | Location | Size | Remove by hand |
|---|---|---|---|
| Preferences entry | `~/Library/Preferences/<identifier>.plist` | a few KB | `defaults delete <identifier>` |
| Graphics shader caches | the folder printed by `getconf DARWIN_USER_CACHE_DIR`, subfolders `<identifier>` and `<identifier>.helper` | about 4 MB | delete those two subfolders |

Not verified in M8a: macOS may also keep a privacy permission record for the
app's access to photo folders (removable with `tccutil reset All <identifier>`),
and the packaged app may leave a Launch Services registration and saved window
state. The packaged app has not been run through the audit.

## Residue audit

| Command | What it does |
|---|---|
| `./dev audit known` | Checks every known location outside the folder and prints each as present, with size, or absent. |
| `./dev audit mark` | Sets a timestamp marker inside the project. |
| `./dev audit report` | Lists every file under the home folder, outside the project, created or changed since the marker, plus project-related temp entries and Keychain items. Prints its exclude list. |

To check any activity: `./dev audit mark`, do the activity, quit the app, wait
ten seconds, then `./dev audit report`. The audit only reads outside the
project and uses only macOS built-ins. It skips other apps' data and anything
named `com.apple.*`.

## Tests, checks and CI

| Command | What it checks |
|---|---|
| `./dev test` | All unit/regression tests (Linux and macOS). |
| `./dev node tools/check-i18n.js` | Both language catalogs have the same keys and placeholders, no unused or missing keys, and no hard-coded UI text (allowlist: `tools/i18n-allowlist.json`). |
| `./dev node tools/audit-writes.js --check` | Every file-system write site and every program start in `src/` is listed and explained (`tools/audit-writes-allow.json`, output in `docs/ZERO-WRITES-AUDIT.md`). |
| `./dev node tools/bench-scale.js --check` | 100,000-row synthetic library benchmark with generous limits. |
| `bash tools/ci-smoke.sh` | The real app on a generated library (macOS): scan, thumbnails, preview, video conversion, landmarks, face worker, edits, language switch, write-guard negative controls; then again on a read-only disk image; fingerprints before and after. |

`.github/workflows/ci.yml` runs these on every push (Linux and `macos-14`). `release.yml` builds, verifies and publishes on a `v*` tag. The smoke mode (`src/main/smoke.js`) is inactive unless `PHOTOS_SMOKE` is set.

Other tools: `tools/build-landmarks-dataset.js` (GeoNames → `resources/geo/landmarks.json`; run by the manual CI job), `tools/build-geo-dataset.js` (cities), `tools/build-map-styles.js` (English and Chinese map styles), `tools/build-icon.js` (icon), `tools/build-notices.js` (`THIRD_PARTY_NOTICES.md`), `tools/make-fixtures.js`, `tools/make-synthetic-db.js`.

### Proving the photo folders were not touched

```bash
./dev verify-readonly check before ~/Pictures/MyPhotos --hash   # first run records the fingerprint
# ... use the app for a while, quit it ...
./dev verify-readonly check before ~/Pictures/MyPhotos --hash   # second run compares and prints any difference
```

If a file's modification time ever changes unexpectedly, the scan worker also logs every detected change (path, old and new time, size changed or not) to `<data folder>/logs/source-file-changes.log`.

### Language

The active language is in `config.json` (`language`). `PHOTOS_PSEUDO_LOCALE=1 ./dev start` shows accented, bracketed English so any text that bypasses `t()` stands out.

## Uninstall

Quit the app, then delete the project folder. Nothing else is needed after a
normal quit.
