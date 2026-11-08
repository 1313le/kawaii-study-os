import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = 4292;
let server;
let browser;
let base;
let root;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kawaii-live-'));
  const notesDir = path.join(root, 'notes');
  const assetDir = path.join(root, 'assets');
  fs.mkdirSync(notesDir);
  fs.mkdirSync(assetDir);
  server = spawn(process.execPath, ['tools/serve.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(PORT),
      KAWAII_NOTES_DIR: notesDir,
      KAWAII_ASSET_DIR: assetDir,
      KAWAII_NO_BUILD: '1',
      KAWAII_AUTH: 'off',
      KAWAII_LIVE_TTL_MS: '60000'
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

async function post(payload) {
  return fetch(`${base}/api/live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

test('the public live endpoint exposes only an opted-in desk tail and can stop', async () => {
  const state = {
    title: 'Live notes',
    tail: '## GPIO\n\nPull-up vs floating',
    line: 8,
    col: 14,
    chars: 420,
    caret: 390,
    totalLines: 12,
    mode: 'edit',
    dirty: true
  };
  const on = await post({ enabled: true, state });
  assert.equal(on.status, 200);
  const view = await on.json();
  assert.equal(view.live, true);
  assert.equal(view.state.title, 'Live notes');
  assert.equal(view.state.tail, state.tail);

  const off = await post({ enabled: false });
  assert.equal(off.status, 200);
  const stopped = await off.json();
  assert.equal(stopped.live, false);
  assert.equal(stopped.state, null);
  const fetched = await (await fetch(`${base}/api/live`)).json();
  assert.equal(fetched.live, false, 'a stopped desk leaves no public tail');

  const empty = await post({ enabled: true, state: null });
  assert.equal(empty.status, 200);
  assert.equal((await empty.json()).live, false, 'enabling without a state is a no-op');
});

test('the author desk publishes by default and the visitor CRT follows and hides with it', async () => {
  const authorContext = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: [{ origin: base, localStorage: [{ name: 'kawaii.skin.v1', value: 'pixel' }] }]
    }
  });
  const author = await authorContext.newPage();
  const visitorContext = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: [{ origin: base, localStorage: [{ name: 'kawaii.skin.v1', value: 'pixel' }] }]
    }
  });
  const visitor = await visitorContext.newPage();
  try {
    await author.goto('/write.html');
    await author.waitForSelector('#write-screen');
    await author.keyboard.press('Escape');
    await author.waitForTimeout(500);
    assert.equal(await author.getAttribute('[data-live-toggle]', 'aria-pressed'), 'true', 'LIVE starts on');

    await author.fill('[data-meta="title"]', '公开写作测试');
    await author.fill('#write-screen', '## 现场\n\n这一行会出现在关于页的 CRT 上。\n');
    await author.waitForTimeout(1400);
    const view = await (await fetch(`${base}/api/live`)).json();
    assert.equal(view.live, true);
    assert.match(view.state.tail, /这一行会出现在关于页/);

    await visitor.goto('/about.html');
    await visitor.waitForSelector('[data-portrait]');
    await visitor.waitForFunction(() => window.KawaiiLive && window.KawaiiLive.live(), null, { timeout: 8000 });
    await visitor.waitForFunction(() => getComputedStyle(document.querySelector('[data-portrait-live]')).opacity === '1');
    const shown = await visitor.evaluate(() => {
      const canvas = document.querySelector('[data-portrait-live]');
      const ctx = canvas.getContext('2d');
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let alpha = 0;
      for (let i = 3; i < pixels.length; i += 4) alpha += pixels[i];
      return {
        stage: document.querySelector('[data-portrait]').dataset.live,
        opacity: getComputedStyle(canvas).opacity,
        label: document.querySelector('[data-desk-feed-inline]').textContent,
        painted: alpha > 0
      };
    });
    assert.equal(shown.stage, 'on');
    assert.equal(shown.opacity, '1');
    assert.match(shown.label, /LIVE · LN/);
    assert.equal(shown.painted, true, 'the portrait CRT receives the live texture');

    const large = await visitor.evaluate(() => {
      const canvas = document.querySelector('[data-live-monitor-canvas]');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let alpha = 0;
      for (let i = 3; i < pixels.length; i += 4) alpha += pixels[i];
      return {
        monitor: document.querySelector('[data-live-monitor]').dataset.live,
        badge: document.querySelector('[data-live-room-badge]').textContent,
        status: document.querySelector('[data-live-room-status]').textContent,
        title: document.querySelector('[data-live-room-title]').textContent,
        meta: document.querySelector('[data-live-room-meta]').textContent,
        width: canvas.width,
        painted: alpha > 0
      };
    });
    assert.equal(large.monitor, 'on');
    assert.equal(large.badge, 'ON AIR');
    assert.match(large.status, /^LN \d+ · COL \d+$/);
    assert.equal(large.title, '公开写作测试');
    assert.match(large.meta, /^\d+ CHARS · \d+ LINES$/);
    assert.equal(large.width, 576, 'the live monitor keeps the upscaled CRT resolution');
    assert.equal(large.painted, true, 'the large live monitor receives the live texture');

    await author.click('[data-live-toggle]');
    await author.waitForTimeout(300);
    assert.equal(await author.getAttribute('[data-live-toggle]', 'aria-pressed'), 'false');
    const stopped = await (await fetch(`${base}/api/live`)).json();
    assert.equal(stopped.live, false);
    await visitor.waitForTimeout(3600);
    const hidden = await visitor.evaluate(() => ({
      stage: document.querySelector('[data-portrait]').dataset.live,
      opacity: getComputedStyle(document.querySelector('[data-portrait-live]')).opacity,
      monitor: document.querySelector('[data-live-monitor]').dataset.live,
      badge: document.querySelector('[data-live-room-badge]').textContent,
      title: document.querySelector('[data-live-room-title]').textContent,
      label: document.querySelector('[data-desk-feed-inline]').textContent
    }));
    assert.equal(hidden.stage, 'off');
    assert.equal(hidden.opacity, '0');
    assert.equal(hidden.monitor, 'off');
    assert.equal(hidden.badge, 'STANDBY');
    assert.equal(hidden.title, '等待作者上线');
    assert.equal(hidden.label, 'ONLINE');
  } finally {
    await author.close();
    await authorContext.close();
    await visitor.close();
    await visitorContext.close();
  }
});
