-- Real browser measurements collected via iframe + Performance API.
-- One row per primary import URL measured in a single browser session.
-- Used to replace HEAD-request estimates in /_bundle once enough samples exist.
CREATE TABLE IF NOT EXISTS resource_timings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  package         TEXT    NOT NULL,
  version         TEXT    NOT NULL,
  export_key      TEXT    NOT NULL,
  cdn             TEXT    NOT NULL,
  browser         TEXT    NOT NULL,
  connection      TEXT    NOT NULL,
  transfer_size   INTEGER,          -- wire bytes (0 = cached, null = unknown)
  decoded_body_size INTEGER,        -- decompressed bytes
  start_time      REAL    NOT NULL, -- DOMHighResTimeStamp ms
  response_end    REAL    NOT NULL,
  url             TEXT    NOT NULL,
  timestamp       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_resource_timings_lookup
  ON resource_timings (package, version, export_key, cdn, timestamp);
