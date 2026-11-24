const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(process.env.DB_PATH || './audit.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS deletions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sig_id          TEXT    NOT NULL,
    system_id       TEXT,
    system_name     TEXT,
    sig_name        TEXT,
    sig_type        TEXT,
    wormhole_type   TEXT,
    deleted_by      TEXT,
    deleted_by_id   INTEGER,
    created_by      TEXT,
    created_by_id   INTEGER,
    life_left_at_delete  TEXT,
    minutes_remaining    INTEGER,
    deleted_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_deletions_deleted_at ON deletions(deleted_at);
  CREATE INDEX IF NOT EXISTS idx_deletions_deleted_by ON deletions(deleted_by);
  CREATE INDEX IF NOT EXISTS idx_deletions_system    ON deletions(system_name);

  CREATE TABLE IF NOT EXISTS last_snapshot (
    sig_id          TEXT PRIMARY KEY,
    system_id       TEXT,
    system_name     TEXT,
    sig_name        TEXT,
    sig_type        TEXT,
    wormhole_type   TEXT,
    created_by      TEXT,
    created_by_id   INTEGER,
    modified_by     TEXT,
    modified_by_id  INTEGER,
    life_left       TEXT,
    life_time       TEXT,
    seen_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

const insertDeletion = db.prepare(`
  INSERT INTO deletions (
    sig_id, system_id, system_name, sig_name, sig_type, wormhole_type,
    deleted_by, deleted_by_id, created_by, created_by_id,
    life_left_at_delete, minutes_remaining
  ) VALUES (
    @sigId, @systemId, @systemName, @sigName, @sigType, @wormholeType,
    @deletedBy, @deletedById, @createdBy, @createdById,
    @lifeLeftAtDelete, @minutesRemaining
  )
`);

const upsertSnapshotRow = db.prepare(`
  INSERT INTO last_snapshot (
    sig_id, system_id, system_name, sig_name, sig_type, wormhole_type,
    created_by, created_by_id, modified_by, modified_by_id,
    life_left, life_time, seen_at
  ) VALUES (
    @sigId, @systemId, @systemName, @sigName, @sigType, @wormholeType,
    @createdBy, @createdById, @modifiedBy, @modifiedById,
    @lifeLeft, @lifeTime, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(sig_id) DO UPDATE SET
    system_id      = excluded.system_id,
    system_name    = excluded.system_name,
    sig_name       = excluded.sig_name,
    sig_type       = excluded.sig_type,
    wormhole_type  = excluded.wormhole_type,
    created_by     = excluded.created_by,
    created_by_id  = excluded.created_by_id,
    modified_by    = excluded.modified_by,
    modified_by_id = excluded.modified_by_id,
    life_left      = excluded.life_left,
    life_time      = excluded.life_time,
    seen_at        = excluded.seen_at
`);

const deleteSnapshotRow = db.prepare('DELETE FROM last_snapshot WHERE sig_id = ?');
const allSnapshotRows = db.prepare('SELECT * FROM last_snapshot');

function getAllSnapshotRows() {
  return allSnapshotRows.all();
}

// Applies the new snapshot and returns the rows that vanished (full prior state).
function applySnapshot(sigs) {
  const prior = allSnapshotRows.all();
  const incoming = new Set(sigs.map((s) => s.sigId));
  const vanished = prior.filter((row) => !incoming.has(row.sig_id));

  const tx = db.transaction(() => {
    for (const s of sigs) upsertSnapshotRow.run(s);
    for (const row of vanished) deleteSnapshotRow.run(row.sig_id);
  });
  tx();
  return vanished;
}

function recordDeletion(evt) {
  insertDeletion.run(evt);
}

const purgeOld = db.prepare(`
  DELETE FROM deletions
  WHERE deleted_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || ? || ' days')
`);

function purgeOldDeletions(days) {
  const info = purgeOld.run(days);
  return info.changes;
}

function query({ user, system, since, until, limit = 500, offset = 0 } = {}) {
  const where = [];
  const params = {};
  if (user) {
    where.push('deleted_by LIKE @user');
    params.user = `%${user}%`;
  }
  if (system) {
    where.push('system_name LIKE @system');
    params.system = `%${system}%`;
  }
  if (since) {
    where.push('deleted_at >= @since');
    params.since = since;
  }
  if (until) {
    where.push('deleted_at <= @until');
    params.until = until;
  }
  const sql = `
    SELECT * FROM deletions
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY deleted_at DESC
    LIMIT @limit OFFSET @offset
  `;
  params.limit = Math.min(limit, 2000);
  params.offset = offset;
  return db.prepare(sql).all(params);
}

function perUserTotals({ since, until } = {}) {
  const where = [];
  const params = {};
  if (since) { where.push('deleted_at >= @since'); params.since = since; }
  if (until) { where.push('deleted_at <= @until'); params.until = until; }
  const sql = `
    SELECT deleted_by AS user, deleted_by_id AS userId, COUNT(*) AS deletions
    FROM deletions
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY deleted_by, deleted_by_id
    ORDER BY deletions DESC
  `;
  return db.prepare(sql).all(params);
}

function stats() {
  return db
    .prepare(
      `SELECT
         COUNT(*)                                    AS total,
         MIN(deleted_at)                             AS oldest,
         MAX(deleted_at)                             AS newest,
         (SELECT COUNT(*) FROM last_snapshot)        AS snapshotSize
       FROM deletions`
    )
    .get();
}

module.exports = {
  applySnapshot,
  getAllSnapshotRows,
  recordDeletion,
  purgeOldDeletions,
  query,
  perUserTotals,
  stats,
};
