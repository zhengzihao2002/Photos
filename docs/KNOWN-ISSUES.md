# Known issues and decisions on older items

| Item | Decision |
|---|---|
| HEIC: embedded title / caption / keywords are not imported (the EXIF library cannot read HEIC XMP) | Documented; no safe read-only in-process method exists. |
| Layered "Nearby Photos" trail pages in Places are single-select | Documented. |
| Undo: not above 5,000 items, not across restarts, not for renames/moves | Documented. |
| Keeping edits across renames: people corrections are not carried; matches over one hour or ambiguous pairs are not carried | Documented. |
| A row with `keywords_user_owned = 1` and no keywords never shows file keywords | By design (the user cleared them). |
| Rotated thumbnails are the square crop turned; face zoom is skipped for rotated items; face crops are not rotated | Documented. |
| Cmd+R is Rotate Counterclockwise (no Reload item) | Left as is. |
| People menus contain a disabled "Add to Favorites" | Left disabled, translated. |
| View filter menu: "Favorites" and "Edited" are disabled | Left disabled (Favorites has its own sidebar item; Edited needs edit features that are out of scope). |
| Terminal logs "Invalid selection: token" for bad tokens | Left. |
| Map points and selection summaries run in the main process | Measured at 100,000 items (115 ms and 220 ms): left there. |
| Intel Macs | Not supported by design. |
| Landmark coverage depends on GeoNames: some famous places are missing or only have English names (about 8 % of landmarks have a Simplified Chinese name) | Documented; names fall back to English per record. |
| Landmark match uses one centre point per place, so a big park matches within a fixed radius (20 km for national parks) | Documented. |
| The packaged app's macOS menu-bar app title follows the **system** language (macOS reads `InfoPlist.strings`), not the in-app language; every other string follows the in-app language | Documented. |
| If the folder next to `Photos.app` is not writable (for example running straight from a `.dmg`), the app shows an error instead of choosing another place | Documented in the README. |
| Technical text after a colon in an error notice (an operating-system message) stays as the system gave it | Documented. |
| Pages reload when the language changes, so an open photo in the viewer is reopened by the existing "restore the open photo" logic | Documented. |
| Not verified without a real Mac session: visual layout in both languages (English text is longer; check toolbars, tooltips, Info and Settings for clipping), RAW sample files, network volumes, iCloud "dataless" files, USB eject | See the open items in the final report. |
