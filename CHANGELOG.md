# Changelog

## [Unreleased]

- **Update from inside the app:** Photos → Check for Updates… (also Settings → Updates). One click on Update and Restart downloads the release, verifies it, quits, swaps the app and reopens it. Only runs when you click.
- `install.sh` now quits a running Photos itself, replaces it and reopens it, with no questions.
- Importing into an empty album now lands on the newest photos at the bottom; a grid already resting at the bottom stays there as photos arrive, and any other scroll position is kept.
- **If a file has a date, it is used.** Photos: EXIF date taken, then create/digitized date, then XMP/IPTC creation date, then EXIF modify date. Videos: Apple's creation date, then any creation/recorded date in the container or any of its streams (any letter case, date-only too). The file's modification time is used only when the file carries no date at all. Existing items are re-read once.
- **Edited copies count once:** an `IMG_E1234` file next to `IMG_1234` in the same folder (how iPhone exports an edited photo) is now hidden behind its original, so the library shows the original only. A lone `IMG_E` file with no original stays visible. Nothing on disk is touched.
- Empty views (No Photos, No Favorites, no results, empty Years/Months, People, Places) are now centered in the window instead of stuck under the toolbar.
- **One rule for the shown date:** EXIF date taken (DateTimeOriginal), else EXIF CreateDate, else the file's modification time. File names are no longer used to guess a date. It is shown exactly as the file states it, never converted to this Mac's time zone.
- **Ordering uses one common clock:** each photo also gets a hidden UTC sort key (from the EXIF time-zone offset, else the GPS clock, else this Mac's zone), so a photo taken later in New York sorts as newer than one taken earlier in Beijing even though it shows an older date. The sort key is never displayed.
- Existing libraries re-read each file's metadata once after updating (originals are only read).

## [1.0.1] - 2026-10-19

- `install.sh` installs into the project folder by default (app and `PhotosData` inside it).
- Fixed the toolbar: the Years / Months / All Photos control no longer runs into the search field, favorite, rotate and zoom buttons in narrower windows.
- Fixed empty views (No Photos, No Favorites ...): the title now sits above its hint.

## [1.0.0] - 2026-10-18

First public release.

- Photos-style library over folders on your disk: Years / Months / All Photos, viewer, Info window, Places map, People (offline face recognition), search, Favorites, Library filters, Storage view.
- **Read-only to your photos**, enforced by an audit, a runtime write guard, validated external tools and CI tests (including a read-only disk image and before/after fingerprints).
- **Landmarks** (offline): the Eiffel Tower, Golden Gate Bridge, Yosemite National Park and ~90,000 more notable places are named in the viewer title, Info and Places, from GeoNames. No street addresses.
- **English and Simplified Chinese**, switchable from View → Language, never mixed; localized menus, dates, numbers, plurals, place names and map labels.
- Scale: measured at 100,000 items; bulk edits and counts fast; new benchmark and CI alarm.
- Security: sandboxed pages, no file paths in the page (`photos-media://`), navigation and permissions denied, IPC sender checks.
- arm64-only app with an original icon, `install.sh`, GitHub release workflow, notices for all third-party components.
