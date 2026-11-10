import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { Layout } from './rack.js';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS racks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  tenant      TEXT NOT NULL DEFAULT '',
  tenant_note TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'empty' CHECK (status IN ('used','empty','leased')),
  door        INTEGER NOT NULL DEFAULT 0,
  no_key      INTEGER NOT NULL DEFAULT 0,
  checked     TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS devices (
  id      TEXT PRIMARY KEY,
  rack_id TEXT NOT NULL REFERENCES racks(id) ON DELETE CASCADE,
  name    TEXT NOT NULL,
  ip      TEXT NOT NULL DEFAULT '',
  top     INTEGER NOT NULL,
  h       INTEGER NOT NULL,
  col     INTEGER NOT NULL DEFAULT 0,
  w       INTEGER NOT NULL DEFAULT 3,
  note    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_devices_rack ON devices(rack_id);
CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function loadSeed(): Layout & { log?: { at: string; text: string }[] } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return JSON.parse(fs.readFileSync(path.join(here, 'seed.json'), 'utf8'));
}

/** DB를 열고 스키마를 만든 뒤, 비어 있으면 seed.json(기존 HTML 배치도 데이터)으로 채운다. */
export function openDb(file: string, opts: { seed?: boolean } = {}): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const empty = (db.prepare('SELECT COUNT(*) AS n FROM racks').get() as { n: number }).n === 0;
  if (empty && opts.seed !== false) seed(db, loadSeed());
  return db;
}

export function seed(db: DB, data: Layout & { log?: { at: string; text: string }[] }) {
  const setMeta = db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)');
  const insRack = db.prepare(`INSERT INTO racks(id, name, tenant, tenant_note, status, door, no_key, checked, note, sort_order)
    VALUES (@id, @name, @tenant, @tenantNote, @status, @door, @noKey, @checked, @note, @sort)`);
  const insDev = db.prepare(`INSERT INTO devices(id, rack_id, name, ip, top, h, col, w, note)
    VALUES (@id, @rackId, @name, @ip, @top, @h, @col, @w, @note)`);
  const insLog = db.prepare('INSERT INTO logs(at, text) VALUES (?, ?)');

  db.transaction(() => {
    setMeta.run('title', data.title);
    setMeta.run('updated', data.updated);
    data.racks.forEach((r, i) => {
      insRack.run({ ...r, door: r.door ? 1 : 0, noKey: r.noKey ? 1 : 0, sort: i });
      r.devices.forEach((d) => insDev.run({ ...d, rackId: r.id, note: d.note ?? '' }));
    });
    (data.log ?? []).forEach((l) => insLog.run(l.at, l.text));
  })();
}
