
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY, title TEXT, summary TEXT, org TEXT, tags TEXT,
  formats TEXT, resources INTEGER, resources_list TEXT, license TEXT,
  updated TEXT, url TEXT
);
CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, title TEXT, datasets INTEGER);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
DELETE FROM datasets; DELETE FROM groups; DELETE FROM meta;
INSERT INTO meta VALUES ('synced_at', '2026-07-07T12:01:47.812Z'), ('total', '41236');

