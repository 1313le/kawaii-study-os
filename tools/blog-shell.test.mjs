import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from './browser-fixture.mjs';

let fixture;
before(async () => { fixture = await openBrowser(); });
after(async () => { await fixture?.close(); });

async function blogPage(url, { width = 1440, height = 1000, motion = 'full' } = {}) {
  const context = await fixture.browser.newContext({
    baseURL: fixture.baseURL,
    viewport: { width, height },
    storageState: {
      cookies: [],
      origins: [{
        origin: fixture.baseURL,
        localStorage: [
          { name: 'kawaii.skin.v1', value: 'pixel' },
          { name: 'kawaii.fx.v1', value: 'on' },
          { name: 'kawaii.motion.v1', value: motion }
        ]
      }]
    }
  });
  const page = await context.newPage();
  await page.goto(url);
  return { page, close: () => context.close() };
}

test('the profile card is led by the animated catgirl, not the old static cat', async () => {
  const { page, close } = await blogPage('index.html');
  try {
    await page.waitForSelector('.blog-profile__avatar[data-catgirl]');
    const state = await page.evaluate(() => {
      const host = document.querySelector('.blog-profile__avatar[data-catgirl]');
      const image = host.querySelector('[data-catgirl-img]');
      return {
        frame: host.dataset.frame,
        src: image.getAttribute('src'),
        loaded: image.complete && image.naturalWidth > 0,
        caption: host.querySelector('[data-catgirl-caption]').textContent,
        staticCat: document.querySelectorAll('img[src*="avatar-kawaii"]').length,
        timeline: [0, 6000, 9000, 11400, 13800].map((time) => window.KawaiiCatgirl.stateAt(time).frame),
        blink: window.KawaiiCatgirl.stateAt(4600),
        idle: window.KawaiiCatgirl.stateAt(4200)
      };
    });
    assert.ok(['type', 'idle', 'blink'].includes(state.frame), `unexpected opening frame ${state.frame}`);
    assert.match(state.src, /catgirl-(type|idle|blink)\.png$/);
    assert.equal(state.loaded, true, 'the sprite must be decoded, not a broken frame');
    assert.ok(state.caption.length > 0, 'the status line names the pose');
    assert.equal(state.staticCat, 0, 'the orange cat avatar is gone from the page');
    assert.deepEqual(state.timeline, ['type', 'sip', 'happy', 'think', 'sleepy'],
      'the shared timeline runs typing, a sip, a happy beat, thinking and sleepy');
    assert.equal(state.idle.frame, 'idle');
    assert.equal(state.idle.caption, '待机中');
    assert.equal(state.blink.frame, 'blink', 'the sprite still blinks inside idle');
    assert.equal(state.blink.caption, '待机中', 'a blink must not flip the status line');
  } finally { await page.close(); await close(); }
});

test('reduced motion holds the catgirl on a still idle frame with an honest caption', async () => {
  const { page, close } = await blogPage('index.html', { motion: 'reduced' });
  try {
    await page.waitForSelector('.blog-profile__avatar[data-catgirl]');
    await page.waitForTimeout(900);
    const state = await page.evaluate(() => {
      const host = document.querySelector('.blog-profile__avatar[data-catgirl]');
      return {
        suspended: window.KawaiiMotion.state().suspended,
        frame: host.dataset.frame,
        caption: host.querySelector('[data-catgirl-caption]').textContent,
        src: host.querySelector('[data-catgirl-img]').getAttribute('src')
      };
    });
    assert.equal(state.suspended, true);
    assert.equal(state.frame, 'idle');
    assert.match(state.src, /catgirl-idle\.png$/);
    assert.equal(state.caption, '待机中');
  } finally { await page.close(); await close(); }
});

test('the home feed leads with one featured article and keeps the rest as compact rows', async () => {
  const { page, close } = await blogPage('index.html');
  try {
    await page.waitForSelector('.blog-feed .note-card--featured');
    const feed = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.blog-feed .note-card')];
      const featured = cards[0];
      return {
        count: cards.filter((card) => card.classList.contains('note-card--featured')).length,
        firstIsFeatured: featured.classList.contains('note-card--featured'),
        flag: featured.querySelector('.note-card__flag').textContent.trim(),
        coverVisible: Boolean(featured.querySelector('.note-card__cover img, .note-card__cover .cover-tpl')),
        title: featured.querySelector('.note-card__title').textContent.trim(),
        latest: window.KawaiiBlog.sortNotes(window.Kawaii.notes.all, 'new')[0].title
      };
    });
    assert.equal(feed.count, 1, 'only the lead article is featured');
    assert.equal(feed.firstIsFeatured, true);
    assert.equal(feed.flag, 'FEATURED / 最新');
    assert.equal(feed.coverVisible, true);
    assert.equal(feed.title, feed.latest, 'the featured slot is the newest article');

    await page.click('[data-blog-sort="views"]');
    await page.waitForFunction(() =>
      document.querySelector('.note-card--featured .note-card__flag')?.textContent.includes('TOP / 最热'));
    assert.equal(await page.locator('.blog-feed .note-card--featured').count(), 1);
  } finally { await page.close(); await close(); }
});

test('the article library keeps the tag row to one short block until asked for more', async () => {
  const { page, close } = await blogPage('logs.html');
  try {
    await page.waitForSelector('[data-tags-toggle]');
    const total = await page.evaluate(() => window.Kawaii.notes.tags().length);
    assert.ok(total > 12, 'fixture needs more than one row of tags');
    const countChips = () => page.locator('[data-logs-filters] [data-tag]').count();
    assert.equal(await countChips(), 13, 'one 全部 chip plus the first twelve tags');
    assert.match(await page.locator('[data-tags-toggle]').innerText(), new RegExp(`\\+${total - 12}`));

    await page.click('[data-tags-toggle]');
    assert.equal(await countChips(), total + 1);
    assert.equal(await page.locator('[data-tags-toggle]').getAttribute('aria-expanded'), 'true');

    await page.click('[data-tags-toggle]');
    assert.equal(await countChips(), 13);
    assert.equal(await page.locator('[data-tags-toggle]').getAttribute('aria-expanded'), 'false');
  } finally { await page.close(); await close(); }
});

test('the note page borrows the same catgirl as a cropped little author avatar', async () => {
  const { page, close } = await blogPage('index.html');
  try {
    await page.waitForSelector('[data-catgirl]');
    const slug = await page.evaluate(() => window.Kawaii.notes.all[0].slug);
    await page.goto(`note.html?slug=${encodeURIComponent(slug)}`);
    await page.waitForSelector('.note-author__avatar[data-catgirl]');
    const state = await page.evaluate(() => {
      const host = document.querySelector('.note-author__avatar[data-catgirl]');
      const image = host.querySelector('[data-catgirl-img]');
      const box = host.getBoundingClientRect();
      const sprite = image.getBoundingClientRect();
      return {
        box: [Math.round(box.width), Math.round(box.height)],
        sprite: [Math.round(sprite.width), Math.round(sprite.height)],
        clipped: getComputedStyle(host).overflow,
        frame: host.dataset.frame,
        staticCat: document.querySelectorAll('img[src*="avatar-kawaii"]').length
      };
    });
    assert.deepEqual(state.box, [48, 48]);
    assert.ok(state.sprite[0] > 48 && state.sprite[1] > 48, 'the sprite is scaled up and cropped to the face');
    assert.equal(state.clipped, 'hidden');
    assert.ok(['type', 'idle', 'blink'].includes(state.frame));
    assert.equal(state.staticCat, 0);
  } finally { await page.close(); await close(); }
});

test('the sidebar search hands a query to the article library, which hides the duplicate form', async () => {
  const { page, close } = await blogPage('index.html');
  try {
    await page.waitForSelector('.blog-profile__search input');
    await page.fill('.blog-profile__search input', 'GPIO');
    await page.press('.blog-profile__search input', 'Enter');
    await page.waitForURL(/logs\.html\?q=GPIO/);
    await page.waitForSelector('[data-logs-search]');
    assert.equal(await page.locator('[data-logs-search]').inputValue(), 'GPIO');
    assert.equal(await page.locator('.blog-profile__search').count(), 0, 'the library already has its own search bar');
    await page.waitForFunction(() => document.querySelectorAll('[data-logs-grid] .note-card').length > 0);
  } finally { await page.close(); await close(); }
});
