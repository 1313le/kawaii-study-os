import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openBrowser } from './browser-fixture.mjs';

let fixture;
const SOURCE = '开场白。\n\n## 第一节\n\n- 条目一\n- 条目二\n\n## 第二节\n\n正文\n\n### 小节\n\n- 小条目\n';
const NOTE = {
  slug: 'map-fixture',
  title: '地图夹具',
  date: '2026-11-08',
  kind: 'article',
  summary: '导图回归夹具',
  tags: ['测试'],
  collection: '随笔',
  cover: '',
  accent: 'lime',
  fx: 'reveal',
  minutes: 2,
  words: 120,
  toc: [
    { id: 'sec-1', text: '第一节', depth: 2 },
    { id: 'sec-2', text: '第二节', depth: 2 },
    { id: 'sec-3', text: '小节', depth: 3 }
  ],
  source: SOURCE,
  html: '<h2 id="sec-1">第一节</h2><p>正文</p><h2 id="sec-2">第二节</h2><p>正文</p><h3 id="sec-3">小节</h3><p>正文</p>',
  text: '第一节 第二节 小节',
  backlinks: []
};
const META = {
  count: 1,
  updated: '2026-11-08',
  tags: [{ name: '测试', count: 1 }],
  collections: [{ name: '随笔', count: 1 }]
};

const EMBED_NOTE = {
  ...NOTE,
  slug: 'map-embed',
  title: '嵌入导图测试',
  toc: [{ id: 'sec-1', text: '正文', depth: 2 }],
  source: '## 正文\n\n```mindmap\n# 文章主题\n## 分支\n- 要点\n```\n',
  html: '<h2 id="sec-1">正文</h2><div class="mindmap-embed"><div class="diagram-head"><span>MINDMAP</span><span class="diagram-dot"></span></div><pre class="mindmap-embed__source"># 文章主题\n## 分支\n- 要点</pre><div class="mindmap-embed__host"></div></div>',
  text: '正文 文章主题 分支 要点'
};
const EMBED_META = { count: 1, updated: '2026-11-08', tags: [], collections: [{ name: '随笔', count: 1 }] };

before(async () => {
  fixture = await openBrowser();
});

after(async () => {
  await fixture?.close();
});

async function pageFor(url) {
  const context = await fixture.browser.newContext({
    baseURL: fixture.baseURL,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
    storageState: {
      cookies: [],
      origins: [{ origin: fixture.baseURL, localStorage: [{ name: 'kawaii.skin.v1', value: 'pixel' }] }]
    }
  });
  await context.route('**/data/notes.generated.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript; charset=utf-8',
      body: `window.NOTES=${JSON.stringify([NOTE])};\nwindow.NOTES_META=${JSON.stringify(META)};`
    })
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(url);
  await page.keyboard.press('Escape');
  return { page, context, errors };
}

async function waitMap(page) {
  await page.waitForSelector('[data-map-host] svg');
  await page.waitForFunction(() => document.querySelectorAll('.mm-node').length > 0);
}

test('the workbench folds headings and lists into a balanced two-sided tree', async () => {
  const { page, context, errors } = await pageFor('/mindmap.html');
  try {
    await waitMap(page);
    assert.equal(await page.locator('.mm-node').count(), 7, 'root + 2 headings + 3 list items + 1 sub-heading');
    assert.equal(await page.locator('.mm-edge').count(), 6);
    assert.equal(await page.textContent('[data-map-nodes]'), '7');
    assert.equal(await page.textContent('[data-map-depth]'), '3');
    assert.equal(await page.inputValue('[data-map-note]'), 'map-fixture');

    const sides = await page.evaluate(() => {
      const root = document.querySelector('.mm-node--root rect');
      const rootX = Number(root.getAttribute('x')) + Number(root.getAttribute('width')) / 2;
      const centers = [...document.querySelectorAll('.mm-node:not(.mm-node--root) rect')].map((rect) => {
        return Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2;
      });
      return { left: centers.filter((x) => x < rootX - 20).length, right: centers.filter((x) => x > rootX + 20).length };
    });
    assert.ok(sides.left >= 1 && sides.right >= 1, `the tree should fan out both ways, got ${JSON.stringify(sides)}`);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('nodes collapse from their badge, select on click and locate the source line on double-click', async () => {
  const { page, context, errors } = await pageFor('/mindmap.html');
  try {
    await waitMap(page);
    const first = page.locator('[data-mm-toc="0"]');
    await first.locator('[data-mm-toggle]').click();
    await page.waitForFunction(() => document.querySelectorAll('.mm-node').length === 5, null, { timeout: 5000 });
    await page.locator('[data-mm-toc="0"] [data-mm-toggle]').click();
    await page.waitForFunction(() => document.querySelectorAll('.mm-node').length === 7, null, { timeout: 5000 });

    await page.locator('[data-mm-toc="1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-mm-toc="1"]').classList.contains('is-selected'));
    assert.match(await page.textContent('[data-map-status]'), /标题 · 第 \d+ 行/);

    await page.dblclick('[data-mm-toc="0"]');
    const selection = await page.evaluate(() => {
      const input = document.querySelector('[data-map-source]');
      return { start: input.selectionStart, line: input.value.split('\n')[input.value.slice(0, input.selectionStart).split('\n').length - 1] };
    });
    assert.equal(selection.line, '## 第一节');
    assert.equal(selection.start, SOURCE.indexOf('## 第一节'));
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('expand, collapse-to-two, reset view and both exports work', async () => {
  const { page, context, errors } = await pageFor('/mindmap.html');
  try {
    await waitMap(page);
    await page.click('[data-map-collapse]');
    await page.waitForFunction(() => document.querySelectorAll('.mm-node').length === 6, null, { timeout: 5000 });
    await page.click('[data-map-expand]');
    await page.waitForFunction(() => document.querySelectorAll('.mm-node').length === 7, null, { timeout: 5000 });

    const initial = await page.getAttribute('[data-map-host] svg', 'viewBox');
    await page.evaluate(() => {
      const svg = document.querySelector('[data-map-host] svg');
      const rect = svg.getBoundingClientRect();
      svg.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -240,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true
      }));
    });
    const zoomed = await page.getAttribute('[data-map-host] svg', 'viewBox');
    assert.notEqual(zoomed, initial, 'the wheel should zoom the viewBox');
    await page.click('[data-map-reset]');
    assert.equal(await page.getAttribute('[data-map-host] svg', 'viewBox'), initial);

    const svgDownload = page.waitForEvent('download');
    await page.click('[data-map-svg]');
    const svgFile = await (await svgDownload).path();
    const svgText = fs.readFileSync(svgFile, 'utf8');
    assert.match(svgText, /<svg/);
    assert.match(svgText, /第一节/);
    assert.match(svgText, /mm-bg/);

    const pngDownload = page.waitForEvent('download');
    await page.click('[data-map-png]');
    const png = await pngDownload;
    const pngFile = await png.path();
    const size = fs.statSync(pngFile).size;
    assert.ok(size > 2000, `PNG export is only ${size} bytes`);
    assert.match(png.suggestedFilename(), /\.png$/);

    await page.click('[data-map-embed]');
    await page.waitForFunction(() => /已复制嵌入片段/.test(document.querySelector('[data-map-status]').textContent));
    const embedClip = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(embedClip, /```mindmap/);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('the note page switches to the map and a double-click returns to the matching section', async () => {
  const { page, context, errors } = await pageFor('/note.html?slug=map-fixture');
  try {
    await page.waitForSelector('.article h2');
    await page.click('[data-note-map-toggle]');
    await page.waitForSelector('[data-note-map]:not([hidden]) svg');
    assert.equal(await page.isVisible('.article'), false, 'the article gives way to the map');
    assert.ok(await page.locator('.mm-node').count() >= 7);

    await page.dblclick('[data-mm-toc="1"]');
    await page.waitForSelector('[data-note-map][hidden]', { state: 'attached' });
    await page.waitForFunction(() => document.querySelector('.article').offsetParent !== null);
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => window.scrollY) > 0, 'locating should scroll to the section');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('the writer cycles into a map view and a node brings the caret back to its line', async () => {
  const { page, context, errors } = await pageFor('/write.html');
  try {
    await page.waitForSelector('#write-screen');
    await page.fill('#write-screen', SOURCE);
    await page.keyboard.press('F1');
    await page.keyboard.press('F1');
    await page.keyboard.press('F1');
    await page.waitForSelector('[data-write-map]:not([hidden]) svg');
    assert.match(await page.textContent('[data-write-mode]'), /MAP/);
    await page.waitForFunction(() => document.querySelectorAll('[data-write-map] .mm-node').length === 7);

    await page.dblclick('[data-write-map] [data-mm-toc="0"]');
    await page.waitForSelector('[data-write-map][hidden]', { state: 'attached' });
    assert.equal(await page.isVisible('#write-screen'), true);
    const caret = await page.evaluate(() => document.querySelector('#write-screen').selectionStart);
    assert.equal(caret, SOURCE.indexOf('## 第一节'));
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('an embedded mind map renders inside the article', async () => {
  const context = await fixture.browser.newContext({ baseURL: fixture.baseURL, viewport: { width: 1440, height: 1000 } });
  await context.route('**/data/notes.generated.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript; charset=utf-8',
      body: `window.NOTES=${JSON.stringify([EMBED_NOTE])};\nwindow.NOTES_META=${JSON.stringify(EMBED_META)};`
    })
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto('/note.html?slug=map-embed');
    await page.waitForSelector('.mindmap-embed__host svg');
    assert.ok(await page.locator('.mindmap-embed .mm-node').count() >= 3);
    assert.equal(await page.isVisible('.mindmap-embed__source'), false);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});
