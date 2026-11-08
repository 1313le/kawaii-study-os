import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from './browser-fixture.mjs';

let fixture;
before(async () => { fixture = await openBrowser(); });
after(async () => { await fixture?.close(); });

const SIGNAL = '.note-page[data-note-fx="signal"] .code-block';
const SCAN = '.note-page[data-note-fx="scan"] .article';
const SWEEP = '.console-window__visual';

// Geometry of a decorative pseudo-element, reconstructed the way the browser lays it
// out: an absolutely positioned pseudo is placed against the padding box of its
// positioned ancestor, so the origin is the host border box plus the host borders.
const MEASURE = `
  const matrixOf = (value) => {
    if (!value || value === 'none') return [1, 0, 0, 1, 0, 0];
    const found = value.match(/matrix(?:3d)?\\(([^)]+)\\)/);
    if (!found) return [1, 0, 0, 1, 0, 0];
    return found[1].split(',').map(Number);
  };
  const number = (value) => {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? null : parsed;
  };
  const corners = (ox, oy, w, h, m) => [[0, 0], [w, 0], [0, h], [w, h]]
    .map(([px, py]) => [ox + px * m[0] + py * m[2] + m[4], oy + px * m[1] + py * m[3] + m[5]]);
  const traceBoxes = (sel) => {
    const out = [];
    for (const host of document.querySelectorAll(sel)) {
      const box = host.getBoundingClientRect();
      const hostStyle = getComputedStyle(host);
      for (const pseudo of ['::before', '::after']) {
        const cs = getComputedStyle(host, pseudo);
        if (!cs.content.startsWith('"') || cs.position !== 'absolute') continue;
        if (cs.animationName === 'none') continue;
        const w = number(cs.width);
        const h = number(cs.height);
        if (!(w > 0) || !(h > 0)) continue;
        const left = number(cs.left);
        const right = number(cs.right);
        const top = number(cs.top);
        const bottom = number(cs.bottom);
        const x = left !== null
          ? box.left + number(hostStyle.borderLeftWidth) + left
          : box.right - number(hostStyle.borderRightWidth) - right - w;
        const y = top !== null
          ? box.top + number(hostStyle.borderTopWidth) + top
          : box.bottom - number(hostStyle.borderBottomWidth) - bottom - h;
        const pts = corners(x, y, w, h, matrixOf(cs.transform));
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        out.push({
          over: Math.max(box.left - Math.min(...xs), Math.max(...xs) - box.right,
            box.top - Math.min(...ys), Math.max(...ys) - box.bottom),
          spans: (Math.max(...xs) - box.left) / box.width,
          climbs: (Math.max(...ys) - box.top) / box.height,
          anim: cs.animationName,
          duration: cs.animationDuration
        });
      }
    }
    return out;
  };
  window.__traceBoxes = (sel) => traceBoxes(sel);
`;

// The poll window has to outlast the slowest cycle in the group: sample only the
// first frame's duration, or the landing frame never appears and the reach
// assertion proves nothing.
async function cycleWindow(page, selector) {
  const boxes = await page.evaluate(`window.__traceBoxes(${JSON.stringify(selector)})`);
  const slowest = Math.max(0, ...boxes.map((box) => parseFloat(box.duration) || 0));
  return Math.round(slowest * 1250) + 1000;
}

async function openTracedPage(page, url, selector) {
  await page.goto(url);
  await page.locator(selector).first().waitFor();
  await page.evaluate(`(() => { ${MEASURE} })()`);
}

// The skin lives in origin localStorage, so a page that forces one needs its own
// context: pages in the shared fixture context would inherit it afterwards.
async function openTracedPageInSkin(browser, baseURL, url, selector, skin) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL });
  const page = await context.newPage();
  await page.addInitScript((value) => localStorage.setItem('kawaii.skin.v1', value), skin);
  await openTracedPage(page, url, selector);
  return { context, page };
}

// Live polling is the only reading that matches what the browser paints: a
// pseudo-element's computed transform refreshes on the next task, so WAAPI
// stepping reports the previous frame. The window must span a full cycle.
async function pollTrace(page, selector, ms = 6000, tick = 50) {
  let worstOver = -Infinity;
  let bestSpan = 0;
  let bestClimb = 0;
  let samples = 0;
  const names = new Set();
  for (let t = 0; t < ms; t += tick) {
    const boxes = await page.evaluate(`window.__traceBoxes(${JSON.stringify(selector)})`);
    samples += boxes.length;
    for (const box of boxes) {
      names.add(box.anim);
      worstOver = Math.max(worstOver, box.over);
      bestSpan = Math.max(bestSpan, box.spans);
      bestClimb = Math.max(bestClimb, box.climbs);
    }
    await page.waitForTimeout(tick);
  }
  return { worstOver, bestSpan, bestClimb, samples, names: [...names].sort() };
}

test('signal trace stays on the code-block frame while crossing it', async () => {
  const page = await fixture.context.newPage();
  await openTracedPage(page, '/note.html?slug=pwm-duty', SIGNAL);
  try {
    const { worstOver, bestSpan, names } = await pollTrace(page, SIGNAL);
    assert.ok(worstOver <= 6, `trace escapes the frame by ${worstOver.toFixed(1)}px (${names})`);
    assert.ok(
      names.filter((n) => n.startsWith('trace')).length >= 2,
      `expected a top and a bottom trace, saw ${names}`
    );
    assert.ok(bestSpan >= 0.9, `trace only reaches ${bestSpan.toFixed(2)} of the block width`);
  } finally { await page.close(); }
});

// Each skin re-sizes the band, so both need their own full-cycle run: a mismatch
// between the band height and the travel only shows on the landing frame.
for (const { skin, slug } of [
  { skin: 'pixel', slug: 'hello-study-os' },
  { skin: 'line', slug: 'cornell-stm32-clock' }
]) {
  test(`scan band sweeps the ${skin} article column without leaving it`, async () => {
    const { context, page } = await openTracedPageInSkin(
      fixture.browser, fixture.baseURL, `/note.html?slug=${slug}`, SCAN, skin
    );
    try {
      const { worstOver, bestClimb, samples, names } = await pollTrace(page, SCAN, await cycleWindow(page, SCAN));
      assert.ok(samples > 0, 'no scan band was measured at all');
      assert.equal(names.length, 1, `expected one scan animation, saw ${names}`);
      assert.ok(names[0] === 'articleScan', `expected articleScan, saw ${names}`);
      assert.ok(worstOver <= 1, `scan band escapes the column by ${worstOver.toFixed(1)}px`);
      assert.ok(
        bestClimb >= 0.9,
        `scan band only reaches ${bestClimb.toFixed(2)} of the article height`
      );
    } finally { await context.close(); }
  });
}

test('console sweep stays inside the clipped screen', async () => {
  const page = await fixture.context.newPage();
  await openTracedPage(page, '/index.html', SWEEP);
  try {
    const { worstOver, bestClimb, samples, names } = await pollTrace(page, SWEEP);
    assert.ok(samples > 0, 'no console sweep was measured at all');
    assert.deepEqual(names, ['scanSweep']);
    assert.ok(worstOver <= 1, `sweep leaves the screen by ${worstOver.toFixed(1)}px`);
    assert.ok(
      bestClimb >= 0.95,
      `sweep only reaches ${bestClimb.toFixed(2)} of the screen height`
    );
  } finally { await page.close(); }
});

test('signal trace rests inside the frame for reduced motion', async () => {
  const page = await fixture.context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/note.html?slug=pwm-duty');
  await page.locator(SIGNAL).first().waitFor();
  try {
    const boxes = await page.evaluate((sel) => {
      const host = document.querySelector(sel);
      return ['::before', '::after'].map((p) => ({
        name: getComputedStyle(host, p).animationName,
        duration: getComputedStyle(host, p).animationDuration
      }));
    }, SIGNAL);
    assert.equal(boxes.length, 2);
    for (const box of boxes) {
      assert.ok(
        box.name === 'none' || parseFloat(box.duration) < 1,
        `reduced motion keeps a ${box.duration} "${box.name}" trace running`
      );
    }
  } finally { await page.close(); }
});
