import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

let folder, app, origin;
before(() => { folder = mkdtempSync(join(tmpdir(), 'approvelink-')); });
beforeEach(async () => {
  app?.close();
  app = createApp({ dbPath: join(folder, `test-${Date.now()}-${Math.random()}.sqlite`) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => { app?.close(); rmSync(folder, { recursive: true, force: true }); });

const post = (path, values) => fetch(`${origin}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
async function createRequest(extra = {}) {
  const response = await post('/requests/new', { title: 'Homepage design', client: 'Acme', project: 'Website', deliverable: 'https://example.com/mockup', prompt: 'Does this meet the brief?', ...extra });
  assert.equal(response.status, 303, await response.text());
  const detailPath = response.headers.get('location');
  const detail = await fetch(`${origin}${detailPath}`);
  const html = await detail.text();
  const token = html.match(/\/a\/([A-Za-z0-9_-]{30,})/)?.[1];
  assert.ok(token, 'detail page includes a client link');
  return { detailPath, token, html };
}

test('health and request creation provide an isolated share link and creator detail', async () => {
  const health = await fetch(`${origin}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  const created = await createRequest();
  assert.match(created.html, /Homepage design/);
  assert.match(created.html, /waiting/);
  assert.match(created.html, /Pre-written message/);
  assert.equal((await fetch(`${origin}/a/not-a-real-secret-token-123456`)).status, 404);
  assert.equal((await fetch(`${origin}${created.detailPath}`)).status, 200);
});

test('reviewer approves, records identity and timestamp, and cannot resubmit', async () => {
  const { token, detailPath } = await createRequest();
  const response = await post(`/a/${token}`, { decision: 'approve', reviewer_name: 'Jordan Client', reviewer_email: 'jordan@example.com' });
  assert.equal(response.status, 303);
  const page = await fetch(`${origin}/a/${token}`);
  const html = await page.text();
  assert.match(html, /approved by Jordan Client/);
  assert.match(html, /closed/);
  const creator = await (await fetch(`${origin}${detailPath}`)).text();
  assert.match(creator, /Jordan Client \(jordan@example\.com\)/);
  assert.match(creator, /Timestamped approval summary/);
  assert.match(creator, /Audit timeline/);
  assert.equal((await post(`/a/${token}`, { decision: 'approve', reviewer_name: 'Other', reviewer_email: 'other@example.com' })).status, 409);
});

test('reviewer requests categorized changes with a required comment', async () => {
  const { token, detailPath } = await createRequest();
  const invalid = await post(`/a/${token}`, { decision: 'changes_requested', reviewer_name: 'Jordan', reviewer_email: 'jordan@example.com', revision_category: 'visual', revision_comment: '' });
  assert.equal(invalid.status, 400);
  const response = await post(`/a/${token}`, { decision: 'changes_requested', reviewer_name: 'Jordan', reviewer_email: 'jordan@example.com', revision_category: 'content', revision_comment: 'Please fix the headline typo.' });
  assert.equal(response.status, 303);
  const page = await (await fetch(`${origin}${detailPath}`)).text();
  assert.match(page, /changes requested/);
  assert.match(page, /content: Please fix the headline typo\./);
});

test('validates required fields and reviewer identity', async () => {
  const missing = await post('/requests/new', { title: '', client: 'Acme' });
  assert.equal(missing.status, 400);
  const { token } = await createRequest();
  const badEmail = await post(`/a/${token}`, { decision: 'approve', reviewer_name: 'Jordan', reviewer_email: 'not-email' });
  assert.equal(badEmail.status, 400);
  const badCategory = await post(`/a/${token}`, { decision: 'changes_requested', reviewer_name: 'Jordan', reviewer_email: 'jordan@example.com', revision_category: 'secret', revision_comment: 'Change it.' });
  assert.equal(badCategory.status, 400);
  assert.match(await (await fetch(`${origin}/a/${token}`)).text(), /reviewer_name/);
});

test('deadline expires a request and rejects later submissions', async () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const { token, detailPath } = await createRequest({ deadline: yesterday });
  const reviewer = await fetch(`${origin}/a/${token}`);
  assert.match(await reviewer.text(), /expired/);
  assert.equal((await post(`/a/${token}`, { decision: 'approve', reviewer_name: 'Jordan', reviewer_email: 'jordan@example.com' })).status, 409);
  assert.match(await (await fetch(`${origin}${detailPath}`)).text(), /expired/);
});

test('reapproval starts a new round while retaining prior audit events and data survives restart', async () => {
  const { token, detailPath } = await createRequest();
  await post(`/a/${token}`, { decision: 'approve', reviewer_name: 'Jordan', reviewer_email: 'jordan@example.com' });
  const reopened = await post(`${detailPath}/reapproval`, {});
  assert.equal(reopened.status, 303);
  let html = await (await fetch(`${origin}${detailPath}`)).text();
  assert.match(html, /Round 2/);
  assert.match(html, /Approved by Jordan/);
  assert.match(html, /reapproval/);
  const dbPath = join(folder, 'persist.sqlite');
  app.close();
  app = createApp({ dbPath });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${app.server.address().port}`;
  await post('/requests/new', { title: 'Persist me', client: 'Acme', project: 'Site', deliverable: 'Design', prompt: 'Ready?' });
  app.close();
  app = createApp({ dbPath });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${app.server.address().port}`;
  html = await (await fetch(`${origin}/`)).text();
  assert.match(html, /Persist me/);
});
