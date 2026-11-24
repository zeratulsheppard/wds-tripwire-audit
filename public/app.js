const $ = (sel) => document.querySelector(sel);

function toUtcIso(local) {
  if (!local) return '';
  // datetime-local gives "YYYY-MM-DDTHH:MM" in the user's local tz; convert to UTC ISO
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function fmtWhen(iso) {
  if (!iso) return '';
  // keep server UTC, just drop milliseconds/trailing Z for readability
  return iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z').replace(/Z$/, ' UTC');
}

function fmtMinutes(m) {
  if (m == null) return '—';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h${rm}m` : `${h}h`;
}

function text(v) {
  return v == null || v === '' ? '—' : String(v);
}

function params(form) {
  const data = new FormData(form);
  const out = new URLSearchParams();
  const user = data.get('user');
  const system = data.get('system');
  const since = toUtcIso(data.get('since'));
  const until = toUtcIso(data.get('until'));
  if (user) out.set('user', user);
  if (system) out.set('system', system);
  if (since) out.set('since', since);
  if (until) out.set('until', until);
  return out;
}

let lastStats = null;

function renderStats() {
  if (!lastStats) return;
  const poll = lastStats.poll || {};
  let nextLine = 'Next poll: <b>—</b>';
  if (poll.nextTickAt) {
    const remaining = Math.max(0, Math.round((new Date(poll.nextTickAt) - Date.now()) / 1000));
    nextLine = `Next poll in <b>${remaining}s</b>`;
  } else if (poll.primed === false) {
    nextLine = 'Next poll: <b>priming…</b>';
  }
  $('#stats').innerHTML = `
    <div>Total events (30d): <b>${lastStats.total ?? 0}</b></div>
    <div>Tracked sigs: <b>${lastStats.snapshotSize ?? 0}</b></div>
    <div>${nextLine}</div>
  `;
}

async function refresh() {
  const p = params($('#filters'));
  const [events, users, stats] = await Promise.all([
    fetch('/api/events?' + p.toString()).then((r) => r.json()),
    fetch('/api/users?' + p.toString()).then((r) => r.json()),
    fetch('/api/stats').then((r) => r.json()),
  ]);

  lastStats = stats;
  renderStats();

  $('#users').innerHTML = (users.users || [])
    .map(
      (u) => `<tr>
        <td class="user">${text(u.user)}</td>
        <td class="num">${u.deletions}</td>
      </tr>`
    )
    .join('') || `<tr><td colspan="2">No deletions matched.</td></tr>`;

  const rows = events.events || [];
  $('#events').innerHTML = rows
    .map(
      (e) => `<tr>
        <td>${fmtWhen(e.deleted_at)}</td>
        <td class="user">${text(e.deleted_by)}</td>
        <td class="sys">${text(e.system_name)}</td>
        <td>${text(e.sig_name)}</td>
        <td>${text(e.sig_type)}</td>
        <td>${text(e.wormhole_type)}</td>
        <td class="num">${fmtMinutes(e.minutes_remaining)}</td>
        <td>${text(e.created_by)}</td>
      </tr>`
    )
    .join('') || `<tr><td colspan="8">No deletions matched.</td></tr>`;

  $('#eventsHint').textContent = `${rows.length} event${rows.length === 1 ? '' : 's'} shown.`;
}

$('#filters').addEventListener('submit', (e) => {
  e.preventDefault();
  refresh();
});
$('#reset').addEventListener('click', () => {
  $('#filters').reset();
  refresh();
});

refresh();
setInterval(refresh, 30_000);
setInterval(renderStats, 1000);
