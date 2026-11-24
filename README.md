# wds-tripwire-audit

Audits user-fired signature deletions in Tripwire (`tw.torpedodelivery.com`) by
polling the chain every 30s, diffing against the previous snapshot, and
recording any sigs that vanished before their `lifeLeft` timer expired.

- Port: `3017` (local-only, no tunnel)
- Server: `10.0.0.33`, path `/opt/wds-tripwire-audit`
- Tripwire creds: logs in as `WingspanBountyHunter`
- Retention: 30 days (configurable via `RETENTION_DAYS`)
- Storage: SQLite (`audit.db`, WAL mode)

## Classifying deletes vs collapses

A sig that disappears between polls is logged as a **user-fired delete** when:

- `lifeLeft` was more than `USER_DELETE_GRACE_MINUTES` (default 10) in the future at last observation, OR
- `lifeLeft` was unknown but a non-Tripwire character was the last modifier.

Otherwise it's classified as a **natural collapse** and ignored.

The attributed user is `modified_by` (last toucher) with `created_by` as fallback.

## API

- `GET /api/events?user=&system=&since=&until=&limit=&offset=`
- `GET /api/users?since=&until=` — per-user deletion counts
- `GET /api/stats` — total events, snapshot size, oldest row
- `GET /healthz`

## Local dev

```bash
cp .env.example .env
# fill in TRIPWIRE_PASS
npm install
npm start
```

Visit http://localhost:3017.

## Deploy

```bash
scp -r . root@10.0.0.33:/opt/wds-tripwire-audit/
ssh root@10.0.0.33 'cd /opt/wds-tripwire-audit && npm install --omit=dev'
scp deploy/wds-tripwire-audit.service root@10.0.0.33:/etc/systemd/system/
ssh root@10.0.0.33 'systemctl daemon-reload && systemctl enable --now wds-tripwire-audit'
```
