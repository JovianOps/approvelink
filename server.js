import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const categories = ['visual', 'content', 'scope', 'technical', 'other'];
const validStatuses = new Set(['waiting', 'approved', 'changes_requested', 'expired']);
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const formatDate = value => value ? new Date(value).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }) : 'No deadline';
const nowIso = () => new Date().toISOString();

export function createApp({ dbPath = resolve(here, 'approvelink.sqlite'), publicOrigin = '' } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL, client TEXT NOT NULL, project TEXT NOT NULL,
      deliverable TEXT NOT NULL, prompt TEXT NOT NULL, deadline TEXT,
      status TEXT NOT NULL DEFAULT 'waiting', archived INTEGER NOT NULL DEFAULT 0,
      round INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      reviewer_name TEXT, reviewer_email TEXT, decided_at TEXT,
      revision_comment TEXT, revision_category TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL REFERENCES requests(id),
      round INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL,
      actor TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_request_idx ON events(request_id, id);`);

  const addEvent = db.prepare('INSERT INTO events(request_id, round, kind, detail, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const byId = db.prepare('SELECT * FROM requests WHERE id = ?');
  const byToken = db.prepare('SELECT * FROM requests WHERE token = ?');
  const eventRows = db.prepare('SELECT * FROM events WHERE request_id = ? ORDER BY id');
  const expireIfNeeded = request => {
    if (request && request.status === 'waiting' && request.deadline && new Date(request.deadline).getTime() <= Date.now()) {
      db.prepare("UPDATE requests SET status = 'expired' WHERE id = ? AND status = 'waiting'").run(request.id);
      addEvent.run(request.id, request.round, 'expired', 'The deadline passed without a decision.', 'System', nowIso());
      return byId.get(request.id);
    }
    return request;
  };
  const base = `
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#172033;background:#f5f7fb;font-synthesis:none}
    *{box-sizing:border-box}body{margin:0}a{color:#2563eb}button,.button{font:inherit}header{background:#fff;border-bottom:1px solid #e4e8f0}
    .nav,.wrap{max-width:1040px;margin:auto;padding:18px 22px}.nav{display:flex;align-items:center;justify-content:space-between}.brand{font-size:20px;font-weight:800;letter-spacing:-.04em;color:#18243a;text-decoration:none}
    .wrap{padding-top:34px;padding-bottom:60px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#62708a;font-weight:750}.title{font-size:clamp(28px,5vw,40px);line-height:1.08;letter-spacing:-.04em;margin:8px 0 10px}.muted{color:#63708a;line-height:1.6}.card{background:white;border:1px solid #e1e6ef;border-radius:16px;padding:22px;box-shadow:0 8px 24px #2639580a;margin-top:18px}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.stats{display:flex;gap:10px;flex-wrap:wrap}.pill,.status{display:inline-flex;align-items:center;border-radius:999px;padding:6px 11px;font-size:12px;font-weight:750;background:#edf1f7;color:#4c5b73}.status-approved{background:#e5f7ed;color:#177245}.status-changes_requested{background:#fff3dc;color:#96600a}.status-expired{background:#ffebeb;color:#ae3030}
    label{display:block;font-size:13px;font-weight:700;margin:16px 0 7px}input,textarea,select{width:100%;border:1px solid #ccd4e1;border-radius:10px;background:#fff;padding:12px 13px;font:inherit;color:#172033}textarea{min-height:110px;resize:vertical}input:focus,textarea:focus,select:focus,button:focus-visible,a:focus-visible{outline:3px solid #b9d2ff;outline-offset:2px}.help{font-size:12px;color:#71809a;margin-top:6px}
    .btn{display:inline-flex;justify-content:center;align-items:center;border:0;border-radius:10px;background:#315ff4;color:white;font-weight:750;text-decoration:none;padding:12px 18px;min-height:44px;cursor:pointer}.btn:hover{background:#214dde}.btn.secondary{background:#eef2f8;color:#263650}.btn.danger{background:#a52c36}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.row{display:flex;justify-content:space-between;gap:14px;align-items:center}.list{display:grid;gap:12px;margin-top:20px}.request{padding:17px;border:1px solid #e1e6ef;border-radius:13px;background:#fff;display:flex;justify-content:space-between;gap:12px;align-items:center}.request a{text-decoration:none;font-weight:750;color:#172033}.request p{margin:6px 0 0;font-size:13px;color:#687690}.copybox{background:#f6f8fc;border:1px solid #e1e6ef;padding:14px;border-radius:12px;white-space:pre-wrap;line-height:1.55;overflow-wrap:anywhere}.timeline{list-style:none;padding:0;margin:0}.timeline li{padding:13px 0;border-bottom:1px solid #edf0f5}.timeline li:last-child{border:0}.timeline time{display:block;color:#70809a;font-size:12px;margin-bottom:4px}.detail{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start}.deliverable{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65}.client-actions{display:grid;grid-template-columns:1fr 1fr;gap:12px}.client-actions .btn{width:100%}.notice{padding:13px 15px;border-radius:11px;background:#eef3ff;color:#324a7d;line-height:1.5}.error{background:#fff0f0;color:#9b2933;border:1px solid #f3cbce;padding:12px 14px;border-radius:10px;margin:14px 0}
    @media(max-width:650px){.wrap{padding:24px 16px 42px}.nav{padding:14px 16px}.grid{grid-template-columns:1fr}.card{padding:17px}.request{align-items:flex-start}.client-actions{grid-template-columns:1fr}.row{align-items:flex-start}}
  </style>`;
  const layout = (title, body, { publicPage = false } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#f5f7fb"><title>${escapeHtml(title)} · ApproveLink</title>${base}</head><body>${publicPage ? '' : `<header><div class="nav"><a class="brand" href="/">ApproveLink</a><a href="/requests/new">New request</a></div></header>`}${body}</body></html>`;
  const status = value => `<span class="status status-${escapeHtml(value)}">${escapeHtml(value.replace('_', ' '))}</span>`;
  const creatorUrl = (token, requestOrigin = '') => `${(publicOrigin || requestOrigin).replace(/\/$/, '')}/a/${token}`;
  const shareCopy = (r, requestOrigin) => `Hi ${r.client},\n\nCould you review “${r.title}” for ${r.project}? ${creatorUrl(r.token, requestOrigin)}\n\n${r.prompt}${r.deadline ? `\nPlease respond by ${formatDate(r.deadline)}.` : ''}`;
  const pageError = (message, back = '/') => layout('Something needs fixing', `<main class="wrap"><div class="card"><h1 class="title">We couldn’t complete that</h1><p class="error">${escapeHtml(message)}</p><a class="btn secondary" href="${back}">Go back</a></div></main>`);
  const send = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(body); };
  const redirect = (res, path) => { res.writeHead(303, { location: path }); res.end(); };
  const readForm = req => new Promise((resolveForm, reject) => {
    let data = ''; req.on('data', chunk => { data += chunk; if (data.length > 32_768) { reject(new Error('Form is too large.')); req.destroy(); } });
    req.on('end', () => { try { resolveForm(Object.fromEntries(new URLSearchParams(data))); } catch (e) { reject(e); } }); req.on('error', reject);
  });
  const detail = (req, requestOrigin) => {
    req = expireIfNeeded(req);
    const share = creatorUrl(req.token, requestOrigin);
    const events = eventRows.all(req.id).map(e => `<li><time>${escapeHtml(formatDate(e.created_at))} · Round ${e.round}</time><strong>${escapeHtml(e.kind.replaceAll('_', ' '))}</strong> — ${escapeHtml(e.detail)} <span class="muted">by ${escapeHtml(e.actor)}</span></li>`).join('');
    const summary = req.status === 'approved' ? `Approved by ${req.reviewer_name} (${req.reviewer_email}) on ${formatDate(req.decided_at)}.` : '';
    const body = `<main class="wrap"><div class="eyebrow">Creator view · Round ${req.round}</div><div class="detail"><div><h1 class="title">${escapeHtml(req.title)}</h1><p class="muted">${escapeHtml(req.client)} · ${escapeHtml(req.project)}</p></div>${status(req.status)}</div>
      <section class="card"><div class="grid"><div><div class="eyebrow">Decision prompt</div><p>${escapeHtml(req.prompt)}</p></div><div><div class="eyebrow">Deadline</div><p>${escapeHtml(formatDate(req.deadline))}</p></div></div><div class="eyebrow">Deliverable</div><p class="deliverable">${escapeHtml(req.deliverable)}</p></section>
      <section class="card"><h2>Share this review</h2><p class="muted">Send the private link to your client.</p><div class="copybox" id="share">${escapeHtml(share)}</div><div class="actions"><button class="btn" onclick="navigator.clipboard.writeText(document.querySelector('#share').textContent)">Copy link</button></div><label>Pre-written message</label><div class="copybox" id="message">${escapeHtml(shareCopy(req, requestOrigin))}</div><div class="actions"><button class="btn secondary" onclick="navigator.clipboard.writeText(document.querySelector('#message').textContent)">Copy message</button></div>${summary ? `<label>Timestamped approval summary</label><div class="copybox" id="summary">${escapeHtml(summary)}</div><div class="actions"><button class="btn secondary" onclick="navigator.clipboard.writeText(document.querySelector('#summary').textContent)">Copy summary</button></div>` : ''}</section>
      <section class="card"><div class="row"><h2>Audit timeline</h2><span class="muted">Created ${escapeHtml(formatDate(req.created_at))}</span></div><ul class="timeline">${events || '<li class="muted">No activity yet.</li>'}</ul></section>
      <section class="card"><div class="actions">${req.status !== 'waiting' && req.status !== 'expired' ? `<form method="post" action="/requests/${req.id}/reapproval"><button class="btn" type="submit">Request a new review round</button></form>` : ''}${!req.archived ? `<form method="post" action="/requests/${req.id}/archive"><button class="btn secondary" type="submit">Archive request</button></form>` : '<span class="pill">Archived</span>'}</div></section></main>`;
    return layout(req.title, body);
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = decodeURIComponent(url.pathname);
      if (req.method === 'GET' && path === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return; }
      if (req.method === 'GET' && path === '/') {
        const rows = db.prepare('SELECT * FROM requests ORDER BY archived ASC, created_at DESC').all().map(expireIfNeeded);
        const renderList = (items, empty) => items.length ? `<div class="list">${items.map(r => `<article class="request"><div><a href="/requests/${r.id}">${escapeHtml(r.title)}</a><p>${escapeHtml(r.client)} · ${escapeHtml(r.project)} · ${escapeHtml(formatDate(r.deadline))}</p></div><div>${status(r.status)}</div></article>`).join('')}</div>` : `<p class="muted">${empty}</p>`;
        const body = `<main class="wrap"><div class="eyebrow">Freelancer approvals</div><div class="row"><div><h1 class="title">Your approval requests</h1><p class="muted">One clear decision, with a timestamped trail.</p></div><a class="btn" href="/requests/new">Create request</a></div><section class="card"><h2>Active</h2>${renderList(rows.filter(r => !r.archived), 'Your active requests will appear here.')}</section><section class="card"><h2>Archived</h2>${renderList(rows.filter(r => r.archived), 'No archived requests.')}</section></main>`;
        send(res, 200, layout('Requests', body)); return;
      }
      if (req.method === 'GET' && path === '/requests/new') {
        const body = `<main class="wrap"><div class="eyebrow">New approval request</div><h1 class="title">Make the next step clear.</h1><p class="muted">Your client can approve or send structured revision notes without creating an account.</p><form class="card" method="post" action="/requests/new"><div class="grid"><div><label for="title">Milestone or deliverable title *</label><input id="title" name="title" required maxlength="120"></div><div><label for="client">Client name *</label><input id="client" name="client" required maxlength="100"></div><div><label for="project">Project name *</label><input id="project" name="project" required maxlength="100"></div><div><label for="deadline">Optional deadline</label><input id="deadline" name="deadline" type="date"></div></div><label for="deliverable">Deliverable link or description *</label><textarea id="deliverable" name="deliverable" required maxlength="5000" placeholder="Paste a link or describe what is ready for review"></textarea><label for="prompt">Decision prompt *</label><input id="prompt" name="prompt" required maxlength="240" value="Does this deliverable meet the agreed brief?"><p class="help">The link is private to anyone you share it with. No client account required.</p><div class="actions"><button class="btn" type="submit">Create approval link</button><a class="btn secondary" href="/">Cancel</a></div></form></main>`;
        send(res, 200, layout('New request', body)); return;
      }
      if (req.method === 'POST' && path === '/requests/new') {
        const f = await readForm(req);
        const fields = ['title', 'client', 'project', 'deliverable', 'prompt'];
        if (fields.some(k => !f[k]?.trim()) || fields.some(k => f[k].length > ({ title: 120, client: 100, project: 100, deliverable: 5000, prompt: 240 }[k]))) { send(res, 400, pageError('Fill in every required field and stay within the character limits.', '/requests/new')); return; }
        let deadline = null;
        if (f.deadline) { const d = new Date(`${f.deadline}T23:59:59.999Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(f.deadline) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== f.deadline) { send(res, 400, pageError('Enter a valid deadline date.', '/requests/new')); return; } deadline = d.toISOString(); }
        const id = randomUUID(), token = randomBytes(32).toString('base64url'), created = nowIso();
        db.prepare('INSERT INTO requests(id, token, title, client, project, deliverable, prompt, deadline, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, token, ...fields.map(k => f[k].trim()), deadline, created);
        addEvent.run(id, 1, 'created', 'Approval request created.', 'Creator', created);
        redirect(res, `/requests/${id}`); return;
      }
      const detailMatch = path.match(/^\/requests\/([0-9a-f-]+)$/i);
      if (req.method === 'GET' && detailMatch) { const r = byId.get(detailMatch[1]); if (!r) { send(res, 404, pageError('That request was not found.')); return; } const proto = req.socket.encrypted ? 'https' : 'http'; send(res, 200, detail(r, `${proto}://${req.headers.host}`)); return; }
      const actionMatch = path.match(/^\/requests\/([0-9a-f-]+)\/(archive|reapproval)$/i);
      if (req.method === 'POST' && actionMatch) {
        const r = byId.get(actionMatch[1]); if (!r) { send(res, 404, pageError('That request was not found.')); return; }
        const action = actionMatch[2];
        if (action === 'archive') { db.prepare('UPDATE requests SET archived = 1 WHERE id = ?').run(r.id); addEvent.run(r.id, r.round, 'archived', 'Request archived.', 'Creator', nowIso()); }
        if (action === 'reapproval') {
          const current = expireIfNeeded(r);
          if (!['approved', 'changes_requested'].includes(current.status)) { send(res, 409, pageError('Only a completed review can start a new round.', `/requests/${r.id}`)); return; }
          const round = current.round + 1, at = nowIso();
          db.prepare("UPDATE requests SET status = 'waiting', round = ?, reviewer_name = NULL, reviewer_email = NULL, decided_at = NULL, revision_comment = NULL, revision_category = NULL WHERE id = ?").run(round, r.id);
          addEvent.run(r.id, round, 'reapproval', `Review reopened for round ${round}.`, 'Creator', at);
        }
        redirect(res, `/requests/${r.id}`); return;
      }
      const clientMatch = path.match(/^\/a\/([A-Za-z0-9_-]{20,})$/);
      if (req.method === 'GET' && clientMatch) {
        const r = expireIfNeeded(byToken.get(clientMatch[1]));
        if (!r) { send(res, 404, layout('Link unavailable', '<main class="wrap"><section class="card"><h1 class="title">This review link is unavailable</h1><p class="muted">Check that you have the complete link from the project creator.</p></section></main>', { publicPage: true })); return; }
        const terminal = r.status !== 'waiting';
        const body = `<main class="wrap" style="max-width:760px"><a class="brand" href="/">ApproveLink</a><section class="card"><div class="eyebrow">${escapeHtml(r.client)} · ${escapeHtml(r.project)}</div><h1 class="title">${escapeHtml(r.title)}</h1><p class="muted">Review round ${r.round}${r.deadline ? ` · Due ${escapeHtml(formatDate(r.deadline))}` : ''}</p><div class="notice">${escapeHtml(r.prompt)}</div><h2 style="margin-top:24px">Deliverable</h2><div class="deliverable">${escapeHtml(r.deliverable)}</div>${terminal ? `<div class="error" style="margin-top:22px">This review is ${escapeHtml(r.status.replace('_', ' '))}${r.status === 'approved' ? ` by ${escapeHtml(r.reviewer_name)} on ${escapeHtml(formatDate(r.decided_at))}` : ''}. New responses are closed.</div>` : `<form method="post" action="/a/${r.token}" style="margin-top:22px"><label for="reviewer_name">Your name *</label><input id="reviewer_name" name="reviewer_name" required maxlength="100" autocomplete="name"><label for="reviewer_email">Your email *</label><input id="reviewer_email" name="reviewer_email" required maxlength="254" type="email" autocomplete="email"><div class="client-actions" style="margin-top:20px"><button class="btn" type="submit" name="decision" value="approve" onclick="return confirm('Approve this deliverable? This records your decision and closes this review round.')">Approve deliverable</button><button class="btn secondary" type="button" onclick="document.querySelector('#change-fields').hidden=false;document.querySelector('#revision_category').required=true;document.querySelector('#revision_comment').required=true;document.querySelector('#revision_comment').focus()">Request changes</button></div><div id="change-fields" hidden><label for="revision_category">What kind of changes? *</label><select id="revision_category" name="revision_category"><option value="">Choose a category</option>${categories.map(c => `<option value="${c}">${c[0].toUpperCase() + c.slice(1)}</option>`).join('')}</select><label for="revision_comment">Changes needed *</label><textarea id="revision_comment" name="revision_comment" maxlength="2000" placeholder="Describe what should change"></textarea><div class="actions"><button class="btn" type="submit" name="decision" value="changes_requested" onclick="return confirm('Send these revision notes to the creator?')">Send revision request</button></div></div></form>`}</section><p class="muted" style="text-align:center;font-size:12px">A private, no-account approval link.</p></main>`;
        send(res, 200, layout(r.title, body, { publicPage: true })); return;
      }
      const submitMatch = path.match(/^\/a\/([A-Za-z0-9_-]{20,})$/);
      if (req.method === 'POST' && submitMatch) {
        const f = await readForm(req), r = expireIfNeeded(byToken.get(submitMatch[1]));
        if (!r) { send(res, 404, layout('Link unavailable', '<main class="wrap"><section class="card"><h1>This review link is unavailable</h1></section></main>', { publicPage: true })); return; }
        if (r.status !== 'waiting') { send(res, 409, layout(r.title, `<main class="wrap"><section class="card"><h1 class="title">This review is closed</h1><p class="muted">The current status is ${escapeHtml(r.status)}. No new response was recorded.</p></section></main>`, { publicPage: true })); return; }
        const name = (f.reviewer_name || '').trim(), email = (f.reviewer_email || '').trim();
        if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) { send(res, 400, pageError('Enter a valid name and email address.', `/a/${r.token}`)); return; }
        const at = nowIso();
        if (f.decision === 'approve') {
          const result = db.prepare("UPDATE requests SET status = 'approved', reviewer_name = ?, reviewer_email = ?, decided_at = ? WHERE id = ? AND status = 'waiting' AND (deadline IS NULL OR deadline > ?)").run(name, email, at, r.id, at);
          if (!result.changes) { send(res, 409, pageError('This review has already closed.', `/a/${r.token}`)); return; }
          addEvent.run(r.id, r.round, 'approved', `Approved by ${name} (${email}).`, name, at);
        } else if (f.decision === 'changes_requested') {
          const comment = (f.revision_comment || '').trim(), category = f.revision_category;
          if (!comment || comment.length > 2000 || !categories.includes(category)) { send(res, 400, pageError('Choose a revision category and explain the requested changes.', `/a/${r.token}`)); return; }
          const result = db.prepare("UPDATE requests SET status = 'changes_requested', reviewer_name = ?, reviewer_email = ?, decided_at = ?, revision_comment = ?, revision_category = ? WHERE id = ? AND status = 'waiting' AND (deadline IS NULL OR deadline > ?)").run(name, email, at, comment, category, r.id, at);
          if (!result.changes) { send(res, 409, pageError('This review has already closed.', `/a/${r.token}`)); return; }
          addEvent.run(r.id, r.round, 'changes_requested', `${category}: ${comment}`, name, at);
        } else { send(res, 400, pageError('Choose approve or request changes.', `/a/${r.token}`)); return; }
        redirect(res, `/a/${r.token}`); return;
      }
      send(res, 404, pageError('Page not found.'));
    } catch (error) {
      if (!res.headersSent) send(res, 500, pageError('An unexpected server error occurred.'));
      console.error(error);
    }
  });
  return { server, db, close: () => { server.close(); db.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp({ dbPath: process.env.DB_PATH || resolve(here, 'approvelink.sqlite'), publicOrigin: process.env.PUBLIC_ORIGIN || '' });
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, () => console.log(`ApproveLink running at http://localhost:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close());
}
