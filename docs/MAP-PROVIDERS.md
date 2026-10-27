# Apple Maps investigation

Investigated 2026-10-27 against Apple's current MapKit JS documentation.

## Feasibility

Apple provides an official JavaScript map renderer, MapKit JS. Its documented
Chrome support makes it a plausible integration for Electron's Chromium
renderer. It supports custom annotations, so photo markers could be retained.
It uses Apple's cartography and data; identical artwork and behavior to native
macOS Photos are not guaranteed.

This repository has no Apple Maps token or Apple developer configuration.
Apple requires an authorized Maps token to initialize the map. Current Apple
account tools can generate a static MapKit JS token; signing a token with a
private key is another option, not a requirement for every user. Private signing
keys must never be shipped in the application or committed to this repository.

Consequently, an authenticated Apple map cannot currently be verified or
shipped as a working provider. The existing OpenStreetMap/OpenFreeMap provider
is retained and its zoomed-out place density is reduced instead.

## Work needed before enabling a provider choice

- Configure an authorized Maps token and verify its origin restrictions in the
  packaged app. The current renderer loads through `file:`; compatibility must
  be tested rather than assuming a token for a website works there.
- Load the official Apple SDK only when Apple Maps is selected and extend the
  renderer's restrictive content security policy for the required Apple hosts.
- Adapt all four map surfaces (Places, area map, single-item Info and multi-item
  Info), including photo markers, clustering, bounds, camera persistence,
  Simplified Chinese, dark mode, text sizing, and unavailable/expired-token UI.
- Persist the user's provider choice and retain OpenFreeMap as a fallback.
- Verify map requests on macOS, including any Wi-Fi-only loading preference.
  Streaming on demand avoids bulk downloads, but does not itself enforce
  Wi-Fi-only networking. Do not promise that from a browser connection hint.

## Download behavior of the current provider

MapLibre requests tiles for the visible map and nearby viewport as it is used.
There is no offline region downloader, background city/country prefetch, or
multi-gigabyte map dataset bundled with the app. Electron may retain ordinary
HTTP cache data inside `PhotosData`. Changing label density affects rendering,
not which features are included in a vector tile; it is not a bandwidth cap.
Current map loading works on any available internet connection, not just Wi-Fi.

## Sources

- [MapKit JS overview](https://developer.apple.com/documentation/mapkitjs)
- [Supported browsers](https://developer.apple.com/documentation/mapkitjs/browser-support)
- [Creating a Maps token](https://developer.apple.com/documentation/mapkitjs/creating-a-maps-token)
- [Account token configuration and roles](https://developer.apple.com/help/account/service-configurations/maps-tokens)
- [Signing keys and Maps identifiers](https://developer.apple.com/help/account/capabilities/create-a-maps-identifier-and-private-key)

