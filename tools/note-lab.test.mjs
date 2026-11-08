import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from './browser-fixture.mjs';

let fixture;
before(async () => { fixture = await openBrowser(); });
after(async () => { await fixture?.close(); });
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

async function labPage(body) {
  const page = await fixture.context.newPage();
  await page.route('**/lab-fixture.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-skin="pixel"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="assets/css/core.css"><link rel="stylesheet" href="assets/css/article.css"><link rel="stylesheet" href="assets/css/note-lab.css"></head><body><main class="container"><article class="article" data-note-article>${body}</article></main><script src="assets/js/note-lab.js"></script></body></html>` }));
  await page.goto('/lab-fixture.html');
  return page;
}
const code = (lang, text) => `<div class="code-block" data-lang="${lang}"><pre><code>${escape(text)}</code></pre></div>`;
const wave = text => `<div class="diagram-block"><div class="diagram-head">WAVEDROM</div><div class="wavedrom">${escape(text)}</div></div>`;

test('PWM responds to keyboard controls and handles zero and full duty', async () => {
  const page = await labPage(code('pwm', '{"frequency":1000,"duty":50,"voltage":3.3}'));
  try {
    assert.equal(await page.locator('[data-lab="pwm"]').count(), 1);
    assert.match(await page.locator('[data-value="average"]').textContent(), /1\.650/);
    const duty = page.getByRole('slider', { name: '占空比' });
    await duty.press('Home');
    assert.match(await page.locator('[data-value="average"]').textContent(), /0\.000/);
    await duty.press('End');
    assert.match(await page.locator('[data-value="average"]').textContent(), /3\.300/);
    assert.doesNotMatch(await page.locator('[data-lab="pwm"] path').getAttribute('d'), /NaN|Infinity/);
  } finally { await page.close(); }
});

test('RC exposes tau and the analytic charge at one and five time constants', async () => {
  const page = await labPage(code('rc', '{"resistance":1000,"capacitance":100,"voltage":5}'));
  try {
    assert.equal(await page.locator('[data-lab="rc"]').count(), 1);
    assert.match(await page.locator('[data-value="tau"]').textContent(), /100\.00 ms/);
    assert.match(await page.locator('[data-value="charge"]').textContent(), /3\.161 V/);
    await page.getByRole('slider', { name: '观察时刻' }).press('End');
    assert.match(await page.locator('[data-value="charge"]').textContent(), /4\.966 V/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  } finally { await page.close(); }
});

test('lab JSON cannot carry executable or unbounded configuration', async () => {
  const page = await labPage(code('pwm', '{"frequency":0}') + code('rc', '{"resistance":1e99}') + code('pwm', '{"onchange":"alert(1)"}') + code('rc', '{ broken'));
  try {
    assert.equal(await page.locator('[data-lab]').count(), 0);
    assert.equal(await page.locator('.lab-error').count(), 4);
    assert.equal(await page.locator('.code-block').count(), 4, 'source remains available after rejection');
  } finally { await page.close(); }
});

test('WaveDrom renders digital signals and rejects markup and oversized lanes', async () => {
  const source = JSON.stringify({ signal: [{ name: 'CLK', wave: 'p.......' }, { name: 'DATA', wave: 'x.3...x.', data: ['0x42'] }], config: { hscale: 1 } });
  const attack = JSON.stringify({ signal: [{ name: ['tspan', { onclick: 'alert(1)' }, 'BAD'], wave: '01' }] });
  const tooLong = JSON.stringify({ signal: [{ name: 'LONG', wave: '0'.repeat(501) }] });
  const page = await labPage(wave(source) + wave(attack) + wave(tooLong));
  try {
    await page.waitForFunction(() => document.querySelector('.wavedrom svg') || document.querySelector('.lab-error'), null, { timeout: 5000 });
    assert.equal(await page.locator('.wavedrom svg').count(), 1);
    assert.match(await page.locator('.wavedrom').first().textContent(), /CLK/);
    assert.equal(await page.locator('.lab-error').count(), 2);
    assert.equal(await page.locator('.wavedrom [onclick],.wavedrom script').count(), 0);
  } finally { await page.close(); }
});

test('WaveDrom paints dark lanes in the pixel theme and re-renders on theme change', async () => {
  const source = JSON.stringify({ signal: [{ name: 'CLK', wave: 'p....' }, { name: 'BUS', wave: '2..3.', data: ['A5', '5A'] }] });
  const page = await labPage(wave(source));
  const laneCss = () => page.evaluate(() => document.querySelector('.wavedrom svg style').textContent);
  const lightOnly = () => page.evaluate(() => {
    const svg = document.querySelector('.wavedrom svg');
    const paints = [...svg.querySelectorAll('*')].map(el => {
      const s = getComputedStyle(el);
      return `${s.fill} ${s.stroke}`;
    }).join(' ');
    return { white: paints.includes('rgb(255, 255, 255)'), blue: paints.includes('rgb(0, 65, 196)') };
  });
  try {
    await page.waitForFunction(() => document.querySelector('.wavedrom svg'), null, { timeout: 5000 });
    assert.match(await laneCss(), /#150c27/, 'pixel theme paints the lane background dark');
    assert.doesNotMatch(await laneCss(), /fill:#fff[;}]/, 'pixel theme drops the datasheet white');
    assert.deepEqual(await lightOnly(), { white: false, blue: false }, 'no datasheet-only colour survives in pixel');
    await page.evaluate(() => { document.documentElement.dataset.skin = 'line'; document.dispatchEvent(new CustomEvent('kawaii:skinchange', { detail: { skin: 'line' } })); });
    await page.waitForFunction(() => /fill:#fff/.test(document.querySelector('.wavedrom svg style').textContent), null, { timeout: 5000 });
    assert.doesNotMatch(await laneCss(), /#150c27/);
    assert.deepEqual(await lightOnly(), { white: true, blue: true }, 'line theme keeps the datasheet palette');
  } finally { await page.close(); }
});

test('note kind filtering combines with search, persists in URL and resets', async () => {
  const page = await fixture.context.newPage();
  const notes = ['article', 'concept', 'experiment', 'debug', 'cornell', 'review'].map(kind => ({ slug: kind, title: kind, kind, date: '2026-11-06', tags: [], summary: `${kind} test`, text: kind, minutes: 1 }));
  await page.route('**/data/notes.generated.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.NOTES=${JSON.stringify(notes)};window.NOTES_META={count:6,tags:[],tracks:[]};` }));
  try {
    await page.goto('/logs.html');
    assert.equal(await page.locator('[data-logs-kind]').count(), 1);
    assert.doesNotMatch(await page.locator('.note-card__meta').first().textContent(), /LOG/, 'no filler label when the note has no track');
    assert.match(await page.locator('.note-card__kind').first().textContent(), /日志/);
    await page.locator('[data-logs-kind]').selectOption('concept');
    assert.equal(await page.locator('.note-card').count(), 1);
    assert.match(page.url(), /kind=concept/);
    await page.reload();
    assert.equal(await page.locator('[data-logs-kind]').inputValue(), 'concept');
    await page.locator('[data-logs-search]').fill('missing');
    await page.locator('[data-clear-filters]').click();
    assert.equal(await page.locator('.note-card').count(), 6);
    assert.equal(await page.locator('[data-logs-kind]').inputValue(), '');
  } finally { await page.close(); }
});
