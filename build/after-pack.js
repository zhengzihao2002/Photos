/**
 * build/after-pack.js (M9) -- electron-builder afterPack hook, macOS only.
 *  1. removes usage-description keys the app never needs (camera, microphone, Bluetooth) from Info.plist;
 *  2. signs the whole bundle AD-HOC (`codesign --sign -`): Apple Silicon will not run completely unsigned
 *     arm64 code, and no paid Apple Developer ID is used (the app is not notarized).
 * Runs after every file is in place, so nothing changes the bundle after it is signed.
 */
const { execFileSync } = require('child_process');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  const plist = path.join(app, 'Contents', 'Info.plist');
  for (const key of ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSBluetoothAlwaysUsageDescription', 'NSBluetoothPeripheralUsageDescription', 'NSAudioCaptureUsageDescription']) {
    try { execFileSync('/usr/bin/plutil', ['-remove', key, plist], { stdio: 'ignore' }); } catch (e) { /* key not present */ }
  }
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log('ad-hoc signed and verified: ' + app);
};
