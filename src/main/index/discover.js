/**
 * discover.js
 *
 * Recursively walks a source folder and yields candidate media files,
 * grouped by the directory they're directly inside. Grouping matters
 * because Live Photo pairing and burst detection (M1.6) both compare
 * sibling files within one folder — a flat, interleaved stream can't
 * support that, since subfolder contents would land between two files that
 * are actually siblings.
 *
 * Read-only: only ever calls fs.promises.readdir / lstat / stat / realpath.
 * Never opens, moves, renames, or deletes anything under the source folder.
 *
 * This module only decides "does this path look like a media file worth
 * indexing" by name and extension — it never opens or parses file contents.
 * That happens in the extraction stage (M1.5).
 */

const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'heic', 'heif', 'tiff', 'tif', 'bmp', 'webp', 'gif',
]);

const RAW_EXTENSIONS = new Set([
  'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'raf',
]);

const VIDEO_EXTENSIONS = new Set([
  'mov', 'mp4', 'm4v', 'avi',
]);

const MEDIA_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...RAW_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
]);

const BUNDLE_SUFFIXES = [
  '.app',
  '.photoslibrary',
  '.bundle',
  '.framework',
  '.plugin',
];

function isBundleDirectory(name) {
  const lower = name.toLowerCase();
  return BUNDLE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function isHidden(name) {
  return name.startsWith('.');
}

function getExtension(name) {
  const idx = name.lastIndexOf('.');
  if (idx === -1 || idx === name.length - 1) return '';
  return name.slice(idx + 1).toLowerCase();
}

function classifyMediaType(extension) {
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (MEDIA_EXTENSIONS.has(extension)) return 'image';
  return null;
}

async function* discoverFilesByDirectory(rootPath, options = {}) {
  const errors = options.errors || [];
  const visitedRealPaths = new Set();

  async function resolveRealPath(fullPath) {
    try {
      return await fs.promises.realpath(fullPath);
    } catch (err) {
      errors.push({ path: fullPath, message: err.message });
      return null;
    }
  }

  async function* walk(dirPath) {
    let entries;
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      // M8b.2: kind 'dir' = a directory could not be read. The scan worker
      // must then skip its deletion sweep (unreadable is not deleted).
      errors.push({ path: dirPath, message: err.message, code: err.code, kind: 'dir' });
      return;
    }

    const filesHere = [];
    const subDirsToWalk = [];

    for (const entry of entries) {
      if (isHidden(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isSymbolicLink()) {
        const real = await resolveRealPath(fullPath);
        if (real === null) continue;
        if (visitedRealPaths.has(real)) continue;

        let stat;
        try {
          stat = await fs.promises.stat(real);
        } catch (err) {
          errors.push({ path: fullPath, message: err.message });
          continue;
        }

        visitedRealPaths.add(real);

        if (stat.isDirectory()) {
          if (isBundleDirectory(entry.name)) continue;
          subDirsToWalk.push(fullPath);
        } else if (stat.isFile()) {
          const extension = getExtension(entry.name);
          const mediaType = classifyMediaType(extension);
          if (mediaType) {
            filesHere.push({ fullPath, filename: entry.name, extension, mediaType });
          }
        }
        continue;
      }

      if (entry.isDirectory()) {
        if (isBundleDirectory(entry.name)) continue;
        subDirsToWalk.push(fullPath);
        continue;
      }

      if (entry.isFile()) {
        const extension = getExtension(entry.name);
        const mediaType = classifyMediaType(extension);
        if (mediaType) {
          filesHere.push({ fullPath, filename: entry.name, extension, mediaType });
        }
      }
    }

    if (filesHere.length > 0) {
      yield { dirPath, files: filesHere };
    }

    // M8b.4: options.recursive === false reads only the starting folder
    // (scoped scans of a single changed directory). Default: recursive.
    if (options.recursive === false) return;
    for (const subDir of subDirsToWalk) {
      yield* walk(subDir);
    }
  }

  const rootReal = await resolveRealPath(rootPath);
  if (rootReal !== null) {
    visitedRealPaths.add(rootReal);
  }

  yield* walk(rootPath);
}

async function* discoverFiles(rootPath, options = {}) {
  for await (const group of discoverFilesByDirectory(rootPath, options)) {
    yield* group.files;
  }
}

module.exports = {
  discoverFiles,
  discoverFilesByDirectory,
  IMAGE_EXTENSIONS,
  RAW_EXTENSIONS,
  VIDEO_EXTENSIONS,
  MEDIA_EXTENSIONS,
  isBundleDirectory,
  isHidden,
  getExtension,
  classifyMediaType,
};
