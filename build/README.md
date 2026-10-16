# build/

Resources used when building and running the app. Not shipped as-is; the
packaging step (M9, `./dev dist`) copies what it needs into Photos.app.

| File / folder | Used for |
|---|---|
| `icon.icns` | The packaged app's icon (Dock, Finder, About). Picked up by electron-builder by convention. |
| `icon.png` | The Dock icon while developing (`./dev start`); set in `src/main/main.js`. In development the Dock tooltip and menu-bar name still read "Electron", because the app runs inside Electron's own bundle; the packaged app shows "Photos". |
| `en.lproj/`, `zh-Hans.lproj/` | Per-language bundle resources copied into Photos.app (e.g. the app's display name). |

Rebuild `icon.icns` from `icon.png` with macOS's `iconutil` if the icon changes.
