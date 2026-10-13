/**
 * IPC channel: system:get-info
 * Request payload:  none
 * Response:         { appVersion: string, paths: {
 *                       dataRoot, dbPath, thumbnailsDir, configPath, logsDir
 *                     } }
 *
 * Read-only diagnostic info. Exists in M0 mainly as proof that the
 * request/response IPC pattern and the path-resolution module both work
 * end-to-end from the renderer.
 */

const { app } = require('electron');
const paths = require('../../paths');

async function getInfo() {
  return {
    appVersion: app.getVersion(),
    paths: paths.allPaths(),
  };
}

module.exports = [{ channel: 'system:get-info', handle: getInfo }];
