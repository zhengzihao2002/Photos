#!/bin/bash
# Photos installer for macOS on Apple Silicon.
#
#   bash install.sh                     install the latest release INTO THIS PROJECT FOLDER (next to install.sh)
#   bash install.sh --version 1.0.0     install a specific release
#   bash install.sh --dir ~/Applications install somewhere else instead (must be writable; no sudo is used)
#   bash install.sh --local Photos.zip  install from a ZIP you already have (offline, CI)
#   bash install.sh --no-open           do not open the app afterwards
#   bash install.sh --force             (accepted for compatibility; a running copy is always quit for you)
#   bash install.sh --uninstall         remove the app (asks before deleting its data folder)
#   bash install.sh --help
#
# What it does: downloads Photos-arm64.zip and its SHA-256 from the repository's GitHub Releases into a
# temporary folder, verifies the checksum, unpacks it with ditto, quits a running Photos for you, replaces the
# app WITH its icon, checks the signature, and opens it again. It never asks a question. Nothing is piped from
# the network into a shell. No sudo.
# The app's data lives in a folder named PhotosData next to Photos.app; upgrades never touch it.
# By default both sit inside the project folder, so deleting that folder removes everything.
set -euo pipefail

REPO="zhengzihao2002/Photos"
APP_NAME="Photos"
MIN_MACOS_MAJOR=12

HERE="$(cd "$(dirname "$0")" && pwd -P)"
DIR="$HERE"   # the project folder: the app and its data go here, so deleting the folder removes everything
VERSION=""
LOCAL_ZIP=""
OPEN_AFTER=1
UNINSTALL=0
TMP=""

say()  { printf '%s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; }

cleanup() { if [ -n "$TMP" ] && [ -d "$TMP" ]; then rm -rf "$TMP"; fi; }
trap cleanup EXIT

while [ $# -gt 0 ]; do
  case "$1" in
    --version)   [ $# -ge 2 ] || fail "--version needs a number, for example 1.0.0"; VERSION="${2#v}"; shift 2 ;;
    --dir)       [ $# -ge 2 ] || fail "--dir needs a folder"; DIR="$2"; shift 2 ;;
    --local)     [ $# -ge 2 ] || fail "--local needs a ZIP file"; LOCAL_ZIP="$2"; shift 2 ;;
    --no-open)   OPEN_AFTER=0; shift ;;
    --force)     shift ;;   # kept so old command lines still work
    --uninstall) UNINSTALL=1; shift ;;
    --help|-h)   usage; exit 0 ;;
    *)           fail "unknown option: $1 (try --help)" ;;
  esac
done

# ---- checks -----------------------------------------------------------------------------------------------
[ "$(uname -s)" = "Darwin" ] || fail "Photos is a macOS app; this is $(uname -s)."
if [ "$(uname -m)" != "arm64" ]; then
  say "This Mac has an Intel processor. Photos is built for Apple Silicon (M1 and later) only, so it cannot be installed here."
  exit 1
fi
MACOS_MAJOR="$(sw_vers -productVersion | cut -d. -f1)"
[ "$MACOS_MAJOR" -ge "$MIN_MACOS_MAJOR" ] || fail "Photos needs macOS $MIN_MACOS_MAJOR or later (this is $(sw_vers -productVersion))."
for tool in ditto shasum codesign xattr; do command -v "$tool" >/dev/null 2>&1 || fail "'$tool' is missing; it is part of macOS."; done
if [ -z "$LOCAL_ZIP" ]; then command -v curl >/dev/null 2>&1 || fail "'curl' is missing; it is part of macOS."; fi

mkdir -p "$DIR" 2>/dev/null || true
DIR="$(cd "$DIR" 2>/dev/null && pwd -P)" || fail "Cannot use the folder: $DIR"
APP="$DIR/$APP_NAME.app"
DATA="$DIR/PhotosData"

# Quit a running copy of THIS app (the one at $APP) cleanly, and wait for it to finish.
quit_running() {
  pgrep -f "$APP/Contents/MacOS/" >/dev/null 2>&1 || return 0
  say "Quitting the running Photos …"
  pkill -TERM -f "$APP/Contents/MacOS/" 2>/dev/null || true      # the app shuts down cleanly on SIGTERM
  n=0
  while pgrep -f "$APP/Contents/MacOS/" >/dev/null 2>&1 && [ "$n" -lt 100 ]; do sleep 0.2; n=$((n+1)); done
  if pgrep -f "$APP/Contents/MacOS/" >/dev/null 2>&1; then pkill -KILL -f "$APP/Contents/MacOS/" 2>/dev/null || true; sleep 1; fi
}

# ---- uninstall --------------------------------------------------------------------------------------------
if [ "$UNINSTALL" -eq 1 ]; then
  quit_running
  if [ -d "$APP" ]; then rm -rf "$APP"; say "Removed $APP"; else say "No app found at $APP"; fi
  if [ -d "$DATA" ]; then
    printf 'Also delete the data folder (library index, thumbnails, settings)? Your photos are never touched. [y/N] '
    read -r answer || answer=""
    case "$answer" in
      y|Y|yes|YES) rm -rf "$DATA"; say "Removed $DATA" ;;
      *)           say "Kept $DATA (delete it yourself any time to remove everything)." ;;
    esac
  fi
  say "Nothing else is left on your Mac."
  exit 0
fi

# ---- get the ZIP ------------------------------------------------------------------------------------------
TMP="$(mktemp -d "$DIR/.photos-install.XXXXXX")"   # inside the target folder, removed on exit: nothing is left in system temp folders
ZIP="$TMP/Photos-arm64.zip"
if [ -n "$LOCAL_ZIP" ]; then
  [ -f "$LOCAL_ZIP" ] || fail "File not found: $LOCAL_ZIP"
  cp "$LOCAL_ZIP" "$ZIP"
  if [ -f "$LOCAL_ZIP.sha256" ]; then cp "$LOCAL_ZIP.sha256" "$TMP/Photos-arm64.zip.sha256"; fi
  say "Using $LOCAL_ZIP"
else
  if [ -n "$VERSION" ]; then BASE="https://github.com/$REPO/releases/download/v$VERSION"; else BASE="https://github.com/$REPO/releases/latest/download"; fi
  say "Downloading Photos ${VERSION:-(latest)} …"
  curl -fL --retry 3 --progress-bar -o "$ZIP" "$BASE/Photos-arm64.zip" || fail "Download failed. Check your connection, and that the release exists: https://github.com/$REPO/releases"
  curl -fsSL --retry 3 -o "$TMP/Photos-arm64.zip.sha256" "$BASE/Photos-arm64.zip.sha256" || fail "Could not download the checksum file next to the ZIP."
fi

# ---- verify -----------------------------------------------------------------------------------------------
if [ -f "$TMP/Photos-arm64.zip.sha256" ]; then
  WANT="$(awk '{print $1}' "$TMP/Photos-arm64.zip.sha256" | head -n1)"
  GOT="$(shasum -a 256 "$ZIP" | awk '{print $1}')"
  if [ -z "$WANT" ] || [ "$WANT" != "$GOT" ]; then fail "Checksum mismatch: the download is damaged or was changed. Not installing."; fi
  say "Checksum verified."
elif [ -n "$LOCAL_ZIP" ]; then
  say "No .sha256 next to the local ZIP; skipping the checksum check."
fi

# ---- unpack, replace, install ------------------------------------------------------------------------------
ditto -x -k "$ZIP" "$TMP/unpacked"
NEW="$TMP/unpacked/$APP_NAME.app"
[ -d "$NEW" ] || fail "The ZIP does not contain $APP_NAME.app."

if [ -d "$APP" ]; then
  quit_running
  say "Replacing the existing copy (your data folder is left alone)."
  rm -rf "$APP"
fi
ditto "$NEW" "$APP"

xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true       # harmless when absent
codesign --verify --deep --strict "$APP" || fail "The app's signature check failed. Not opening it."
touch "$APP"                                                      # lets Finder refresh the icon
[ -f "$APP/Contents/Resources/icon.icns" ] || say "(note: icon file not found inside the app)"

say ""
NEWV="$(/usr/bin/plutil -extract CFBundleShortVersionString raw "$APP/Contents/Info.plist" 2>/dev/null || echo "?")"
say "Installed: $APP (version $NEWV)"
say "Its data will live in: $DATA   (delete both, or the folder they are in, to remove everything)"

# ---- open -------------------------------------------------------------------------------------------------
if [ "$OPEN_AFTER" -eq 1 ]; then
  say "Opening Photos …"
  open "$APP" || true
fi

cat <<EONOTE

If macOS says it cannot verify the app (it is signed ad-hoc and not notarized by Apple):
  macOS 15 and later:  System Settings → Privacy & Security → scroll down to the message about "Photos" → Open Anyway.
  Any macOS:           run this once in Terminal, then open the app again:
                         xattr -dr com.apple.quarantine "$APP"
EONOTE
