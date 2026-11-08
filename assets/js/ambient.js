/* =========================================================
   kawaii / STUDY OS — pixel ambient field
   ========================================================= */

(function () {
  "use strict";

  const COLORS = [
    { r: 255, g: 95, b: 210 },
    { r: 184, g: 255, b: 90 },
    { r: 111, g: 247, b: 255 },
    { r: 255, g: 196, b: 91 },
    { r: 195, g: 164, b: 255 }
  ];

  let canvas = null;
  let ctx = null;
  let particles = [];
  let width = 0;
  let height = 0;
  let dpr = 1;
  let raf = 0;
  let last = 0;
  let running = false;

  function reduced() {
    return window.Kawaii && window.Kawaii.ui.prefersReduced
      ? window.Kawaii.ui.prefersReduced()
      : false;
  }

  function shouldRun() {
    const skin = document.documentElement.dataset.skin;
    const fx = document.documentElement.dataset.fx;
    return skin === "pixel" && fx !== "off" && !reduced() && !document.hidden;
  }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.className = "ambient-canvas";
    canvas.setAttribute("aria-hidden", "true");
    document.body.insertBefore(canvas, document.body.firstChild);
    ctx = canvas.getContext("2d");
    if (ctx) ctx.imageSmoothingEnabled = false;
  }

  function resize() {
    if (!canvas || !ctx) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    spawn();
  }

  function spawn() {
    const count = Math.max(26, Math.min(72, Math.round((width * height) / 26000)));
    particles = [];
    for (let i = 0; i < count; i += 1) {
      particles.push(makeParticle(true));
    }
  }

  function makeParticle(seed) {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const cross = Math.random() < 0.16;
    return {
      x: Math.random() * width,
      y: seed ? Math.random() * height : height + Math.random() * 40,
      size: Math.random() < 0.72 ? 2 : 3,
      speed: 0.08 + Math.random() * 0.34,
      drift: (Math.random() - 0.5) * 0.18,
      phase: Math.random() * Math.PI * 2,
      twinkle: 0.6 + Math.random() * 1.8,
      alpha: 0.18 + Math.random() * 0.55,
      color,
      cross
    };
  }

  function drawParticle(p, time) {
    const flicker = 0.55 + 0.45 * Math.sin(time * p.twinkle + p.phase);
    const alpha = Math.max(0, Math.min(0.9, p.alpha * flicker));
    const x = Math.round(p.x / 2) * 2;
    const y = Math.round(p.y / 2) * 2;
    const { r, g, b } = p.color;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    ctx.fillRect(x, y, p.size, p.size);
    if (p.cross) {
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.35})`;
      ctx.fillRect(x - p.size * 2, y, p.size, p.size);
      ctx.fillRect(x + p.size * 2, y, p.size, p.size);
      ctx.fillRect(x, y - p.size * 2, p.size, p.size);
      ctx.fillRect(x, y + p.size * 2, p.size, p.size);
    }
  }

  function frame(time) {
    if (!running) return;
    raf = window.requestAnimationFrame(frame);
    if (!ctx) return;
    if (time - last < 33) return;
    const delta = Math.min(64, time - last) / 16.67;
    last = time;

    ctx.clearRect(0, 0, width, height);

    const t = time / 1000;
    particles.forEach((p) => {
      p.y -= p.speed * delta;
      p.x += (p.drift + Math.sin(t * 0.6 + p.phase) * 0.06) * delta;
      if (p.y < -16) {
        Object.assign(p, makeParticle(false));
        return;
      }
      if (p.x < -16) p.x = width + 8;
      if (p.x > width + 16) p.x = -8;
      drawParticle(p, t);
    });
  }

  function start() {
    if (running) return;
    ensureCanvas();
    if (!canvas || !ctx) return;
    if (canvas.width === 0) resize();
    running = true;
    last = 0;
    raf = window.requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    if (ctx) ctx.clearRect(0, 0, width, height);
  }

  function evaluate() {
    if (shouldRun()) start();
    else stop();
  }

  function init() {
    ensureCanvas();
    resize();
    evaluate();

    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (canvas && canvas.width > 0) resize();
      }, 160);
    });

    document.addEventListener("visibilitychange", evaluate);
    document.addEventListener("kawaii:skinchange", evaluate);
    document.addEventListener("kawaii:fxchange", evaluate);
document.addEventListener("kawaii:motionchange", evaluate);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
