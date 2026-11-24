require('dotenv').config();
const path = require('path');
const express = require('express');
const db = require('./db');
const poller = require('./poller');

const PORT = Number(process.env.PORT || 3017);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

app.get('/api/events', (req, res) => {
  const { user, system, since, until } = req.query;
  const limit = Math.min(Number(req.query.limit) || 500, 2000);
  const offset = Number(req.query.offset) || 0;
  res.json({
    events: db.query({ user, system, since, until, limit, offset }),
  });
});

app.get('/api/users', (req, res) => {
  const { since, until } = req.query;
  res.json({ users: db.perUserTotals({ since, until }) });
});

app.get('/api/stats', (_req, res) => {
  res.json(db.stats());
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: '5m',
    etag: true,
  })
);

app.listen(PORT, HOST, () => {
  console.log(`wds-tripwire-audit listening on ${HOST}:${PORT}`);
  poller.start();
});
