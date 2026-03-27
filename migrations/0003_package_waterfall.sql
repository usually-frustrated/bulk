-- Structural waterfall: the logical dependency order of files loaded when
-- importing a package. Round trips are computed from browser timing gaps
-- (>5 ms = new round) at ingestion time, but only the dependency structure
-- (round_trip index, url, decoded size) is persisted — not raw timestamps.
--
-- One batch of rows per measurement session, all sharing the same recorded_at
-- (SQLite default precision = 1 second, enough to group a session).
-- Used by the banner to render the waterfall SVG and derive the package size.
CREATE TABLE IF NOT EXISTS package_waterfall (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  package      TEXT    NOT NULL,
  version      TEXT    NOT NULL,
  export_key   TEXT    NOT NULL,
  cdn          TEXT    NOT NULL,
  round_trip   INTEGER NOT NULL,   -- 0-indexed dependency depth
  url          TEXT    NOT NULL,
  bytes        INTEGER,            -- decoded_body_size (uncompressed JS)
  recorded_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_package_waterfall_lookup
  ON package_waterfall (package, version, export_key, cdn, recorded_at);
