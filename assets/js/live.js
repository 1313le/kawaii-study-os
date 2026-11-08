/* =========================================================
   kawaii / STUDY OS — public writing live
   The write desk opts in to publish its title, caret line/col
   and last four lines. Visitors poll /api/live and paint that
   state onto the portrait CRT. Static hosting stays local.
   ========================================================= */

(function () {
  "use strict";

  const stage = document.querySelector("[data-portrait]");
  const overlay = document.querySelector("[data-portrait-live]");
  const ctx = overlay ? overlay.getContext("2d") : null;
  const copy = document.querySelector("[data-live-copy]");
  const room = document.querySelector("[data-live-room]");
  const monitor = document.querySelector("[data-live-monitor]");
  const large = document.querySelector("[data-live-monitor-canvas]");
  const largeCtx = large ? large.getContext("2d") : null;
  const POLL = 3000;
  const OFFLINE_POLL = 20000;
  let state = null;
  let live = false;
  let timer = 0;
  let raf = 0;
  let lastPaint = 0;
  let failures = 0;
  let started = false;

  function label() {
    if (!live || !state) return "ONLINE";
    return `LIVE · LN ${state.line} · COL ${state.col}`;
  }

  function paintFeed() {
    const text = label();
    document.querySelectorAll("[data-desk-feed-inline]").forEach((node) => {
      if (node.textContent !== text) node.textContent = text;
    });
    if (stage) stage.dataset.live = live ? "on" : "off";
    document.documentElement.dataset.live = live ? "on" : "off";
    if (copy) {
      if (live && state) {
        const last = String(state.tail || "").split("\n").filter(Boolean).slice(-1)[0] || "";
        copy.textContent = `LIVE / ${state.title}${last ? ` — ${last}` : ""}`;
        copy.hidden = false;
      } else {
        copy.textContent = "";
        copy.hidden = true;
      }
    }
    if (room) room.dataset.live = live ? "on" : "off";
    if (monitor) monitor.dataset.live = live ? "on" : "off";
    const badge = document.querySelector("[data-live-room-badge]");
    if (badge) badge.textContent = live ? "ON AIR" : "STANDBY";
    const status = document.querySelector("[data-live-room-status]");
    if (status) status.textContent = live && state ? `LN ${state.line} · COL ${state.col}` : "STANDBY";
    const roomTitle = document.querySelector("[data-live-room-title]");
    if (roomTitle) roomTitle.textContent = live && state ? state.title : "等待作者上线";
    const roomMeta = document.querySelector("[data-live-room-meta]");
    if (roomMeta) {
      roomMeta.textContent = live && state
        ? `${Number(state.chars) || 0} CHARS · ${Number(state.totalLines) || 1} LINES`
        : "写作台 LIVE 默认开启";
    }
    if (!live) paintStandby();
  }

  function blitLarge(texture) {
    if (!large || !largeCtx) return;
    largeCtx.imageSmoothingEnabled = false;
    largeCtx.clearRect(0, 0, large.width, large.height);
    largeCtx.drawImage(texture, 0, 0, large.width, large.height);
  }

  function paintStandby() {
    if (!window.KawaiiDeskScreen) return;
    const screen = window.KawaiiDeskScreen;
    let texture = screen.texture;
    if (screen.paintCrt) {
      screen.paintCrt(null, performance.now());
      texture = screen.crtTexture;
    } else {
      screen.paint(null, performance.now());
    }
    blitLarge(texture);
  }

  function stopLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastPaint = 0;
  }

  function draw(now) {
    if (!live || (!overlay && !large) || !window.KawaiiDeskScreen) return;
    const source = state || {};
    if (!source.at) source.at = Date.now();
    const screen = window.KawaiiDeskScreen;
    let texture = screen.texture;
    if (screen.paintCrt) {
      screen.paintCrt(source, now);
      texture = screen.crtTexture;
    } else {
      screen.paint(source, now);
    }
    if (overlay && ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      ctx.drawImage(texture, 0, 0, overlay.width, overlay.height);
    }
    blitLarge(texture);
  }

  function loop(now) {
    raf = 0;
    if (!live || document.hidden) return;
    if (now - lastPaint > 120) {
      lastPaint = now;
      draw(now);
    }
    raf = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (raf || !live) return;
    draw(performance.now());
    raf = requestAnimationFrame(loop);
  }

  function apply(data) {
    const next = Boolean(data && data.live && data.state);
    live = next;
    state = next ? data.state : null;
    paintFeed();
    if (live) startLoop();
    else stopLoop();
    document.dispatchEvent(new CustomEvent("kawaii:live", {
      detail: { live, state, enabled: Boolean(data && data.enabled), at: data && data.at }
    }));
  }

  function schedule(delay) {
    clearTimeout(timer);
    timer = window.setTimeout(refresh, delay);
  }

  async function refresh() {
    if (document.hidden) {
      schedule(POLL);
      return;
    }
    try {
      const response = await fetch("/api/live", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      failures = 0;
      apply(data);
      schedule(POLL);
    } catch (error) {
      failures += 1;
      apply({ enabled: false, live: false, state: null });
      schedule(failures > 2 ? OFFLINE_POLL : POLL);
    }
  }

  function start() {
    if (started) return;
    started = true;
    paintStandby();
    refresh();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh();
    });
    document.addEventListener("kawaii:fxchange", () => {
      if (live) startLoop();
      else paintStandby();
    });
    document.addEventListener("kawaii:motionchange", () => {
      if (live) startLoop();
      else paintStandby();
    });
    document.addEventListener("kawaii:skinchange", () => {
      if (live) startLoop();
      else paintStandby();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  window.KawaiiLive = {
    state: () => state,
    live: () => live,
    refresh
  };
})();
