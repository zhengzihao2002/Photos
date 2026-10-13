/**
 * IPC channel: scan:start
 * Request payload:  { sourceFolderId: number, sourceRootPath: string }
 * Response:         { started: boolean, taskId?: string, reason?: string }
 *
 * Minimal trigger for M1.6's own testing, called directly from DevTools —
 * M1.8 wraps this in real UI. Progress is reported separately on the
 * existing progress:update event channel, not in this response.
 */

const { BrowserWindow } = require('electron');
const paths = require('../../paths');
const { startScan } = require('../../index/scan-manager');

async function scanStart(event, payload) {
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  return startScan({
    dbPath: paths.dbPath(),
    sourceFolderId: payload.sourceFolderId,
    sourceRootPath: payload.sourceRootPath,
    mainWindow,
  });
}

module.exports = [{ channel: 'scan:start', handle: scanStart }];
