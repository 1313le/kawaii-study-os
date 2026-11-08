import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  emptyStore,
  addResource,
  updateResource,
  removeResource,
  detectLink,
  suggestCategory,
  libraryView
} from './resources.js';
import { extractMetadata, isPrivateAddress } from './probe.js';

const PORT = 4296;
const META_PORT = 4302;
let server;
let metaServer;
let browser;
let base;
let root;
let storeFile;
let filesDir;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kawaii-res-'));
  storeFile = path.join(root, 'resources.json');
  filesDir = path.join(root, 'files');
  fs.writeFileSync(storeFile, JSON.stringify(emptyStore()), 'utf8');
  metaServer = http.createServer((req, res) => {
    if (req.url === '/resource') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><head><title>自托管资源页</title><meta name="description" content="一个用于测试的元数据页面"><meta property="og:title" content="自托管资源页"></head><body><h1>ok</h1></body></html>');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  await new Promise((resolve) => metaServer.listen(META_PORT, '127.0.0.1', resolve));
  server = spawn(process.execPath, ['tools/serve.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(PORT),
      KAWAII_RESOURCES_FILE: storeFile,
      KAWAII_FILES_DIR: filesDir,
      KAWAII_PROBE_ALLOW_PRIVATE: '1',
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
  metaServer?.close();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test('link detection maps bilibili, youtube, netdisk and direct files', () => {
  assert.equal(detectLink('https://www.bilibili.com/video/BV1GJ411x7h7').provider, 'bilibili');
  assert.match(detectLink('https://www.bilibili.com/video/BV1GJ411x7h7').embed, /player\.bilibili\.com.*BV1GJ411x7h7/);
  assert.equal(detectLink('https://youtu.be/dQw4w9WgXcQ').provider, 'youtube');
  assert.match(detectLink('https://youtu.be/dQw4w9WgXcQ').embed, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.equal(detectLink('https://pan.baidu.com/s/abc123').kind, 'netdisk');
  assert.equal(detectLink('https://pan.quark.cn/s/xyz').provider, 'quark');
  assert.equal(detectLink('https://example.com/book.pdf').kind, 'pdf');
  assert.equal(detectLink('https://example.com/demo.mp4').kind, 'video');
  assert.equal(detectLink('/files/abc.pdf').provider, 'upload');
});

test('the store validates, updates and removes entries without losing order', () => {
  const store = emptyStore();
  const first = addResource(store, { title: '参考手册', url: 'https://example.com/rm.pdf', category: '数据手册', tags: ['STM32', 'STM32'] });
  assert.equal(first.ok, true);
  assert.equal(first.item.kind, 'pdf');
  assert.deepEqual(first.item.tags, ['STM32']);
  assert.equal(addResource(store, { title: '', url: 'https://example.com' }).ok, false);
  assert.equal(addResource(store, { title: 'x', url: 'javascript:alert(1)' }).ok, false);
  assert.equal(addResource(store, { title: 'y', url: 'not a url' }).ok, false);

  const second = addResource(store, { title: '视频课', url: 'https://www.bilibili.com/video/BV1GJ411x7h7', category: '视频' });
  assert.equal(second.ok, true);
  assert.equal(updateResource(store, { id: first.item.id, title: '新手册' }).item.title, '新手册');
  assert.equal(updateResource(store, { id: 'missing', title: 'x' }).ok, false);
  assert.equal(removeResource(store, second.item.id).ok, true);
  assert.deepEqual(store.items.map((item) => item.title), ['新手册']);
  assert.equal(libraryView(store).categories.find((entry) => entry.name === '数据手册').count, 1);
});

async function api(payload, headers = {}) {
  return fetch(`${base}/api/resources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload)
  });
}

test('the resources api adds, lists, uploads and serves byte ranges', async () => {
  const empty = await (await fetch(`${base}/api/resources`)).json();
  assert.equal(empty.total, 0);
  assert.equal(empty.canWrite, true);

  const added = await api({
    action: 'add',
    title: 'B 站课程',
    url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
    category: '课程',
    note: '从第 3 集开始'
  });
  assert.equal(added.status, 200);
  const data = await added.json();
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].provider, 'bilibili');
  assert.match(data.items[0].embed, /player\.bilibili\.com/);

  const pdfBytes = Buffer.from('%PDF-1.4\n% kawaii test\n%%EOF\n');
  const uploaded = await fetch(`${base}/api/resources/upload`, {
    method: 'POST',
    headers: {
      'X-Kawaii-Upload': '1',
      'X-File-Name': encodeURIComponent('../手册 final.pdf'),
      'Content-Type': 'application/pdf'
    },
    body: pdfBytes
  });
  assert.equal(uploaded.status, 200);
  const upload = await uploaded.json();
  assert.match(upload.url, /^\/files\/[a-z0-9-]+\.pdf$/);
  assert.equal(upload.size, pdfBytes.length);
  const storedNames = fs.readdirSync(filesDir);
  assert.equal(storedNames.length, 1, 'the upload lands in the files dir');
  assert.ok(!storedNames[0].includes('..'), 'the file name is sanitized');

  const withFile = await api({
    action: 'add',
    title: '本地手册',
    url: upload.url,
    kind: 'pdf',
    category: '数据手册',
    fileName: upload.name,
    size: upload.size
  });
  assert.equal(withFile.status, 200);

  const ranged = await fetch(`${base}${upload.url}`, { headers: { Range: 'bytes=0-4' } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), `bytes 0-4/${pdfBytes.length}`);
  assert.equal((await ranged.text()).slice(0, 5), '%PDF-');
  assert.equal(ranged.headers.get('accept-ranges'), 'bytes');

  const invalid = await api({ action: 'add', title: '危险', url: 'file:///etc/passwd' });
  assert.equal(invalid.status, 400);
});

test('the vault page filters, opens embeds, copies codes and adds/removes entries', async () => {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
    storageState: {
      cookies: [],
      origins: [{ origin: base, localStorage: [{ name: 'kawaii.skin.v1', value: 'pixel' }] }]
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto('/resources.html');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.res-card');
    assert.equal(await page.locator('.res-card').count(), 2);

    await page.selectOption('[data-res-kind]', 'pdf');
    await page.waitForFunction(() => document.querySelectorAll('.res-card').length === 1);
    assert.match(await page.url(), /kind=pdf/);
    await page.selectOption('[data-res-kind]', '');
    await page.waitForFunction(() => document.querySelectorAll('.res-card').length === 2);

    await page.click('[data-res-categories] [data-res-category="课程"]');
    await page.waitForFunction(() => document.querySelectorAll('.res-card').length === 1);
    assert.match(await page.textContent('.res-card__title'), /B 站课程/);
    await page.click('[data-res-categories] [data-res-category=""]');
    await page.waitForFunction(() => document.querySelectorAll('.res-card').length === 2);

    await page.fill('[data-res-search]', '手册');
    await page.waitForFunction(() => document.querySelectorAll('.res-card').length === 1);
    assert.match(await page.textContent('.res-card__title'), /本地手册/);

    // Open the video card: the embed iframe must point at the player, not the watch page.
    await page.fill('[data-res-search]', '');
    await page.waitForFunction(() => document.querySelectorAll('.res-card').length === 2);
    await page.locator('.res-card', { hasText: 'B 站课程' }).locator('[data-res-open]').click();
    await page.waitForSelector('[data-res-view][open] iframe');
    const src = await page.getAttribute('[data-res-view] iframe', 'src');
    assert.match(src, /player\.bilibili\.com\/player\.html\?bvid=BV1GJ411x7h7/);
    await page.click('[data-res-view-close]');

    // Add a netdisk link with a code, then copy the code.
    await page.click('.res-toolbar [data-res-add]');
    await page.waitForSelector('[data-res-add-dialog][open]');
    await page.fill('[data-res-field="title"]', '资料盘');
    await page.fill('[data-res-field="url"]', 'https://pan.baidu.com/s/abc123');
    await page.fill('[data-res-field="category"]', '网盘');
    await page.fill('[data-res-field="code"]', 'k7x9');
    await page.click('[data-res-add-save]');
    await page.waitForFunction(() => document.querySelectorAll('.res-card').length === 3, null, { timeout: 5000 });
    const netdisk = page.locator('.res-card', { hasText: '资料盘' });
    await netdisk.locator('[data-res-open]').click();
    await page.waitForSelector('[data-res-panel-code]');
    await page.click('[data-res-panel-code]');
    await page.waitForFunction(() => /已复制提取码/.test(document.querySelector('.res-toast')?.textContent || ''));
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'k7x9');
    await page.click('[data-res-view-close]');

    // Two clicks remove: the first only arms.
    const target = page.locator('.res-card', { hasText: '资料盘' });
    await target.locator('[data-res-remove]').click();
    assert.match(await target.locator('[data-res-remove]').textContent(), /确认删除/);
    await target.locator('[data-res-remove]').click();
    await page.waitForFunction(() => document.querySelectorAll('.res-card').length === 2, null, { timeout: 5000 });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('AI proposals wait for review and import in one click', async () => {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: [{ origin: base, localStorage: [{ name: 'kawaii.skin.v1', value: 'pixel' }] }]
    }
  });
  const page = await context.newPage();
  try {
    await page.goto('/resources.html');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.res-card');
    await page.evaluate(() => {
      localStorage.setItem('kawaii.resource.proposals.v1', JSON.stringify({
        at: new Date().toISOString(),
        items: [
          { title: 'AI 推荐：CMSIS 文档', url: 'https://example.com/cmsis.pdf', category: '数据手册', note: 'AI 结构化推荐' }
        ]
      }));
    });
    await page.reload();
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-res-proposals]:not([hidden])');
    assert.match(await page.textContent('[data-res-proposals]'), /AI 推荐：CMSIS 文档/);
    assert.match(await page.textContent('[data-res-proposals]'), /导入前请自己核对链接/);

    await page.click('[data-res-import]');
    await page.waitForFunction(() => [...document.querySelectorAll('.res-card__title')].some((node) => node.textContent === 'AI 推荐：CMSIS 文档'), null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('kawaii.resource.proposals.v1')), null);
    const saved = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    assert.ok(saved.items.some((item) => item.title === 'AI 推荐：CMSIS 文档'));
  } finally {
    await page.close();
    await context.close();
  }
});

test('the upload tab streams a file and turns it into a download card', async () => {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: [{ origin: base, localStorage: [{ name: 'kawaii.skin.v1', value: 'line' }] }]
    }
  });
  const page = await context.newPage();
  try {
    await page.goto('/resources.html');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.res-card');
    await page.click('.res-toolbar [data-res-add]');
    await page.click('[data-res-tab="upload"]');
    await page.fill('[data-res-upload-field="title"]', '上传测试书');
    await page.fill('[data-res-upload-field="category"]', '电子书');
    await page.setInputFiles('[data-res-upload-field="file"]', {
      name: 'book.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nuploaded by the test\n%%EOF\n')
    });
    await page.click('[data-res-add-save]');
    await page.waitForFunction(() => [...document.querySelectorAll('.res-card__title')].some((node) => node.textContent === '上传测试书'), null, { timeout: 8000 });
    const card = page.locator('.res-card', { hasText: '上传测试书' });
    assert.equal(await card.count(), 1);
    assert.equal(await card.locator('a[download]').count(), 1, 'an uploaded file gets a download link');
    assert.equal(fs.readdirSync(filesDir).length, 2, 'the second file also landed on disk');
    const saved = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    assert.ok(saved.items.some((item) => item.title === '上传测试书' && item.provider === 'upload'));
  } finally {
    await page.close();
    await context.close();
  }
});

test('metadata extraction, category suggestions and the probe API work', async () => {
  const meta = extractMetadata(
    '<title>STM32 参考手册</title><meta name="description" content="RM0090"><meta property="og:image" content="/cover.png">',
    'https://www.st.com/rm.pdf'
  );
  assert.equal(meta.title, 'STM32 参考手册');
  assert.equal(meta.description, 'RM0090');
  assert.equal(meta.image, 'https://www.st.com/cover.png');
  assert.equal(suggestCategory({ host: 'www.st.com', kind: 'pdf' }), '数据手册');
  assert.equal(suggestCategory({ host: 'www.bilibili.com', kind: 'video' }), '视频');
  assert.equal(suggestCategory({ host: 'pan.baidu.com', kind: 'netdisk' }), '网盘');
  assert.equal(suggestCategory({ host: 'github.com', kind: 'site' }), '工具软件');
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('192.168.1.2'), true);
  assert.equal(isPrivateAddress('10.0.0.5'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);

  const response = await fetch(`${base}/api/resources/probe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `http://127.0.0.1:${META_PORT}/resource` })
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.title, '自托管资源页');
  assert.equal(data.description, '一个用于测试的元数据页面');
  assert.equal(data.fetched, true);
  assert.equal(data.kind, 'site');
  assert.equal(data.category, '其他');
});

test('the smart intake prefills the add form and files a local upload', async () => {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: [{ origin: base, localStorage: [{ name: 'kawaii.skin.v1', value: 'pixel' }] }]
    }
  });
  const page = await context.newPage();
  try {
    await page.goto('/resources.html');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.res-card');
    await page.waitForSelector('body[data-authed="true"]');
    await page.fill('[data-res-intake-url]', `http://127.0.0.1:${META_PORT}/resource`);
    await page.click('[data-res-intake-go]');
    await page.waitForSelector('[data-res-add-dialog][open]');
    await page.waitForFunction(() => document.querySelector('[data-res-field="title"]').value === '自托管资源页');
    assert.equal(await page.inputValue('[data-res-field="category"]'), '其他');
    await page.click('[data-res-add-save]');
    await page.waitForFunction(
      () => [...document.querySelectorAll('.res-card__title')].some((node) => node.textContent === '自托管资源页'),
      null,
      { timeout: 5000 }
    );

    await page.setInputFiles('[data-res-intake-file]', {
      name: 'drop-notes.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\ndropped\n%%EOF\n')
    });
    await page.waitForFunction(
      () => [...document.querySelectorAll('.res-card__title')].some((node) => node.textContent === 'drop-notes'),
      null,
      { timeout: 8000 }
    );
    const saved = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    assert.ok(saved.items.some((item) => item.title === 'drop-notes' && item.provider === 'upload'));
  } finally {
    await page.close();
    await context.close();
  }
});

test('AI can classify a resource inside the add dialog', async () => {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: [{ origin: base, localStorage: [{ name: 'kawaii.skin.v1', value: 'pixel' }] }]
    }
  });
  const page = await context.newPage();
  try {
    await page.goto('/resources.html');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.res-toolbar [data-res-add]');
    await page.waitForSelector('body[data-authed="true"]');
    await page.evaluate(() => window.KawaiiAI.save({
      endpoint: 'https://api.example.test/v1',
      model: 'test-model',
      key: 'sk-res-ai',
      remember: false
    }));
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    await page.route('**/chat/completions', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          choices: [{
            message: {
              content: '{"category":"课程","kind":"video","tags":["测试","AI"],"note":"AI 分类结果"}'
            }
          }]
        })
      });
    });

    await page.click('.res-toolbar [data-res-add]');
    await page.fill('[data-res-field="title"]', '测试课程');
    await page.fill('[data-res-field="url"]', 'https://example.com/course');
    await page.click('[data-res-ai]');
    await page.waitForFunction(() => document.querySelector('[data-res-field="category"]').value === '课程');
    assert.equal(await page.inputValue('[data-res-field="kind"]'), 'video');
    assert.equal(await page.inputValue('[data-res-field="tags"]'), '测试, AI');
    assert.match(await page.textContent('[data-res-add-status]'), /AI 已填好/);
    await page.click('[data-res-add-cancel]');
  } finally {
    await page.close();
    await context.close();
  }
});
