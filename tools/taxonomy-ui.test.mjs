import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { composeNote } from './note-store.js';

const PORT = 4294;
let server;
let browser;
let base;
let root;
let notesDir;
let undoPath;

const NOTES = [
  { slug: 'alpha', title: '电路分析笔记', collection: '电子基础', tags: ['电路', 'KVL'] },
  { slug: 'beta', title: '工具链笔记', collection: '电子基础', tags: ['电路', '工具'] },
  { slug: 'gamma', title: '周末散步', collection: '随笔', tags: ['生活'] }
].map((note) => ({
  ...note,
  date: '2026-11-08',
  kind: 'article',
  summary: `${note.title} 摘要`,
  cover: '',
  accent: 'lime',
  fx: 'reveal',
  minutes: 2,
  words: 100,
  toc: [],
  html: `<p>${note.title}</p>`,
  text: note.title,
  backlinks: []
}));

const META = {
  count: NOTES.length,
  updated: '2026-11-08',
  tags: [
    { name: '电路', count: 2 },
    { name: 'KVL', count: 1 },
    { name: '工具', count: 1 },
    { name: '生活', count: 1 }
  ],
  collections: [
    { name: '电子基础', count: 2 },
    { name: '随笔', count: 1 }
  ]
};

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kawaii-taxonomy-ui-'));
  notesDir = path.join(root, 'notes');
  undoPath = path.join(root, 'undo.json');
  fs.mkdirSync(notesDir);
  for (const note of NOTES) {
    fs.writeFileSync(
      path.join(notesDir, `${note.slug}.md`),
      composeNote({
        meta: {
          title: note.title,
          date: note.date,
          kind: note.kind,
          summary: note.summary,
          tags: note.tags,
          collection: note.collection,
          accent: note.accent,
          fx: note.fx
        },
        body: `## ${note.title}\n\n正文。\n`
      }),
      'utf8'
    );
  }
  server = spawn(process.execPath, ['tools/serve.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(PORT),
      KAWAII_NOTES_DIR: notesDir,
      KAWAII_UNDO_FILE: undoPath,
      KAWAII_NO_BUILD: '1', KAWAII_AUTH: 'off'
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

async function openLogs() {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: [{ origin: base, localStorage: [{ name: 'kawaii.skin.v1', value: 'pixel' }] }]
    },
  });
  await context.route('**/data/notes.generated.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript; charset=utf-8',
      body: `window.NOTES=${JSON.stringify(NOTES)};\nwindow.NOTES_META=${JSON.stringify(META)};`
    })
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('/logs.html');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.note-card');
  return { page, context, errors };
}

async function openManager(page) {
  await page.click('[data-taxonomy-open]');
  await page.waitForSelector('#taxonomy-dialog[open]');
  await page.waitForFunction(() => document.querySelectorAll('[data-taxonomy-list] .taxonomy__row').length > 0);
}

async function waitReload(page) {
  await page.waitForTimeout(950);
  await page.waitForSelector('.note-card');
}

test('tag chips combine with AND and switch to OR, and the view survives in the URL', async () => {
  const { page, context, errors } = await openLogs();
  try {
    assert.equal(await page.locator('.note-card').count(), 3);

    await page.click('[data-logs-filters] [data-tag="电路"]');
    await page.waitForFunction(() => document.querySelectorAll('.note-card').length === 2);
    assert.equal(await page.locator('[data-logs-tagmode]').isVisible(), false, 'one tag needs no mode switch');

    await page.click('[data-logs-filters] [data-tag="KVL"]');
    await page.waitForFunction(() => document.querySelectorAll('.note-card').length === 1);
    assert.match(await page.url(), /tags=%E7%94%B5%E8%B7%AF%2CKVL/, 'both tags are in the URL');
    assert.equal(await page.getAttribute('[data-tagmode="and"]', 'aria-pressed'), 'true');

    await page.click('[data-logs-tagmode] [data-tagmode="or"]');
    await page.waitForFunction(() => document.querySelectorAll('.note-card').length === 2);
    assert.match(await page.url(), /tagmode=or/);
    assert.equal(await page.getAttribute('[data-tagmode="or"]', 'aria-pressed'), 'true');

    await page.click('[data-logs-filters] [data-tag=""]');
    await page.waitForFunction(() => document.querySelectorAll('.note-card').length === 3);
    assert.doesNotMatch(await page.url(), /tags=/);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('the manager renames a collection in place, and one undo brings it back', async () => {
  const { page, context, errors } = await openLogs();
  try {
    await openManager(page);
    assert.equal(await page.locator('.taxonomy__row').count(), 2, 'two collections');
    assert.equal(await page.textContent('[data-taxonomy-tab-count="collection"]'), '2');
    assert.equal(await page.textContent('[data-taxonomy-tab-count="tag"]'), '4');

    await page.click('[data-taxonomy-tab="tag"]');
    await page.waitForFunction(() => document.querySelectorAll('.taxonomy__row').length === 4);
    await page.click('[data-taxonomy-tab="collection"]');
    await page.waitForFunction(() => document.querySelectorAll('.taxonomy__row').length === 2);

    await page.click('.taxonomy__row[data-row-name="电子基础"] [data-taxonomy-rename]');
    const input = page.locator('.taxonomy__row[data-row-name="电子基础"] [data-rename-input]');
    await input.fill('电子学');
    await page.click('[data-rename-save]');
    await page.waitForFunction(() => /已更新/.test(document.querySelector('[data-taxonomy-status]').textContent));
    await waitReload(page);
    assert.ok(fs.readFileSync(path.join(notesDir, 'alpha.md'), 'utf8').includes('collection: 电子学'));

    await openManager(page);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.taxonomy__name')].some((node) => node.textContent === '电子学'));
    assert.equal(await page.locator('.taxonomy__row').count(), 2, 'rename keeps the collection count');

    await page.click('[data-taxonomy-undo]');
    await page.waitForFunction(() => /已撤销/.test(document.querySelector('[data-taxonomy-status]').textContent));
    await waitReload(page);
    assert.ok(fs.readFileSync(path.join(notesDir, 'alpha.md'), 'utf8').includes('collection: 电子基础'));

    await openManager(page);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.taxonomy__name')].some((node) => node.textContent === '电子基础'));
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('deleting a tag asks first, strips it, and undo restores it', async () => {
  const { page, context, errors } = await openLogs();
  try {
    await openManager(page);
    await page.click('[data-taxonomy-tab="tag"]');
    await page.waitForFunction(() => document.querySelectorAll('.taxonomy__row').length === 4);

    await page.click('.taxonomy__row[data-row-name="生活"] [data-taxonomy-delete]');
    assert.match(await page.textContent('.taxonomy__row[data-row-name="生活"] .taxonomy__warn'), /移除这个标签/);
    assert.equal(fs.readFileSync(path.join(notesDir, 'gamma.md'), 'utf8').includes('生活'), true, 'nothing is deleted before confirmation');

    await page.click('[data-delete-confirm]');
    await page.waitForFunction(() => /已更新/.test(document.querySelector('[data-taxonomy-status]').textContent));
    await waitReload(page);
    assert.equal(fs.readFileSync(path.join(notesDir, 'gamma.md'), 'utf8').includes('生活'), false);

    await openManager(page);
    await page.click('[data-taxonomy-tab="tag"]');
    await page.waitForFunction(() => document.querySelectorAll('.taxonomy__row').length === 3);
    assert.equal(await page.locator('.taxonomy__row[data-row-name="生活"]').count(), 0, 'the tag is gone');

    await page.click('[data-taxonomy-undo]');
    await page.waitForFunction(() => /已撤销/.test(document.querySelector('[data-taxonomy-status]').textContent));
    await waitReload(page);
    assert.ok(fs.readFileSync(path.join(notesDir, 'gamma.md'), 'utf8').includes('生活'));

    await openManager(page);
    await page.click('[data-taxonomy-tab="tag"]');
    await page.waitForFunction(() => document.querySelectorAll('.taxonomy__row').length === 4);
    assert.equal(await page.locator('.taxonomy__row[data-row-name="生活"]').count(), 1, 'undo brings the tag back');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});
