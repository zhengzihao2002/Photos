/**
 * IPC channels for source folder lifecycle.
 *
 * source:add
 *   Request:  { rootPath: string }
 *   Response: { added: boolean, id?: number, reason?: string }
 *
 * source:list
 *   Request:  none
 *   Response: Array<{ id, rootPath, displayName, status, addedAt,
 *                      lastScannedAt, lastCheckedAt, itemCount }>
 *   Side effect: refreshes each source's reachability (status) as part of
 *   listing, since this is the cheapest natural point to keep it honest
 *   without a separate background poller.
 *
 * source:remove
 *   Request:  { sourceFolderId: number }
 *   Response: { removed: boolean, deletedItemCount?: number, reason?: string }
 *
 * source:relink
 *   Request:  { sourceFolderId: number, newRootPath: string }
 *   Response: { relinked: boolean, reason?: string }
 *   Repoints an existing source at a new path (e.g. after a rename, or a
 *   drive that remounted under a different name) without losing its id or
 *   any of its existing items — relies on relative_path storage meaning
 *   only this one row needs to change, not every item beneath it.
 */

const db = require('../../index/db');
const paths = require('../../paths'); // M8b.6
const {
  addSourceFolder,
  listSourceFolders,
  removeSourceFolder,
  relinkSourceFolder,
} = require('../../index/source-folders');

// M8b.5: watchers follow the source list immediately.
function refreshWatchers() { require('../../index/folder-watcher').refresh(); }

async function sourceAdd(event, payload) {
  const res = await addSourceFolder(db.get(), payload.rootPath, { protectedRoots: paths.protectedRoots() });
  if (res && res.added) refreshWatchers();
  return res;
}

async function sourceList() {
  return listSourceFolders(db.get());
}

async function sourceRemove(event, payload) {
  const res = removeSourceFolder(db.get(), payload.sourceFolderId);
  if (res && res.removed) refreshWatchers();
  return res;
}

async function sourceRelink(event, payload) {
  const res = await relinkSourceFolder(db.get(), payload.sourceFolderId, payload.newRootPath,
    { protectedRoots: paths.protectedRoots() });
  if (res && res.relinked) refreshWatchers();
  return res;
}

module.exports = [
  { channel: 'source:add', handle: sourceAdd },
  { channel: 'source:list', handle: sourceList },
  { channel: 'source:remove', handle: sourceRemove },
  { channel: 'source:relink', handle: sourceRelink },
];
