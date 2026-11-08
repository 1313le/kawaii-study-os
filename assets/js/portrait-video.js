/* =========================================================
   kawaii / STUDY OS — portrait loop video
   The generated 12s pixel loop is the primary portrait in the
   pixel skin. It only loads when the frame is visible and
   motion is allowed; the poster is a valid static portrait.
   ========================================================= */

(function () {
  "use strict";

  const stage = document.querySelector("[data-portrait]");
  const video = stage && stage.querySelector("[data-portrait-video]");
  if (!stage || !video) return;

  const away = stage.querySelector("[data-portrait-away]");
  const awayCtx = away ? away.getContext("2d") : null;
  const AWAY_IN = 4.0;
  const AWAY_OUT = 6.9;
  const AWAY_FONT = '14px "VT323", "Fragment Mono", "Microsoft YaHei", monospace';
  const AWAY_SMALL = '8px "VT323", "Fragment Mono", "Microsoft YaHei", monospace';

  /* Glass corner measurements (1024px poster/video space). The monitor is
     angled away to the right, so the right edge is shorter than the left. */
  const SCREEN_QUAD = [[118, 221], [459, 203], [459, 428], [129, 486]];
  const SCREEN_BOX = [118, 203, 341, 283];

  function homography(w, h, quad) {
    const src = [[0, 0], [w, 0], [w, h], [0, h]];
    const rows = [];
    for (let i = 0; i < 4; i += 1) {
      const [u, v] = src[i];
      const [x, y] = quad[i];
      rows.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
      rows.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
    }
    for (let col = 0; col < 8; col += 1) {
      let pivot = col;
      for (let row = col + 1; row < 8; row += 1) {
        if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
      }
      [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
      const lead = rows[col][col] || 1e-9;
      for (let c = col; c < 9; c += 1) rows[col][c] /= lead;
      for (let row = 0; row < 8; row += 1) {
        if (row === col) continue;
        const factor = rows[row][col];
        if (!factor) continue;
        for (let c = col; c < 9; c += 1) rows[row][c] -= factor * rows[col][c];
      }
    }
    return rows.map((row) => row[8]);
  }

  function syncCrt() {
    const width = stage.getBoundingClientRect().width;
    if (!width) return;
    const scale = width / 1024;
    const [bx, by, bw, bh] = SCREEN_BOX;
    const quad = SCREEN_QUAD.map(([x, y]) => [(x - bx) * scale, (y - by) * scale]);
    const [h11, h12, h13, h21, h22, h23, h31, h32] = homography(bw * scale, bh * scale, quad);
    const n = (value) => Math.round(value * 1e6) / 1e6;
    stage.style.setProperty(
      "--crt-matrix",
      `matrix3d(${n(h11)},${n(h21)},0,${n(h31)},${n(h12)},${n(h22)},0,${n(h32)},0,0,1,0,${n(h13)},${n(h23)},0,1)`
    );
  }

  syncCrt();
  if ("ResizeObserver" in window) {
    new ResizeObserver(syncCrt).observe(stage);
  } else {
    window.addEventListener("resize", syncCrt);
  }

  const root = document.documentElement;
  const reduced = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };
  const source = video.getAttribute("data-src");
  let loaded = false;
  let visible = false;
  let failed = false;
  let awayRaf = 0;
  let awayOn = false;
  let awayPaintedAt = 0;

  function pixelSkin() {
    return root.dataset.skin === "pixel";
  }

  function motionAllowed() {
    if (root.dataset.fx === "off") return false;
    if (root.dataset.motion === "reduced") return false;
    if (reduced.matches && root.dataset.motion !== "full") return false;
    return true;
  }

  function isLive() {
    return root.dataset.live === "on" || stage.dataset.live === "on";
  }

  function awayAllowed() {
    return Boolean(awayCtx && !video.paused && video.readyState >= 2 &&
      visible && !document.hidden && pixelSkin() && motionAllowed() && !isLive());
  }

  function setAway(on) {
    if (awayOn === on) return;
    awayOn = on;
    stage.dataset.away = on ? "on" : "off";
  }

  function paintAway(now) {
    const g = awayCtx;
    const W = away.width;
    g.clearRect(0, 0, W, away.height);
    g.textBaseline = "top";
    g.textAlign = "left";
    g.font = AWAY_SMALL;
    g.fillStyle = "rgba(236, 247, 255, 0.7)";
    g.fillText("KAWAII / WRITE", 12, 10);
    g.textAlign = "right";
    g.fillStyle = "#ffffff";
    g.fillText("AWAY", W - 12, 10);

    g.textAlign = "center";
    g.font = AWAY_FONT;
    g.fillStyle = "#f7fbff";
    g.fillText("作者离开键盘", W / 2, 64);

    g.font = AWAY_SMALL;
    g.fillStyle = "rgba(236, 247, 255, 0.74)";
    g.textAlign = "left";
    const sub = "AWAY FROM KEYBOARD";
    const wide = g.measureText(sub).width;
    const subX = (W - wide - 9) / 2;
    g.fillText(sub, subX, 86);
    if (Math.floor(now / 520) % 2 === 0) {
      g.fillStyle = "#ffffff";
      g.fillRect(subX + wide + 4, 86, 5, 8);
    }

    g.fillStyle = "rgba(255, 255, 255, 0.24)";
    g.fillRect(12, 128, W - 24, 1);
    g.fillStyle = "rgba(236, 247, 255, 0.64)";
    g.fillText("LIVE FEED / 共写频道", 12, 137);
    g.textAlign = "right";
    g.fillStyle = "#ffffff";
    g.fillText("STANDBY", W - 12, 137);
  }

  function stopAway() {
    if (awayRaf) cancelAnimationFrame(awayRaf);
    awayRaf = 0;
    setAway(false);
  }

  function awayTick(now) {
    awayRaf = 0;
    if (!awayAllowed()) {
      setAway(false);
      return;
    }
    const duration = Number(video.duration);
    const t = duration > 0 ? video.currentTime % duration : video.currentTime;
    const on = t >= AWAY_IN && t <= AWAY_OUT;
    if (on && now - awayPaintedAt > 100) {
      awayPaintedAt = now;
      paintAway(now);
    }
    setAway(on);
    awayRaf = requestAnimationFrame(awayTick);
  }

  function startAway() {
    if (awayRaf) return;
    if (!awayAllowed()) {
      setAway(false);
      return;
    }
    awayPaintedAt = 0;
    awayRaf = requestAnimationFrame(awayTick);
  }

  function load() {
    if (loaded || !source) return;
    loaded = true;
    const sourceEl = document.createElement("source");
    sourceEl.src = source;
    sourceEl.type = "video/mp4";
    video.appendChild(sourceEl);
    video.load();
  }

  function pause(reset) {
    if (!video.paused) video.pause();
    if (reset) {
      try {
        video.currentTime = 0;
      } catch (error) {
        /* metadata is not ready yet; the poster still shows */
      }
    }
  }

  function play() {
    if (!pixelSkin() || failed || !visible || document.hidden || !motionAllowed()) return;
    load();
    const playing = video.play();
    if (playing && typeof playing.catch === "function") {
      playing.catch(() => {
        /* autoplay may be blocked; the poster remains a static portrait */
      });
    }
  }

  function sync() {
    const on = pixelSkin() && !failed;
    stage.classList.toggle("is-video", on);
    if (!on) {
      pause(true);
      return;
    }
    if (motionAllowed() && visible && !document.hidden) play();
    else pause(true);
  }

  video.addEventListener("error", () => {
    failed = true;
    stage.classList.remove("is-video");
    pause(true);
    stopAway();
  });

  video.addEventListener("loadeddata", () => {
    if (visible) play();
  });

  video.addEventListener("playing", startAway);
  video.addEventListener("timeupdate", startAway);
  video.addEventListener("pause", stopAway);
  document.addEventListener("kawaii:live", () => {
    if (isLive()) stopAway();
    else startAway();
  });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        visible = entry.isIntersecting;
        sync();
      });
    }, { threshold: 0.05 }).observe(stage);
  } else {
    visible = true;
  }

  document.addEventListener("kawaii:skinchange", sync);
  document.addEventListener("kawaii:fxchange", sync);
  document.addEventListener("kawaii:motionchange", sync);
  document.addEventListener("visibilitychange", sync);
  if (typeof reduced.addEventListener === "function") reduced.addEventListener("change", sync);

  sync();
  window.__portraitVideo = { video, sync };
})();
