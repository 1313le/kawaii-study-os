import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = 4298;
let server;
let browser;
let base;
let notesDir;
let assetDir;

before(async () => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kawaii-float-notes-'));
  assetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kawaii-float-assets-'));
  server = spawn(process.execPath, ['tools/serve.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(PORT),
      KAWAII_NOTES_DIR: notesDir,
      KAWAII_ASSET_DIR: assetDir,
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
  for (const dir of [notesDir, assetDir]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

async function desk() {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: [{ origin: base, localStorage: [{ name: 'kawaii.skin.v1', value: 'pixel' }] }]
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('/write.html?float=popup');
  await page.waitForSelector('#write-screen');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  return { page, context, errors };
}

async function openFloat(page) {
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.click('.cowrite [data-float-open]')
  ]);
  await popup.waitForSelector('.pip-shell');
  await popup.waitForTimeout(250);
  return popup;
}

test('the floating TV mirrors the desk position and can type a line back', async () => {
  const { page, context, errors } = await desk();
  try {
    await page.fill('[data-meta="title"]', '悬浮共写验收');
    await page.fill('#write-screen', '## 第一节\n\n正在读 I2C 的上拉电阻。\n\n第二段');
    await page.click('#write-screen');
    await page.keyboard.press('End');
    const popup = await openFloat(page);
    try {
      assert.match(await popup.textContent('[data-pip-title]'), /悬浮共写验收/);
      const line = await popup.textContent('[data-pip-line]');
      assert.match(line, /^LN \d+$/);
      assert.match(await popup.textContent('[data-pip-tail]'), /第二段/);
      assert.equal(await popup.getAttribute('[data-pip-live]', 'data-on'), 'on');

      await page.type('#write-screen', '，继续写');
      await popup.waitForFunction(() => /继续写/.test(document.querySelector('[data-pip-tail]').textContent));

      await popup.click('[data-pip-toggle-write]');
      await popup.fill('[data-pip-input]', '悬浮窗里的一句话');
      await popup.press('[data-pip-input]', 'Enter');
      await page.waitForFunction(() => /悬浮窗里的一句话/.test(document.querySelector('#write-screen').value));
      await popup.waitForFunction(() => /悬浮窗里的一句话/.test(document.querySelector('[data-pip-tail]').textContent));
      assert.deepEqual(errors, []);
    } finally {
      await Promise.allSettled([popup.waitForEvent('close', { timeout: 2000 }), popup.click('[data-pip-return]')]);
    }
    assert.equal(popup.isClosed(), true);
  } finally {
    await page.close();
    await context.close();
  }
});

test('dropping text, links and screenshots fills the inbox with a transfer animation', async () => {
  const { page, context, errors } = await desk();
  try {
    const popup = await openFloat(page);
    try {
      await popup.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.setData('text/plain', '从网页拖进来的一段资料');
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
      });
      await popup.waitForFunction(() => !document.querySelector('[data-pip-anim]').hidden || /送达/.test(document.querySelector('[data-pip-hint]').textContent));
      await popup.waitForFunction(() => /文本已送达写作台/.test(document.querySelector('[data-pip-hint]').textContent));
      const textClips = await page.evaluate(() => window.KawaiiClips.read());
      assert.equal(textClips.length, 1);
      assert.equal(textClips[0].kind, 'text');
      assert.equal(textClips[0].text, '从网页拖进来的一段资料');
      await page.waitForFunction(() => document.querySelectorAll('[data-write-inbox] .inbox__item').length === 1);

      await popup.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.setData('text/uri-list', 'https://example.com/notes');
        transfer.setData('text/plain', '示例资料页');
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
      });
      await page.waitForFunction(() => window.KawaiiClips.read().length === 2);
      const linkClip = await page.evaluate(() => window.KawaiiClips.read()[0]);
      assert.equal(linkClip.kind, 'link');
      assert.equal(linkClip.url, 'https://example.com/notes');

      await popup.evaluate(() => {
        const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const file = new File([bytes], 'screenshot.png', { type: 'image/png' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
      });
      await page.waitForFunction(() => window.KawaiiClips.read().some((clip) => clip.kind === 'image'), null, { timeout: 8000 });
      const imageClip = await page.evaluate(() => window.KawaiiClips.read().find((clip) => clip.kind === 'image'));
      assert.match(imageClip.url, /^assets\/img\/clip-.*-cover\.png$/);
      assert.ok(fs.readdirSync(assetDir).some((name) => name.startsWith('clip-')), 'the screenshot really landed on disk');
      await page.waitForFunction(() => document.querySelectorAll('[data-write-inbox] .inbox__item').length === 3);

      await page.locator('.inbox__item', { hasText: '从网页拖进来的一段资料' }).locator('[data-clip-insert]').click();
      const body = await page.inputValue('#write-screen');
      assert.match(body, /从网页拖进来的一段资料/);
      assert.deepEqual(errors, []);
    } finally {
      await popup.close();
    }
  } finally {
    await page.close();
    await context.close();
  }
});

test('the writing space is taller and the editor font size is adjustable and persistent', async () => {
  const { page, context, errors } = await desk();
  try {
    const before = await page.evaluate(() => ({
      height: document.querySelector('[data-screen]').offsetHeight,
      size: getComputedStyle(document.querySelector('#write-screen')).fontSize,
      label: document.querySelector('[data-screen-size-label]').textContent
    }));
    assert.ok(before.height >= 560, `the desk should be roomier, got ${before.height}px`);
    assert.equal(before.label, '13px');
    assert.equal(before.size, '13px');

    await page.click('[data-screen-size-up]');
    await page.waitForFunction(() => document.querySelector('[data-screen-size-label]').textContent === '14px');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#write-screen')).fontSize), '14px');
    await page.click('[data-screen-size-up]');
    await page.waitForFunction(() => document.querySelector('[data-screen-size-label]').textContent === '15px');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kawaii.screen.v1')).fontSize), 15);

    await page.reload();
    await page.waitForSelector('#write-screen');
    await page.keyboard.press('Escape');
    assert.equal(await page.textContent('[data-screen-size-label]'), '15px');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#write-screen')).fontSize), '15px');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});
