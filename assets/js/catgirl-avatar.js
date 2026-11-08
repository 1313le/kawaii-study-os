/* =========================================================
   kawaii / STUDY OS — catgirl avatar
   The seven delivered 128x192 sprites run one shared timeline:
   typing, idle, a sip, a happy beat, thinking, sleepy. Any
   [data-catgirl] host with a [data-catgirl-img] child joins in;
   the optional [data-catgirl-caption] line names the pose.
   ========================================================= */

(function () {
  "use strict";

  const FRAMES = {
    idle: "assets/img/catgirl-idle.png",
    type: "assets/img/catgirl-type.png",
    sip: "assets/img/catgirl-sip.png",
    happy: "assets/img/catgirl-happy.png",
    blink: "assets/img/catgirl-blink.png",
    think: "assets/img/catgirl-think.png",
    sleepy: "assets/img/catgirl-sleepy.png"
  };

  const CAPTIONS = {
    type: "敲代码中",
    idle: "待机中",
    blink: "眨了眨眼",
    sip: "喝口咖啡",
    happy: "写完了！",
    think: "想一想…",
    sleepy: "有点困…"
  };

  const LOOP = 18000;

  const SEGMENTS = [
    ["type", 0, 4000],
    ["idle", 4000, 5600],
    ["sip", 5600, 8200],
    ["happy", 8200, 9400],
    ["idle", 9400, 10800],
    ["think", 10800, 13000],
    ["sleepy", 13000, 15000],
    ["idle", 15000, 18000]
  ];

  const root = document.documentElement;
  const registry = new Set();
  const started = performance.now();
  const reduced = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };
  let timer = 0;

  Object.keys(FRAMES).forEach((name) => {
    const image = new Image();
    image.decoding = "async";
    image.src = FRAMES[name];
  });

  function stateAt(time) {
    const t = ((time % LOOP) + LOOP) % LOOP;
    for (const [mode, from, to] of SEGMENTS) {
      if (t >= from && t < to) {
        const local = t - from;
        const blink = mode === "idle" && ((local > 460 && local < 620) || (local > 880 && local < 1040));
        return {
          mode,
          local,
          frame: blink ? "blink" : mode,
          caption: CAPTIONS[mode] || CAPTIONS.idle
        };
      }
    }
    return { mode: "idle", local: 0, frame: "idle", caption: CAPTIONS.idle };
  }

  function suspended() {
    if (window.KawaiiMotion && typeof window.KawaiiMotion.state === "function") {
      return window.KawaiiMotion.state().suspended;
    }
    return Boolean(reduced.matches) || root.dataset.fx === "off" || root.dataset.motion === "reduced";
  }

  function paint(el, state) {
    const frame = typeof state === "string" ? state : state.frame;
    const captionText = typeof state === "string"
      ? (CAPTIONS[state] || CAPTIONS.idle)
      : (state.caption || CAPTIONS[frame] || CAPTIONS.idle);
    if (el.dataset.frame !== frame) {
      el.dataset.frame = frame;
      el.dispatchEvent(new CustomEvent("kawaii:catgirlframe", { detail: { frame, mode: state.mode || frame } }));
    }
    const image = el.querySelector("[data-catgirl-img]");
    if (image && image.getAttribute("src") !== FRAMES[frame]) image.src = FRAMES[frame];
    const caption = el.querySelector("[data-catgirl-caption]");
    if (caption && caption.textContent !== captionText) caption.textContent = captionText;
  }

  function tick() {
    const now = performance.now() - started;
    registry.forEach((el) => {
      if (!el.isConnected) {
        registry.delete(el);
        return;
      }
      paint(el, suspended() ? { frame: "idle", mode: "idle", caption: CAPTIONS.idle } : stateAt(now));
    });
    if (!registry.size) stop();
  }

  function start() {
    if (timer || document.hidden) return;
    timer = window.setInterval(tick, 140);
    tick();
  }

  function stop() {
    window.clearInterval(timer);
    timer = 0;
  }

  function scan(scope) {
    const host = scope && scope.querySelectorAll ? scope : document;
    host.querySelectorAll("[data-catgirl]").forEach((el) => {
      if (registry.has(el)) return;
      registry.add(el);
      paint(el, suspended() ? { frame: "idle", mode: "idle", caption: CAPTIONS.idle } : stateAt(performance.now() - started));
    });
    if (registry.size) start();
  }

  document.addEventListener("kawaii:motionchange", () => (suspended() ? stop() : start()));
  document.addEventListener("kawaii:fxchange", () => (suspended() ? stop() : start()));
  if (typeof reduced.addEventListener === "function") {
    reduced.addEventListener("change", () => (suspended() ? stop() : start()));
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (registry.size) start();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => scan(document));
  } else {
    scan(document);
  }

  window.KawaiiCatgirl = { FRAMES, CAPTIONS, LOOP, stateAt, scan, start, stop, suspended };
})();
