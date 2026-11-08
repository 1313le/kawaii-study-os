import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = 4300;
const VISITOR = 'v-metricsvisitor1';
let server;
let browser;
let base;
let root;
let notesDir;
let metricsFile;

const noteFile = (title) => `---\ntitle: ${title}\ndate: 2026-11-08\nkind: article\ncollection: 随笔\n---\n\n## 正文\n\n${title} 的测试正文。\n`;

const FIXTURE = {
  slug: 'metrics-a',
  title: 'Alpha 指标',
  date: '2026-11-08',
  kind: 'article',
  summary: '第一篇指标测试',
  tags: ['测试'],
  collection: '随笔',
  cover: '',
  accent: 'lime',
  fx: 'reveal',
  minutes: 1,
  words: 20,
  toc: [{ id: 'sec-1', text: '正文', depth: 2 }],
  source: '## 正文\n\nAlpha 的测试正文。\n',
  html: '<h2 id="sec-1">正文</h2><p>Alpha 的测试正文。</p>',
  text: '正文 Alpha 的测试正文',
  backlinks: []
};
const SECOND = {
  ...FIXTURE,
  slug: 'metrics-b',
  title: 'Beta 指标',
  summary: '第二篇指标测试',
  source: '## 正文\n\nBeta 的测试正文。\n',
  html: '<h2 id="sec-1">正文</h2><p>Beta 的测试正文。</p>',
  text: '正文 Beta 的测试正文'
};
const META = {
  count: 2,
  updated: '2026-11-08',
  tags: [{ name: '测试', count: 2 }],
  collections: [{ name: '随笔', count: 2 }]
};

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kawaii-metrics-'));
  notesDir = path.join(root, 'notes');
  metricsFile = path.join(root, 'metrics.json');
  fs.mkdirSync(notesDir);
  fs.writeFileSync(path.join(notesDir, 'metrics-a.md'), noteFile('Alpha 指标'));
  fs.writeFileSync(path.join(notesDir, 'metrics-b.md'), noteFile('Beta 指标'));
  fs.writeFileSync(metricsFile, JSON.stringify({ version: 1, notes: {} }));
  server = spawn(process.execPath, ['tools/serve.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(PORT),
      KAWAII_NOTES_DIR: notesDir,
      KAWAII_METRICS_FILE: metricsFile,
      KAWAII_AUTH: 'off',
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

const post = (route, payload) =>
  fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

test('views and reactions are counted once per visitor and persisted', async () => {
  const empty = await (await fetch(`${base}/api/metrics?visitor=${VISITOR}`)).json();
  assert.deepEqual(empty.notes, {});
  assert.equal(empty.totals.views, 0);

  const firstView = await (await post('/api/metrics/view', { slug: 'metrics-a' })).json();
  assert.equal(firstView.counts.views, 1);
  await post('/api/metrics/view', { slug: 'metrics-a' });

  const like = await (await post('/api/metrics/react', { slug: 'metrics-a', action: 'like', visitor: VISITOR, on: true })).json();
  assert.equal(like.counts.likes, 1);
  assert.equal(like.on, true);
  const again = await (await post('/api/metrics/react', { slug: 'metrics-a', action: 'like', visitor: VISITOR, on: true })).json();
  assert.equal(again.counts.likes, 1, 'the same visitor does not count twice');
  await post('/api/metrics/react', { slug: 'metrics-a', action: 'favorite', visitor: VISITOR, on: true });

  const view = await (await fetch(`${base}/api/metrics?visitor=${VISITOR}`)).json();
  assert.deepEqual(view.notes['metrics-a'], { views: 2, likes: 1, favorites: 1 });
  assert.deepEqual(view.mine['metrics-a'], { like: true, favorite: true });
  assert.equal(view.totals.likes, 1);

  const off = await (await post('/api/metrics/react', { slug: 'metrics-a', action: 'like', visitor: VISITOR, on: false })).json();
  assert.equal(off.counts.likes, 0);
  await post('/api/metrics/react', { slug: 'metrics-a', action: 'like', visitor: VISITOR, on: true });

  const saved = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));
  assert.equal(saved.notes['metrics-a'].views, 2);
  assert.deepEqual(saved.notes['metrics-a'].favoritedBy, [VISITOR]);

  assert.equal((await post('/api/metrics/react', { slug: 'metrics-a', action: 'clap', visitor: VISITOR, on: true })).status, 400);
  assert.equal((await post('/api/metrics/react', { slug: 'metrics-a', action: 'like', visitor: 'x', on: true })).status, 400);
  assert.equal((await post('/api/metrics/view', { slug: 'no-such-note' })).status, 404);
});

test('the note page shows live reactions and keeps them after reload', async () => {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: [{ origin: base, localStorage: [{ name: 'kawaii.skin.v1', value: 'pixel' }] }]
    }
  });
  await context.route('**/data/notes.generated.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript; charset=utf-8',
      body: `window.NOTES=${JSON.stringify([FIXTURE, SECOND])};\nwindow.NOTES_META=${JSON.stringify(META)};`
    })
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto('/note.html?slug=metrics-a');
    await page.waitForSelector('[data-note-reactions]');
    await page.waitForFunction(() => window.KawaiiMetrics && window.KawaiiMetrics.counts('metrics-a').views >= 3);
    assert.match(await page.textContent('[data-note-likes]'), /1/);
    assert.match(await page.textContent('[data-note-favorites]'), /1/);

    await page.click('[data-note-like]');
    await page.waitForFunction(() => document.querySelector('[data-note-like]').getAttribute('aria-pressed') === 'true');
    await page.waitForFunction(() => document.querySelector('[data-note-likes]').textContent.trim() === '2');
    await page.reload();
    await page.waitForSelector('[data-note-reactions]');
    await page.waitForFunction(() => document.querySelector('[data-note-like]').getAttribute('aria-pressed') === 'true');
    assert.equal(await page.textContent('[data-note-likes]'), '2', 'the visitor like survives a reload');
    assert.equal(await page.textContent('[data-note-favorites]'), '1');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('the article list sorts by views and highlights search hits', async () => {
  for (let index = 0; index < 4; index += 1) await post('/api/metrics/view', { slug: 'metrics-b' });
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: [{ origin: base, localStorage: [{ name: 'kawaii.skin.v1', value: 'pixel' }] }]
    }
  });
  await context.route('**/data/notes.generated.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript; charset=utf-8',
      body: `window.NOTES=${JSON.stringify([FIXTURE, SECOND])};\nwindow.NOTES_META=${JSON.stringify(META)};`
    })
  );
  const page = await context.newPage();
  try {
    await page.goto('/logs.html');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.note-card');
    await page.waitForFunction(() => window.KawaiiMetrics && window.KawaiiMetrics.counts('metrics-b').views >= 4);
    await page.click('[data-logs-tab="views"]');
    await page.waitForFunction(() => document.querySelector('.note-card__title').textContent.includes('Beta'));
    await page.fill('[data-logs-search]', 'Alpha');
    await page.waitForFunction(() => document.querySelectorAll('.note-card').length === 1);
    assert.equal(await page.locator('.note-card mark').first().textContent(), 'Alpha');
    assert.match(await page.url(), /q=Alpha/);
  } finally {
    await page.close();
    await context.close();
  }
});
