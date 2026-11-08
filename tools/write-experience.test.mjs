import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = 4295;
let server;
let browser;
let base;
let notesDir;
let assetDir;

before(async () => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kawaii-exp-notes-'));
  assetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kawaii-exp-assets-'));
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
  await page.goto('/write.html');
  await page.waitForSelector('#write-screen');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  return { page, context, errors };
}

async function clearScreen(page) {
  await page.click('#write-screen');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
}

test('typewriter mode toggles, persists and recenters the caret', async () => {
  const { page, context, errors } = await desk();
  try {
    await clearScreen(page);
    await page.keyboard.type(Array.from({ length: 34 }, (_, i) => `第 ${i + 1} 行`).join('\n'));
    await page.keyboard.press('F8');
    assert.equal(await page.getAttribute('[data-screen]', 'data-typewriter'), 'on');
    assert.equal(await page.getAttribute('[data-write-action="typewriter"]', 'aria-pressed'), 'true');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('kawaii.screen.v1') || '{}').typewriter);
    assert.equal(stored, true);
    const scrolled = await page.evaluate(() => document.querySelector('#write-screen').scrollTop);
    assert.ok(scrolled > 0, 'the caret should be pulled back into the middle of the screen');

    await page.keyboard.press('F8');
    assert.equal(await page.getAttribute('[data-screen]', 'data-typewriter'), 'off');
    assert.equal(await page.getAttribute('[data-write-action="typewriter"]', 'aria-pressed'), 'false');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('focus mode hides the room around the screen and Escape gives the page back', async () => {
  const { page, context, errors } = await desk();
  try {
    await page.keyboard.press('F9');
    assert.equal(await page.evaluate(() => document.body.classList.contains('is-focus')), true);
    assert.equal(await page.isVisible('.desk__intro'), false);
    assert.equal(await page.isVisible('.cowrite'), false);
    assert.equal(await page.getAttribute('[data-write-action="focus"]', 'aria-pressed'), 'true');
    const height = await page.evaluate(() => document.querySelector('[data-screen]').offsetHeight);
    assert.ok(height >= 420, `focus mode should give the screen height, got ${height}`);

    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.body.classList.contains('is-focus')), false);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('the outline reads headings, highlights the current one and jumps the caret', async () => {
  const { page, context, errors } = await desk();
  try {
    const body = '## 第一节\n\n正文一\n\n## 第二节\n\n正文二\n\n### 小节\n\n正文三\n';
    await page.fill('#write-screen', body);
    await page.keyboard.press('F10');
    await page.waitForSelector('[data-write-outline]:not([hidden])');
    const items = await page.$$eval('[data-outline-index]', (nodes) => nodes.map((node) => node.textContent.trim()));
    assert.deepEqual(items, ['第一节', '第二节', '小节']);

    await page.evaluate(() => {
      const input = document.querySelector('#write-screen');
      input.setSelectionRange(input.value.indexOf('正文二'), input.value.indexOf('正文二'));
      input.dispatchEvent(new Event('select'));
    });
    assert.equal(await page.evaluate(() => {
      const active = document.querySelector('[data-outline-index].is-active');
      return active ? active.textContent.trim() : null;
    }), '第二节');

    await page.locator('[data-outline-index]').nth(1).click();
    const caret = await page.evaluate(() => document.querySelector('#write-screen').selectionStart);
    assert.equal(caret, body.indexOf('## 第二节'));
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('the slash menu filters and inserts blocks without leaving stray text', async () => {
  const { page, context, errors } = await desk();
  try {
    await clearScreen(page);
    await page.keyboard.type('/');
    await page.waitForSelector('[data-write-palette]:not([hidden])');
    const all = await page.locator('[data-palette-index]').count();
    assert.ok(all >= 10, `the menu should offer real blocks, got ${all}`);

    await page.keyboard.type('待办');
    await page.waitForFunction(() => document.querySelectorAll('[data-palette-index]').length === 1);
    await page.keyboard.press('Enter');
    assert.equal(await page.inputValue('#write-screen'), '- [ ] ');
    assert.equal(await page.isVisible('[data-write-palette]'), false);

    await clearScreen(page);
    await page.keyboard.type('/表格');
    await page.waitForFunction(() => document.querySelectorAll('[data-palette-index]').length === 1);
    await page.keyboard.press('Enter');
    assert.match(await page.inputValue('#write-screen'), /\| 列 \| 列 \|/);

    await clearScreen(page);
    await page.keyboard.type('/警告');
    await page.waitForFunction(() => document.querySelectorAll('[data-palette-index]').length === 1);
    await page.keyboard.press('Enter');
    assert.match(await page.inputValue('#write-screen'), /^> \[!WARNING\]/);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('[[ completion links an existing note by slug', async () => {
  const { page, context, errors } = await desk();
  try {
    await clearScreen(page);
    await page.keyboard.type('[[gpio');
    await page.waitForSelector('[data-write-palette]:not([hidden])');
    const hint = await page.textContent('[data-palette-index="0"] small');
    assert.match(hint, /stm32-gpio/);
    await page.keyboard.press('Enter');
    assert.equal(await page.inputValue('#write-screen'), '[[stm32-gpio]]');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('the status bar counts words and the current selection', async () => {
  const { page, context, errors } = await desk();
  try {
    await page.fill('#write-screen', 'abc 中文测试 def');
    await page.evaluate(() => {
      const input = document.querySelector('#write-screen');
      input.setSelectionRange(0, 3);
      input.dispatchEvent(new Event('select'));
    });
    assert.equal(await page.isVisible('[data-write-selection]'), true);
    assert.match(await page.textContent('[data-write-selection]'), /SEL 1 字/);
    assert.match(await page.textContent('[data-write-words]'), /6 字/);

    await page.evaluate(() => {
      const input = document.querySelector('#write-screen');
      input.setSelectionRange(0, 0);
      input.dispatchEvent(new Event('select'));
    });
    assert.equal(await page.isVisible('[data-write-selection]'), false);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('saving leaves a snapshot and restoring it takes two deliberate clicks', async () => {
  const { page, context, errors } = await desk();
  try {
    await page.fill('[data-meta="title"]', '快照验收');
    await page.fill('[data-meta="slug"]', 'snapshot-check');
    await page.fill('#write-screen', '版本一的内容。');
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => /已保存/.test(document.querySelector('[data-write-saved]').textContent));

    await page.fill('#write-screen', '版本二的内容。');
    await page.click('[data-snapshots-open]');
    await page.waitForSelector('[data-snapshots][open]');
    await page.waitForFunction(() => document.querySelectorAll('[data-snapshot-restore]').length > 0);
    assert.match(await page.textContent('[data-snapshots-list]'), /snapshot-check/);

    await page.click('[data-snapshot-restore]');
    assert.match(await page.textContent('[data-snapshots-status]'), /再点一次/);
    assert.equal(await page.inputValue('#write-screen'), '版本二的内容。', 'the first click only arms the restore');
    await page.click('[data-snapshot-restore]');
    await page.waitForFunction(() => document.querySelector('#write-screen').value === '版本一的内容。');
    assert.match(await page.textContent('[data-snapshots-status]'), /已恢复到/);
    const reasons = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('kawaii.snapshots.v1') || '[]').map((item) => item.reason));
    assert.ok(reasons.includes('before-restore'), 'restoring itself must be reversible');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('a pasted image uploads and lands in the markdown as a local asset', async () => {
  const { page, context, errors } = await desk();
  try {
    await clearScreen(page);
    await page.evaluate(() => {
      const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const file = new File([bytes], 'pixel.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
      document.querySelector('#write-screen').dispatchEvent(event);
    });
    await page.waitForFunction(() => /assets\/img\/paste-.*-cover\.png/.test(document.querySelector('#write-screen').value), null, { timeout: 8000 });
    const value = await page.inputValue('#write-screen');
    assert.match(value, /^!\[pixel\]\(assets\/img\/paste-[a-z0-9]+-cover\.png\)$/);
    const files = fs.readdirSync(assetDir).filter((name) => /^paste-.*-cover\.png$/.test(name));
    assert.equal(files.length, 1, 'the PNG really landed on disk');
    assert.match(await page.textContent('[data-write-saved]'), /图片已插入正文/);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

const CHECK_NOTE = {
  slug: 'check-note',
  title: '清单测试',
  date: '2026-11-08',
  kind: 'article',
  summary: '勾选持久化验收',
  tags: ['测试'],
  collection: '随笔',
  cover: '',
  accent: 'lime',
  fx: 'reveal',
  minutes: 1,
  words: 12,
  toc: [{ id: 'sec-1', text: '清单', depth: 2 }],
  html: '<h2 id="sec-1">清单</h2><ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" disabled>任务一</li><li class="task-list-item"><input type="checkbox" disabled>任务二</li></ul>',
  text: '清单',
  backlinks: []
};

test('a note checklist accepts ticks and remembers them per slug after reload', async () => {
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } });
  await context.route('**/data/notes.generated.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript; charset=utf-8',
      body: `window.NOTES=${JSON.stringify([CHECK_NOTE])};\nwindow.NOTES_META=${JSON.stringify({ count: 1, updated: '2026-11-08', tags: [{ name: '测试', count: 1 }], collections: [{ name: '随笔', count: 1 }] })};`
    })
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto('/note.html?slug=check-note');
    await page.waitForSelector('[data-note-taskbar]:not([hidden])');
    assert.match(await page.textContent('[data-note-taskbar]'), /0 \/ 2/);

    await page.locator('.article input[type="checkbox"]').first().check();
    await page.waitForFunction(() => /1 \/ 2/.test(document.querySelector('[data-note-taskbar]').textContent));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('kawaii.tasks.v1'))['check-note'][0]), true);

    await page.reload();
    await page.waitForSelector('[data-note-taskbar]:not([hidden])');
    assert.equal(await page.locator('.article input[type="checkbox"]').first().isChecked(), true);
    assert.match(await page.textContent('[data-note-taskbar]'), /1 \/ 2/);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('the writer preview renders callouts, SEC labels, labs and embedded maps', async () => {
  const { page, context, errors } = await desk();
  try {
    const body = '## 输出：推挽与开漏\n\n> [!WARNING]\n> 开漏没有外部上拉会漂。\n\n```pwm\n{"frequency": 1000, "duty": 30, "voltage": 3.3}\n```\n\n```mindmap\n# 中心主题\n## 分支\n- 要点\n```\n';
    await page.fill('#write-screen', body);
    await page.keyboard.press('F1');
    await page.waitForSelector('.screen__preview .callout-warning', { timeout: 8000 });
    assert.match(await page.textContent('.screen__preview .callout-warning'), /开漏没有外部上拉/);
    const sec = await page.evaluate(() => getComputedStyle(document.querySelector('.screen__preview h2'), '::before').content);
    assert.match(sec, /SEC\./);
    assert.match(sec, /counter\(h2counter/);
    assert.equal(await page.locator('.screen__preview .code-block[data-lang="pwm"]').count(), 1);
    await page.waitForSelector('.screen__preview .mindmap-embed__host svg', { timeout: 8000 });
    assert.ok(await page.locator('.screen__preview .mm-node').count() >= 3);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('four primary keys stay on the deck and F5–F10 live behind the Fn key', async () => {
  const { page, context, errors } = await desk();
  try {
    assert.equal(await page.locator('.keys-primary .keycap').count(), 4, 'only the four writing keys stay on the deck');
    assert.equal(await page.locator('.unit__keys > .keycap').count(), 1, 'the Fn key is the fifth visible key');
    assert.equal(await page.locator('[data-fn-deck]').isHidden(), true);
    assert.equal(await page.locator('.fn-deck .fn-key').count(), 6);

    await page.click('[data-fn-open]');
    await page.waitForSelector('[data-fn-deck]:not([hidden])');
    assert.equal(await page.getAttribute('[data-fn-open]', 'aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('fn-key')), true, 'focus enters the function deck');

    await page.click('.fn-deck [data-write-action="typewriter"]');
    assert.equal(await page.getAttribute('[data-screen]', 'data-typewriter'), 'on');
    assert.equal(await page.getAttribute('.fn-deck [data-write-action="typewriter"]', 'aria-pressed'), 'true');
    assert.equal(await page.getAttribute('[data-fn-open]', 'aria-expanded'), 'true', 'toggles keep the deck open');
    assert.equal(await page.evaluate(() => document.querySelector('[data-fn-led]').classList.contains('is-on')), true,
      'the Fn key lights while an extended mode is on');

    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-fn-deck]').isHidden(), true);
    assert.equal(await page.getAttribute('[data-fn-open]', 'aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('keycap--fn')), true,
      'Escape sends focus back to the Fn key');
    assert.equal(await page.evaluate(() => document.querySelector('[data-fn-led]').classList.contains('is-on')), true);

    await page.keyboard.press('F8');
    assert.equal(await page.getAttribute('[data-screen]', 'data-typewriter'), 'off');
    assert.equal(await page.evaluate(() => document.querySelector('[data-fn-led]').classList.contains('is-on')), false,
      'the LED also clears when the shortcut turns the mode off');

    await page.click('[data-fn-open]');
    await page.click('#write-screen');
    await page.waitForTimeout(80);
    assert.equal(await page.locator('[data-fn-deck]').isHidden(), true, 'clicking outside dismisses the deck');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('the phone desk keeps all five keys on one row and inside the viewport', async () => {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 390, height: 844 },
    storageState: {
      cookies: [],
      origins: [{ origin: base, localStorage: [{ name: 'kawaii.skin.v1', value: 'pixel' }] }]
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto('/write.html');
    await page.waitForSelector('#write-screen');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    const layout = await page.evaluate(() => {
      const keys = [...document.querySelectorAll('.unit__keys .keycap')];
      const tops = [...new Set(keys.map((key) => Math.round(key.getBoundingClientRect().top)))];
      const box = document.querySelector('.unit__keys').getBoundingClientRect();
      return {
        count: keys.length,
        rows: tops.length,
        bottom: Math.round(box.bottom),
        viewport: window.innerHeight,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    assert.equal(layout.count, 5, 'four primary keys plus Fn');
    assert.equal(layout.rows, 1, 'the phone keyboard is one row');
    assert.ok(layout.bottom <= layout.viewport, `keyboard ends at ${layout.bottom}px inside ${layout.viewport}px`);
    assert.equal(layout.overflow, 0, 'no horizontal overflow on the phone');

    await page.click('[data-fn-open]');
    await page.waitForSelector('[data-fn-deck]:not([hidden])');
    const deck = await page.locator('[data-fn-deck]').boundingBox();
    assert.ok(deck.x >= 0 && deck.y >= 0 && deck.x + deck.width <= 390 && deck.y + deck.height <= 844, 'the deck stays on screen');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});

test('the keyboard row lands inside a laptop first screen, not below the fold', async () => {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 900 },
    storageState: {
      cookies: [],
      origins: [{ origin: base, localStorage: [{ name: 'kawaii.skin.v1', value: 'pixel' }] }]
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await page.goto('/write.html');
    await page.waitForSelector('#write-screen');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    const layout = await page.evaluate(() => {
      const keys = document.querySelector('.unit__keys').getBoundingClientRect();
      return {
        keysBottom: Math.round(keys.bottom),
        viewport: window.innerHeight,
        screen: document.querySelector('.screen').offsetHeight,
        rows: new Set([...document.querySelectorAll('.unit__keys .keycap')].map((key) => Math.round(key.getBoundingClientRect().top))).size,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    assert.ok(layout.keysBottom <= layout.viewport, `keyboard ends at ${layout.keysBottom}px inside ${layout.viewport}px`);
    assert.ok(layout.screen >= 400, `the editor should keep a real writing area, got ${layout.screen}px`);
    assert.equal(layout.rows, 1);
    assert.equal(layout.overflow, 0);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
});
