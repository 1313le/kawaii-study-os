import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { buildNotes } from './build.js';

const PORT = 4292;
let server;
let browser;
let base;
let notesDir;
let assetDir;

const SLUG = 'desk-smoke-test';

before(async () => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kawaii-desk-'));
  assetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kawaii-asset-'));
  server = spawn(process.execPath, ['tools/serve.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(PORT), KAWAII_NOTES_DIR: notesDir, KAWAII_ASSET_DIR: assetDir, KAWAII_NO_BUILD: '1', KAWAII_AUTH: 'off' },
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
  if (notesDir) fs.rmSync(notesDir, { recursive: true, force: true });
  if (assetDir) fs.rmSync(assetDir, { recursive: true, force: true });
});

async function desk({ skin = 'pixel' } = {}) {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: [{ origin: base, localStorage: [{ name: 'kawaii.skin.v1', value: skin }] }]
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('/write.html');
  await page.waitForSelector('#write-screen');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  return { page, context, errors };
}

async function fillNote(page, body = '## 现象\n\n上电第一次采样偏 3%。\n') {
  await page.fill('[data-meta="title"]', 'ADC 采样为什么要先校准');
  await page.fill('[data-meta="slug"]', SLUG);
  await page.fill('[data-meta="tags"]', 'ADC, 校准');
  await page.click('#write-screen');
  await page.keyboard.type(body);
}

test('the screen is a real textarea, so typing, caret and IME stay native', async () => {
  const { page, context, errors } = await desk();
  try {
    const shape = await page.evaluate(() => {
      const input = document.querySelector('#write-screen');
      return {
        tag: input.tagName,
        editable: input.getAttribute('contenteditable'),
        spellcheck: input.getAttribute('spellcheck'),
        value: input.value
      };
    });
    assert.equal(shape.tag, 'TEXTAREA');
    assert.equal(shape.editable, null, 'a contenteditable would break the IME candidate window');
    assert.equal(shape.spellcheck, 'false');

    await page.click('#write-screen');
    await page.keyboard.type('第一行\n第二行');
    const status = await page.evaluate(() => ({
      pos: document.querySelector('[data-write-pos]').textContent,
      count: document.querySelector('[data-write-count]').textContent,
      state: document.querySelector('[data-write-state]').textContent
    }));
    assert.match(status.pos, /LN 2 · COL 4/);
    assert.match(status.count, /7 CHARS/);
    assert.equal(status.state, 'DRAFT');
    assert.deepEqual(errors, []);
  } finally { await page.close(); await context.close(); }
});

test('Ctrl+S writes notes/<slug>.md, and a second save asks before overwriting', async () => {
  const { page, context } = await desk();
  try {
    await fillNote(page);
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => /已保存/.test(document.querySelector('[data-write-saved]').textContent));
    const file = path.join(notesDir, `${SLUG}.md`);
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /^---\ntitle: ADC 采样为什么要先校准/);
    assert.match(text, /tags: ADC, 校准/);
    assert.match(text, /## 现象/);
    assert.equal(await page.textContent('[data-write-file]'), `${SLUG}.md`);

    let asked = false;
    page.on('dialog', async (dialog) => {
      asked = true;
      await dialog.dismiss();
    });
    await page.fill('#write-screen', '## 改过\n');
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(400);
    assert.equal(asked, true, 'overwriting an existing note must ask first');
    assert.match(fs.readFileSync(file, 'utf8'), /## 现象/, 'a dismissed overwrite must leave the file alone');
  } finally { await page.close(); await context.close(); }
});

test('F1 cycles edit → split → preview → map, and the preview uses the full renderer', async () => {
  const { page, context } = await desk();
  try {
    const apiCalls = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/note/preview')) apiCalls.push(request.url());
    });
    await page.click('#write-screen');
    await page.keyboard.type('## 现象\n\n| 参数 | 值 |\n| - | - |\n| Vref | 3.3V |\n\n- [x] 已复现\n');

    await page.keyboard.press('F1');
    await page.waitForFunction(() => document.querySelector('[data-screen]').dataset.view === 'split');
    assert.equal(await page.isVisible('#write-screen'), true, 'split keeps the editor visible');
    assert.equal(await page.isVisible('[data-write-preview]'), true, 'split shows the preview next to it');
    const splitHtml = await page.innerHTML('[data-write-preview]');
    assert.match(splitHtml, /现象/);
    assert.match(splitHtml, /<table/);
    assert.match(splitHtml, /(md-task|task-list-item)/);

    await page.keyboard.press('F1');
    await page.waitForFunction(() => document.querySelector('[data-screen]').dataset.view === 'preview');
    assert.equal(await page.isVisible('#write-screen'), false, 'preview hides the raw editor');

    await page.keyboard.press('F1');
    await page.waitForFunction(() => document.querySelector('[data-screen]').dataset.view === 'map');
    assert.equal(await page.isVisible('#write-screen'), false, 'the map hides the raw editor');
    await page.waitForSelector('[data-write-map]:not([hidden]) svg');
    assert.ok(await page.locator('[data-write-map] .mm-node').count() >= 2, 'the map folds the headings into nodes');

    await page.keyboard.press('F1');
    await page.waitForFunction(() => document.querySelector('[data-screen]').dataset.view === 'edit');
    assert.equal(await page.isVisible('#write-screen'), true);
    assert.ok(apiCalls.length > 0, 'the preview asks the full renderer so custom blocks match the article');
  } finally { await page.close(); await context.close(); }
});

test('the preview still renders from the local renderer when the API is unavailable', async () => {
  const { page, context } = await desk();
  try {
    await page.route('**/api/note/preview', (route) => route.abort());
    await page.click('#write-screen');
    await page.keyboard.type('## 离线预览\n\n正文。\n');
    await page.keyboard.press('F1');
    await page.waitForFunction(() => /离线预览/.test(document.querySelector('[data-write-preview]').textContent));
    assert.match(await page.innerHTML('[data-write-preview]'), /离线预览/);
  } finally { await page.close(); await context.close(); }
});

test('typing updates the split preview without leaving the editor', async () => {
  const { page, context } = await desk();
  try {
    await page.keyboard.press('F1');
    await page.click('#write-screen');
    await page.keyboard.type('## 一边写一边看\n\n正文 **加粗**。\n');
    await page.waitForFunction(() => /一边写一边看/.test(document.querySelector('[data-write-preview]').textContent));
    const html = await page.innerHTML('[data-write-preview]');
    assert.match(html, /<strong>加粗<\/strong>/);
    assert.equal((await page.inputValue('#write-screen')).trim(), '## 一边写一边看\n\n正文 **加粗**。');
  } finally { await page.close(); await context.close(); }
});

test('the screen font and glow cycle and survive a reload', async () => {
  const { page, context } = await desk();
  try {
    const read = () => page.evaluate(() => ({
      font: document.querySelector('[data-screen]').dataset.screenFont,
      glow: document.querySelector('[data-screen]').dataset.screenGlow,
      fontLabel: document.querySelector('[data-screen-font-label]').textContent,
      glowLabel: document.querySelector('[data-screen-glow-label]').textContent
    }));
    const first = await read();
    assert.equal(first.font, 'pixel', 'the pixel phosphor screen is the default');
    assert.equal(first.glow, 'green');

    await page.click('[data-screen-font]');
    await page.click('[data-screen-glow]');
    const second = await read();
    assert.equal(second.font, 'mono');
    assert.equal(second.glow, 'amber');
    assert.equal(second.fontLabel, '等宽');
    assert.equal(second.glowLabel, '琥珀');

    const family = await page.evaluate(() => getComputedStyle(document.querySelector('#write-screen')).fontFamily);
    assert.match(family, /Cascadia|Consolas/);

    await page.reload();
    await page.waitForSelector('#write-screen');
    const third = await read();
    assert.equal(third.font, 'mono');
    assert.equal(third.glow, 'amber');
  } finally { await page.close(); await context.close(); }
});

test('F6 gives a full-screen desk with a title bar, and Escape leaves it', async () => {
  const { page, context } = await desk();
  try {
    await page.keyboard.press('F6');
    await page.waitForFunction(() => document.body.classList.contains('is-immersive'));
    const layout = await page.evaluate(() => ({
      metaVisible: getComputedStyle(document.querySelector('.unit__meta')).display !== 'none',
      masthead: getComputedStyle(document.querySelector('.masthead')).display,
      height: Math.round(document.querySelector('.screen').offsetHeight),
      viewport: window.innerHeight
    }));
    assert.equal(layout.metaVisible, true, 'immersive keeps a title/slug strip');
    assert.equal(layout.masthead, 'none');
    assert.ok(layout.height > layout.viewport * 0.6, `screen only grew to ${layout.height}px`);

    await page.fill('[data-meta-mirror="title"]', '全屏里写的标题');
    assert.equal(await page.inputValue('[data-meta="title"]'), '全屏里写的标题', 'the mirror writes back');

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.body.classList.contains('is-immersive'));
  } finally { await page.close(); await context.close(); }
});

test('the AI panel asks for a key before it sends anything', async () => {
  const { page, context } = await desk();
  try {
    await page.click('#write-screen');
    await page.keyboard.type('一段需要润色的文字。');
    await page.click('[data-write-action="polish"]');
    await page.waitForSelector('[data-ai-panel][open]');
    assert.equal(await page.isVisible('[data-ai-config]'), true, 'unconfigured AI must show the setup form');
    assert.equal(await page.isVisible('[data-ai-accept]'), false);

    await page.fill('[data-ai-field="endpoint"]', 'https://api.deepseek.com/v1');
    await page.fill('[data-ai-field="model"]', 'deepseek-chat');
    await page.fill('[data-ai-field="key"]', 'sk-unit-test-key');
    let seen = null;
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    await page.route('**/chat/completions', async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      seen = request.headers();
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ choices: [{ message: { content: '一段被润色过的文字。' } }] })
      });
    });
    await page.click('[data-ai-configure]');
    await page.waitForSelector('[data-ai-compare]:not([hidden])');

    assert.equal(seen.authorization, 'Bearer sk-unit-test-key');
    assert.match(seen['content-type'], /application\/json/);
    assert.equal(await page.textContent('[data-ai-new]'), '一段被润色过的文字。');

    await page.click('[data-ai-accept]');
    const body = await page.inputValue('#write-screen');
    assert.equal(body, '一段被润色过的文字。');
    assert.equal(await page.isVisible('[data-ai-undo]'), true, 'one shadow copy is the only undo after a programmatic replace');
  } finally { await page.close(); await context.close(); }
});

test('the exported markdown is the same file the server would write', async () => {
  const { page, context } = await desk();
  try {
    await fillNote(page, '## 一\n\n正文。\n');
    const text = await page.evaluate(() => window.WriteDesk.compose());
    const parsed = buildNotes([{ file: `${SLUG}.md`, raw: text }]);
    assert.deepEqual(parsed.warnings, []);
    assert.equal(parsed.notes.length, 1);
    assert.equal(parsed.notes[0].title, 'ADC 采样为什么要先校准');
    assert.deepEqual(parsed.notes[0].tags, ['ADC', '校准']);
    assert.match(parsed.notes[0].html, /<h2[^>]*>一<\/h2>/);
  } finally { await page.close(); await context.close(); }
});

test('a draft survives a reload without touching the notes folder', async () => {
  const { page, context } = await desk();
  const before = fs.readdirSync(notesDir).sort();
  try {
    await page.click('#write-screen');
    await page.keyboard.type('还没想好标题的草稿。');
    await page.waitForTimeout(900);
    await page.reload();
    await page.waitForSelector('#write-screen');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#write-screen').value.length > 0);
    const restored = await page.evaluate(() => ({
      body: document.querySelector('#write-screen').value,
      saved: document.querySelector('[data-write-saved]').textContent
    }));
    assert.equal(restored.body, '还没想好标题的草稿。');
    assert.match(restored.saved, /草稿/);
    assert.deepEqual(fs.readdirSync(notesDir).sort(), before, 'a draft must not create a file');
  } finally { await page.close(); await context.close(); }
});

/* ---------- cover import ---------- */

function makePng(width, height, pixel) {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const at = row + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

test('an imported photo becomes a blocky, palette-limited cover on disk', async () => {
  const { page, context } = await desk();
  try {
    await page.fill('[data-meta="slug"]', 'photo-cover-test');
    const buffer = makePng(120, 80, (x, y) => [x * 2, y * 3, 128]);
    await page.setInputFiles('[data-cover-file]', { name: 'photo.png', mimeType: 'image/png', buffer });
    await page.waitForSelector('[data-cover-import]:not([hidden])');

    await page.evaluate(() => {
      for (const [selector, value] of [['[data-cover-pixel]', '8'], ['[data-cover-colors]', '2']]) {
        const input = document.querySelector(selector);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    const preview = await page.evaluate(() => {
      const canvas = document.querySelector('[data-cover-canvas]');
      const ctx = canvas.getContext('2d');
      const { data, width } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const colors = new Set();
      for (let i = 0; i < data.length; i += 4) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3).join(',');
      let uniform = true;
      for (let y = 0; y < canvas.height; y += 8) {
        for (let x = 0; x < canvas.width; x += 8) {
          const first = at(x, y);
          for (let dy = 0; dy < 8 && y + dy < canvas.height && uniform; dy += 1) {
            for (let dx = 0; dx < 8 && x + dx < canvas.width && uniform; dx += 1) {
              if (at(x + dx, y + dy) !== first) uniform = false;
            }
          }
        }
      }
      return { colors: colors.size, uniform, width };
    });
    assert.ok(preview.colors <= 8, `2 levels per channel would allow 8 colours, saw ${preview.colors}`);
    assert.equal(preview.uniform, true, 'an 8px cell must be one flat colour');

    await page.click('[data-cover-apply]');
    await page.waitForFunction(() => /已设为封面/.test(document.querySelector('[data-cover-hint]').textContent));
    assert.equal(fs.existsSync(path.join(assetDir, 'photo-cover-test-cover.png')), true, 'the png never reached the asset folder');
    assert.equal(await page.inputValue('[data-meta="cover"]'), 'assets/img/photo-cover-test-cover.png');
    const composed = await page.evaluate(() => window.WriteDesk.compose());
    assert.match(composed, /cover: assets\/img\/photo-cover-test-cover\.png/);
  } finally { await page.close(); await context.close(); }
});

test('the split preview follows the editor scroll', async () => {
  const { page, context } = await desk();
  try {
    await page.keyboard.press('F1');
    await page.click('#write-screen');
    const paragraph = '一段用来撑开高度的话。'.repeat(12);
    const body = Array.from({ length: 40 }, (_, i) => `## 第 ${i + 1} 节\n\n${paragraph}\n`).join('\n');
    await page.evaluate((text) => {
      const screen = document.querySelector('#write-screen');
      screen.value = text;
      screen.dispatchEvent(new Event('input', { bubbles: true }));
    }, body);
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const screen = document.querySelector('#write-screen');
      screen.scrollTop = screen.scrollHeight * 0.5;
      screen.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(150);
    const offsets = await page.evaluate(() => ({
      editor: document.querySelector('#write-screen').scrollTop,
      preview: document.querySelector('[data-write-preview]').scrollTop
    }));
    assert.ok(offsets.editor > 100, `the editor did not scroll (${offsets.editor})`);
    assert.ok(offsets.preview > 100, `the preview stayed at ${offsets.preview}`);
  } finally { await page.close(); await context.close(); }
});

test('the caret is mirrored into the co-write channel and the little screen lights up', async () => {
  const { page, context, errors } = await desk();
  try {
    await page.evaluate(() => {
      window.__deskStates = [];
      document.addEventListener('kawaii:deskstate', (event) => window.__deskStates.push(event.detail));
    });
    await page.fill('[data-meta="title"]', 'ADC 采样为什么要先校准');
    await page.click('#write-screen');
    await page.keyboard.type('第一行\n第二行');
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('kawaii.desk.v1');
      if (!raw) return false;
      const state = JSON.parse(raw);
      return state.line === 2 && /第二行/.test(state.tail);
    });
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('kawaii.desk.v1')));
    assert.equal(state.title, 'ADC 采样为什么要先校准');
    assert.equal(state.line, 2);
    assert.equal(state.col, 4);
    assert.equal(state.chars, 7);
    assert.match(state.tail, /第一行\n第二行/);
    assert.ok(state.at > 0, 'the feed must carry a timestamp');

    await page.waitForFunction(() => {
      const canvas = document.querySelector('[data-desk-screen]');
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0;
      for (let index = 0; index < data.length; index += 4) if (data[index + 1] > 60) lit += 1;
      return lit > 200;
    });
    const feed = await page.evaluate(() => ({
      badge: document.querySelector('[data-desk-feed-badge]').textContent,
      pos: document.querySelector('[data-desk-feed-pos]').textContent,
      title: document.querySelector('[data-desk-feed-title]').textContent,
      events: window.__deskStates.length
    }));
    assert.match(feed.badge, /LIVE/);
    assert.match(feed.pos, /LN 2 · COL 4/);
    assert.equal(feed.title, 'ADC 采样为什么要先校准');
    assert.ok(feed.events > 0, 'the same page must hear the deskstate event');
    assert.deepEqual(errors, []);
  } finally { await page.close(); await context.close(); }
});

test('an empty desk reads as idle instead of a fake cursor', async () => {
  const { page, context, errors } = await desk();
  try {
    await page.waitForSelector('[data-desk-screen]');
    const feed = await page.evaluate(() => ({
      badge: document.querySelector('[data-desk-feed-badge]').textContent,
      pos: document.querySelector('[data-desk-feed-pos]').textContent
    }));
    assert.equal(feed.badge.trim(), 'IDLE');
    assert.match(feed.pos, /尚无写作记录/);
    assert.deepEqual(errors, []);
  } finally { await page.close(); await context.close(); }
});

test('the about portrait bar picks up the writing position from another page', async () => {
  const { page, context, errors } = await desk();
  const about = await context.newPage();
  about.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.click('#write-screen');
    await page.keyboard.type('第一行\n第二行');
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('kawaii.desk.v1');
      return raw && JSON.parse(raw).line === 2;
    });
    let published = null;
    for (let i = 0; i < 25; i += 1) {
      published = await (await fetch(`${base}/api/live`, { cache: 'no-store' })).json();
      if (published.live && published.state && published.state.line === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(published.live, true, 'the open desk publishes its caret position');
    await about.goto('/about.html');
    await about.waitForSelector('[data-desk-feed-inline]');
    await about.waitForFunction(() => /LIVE/.test(document.querySelector('[data-desk-feed-inline]').textContent));
    const text = await about.textContent('[data-desk-feed-inline]');
    assert.match(text, /LN 2 · COL 4/);
    assert.deepEqual(errors, []);
  } finally {
    await about.close();
    await page.close();
    await context.close();
  }
});
