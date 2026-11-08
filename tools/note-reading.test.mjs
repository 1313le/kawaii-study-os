import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openBrowser } from './browser-fixture.mjs';

// Independent compiled-HTML fixture: never build or modify the real notes/index.
const escape = value => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const source = ['/* multi-line comment', ' * still a comment', '', ' * final comment */', '',
  `const long = "${'long_unbroken_value_'.repeat(24)}";`,
  ...Array.from({ length: 22 }, (_, i) => `const value${i} = ${i};`), ''].join('\n');
const diagramSource = 'flowchart LR\n A[Read] --> B[Understand]\n click A evilCallback "unsafe callback"';
const badSource = 'this is not a diagram\n<script>window.evilCallback()</script>';
const codeHTML = (id, text) => `<div id="${id}" class="code-block" data-lang="javascript"><div class="code-head"><span class="code-lang">javascript</span><button type="button" class="code-copy" data-copy>COPY</button></div><pre><code class="language-javascript">${escape(text)}</code></pre></div>`;
const diagramHTML = (id, text) => `<div id="${id}" class="diagram-block"><div class="diagram-head"><span>MERMAID</span><i class="diagram-dot"></i></div><div class="mermaid">${escape(text)}</div><noscript><pre>${escape(text)}</pre></noscript></div>`;
const html = `<h2 id="reading">阅读回归 / Reading</h2><p>正文包含 <mark>重要结论</mark>、H<sub>2</sub>O、x<sup>2</sup> 和 <a class="wiki-link" href="note.html?slug=back">相关笔记</a> <span class="wiki-link wiki-link--missing">未建笔记</span>。<sup class="footnote-ref"><a id="fnref1" href="#fn1">[1]</a></sup></p>
${codeHTML('long-code', source)}${codeHTML('short-code', Array.from({ length: 18 }, () => 'const x = 1;').join('\n'))}
${diagramHTML('good-diagram', diagramSource)}${diagramHTML('bad-diagram', badSource)}
<details id="closed-details"><summary>折叠答案</summary><p>打印时必须可见</p>${codeHTML('details-code', source)}</details><details id="open-details" open><summary>已经展开</summary><p>保持展开</p></details>
<dl><dt>定义术语</dt><dd>定义正文，窄屏不能越界。</dd></dl><ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" disabled checked>已完成</li><li class="task-list-item"><input type="checkbox" disabled>待完成</li></ul>
<section class="footnotes"><ol><li id="fn1">脚注正文 <a class="footnote-backref" href="#fnref1">返回</a></li></ol></section>`;
const fixture = (kind, fx = 'signal') => [{ slug: 'reading-fixture', title: '静态博客阅读回归', date: '2026-11-06', kind,
  summary: '独立浏览器夹具，不写真实笔记。', tags: ['test'], accent: 'cyan', fx, cover: '', collection: '随笔',
  minutes: 4, words: 500,
  toc: [{ id: 'reading', text: '阅读回归 / Reading', depth: 2 }], html,
  backlinks: [{ slug: 'back with space', title: '<反向引用> & 阅读' }] }];
let harness;
const missingLab = new Set();
before(async () => { harness = await openBrowser(); });
after(async () => {
  await harness?.close();
  if (missingLab.size) console.log('Pending companion assets (404):', [...missingLab].join(', '));
});

async function pageFixture(t, { kind = 'concept', fx = 'signal', failHighlight = false, failMermaid = false } = {}) {
  const context = await harness.browser.newContext({ baseURL: harness.baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('response', response => {
    if (response.status() === 404 && /note-lab\.(js|css)$/.test(response.url())) missingLab.add(new URL(response.url()).pathname);
  });
  await page.route('**/data/notes.generated.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.NOTES=${JSON.stringify(fixture(kind, fx))};window.NOTES_META={updated:'2026-11-06',count:1};` }));
  if (failHighlight) await page.route('**/assets/vendor/highlight.min.js', route => route.abort());
  if (failMermaid) await page.route('**/assets/vendor/mermaid.min.js', route => route.abort());
  await page.addInitScript(() => {
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } });
    window.__evil = 0;
    window.evilCallback = () => { window.__evil++; };
    // Delay only completion; every SVG still comes from the real Mermaid library.
    let mermaid;
    Object.defineProperty(window, 'mermaid', {
      configurable: true, get: () => mermaid,
      set(value) {
        mermaid = value;
        const render = value.render.bind(value);
        value.render = async (...args) => {
          const result = await render(...args);
          if (window.__holdRender) {
            window.__holdRender = false;
            window.__renderHeld = true;
            await new Promise(resolve => { window.__releaseRender = resolve; });
          }
          return result;
        };
      }
    });
  });
  await page.goto('note.html?slug=reading-fixture');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#long-code'));
  return page;
}
async function rendered(page) {
  await page.waitForFunction(() => document.querySelector('#good-diagram .mermaid svg'));
}
async function changeSkin(page, skin) {
  await page.evaluate(skin => {
    document.documentElement.dataset.skin = skin;
    document.dispatchEvent(new CustomEvent('kawaii:skinchange', { detail: { skin } }));
  }, skin);
}
async function dimensions(locator) {
  return locator.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, height: el.clientHeight, scrollHeight: el.scrollHeight }));
}

// Break caught: losing original text, splitting highlight markup rather than DOM, or numbering blank lines incorrectly.
test('code preserves blank lines and multi-line highlighting; copy has no line numbers', async t => {
  const page = await pageFixture(t);
  await page.waitForFunction(() => window.hljs);
  assert.equal(await page.locator('#long-code .code-line').count(), 29, 'one wrapper per logical line including final blank');
  const lines = await page.locator('#long-code .code-line').allTextContents();
  assert.equal(lines.join('\n'), source);
  assert.equal(await page.locator('#long-code .code-line').nth(1).locator('.hljs-comment').textContent(), ' * still a comment');
  assert.equal(await page.locator('#long-code .code-line').nth(3).locator('.hljs-comment').textContent(), ' * final comment */');
  assert.ok((await page.locator('#long-code .code-line').nth(2).boundingBox()).height > 15);
  assert.notEqual(await page.locator('#long-code .code-line').first().evaluate(el => getComputedStyle(el, '::before').content), 'none');
  await page.locator('#long-code [data-copy]').click();
  assert.equal(await page.evaluate(() => window.__copied), source);
});

// Break caught: controls tied to highlighter success, fold clipping remaining after expand, or wrap not changing real dimensions.
for (const failHighlight of [false, true]) test(`wrap/fold changes actual layout (highlight failure=${failHighlight})`, async t => {
  const page = await pageFixture(t, { failHighlight });
  assert.equal(await page.locator('#long-code [data-code-fold]').count(), 1);
  assert.equal(await page.locator('#short-code [data-code-fold]').count(), 0, '18 lines must not collapse');
  const fold = page.locator('#long-code [data-code-fold]');
  const pre = page.locator('#long-code pre');
  assert.equal(await fold.getAttribute('aria-expanded'), 'false');
  const collapsed = await dimensions(pre);
  await fold.click();
  assert.equal(await fold.getAttribute('aria-expanded'), 'true');
  const expanded = await dimensions(pre);
  assert.ok(expanded.height > collapsed.height + 100);
  assert.ok(expanded.scroll > expanded.width + 100);
  assert.ok(expanded.scrollHeight <= expanded.height + 2);
  await page.locator('#long-code [data-code-wrap]').click();
  assert.equal(await page.locator('#long-code [data-code-wrap]').getAttribute('aria-pressed'), 'true');
  const wrapped = await dimensions(pre);
  assert.ok(wrapped.scroll <= wrapped.width + 2, JSON.stringify(wrapped));
  assert.ok(wrapped.height > expanded.height);
  await page.locator('#long-code [data-copy]').click();
  assert.equal(await page.evaluate(() => window.__copied), source);
  await page.locator('#long-code [data-code-wrap]').click();
  assert.equal(await page.locator('#long-code [data-code-wrap]').getAttribute('aria-pressed'), 'false');
  await fold.click();
  assert.ok(Math.abs((await dimensions(pre)).height - collapsed.height) < 2);
});

// Break caught: unsafe Mermaid config, error output replacing source, missing native dialog focus/zoom/source contract.
test('strict Mermaid, source fallback, native dialog zoom and Escape focus return', async t => {
  const page = await pageFixture(t);
  await rendered(page);
  assert.equal(await page.locator('#good-diagram .clickable').count(), 0, 'strict mode disallows callback click bindings');
  await page.locator('#good-diagram .node').first().click();
  assert.equal(await page.evaluate(() => window.__evil), 0);
  assert.equal(await page.locator('.diagram-head [data-diagram-open]').count(), 2);
  assert.equal(await page.locator('.diagram-head [data-diagram-source]').count(), 2);
  const opener = page.locator('#good-diagram [data-diagram-open]');
  await opener.click();
  const dialog = page.locator('dialog.diagram-dialog');
  assert.equal(await dialog.evaluate(el => el.open && el.matches(':modal')), true);
  const initial = await dialog.locator('[data-diagram-preview] svg').boundingBox();
  await dialog.locator('[data-diagram-zoom="in"]').click();
  assert.ok((await dialog.locator('[data-diagram-preview] svg').boundingBox()).width > initial.width * 1.1);
  await dialog.locator('[data-diagram-zoom="in"]').evaluate(el => { for (let i = 0; i < 20; i++) el.click(); });
  assert.equal(await dialog.locator('[data-diagram-zoom="in"]').isDisabled(), true);
  assert.equal(await dialog.locator('[data-diagram-scale]').textContent(), '300%');
  await dialog.locator('[data-diagram-zoom="out"]').evaluate(el => { for (let i = 0; i < 20; i++) el.click(); });
  assert.equal(await dialog.locator('[data-diagram-scale]').textContent(), '50%');
  assert.equal(await dialog.locator('[data-diagram-zoom="out"]').isDisabled(), true);
  await page.keyboard.press('Escape');
  assert.equal(await dialog.evaluate(el => el.open), false);
  assert.equal(await opener.evaluate(el => el === document.activeElement), true);
  await page.locator('#bad-diagram [data-diagram-source]').click();
  assert.equal(await dialog.locator('[data-diagram-source-content]').textContent(), badSource);
  assert.equal(await dialog.locator('script').count(), 0);
  await page.keyboard.press('Escape');
  assert.ok((await page.locator('#bad-diagram .mermaid').textContent()).includes(badSource));
  assert.equal(await page.evaluate(() => typeof window.KawaiiDiagramTools?.enhance), 'function');
  await page.evaluate(() => {
    const block = document.querySelector('#good-diagram');
    window.KawaiiDiagramTools.enhance(block, 'replacement <source>');
    window.KawaiiDiagramTools.enhance(block, 'replacement <source>');
  });
  assert.equal(await opener.count(), 1, 'enhance is idempotent');
  await page.locator('#good-diagram [data-diagram-source]').click();
  assert.equal(await dialog.locator('[data-diagram-source-content]').textContent(), 'replacement <source>');
});

test('Mermaid load failure retains source and working source viewer', async t => {
  const page = await pageFixture(t, { failMermaid: true });
  assert.ok((await page.locator('#good-diagram .mermaid').textContent()).includes(diagramSource));
  assert.equal(await page.locator('#good-diagram [data-diagram-source]').count(), 1);
  await page.locator('#good-diagram [data-diagram-source]').click();
  assert.equal(await page.locator('dialog [data-diagram-source-content]').textContent(), diagramSource);
});

// Break caught: old async render overwrites latest theme after rapid switches.
test('latest theme wins even when earlier real Mermaid completion is held', async t => {
  const page = await pageFixture(t);
  await rendered(page);
  await page.evaluate(() => { window.__holdRender = true; });
  await changeSkin(page, 'line');
  await page.waitForFunction(() => window.__renderHeld);
  await changeSkin(page, 'pixel');
  await changeSkin(page, 'line');
  await changeSkin(page, 'pixel');
  await page.evaluate(() => window.__releaseRender());
  await page.waitForFunction(() => document.querySelector('#good-diagram svg style')?.textContent.includes('#2a1748'));
  // Wait for queued real work and a frame, rather than sleeping past a timer.
  await page.evaluate(async () => {
    if (window.KawaiiDiagramTools?.ready) await window.KawaiiDiagramTools.ready();
    await new Promise(requestAnimationFrame);
  });
  assert.ok((await page.locator('#good-diagram svg style').textContent()).includes('#2a1748'));
  assert.equal(await page.locator('#good-diagram .clickable').count(), 0);
});

// Break caught: printing before render/font/image completion; closed details or code clipped on paper; state not restored.
test('print waits for real render, fonts and images; native print lifecycle restores details', async t => {
  const page = await pageFixture(t);
  await rendered(page);
  let releaseImage, releaseFont;
  await page.route('**/__reading-image.png', async route => {
    await new Promise(resolve => { releaseImage = resolve; });
    await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
  });
  await page.route('**/__reading-font.woff2', async route => {
    await new Promise(resolve => { releaseFont = resolve; });
    const response = await route.fetch({ url: new URL('assets/fonts/i7dOIFdwYjGaAMFtZd_QA1ZbYFc.woff2', harness.baseURL).href });
    await route.fulfill({ response });
  });
  t.after(() => { releaseImage?.(); releaseFont?.(); });
  await page.evaluate(() => {
    const img = new Image(); img.src = '__reading-image.png'; img.alt = 'print fixture'; img.loading = 'lazy';
    document.querySelector('#closed-details').append(img);
    const font = new FontFace('ReadingPrint', 'url(__reading-font.woff2)');
    document.fonts.add(font); font.load();
    window.__holdRender = true;
    window.__printCalled = false;
    window.print = () => { window.__printCalled = true; };
  });
  await changeSkin(page, 'line');
  await page.waitForFunction(() => window.__renderHeld);
  await page.locator('[data-print-page]').click();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.evaluate(() => window.__printCalled), false, 'must wait for rendering');
  await page.evaluate(() => window.__releaseRender());
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.evaluate(() => window.__printCalled), false, 'must wait for font/image');
  assert.ok(releaseFont, 'real font request was started'); releaseFont();
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  assert.equal(await page.evaluate(() => window.__printCalled), false, 'must wait for lazy image');
  assert.ok(releaseImage, 'print must promote lazy images'); releaseImage();
  await page.waitForFunction(() => window.__printCalled);
  await page.evaluate(() => {
    window.__printEvents = [];
    window.addEventListener('beforeprint', () => {
      const pre = document.querySelector('#long-code pre');
      window.__printEvents.push({ type: 'before', details: [...document.querySelectorAll('article details')].every(el => el.open),
        height: pre.clientHeight, scrollHeight: pre.scrollHeight, width: pre.clientWidth, scrollWidth: pre.scrollWidth,
        animation: getComputedStyle(document.querySelector('.diagram-dot')).animationName });
    });
    window.addEventListener('afterprint', () => window.__printEvents.push({ type: 'after', closed: !document.querySelector('#closed-details').open, open: document.querySelector('#open-details').open }));
  });
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  assert.ok(pdf.length > 1000);
  const events = await page.evaluate(() => window.__printEvents);
  const before = events.find(event => event.type === 'before');
  assert.equal(before.details, true);
  assert.ok(before.scrollHeight <= before.height + 2, JSON.stringify(before));
  assert.ok(before.scrollWidth <= before.width + 2, JSON.stringify(before));
  assert.equal(before.animation, 'none');
  assert.deepEqual(events.find(event => event.type === 'after'), { type: 'after', closed: true, open: true });
  assert.equal(await page.locator('#long-code [data-code-fold]').getAttribute('aria-expanded'), 'false');
});

// Break caught: missing/unsafe backlinks, wrong kind labels, controls or new text spilling beyond 390px in either theme.
test('kind, escaped backlinks and both skins fit 390px; save visual evidence', async t => {
  const page = await pageFixture(t);
  assert.ok((await page.locator('[data-note-kicker]').textContent()).includes('概念卡'));
  const backlink = page.locator('[data-note-backlinks] a');
  assert.equal(await backlink.textContent(), '<反向引用> & 阅读');
  assert.equal(await backlink.getAttribute('href'), 'note.html?slug=back%20with%20space');
  assert.equal(await page.locator('[data-note-backlinks]').evaluate(el => Boolean(document.querySelector('article').compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
  await rendered(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const skin of ['pixel', 'line']) {
    await changeSkin(page, skin);
    if (await page.evaluate(() => Boolean(window.KawaiiDiagramTools?.ready))) await page.evaluate(() => window.KawaiiDiagramTools.ready());
    await page.locator('#long-code [data-code-wrap]').click();
    const overflow = await page.evaluate(() => [...document.querySelectorAll('article, .code-head, .diagram-head, .note-backlinks')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.right > 391 || r.left < -1; }).map(el => el.className));
    assert.deepEqual(overflow, []);
    await page.locator('#long-code').scrollIntoViewIfNeeded();
    await page.screenshot({ path: fileURLToPath(new URL(`../.work/note-reading-${skin}-390.png`, import.meta.url)), fullPage: true });
    await page.locator('#long-code [data-code-wrap]').click();
  }
});

for (const [kind, label] of [['article', '日志'], ['experiment', '实验记录'], ['debug', '排障记录'], ['cornell', '问答笔记'], ['review', '周复盘']]) {
  test(`kind=${kind} shows ${label}`, async t => {
    const page = await pageFixture(t, { kind });
    assert.ok((await page.locator('[data-note-kicker]').textContent()).includes(label));
  });
}

// Break caught: the scan overlay bleeds -6% past the column, which adds a horizontal scrollbar on phones.
test('scan fx keeps the document inside a 390px viewport', async t => {
  const page = await pageFixture(t, { fx: 'scan' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#long-code').scrollIntoViewIfNeeded();
  const bleed = await page.evaluate(() => ({
    content: getComputedStyle(document.querySelector('.article'), '::after').content,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  }));
  assert.notEqual(bleed.content, 'none', 'scan overlay must still be painted');
  assert.equal(bleed.overflow, 0, `document overflow: ${bleed.overflow}px`);
});
