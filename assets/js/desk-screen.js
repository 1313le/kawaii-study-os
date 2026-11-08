/* =========================================================
   kawaii / STUDY OS — co-write screen
   Draws the write desk as a tiny phosphor feed. The same
   texture is what the portrait CRT shows, so the girl's
   screen and this monitor stay one signal.
   ========================================================= */

(function () {
  "use strict";

  const W = 192;
  const H = 108;
  const STALE = 15 * 60 * 1000;
  const FONT = '10px "VT323", "Fragment Mono", "Microsoft YaHei", monospace';

  const PALETTES = {
    pixel: {
      ink: "#b8ff5a",
      dim: "rgba(184, 255, 90, 0.62)",
      faint: "rgba(184, 255, 90, 0.22)",
      bg: "#04140b",
      glow: "rgba(70, 150, 80, 0.24)",
      accent: "#ff5fd2",
      band: "rgba(184, 255, 90, 0.05)",
      scan: "rgba(0, 0, 0, 0.24)"
    },
    line: {
      ink: "#cfe0ff",
      dim: "rgba(207, 224, 255, 0.62)",
      faint: "rgba(20, 92, 255, 0.28)",
      bg: "#0b0f18",
      glow: "rgba(40, 90, 200, 0.28)",
      accent: "#ff5fd2",
      band: "rgba(120, 170, 255, 0.06)",
      scan: "rgba(0, 0, 0, 0.28)"
    }
  };

  const texture = document.createElement("canvas");
  texture.width = W;
  texture.height = H;
  const ctx = texture.getContext("2d");
  const reduced = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

  function still() {
    const root = document.documentElement;
    if (root.dataset.fx === "off") return true;
    if (root.dataset.motion === "reduced") return true;
    return reduced.matches && root.dataset.motion !== "full";
  }

  function colors() {
    return document.documentElement.dataset.skin === "line" ? PALETTES.line : PALETTES.pixel;
  }

  function wrapText(text, maxWidth) {
    ctx.font = FONT;
    const rows = [];
    for (const raw of String(text || "").split("\n")) {
      let row = "";
      for (const character of raw) {
        if (row && ctx.measureText(row + character).width > maxWidth) {
          rows.push(row);
          row = character === " " ? "" : character;
        } else {
          row += character;
        }
      }
      rows.push(row);
    }
    return rows;
  }

  function isLive(state) {
    if (!state) return false;
    if (Date.now() - Number(state.at || 0) > STALE) return false;
    return Number(state.chars) > 0 || (state.title && state.title !== "UNTITLED.MD");
  }

  function paint(state, now) {
    const C = colors();
    const live = isLive(state);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W / 2, H * 0.44, 6, W / 2, H * 0.5, W * 0.72);
    glow.addColorStop(0, C.glow);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.font = FONT;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    ctx.fillStyle = C.faint;
    ctx.fillRect(0, 0, W, 13);
    ctx.fillStyle = C.ink;
    ctx.fillText("KAWAII / WRITE", 6, 2);
    const badge = live ? (state.dirty ? "DRAFT" : state.savedAt ? "SYNCED" : "NEW") : "IDLE";
    ctx.textAlign = "right";
    ctx.fillStyle = badge === "DRAFT" ? C.accent : badge === "SYNCED" ? C.ink : C.dim;
    ctx.fillText(badge, W - 6, 2);
    ctx.textAlign = "left";

    ctx.fillStyle = C.dim;
    if (live) {
      ctx.fillText(`LN ${state.line}  COL ${state.col}`, 6, 16);
      ctx.textAlign = "right";
      ctx.fillText(`${Number(state.chars) || 0} CHARS`, W - 6, 16);
      ctx.textAlign = "left";
    } else {
      ctx.fillText(state && state.chars ? `LAST SEEN LN ${state.line} · COL ${state.col}` : "AWAITING THE WRITE DESK", 6, 16);
    }

    ctx.fillStyle = C.faint;
    ctx.fillRect(6, 27, W - 12, 1);

    if (live) {
      const lines = wrapText(state.tail, W - 12).slice(-4);
      let y = 32;
      for (const line of lines) {
        ctx.fillStyle = C.ink;
        ctx.fillText(line, 6, y);
        y += 12;
      }
      const last = lines.length ? lines[lines.length - 1] : "";
      const caretX = Math.min(W - 13, 7 + ctx.measureText(last).width);
      const caretY = lines.length ? y - 12 : 32;
      if (still() || Math.floor(now / 520) % 2 === 0) {
        ctx.fillStyle = C.ink;
        ctx.fillRect(caretX, caretY, 5, 10);
      }
    } else {
      ctx.fillStyle = C.dim;
      ctx.fillText("OPEN /WRITE AND START TYPING", 6, 36);
      ctx.fillStyle = C.faint;
      ctx.fillText("HER CRT MIRRORS THE SAME FEED", 6, 48);
      ctx.fillStyle = C.dim;
      ctx.fillText("LINE · COLUMN · TAIL · PROGRESS", 6, 60);
      if (still() || Math.floor(now / 520) % 2 === 0) {
        ctx.fillStyle = C.ink;
        ctx.fillRect(6, 74, 5, 10);
      }
    }

    const ratio = live
      ? Math.max(0, Math.min(1, (Number(state.caret) || 0) / Math.max(1, Number(state.chars) || 0)))
      : 0;
    ctx.fillStyle = C.faint;
    ctx.fillRect(6, 93, W - 12, 3);
    if (ratio > 0) {
      ctx.fillStyle = C.ink;
      ctx.fillRect(6, 93, Math.max(2, (W - 12) * ratio), 3);
    }
    ctx.fillStyle = C.dim;
    ctx.fillText(live ? `${Math.round(ratio * 100)}% WRITTEN` : "PROGRESS —", 6, 83);
    ctx.textAlign = "right";
    ctx.fillText(live ? `${Number(state.totalLines) || 1} LINES` : "", W - 6, 83);
    ctx.textAlign = "left";

    ctx.fillStyle = C.scan;
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y + 2, W, 1);

    if (!still()) {
      const band = ((now / 26) % (H + 36)) - 18;
      ctx.fillStyle = C.band;
      ctx.fillRect(0, band, W, 9);
    }

    const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.36, W / 2, H / 2, W * 0.62);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.42)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  function feedStatus(state) {
    const badge = document.querySelector("[data-desk-feed-badge]");
    const pos = document.querySelector("[data-desk-feed-pos]");
    const title = document.querySelector("[data-desk-feed-title]");
    const live = isLive(state);
    if (badge) {
      badge.textContent = live ? (state.dirty ? "LIVE / DRAFT" : "LIVE / SYNCED") : "IDLE";
      badge.classList.toggle("is-live", live);
    }
    if (pos) {
      pos.textContent = live
        ? `LN ${state.line} · COL ${state.col}`
        : state && state.chars
          ? `上次 LN ${state.line} · COL ${state.col}`
          : "尚无写作记录";
    }
    if (title) title.textContent = state && state.title ? state.title : "UNTITLED.MD";
    if (document.documentElement.dataset.live !== "on") {
      document.querySelectorAll("[data-desk-feed-inline]").forEach((node) => {
        node.textContent = live
          ? `LIVE · LN ${state.line} · COL ${state.col}`
          : state && state.chars
            ? `LAST · LN ${state.line} · COL ${state.col}`
            : "ONLINE";
      });
    }
  }

  function mount(canvas) {
    if (!canvas || canvas.__deskScreen) return;
    canvas.__deskScreen = true;
    const target = canvas.getContext("2d");
    let state = window.KawaiiDesk ? window.KawaiiDesk.read() : null;
    let frame = 0;
    let last = 0;
    let visible = true;

    const blit = (now) => {
      paint(state, now);
      target.imageSmoothingEnabled = false;
      target.clearRect(0, 0, canvas.width, canvas.height);
      target.drawImage(texture, 0, 0, canvas.width, canvas.height);
    };

    const schedule = () => {
      if (frame || still() || !visible || document.hidden) return;
      frame = requestAnimationFrame(loop);
    };

    function loop(now) {
      frame = 0;
      if (!canvas.isConnected || document.hidden || !visible) return;
      if (now - last < 80) {
        schedule();
        return;
      }
      last = now;
      blit(now);
      schedule();
    }

    const refresh = () => {
      state = window.KawaiiDesk ? window.KawaiiDesk.read() : null;
      feedStatus(state);
      blit(performance.now());
      schedule();
    };

    if (window.KawaiiDesk) {
      window.KawaiiDesk.subscribe((next) => {
        state = next;
        feedStatus(state);
        blit(performance.now());
        schedule();
      });
    }

    const repaint = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      blit(performance.now());
      schedule();
    };
    document.addEventListener("kawaii:fxchange", repaint);
    document.addEventListener("kawaii:motionchange", repaint);
    document.addEventListener("kawaii:skinchange", repaint);
    document.addEventListener("kawaii:live", () => feedStatus(state));
    document.addEventListener("visibilitychange", refresh);
    if (typeof reduced.addEventListener === "function") reduced.addEventListener("change", repaint);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(repaint).catch(() => {});

    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible) {
          refresh();
        } else {
          cancelAnimationFrame(frame);
          frame = 0;
        }
      }, { threshold: 0.02 }).observe(canvas);
    }

    feedStatus(state);
    blit(performance.now());
    schedule();
  }

  function boot() {
    const canvases = document.querySelectorAll("[data-desk-screen]");
    canvases.forEach(mount);
    if (!canvases.length && window.KawaiiDesk) {
      feedStatus(window.KawaiiDesk.read());
      window.KawaiiDesk.subscribe((state) => feedStatus(state));
    }
  }

  /* The portrait CRT is roughly 4:3 and much larger than the floating
     co-write window, so it gets a denser feed instead of a stretched
     16:9 texture. */
  const CRT_W = 192;
  const CRT_H = 160;
  const CRT_FONT = '11px "VT323", "Fragment Mono", "Microsoft YaHei", monospace';
  const CRT_SMALL = '9px "VT323", "Fragment Mono", "Microsoft YaHei", monospace';
  const CRT_TITLE = '11px "VT323", "Fragment Mono", "Microsoft YaHei", monospace';
  const crtTexture = document.createElement("canvas");
  crtTexture.width = CRT_W;
  crtTexture.height = CRT_H;
  const crtCtx = crtTexture.getContext("2d");

  function fitTextCrt(text, font, maxWidth) {
    crtCtx.font = font;
    const value = String(text || "");
    if (crtCtx.measureText(value).width <= maxWidth) return value;
    let cut = value;
    while (cut.length && crtCtx.measureText(cut + "…").width > maxWidth) cut = cut.slice(0, -1);
    return cut ? cut + "…" : "";
  }

  function wrapTextCrt(text, maxWidth) {
    crtCtx.font = CRT_FONT;
    const rows = [];
    for (const raw of String(text || "").split("\n")) {
      let row = "";
      for (const character of raw) {
        if (row && crtCtx.measureText(row + character).width > maxWidth) {
          rows.push(row);
          row = character === " " ? "" : character;
        } else {
          row += character;
        }
      }
      rows.push(row);
    }
    return rows;
  }

  function paintCrt(state, now) {
    const C = colors();
    const live = isLive(state);
    const g = crtCtx;
    g.fillStyle = C.bg;
    g.fillRect(0, 0, CRT_W, CRT_H);

    const glow = g.createRadialGradient(CRT_W / 2, CRT_H * 0.44, 10, CRT_W / 2, CRT_H * 0.5, CRT_W * 0.72);
    glow.addColorStop(0, C.glow);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, CRT_W, CRT_H);

    g.textBaseline = "top";
    g.textAlign = "left";
    g.font = CRT_SMALL;

    g.fillStyle = C.faint;
    g.fillRect(0, 0, CRT_W, 13);
    g.fillStyle = C.ink;
    g.fillText("KAWAII / WRITE", 6, 1);
    const badge = live ? (state.dirty ? "DRAFT" : state.savedAt ? "SYNCED" : "NEW") : "IDLE";
    g.textAlign = "right";
    g.fillStyle = badge === "DRAFT" ? C.accent : badge === "SYNCED" ? C.ink : C.dim;
    g.fillText(badge, CRT_W - 6, 1);
    g.textAlign = "left";

    g.font = CRT_TITLE;
    g.fillStyle = C.ink;
    g.fillText(live ? fitTextCrt(state.title || "UNTITLED.MD", CRT_TITLE, CRT_W - 12) : "AWAITING THE WRITE DESK", 6, 15);

    g.font = CRT_SMALL;
    g.fillStyle = C.dim;
    if (live) {
      g.fillText(`LN ${state.line}  COL ${state.col}`, 6, 29);
      g.textAlign = "right";
      g.fillText(`${Number(state.chars) || 0} CHARS`, CRT_W - 6, 29);
      g.textAlign = "left";
    } else {
      g.fillText("OPEN /WRITE AND START TYPING", 6, 29);
    }

    g.fillStyle = C.faint;
    g.fillRect(6, 40, CRT_W - 12, 1);

    if (live) {
      const lines = wrapTextCrt(state.tail, CRT_W - 12).slice(-4);
      g.font = CRT_FONT;
      let y = 44;
      for (const line of lines) {
        g.fillStyle = C.ink;
        g.fillText(line, 6, y);
        y += 14;
      }
      const last = lines.length ? lines[lines.length - 1] : "";
      const caretX = Math.min(CRT_W - 12, 6 + g.measureText(last).width);
      const caretY = lines.length ? y - 14 : 44;
      if (still() || Math.floor(now / 520) % 2 === 0) {
        g.fillStyle = C.ink;
        g.fillRect(caretX, caretY, 6, 11);
      }
    }

    g.fillStyle = C.faint;
    g.fillRect(6, 116, CRT_W - 12, 1);
    g.font = CRT_SMALL;
    g.fillStyle = C.dim;
    g.fillText("LIVE FEED / 共写频道", 6, 119);
    g.textAlign = "right";
    g.fillStyle = C.ink;
    g.fillText(live ? "LIVE" : "STANDBY", CRT_W - 6, 119);
    g.textAlign = "left";

    const ratio = live
      ? Math.max(0, Math.min(1, (Number(state.caret) || 0) / Math.max(1, Number(state.chars) || 0)))
      : 0;
    g.fillStyle = C.dim;
    g.fillText(live ? `${Math.round(ratio * 100)}% WRITTEN` : "PROGRESS —", 6, 140);
    g.textAlign = "right";
    g.fillText(live ? `${Number(state.totalLines) || 1} LINES` : "", CRT_W - 6, 140);
    g.textAlign = "left";
    g.fillStyle = C.faint;
    g.fillRect(6, 150, CRT_W - 12, 3);
    if (ratio > 0) {
      g.fillStyle = C.ink;
      g.fillRect(6, 150, Math.max(2, (CRT_W - 12) * ratio), 3);
    }

    g.fillStyle = C.scan;
    for (let y = 0; y < CRT_H; y += 3) g.fillRect(0, y + 2, CRT_W, 1);

    if (!still()) {
      const band = ((now / 26) % (CRT_H + 36)) - 18;
      g.fillStyle = C.band;
      g.fillRect(0, band, CRT_W, 9);
    }

    const vignette = g.createRadialGradient(CRT_W / 2, CRT_H / 2, CRT_H * 0.36, CRT_W / 2, CRT_H / 2, CRT_W * 0.62);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.4)");
    g.fillStyle = vignette;
    g.fillRect(0, 0, CRT_W, CRT_H);
  }

  window.KawaiiDeskScreen = { paint, paintCrt, wrapText, isLive, texture, crtTexture };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
