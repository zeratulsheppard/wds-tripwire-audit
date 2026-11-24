require('dotenv').config();

const BASE = (process.env.TRIPWIRE_URL || '').replace(/\/$/, '');

let sessionCookie = null;
let sessionExpiry = 0;
const SESSION_TTL_MS = 50 * 60 * 1000;

const _nameCache = {};

async function getSessionCookie() {
  if (sessionCookie && Date.now() < sessionExpiry) return sessionCookie;

  const res = await fetch(`${BASE}/login.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      username: process.env.TRIPWIRE_USER,
      password: process.env.TRIPWIRE_PASS,
      mode: 'login',
    }),
  });

  const data = await res.json();
  if (data?.result !== 'success') {
    throw new Error(`Tripwire login failed: ${JSON.stringify(data)}`);
  }

  const setCookie = res.headers.get('set-cookie') ?? '';
  sessionCookie = setCookie
    .split(',')
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
  sessionExpiry = Date.now() + SESSION_TTL_MS;
  console.log('[tripwire] session refreshed');
  return sessionCookie;
}

async function rawChain() {
  const cookie = await getSessionCookie();
  const res = await fetch(`${BASE}/refresh.php?mode=init&systemID=-1`, {
    headers: { Cookie: cookie },
  });
  if (!res.ok) throw new Error(`Tripwire chain fetch failed (${res.status})`);
  return res.json();
}

async function resolveSystemNames(ids) {
  const missing = [...new Set(ids)]
    .map(Number)
    .filter((n) => n >= 30000000 && !_nameCache[String(n)]);
  if (!missing.length) return;

  try {
    const res = await fetch(
      'https://esi.evetech.net/latest/universe/names/?datasource=tranquility',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(missing),
      }
    );
    const items = await res.json();
    for (const item of Array.isArray(items) ? items : []) {
      if (item.category === 'solar_system') _nameCache[String(item.id)] = item.name;
    }
  } catch {
    // leave unresolved ids as-is
  }
}

// Flattens Tripwire's chain response into one row per signature with the
// fields we care about for audit purposes.
async function getSignatures() {
  const data = await rawChain();
  const sigsRaw = data.signatures ?? {};
  const sigsArr = Array.isArray(sigsRaw) ? sigsRaw : Object.values(sigsRaw);

  const whTypeBySig = {};
  for (const wh of Object.values(data.wormholes ?? {})) {
    if (wh.initialID && wh.secondaryID) {
      const t =
        wh.type && wh.type !== '????' && wh.type !== '???' && wh.type !== ''
          ? wh.type
          : null;
      whTypeBySig[String(wh.initialID)] = t;
      whTypeBySig[String(wh.secondaryID)] = t;
    }
  }

  await resolveSystemNames(sigsArr.map((s) => s.systemID));

  return sigsArr.map((s) => {
    const sigId = String(s.id);
    const systemId = String(s.systemID);
    const rawSig = s.signatureID && s.signatureID !== '???' ? s.signatureID : '';
    const sigMatch = rawSig.match(/^([A-Za-z]{3})-?(\d{3})$/);
    const sigName = sigMatch ? `${sigMatch[1].toUpperCase()}-${sigMatch[2]}` : '';
    const isTripwireActor = s.modifiedByName === 'Tripwire';

    return {
      sigId,
      systemId,
      systemName: _nameCache[systemId] ?? systemId,
      sigName,
      sigType: (s.type ?? '').toLowerCase() || null,
      wormholeType: whTypeBySig[sigId] ?? null,
      createdBy: s.createdByName ?? null,
      createdById: Number(s.createdByID) || null,
      modifiedBy: isTripwireActor ? null : s.modifiedByName ?? null,
      modifiedById: isTripwireActor ? null : Number(s.modifiedByID) || null,
      lifeLeft:
        s.lifeLeft && /^\d{4}-\d{2}-\d{2}/.test(s.lifeLeft) ? s.lifeLeft : null,
      lifeTime:
        s.lifeTime && /^\d{4}-\d{2}-\d{2}/.test(s.lifeTime) ? s.lifeTime : null,
    };
  });
}

module.exports = { getSignatures };
