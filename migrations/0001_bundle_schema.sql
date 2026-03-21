-- CDN-served file sizes per (package, version, export_key, cdn).
-- bytes_raw    = uncompressed body size (GET fallback when HEAD has no Content-Length)
-- bytes_transfer = Content-Length from HEAD response (compressed transfer size)
-- At least one of the two is always non-null.
CREATE TABLE IF NOT EXISTS cdn_sizes (
  package        TEXT    NOT NULL,
  version        TEXT    NOT NULL,
  export_key     TEXT    NOT NULL,  -- normalised: 'index', 'jsx-runtime', etc.
  cdn            TEXT    NOT NULL,  -- 'esm.sh' | 'jsdelivr' | 'unpkg'
  bytes_raw      INTEGER,
  bytes_transfer INTEGER,
  fetched_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (package, version, export_key, cdn)
);

-- Resolved exports map for a specific package version (from package.json).
-- exports column: JSON array of { key: string, path: string }
CREATE TABLE IF NOT EXISTS package_exports (
  package    TEXT NOT NULL,
  version    TEXT NOT NULL,
  exports    TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (package, version)
);

-- One row per published version of a package.
CREATE TABLE IF NOT EXISTS package_versions (
  package      TEXT NOT NULL,
  version      TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY (package, version)
);

-- Tracks when we last populated package_versions for a given package.
-- Allows a single freshness check instead of scanning the versions table.
CREATE TABLE IF NOT EXISTS package_versions_fetched (
  package    TEXT NOT NULL PRIMARY KEY,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- @latest tag resolution cache (TTL enforced in queries via fetched_at).
CREATE TABLE IF NOT EXISTS version_resolution (
  package    TEXT NOT NULL PRIMARY KEY,
  version    TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
