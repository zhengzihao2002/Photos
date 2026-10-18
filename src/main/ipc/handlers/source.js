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
const { t } = require('../../i18n'); // M14
const paths = require('../../paths'); // M8b.6
const {
  addSourceFolder,
  listSourceFolders,
  removeSourceFolder,
  relinkSourceFolder,
} = require('../../index/source-folders');

// M14: the reason texts come from source-folders.js in English; the user sees them in the app language.
function localizeReason(res) {
  if (!res || typeof res.reason !== 'string') return res;
  const r = res.reason;
  let text = null;
  if (r === 'Folder not found or not accessible') text = t('source.reason.notFound');
  else if (r === 'Not a folder') text = t('source.reason.notFolder');
  else if (r === 'Source folder not found') text = t('source.reason.sourceGone');
  else if (r.startsWith('Overlaps with an existing source folder: ')) text = t('source.reason.overlap', { path: r.slice('Overlaps with an existing source folder: '.length) });
  else if (r.startsWith('This folder contains the Photos app')) text = t('source.reason.containsApp');
  else if (r.startsWith('This folder is part of the Photos app')) text = t('source.reason.insideApp');
  return text ? Object.assign({}, res, { reason: text }) : res;
}

// M8b.5: watchers follow the source list immediately.
function refreshWatchers() {
  require('../../index/folder-watcher').refresh();
  require('../../index/source-guard').sync(); // M11: the write guard follows the source list
}

async function sourceAdd(event, payload) {
  const res = await addSourceFolder(db.get(), payload.rootPath, { protectedRoots: paths.protectedRoots() });
  if (res && res.added) refreshWatchers();
  return localizeReason(res);
}

async function sourceList() {
  return listSourceFolders(db.get());
}

async function sourceRemove(event, payload) {
  const res = removeSourceFolder(db.get(), payload.sourceFolderId);
  if (res && res.removed) refreshWatchers();
  return localizeReason(res);
}

async function sourceRelink(event, payload) {
  const res = await relinkSourceFolder(db.get(), payload.sourceFolderId, payload.newRootPath,
    { protectedRoots: paths.protectedRoots() });
  if (res && res.relinked) refreshWatchers();
  return localizeReason(res);
}

module.exports = [
  { channel: 'source:add', handle: sourceAdd },
  { channel: 'source:list', handle: sourceList },
  { channel: 'source:remove', handle: sourceRemove },
  { channel: 'source:relink', handle: sourceRelink },
];
