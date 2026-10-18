# Changelog

## [1.0.0] - 2026-10-18

First public release.

- Photos-style library over folders on your disk: Years / Months / All Photos, viewer, Info window, Places map, People (offline face recognition), search, Favorites, Library filters, Storage view.
- **Read-only to your photos**, enforced by an audit, a runtime write guard, validated external tools and CI tests (including a read-only disk image and before/after fingerprints).
- **Landmarks** (offline): the Eiffel Tower, Golden Gate Bridge, Yosemite National Park and ~90,000 more notable places are named in the viewer title, Info and Places, from GeoNames. No street addresses.
- **English and Simplified Chinese**, switchable from View → Language, never mixed; localized menus, dates, numbers, plurals, place names and map labels.
- Scale: measured at 100,000 items; bulk edits and counts fast; new benchmark and CI alarm.
- Security: sandboxed pages, no file paths in the page (`photos-media://`), navigation and permissions denied, IPC sender checks.
- arm64-only app with an original icon, `install.sh`, GitHub release workflow, notices for all third-party components.
