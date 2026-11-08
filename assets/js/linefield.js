/* =========================================================
   kawaii / STUDY OS — emblem field
   Line-skin hero module. The quantized vertical-bar field is
   kept, but it now rasterises the site's own mark (Kawaii.emblem)
   instead of meaningless noise. Motion only runs on state change:
   first sight, hover, and skin switch.
   ========================================================= */

(function () {
  "use strict";

  const canvas = document.querySelector("[data-linefield]");
  if (!canvas) return;

  const wrap = canvas.parentElement;
  const field = wrap.closest(".hero__field");
  const EMBLEM = window.Kawaii && window.Kawaii.emblem;
  if (!field || !EMBLEM) return;

  const ctx = canvas.getContext("2d");
  const CATGIRL = new Image();
  CATGIRL.decoding = "async";
  let catgirlReady = false;
  // Measured from avatar-catgirl.png: hair mass (ears to chin) and the
  // bright iris band. Runtime detection refines these if the art changes.
  const FEATURE_FALLBACK = {
    head: { x0: 0.109, y0: 0.062, x1: 0.943, y1: 0.666 },
    eyes: { x0: 0.332, y0: 0.436, x1: 0.664, y1: 0.552 }
  };
  let features = FEATURE_FALLBACK;
  CATGIRL.onload = () => {
    catgirlReady = true;
    features = measureFeatures();
    field.dataset.emblemSubject = "catgirl";
    painted = false;
    resize();
  };
  CATGIRL.src = "assets/img/avatar-catgirl.png";

  const PITCH = 4.4;
  const BAR_W = 1.35;
  const INSET = 0.9;
  const SWEEP_MS = 900;
  const SEGMENTS = 10;
  const ACCENT = [20, 92, 255];
  const NEUTRAL = [22, 22, 22];

  let W = 0;
  let H = 0;
  let box = { x: 0, y: 0, size: 0 };
  let die = { x0: 0, x1: 0, y: 0 };
  let columns = [];
  let painted = false;
  let revealed = false;
  let running = false;
  let raf = 0;
  let sweepT0 = 0;
  let sweepX = Infinity;
  let visible = true;
  let pct = 0;

  // Pointer physics: the field is pushed away from the cursor and springs back
  // to its exact grid, so hovering feels like touching a physical object.
  const SPRING_K = 145;
  const SPRING_C = 19;
  const PULSE_DECAY = 5.5;
  const pointer = { x: 0, y: 0, active: false, inside: false, lastX: 0, lastY: 0 };
  let pulse = 0;
  let motionRaf = 0;
  let lastMotion = 0;
  let baseLayer = null;
  let sideLayer = null;

  /* ---------- gates ---------- */

  const reduced = () => (window.Kawaii && window.Kawaii.ui && window.Kawaii.ui.prefersReduced ? window.Kawaii.ui.prefersReduced() : window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const fxOn = () => document.documentElement.dataset.fx !== "off";
  const isLineSkin = () => document.documentElement.dataset.skin === "line";
  const canAnimate = () => isLineSkin() && fxOn() && !reduced() && visible && !document.hidden;

  function setState(next) {
    if (field.dataset.emblemState !== next) field.dataset.emblemState = next;
  }

  function readPct() {
    const stats = window.Kawaii && window.Kawaii.stats;
    if (!stats || typeof stats.pct !== "function") return 0;
    return Math.max(0, Math.min(100, Math.round(stats.pct() || 0)));
  }

  /* ---------- mask ---------- */

  function measureFeatures() {
    const size = 256;
    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;
    const octx = off.getContext("2d");
    octx.drawImage(CATGIRL, 0, 0, size, size);
    const data = octx.getImageData(0, 0, size, size).data;
    const head = { x0: size, y0: size, x1: -1, y1: -1 };
    const eyes = { x0: size, y0: size, x1: -1, y1: -1 };
    const grow = (target, x, y) => {
      if (x < target.x0) target.x0 = x;
      if (y < target.y0) target.y0 = y;
      if (x > target.x1) target.x1 = x;
      if (y > target.y1) target.y1 = y;
    };
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * size + x) * 4;
        if (data[i + 3] < 40) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (b > 180 && g > 120 && r < 110 && b > r * 1.4) grow(eyes, x, y);
        if (y < size * 0.66) {
          const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
          if (lum < 0.45) grow(head, x, y);
        }
      }
    }
    if (eyes.x1 <= eyes.x0 || head.x1 <= head.x0) return FEATURE_FALLBACK;
    return {
      head: {
        x0: head.x0 / size - 0.004,
        y0: head.y0 / size - 0.004,
        x1: head.x1 / size + 0.022,
        y1: head.y1 / size + 0.022
      },
      eyes: {
        x0: eyes.x0 / size - 0.02,
        y0: eyes.y0 / size - 0.025,
        x1: eyes.x1 / size + 0.02,
        y1: eyes.y1 / size + 0.025
      }
    };
  }

  function placeHudBox(name, feature) {
    const left = ((box.x + feature.x0 * box.size) / W) * 100;
    const top = ((box.y + feature.y0 * box.size) / H) * 100;
    const width = ((feature.x1 - feature.x0) * box.size / W) * 100;
    const height = ((feature.y1 - feature.y0) * box.size / H) * 100;
    field.style.setProperty(`--hud-${name}-left`, `${left.toFixed(2)}%`);
    field.style.setProperty(`--hud-${name}-top`, `${top.toFixed(2)}%`);
    field.style.setProperty(`--hud-${name}-width`, `${width.toFixed(2)}%`);
    field.style.setProperty(`--hud-${name}-height`, `${height.toFixed(2)}%`);
  }

  function rasterMask(size) {
    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;
    const octx = off.getContext("2d");
    const alpha = new Uint8Array(size * size);

    if (catgirlReady) {
      octx.drawImage(CATGIRL, 0, 0, size, size);
      const data = octx.getImageData(0, 0, size, size).data;
      for (let i = 0; i < alpha.length; i += 1) {
        const a = data[i * 4 + 3] / 255;
        if (a < 0.16) continue;
        const lum = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
        // The pale face and shirt become negative space; hair, eyes,
        // ribbon and shading stay as the line field.
        const dark = Math.max(0, Math.min(1, (0.64 - lum) / 0.56));
        alpha[i] = Math.round(255 * a * dark);
      }
      return alpha;
    }

    octx.setTransform(size / EMBLEM.size, 0, 0, size / EMBLEM.size, 0, 0);
    octx.fillStyle = "#000000";
    EMBLEM.faces.forEach((face) => {
      const pts = face.points.split(" ").map((pair) => pair.split(",").map(Number));
      octx.globalAlpha = face.tone;
      octx.beginPath();
      pts.forEach((p, index) => (index ? octx.lineTo(p[0], p[1]) : octx.moveTo(p[0], p[1])));
      octx.closePath();
      octx.fill();
    });
    const data = octx.getImageData(0, 0, size, size).data;
    for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * 4 + 3];
    return alpha;
  }

  function buildGeometry() {
    const size = Math.round(Math.min(W, H) * INSET);
    box = { x: Math.round((W - size) / 2), y: Math.round((H - size) / 2), size };
    placeHudBox("head", features.head);
    placeHudBox("eyes", features.eyes);

    const alpha = rasterMask(size);
    columns = [];
    for (let x = box.x; x <= box.x + size; x += PITCH) {
      const mx = Math.max(0, Math.min(size - 1, Math.round(x - box.x)));
      const runs = [];
      let run = null;
      let level = 0;
      for (let y = 0; y <= size; y += 1) {
        // Faces are quantised so a column crossing two of them keeps both
        // readings instead of averaging them into one flat tone.
        const tone = alpha[Math.min(size - 1, y) * size + mx] / 255;
        const next = tone > 0.9 ? 4 : tone > 0.62 ? 3 : tone > 0.42 ? 2 : tone > 0.12 ? 1 : 0;
        if (next !== level) {
          level = next;
          run = level
            ? { y0: box.y + y, y1: box.y + y, level, sum: tone, n: 1, ox: 0, oy: 0, vx: 0, vy: 0 }
            : null;
          if (run) runs.push(run);
        } else if (run) {
          run.y1 = box.y + y;
          run.sum += tone;
          run.n += 1;
        }
      }
      columns.push({ x, runs });
    }

    if (catgirlReady) {
      // A solid extinguished edge on the lower-right: the portrait reads as
      // an extruded slab instead of a flat halftone.
      sideLayer = document.createElement("canvas");
      sideLayer.width = size;
      sideLayer.height = size;
      const side = sideLayer.getContext("2d");
      side.drawImage(CATGIRL, size * 0.02, size * 0.02, size, size);
      side.globalCompositeOperation = "source-in";
      side.fillStyle = "rgba(20, 92, 255, 0.42)";
      side.fillRect(0, 0, size, size);
      side.globalCompositeOperation = "destination-out";
      side.drawImage(CATGIRL, 0, 0, size, size);
      side.globalCompositeOperation = "source-over";
      die = {
        x0: box.x + size * 0.31,
        x1: box.x + size * 0.69,
        y: box.y + size * 0.9
      };
    } else {
      sideLayer = null;
      const scale = size / EMBLEM.size;
      die = {
        x0: box.x + 43 * scale,
        x1: box.x + 77 * scale,
        y: box.y + 47 * scale + 4
      };
    }
    baseLayer = null;
  }

  /* ---------- draw ---------- */

  const rgba = (channel, alpha) =>
    `rgba(${channel[0]}, ${channel[1]}, ${channel[2]}, ${alpha.toFixed(3)})`;

  function drawField(target) {
    const g = target || ctx;
    g.fillStyle = rgba(NEUTRAL, 0.07);
    for (let y = 10; y < H; y += 22) {
      for (let x = 10; x < W; x += 22) g.fillRect(x, y, 1, 1);
    }
    g.lineWidth = 1;
    g.strokeStyle = rgba(NEUTRAL, 0.05);
    g.setLineDash([2, 8]);
    columns.forEach((col, index) => {
      g.lineDashOffset = (index % 3) * 2.5;
      g.beginPath();
      g.moveTo(col.x, 0);
      g.lineTo(col.x, H);
      g.stroke();
    });
    g.setLineDash([]);
    g.lineDashOffset = 0;
    if (catgirlReady) {
      const shadow = g.createRadialGradient(W / 2, H * 0.91, 4, W / 2, H * 0.91, W * 0.28);
      shadow.addColorStop(0, rgba(ACCENT, 0.1));
      shadow.addColorStop(1, rgba(ACCENT, 0));
      g.save();
      g.translate(W / 2, H * 0.91);
      g.scale(1, 0.2);
      g.beginPath();
      g.arc(0, 0, W * 0.28, 0, Math.PI * 2);
      g.fillStyle = shadow;
      g.fill();
      g.restore();
    }
  }

  function paintBase() {
    if (!baseLayer) {
      baseLayer = document.createElement("canvas");
      baseLayer.width = canvas.width;
      baseLayer.height = canvas.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const bctx = baseLayer.getContext("2d");
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawField(bctx);
    }
    return baseLayer;
  }

  const LEVEL_ALPHA = [0, 0.3, 0.52, 0.74, 0.96];
  const LEVEL_DASH = [null, [2.2, 2.8], [3.2, 2.25], [4.2, 1.7], [5.2, 1.15]];

  function strokeColumns() {
    const radius = box.size / 4;
    columns.forEach((col) => {
      if (col.x > sweepX) return;
      col.runs.forEach((run) => {
        const x = col.x + run.ox;
        const y0 = run.y0 + run.oy;
        const y1 = run.y1 + 1 + run.oy;
        let alpha = LEVEL_ALPHA[run.level];
        if (pointer.active && pulse > 0.02) {
          const dx = pointer.x - x;
          const dy = pointer.y - (y0 + y1) / 2;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < radius) alpha = Math.min(1, alpha + (1 - distance / radius) * 0.22);
        }
        ctx.strokeStyle = rgba(ACCENT, alpha);
        ctx.setLineDash(LEVEL_DASH[run.level]);
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
      });
    });
  }

  function drawMark() {
    ctx.lineWidth = BAR_W;
    ctx.lineCap = "butt";
    // A ghost pass gives the portrait a side extrusion without turning the
    // whole hero into a heavy canvas scene.
    ctx.save();
    ctx.translate(3, 3);
    ctx.globalAlpha = 0.25;
    strokeColumns();
    ctx.restore();
    strokeColumns();
    ctx.setLineDash([]);
  }

  function drawRail() {
    if (sweepX <= die.x1) return;
    const cell = (die.x1 - die.x0) / SEGMENTS;
    const lit = Math.round((pct / 100) * SEGMENTS);
    for (let index = 0; index < SEGMENTS; index += 1) {
      ctx.fillStyle = rgba(ACCENT, index < lit ? 0.95 : 0.16);
      ctx.fillRect(die.x0 + index * cell + cell * 0.2, die.y, cell * 0.6, 3);
    }
  }

  function drawEdge() {
    if (sweepX === Infinity || sweepX < -20 || sweepX > W + 20) return;
    for (let k = 0; k < 4; k += 1) {
      const x = Math.round(sweepX) - k * 3;
      if (x < 0 || x > W) continue;
      ctx.fillStyle = rgba(ACCENT, 0.55 - k * 0.12);
      ctx.fillRect(x, 0, 1.5, H);
    }
  }

  function draw() {
    if (!painted) return;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(paintBase(), 0, 0, W, H);
    if (sideLayer) ctx.drawImage(sideLayer, box.x, box.y);
    drawMark();
    drawRail();
    drawEdge();
  }

  /* ---------- pointer physics ---------- */

  function maxOffset() {
    let max = 0;
    for (const col of columns) {
      for (const run of col.runs) {
        const value = Math.abs(run.ox) + Math.abs(run.oy);
        if (value > max) max = value;
      }
    }
    return max;
  }

  function stepPhysics(dt) {
    const radius = box.size / 4;
    const steps = Math.max(1, Math.ceil(dt / (1 / 30)));
    const h = dt / steps;
    const pushing = pointer.active && pulse > 0.002;
    for (let s = 0; s < steps; s += 1) {
      for (const col of columns) {
        for (const run of col.runs) {
          let tx = 0;
          let ty = 0;
          if (pushing) {
            const restX = col.x;
            const restY = (run.y0 + run.y1) / 2;
            const dx = pointer.x - restX;
            const dy = pointer.y - restY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < radius && distance > 0.0001) {
              const falloff = 1 - distance / radius;
              const force = falloff * falloff * pulse * 25;
              tx = (dx / distance) * force;
              ty = (dy / distance) * force * 0.58;
            }
          }
          const ax = (tx - run.ox) * SPRING_K - run.vx * SPRING_C;
          const ay = (ty - run.oy) * SPRING_K - run.vy * SPRING_C;
          run.vx += ax * h;
          run.vy += ay * h;
          run.ox += run.vx * h;
          run.oy += run.vy * h;
        }
      }
    }
  }

  function settle() {
    for (const col of columns) {
      for (const run of col.runs) {
        run.ox = 0;
        run.oy = 0;
        run.vx = 0;
        run.vy = 0;
      }
    }
  }

  function motionFrame(timestamp) {
    motionRaf = 0;
    const now = timestamp / 1000;
    if (!lastMotion) lastMotion = now;
    let dt = now - lastMotion;
    lastMotion = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 1 / 30);
    pulse *= Math.exp(-PULSE_DECAY * dt);
    stepPhysics(dt);
    draw();
    if (pulse > 0.002 || maxOffset() > 0.01) {
      motionRaf = window.requestAnimationFrame(motionFrame);
      return;
    }
    settle();
    pulse = 0;
    lastMotion = 0;
    draw();
  }

  function startMotion() {
    if (motionRaf) return;
    lastMotion = 0;
    motionRaf = window.requestAnimationFrame(motionFrame);
  }

  function stopMotion() {
    if (motionRaf) window.cancelAnimationFrame(motionRaf);
    motionRaf = 0;
    lastMotion = 0;
    settle();
    pulse = 0;
  }

  /* ---------- sweep ---------- */

  function stop() {
    running = false;
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    sweepT0 = 0;
  }

  function resolve() {
    sweepX = Infinity;
    setState("resolved");
    draw();
  }

  function frame(timestamp) {
    if (!running) return;
    if (!sweepT0) sweepT0 = timestamp;
    const p = Math.min(1, (timestamp - sweepT0) / SWEEP_MS);
    sweepX = -30 + (1 - Math.pow(1 - p, 2.4)) * (W + 60);
    draw();
    if (p < 1) {
      raf = window.requestAnimationFrame(frame);
      return;
    }
    stop();
    stopMotion();
    resolve();
  }

  function scan() {
    if (!painted || running) return;
    revealed = true;
    setState("scanning");
    running = true;
    raf = window.requestAnimationFrame(frame);
  }

  function evaluate() {
    if (!painted) return;
    if (canAnimate() && !revealed) {
      scan();
      return;
    }
    stop();
    resolve();
  }

  /* ---------- sizing ---------- */

  function resize() {
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      painted = false;
      setState("resolved");
      return;
    }
    W = Math.round(rect.width);
    H = Math.round(rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildGeometry();
    painted = true;
    evaluate();
  }

  /* ---------- input ---------- */

  function pointerPoint(event) {
    const rect = wrap.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onPointerEnter(event) {
    if (isLineSkin()) {
      field.dataset.hud = "on";
      syncHud();
    }
    // A hover means the field is on screen, so `visible` is not consulted here.
    if (!isLineSkin() || !fxOn() || reduced()) return;
    scan();
    const point = pointerPoint(event);
    pointer.inside = true;
    pointer.active = true;
    pointer.x = point.x;
    pointer.y = point.y;
    pointer.lastX = point.x;
    pointer.lastY = point.y;
    pulse = 1;
    field.dataset.emblemPointer = "active";
    startMotion();
  }

  function onPointerMove(event) {
    if (isLineSkin()) field.dataset.hud = "on";
    if (!pointer.inside || !isLineSkin() || !fxOn() || reduced()) return;
    const point = pointerPoint(event);
    pointer.x = point.x;
    pointer.y = point.y;
    pointer.active = true;
    const dx = point.x - pointer.lastX;
    const dy = point.y - pointer.lastY;
    if (dx * dx + dy * dy > 2.25) {
      pulse = 1;
      pointer.lastX = point.x;
      pointer.lastY = point.y;
    }
    startMotion();
  }

  function onPointerLeave() {
    pointer.active = false;
    pointer.inside = false;
    field.dataset.emblemPointer = "idle";
    field.dataset.hud = "idle";
    if (!motionRaf && maxOffset() > 0.01) startMotion();
  }

  /* ---------- init ---------- */

  const hud = {
    root: field.querySelector(".field-hud"),
    state: field.querySelector("[data-hud-state]"),
    focus: field.querySelector("[data-hud-focus]"),
    title: field.querySelector("[data-hud-title]"),
    meta: field.querySelector("[data-hud-meta]")
  };

  function renderHud(detail) {
    const live = Boolean(detail && detail.live && detail.state);
    const state = live ? detail.state : null;
    if (hud.root) hud.root.dataset.signal = live ? "live" : "idle";
    if (hud.state) hud.state.textContent = live ? "LIVE" : "STANDBY";
    if (hud.focus) hud.focus.textContent = live ? "WRITING" : "IDLE";
    if (hud.title) {
      const title = String((state && state.title) || "").replace(/\.md$/i, "").trim();
      hud.title.textContent = live && title ? title : "作者现在不在写作台前";
    }
    if (hud.meta) {
      if (live) {
        const chars = Number(state.chars) || 0;
        hud.meta.textContent = `LN ${Number(state.line) || 1} · COL ${Number(state.col) || 1} · ${chars} CHARS`;
      } else {
        const stats = window.Kawaii && window.Kawaii.stats;
        hud.meta.textContent = stats
          ? `${stats.notes} ARTICLES · ${stats.collections} COLLECTIONS`
          : "DESK STANDBY";
      }
    }
  }

  function syncHud() {
    if (!window.KawaiiLive) return;
    renderHud({ live: window.KawaiiLive.live(), state: window.KawaiiLive.state() });
  }

  function init() {
    pct = readPct();
    field.dataset.emblemProgress = String(pct);
    field.dataset.hud = "idle";
    field.dataset.emblemSubject = catgirlReady ? "catgirl" : "emblem";
    renderHud({ live: false });
    document.addEventListener("kawaii:live", (event) => renderHud(event.detail));
    setState("idle");
    resize();
    window.setTimeout(resize, 0);

    new ResizeObserver(() => window.requestAnimationFrame(resize)).observe(wrap);
    field.dataset.emblemPointer = "idle";
    wrap.addEventListener("pointerenter", onPointerEnter);
    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerleave", onPointerLeave);

    if ("IntersectionObserver" in window) {
      const visibility = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            visible = entry.isIntersecting;
            evaluate();
          });
        },
        { threshold: 0.05 }
      );
      visibility.observe(wrap);
    }

    document.addEventListener("visibilitychange", evaluate);

    document.addEventListener("kawaii:progress", () => {
      const next = readPct();
      if (next === pct) return;
      pct = next;
      field.dataset.emblemProgress = String(pct);
      if (!running) draw();
    });

    document.addEventListener("kawaii:skinchange", () => {
      revealed = false;
      window.setTimeout(resize, 40);
    });

    document.addEventListener("kawaii:fxchange", evaluate);
document.addEventListener("kawaii:motionchange", evaluate);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
