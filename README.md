# Photos

A Photos-style library for macOS that **reads your photo folders and never changes them**. Add folders from your disk; Photos indexes them, makes thumbnails and shows them by Years, Months and All Photos, with a viewer, an Info window, Places on a map (with famous landmarks named, offline), People (face recognition on your Mac), search, Favorites and a Storage view. English and Simplified Chinese (简体中文), switchable from the menu bar.

> **Not affiliated with or endorsed by Apple.** This is an independent project with its own name text and an original icon.

![Screenshots go here](docs/screenshot-placeholder.png)

## Install (three lines)

Needs a Mac with Apple Silicon (M1 or later) and macOS 12 or later.

```bash
# 1. Download this repository (green Code button → Download ZIP, then unzip) or:  git clone https://github.com/zhengzihao2002/Photos.git
cd Photos
bash install.sh
```

The script downloads the latest release from GitHub, checks its SHA-256, installs **Photos.app with its icon** **inside this project folder** (next to `install.sh`; no password, no `sudo`) and offers to open it. Options: `--dir ~/Applications` (install somewhere else), `--version 1.0.0`, `--local Photos-arm64.zip` (offline), `--no-open`, `--uninstall`, `--help`.

### If macOS blocks the first launch

The app is signed ad-hoc and not notarized by Apple (that needs a paid account). macOS may say it cannot verify the app. Either:

- **macOS 15 and later:** System Settings → Privacy & Security → scroll down to the message about “Photos” → **Open Anyway**; or
- run once in Terminal and open the app again: `xattr -dr com.apple.quarantine Photos.app` (from inside the project folder)

(The old “right-click → Open” trick no longer works on macOS 15.)

## Uninstall

Delete the project folder (it holds `Photos.app` and `PhotosData`), or run `bash install.sh --uninstall`. Nothing else is left on your Mac (macOS keeps a few tiny entries under the app's bundle id; the app removes them each time you quit).

## Where your data lives

In a folder named `PhotosData` **next to** `Photos.app` (by default both are inside the project folder you ran `install.sh` from): the library index (`library.db`), thumbnails, caches, logs and settings. Copy both together to move the app to another Mac. Your photos stay where they are.

## Promises

- **Read-only.** Photos never writes, moves, renames, deletes or labels a file in your photo folders, and never creates a file beside one. Features that would write (Delete, Edit, Share…) are visible but disabled. Favorites, titles, captions, keywords, rotation and people corrections live **only in the app's database**. Remove a folder and add it again and you are back to the original. The promise is enforced four ways (audit, a runtime write guard, validated external tools, a read-only disk-image test) — see [`docs/ZERO-WRITES-AUDIT.md`](docs/ZERO-WRITES-AUDIT.md).
- **Offline.** No account, no telemetry, no update check. The only network use is map tiles from OpenFreeMap. Face recognition, place names and landmarks all work offline.
- **Self-contained.** Everything it writes is inside `PhotosData`.
- **No street addresses.** Locations show a city and, where you are at one, a landmark (Eiffel Tower, Yosemite National Park…), from a bundled offline dataset.

## Language

Menu bar → **View → Language** → English / 简体中文. Everything switches at once (menus, windows, dates, numbers, place names, map labels). Map labels use Chinese where the map tiles have a Chinese name and fall back to the local name where they do not. Your own file names, folder names, titles and captions are never translated.

## Requirements and limits

Apple Silicon only (no Intel build). macOS 12+. Formats: JPEG, PNG, GIF, WebP, TIFF, BMP, HEIC/HEIF, many RAW formats, MP4/MOV and others (converted to a cached copy when the browser engine cannot play them). Libraries of 100,000+ items are supported (see [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md)).

## Privacy

Nothing leaves your Mac except map tile requests (which reveal the map area you look at to openfreemap.org). Faces are analysed locally with the YuNet and SFace models; turn People off in **View → People** or delete all face data with **View → Delete All People Data…**.

## Troubleshooting

| Problem | What to do |
|---|---|
| “Can’t Create Data Folder” | The folder next to the app is not writable (for example the app runs from a disk image). Copy `Photos.app` to a normal folder first. |
| Map is grey | You are offline; everything else keeps working. |
| A folder shows a warning badge | It is not reachable (unplugged drive?). Nothing is removed from the library until you remove the folder yourself; use right-click → Relink… |
| Slow first scan | Thumbnails and face analysis run in the background; a large library takes a while the first time. |

## Developing

See [`DEVELOPMENT.md`](DEVELOPMENT.md). Everything stays inside the project folder: `./dev setup`, `./dev start`, `./dev test`, `./dev bench`, `./dev dist`.

## Credits and licences

MIT licence (see [`LICENSE`](LICENSE)). Third-party components and data — Electron, Preact, MapLibre GL, Supercluster, ONNX Runtime, YuNet, SFace, sharp/libvips, better-sqlite3, FFmpeg, GeoNames (CC BY 4.0), OpenFreeMap, OpenMapTiles and OpenStreetMap contributors (ODbL) — are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and in the app's About window.
