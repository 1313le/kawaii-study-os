import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = 4299;
const PASSWORD = 'kawaii-test-123';
let server;
let browser;
let base;
let root;
let notesDir;
let assetDir;
let authFile;
let resourcesFile;
let undoFile;
let filesDir;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kawaii-auth-'));
  notesDir = path.join(root, 'notes');
  assetDir = path.join(root, 'assets');
  authFile = path.join(root, 'auth.json');
  resourcesFile = path.join(root, 'resources.json');
  undoFile = path.join(root, 'undo.json');
  filesDir = path.join(root, 'files');
  fs.mkdirSync(notesDir);
  fs.mkdirSync(assetDir);
  fs.writeFileSync(resourcesFile, JSON.stringify({ version: 1, categories: [], items: [] }));
  server = spawn(process.execPath, ['tools/serve.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(PORT),
      KAWAII_NOTES_DIR: notesDir,
      KAWAII_ASSET_DIR: assetDir,
      KAWAII_RESOURCES_FILE: resourcesFile,
      KAWAII_UNDO_FILE: undoFile,
      KAWAII_FILES_DIR: filesDir,
      KAWAII_AUTH_FILE: authFile,
      KAWAII_AUTH_LOCK_MS: '700',
      KAWAII_NO_BUILD: '1'
    },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  base = await new Promise((resolve, reject) => {
    server.stdout.on('data', (data) => {
      const found = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (found) resolve(found[0]);
    });
    server.on('exit', (code) => reject(new Error(`serve exited ${code}`)));
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});

after(async () => {
  await browser?.close();
  server?.kill();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

const json = (url, payload, headers = {}) =>
  fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload)
  });

function cookieFrom(response) {
  const raw = response.headers.get('set-cookie') || '';
  return raw.split(';')[0];
}

function solve(question) {
  const match = String(question).match(/(\d+)\s*\+\s*(\d+)/);
  return match ? String(Number(match[1]) + Number(match[2])) : '';
}

test('write routes stay closed until the author password is set', async () => {
  const status = await (await fetch(`${base}/api/auth/status`)).json();
  assert.equal(status.enabled, true);
  assert.equal(status.configured, false);
  assert.equal(status.authed, false);
  assert.equal(status.needsSetupCode, false, 'loopback setup needs no console code');

  const save = await json('/api/note/save', { slug: 'blocked', meta: { title: 'x', date: '2026-11-08' }, body: 'x\n' });
  assert.equal(save.status, 401);
  assert.equal((await save.json()).code, 'setup');
  for (const [route, payload] of [
    ['/api/asset', { name: 'x', dataUrl: 'data:image/png;base64,AA==' }],
    ['/api/taxonomy', { action: 'rename', kind: 'tag', from: 'a', to: 'b' }],
    ['/api/resources', { action: 'add', title: 'x', url: 'https://example.com' }]
  ]) {
    const response = await json(route, payload);
    assert.equal(response.status, 401, route);
  }
  const upload = await fetch(`${base}/api/resources/upload`, {
    method: 'POST',
    headers: { 'X-Kawaii-Upload': '1', 'X-File-Name': 'x.pdf', 'Content-Type': 'application/pdf' },
    body: Buffer.from('%PDF-1.4')
  });
  assert.equal(upload.status, 401);
  assert.equal((await fetch(`${base}/api/notes`)).status, 401, 'the note index is author-only');
  assert.equal((await fetch(`${base}/api/note?slug=anything`)).status, 401, 'raw markdown is author-only');
  assert.equal(fs.existsSync(authFile), false);
});

test('setup stores a hash, sets an HttpOnly session and unlocks writes', async () => {
  const weak = await json('/api/auth/setup', { password: 'short', confirm: 'short' });
  assert.equal(weak.status, 400);
  const mismatch = await json('/api/auth/setup', { password: PASSWORD, confirm: `${PASSWORD}x` });
  assert.equal(mismatch.status, 400);

  const setup = await json('/api/auth/setup', { password: PASSWORD, confirm: PASSWORD });
  assert.equal(setup.status, 200);
  const cookieHeader = setup.headers.get('set-cookie') || '';
  assert.match(cookieHeader, /kawaii_auth=/);
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Strict/i);
  const cookie = cookieFrom(setup);
  const stored = JSON.parse(fs.readFileSync(authFile, 'utf8'));
  assert.ok(stored.hash && stored.salt && stored.secret);
  assert.ok(!JSON.stringify(stored).includes(PASSWORD), 'the password never lands in the file');

  const status = await (await fetch(`${base}/api/auth/status`, { headers: { Cookie: cookie } })).json();
  assert.equal(status.configured, true);
  assert.equal(status.authed, true);

  const save = await json('/api/note/save', { slug: 'authorized', meta: { title: '受保护的文章', date: '2026-11-08' }, body: '正文\n' }, { Cookie: cookie });
  assert.equal(save.status, 200);
  assert.ok(fs.existsSync(path.join(notesDir, 'authorized.md')));
  const list = await fetch(`${base}/api/notes`, { headers: { Cookie: cookie } });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).notes[0].slug, 'authorized');
  const raw = await fetch(`${base}/api/note?slug=authorized`, { headers: { Cookie: cookie } });
  assert.equal(raw.status, 200);
  assert.equal((await raw.json()).body, '正文\n');

  const tampered = cookie.replace(/.$/, (char) => (char === 'a' ? 'b' : 'a'));
  const denied = await json('/api/note/save', { slug: 'tampered', meta: { title: 'x', date: '2026-11-08' }, body: 'x\n' }, { Cookie: tampered });
  assert.equal(denied.status, 401);
});

test('login needs a fresh challenge, locks after repeated failures and clears on logout', async () => {
  const challenge = await (await fetch(`${base}/api/auth/challenge`)).json();
  assert.match(challenge.question, /^\d+ \+ \d+ = \?$/);
  const wrong = await json('/api/auth/login', { password: PASSWORD, challengeId: challenge.id, answer: '99' });
  assert.equal(wrong.status, 400);
  assert.equal((await wrong.json()).code, 'challenge');

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const fresh = await (await fetch(`${base}/api/auth/challenge`)).json();
    const response = await json('/api/auth/login', {
      password: 'wrong-password',
      challengeId: fresh.id,
      answer: solve(fresh.question)
    });
    assert.equal(response.status, 401);
  }
  const locked = await json('/api/auth/login', { password: PASSWORD, challengeId: 'x', answer: '1' });
  assert.equal(locked.status, 429);

  await new Promise((resolve) => setTimeout(resolve, 800));
  const fresh = await (await fetch(`${base}/api/auth/challenge`)).json();
  const login = await json('/api/auth/login', { password: PASSWORD, challengeId: fresh.id, answer: solve(fresh.question) });
  assert.equal(login.status, 200);
  const cookie = cookieFrom(login);

  const logout = await json('/api/auth/logout', {}, { Cookie: cookie });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie') || '', /Max-Age=0/);

  const foreign = await json('/api/auth/login', { password: PASSWORD, challengeId: fresh.id, answer: solve(fresh.question) }, { Origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
});

test('the write page walks through setup, saving, locking and login', async () => {
  fs.rmSync(authFile, { force: true });
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto('/write.html');
    await page.waitForSelector('dialog.auth[open]');
    assert.match(await page.textContent('[data-auth-title]'), /设置作者密码/);

    await page.fill('[data-auth-password]', PASSWORD);
    await page.fill('[data-auth-confirm]', PASSWORD);
    await page.click('[data-auth-submit]');
    await page.waitForFunction(() => !document.querySelector('dialog.auth')?.open);
    assert.equal(await page.evaluate(() => window.KawaiiAuth.status().authed), true);
    assert.match(await page.textContent('.auth-chip'), /已登录/);

    await page.fill('[data-meta="title"]', '受保护的文章');
    await page.fill('[data-meta="slug"]', 'guarded-note');
    await page.fill('#write-screen', '## 只有作者能写\n\n这段不会让访客保存。\n');
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => /已保存/.test(document.querySelector('[data-write-saved]').textContent));
    assert.ok(fs.existsSync(path.join(notesDir, 'guarded-note.md')));

    await page.reload();
    await page.waitForSelector('#write-screen');
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.querySelector('dialog.auth')?.open || false), false, 'the cookie keeps the desk unlocked');
    assert.match(await page.textContent('.auth-chip'), /已登录/);

    await page.click('.auth-chip');
    assert.match(await page.textContent('.auth-chip'), /确认退出/);
    await page.click('.auth-chip');
    await page.waitForSelector('dialog.auth[open]');
    assert.equal(await page.evaluate(() => window.KawaiiAuth.status().authed), false);
    assert.match(await page.textContent('[data-auth-title]'), /作者登录/);

    await page.fill('[data-auth-password]', 'wrong-password');
    await page.fill('[data-auth-answer]', solve(await page.textContent('[data-auth-question]')));
    await page.click('[data-auth-submit]');
    await page.waitForFunction(() => /密码不正确/.test(document.querySelector('[data-auth-error]').textContent));
    const freshQuestion = await page.textContent('[data-auth-question]');
    await page.fill('[data-auth-password]', PASSWORD);
    await page.fill('[data-auth-answer]', solve(freshQuestion));
    await page.click('[data-auth-submit]');
    await page.waitForFunction(() => !document.querySelector('dialog.auth')?.open);
    assert.equal(await page.evaluate(() => window.KawaiiAuth.status().authed), true);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});
