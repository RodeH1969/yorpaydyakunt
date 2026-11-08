const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EDITOR_PASSWORD = process.env.EDITOR_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!EDITOR_PASSWORD || !SESSION_SECRET) {
  console.error('Missing EDITOR_PASSWORD or SESSION_SECRET');
  process.exit(1);
}

const db = require('./db');

const PUB = path.join(__dirname, 'public');
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'views', 'index.html'), 'utf8');
const STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'];
const SLUG_RE = /^[a-z0-9-]{1,100}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  next();
});

/* ---------- helpers ---------- */

function limiter(max, windowMs) {
  let hits = new Map();
  setInterval(() => { hits = new Map(); }, windowMs).unref();
  return (req, res, next) => {
    const n = (hits.get(req.ip) || 0) + 1;
    hits.set(req.ip, n);
    if (n > max) return res.status(429).json({ error: 'Too many requests' });
    next();
  };
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fail(res, err) {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function makeToken() {
  const exp = String(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return exp + '.' + sign(exp);
}

function validToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(exp));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(exp) > Date.now();
}

function passwordOk(input) {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(input), h(EDITOR_PASSWORD));
}

function requireEditor(req, res, next) {
  if (!validToken(getCookie(req, 'editor'))) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function slugify(title) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return (base || 'whisper') + '-' + crypto.randomBytes(2).toString('hex');
}

function todayBrisbane() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' });
}

function validDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function pageWithMeta(meta) {
  return INDEX_HTML.replace('<!--META-->', meta);
}

/* ---------- public pages ---------- */

app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.get('/', (req, res) => {
  res.type('html').send(pageWithMeta('<title>yorpaydyakunt</title>'));
});

app.get('/w/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!SLUG_RE.test(slug)) return res.redirect(302, '/');
  try {
    const w = await db.get(slug);
    if (!w) return res.redirect(302, '/');
    const url = `${req.protocol}://${req.get('host')}/w/${slug}`;
    const title = `${w.title} · yorpaydyakunt`;
    const meta = [
      `<title>${esc(title)}</title>`,
      `<meta name="description" content="${esc(w.teaser)}">`,
      `<meta property="og:type" content="article">`,
      `<meta property="og:site_name" content="yorpaydyakunt">`,
      `<meta property="og:title" content="${esc(title)}">`,
      `<meta property="og:description" content="${esc(w.teaser)}">`,
      `<meta property="og:url" content="${esc(url)}">`,
      `<meta name="twitter:card" content="summary">`,
    ].join('\n');
    res.type('html').send(pageWithMeta(meta));
  } catch (err) {
    console.error(err);
    res.status(500).type('text').send('Something went wrong');
  }
});

app.get('/editor', (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(PUB, 'editor.html'));
});

app.use(express.static(PUB, { index: false }));

/* ---------- public API ---------- */

app.get('/api/whispers', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await db.list());
  } catch (err) { fail(res, err); }
});

app.get('/api/whispers/:slug', async (req, res) => {
  if (!SLUG_RE.test(req.params.slug)) return res.status(404).json({ error: 'Not found' });
  try {
    const w = await db.get(req.params.slug);
    if (!w) return res.status(404).json({ error: 'Not found' });
    res.set('Cache-Control', 'no-store');
    res.json(w);
  } catch (err) { fail(res, err); }
});

// One call per real popup opening. Returns the whisper with its new count.
app.post('/api/whispers/:slug/open', limiter(60, 60 * 1000), async (req, res) => {
  const slug = req.params.slug;
  if (!SLUG_RE.test(slug)) return res.status(404).json({ error: 'Not found' });
  try {
    const n = await db.increment(slug);
    if (n === null || n === undefined) return res.status(404).json({ error: 'Not found' });
    const w = await db.get(slug);
    if (!w) return res.status(404).json({ error: 'Not found' });
    w.open_count = Math.max(Number(n), Number(w.open_count));
    res.set('Cache-Control', 'no-store');
    res.json(w);
  } catch (err) { fail(res, err); }
});

// Anonymous lead from a visitor. Nothing about the sender is stored.
app.post('/api/leads', limiter(5, 60 * 60 * 1000), async (req, res) => {
  const b = req.body || {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const lead = str(b.lead);
  const city = str(b.city);
  const suburb = str(b.suburb);
  const happened_on = str(b.happened_on);

  if (!lead || lead.length > 1000) return res.status(400).json({ error: 'Lead: 1 to 1000 characters' });
  if (!city || city.length > 80) return res.status(400).json({ error: 'City: 1 to 80 characters' });
  if (!suburb || suburb.length > 80) return res.status(400).json({ error: 'Suburb: 1 to 80 characters' });
  if (!validDate(happened_on) || happened_on > todayBrisbane()) return res.status(400).json({ error: 'Date is not valid' });

  try {
    await db.insertLead({ lead, city, suburb, happened_on });
    res.status(201).json({ ok: true });
  } catch (err) { fail(res, err); }
});

/* ---------- editor API ---------- */

app.get('/api/editor/session', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ editor: validToken(getCookie(req, 'editor')) });
});

app.post('/api/editor/login', limiter(10, 15 * 60 * 1000), (req, res) => {
  const password = req.body && req.body.password;
  if (typeof password !== 'string' || !passwordOk(password)) {
    return res.status(401).json({ error: 'Wrong password' });
  }
  res.cookie('editor', makeToken(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  res.json({ ok: true });
});

app.post('/api/editor/logout', (req, res) => {
  res.clearCookie('editor', { path: '/' });
  res.json({ ok: true });
});

// Checks the editor form fields. Returns { error } or { fields }.
function readWhisper(b) {
  b = b || {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const title = str(b.title);
  const suburb = str(b.suburb);
  const state = str(b.state).toUpperCase();
  const teaser = str(b.teaser);
  const body = str(b.body);
  const published_at = str(b.published_at) || todayBrisbane();

  if (!title || title.length > 80) return { error: 'Title: 1 to 80 characters' };
  if (!suburb || suburb.length > 80) return { error: 'Suburb: 1 to 80 characters' };
  if (!STATES.includes(state)) return { error: 'Pick a state' };
  if (!validDate(published_at)) return { error: 'Date is not valid' };
  if (!teaser || teaser.length > 400) return { error: 'Teaser: 1 to 400 characters' };
  if (!body || body.length > 4000) return { error: 'Popup text: 1 to 4000 characters' };
  return { fields: { title, suburb, state, published_at, teaser, body } };
}

app.put('/api/editor/whispers/:slug', requireEditor, async (req, res) => {
  if (!SLUG_RE.test(req.params.slug)) return res.status(404).json({ error: 'Not found' });
  const parsed = readWhisper(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  try {
    const updated = await db.update(req.params.slug, parsed.fields);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) { fail(res, err); }
});

app.post('/api/editor/whispers', requireEditor, async (req, res) => {
  const parsed = readWhisper(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { title, suburb, state, published_at, teaser, body } = parsed.fields;

  try {
    let created = null;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await db.insert({ slug: slugify(title), title, suburb, state, published_at, teaser, body });
      } catch (err) {
        if (err && err.code === '23505') continue; // slug clash, try again
        throw err;
      }
    }
    if (!created) throw new Error('Could not create a unique slug');
    res.status(201).json(created);
  } catch (err) { fail(res, err); }
});

app.delete('/api/editor/whispers/:slug', requireEditor, async (req, res) => {
  if (!SLUG_RE.test(req.params.slug)) return res.status(404).json({ error: 'Not found' });
  try {
    const removed = await db.remove(req.params.slug);
    if (!removed) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

app.get('/api/editor/leads', requireEditor, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await db.listLeads());
  } catch (err) { fail(res, err); }
});

app.delete('/api/editor/leads/:id', requireEditor, async (req, res) => {
  if (!/^\d{1,15}$/.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
  try {
    const removed = await db.removeLead(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

app.use((req, res) => res.status(404).type('text').send('Not found'));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`yorpaydyakunt listening on ${port}`));
}

module.exports = app;
