#!/bin/bash
# CI smoke test on a macOS (Apple Silicon) runner: the real app on a generated library.
#   1. generate fixtures; fingerprint them (names, sizes, times to the nanosecond, attributes, SHA-256)
#   2. run the app with PHOTOS_SMOKE (src/main/smoke.js drives it and writes a JSON report)
#   3. fingerprint again and compare: the library must be byte-for-byte untouched
#   4. repeat on a disk image mounted READ-ONLY: any write to it would fail loudly
set -euo pipefail
cd "$(dirname "$0")/.."
W="${SMOKE_DIR:-${RUNNER_TEMP:-/tmp}/photos-smoke}"
APP_CMD=("${SMOKE_APP:-./dev start}")
rm -rf "$W"; mkdir -p "$W"

run_app() { # $1 = library folder, $2 = name
  local lib="$1" name="$2"
  echo "::group::app run: $name"
  PHOTOS_SMOKE="$lib" PHOTOS_SMOKE_REPORT="$W/report-$name.json" PHOTOS_SMOKE_DATA="$W/data-$name" \
    PHOTOS_SMOKE_READONLY="${3:-0}" ${APP_CMD[0]} >"$W/app-$name.log" 2>&1 &
  local pid=$! waited=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 2; waited=$((waited + 2))
    if [ "$waited" -gt 900 ]; then echo "app did not finish in 900 s"; kill -9 "$pid" 2>/dev/null || true; break; fi
  done
  wait "$pid" 2>/dev/null || true
  sed -n '/SMOKE_RESULT/,$p' "$W/app-$name.log" | head -60 || true
  echo "--- last lines of the app log"; tail -25 "$W/app-$name.log" || true
  echo "::endgroup::"
  [ -f "$W/report-$name.json" ] || { echo "no report was written for $name"; return 1; }
  ./dev node -e "const r=require('$W/report-$name.json'); for (const s of r.steps) console.log((s.ok?'PASS ':'FAIL ')+s.name+' ('+s.ms+' ms)'+(s.ok?'':'\n      '+s.error.split('\n')[0])); process.exit(r.ok?0:1)"
}

echo "== fixtures"
./dev node tools/make-fixtures.js "$W/lib" --count 150

echo "== run 1: normal folder"
./dev node tools/verify-readonly.js record before-1 "$W/lib" --hash
./dev audit mark >/dev/null 2>&1 || true
STATUS=0
run_app "$W/lib" normal || STATUS=1
./dev node tools/verify-readonly.js record after-1 "$W/lib" --hash
./dev node tools/verify-readonly.js compare before-1 after-1 || STATUS=1

echo "== residue (information only: anything the app left outside its folders)"
sleep 8; ./dev audit report 2>&1 | head -40 || true

echo "== run 2: library on a disk image mounted read-only"
hdiutil create -quiet -srcfolder "$W/lib" -volname SmokeLib -format UDZO "$W/lib.dmg"
mkdir -p "$W/mnt"
hdiutil attach -quiet -readonly -nobrowse -mountpoint "$W/mnt" "$W/lib.dmg"
./dev node tools/verify-readonly.js record before-2 "$W/mnt" --hash
run_app "$W/mnt" readonly 1 || STATUS=1
./dev node tools/verify-readonly.js record after-2 "$W/mnt" --hash
./dev node tools/verify-readonly.js compare before-2 after-2 || STATUS=1
if grep -qiE "read-only file system|EROFS" "$W/app-readonly.log"; then echo "the app tried to write to the read-only image:"; grep -iE "read-only file system|EROFS" "$W/app-readonly.log" | head; STATUS=1; fi
hdiutil detach -quiet "$W/mnt" || true

echo "== result: $([ $STATUS -eq 0 ] && echo PASSED || echo FAILED)"
exit $STATUS
