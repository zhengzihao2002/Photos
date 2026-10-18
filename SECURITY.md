# Security

Photos handles files you did not write, so it is built to be careful with them.

- **Read-only.** The app never writes to your photo folders (see `docs/ZERO-WRITES-AUDIT.md`): a static audit, a runtime write guard in every thread, validated external-tool command lines, and a read-only disk-image test in CI.
- **Offline.** The only network use is map tiles from OpenFreeMap. No account, no telemetry, no update check.
- **Isolated pages.** Windows run with context isolation, no Node integration and the sandbox on; navigation, new windows and all permission requests are denied; every IPC call is checked for the sender; pages never see a file path (images are served through `photos-media://` by id).
- **Unsigned by Apple.** The app is signed ad-hoc only (no paid Developer ID, no notarization). `install.sh` verifies the SHA-256 of the download.

## Reporting a problem

Please open a private security advisory on the GitHub repository (Security tab → "Report a vulnerability"), or an issue if nothing sensitive is involved. Include the macOS version, the app version and steps to reproduce. Do not attach personal photos.
