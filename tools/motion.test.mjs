import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from './browser-fixture.mjs';

let fixture;
before(async () => { fixture = await openBrowser(); });
after(async () => { await fixture?.close(); });

const HASH = () => {
  const canvas = document.querySelector('canvas[data-scene-layer="cat"]');
  if (!canvas) return 'no-canvas';
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 97) sum = (sum * 31 + data[i]) >>> 0;
  return String(sum);
};

async function scenePage({ reduced = false, skin = 'pixel', fx = 'on', motion = '' } = {}) {
  const context = await fixture.browser.newContext({
    baseURL: fixture.baseURL,
    viewport: { width: 1440, height: 1000 },
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    storageState: {
      cookies: [],
      origins: [{
        origin: fixture.baseURL,
        localStorage: [
          { name: 'kawaii.skin.v1', value: skin },
          { name: 'kawaii.fx.v1', value: fx },
          ...(motion ? [{ name: 'kawaii.motion.v1', value: motion }] : [])
        ]
      }]
    }
  });
  const page = await context.newPage();
  await page.goto('index.html');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  return { page, context };
}

async function moving(page) {
  const first = await page.evaluate(HASH);
  await page.waitForTimeout(900);
  return first !== (await page.evaluate(HASH));
}

test('an OS reduce-motion setting no longer freezes the site silently', async () => {
  const { page, context } = await scenePage({ reduced: true });
  try {
    const state = await page.evaluate(() => ({
      motion: document.documentElement.dataset.motion || '',
      chipVisible: !document.querySelector('.motion-note').hidden,
      reason: document.querySelector('[data-motion-reason]').textContent,
      scanDuration: getComputedStyle(document.querySelector('.console-window__visual'), '::after').animationDuration
    }));
    assert.equal(state.chipVisible, true, 'a frozen site must say why it is frozen');
    assert.match(state.reason, /减少动态效果/);
    assert.equal(await moving(page), false, 'the scene should stay still until asked');
    assert.ok(parseFloat(state.scanDuration) < 0.01, 'CSS animations should follow the OS preference by default');
  } finally { await page.close(); await context.close(); }
});

test('one click restores every animation and remembers the choice', async () => {
  const { page, context } = await scenePage({ reduced: true });
  try {
    await page.click('[data-motion-resume]');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'full');
    assert.equal(await page.evaluate(() => document.querySelector('.motion-note').hidden), true);
    assert.equal(await moving(page), true, 'the cat should breathe again');
    const scan = await page.evaluate(() => getComputedStyle(document.querySelector('.console-window__visual'), '::after').animationDuration);
    assert.ok(parseFloat(scan) > 1, `scan sweep is still ${scan}`);

    await page.reload();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'full');
    assert.equal(await moving(page), true, 'the choice must survive a reload');
  } finally { await page.close(); await context.close(); }
});

test('"keep it off" is honoured even when the system allows motion', async () => {
  const { page, context } = await scenePage();
  try {
    await page.evaluate(() => window.KawaiiMotion.set('reduced'));
    await page.waitForTimeout(200);
    const scan = await page.evaluate(() => getComputedStyle(document.querySelector('.console-window__visual'), '::after').animationDuration);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'reduced');
    assert.ok(parseFloat(scan) < 0.01, 'the explicit choice must stop CSS motion too');
    assert.equal(await moving(page), false);
  } finally { await page.close(); await context.close(); }
});

test('an fx-off site offers the same road back', async () => {
  const { page, context } = await scenePage({ fx: 'off' });
  try {
    await page.waitForFunction(() => !document.querySelector('.motion-note').hidden);
    const reason = await page.textContent('[data-motion-reason]');
    assert.match(reason, /FX/);
    await page.click('[data-motion-resume]');
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.fx), 'on');
    assert.equal(await moving(page), true);
  } finally { await page.close(); await context.close(); }
});

test('turning FX back on by hand also lifts the freeze', async () => {
  const { page, context } = await scenePage({ reduced: true, fx: 'off' });
  try {
    await page.click('[data-fx-toggle]');
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.fx), 'on');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), 'full');
    assert.equal(await moving(page), true, 'the explicit FX click should outrank the OS default');
  } finally { await page.close(); await context.close(); }
});
