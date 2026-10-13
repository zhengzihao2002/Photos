const migrations = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE _meta (
          key TEXT PRIMARY KEY,
          value TEXT
        )
      `);
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec(`
        CREATE TABLE source_folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          root_path TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'missing')),
          added_at INTEGER NOT NULL,
          last_scanned_at INTEGER,
          last_checked_at INTEGER
        );

        CREATE TABLE items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_folder_id INTEGER NOT NULL REFERENCES source_folders(id),
          relative_path TEXT NOT NULL,
          filename TEXT NOT NULL,
          media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
          extension TEXT NOT NULL,
          file_size_bytes INTEGER NOT NULL,
          file_mtime INTEGER NOT NULL,
          content_signature TEXT,
          width INTEGER,
          height INTEGER,
          orientation_applied INTEGER NOT NULL DEFAULT 1,
          duration_seconds REAL,
          capture_time_local TEXT,
          capture_time_source TEXT,
          capture_date TEXT,
          capture_year INTEGER,
          capture_month INTEGER,
          camera_make TEXT,
          camera_model TEXT,
          lens_model TEXT,
          iso INTEGER,
          f_number REAL,
          exposure_time_seconds REAL,
          focal_length_mm REAL,
          gps_latitude REAL,
          gps_longitude REAL,
          has_gps INTEGER NOT NULL DEFAULT 0,
          is_screenshot INTEGER NOT NULL DEFAULT 0,
          is_raw INTEGER NOT NULL DEFAULT 0,
          is_gif INTEGER NOT NULL DEFAULT 0,
          is_panorama INTEGER NOT NULL DEFAULT 0,
          is_live_photo INTEGER NOT NULL DEFAULT 0,
          live_photo_video_item_id INTEGER REFERENCES items(id),
          is_live_photo_component INTEGER NOT NULL DEFAULT 0,
          burst_id TEXT,
          is_burst_cover INTEGER NOT NULL DEFAULT 0,
          extraction_error TEXT,
          is_deleted INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX idx_items_source_relpath ON items (source_folder_id, relative_path);
        CREATE INDEX idx_items_source_folder ON items (source_folder_id);
        CREATE INDEX idx_items_capture_time ON items (capture_time_local, id) WHERE is_deleted = 0 AND is_live_photo_component = 0;
        CREATE INDEX idx_items_capture_year_month ON items (capture_year, capture_month) WHERE is_deleted = 0 AND is_live_photo_component = 0;
        CREATE INDEX idx_items_capture_date ON items (capture_date) WHERE is_deleted = 0 AND is_live_photo_component = 0;
        CREATE INDEX idx_items_video ON items (capture_time_local) WHERE media_type = 'video' AND is_deleted = 0 AND is_live_photo_component = 0;
        CREATE INDEX idx_items_screenshot ON items (capture_time_local) WHERE is_screenshot = 1 AND is_deleted = 0 AND is_live_photo_component = 0;
        CREATE INDEX idx_items_raw ON items (capture_time_local) WHERE is_raw = 1 AND is_deleted = 0 AND is_live_photo_component = 0;
        CREATE INDEX idx_items_gif ON items (capture_time_local) WHERE is_gif = 1 AND is_deleted = 0 AND is_live_photo_component = 0;
        CREATE INDEX idx_items_panorama ON items (capture_time_local) WHERE is_panorama = 1 AND is_deleted = 0 AND is_live_photo_component = 0;
        CREATE INDEX idx_items_gps ON items (gps_latitude, gps_longitude) WHERE has_gps = 1 AND is_deleted = 0;
        CREATE INDEX idx_items_burst ON items (burst_id) WHERE burst_id IS NOT NULL;
        CREATE INDEX idx_items_content_signature ON items (content_signature);
      `);
    },
  },
  {
    version: 3,
    up: (db) => {
      db.exec(`
        DROP INDEX IF EXISTS idx_items_screenshot;
        ALTER TABLE items DROP COLUMN is_screenshot;
      `);
    },
  },
  {
    version: 4,
    up: (db) => {
      db.exec(`
        DROP INDEX idx_items_capture_time;
        DROP INDEX idx_items_capture_year_month;
        DROP INDEX idx_items_capture_date;
        DROP INDEX idx_items_video;
        DROP INDEX idx_items_raw;
        DROP INDEX idx_items_gif;
        DROP INDEX idx_items_panorama;
        DROP INDEX idx_items_gps;

        CREATE INDEX idx_items_capture_time ON items (capture_time_local, id)
          WHERE is_deleted = 0 AND is_live_photo_component = 0 AND (burst_id IS NULL OR is_burst_cover = 1);
        CREATE INDEX idx_items_capture_year_month ON items (capture_year, capture_month)
          WHERE is_deleted = 0 AND is_live_photo_component = 0 AND (burst_id IS NULL OR is_burst_cover = 1);
        CREATE INDEX idx_items_capture_date ON items (capture_date)
          WHERE is_deleted = 0 AND is_live_photo_component = 0 AND (burst_id IS NULL OR is_burst_cover = 1);
        CREATE INDEX idx_items_video ON items (capture_time_local)
          WHERE media_type = 'video' AND is_deleted = 0 AND is_live_photo_component = 0 AND (burst_id IS NULL OR is_burst_cover = 1);
        CREATE INDEX idx_items_raw ON items (capture_time_local)
          WHERE is_raw = 1 AND is_deleted = 0 AND is_live_photo_component = 0 AND (burst_id IS NULL OR is_burst_cover = 1);
        CREATE INDEX idx_items_gif ON items (capture_time_local)
          WHERE is_gif = 1 AND is_deleted = 0 AND is_live_photo_component = 0 AND (burst_id IS NULL OR is_burst_cover = 1);
        CREATE INDEX idx_items_panorama ON items (capture_time_local)
          WHERE is_panorama = 1 AND is_deleted = 0 AND is_live_photo_component = 0 AND (burst_id IS NULL OR is_burst_cover = 1);
        CREATE INDEX idx_items_gps ON items (gps_latitude, gps_longitude)
          WHERE has_gps = 1 AND is_deleted = 0 AND is_live_photo_component = 0 AND (burst_id IS NULL OR is_burst_cover = 1);
      `);
    },
  },
  {
    version: 5,
    up: (db) => {
      db.exec(`
        DROP INDEX IF EXISTS idx_items_content_signature;
        ALTER TABLE items DROP COLUMN content_signature;
      `);
    },
  },
  {
    version: 6,
    up: (db) => {
      db.exec(`
        ALTER TABLE items ADD COLUMN thumb_sm_status TEXT
          CHECK (thumb_sm_status IN ('pending', 'done', 'error'));
        ALTER TABLE items ADD COLUMN thumb_md_status TEXT
          CHECK (thumb_md_status IN ('pending', 'done', 'error'));
        ALTER TABLE items ADD COLUMN thumb_error TEXT;

        CREATE INDEX idx_items_thumb_sm_todo ON items (id)
          WHERE is_deleted = 0 AND (thumb_sm_status IS NULL OR thumb_sm_status = 'pending');

        CREATE TRIGGER trg_items_thumb_reset_on_change
        AFTER UPDATE OF file_mtime, file_size_bytes ON items
        WHEN OLD.file_mtime IS NOT NEW.file_mtime OR OLD.file_size_bytes IS NOT NEW.file_size_bytes
        BEGIN
          UPDATE items
          SET thumb_sm_status = NULL, thumb_md_status = NULL, thumb_error = NULL
          WHERE id = NEW.id;
        END;
      `);
    },
  },
  {
    // M1 patch + M6: partial indexes for the new filters. No new columns
    // (Selfies uses the existing lens_model; Slo-mo etc. were skipped).
    // Each index embeds the identical base visibility clause, and each filter
    // clause in queries.js must be textually identical to its index term.
    version: 7,
    up: (db) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_items_selfie ON items (capture_time_local)
          WHERE media_type = 'image' AND lens_model LIKE '%front%' AND is_deleted = 0 AND is_live_photo_component = 0 AND (burst_id IS NULL OR is_burst_cover = 1);
        CREATE INDEX IF NOT EXISTS idx_items_live ON items (capture_time_local)
          WHERE is_live_photo = 1 AND is_deleted = 0 AND is_live_photo_component = 0 AND (burst_id IS NULL OR is_burst_cover = 1);
        CREATE INDEX IF NOT EXISTS idx_items_burst ON items (capture_time_local)
          WHERE burst_id IS NOT NULL AND is_deleted = 0 AND is_live_photo_component = 0 AND (burst_id IS NULL OR is_burst_cover = 1);
        CREATE INDEX IF NOT EXISTS idx_items_source ON items (source_folder_id, capture_time_local)
          WHERE is_deleted = 0 AND is_live_photo_component = 0 AND (burst_id IS NULL OR is_burst_cover = 1);
      `);
    },
  },
  {
    // M6: the 'burst' filter switches from 'burst_id IS NOT NULL' (planned as
    // a range search plus a temp sort, so SQLite preferred the general index)
    // to the equivalent equality 'is_burst_cover = 1', served by this index.
    version: 8,
    up: (db) => {
      db.exec(`
        DROP INDEX IF EXISTS idx_items_burst;
        CREATE INDEX IF NOT EXISTS idx_items_burst_cover ON items (capture_time_local)
          WHERE is_burst_cover = 1 AND is_deleted = 0 AND is_live_photo_component = 0 AND (burst_id IS NULL OR is_burst_cover = 1);
      `);
    },
  },
  {
    // M7.2: records which extractor version wrote each row, so a later
    // extractor improvement can re-extract old rows exactly once (see
    // needsReextraction in scan-directory-batch.js). Existing rows default
    // to 1 = "before video GPS". Guarded so a re-run is harmless.
    version: 9,
    up: (db) => {
      const columns = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
      if (!columns.includes('extraction_version')) {
        db.exec('ALTER TABLE items ADD COLUMN extraction_version INTEGER NOT NULL DEFAULT 1;');
      }
    },
  },
  {
    // M7.3: offline place names (reverse-geocoded from GPS by the scan
    // worker's place pass; see src/main/places/). Both languages are stored
    // so a system-language change needs no recompute. place_version is the
    // dataset version that computed the row; NULL = not yet computed (also
    // written on every full extraction so changed coordinates are redone).
    // Guarded per column so a re-run is harmless.
    version: 10,
    up: (db) => {
      const existing = new Set(db.prepare('PRAGMA table_info(items)').all().map((c) => c.name));
      const columns = [
        ['place_locality_en', 'TEXT'],
        ['place_locality_zh', 'TEXT'],
        ['place_region_en', 'TEXT'],
        ['place_region_zh', 'TEXT'],
        ['place_country_code', 'TEXT'],
        ['place_version', 'INTEGER'],
      ];
      for (const [name, type] of columns) {
        if (!existing.has(name)) db.exec('ALTER TABLE items ADD COLUMN ' + name + ' ' + type + ';');
      }
    },
  },
  {
    // M10.4: People (local face recognition). Faces and people live only in
    // this database; photo files are never written. face_version NULL = item
    // needs analysis (also cleared by the trigger below when the file changes;
    // a pipeline version raise is handled by the face worker at startup).
    // Cascades: item deleted -> its faces; person deleted -> faces unassigned.
    // Guarded so a re-run is harmless.
    version: 11,
    up: (db) => {
      const existing = new Set(db.prepare('PRAGMA table_info(items)').all().map((c) => c.name));
      if (existing.has('face_version') === false) db.exec('ALTER TABLE items ADD COLUMN face_version INTEGER;');
      if (existing.has('face_attempts') === false) db.exec('ALTER TABLE items ADD COLUMN face_attempts INTEGER NOT NULL DEFAULT 0;');
      db.exec(`
        CREATE TABLE IF NOT EXISTS people (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT,
          cover_face_id INTEGER REFERENCES faces(id) ON DELETE SET NULL,
          cover_is_user INTEGER NOT NULL DEFAULT 0,
          is_hidden INTEGER NOT NULL DEFAULT 0,
          is_locked INTEGER NOT NULL DEFAULT 0,
          centroid BLOB,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS faces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          box_x REAL NOT NULL, box_y REAL NOT NULL, box_w REAL NOT NULL, box_h REAL NOT NULL,
          landmarks BLOB NOT NULL,
          score REAL NOT NULL,
          size_px INTEGER NOT NULL,
          sharpness REAL,
          can_seed INTEGER NOT NULL DEFAULT 0,
          embedding BLOB NOT NULL,
          person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
          assignment TEXT CHECK (assignment IN ('auto', 'user')),
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS person_refs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          vector BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS face_rejections (
          face_id INTEGER NOT NULL REFERENCES faces(id) ON DELETE CASCADE,
          person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          PRIMARY KEY (face_id, person_id)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS idx_faces_item ON faces (item_id);
        CREATE INDEX IF NOT EXISTS idx_faces_person ON faces (person_id, item_id) WHERE person_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_people_name ON people (name COLLATE NOCASE) WHERE name IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_people_cover ON people (cover_face_id);
        CREATE INDEX IF NOT EXISTS idx_person_refs_person ON person_refs (person_id);
        CREATE INDEX IF NOT EXISTS idx_face_rejections_person ON face_rejections (person_id);
        CREATE INDEX IF NOT EXISTS idx_items_face_todo ON items (id)
          WHERE face_version IS NULL AND media_type = 'image' AND is_deleted = 0;
        CREATE TRIGGER IF NOT EXISTS trg_items_face_reset_on_change
          AFTER UPDATE OF file_mtime, file_size_bytes ON items
          WHEN OLD.file_mtime IS NOT NEW.file_mtime OR OLD.file_size_bytes IS NOT NEW.file_size_bytes
        BEGIN
          UPDATE items SET face_version = NULL, face_attempts = 0 WHERE id = NEW.id;
        END;
      `);
    },
  },
  {
    // M10.5: two-level People model. Faces form tight clusters (very alike);
    // people are sets of clusters, so a whole cluster can be removed from a
    // person. faces.person_id is kept in step with the cluster's person so the
    // person:<id> filter and idx_faces_person are unchanged. person_refs from
    // migration 11 is superseded (clusters are the references) and left unused.
    // Guarded so a re-run is harmless.
    version: 12,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS face_clusters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
          centroid BLOB,
          is_user INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cluster_rejections (
          cluster_id INTEGER NOT NULL REFERENCES face_clusters(id) ON DELETE CASCADE,
          person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          PRIMARY KEY (cluster_id, person_id)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS idx_face_clusters_person ON face_clusters (person_id);
        CREATE INDEX IF NOT EXISTS idx_cluster_rejections_person ON cluster_rejections (person_id);
      `);
      const cols = new Set(db.prepare('PRAGMA table_info(faces)').all().map((c) => c.name));
      if (cols.has('cluster_id') === false) {
        db.exec('ALTER TABLE faces ADD COLUMN cluster_id INTEGER REFERENCES face_clusters(id) ON DELETE SET NULL;');
      }
      db.exec('CREATE INDEX IF NOT EXISTS idx_faces_cluster ON faces (cluster_id) WHERE cluster_id IS NOT NULL;');
    },
  },
  {
    // M10.7: the People page's Custom Order (Sort by Custom Order). NULL = not
    // placed by the user; those follow placed people, most photos first.
    // Guarded so a re-run is harmless.
    version: 13,
    up: (db) => {
      const cols = new Set(db.prepare('PRAGMA table_info(people)').all().map((c) => c.name));
      if (cols.has('sort_order') === false) db.exec('ALTER TABLE people ADD COLUMN sort_order INTEGER;');
    },
  },
];

module.exports = { migrations };
