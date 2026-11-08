import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from './browser-fixture.mjs';

let fixture;
before(async () => { fixture = await openBrowser(); });
after(async () => { await fixture?.close(); });

async function fieldPage(url = 'index.html', { skin = 'line', fx = 'on', progress = null } = {}) {
  const context = await fixture.browser.newContext({
    baseURL: fixture.baseURL,
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: [{
        origin: fixture.baseURL,
        localStorage: [
          { name: 'kawaii.skin.v1', value: skin },
          { name: 'kawaii.fx.v1', value: fx },
          ...(progress ? [{ name: 'kawaii.progress.v1', value: JSON.stringify(progress) }] : [])
        ]
      }]
    }
  });
  const page = await context.newPage();
  const noise = [];
  page.on('console', message => { if (message.type() === 'error') noise.push(message.text()); });
  page.on('pageerror', error => noise.push(String(error)));
  await page.goto(url);
  await page.waitForSelector('.masthead');
  return { page, noise, close: () => context.close() };
}

// The mark is drawn in accent blue; the surrounding field stays neutral ink.
const readField = page => page.evaluate(() => {
  const canvas = document.querySelector('[data-linefield]');
  if (!canvas) return null;
  const field = document.querySelector('.hero__field');
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  const bands = [0, 0, 0, 0, 0];
  let mark = 0;
  let all = 0;
  let centroidX = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      if (a <= 24) continue;
      all += 1;
      if (data[i + 2] - data[i] > 40 && a > 60) {
        mark += 1;
        centroidX += x;
        bands[Math.min(4, Math.floor((y / h) * 5))] += 1;
      }
    }
  }
  return {
    state: field ? field.dataset.emblemState || null : null,
    progress: field ? field.dataset.emblemProgress || null : null,
    samples: (w / 2) * (h / 2),
    mark,
    all,
    bands,
    centroid: mark ? (centroidX / mark) / w : null
  };
});

const settle = async (page, state = 'resolved') => {
  await page.waitForFunction(expected =>
    document.querySelector('.hero__field')?.dataset.emblemState === expected, state, { timeout: 8000 });
};

test('the line field resolves into a peaked silhouette instead of noise', async () => {
  const { page, noise, close } = await fieldPage();
  try {
    await page.locator('.hero__field-canvas').hover();
    await settle(page);
    const f = await readField(page);
    assert.ok(f.mark / f.samples > 0.02, `only ${f.mark} mark pixels painted; the field is empty`);
    assert.ok(f.mark / f.samples < 0.45, `mark covers ${(f.mark / f.samples * 100).toFixed(0)}%, too solid to read as a line field`);
    const mid = Math.max(...f.bands);
    assert.ok(f.bands[0] < mid * 0.6 && f.bands[4] < mid * 0.6,
      `bands ${f.bands.join('/')} do not taper top and bottom; that is a flat field, not a mark`);
    assert.ok(Math.abs(f.centroid - 0.5) < 0.1, `mark centroid sits at ${(f.centroid * 100).toFixed(0)}% across`);
    assert.deepEqual(noise, [], 'no console errors while rastering the mark');
  } finally { await page.close(); await close(); }
});

test('the mark resolves on first sight and then holds still', async () => {
  const { page, close } = await fieldPage();
  try {
    await settle(page);
    const first = await readField(page);
    await page.waitForTimeout(700);
    const second = await readField(page);
    assert.equal(second.mark, first.mark, 'an idle mark must not keep re-drawing itself');
    assert.equal(second.state, 'resolved');
  } finally { await page.close(); await close(); }
});

test('hovering re-scans the mark and it lands back resolved', async () => {
  const { page, close } = await fieldPage();
  try {
    await settle(page);
    await page.locator('.hero__field-canvas').hover();
    const states = await page.evaluate(async () => {
      const field = document.querySelector('.hero__field');
      const seen = new Set([field.dataset.emblemState]);
      await new Promise(resolve => {
        const observer = new MutationObserver(() => {
          seen.add(field.dataset.emblemState);
          if (field.dataset.emblemState === 'resolved') { observer.disconnect(); resolve(); }
        });
        observer.observe(field, { attributes: true, attributeFilter: ['data-emblem-state'] });
        setTimeout(() => { observer.disconnect(); resolve(); }, 6000);
      });
      return [...seen];
    });
    assert.ok(states.includes('scanning'), `the sweep never ran, states seen: ${states.join(' -> ')}`);
    assert.equal(states[states.length - 1], 'resolved');
  } finally { await page.close(); await close(); }
});

test('the die lights segments to match the real writing completion', async () => {
  const { page, close } = await fieldPage('index.html');
  try {
    await settle(page);
    const empty = await readField(page);
    const baseline = await page.evaluate(() => Math.round(window.Kawaii.stats.pct()));
    assert.equal(Number(empty.progress), baseline, 'the field reports the writing completion');
    assert.ok(empty.bands[2] > 0, 'mark still painted at the baseline');

    await page.evaluate(() => {
      window.Kawaii.stats.pct = () => 70;
      document.dispatchEvent(new CustomEvent('kawaii:progress', { detail: {} }));
    });
    assert.ok(baseline < 70, 'the stub must raise the completion above the seed baseline');
    await page.waitForFunction(() =>
      Number(document.querySelector('.hero__field').dataset.emblemProgress) === 70, null, { timeout: 5000 });
    const after = await readField(page);
    assert.ok(Number(after.progress) > Number(empty.progress),
      `completion stayed at ${after.progress}% after the stats rose`);
  } finally { await page.close(); await close(); }
});

test('the catgirl portrait is the site mark in the masthead, footer, and favicon', async () => {
  const { page, noise, close } = await fieldPage('index.html', { skin: 'pixel' });
  try {
    await page.waitForFunction(() => {
      const mark = document.querySelector('.brand [data-emblem-mark]');
      return mark && mark.tagName === 'IMG' && mark.complete && mark.naturalWidth > 0;
    });
    const marks = await page.evaluate(() => {
      const pick = sel => {
        const host = document.querySelector(sel);
        const mark = host && host.querySelector('[data-emblem-mark]');
        if (!mark) return null;
        const rect = mark.getBoundingClientRect();
        return {
          tag: mark.tagName,
          src: mark.getAttribute('src'),
          loaded: mark.complete && mark.naturalWidth > 0,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          alt: mark.getAttribute('alt')
        };
      };
      return {
        brand: pick('.brand'),
        footer: pick('[data-site-footer]'),
        fieldHidden: getComputedStyle(document.querySelector('.hero__field')).display === 'none'
      };
    });
    assert.ok(marks.brand, 'the masthead carries the portrait mark');
    assert.equal(marks.brand.tag, 'IMG', 'the mark is the real portrait asset');
    assert.match(marks.brand.src, /assets\/img\/avatar-mark\.png$/);
    assert.equal(marks.brand.loaded, true, 'the portrait asset loads');
    assert.equal(marks.brand.alt, '', 'the decorative mark leaves naming to the link');
    assert.equal(marks.brand.width, 24, 'the pixel masthead mark is 24px');
    assert.equal(marks.brand.height, 24, 'the mark stays square');
    assert.ok(marks.footer, 'the footer carries the same portrait');
    assert.equal(marks.footer.src, marks.brand.src, 'masthead and footer share one portrait');
    assert.equal(marks.footer.width, 22, 'the pixel footer mark follows the footer scale');
    assert.equal(marks.fieldHidden, true, 'the pixel skin keeps its own hero module');
    assert.deepEqual(noise, [], 'the portrait mark stays quiet in the pixel skin');

    const favicon = await fetch(new URL('assets/img/favicon.svg', `${fixture.baseURL}/`));
    assert.equal(favicon.status, 200, 'favicon.svg is served');
    const body = await favicon.text();
    assert.match(body, /<image[^>]+href="data:image\/png;base64,/, 'the favicon embeds the portrait');
    assert.match(body, /fill="#f7f1e8"/, 'the favicon keeps a light plate for dark tab bars');

    const fav = await page.evaluate(async () => {
      const image = new Image();
      image.src = 'assets/img/favicon.svg';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, 32, 32);
      const data = ctx.getImageData(0, 0, 32, 32).data;
      let hair = 0;
      let eyes = 0;
      for (let y = 6; y < 26; y += 1) {
        for (let x = 6; x < 26; x += 1) {
          const i = (y * 32 + x) * 4;
          const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
          if (a > 32 && r < 70 && g < 70 && b < 90) hair += 1;
          if (a > 32 && b > 140 && b - r > 40 && b - g > 20) eyes += 1;
        }
      }
      return { width: image.naturalWidth, height: image.naturalHeight, hair, eyes };
    });
    assert.equal(fav.width, 32, 'the favicon keeps its 32px canvas');
    assert.equal(fav.height, 32);
    assert.ok(fav.hair > 30, `the favicon lost the dark hair (${fav.hair} samples)`);
    assert.ok(fav.eyes > 0, 'the favicon keeps the blue eyes');
  } finally { await page.close(); await close(); }
});

test('the line skin keeps the same portrait at 18px without the dark-mode rim', async () => {
  const { page, noise, close } = await fieldPage('index.html', { skin: 'line' });
  try {
    await page.waitForFunction(() => {
      const mark = document.querySelector('.brand [data-emblem-mark]');
      return mark && mark.complete && mark.naturalWidth > 0;
    });
    const mark = await page.evaluate(() => {
      const brand = document.querySelector('.brand [data-emblem-mark]');
      const footer = document.querySelector('[data-site-footer] [data-emblem-mark]');
      const rect = brand.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        filter: getComputedStyle(brand).filter,
        footerWidth: Math.round(footer.getBoundingClientRect().width)
      };
    });
    assert.equal(mark.width, 18, 'the line masthead mark steps down to 18px');
    assert.equal(mark.height, 18);
    assert.equal(mark.filter, 'none', 'the line skin drops the dark-mode rim');
    assert.equal(mark.footerWidth, 18);
    assert.deepEqual(noise, []);
  } finally { await page.close(); await close(); }
});

test('fx off paints the resolved mark once and skips the sweep', async () => {
  const { page, close } = await fieldPage('index.html', { fx: 'off' });
  try {
    await settle(page);
    const first = await readField(page);
    assert.equal(first.state, 'resolved', 'no scan state without fx');
    await page.locator('.hero__field-canvas').hover();
    await page.waitForTimeout(500);
    const second = await readField(page);
    assert.equal(second.state, 'resolved', 'hover does not start a sweep while fx is off');
    assert.equal(second.mark, first.mark, 'and nothing repaints');
  } finally { await page.close(); await close(); }
});

test('the scan boxes lock onto the drawn head and eye band', async () => {
  const { page, noise, close } = await fieldPage();
  try {
    await page.locator('.hero__field-canvas').hover();
    await page.waitForFunction(() =>
      getComputedStyle(document.querySelector('.field-hud')).opacity === '1', null, { timeout: 5000 });
    const geo = await page.evaluate(() => {
      const canvas = document.querySelector('.hero__field-canvas').getBoundingClientRect();
      const rel = sel => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return {
          left: (r.left - canvas.left) / canvas.width,
          top: (r.top - canvas.top) / canvas.height,
          right: (r.right - canvas.left) / canvas.width,
          bottom: (r.bottom - canvas.top) / canvas.height
        };
      };
      return {
        head: rel('[data-hud-head]'),
        eyes: rel('[data-hud-eyes]'),
        subject: document.querySelector('.hero__field').dataset.emblemSubject
      };
    });
    assert.equal(geo.subject, 'catgirl', 'the field reports which subject the boxes describe');
    assert.ok(geo.head.top > 0.05 && geo.head.top < 0.25,
      `head box starts at ${(geo.head.top * 100).toFixed(0)}%; the ears are near the top of the portrait`);
    assert.ok(geo.head.bottom > 0.55 && geo.head.bottom < 0.82,
      `head box ends at ${(geo.head.bottom * 100).toFixed(0)}%; the chin is around two thirds down`);
    assert.ok(geo.head.left > 0.08 && geo.head.left < 0.3, `head box left edge ${(geo.head.left * 100).toFixed(0)}%`);
    assert.ok(geo.head.right > 0.7 && geo.head.right < 0.96, `head box right edge ${(geo.head.right * 100).toFixed(0)}%`);

    const eyesMidY = (geo.eyes.top + geo.eyes.bottom) / 2;
    const eyesMidX = (geo.eyes.left + geo.eyes.right) / 2;
    assert.ok(eyesMidY > 0.43 && eyesMidY < 0.6,
      `eye box centers at ${(eyesMidY * 100).toFixed(0)}% down; the iris band is at about half height`);
    assert.ok(Math.abs(eyesMidX - 0.5) < 0.08,
      `eye box centers at ${(eyesMidX * 100).toFixed(0)}% across; the face is centered`);
    assert.ok(geo.eyes.right - geo.eyes.left > 0.18 && geo.eyes.right - geo.eyes.left < 0.5,
      'the eye box spans both eyes, not one stray highlight');
    assert.deepEqual(noise, [], 'no console errors while measuring the portrait');
  } finally { await page.close(); await close(); }
});

test('the scan card reports the live desk instead of fake coordinates', async () => {
  const { page, close } = await fieldPage();
  try {
    await page.locator('.hero__field-canvas').hover();
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('kawaii:live', {
        detail: {
          live: true,
          state: { title: '嵌入式 MCU 学习记录.md', line: 18, col: 12, chars: 1268, totalLines: 42, dirty: true }
        }
      }));
    });
    await page.waitForFunction(() => document.querySelector('.field-hud').dataset.signal === 'live');
    const hud = await page.evaluate(() => ({
      state: document.querySelector('[data-hud-state]').textContent,
      focus: document.querySelector('[data-hud-focus]').textContent,
      title: document.querySelector('[data-hud-title]').textContent,
      meta: document.querySelector('[data-hud-meta]').textContent,
      all: document.querySelector('.field-hud').textContent
    }));
    assert.equal(hud.state, 'LIVE');
    assert.equal(hud.focus, 'WRITING');
    assert.equal(hud.title, '嵌入式 MCU 学习记录', 'the draft title replaces the placeholder');
    assert.match(hud.meta, /LN 18 · COL 12 · 1268 CHARS/, 'real caret position and length replace x/y labels');
    assert.ok(!/CATGIRL-01|x:32 y:14|QUANTIZED · 3D/.test(hud.all), 'the fake subject metadata is gone');

    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('kawaii:live', { detail: { live: false, state: null } }));
    });
    await page.waitForFunction(() => document.querySelector('.field-hud').dataset.signal === 'idle');
    const idle = await page.evaluate(() => ({
      title: document.querySelector('[data-hud-title]').textContent,
      meta: document.querySelector('[data-hud-meta]').textContent
    }));
    assert.equal(idle.title, '作者现在不在写作台前');
    assert.match(idle.meta, /\d+ ARTICLES · \d+ COLLECTIONS/, 'the idle card quotes real site counts');
  } finally { await page.close(); await close(); }
});

test('the pointer pushes the field and the bars spring back to the grid', async () => {
  const { page, noise, close } = await fieldPage();
  try {
    const signature = () => page.evaluate(() => {
      const canvas = document.querySelector('[data-linefield]');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 29) sum = (sum * 31 + data[i + 3] + data[i + 2] * 3) >>> 0;
      return sum;
    });
    const points = () => page.evaluate(() => {
      const field = document.querySelector('.hero__field');
      return field.dataset.emblemPointer || null;
    });

    const stable = async () => {
      let previous = -1;
      for (let i = 0; i < 14; i += 1) {
        await page.waitForTimeout(150);
        const value = await signature();
        if (value === previous) return value;
        previous = value;
      }
      return previous;
    };

    await settle(page);
    await page.keyboard.press('Escape');
    const rest = await stable();

    const box = await page.locator('.hero__field-canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await page.waitForTimeout(240);
    const pushed = await signature();
    assert.notEqual(pushed, rest, 'hovering must deform the field, not only re-scan it');
    assert.equal(await points(), 'active');

    await page.mouse.move(4, 4);
    await settle(page);
    await page.waitForFunction(() => document.querySelector('.hero__field').dataset.emblemPointer === 'idle');
    const returned = await stable();
    assert.equal(returned, rest, 'the bars must land back on the exact same grid');
    assert.equal(await points(), 'idle');

    // the reveal sweep still runs on hover
    await page.locator('.hero__field-canvas').hover();
    await page.waitForFunction(() => document.querySelector('.hero__field').dataset.emblemState === 'scanning');
    assert.deepEqual(noise, []);
  } finally { await page.close(); await close(); }
});
