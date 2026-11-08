import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from './browser-fixture.mjs';

let fixture;
before(async () => { fixture = await openBrowser(); });
after(async () => { await fixture?.close(); });

const TEMPLATES = ['circuit', 'waveform', 'grid', 'ladder', 'chip', 'terminal'];

async function page(url, skin = 'pixel') {
  const context = await fixture.browser.newContext({
    baseURL: fixture.baseURL,
    viewport: { width: 1440, height: 1000 },
    storageState: { cookies: [], origins: [{ origin: fixture.baseURL, localStorage: [{ name: 'kawaii.skin.v1', value: skin }] }] }
  });
  const target = await context.newPage();
  await target.goto(url);
  await target.keyboard.press('Escape');
  return { target, close: () => context.close() };
}

test('every card has a cover: a photo, a chosen template or one its kind implies', async () => {
  const { target, close } = await page('/logs.html');
  try {
    await target.waitForSelector('.note-card');
    const report = await target.evaluate(() => {
      const cards = [...document.querySelectorAll('.note-card')];
      return {
        cards: cards.length,
        covered: cards.filter((card) => card.querySelector('img, .cover-tpl')).length,
        templates: cards.map((card) => card.querySelector('.cover-tpl')?.dataset.template).filter(Boolean),
        placeholder: /NO COVER/.test(document.body.textContent),
        svgless: cards.filter((card) => card.querySelector('.cover-tpl') && !card.querySelector('.cover-tpl svg')).length
      };
    });
    assert.equal(report.cards, 10);
    assert.equal(report.covered, report.cards, 'a card without any cover media would fall back to the empty placeholder');
    assert.equal(report.placeholder, false, 'the NO COVER placeholder is still rendering');
    assert.equal(report.svgless, 0, 'a template cover must carry its drawing');
    for (const id of report.templates) assert.ok(TEMPLATES.includes(id), `unknown template ${id}`);
    assert.ok(report.templates.length >= 3, 'the library should show more than one template');
  } finally { await target.close(); await close(); }
});

test('the same note always draws the same cover', async () => {
  const { target, close } = await page('/logs.html');
  try {
    await target.waitForSelector('.note-card .cover-tpl');
    const read = () => target.evaluate(() => {
      const node = document.querySelector('.note-card .cover-tpl');
      const card = node.closest('.note-card');
      return { slug: card.getAttribute('href'), html: node.innerHTML };
    });
    const first = await read();
    await target.reload();
    await target.keyboard.press('Escape');
    await target.waitForSelector('.note-card .cover-tpl');
    const second = await read();
    assert.equal(second.slug, first.slug);
    assert.equal(second.html, first.html, 'seeded drawing must not reshuffle between loads');
  } finally { await target.close(); await close(); }
});

test('hovering a cover plays one sweep instead of an ambient loop', async () => {
  const { target, close } = await page('/logs.html');
  try {
    const card = target.locator('.note-card', { has: target.locator('.cover-tpl[data-template="waveform"]') }).first();
    await card.scrollIntoViewIfNeeded();
    const idle = await target.evaluate(() => {
      const wave = document.querySelector('.cover-tpl[data-template="waveform"] .ct-wave');
      return getComputedStyle(wave).animationName;
    });
    assert.equal(idle, 'none', 'the cover must rest until the pointer arrives');

    await card.hover();
    await target.waitForFunction(() =>
      getComputedStyle(document.querySelector('.cover-tpl[data-template="waveform"] .ct-wave')).animationName === 'ctDraw');
    const playing = await target.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.cover-tpl[data-template="waveform"] .ct-wave'));
      return { name: cs.animationName, iteration: cs.animationIterationCount };
    });
    assert.equal(playing.iteration, '1', 'a hover is a state change, not a loop');
  } finally { await target.close(); await close(); }
});

test('fx off leaves the drawing static', async () => {
  const context = await fixture.browser.newContext({
    baseURL: fixture.baseURL,
    viewport: { width: 1440, height: 1000 },
    storageState: { cookies: [], origins: [{ origin: fixture.baseURL, localStorage: [
      { name: 'kawaii.skin.v1', value: 'pixel' },
      { name: 'kawaii.fx.v1', value: 'off' }
    ] }] }
  });
  const target = await context.newPage();
  try {
    await target.goto('/logs.html');
    await target.keyboard.press('Escape');
    await target.waitForSelector('.cover-tpl');
    const card = target.locator('.note-card', { has: target.locator('.cover-tpl') }).first();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await target.waitForTimeout(200);
    const names = await target.evaluate(() =>
      [...document.querySelectorAll('.cover-tpl *')].map((node) => getComputedStyle(node).animationName));
    assert.ok(names.every((name) => name === 'none'), `fx off still runs ${names.filter((n) => n !== 'none')}`);
  } finally { await target.close(); await context.close(); }
});

test('a note with a template cover shows it in the article header', async () => {
  const { target, close } = await page('/note.html?slug=debug-i2c-pullup');
  try {
    await target.waitForSelector('.note-cover .cover-tpl');
    const info = await target.evaluate(() => ({
      template: document.querySelector('.note-cover .cover-tpl').dataset.template,
      caption: document.querySelector('.note-cover__caption').textContent,
      width: Math.round(document.querySelector('.note-cover .cover-tpl').getBoundingClientRect().width)
    }));
    assert.equal(info.template, 'chip');
    assert.match(info.caption, /DEBUG-I2C-PULLUP/);
    assert.ok(info.width > 300, `the cover collapsed to ${info.width}px`);
  } finally { await target.close(); await close(); }
});

test('the line skin draws the same covers in its own palette', async () => {
  const { target, close } = await page('/logs.html', 'line');
  try {
    await target.waitForSelector('.cover-tpl');
    const colors = await target.evaluate(() => ({
      wave: getComputedStyle(document.querySelector('.cover-tpl[data-template="waveform"] .ct-wave')).stroke,
      accent: getComputedStyle(document.querySelector('.cover-tpl[data-template="waveform"]')).getPropertyValue('--cover-accent').trim()
    }));
    assert.ok(colors.accent.length > 0, 'the cover must inherit the note accent');
    assert.notEqual(colors.wave, 'rgb(255, 95, 210)', 'the line skin should not paint the pixel accent');
  } finally { await target.close(); await close(); }
});
