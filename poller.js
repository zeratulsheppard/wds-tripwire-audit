const { getSignatures } = require('./tripwire');
const db = require('./db');

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 30_000);
const USER_DELETE_GRACE_MINUTES = Number(process.env.USER_DELETE_GRACE_MINUTES || 10);
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);

let isPrimed = db.getAllSnapshotRows().length > 0;
let lastTickAt = null;
let nextTickAt = null;

function getPollState() {
  return {
    intervalMs: POLL_INTERVAL_MS,
    lastTickAt,
    nextTickAt,
    primed: isPrimed,
  };
}

function parseTripwireTimestamp(ts) {
  if (!ts) return null;
  const parsed = Date.parse(ts.replace(' ', 'T') + 'Z');
  return Number.isFinite(parsed) ? parsed : null;
}

async function tick() {
  const started = Date.now();
  let sigs;
  try {
    sigs = await getSignatures();
  } catch (err) {
    console.error('[poller] fetch failed:', err.message);
    return;
  }

  if (!isPrimed) {
    db.applySnapshot(sigs);
    isPrimed = true;
    console.log(`[poller] primed snapshot with ${sigs.length} sigs`);
    return;
  }

  const vanished = db.applySnapshot(sigs);
  const now = Date.now();
  let userDeletes = 0;
  let naturalCollapses = 0;

  for (const row of vanished) {
    // Only audit wormhole sigs — ignore combat/data/relic/gas/ore churn
    if (row.sig_type && row.sig_type !== 'wormhole') continue;

    const lifeLeftMs = parseTripwireTimestamp(row.life_left);
    let minutesRemaining = null;
    let userFired;

    if (lifeLeftMs !== null) {
      minutesRemaining = Math.round((lifeLeftMs - now) / 60_000);
      userFired = minutesRemaining > USER_DELETE_GRACE_MINUTES;
    } else {
      userFired = Boolean(row.modified_by);
    }

    if (!userFired) {
      naturalCollapses++;
      continue;
    }

    const deletedBy = row.modified_by || row.created_by || null;
    const deletedById = row.modified_by_id || row.created_by_id || null;

    db.recordDeletion({
      sigId: row.sig_id,
      systemId: row.system_id,
      systemName: row.system_name,
      sigName: row.sig_name,
      sigType: row.sig_type,
      wormholeType: row.wormhole_type,
      deletedBy,
      deletedById,
      createdBy: row.created_by,
      createdById: row.created_by_id,
      lifeLeftAtDelete: row.life_left,
      minutesRemaining,
    });
    userDeletes++;
    console.log(
      `[poller] DELETE ${row.sig_name || row.sig_id} in ${row.system_name} ` +
        `by ${deletedBy ?? 'unknown'} (life-left ${minutesRemaining ?? '?'}m)`
    );
  }

  console.log(
    `[poller] ${sigs.length} sigs | ${vanished.length} vanished | ` +
      `${userDeletes} user, ${naturalCollapses} natural ` +
      `(${Date.now() - started}ms)`
  );
}

function startRetentionCleanup() {
  const run = () => {
    try {
      const n = db.purgeOldDeletions(RETENTION_DAYS);
      if (n > 0) console.log(`[retention] purged ${n} rows older than ${RETENTION_DAYS}d`);
    } catch (err) {
      console.error('[retention] failed:', err.message);
    }
  };
  run();
  setInterval(run, 6 * 60 * 60 * 1000);
}

function start() {
  console.log(
    `[poller] starting (interval ${POLL_INTERVAL_MS}ms, grace ${USER_DELETE_GRACE_MINUTES}m, retention ${RETENTION_DAYS}d, primed=${isPrimed})`
  );
  startRetentionCleanup();
  const loop = async () => {
    try {
      await tick();
    } catch (err) {
      console.error('[poller] tick failed:', err);
    } finally {
      lastTickAt = new Date().toISOString();
      nextTickAt = new Date(Date.now() + POLL_INTERVAL_MS).toISOString();
      setTimeout(loop, POLL_INTERVAL_MS);
    }
  };
  loop();
}

module.exports = { start, getPollState };
