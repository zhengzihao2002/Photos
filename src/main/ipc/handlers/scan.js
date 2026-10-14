/**
 * IPC channels for scanning (M8b.2: backed by the main-process scan queue).
 *
 * scan:enqueue
 *   Request:  { sourceFolderId: number, kind?: 'full' | 'dirs', dirs?: string[] }
 *   Response: { queued: boolean, coalesced?: boolean, reason?: string }
 *   Never rejects because a scan is busy; requests wait their turn.
 *   Any sourceRootPath sent is ignored: the queue reads the root from the
 *   database when the scan starts (safe across relinks).
 *
 * scan:start      Alias of scan:enqueue (kept for older callers).
 *
 * scan:get-queue-state
 *   Response: { running: number|null, runningKind: string|null, pending: number[] }
 *   Lets a newly opened window learn the current state; changes are also
 *   pushed on the 'scan:queue-state' event.
 *
 * Progress is pushed on 'progress:update' (taskId 'scan-…'), unchanged.
 */

const scanQueue = require('../../index/scan-queue');

async function scanEnqueue(event, payload) {
  const p = payload || {};
  return scanQueue.enqueue({ sourceFolderId: p.sourceFolderId, kind: p.kind, dirs: p.dirs });
}

async function scanGetQueueState() {
  return scanQueue.getState();
}

module.exports = [
  { channel: 'scan:enqueue', handle: scanEnqueue },
  { channel: 'scan:start', handle: scanEnqueue },
  { channel: 'scan:get-queue-state', handle: scanGetQueueState },
];
