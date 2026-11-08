import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openBrowser } from './browser-fixture.mjs';

let fixture;
before(async () => { fixture = await openBrowser(); });
after(async () => { await fixture?.close(); });

async function home() {
  const page = await fixture.context.newPage();
  await page.goto('/index.html');
  await page.locator('.hero-crt.is-on').waitFor();
  return page;
}

test('CRT leaves at least 85% width and 68% height available for code', async () => {
  const page = await home();
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const area = await page.evaluate(() => {
        const screen = document.querySelector('[data-crt-screen]').getBoundingClientRect();
        const code = document.querySelector('[data-crt-code]').getBoundingClientRect();
        return { width: code.width / screen.width, height: code.height / screen.height };
      });
      assert.ok(area.width >= 0.85, `${width}px code width ratio: ${area.width}`);
      assert.ok(area.height >= 0.68, `${width}px code height ratio: ${area.height}`);
    }
  } finally { await page.close(); }
});

test('hover keeps the desk image and keyboard overlay on the same pixel plane', async () => {
  const page = await home();
  try {
    await page.locator('.console-window').hover();
    await page.waitForFunction(() => !document.querySelector('.console-window__visual img').getAnimations().some(a => a.playState === 'running'));
    const geometry = await page.evaluate(() => {
      const img = document.querySelector('.console-window__visual img').getBoundingClientRect();
      const keys = document.querySelector('[data-crt-keys]').getBoundingClientRect();
      return ['left', 'top', 'width', 'height'].map(k => Math.abs(img[k] - keys[k]));
    });
    assert.ok(geometry.every(delta => delta < 0.3), `Image / overlay deltas: ${geometry}`);
  } finally { await page.close(); }
});

test('cover scope preserves original bezel pixels rather than painting over them', async () => {
  const page = await home();
  try {
    await page.locator('.cfx').first().scrollIntoViewIfNeeded();
    const changes = await page.evaluate(async () => {
      const svg = document.querySelector('.cfx');
      const original = svg.previousElementSibling;
      await original.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 1536; canvas.height = 1024;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(original, 0, 0);
      const points = [[785,180],[790,300],[1100,380],[1325,320],[825,332]];
      const before = points.map(([x,y]) => Array.from(ctx.getImageData(x,y,1,1).data));
      const clone = svg.cloneNode(true);
      for (const child of [...clone.children]) {
        if (child.tagName !== 'defs' && !child.classList.contains('cfx-scope')) child.remove();
      }
      for (const image of clone.querySelectorAll('image')) {
        const source = new Image(); source.src = new URL(image.getAttribute('href'), location.href);
        await source.decode();
        const buffer = document.createElement('canvas'); buffer.width = source.width; buffer.height = source.height;
        buffer.getContext('2d').drawImage(source,0,0);
        image.setAttribute('href',buffer.toDataURL());
      }
      clone.setAttribute('width','1536'); clone.setAttribute('height','1024');
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
      await image.decode(); ctx.drawImage(image,0,0);
      return points.map(([x,y],i) => ({point:[x,y],delta: Math.max(...Array.from(ctx.getImageData(x,y,1,1).data).map((v,c) => Math.abs(v-before[i][c])))}));
    });
    assert.ok(changes.every(item => item.delta <= 2), JSON.stringify(changes));
  } finally { await page.close(); }
});

async function clockedHome() {
  const page = await fixture.context.newPage();
  await page.clock.install();
  await page.goto('/index.html');
  await page.locator('.console-window__visual > img').evaluate(img => img.decode());
  return page;
}

async function scenePixels(page) {
  return page.locator('[data-scene-layer]').evaluateAll(canvases => Object.fromEntries(canvases.map(canvas => {
    const { width, height } = canvas;
    const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    const edges = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) edges.push(...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
    }
    let hash = 0;
    for (const value of data) hash = (hash * 31 + value) | 0;
    return [canvas.dataset.sceneLayer, { hash, edges }];
  })));
}

test('cat and water move locally while every patch border stays fixed', async () => {
  const page = await clockedHome();
  try {
    assert.equal(await page.locator('[data-scene-layer]').count(), 3);
    await page.clock.runFor(100);
    const before = await scenePixels(page);
    await page.clock.runFor(1500);
    const after = await scenePixels(page);
    for (const name of ['cat', 'water']) {
      assert.notEqual(after[name].hash, before[name].hash, `${name} must change pixels`);
      assert.deepEqual(after[name].edges, before[name].edges, `${name} must not move its rectangle`);
    }
    assert.deepEqual(after.mouse, before.mouse, 'mouse waits for a code action');
  } finally { await page.close(); }
});

test('finished code cues a mouse action and compile before the cat reacts to a crash', async () => {
  const page = await clockedHome();
  try {
    assert.equal(await page.locator('[data-scene-layer="mouse"]').count(), 1);
    await page.clock.runFor(100);
    const idleMouse = (await scenePixels(page)).mouse.hash;
    const seen = new Set();
    let movedMouse = false;
    for (let i = 0; i < 90; i++) {
      await page.clock.runFor(250);
      const phase = await page.locator('[data-hero-crt]').getAttribute('data-phase');
      seen.add(phase);
      if (phase === 'pointing') movedMouse ||= (await scenePixels(page)).mouse.hash !== idleMouse;
      if (phase === 'crash') break;
    }
    assert.ok(seen.has('pointing') && seen.has('compiling') && seen.has('crash'), [...seen].join(','));
    assert.ok(movedMouse, 'mouse pixels change for its click, not just a status label');
    assert.equal(await page.locator('[data-crt-bsod]').isVisible(), true);
    assert.equal(await page.locator('.hero-crt__zzz').isVisible(), false);
    const startled = (await scenePixels(page)).cat.hash;
    await page.clock.runFor(1600);
    assert.notEqual((await scenePixels(page)).cat.hash, startled, 'cat settles after its startle');
    await page.locator('[data-crt-screen]').click();
    assert.equal(await page.locator('[data-hero-crt]').getAttribute('data-phase'), 'reboot');
  } finally { await page.close(); }
});

test('scene painting stops for FX, LINE, reduced motion and offscreen', async () => {
  const page = await clockedHome();
  try {
    assert.equal(await page.locator('[data-scene-layer]').count(), 3);
    await page.evaluate(() => {
      window.scenePaints = 0;
      const put = CanvasRenderingContext2D.prototype.putImageData;
      CanvasRenderingContext2D.prototype.putImageData = function (...args) {
        if (this.canvas.matches('[data-scene-layer]')) window.scenePaints++;
        return put.apply(this, args);
      };
    });
    for (const mode of ['fx', 'line', 'motion', 'offscreen']) {
      if (mode === 'fx') await page.evaluate(() => { document.documentElement.dataset.fx = 'off'; document.dispatchEvent(new Event('kawaii:fxchange')); });
      if (mode === 'line') await page.evaluate(() => { document.documentElement.dataset.skin = 'line'; document.dispatchEvent(new Event('kawaii:skinchange')); });
      if (mode === 'motion') await page.emulateMedia({ reducedMotion: 'reduce' });
      if (mode === 'offscreen') await page.locator('footer').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => !document.querySelector('[data-hero-crt]').classList.contains('is-on'));
      const paints = await page.evaluate(() => window.scenePaints);
      await page.clock.runFor(600);
      assert.equal(await page.evaluate(() => window.scenePaints), paints, `${mode} still paints`);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.evaluate(() => { document.documentElement.dataset.fx = 'on'; document.documentElement.dataset.skin = 'pixel'; document.dispatchEvent(new Event('kawaii:skinchange')); });
      await page.locator('.console-window').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector('[data-hero-crt]').classList.contains('is-on'));
    }
  } finally { await page.close(); }
});

test('the about-page portrait paints a live scene and stops on fx off', async () => {
  const page = await fixture.context.newPage();
  try {
    await page.goto('/about.html');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-portrait-canvas]', { state: 'attached' });
    await page.waitForFunction(() => {
      const canvas = document.querySelector('[data-portrait-canvas]');
      return canvas.width > 0;
    });
    const sample = () => page.evaluate(() => {
      const canvas = document.querySelector('[data-portrait-canvas]');
      const view = new Uint32Array(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.buffer);
      let sum = 0;
      let painted = 0;
      for (let i = 0; i < view.length; i += 37) {
        sum = (sum * 31 + view[i]) >>> 0;
        if (view[i] !== 0) painted += 1;
      }
      return { sum, painted };
    });
    const first = await sample();
    await page.waitForTimeout(500);
    const second = await sample();
    assert.ok(first.painted > 500, `the overlay never painted (${first.painted})`);
    assert.notEqual(second.sum, first.sum, 'the window and the cat should move');

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-fx', 'off');
      document.dispatchEvent(new CustomEvent('kawaii:fxchange', { detail: { fx: 'off', on: false } }));
    });
    await page.waitForTimeout(450);
    const rest = await sample();
    await page.waitForTimeout(400);
    assert.equal((await sample()).sum, rest.sum, 'fx off must freeze the portrait');
  } finally { await page.close(); }
});

test('the about-page portrait ships a generated 12s loop with motion gates', async () => {
  const page = await fixture.context.newPage();
  try {
    await page.goto('/about.html');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-portrait-video]');
    const attrs = await page.evaluate(() => {
      const video = document.querySelector('[data-portrait-video]');
      return {
        muted: video.muted,
        loop: video.loop,
        playsInline: video.playsInline,
        preload: video.getAttribute('preload'),
        poster: video.getAttribute('poster'),
        src: video.getAttribute('data-src')
      };
    });
    assert.equal(attrs.muted, true);
    assert.equal(attrs.loop, true);
    assert.equal(attrs.playsInline, true);
    assert.equal(attrs.preload, 'none');
    assert.match(attrs.poster, /portrait-poster\.webp$/);
    assert.match(attrs.src, /portrait-loop\.mp4$/);

    await page.locator('.portrait-frame').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const video = document.querySelector('[data-portrait-video]');
      const stage = document.querySelector('[data-portrait]');
      return stage.classList.contains('is-video') && video.readyState >= 2 && !video.paused;
    }, null, { timeout: 20000 });
    const before = await page.evaluate(() => document.querySelector('[data-portrait-video]').currentTime);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => document.querySelector('[data-portrait-video]').currentTime);
    assert.ok(after > before, 'the portrait loop should advance');
    const dims = await page.evaluate(() => {
      const video = document.querySelector('[data-portrait-video]');
      return [video.videoWidth, video.videoHeight];
    });
    assert.deepEqual(dims, [1024, 1024]);

    await page.evaluate(() => { document.querySelector('[data-portrait-video]').currentTime = 5; });
    await page.waitForTimeout(450);
    const away = await page.evaluate(() => {
      const stage = document.querySelector('[data-portrait]');
      const canvas = document.querySelector('[data-portrait-away]');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let alpha = 0;
      for (let i = 3; i < pixels.length; i += 4) alpha += pixels[i];
      return {
        state: stage.dataset.away,
        opacity: Number(getComputedStyle(canvas).opacity),
        painted: alpha > 0
      };
    });
    assert.equal(away.state, 'on', 'the coffee sip shows the away copy');
    assert.ok(away.opacity > 0.9, `away overlay opacity: ${away.opacity}`);
    assert.equal(away.painted, true, 'the away copy is painted into the CRT');

    await page.evaluate(() => { document.querySelector('[data-portrait-video]').currentTime = 1; });
    await page.waitForTimeout(450);
    const awayOff = await page.evaluate(() => {
      const stage = document.querySelector('[data-portrait]');
      const canvas = document.querySelector('[data-portrait-away]');
      return { state: stage.dataset.away, opacity: Number(getComputedStyle(canvas).opacity) };
    });
    assert.equal(awayOff.state, 'off', 'the away copy leaves when typing resumes');
    assert.ok(awayOff.opacity < 0.1, `away overlay opacity: ${awayOff.opacity}`);

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-fx', 'off');
      document.dispatchEvent(new CustomEvent('kawaii:fxchange', { detail: { fx: 'off', on: false } }));
    });
    await page.waitForTimeout(400);
    const off = await page.evaluate(() => {
      const video = document.querySelector('[data-portrait-video]');
      const stage = document.querySelector('[data-portrait]');
      return {
        paused: video.paused,
        time: video.currentTime,
        isVideo: stage.classList.contains('is-video')
      };
    });
    assert.equal(off.paused, true, 'fx off must pause the loop');
    assert.equal(off.isVideo, true, 'fx off must keep the generated still visible');
    assert.ok(off.time < 0.05, `fx off must return to the first frame (${off.time})`);

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-skin', 'line');
      document.dispatchEvent(new CustomEvent('kawaii:skinchange', { detail: { skin: 'line' } }));
      document.documentElement.setAttribute('data-fx', 'on');
      document.dispatchEvent(new CustomEvent('kawaii:fxchange', { detail: { fx: 'on', on: true } }));
    });
    await page.waitForTimeout(400);
    const line = await page.evaluate(() => {
      const video = document.querySelector('[data-portrait-video]');
      return { display: getComputedStyle(video).display, paused: video.paused };
    });
    assert.equal(line.display, 'none', 'the line skin keeps its still portrait');
    assert.equal(line.paused, true, 'the loop must not run in the line skin');

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-skin', 'pixel');
      document.dispatchEvent(new CustomEvent('kawaii:skinchange', { detail: { skin: 'pixel' } }));
    });
    await page.waitForTimeout(300);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(400);
    const reduced = await page.evaluate(() => {
      const video = document.querySelector('[data-portrait-video]');
      return {
        paused: video.paused,
        isVideo: document.querySelector('[data-portrait]').classList.contains('is-video')
      };
    });
    assert.equal(reduced.paused, true, 'OS reduced motion must pause the loop');
    assert.equal(reduced.isVideo, true, 'OS reduced motion keeps the generated still');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(600);
    assert.equal(
      await page.evaluate(() => !document.querySelector('[data-portrait-video]').paused),
      true,
      'the loop resumes when reduced motion is lifted'
    );
  } finally { await page.close(); }
});

test('the portrait cycles the delivered seven-frame sprite sheet', async () => {
  const page = await fixture.context.newPage();
  try {
    await page.goto('/about.html');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-portrait-canvas]', { state: 'attached' });
    await page.waitForFunction(
      () => window.__portraitScene && window.__portraitScene.framesReady === 7,
      null,
      { timeout: 15000 }
    );
    const info = await page.evaluate(() => {
      const scene = window.__portraitScene;
      const sizes = {};
      for (const [name, img] of Object.entries(scene.frames)) sizes[name] = [img.naturalWidth, img.naturalHeight];
      return {
        names: Object.keys(scene.frames).sort(),
        sizes,
        loop: scene.loop,
        frames: [1.5, 5.1, 7, 9.2, 12.6, 15, 4.8].map((t) => scene.frameAt(t).frame)
      };
    });
    assert.deepEqual(info.names, ['blink', 'happy', 'idle', 'sip', 'sleepy', 'think', 'type']);
    for (const [name, size] of Object.entries(info.sizes)) {
      assert.deepEqual(size, [128, 192], `${name} must ship at its native 128x192`);
    }
    assert.equal(info.loop, 20);
    assert.deepEqual(info.frames, ['type', 'idle', 'sip', 'happy', 'think', 'sleepy', 'blink']);
  } finally { await page.close(); }
});

test('portrait frame switches actually repaint the girl', async () => {
  const page = await fixture.context.newPage();
  try {
    await page.goto('/about.html');
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => window.__portraitScene && window.__portraitScene.framesReady === 7,
      null,
      { timeout: 15000 }
    );
    const hashes = await page.evaluate(() => {
      const scene = window.__portraitScene;
      scene.stop();
      const sample = (t) => {
        scene.paint(t, performance.now());
        const data = scene.ctx.getImageData(340, 280, 200, 260).data;
        let hash = 0;
        for (let i = 0; i < data.length; i += 17) hash = ((hash * 31) + data[i]) >>> 0;
        return hash;
      };
      return { type: sample(1.5), sip: sample(7), happy: sample(9.2), sleepy: sample(15) };
    });
    const unique = new Set(Object.values(hashes));
    assert.equal(unique.size, 4, `portrait states must look different: ${JSON.stringify(hashes)}`);
  } finally { await page.close(); }
});
