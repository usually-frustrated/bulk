-- Bundle cache: permanent, immutable results keyed by (package, version, export_path)
CREATE TABLE IF NOT EXISTS bundle_cache (
  package      TEXT NOT NULL,
  version      TEXT NOT NULL,
  export_path  TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  computed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (package, version, export_path)
);

-- Bundle jobs: ephemeral job tracking for async requests
-- status: pending | processing | completed | failed
CREATE TABLE IF NOT EXISTS bundle_jobs (
  id           TEXT PRIMARY KEY,
  package      TEXT NOT NULL,
  version      TEXT NOT NULL,
  export_path  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  bytes        INTEGER,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS bundle_jobs_key
  ON bundle_jobs (package, version, export_path, status);

CREATE INDEX IF NOT EXISTS bundle_jobs_created
  ON bundle_jobs (created_at);
