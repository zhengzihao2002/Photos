/**
 * config.js
 *
 * Reads and writes the app's single JSON config file (see paths.configPath()).
 *
 * Schema (schemaVersion 1):
 *   {
 *     "schemaVersion": 1,
 *     "sourceFolders": string[],   // absolute paths the user picked. See note below.
 *     "window": {
 *       "width": number,
 *       "height": number,
 *       "x": number | null,        // null = "let the OS choose / center"
 *       "y": number | null
 *     },
 *     "grid": {
 *       "zoomLevel": number,        // target row height in px (M3's grid zoom slider)
 *       "libraryMode": string       // M8c.4: Library view last used: "years" | "months" | "all"
 *     },
 *     "viewer": {                   // added M5 (additive; old files fall back to defaults)
 *       "infoOpen": boolean,        // unused since M8c.2 (Info is session-only); kept so old files load
 *       "infoX": number | null,     // M8c.2b: Info window position (null = beside the main window)
 *       "infoY": number | null
 *     }
 *   }
 *
 * IMPORTANT — the one legitimate exception to "no absolute paths persisted":
 * `sourceFolders` necessarily holds absolute paths, because they point to
 * locations *outside* the portable app folder (the user's actual photo
 * folders, wherever those live on disk). This is unavoidable — the app has
 * no way to reference "the user's Pictures folder on some other Mac"
 * relatively.
 *
 * Consequence for later modules: if this app folder is copied to a
 * different Mac, these paths will very likely be wrong (different username,
 * different disk layout, or the folder simply doesn't exist there). M0 does
 * not attempt to detect or fix this. Recommendation for M1 (indexing): on
 * startup, stat() each sourceFolders entry before trusting it, and if it's
 * missing, surface a "this source folder can't be found — relink it?" UI
 * state instead of silently failing or silently re-scanning nothing.
 *
 * Safety: a missing or corrupt config file must never crash the app. Reads
 * fall back to defaults; writes are atomic (write to a temp file, then
 * rename over the real one) so a crash mid-write can't leave a half-written,
 * unparseable config behind.
 */

const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const SCHEMA_VERSION = 1;

function defaultConfig() {
  return {
    schemaVersion: SCHEMA_VERSION,
    sourceFolders: [],
    window: {
      width: 1280,
      height: 800,
      x: null,
      y: null,
    },
    grid: {
      zoomLevel: 160, // target row height in px; see M3 renderer.js
      libraryMode: 'all', // M8c.4 (U15): Library reopens on the view last used
    },
    viewer: {
      infoOpen: false, // unused since M8c.2 (Info open state is session-only)
      infoX: null,     // M8c.2b: Info window position, remembered across launches
      infoY: null,
    },
    sidebar: {
      section: 'library', // M6: last selected sidebar section
      collapsed: {},      // M6: section id -> true when collapsed
      visible: true,      // M6 (B.4): sidebar shown/hidden
    },
    people: {
      enabled: true,      // M10.8: People face analysis (Apple default: on)
    },
    language: null,       // M14: 'en' | 'zh-Hans'; null = follow the Mac's language until the user chooses
  };
}

/**
 * Shallow-merges loaded JSON over the defaults so that fields added by a
 * future schema version are tolerated, and fields missing from an old file
 * fall back cleanly instead of being `undefined`.
 */
/** M6: validates the sidebar block; invalid fields fall back to defaults. */
function normalizeSidebar(raw, defaults) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const collapsed = {};
  if (s.collapsed && typeof s.collapsed === 'object') {
    for (const [key, value] of Object.entries(s.collapsed)) {
      if (key.length <= 32 && typeof value === 'boolean') collapsed[key] = value;
    }
  }
  return {
    section: typeof s.section === 'string' && s.section.length > 0 && s.section.length <= 64 ? s.section : defaults.section,
    collapsed,
    visible: typeof s.visible === 'boolean' ? s.visible : defaults.visible,
  };
}

function normalize(raw) {
  const defaults = defaultConfig();
  if (!raw || typeof raw !== 'object') return defaults;

  return {
    schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : defaults.schemaVersion,
    sourceFolders: Array.isArray(raw.sourceFolders) ? raw.sourceFolders.filter((p) => typeof p === 'string') : defaults.sourceFolders,
    window: {
      ...defaults.window,
      ...(raw.window && typeof raw.window === 'object' ? raw.window : {}),
    },
    grid: {
      ...defaults.grid,
      ...(raw.grid && typeof raw.grid === 'object' ? raw.grid : {}),
      zoomLevel: typeof raw.grid?.zoomLevel === 'number' ? raw.grid.zoomLevel : defaults.grid.zoomLevel,
      libraryMode: ['years', 'months', 'all'].includes(raw.grid?.libraryMode) ? raw.grid.libraryMode : defaults.grid.libraryMode,
    },
    viewer: {
      ...defaults.viewer,
      ...(raw.viewer && typeof raw.viewer === 'object' ? raw.viewer : {}),
      infoOpen: typeof raw.viewer?.infoOpen === 'boolean' ? raw.viewer.infoOpen : defaults.viewer.infoOpen,
      infoX: Number.isFinite(raw.viewer?.infoX) ? raw.viewer.infoX : null,
      infoY: Number.isFinite(raw.viewer?.infoY) ? raw.viewer.infoY : null,
    },
    sidebar: normalizeSidebar(raw.sidebar, defaults.sidebar),
    people: {
      enabled: typeof raw.people?.enabled === 'boolean' ? raw.people.enabled : defaults.people.enabled,
    },
    language: raw.language === 'en' || raw.language === 'zh-Hans' ? raw.language : null,
  };
}

function load() {
  const file = paths.configPath();
  try {
    const text = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(text);
    return normalize(parsed);
  } catch (err) {
    // Missing file (first run) or corrupt JSON — both fall back to defaults.
    // Note: we deliberately do NOT overwrite the file here. If it's corrupt,
    // leaving it alone preserves evidence for debugging; the next explicit
    // save() call will replace it with a valid file anyway.
    return defaultConfig();
  }
}

/** Atomic write: write to a sibling temp file, then rename over the target. */
function save(config) {
  const file = paths.configPath();
  const tmpFile = path.join(path.dirname(file), `.config.json.${process.pid}.tmp`);
  const text = JSON.stringify(normalize(config), null, 2);
  fs.writeFileSync(tmpFile, text, 'utf8');
  fs.renameSync(tmpFile, file);
}

/** Load, apply a patch (shallow per top-level key), save, and return the result. */
function update(patch) {
  const current = load();
  const merged = {
    ...current,
    ...patch,
    window: { ...current.window, ...(patch.window || {}) },
    grid: { ...current.grid, ...(patch.grid || {}) },
    viewer: { ...current.viewer, ...(patch.viewer || {}) },
    sidebar: { ...current.sidebar, ...(patch.sidebar || {}) },
    people: { ...current.people, ...(patch.people || {}) },
  };
  const normalized = normalize(merged);
  save(normalized);
  return normalized;
}

module.exports = {
  SCHEMA_VERSION,
  defaultConfig,
  load,
  save,
  update,
};
