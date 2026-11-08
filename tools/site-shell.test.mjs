import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from './browser-fixture.mjs';

let fixture;
before(async () => { fixture = await openBrowser(); });
after(async () => { await fixture?.close(); });

// Each shell case owns its storage so a theme or fx choice never leaks into the next test.
async function shellPage(url, { skin = 'pixel', fx = 'on' } = {}) {
  const context = await fixture.browser.newContext({
    baseURL: fixture.baseURL,
    viewport: { width: 1440, height: 1000 },
    storageState: {
      cookies: [],
      origins: [{
        origin: fixture.baseURL,
        localStorage: [{ name: 'kawaii.skin.v1', value: skin }, { name: 'kawaii.fx.v1', value: fx }]
      }]
    }
  });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector('.masthead');
  return { page, close: () => context.close() };
}

test('terminal opens from its button, answers help, and Escape returns focus to the button', async () => {
  const { page, close } = await shellPage('index.html');
  try {
    const opener = page.locator('[data-terminal-open]').first();
    await opener.click();
    await page.waitForSelector('#kawaii-terminal[open]');
    await page.waitForFunction(() => document.activeElement.id === 'terminal-input');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'terminal-input', 'caret lands in the prompt');

    await page.keyboard.type('help');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('#terminal-output .t-line')].some(line => /neofetch/.test(line.textContent)));
    assert.ok(await page.locator('#terminal-output .t-line').count() > 3, 'boot lines plus the command list');

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#kawaii-terminal').open);
    assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-terminal-open')), true,
      'focus goes back to the button that opened it');
  } finally { await page.close(); await close(); }
});

test('the backtick opens the terminal, is a literal inside the prompt, and stays silent elsewhere', async () => {
  const { page, close } = await shellPage('index.html');
  try {
    await page.keyboard.press('Backquote');
    await page.waitForSelector('#kawaii-terminal[open]');
    await page.waitForFunction(() => document.activeElement.id === 'terminal-input');

    await page.keyboard.press('Backquote');
    assert.equal(await page.evaluate(() => document.querySelector('#kawaii-terminal').open), true,
      'the prompt keeps the character instead of closing itself');
    assert.equal(await page.locator('#terminal-input').inputValue(), '`');

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#kawaii-terminal').open);

    await page.evaluate(() => {
      const box = document.createElement('input');
      box.id = 'outside-box';
      document.body.appendChild(box);
      box.focus();
    });
    await page.keyboard.press('Backquote');
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.querySelector('#kawaii-terminal').open), false,
      'a keystroke inside another field is just a keystroke');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'outside-box');
  } finally { await page.close(); await close(); }
});

test('theme toggle swaps the skin, tells listeners, and survives a reload', async () => {
  const { page, close } = await shellPage('index.html');
  try {
    await page.evaluate(() => {
      window.seen = [];
      document.addEventListener('kawaii:skinchange', event => window.seen.push(event.detail.skin));
    });
    await page.locator('[data-theme-toggle]').click();
    await page.waitForFunction(() => document.documentElement.dataset.skin === 'line');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), 'line');
    assert.deepEqual(await page.evaluate(() => window.seen), ['line'], 'exactly one event per click');
    assert.equal(await page.evaluate(() => localStorage.getItem('kawaii.skin.v1')), 'line');

    await page.reload();
    await page.waitForSelector('.masthead');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), 'line',
      'no flash back to the default skin');
  } finally { await page.close(); await close(); }
});

test('fx toggle trades the animated CRT for the static one and reports its state', async () => {
  const { page, close } = await shellPage('index.html');
  try {
    const button = page.locator('[data-fx-toggle]');
    const crtDisplay = () => page.evaluate(() => getComputedStyle(document.querySelector('.hero-crt')).display);
    const coverFx = () => page.evaluate(() => {
      const fx = document.querySelector('.cfx');
      return fx ? getComputedStyle(fx).display : 'absent';
    });
    assert.notEqual(await crtDisplay(), 'none', 'the animated CRT is on screen before the click');
    assert.notEqual(await coverFx(), 'none', 'the cover overlay animates before the click');

    await button.click();
    await page.waitForFunction(() => document.documentElement.dataset.fx === 'off');
    assert.equal(await crtDisplay(), 'none', 'the CRT is parked');
    assert.equal(await coverFx(), 'none', 'the cover overlay stops too');
    assert.equal(await page.evaluate(() => localStorage.getItem('kawaii.fx.v1')), 'off');
    assert.equal(await page.evaluate(() => document.querySelector('[data-fx-toggle]').getAttribute('aria-pressed')), 'false');

    await page.reload();
    await page.waitForSelector('.masthead');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.fx), 'off', 'choice survives the reload');
    assert.equal(await crtDisplay(), 'none');
  } finally { await page.close(); await close(); }
});

test('slash jumps to log search, filters live, and Escape hands the page back', async () => {
  const { page, close } = await shellPage('logs.html');
  try {
    const all = await page.locator('[data-logs-grid] .note-card').count();
    assert.ok(all > 1, `fixture needs more than one card, saw ${all}`);

    await page.keyboard.press('Slash');
    assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-logs-search')), true);

    await page.keyboard.type('STM32');
    await page.waitForFunction(count => document.querySelectorAll('[data-logs-grid] .note-card').length < count, all);
    const hits = await page.locator('[data-logs-grid] .note-card').count();
    assert.ok(hits >= 1 && hits < all, `narrowed to ${hits} of ${all}`);
    assert.match(await page.url(), /q=STM32/, 'the filter is shareable');

    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BODY', 'the field lets go');
    assert.equal(await page.locator('[data-logs-search]').inputValue(), '');
    await page.waitForFunction(count => document.querySelectorAll('[data-logs-grid] .note-card').length === count, all);
    assert.doesNotMatch(await page.url(), /q=/);
  } finally { await page.close(); await close(); }
});

async function openTerminal(page, command) {
  const isOpen = await page.evaluate(() => {
    const dialog = document.querySelector('#kawaii-terminal');
    return dialog ? dialog.open : false;
  });
  if (!isOpen) await page.locator('[data-terminal-open]').first().click();
  await page.waitForFunction(() => document.activeElement.id === 'terminal-input');
  await page.keyboard.type(command);
  await page.keyboard.press('Enter');
}
const outputText = page => page.evaluate(() =>
  [...document.querySelectorAll('#terminal-output .t-line')].map(line => line.textContent).join('\n'));

test('terminal search lists notes that actually open, and a typo is corrected', async () => {
  const { page, close } = await shellPage('index.html');
  try {
    await openTerminal(page, 'search STM32');
    await page.waitForFunction(() => document.querySelectorAll('#terminal-output a[href*="note.html"]').length > 0);
    assert.match(await outputText(page), /SEARCH \/ "STM32"/);

    await page.locator('#terminal-output a[href*="note.html"]').first().click();
    await page.waitForURL(/note\.html/);
    await page.waitForFunction(() => !/LOADING/i.test(document.querySelector('h1.note-title').textContent));
    const title = await page.locator('h1.note-title').textContent();
    assert.ok(title.trim().length > 1, 'a real note opened');
    assert.match(await page.evaluate(() => document.querySelector('.article').innerText), /STM32/,
      `the hit "${title.trim()}" really contains the query`);

    const other = await shellPage('index.html');
    try {
      await openTerminal(other.page, 'searx');
      await other.page.waitForFunction(() => document.querySelectorAll('#terminal-output .t-line--err').length > 0);
      const text = await outputText(other.page);
      assert.match(text, /未知命令/);
      assert.match(text, /search/, 'the correction names the command it meant');
    } finally { await other.page.close(); await other.close(); }
  } finally { await page.close(); await close(); }
});

test('theme, fx and exit commands drive the live page', async () => {
  const { page, close } = await shellPage('index.html');
  try {
    await openTerminal(page, 'theme line');
    await page.waitForFunction(() => document.documentElement.dataset.skin === 'line');
    assert.match(await outputText(page), /theme: line/);

    await openTerminal(page, 'fx off');
    await page.waitForFunction(() => document.documentElement.dataset.fx === 'off');
    assert.equal(await page.evaluate(() => localStorage.getItem('kawaii.fx.v1')), 'off');

    await page.keyboard.type('exit');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('#kawaii-terminal').open);

    await page.reload();
    await page.waitForSelector('.masthead');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), 'line', 'the terminal edit is a real choice');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.fx), 'off');
  } finally { await page.close(); await close(); }
});

const rgbOf = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const luminance = ([r, g, b]) => {
  const channel = c => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(rgbOf(a)), luminance(rgbOf(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('the line skin keeps the hero caret blinking and tinted', async () => {
  const { page, close } = await shellPage('index.html', { skin: 'line' });
  try {
    const caret = await page.evaluate(async () => {
      const el = document.querySelector('.cursor-block');
      const cs = getComputedStyle(el);
      const anim = el.getAnimations()[0];
      if (!anim) return { name: cs.animationName, duration: cs.animationDuration, on: cs.opacity, off: cs.opacity };
      anim.pause();
      const seconds = parseFloat(cs.animationDuration) || 1;
      const sample = async time => {
        anim.currentTime = time * 1000;
        await new Promise(resolve => requestAnimationFrame(resolve));
        return Number(getComputedStyle(el).opacity);
      };
      return {
        name: cs.animationName,
        duration: seconds,
        width: Math.round(el.getBoundingClientRect().width),
        on: await sample(0),
        off: await sample(seconds * 0.75),
        background: cs.backgroundColor,
        accent: getComputedStyle(document.querySelector('.hero__title em')).color
      };
    });
    assert.notEqual(caret.name, 'none', 'the caret must still be animating in the line skin');
    assert.ok(caret.duration > 0, `blink duration was ${caret.duration}s`);
    assert.ok(Math.abs(caret.on - caret.off) >= 0.5,
      `blink only reaches ${caret.on} -> ${caret.off}; that reads as a static mark`);
    assert.ok(caret.width <= 4, `a ${caret.width}px wide caret reads as a block, not a line`);
    assert.equal(caret.background, caret.accent, 'the caret takes the accent, not a washed-out grey');
  } finally { await page.close(); await close(); }
});

test('the terminal prompt is legible in both skins', async () => {
  for (const [skin, floor] of [['pixel', 4.5], ['line', 7]]) {
    const { page, close } = await shellPage('index.html', { skin });
    try {
      await page.locator('[data-terminal-open]').first().click();
      await page.waitForFunction(() => document.activeElement.id === 'terminal-input');
      const inks = await page.evaluate(() => {
        const input = document.querySelector('#terminal-input');
        const opaqueBg = el => {
          for (let node = el; node; node = node.parentElement) {
            const color = getComputedStyle(node).backgroundColor;
            if (!/rgba\([\d.,\s]*0\)$/.test(color)) return color;
          }
          return 'rgb(255, 255, 255)';
        };
        return {
          fg: getComputedStyle(input).color,
          bg: opaqueBg(input),
          placeholder: getComputedStyle(input, '::placeholder').color
        };
      });
      assert.ok(contrast(inks.fg, inks.bg) >= floor,
        `${skin}: typed text is ${contrast(inks.fg, inks.bg).toFixed(2)}:1 against ${inks.bg}, floor ${floor}:1`);
      assert.ok(contrast(inks.placeholder, inks.bg) >= 3,
        `${skin}: the placeholder hint is ${contrast(inks.placeholder, inks.bg).toFixed(2)}:1, floor 3:1`);
    } finally { await page.close(); await close(); }
  }
});

/* ---------- footer LED wordmark ---------- */

// Chrome serialises the resolved clip-path, so the dark fraction can be read
// without guessing at calc().
const signState = (page) => page.evaluate(() => {
  const el = document.querySelector('.footer-wordmark');
  const overlay = el && el.querySelector('.footer-wordmark__led');
  const style = overlay ? getComputedStyle(overlay) : null;
  const values = ((style && style.clipPath.match(/inset\(([^)]*)\)/)) || [, ''])[1]
    .trim().split(/\s+/).map(parseFloat).filter(Number.isFinite);
  return {
    word: overlay ? overlay.textContent : null,
    led: parseFloat(getComputedStyle(el).getPropertyValue('--led')) || 0,
    pct: Math.round(window.Kawaii.stats.pct()),
    dark: values.length === 1 ? values[0] : values.length >= 2 ? values[1] : null,
    anim: style ? style.animationName : 'none',
    dotted: style ? /radial-gradient/.test(style.maskImage + ' ' + style.webkitMaskImage) : false,
    hasOverlay: Boolean(overlay) && (!style || style.display !== 'none')
  };
});

test('the pixel wordmark scans fully on and the footer reports writing progress', async () => {
  const { page, close } = await shellPage('index.html');
  try {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForFunction(() => {
      const el = document.querySelector('.footer-wordmark__led');
      return el && getComputedStyle(el).animationName !== 'none';
    });
    await page.evaluate(() => {
      document.getAnimations()
        .filter((animation) => animation.animationName === 'ledOn')
        .forEach((animation) => animation.finish());
    });
    const s = await signState(page);
    assert.ok(s.hasOverlay, 'the wordmark has no lit overlay layer');
    assert.ok(s.dotted, 'the lit layer is not a dot matrix');
    assert.equal(s.word, 'kawaii', 'the overlay needs its own text to light');
    assert.ok(Math.abs(s.dark - 0) <= 1, `the sign should finish fully lit, dark fraction ${s.dark}`);
    assert.equal(s.anim, 'ledOn', `expected the power-on animation, saw ${s.anim}`);
    const headroom = await page.evaluate(() => {
      const el = document.querySelector('.footer-wordmark');
      const led = el.querySelector('.footer-wordmark__led');
      const range = document.createRange();
      range.selectNodeContents(led);
      return {
        font: parseFloat(getComputedStyle(el).fontSize),
        ledTop: led.getBoundingClientRect().top,
        inkTop: range.getBoundingClientRect().top
      };
    });
    assert.ok(
      headroom.inkTop - headroom.ledTop >= headroom.font * 0.1,
      `the lit clip box must reach above the i dots (${headroom.inkTop - headroom.ledTop}px of ${headroom.font}px type)`
    );
    const goal = await page.textContent('[data-footer-goal]');
    assert.match(goal, new RegExp(`${s.pct}%`), `footer goal "${goal}" should report ${s.pct}%`);
  } finally { await page.close(); await close(); }
});

test('fx off keeps the lit state but drops the power-on', async () => {
  const { page, close } = await shellPage('index.html', { fx: 'off' });
  try {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);
    const s = await signState(page);
    assert.equal(s.anim, 'none', `fx-off still runs ${s.anim}`);
    assert.ok(s.hasOverlay && s.dark !== null, 'the sign lost its lit state with fx off');
  } finally { await page.close(); await close(); }
});

test('the line wordmark stays a clean outline', async () => {
  const { page, close } = await shellPage('index.html', { skin: 'line' });
  try {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);
    const s = await signState(page);
    assert.equal(s.hasOverlay, false, 'the line skin paints an LED overlay');
  } finally { await page.close(); await close(); }
});

test('four nav items still fit a phone-width masthead', async () => {
  const context = await fixture.browser.newContext({
    baseURL: fixture.baseURL,
    viewport: { width: 390, height: 844 },
    storageState: { cookies: [], origins: [{ origin: fixture.baseURL, localStorage: [{ name: 'kawaii.skin.v1', value: 'pixel' }] }] }
  });
  const page = await context.newPage();
  try {
    await page.goto('index.html');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.nav__link');
    const report = await page.evaluate(() => {
      const links = [...document.querySelectorAll('.nav__link')];
      const nav = document.querySelector('.nav');
      return {
        count: links.length,
        right: Math.round(links.at(-1).getBoundingClientRect().right),
        width: window.innerWidth,
        scrolls: nav.scrollWidth > nav.clientWidth
      };
    });
    assert.equal(report.count, 4, 'home / articles / resources / about are the four entries');
    assert.ok(report.right <= report.width, `the last nav item ends at ${report.right}px on a ${report.width}px screen`);
    assert.equal(report.scrolls, false, 'the phone nav should not need a hidden scroll strip');
  } finally { await page.close(); await context.close(); }
});

/* ---------- columns and the archive ---------- */

test('the log index filters by column, and a diary column needs no fixed taxonomy', async () => {
  const { page, close } = await shellPage('logs.html');
  try {
    await page.waitForSelector('[data-logs-collections] [data-collection]');
    const chips = await page.locator('[data-logs-collections] [data-collection]').allTextContents();
    assert.ok(chips.some((text) => /随笔/.test(text)), `columns missing: ${chips.join(" | ")}`);

    await page.click('[data-logs-collections] [data-collection="随笔"]');
    await page.waitForFunction(() => document.querySelectorAll('.note-card').length === 2);
    const cards = await page.evaluate(() => [...document.querySelectorAll('.note-card')].map((card) => ({
      href: card.getAttribute('href'),
      meta: card.querySelector('.note-card__meta').textContent
    })));
    assert.equal(cards.length, 2);
    assert.ok(cards.every((card) => /随笔/.test(card.meta)), 'each card should name its column');
    assert.ok(cards.some((card) => /hello-study-os/.test(card.href)));

    await page.click('[data-logs-collections] [data-collection=""]');
    await page.waitForFunction(() => document.querySelectorAll('.note-card').length === 10);
  } finally { await page.close(); await close(); }
});

test('the archive reads in publication order, newest year and month first', async () => {
  const { page, close } = await shellPage('logs.html');
  try {
    await page.click('[data-logs-view="archive"]');
    await page.waitForSelector('.archive__year');
    const archive = await page.evaluate(() => ({
      years: [...document.querySelectorAll('.archive__year-head h2')].map((node) => node.textContent.trim()),
      months: [...document.querySelectorAll('.archive__month h3')].map((node) => Number(node.textContent.replace(/\D/g, ""))),
      items: [...document.querySelectorAll('.archive__item')].map((item) => ({
        date: item.querySelector('time').getAttribute('datetime'),
        href: item.querySelector('a').getAttribute('href'),
        column: item.querySelector('.archive__collection')?.textContent || ''
      })),
      cards: document.querySelectorAll('.note-card').length
    }));
    assert.deepEqual(archive.years, ['2026']);
    assert.equal(archive.items.length, 10, 'the archive lists every note');
    assert.equal(archive.cards, 0, 'archive mode replaces the cards');
    const dates = archive.items.map((item) => item.date);
    assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
    for (let i = 1; i < archive.months.length; i += 1) {
      assert.ok(archive.months[i - 1] >= archive.months[i], `months out of order: ${archive.months}`);
    }
    assert.ok(archive.items.every((item) => /^note\.html\?slug=/.test(item.href)));
    assert.ok(archive.items.some((item) => item.column.includes('随笔')));

    await page.click('[data-logs-view="grid"]');
    await page.waitForFunction(() => document.querySelectorAll('.note-card').length === 10);
  } finally { await page.close(); await close(); }
});

test('the reading bar tracks how far down the page you are', async () => {
  const { page, close } = await shellPage('index.html');
  try {
    await page.waitForSelector('.reading-bar', { state: 'attached' });
    const start = await page.evaluate(() => getComputedStyle(document.querySelector('.reading-bar')).transform);
    assert.ok(/matrix\(0, 0, 0, 1, 0, 0\)|none/.test(start) || start === 'matrix(0, 0, 0, 1, 0, 0)', `bar should start empty, saw ${start}`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(220);
    const end = await page.evaluate(() => {
      const matrix = getComputedStyle(document.querySelector('.reading-bar')).transform;
      const parts = matrix.match(/matrix\(([^)]+)\)/);
      return parts ? Number(parts[1].split(',')[0]) : 0;
    });
    assert.ok(end > 0.9, `bar only reached ${end} of the page`);
    const width = await page.evaluate(() => document.querySelector('.reading-bar').getBoundingClientRect().width);
    assert.ok(width > 300, 'the bar must span the viewport');
  } finally { await page.close(); await close(); }
});
