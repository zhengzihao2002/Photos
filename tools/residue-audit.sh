#!/bin/bash
# Residue audit for the Photos project. Read-only outside the project folder.
# Usage: tools/residue-audit.sh mark | report | known
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
OUT="$ROOT/.cache/residue"
MARK="$OUT/marker"
L="$HOME/Library"
TMP_T="$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null)"
TMP_C="$(getconf DARWIN_USER_CACHE_DIR 2>/dev/null)"
NAMES='photos|electron|com\.local|npm|node|gyp|sharp|vips|ffmpeg|ffprobe|sips|sqlite'

# Noise from other apps, relative to the home folder. Printed by "report".
EXCLUDES=(
  ".Trash" ".zsh_sessions" ".zsh_history"
  "Library/Mail" "Library/Messages" "Library/Safari"
  "Library/Containers" "Library/Group Containers" "Library/Daemon Containers"
  "Library/Mobile Documents" "Library/CloudStorage"
  "Library/Metadata" "Library/Biome"
  "Library/Application Support/Google" "Library/Caches/Google"
  "Library/Application Support/Firefox" "Library/Caches/Firefox" "Library/Caches/Mozilla"
  "Library/Passes" "Library/Preferences/ContextStoreAgent.plist"
)

chk() {
  for p in "$@"; do
    if [ -e "$p" ] || [ -L "$p" ]; then
      printf "PRESENT %8s  %s\n" "$(du -sh "$p" 2>/dev/null | cut -f1)" "$p"
    else
      printf "absent            %s\n" "$p"
    fi
  done
}

extras() {
  echo
  echo "== Temp and per-user cache entries with project-related names:"
  out=$(find "$TMP_T" "$TMP_C" -mindepth 1 -maxdepth 2 2>/dev/null | grep -iE "/[^/]*($NAMES)[^/]*$" | grep -v '/com\.apple\.' | sort)
  echo "${out:-   (none)}"
  echo
  echo "== Keychain items mentioning Photos or Electron (names only, no secrets):"
  out=$(security dump-keychain 2>/dev/null | grep -iE '(0x00000007|"svce").*(photos|electron)' | sort -u)
  echo "${out:-   (none)}"
}

known() {
  echo "== Tools on PATH"
  echo "node: $(command -v node || echo none)"
  echo "npm:  $(command -v npm || echo none)"
  echo
  echo "== Toolchain and download caches"
  chk "$HOME/.nvm" "$HOME/.npm" "$HOME/.npmrc"
  chk "$L/Caches/electron" "$L/Caches/electron-builder"
  chk "$HOME/.electron" "$HOME/.electron-gyp" "$HOME/.node-gyp" "$L/Caches/node-gyp"
  chk "$HOME/.cache/electron" "$HOME/.cache/electron-builder" "$HOME/.cache/node-gyp"
  chk "$L/Caches"/ffmpeg-static* "$L/Caches"/ffprobe-static* "$L/Caches"/sharp*
  chk "$L/Caches/com.apple.python"
  echo
  echo "== App data, logs, crash reports"
  chk "$L/Application Support/Photos" "$L/Application Support/PhotosClone" "$L/Application Support/Electron"
  chk "$L/Logs/Photos" "$L/Logs/PhotosClone" "$L/Logs/Electron"
  chk "$L/Logs/DiagnosticReports"/*Electron* "$L/Logs/DiagnosticReports"/Photos*
  echo
  echo "== State macOS keeps per app"
  for id in com.local.photos com.github.Electron; do
    chk "$L/Saved Application State/$id.savedState"
    chk "$L/Preferences/$id.plist" "$L/Preferences/ByHost/$id".*
    chk "$L/Caches/$id" "$L/Caches/$id.ShipIt"
    chk "$L/HTTPStorages/$id" "$L/HTTPStorages/$id.binarycookies"
    chk "$L/WebKit/$id"
  done
  extras
}

report() {
  [ -f "$MARK" ] || { echo "No marker. Run: tools/residue-audit.sh mark"; exit 1; }
  echo "Marker set at: $(date -r "$MARK" '+%Y-%m-%d %H:%M:%S')"
  echo
  echo "== Excluded from the home scan (not checked):"
  echo "   $ROOT  (the project)"
  for e in "${EXCLUDES[@]}"; do echo "   ~/$e"; done
  echo "   anything named com.apple.*"
  PRUNE=( -path "$ROOT" )
  for e in "${EXCLUDES[@]}"; do PRUNE+=( -o -path "$HOME/$e" ); done
  find "$HOME" \( "${PRUNE[@]}" -o -name 'com.apple.*' \) -prune \
    -o ! -type d -newercm "$MARK" -print 2>/dev/null | sort > "$OUT/report-home.txt"
  n=$(wc -l < "$OUT/report-home.txt" | tr -d ' ')
  echo
  echo "== Home folder: $n files created or changed since the marker, grouped by folder"
  echo "   (full list: .cache/residue/report-home.txt)"
  sed "s|^$HOME/||" "$OUT/report-home.txt" | awk -F/ '
    { k = $1; for (i = 2; i <= 4 && i < NF; i++) k = k "/" $i; c[k]++ }
    END { for (k in c) printf "%7d  ~/%s\n", c[k], k }' | sort -k2
  echo
  echo "== Temp dir entries created or changed since the marker ($TMP_T):"
  out=$(find "$TMP_T" -mindepth 1 -maxdepth 2 -newercm "$MARK" 2>/dev/null | sort)
  echo "${out:-   (none)}"
  extras
}

case "${1:-}" in
  mark)   mkdir -p "$OUT"; touch "$MARK"; echo "Marker set at: $(date -r "$MARK" '+%Y-%m-%d %H:%M:%S')" ;;
  report) report ;;
  known)  known ;;
  *)      echo "Usage: tools/residue-audit.sh mark | report | known"; exit 2 ;;
esac
