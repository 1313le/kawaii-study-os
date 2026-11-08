/* =========================================================
   kawaii / STUDY OS — portrait scene
   The room is a cached 5px-pixel canvas; the cat girl is the
   delivered 128x192 sprite sheet, drawn at 5x so one source
   pixel is exactly one scene cell. Her state machine drives
   the frames, the keyboard, the mug, the steam and the props.
   ========================================================= */

(function () {
  "use strict";

  const FPS = 14;
  const WINDOW = { x0: 50, y0: 62, x1: 310, y1: 330 };
  const SPRITE = { x: 80, y: 40, w: 640, h: 960 };
  const KEYBOARD = { x: 300, y: 600, w: 232, h: 56 };
  const DESK_MUG = { x: 630, y: 606, w: 55, h: 46 };
  const LOOP = 20;

  const FRAMES = {
    idle: "assets/img/catgirl-idle.png",
    type: "assets/img/catgirl-type.png",
    sip: "assets/img/catgirl-sip.png",
    happy: "assets/img/catgirl-happy.png",
    blink: "assets/img/catgirl-blink.png",
    think: "assets/img/catgirl-think.png",
    sleepy: "assets/img/catgirl-sleepy.png"
  };

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function stateAt(time) {
    const t = ((time % LOOP) + LOOP) % LOOP;
    if (t < 4.2) return { mode: "type", local: t };
    if (t < 6.0) return { mode: "idle", local: t - 4.2 };
    if (t < 8.4) return { mode: "sip", local: t - 6.0 };
    if (t < 9.8) return { mode: "happy", local: t - 8.4 };
    if (t < 12.4) return { mode: "idle", local: t - 9.8 };
    if (t < 14.6) return { mode: "think", local: t - 12.4 };
    if (t < 16.6) return { mode: "sleepy", local: t - 14.6 };
    return { mode: "idle", local: t - 16.6 };
  }

  function frameAt(time) {
    const state = stateAt(time);
    const blink = state.mode === "idle" && state.local > 0.5 && state.local < 0.66;
    return { mode: state.mode, local: state.local, frame: blink ? "blink" : state.mode, blink };
  }

  class PortraitScene {
    constructor(stage, image, canvas) {
      this.stage = stage;
      this.image = image;
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.width = 800;
      this.height = 800;
      canvas.width = this.width;
      canvas.height = this.height;
      this.ctx.imageSmoothingEnabled = false;
      this.back = null;
      this.desk = null;
      this.frames = {};
      this.framesReady = 0;
      this.avatar = null;
      this.avatarReady = false;
      this.current = { mode: "idle", local: 0, frame: "idle", blink: false };
      this.stateAt = stateAt;
      this.frameAt = frameAt;
      this.loop = LOOP;
      this.bob = 0;
      this.stars = [];
      this.steam = [];
      this.raf = 0;
      this.last = 0;
      this.started = performance.now();
      this.running = false;
      this.visible = false;
      this.frame = this.frame.bind(this);
      this.prepare();
    }

    prepare() {
      const back = document.createElement("canvas");
      back.width = this.width;
      back.height = this.height;
      if (window.KawaiiGirl) window.KawaiiGirl.paintBack(back);
      this.back = back;

      const desk = document.createElement("canvas");
      desk.width = this.width;
      desk.height = this.height;
      if (window.KawaiiGirl) window.KawaiiGirl.paintDesk(desk);
      this.desk = desk;

      for (let i = 0; i < 26; i += 1) {
        let x = 0;
        let y = 0;
        do {
          x = rand(WINDOW.x0 + 8, WINDOW.x1 - 8);
          y = rand(WINDOW.y0 + 4, 186);
        } while (
          (x > 174 && x < 188) ||
          (x > 78 && x < 152 && y > 78 && y < 158)
        );
        this.stars.push({
          x,
          y,
          size: Math.random() < 0.3 ? 5 : 4,
          phase: rand(0, Math.PI * 2),
          speed: rand(0.6, 2.0)
        });
      }
      for (let i = 0; i < 10; i += 1) {
        this.steam.push({ life: i / 10, drift: rand(-7, 7), size: Math.random() < 0.4 ? 5 : 3 });
      }

      Object.keys(FRAMES).forEach((name) => {
        const img = new Image();
        img.decoding = "async";
        img.onload = () => {
          this.frames[name] = img;
          this.framesReady += 1;
          if (name === "idle") this.paint(0, performance.now());
        };
        img.src = FRAMES[name];
      });

      const avatar = new Image();
      avatar.onload = () => {
        this.avatar = avatar;
        this.avatarReady = true;
        this.paint(0, performance.now());
      };
      avatar.src = "assets/img/avatar-catgirl.png";

      this.paint(0, performance.now());
      window.__portraitScene = this;
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.last = 0;
      this.started = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }

    frame(now) {
      if (!this.running) return;
      this.raf = requestAnimationFrame(this.frame);
      if (now - this.last < 1000 / FPS) return;
      this.last = now;
      this.paint((now - this.started) / 1000, now);
    }

    paint(time, now) {
      const ctx = this.ctx;
      const info = frameAt(time);
      this.current = info;
      this.bob = this.bobFor(time, info);
      ctx.clearRect(0, 0, this.width, this.height);
      if (this.back) ctx.drawImage(this.back, 0, 0);
      this.monitorGlow(ctx, time);
      this.starfield(ctx, time);
      this.cityLights(ctx, time);
      this.shootingStar(ctx, time);
      this.monitorCursor(ctx, time);
      if (!this.drawAvatar(ctx, info) && window.KawaiiGirl) window.KawaiiGirl.paint(ctx, time);
      if (this.desk) ctx.drawImage(this.desk, 0, 0);
      this.props(ctx, time, info);
      this.effects(ctx, time, now, info);
    }

    bobFor(time, info) {
      if (info.mode === "type") return Math.round(Math.sin(time * 2.6) * 2);
      return Math.sin(time * 2.0) > 0.2 ? -5 : 0;
    }

    monitorGlow(ctx, time) {
      const flicker = 0.1 + Math.max(0, Math.sin(time * 1.7)) * 0.06;
      ctx.fillStyle = `rgba(184,255,90,${flicker.toFixed(3)})`;
      ctx.fillRect(25, 330, 180, 200);
    }

    starfield(ctx, time) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(WINDOW.x0, WINDOW.y0, WINDOW.x1 - WINDOW.x0, 186 - WINDOW.y0);
      ctx.clip();
      for (const star of this.stars) {
        const twinkle = 0.3 + 0.7 * Math.max(0, Math.sin(time * star.speed + star.phase));
        ctx.globalAlpha = twinkle;
        ctx.fillStyle = twinkle > 0.82 ? "#f6e9ff" : "#c9a8ff";
        ctx.fillRect(Math.round(star.x / 5) * 5, Math.round(star.y / 5) * 5, star.size, star.size);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    drawAvatar(ctx, info) {
      const img = this.frames[info.frame] || this.frames.idle;
      if (!img) {
        if (!this.avatarReady) return false;
        const bob = Math.round(Math.sin(performance.now() / 900) * 2);
        const target = 392;
        const scale = target / this.avatar.naturalWidth;
        const w = this.avatar.naturalWidth * scale;
        const h = this.avatar.naturalHeight * scale;
        const x = (this.width - w) / 2;
        const y = 176 + bob;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.avatar, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
        return true;
      }
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, SPRITE.x, SPRITE.y + this.bob, SPRITE.w, SPRITE.h);
      ctx.restore();
      return true;
    }

    cityLights(ctx, time) {
      const dots = [
        [13, 46], [16, 52], [21, 43], [24, 49], [28, 50],
        [35, 45], [38, 53], [14, 57], [22, 55], [36, 58]
      ];
      dots.forEach(([cx, cy], index) => {
        const on = 0.3 + 0.7 * Math.max(0, Math.sin(time * 0.62 + index * 1.73));
        ctx.globalAlpha = on;
        ctx.fillStyle = index % 3 === 0 ? "#ff5fd2" : "#b8ff5a";
        ctx.fillRect(cx * 5, cy * 5, 5, 5);
      });
      ctx.globalAlpha = 1;
    }

    shootingStar(ctx, time) {
      const cycle = time % 11.5;
      if (cycle > 0.7) return;
      const p = cycle / 0.7;
      const x = 250 - p * 140;
      const y = 76 + p * 46;
      ctx.globalAlpha = Math.sin(p * Math.PI) * 0.9;
      ctx.fillStyle = "#f6e9ff";
      ctx.fillRect(Math.round(x / 5) * 5, Math.round(y / 5) * 5, 5, 5);
      ctx.globalAlpha *= 0.55;
      ctx.fillRect(Math.round((x + 8) / 5) * 5, Math.round((y - 4) / 5) * 5, 5, 5);
      ctx.fillRect(Math.round((x + 16) / 5) * 5, Math.round((y - 8) / 5) * 5, 5, 5);
      ctx.globalAlpha = 1;
    }

    monitorCursor(ctx, time) {
      const scan = (time * 34) % 210;
      ctx.fillStyle = "rgba(184,255,90,0.05)";
      ctx.fillRect(26, 331 + scan, 178, 8);
      if (Math.floor(time * 1.6) % 2 === 0) {
        ctx.fillStyle = "#b8ff5a";
        ctx.fillRect(80, 410, 5, 5);
      }
    }

    keyboard(ctx, time, info) {
      const typing = info.mode === "type";
      const x = KEYBOARD.x;
      const y = KEYBOARD.y;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(x - 2, y + KEYBOARD.h, KEYBOARD.w + 4, 4);
      ctx.fillStyle = "#171128";
      ctx.fillRect(x, y, KEYBOARD.w, KEYBOARD.h);
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.fillRect(x + 4, y + 4, KEYBOARD.w - 8, 2);
      ctx.fillStyle = "rgba(184,255,90,0.28)";
      ctx.fillRect(x, y, KEYBOARD.w, 2);
      for (let row = 0; row < 2; row += 1) {
        const shift = row === 0 ? 0 : 7;
        for (let i = 0; i < 12 - row; i += 1) {
          const wave = Math.max(0, Math.sin(time * 11 + i * 0.85 + row * 2.1));
          const alpha = typing ? 0.24 + wave * 0.68 : 0.1 + Math.max(0, Math.sin(time * 1.9 + i * 0.4)) * 0.05;
          ctx.fillStyle = `rgba(184,255,${Math.round(96 + (1 - alpha) * 30)},${alpha.toFixed(2)})`;
          ctx.fillRect(x + 8 + i * 19 + shift, y + 7 + row * 20, 14, 16);
        }
      }
      ctx.fillStyle = `rgba(184,255,90,${(typing ? 0.22 + Math.max(0, Math.sin(time * 5.5)) * 0.35 : 0.1).toFixed(2)})`;
      ctx.fillRect(x + 64, y + 47, 104, 6);
    }

    plant(ctx, time) {
      const sway = Math.round(Math.sin(time * 1.3) * 2);
      ctx.fillStyle = "#241738";
      ctx.fillRect(64, 622, 50, 38);
      ctx.fillStyle = "rgba(184,255,90,0.4)";
      ctx.fillRect(64, 622, 50, 4);
      ctx.fillStyle = "rgba(184,255,90,0.5)";
      ctx.fillRect(74, 598 + sway, 5, 26);
      ctx.fillRect(88, 588 - sway, 5, 36);
      ctx.fillRect(102, 596 + sway, 5, 28);
      ctx.fillStyle = "rgba(184,255,90,0.75)";
      ctx.fillRect(79, 594 + sway, 8, 5);
      ctx.fillRect(93, 584 - sway, 8, 5);
      ctx.fillRect(107, 592 + sway, 8, 5);
    }

    notebook(ctx) {
      ctx.fillStyle = "#241738";
      ctx.fillRect(76, 666, 132, 26);
      ctx.fillStyle = "rgba(184,255,90,0.35)";
      ctx.fillRect(76, 666, 132, 3);
      ctx.fillStyle = "rgba(255,95,210,0.4)";
      ctx.fillRect(76, 686, 132, 3);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(96, 674, 92, 2);
    }

    pen(ctx) {
      ctx.fillStyle = "rgba(184,255,90,0.65)";
      ctx.fillRect(232, 680, 64, 4);
      ctx.fillStyle = "rgba(255,95,210,0.8)";
      ctx.fillRect(290, 680, 8, 4);
    }

    mug(ctx, time) {
      const x = DESK_MUG.x;
      const y = DESK_MUG.y;
      ctx.fillStyle = "rgba(234,226,250,0.96)";
      ctx.fillRect(x, y, 44, 40);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(x + 4, y + 4, 36, 3);
      ctx.fillStyle = "rgba(184,255,90,0.9)";
      ctx.fillRect(x, y, 44, 4);
      ctx.fillStyle = "rgba(120,105,160,0.5)";
      ctx.fillRect(x + 39, y + 6, 5, 32);
      ctx.fillStyle = "rgba(234,226,250,0.96)";
      ctx.fillRect(x + 44, y + 12, 11, 18);
      ctx.fillStyle = "rgba(16,10,28,0.35)";
      ctx.fillRect(x + 49, y + 16, 6, 10);
      // tiny pixel heart
      ctx.fillStyle = "rgba(255,95,210,0.85)";
      ctx.fillRect(x + 18, y + 20, 4, 4);
      ctx.fillRect(x + 30, y + 20, 4, 4);
      ctx.fillRect(x + 14, y + 24, 24, 4);
      ctx.fillRect(x + 18, y + 28, 16, 4);
      ctx.fillRect(x + 22, y + 32, 8, 4);
      void time;
    }

    coaster(ctx) {
      const x = DESK_MUG.x - 4;
      const y = DESK_MUG.y + 38;
      ctx.fillStyle = "rgba(28,18,46,0.95)";
      ctx.fillRect(x, y, 66, 14);
      ctx.fillStyle = "rgba(184,255,90,0.35)";
      ctx.fillRect(x, y, 66, 2);
      ctx.fillRect(x, y + 12, 66, 2);
      ctx.fillStyle = "rgba(201,168,255,0.25)";
      ctx.fillRect(x + 16, y + 5, 30, 2);
      ctx.fillStyle = "rgba(255,95,210,0.4)";
      ctx.fillRect(x + 54, y, 12, 2);
    }

    props(ctx, time, info) {
      this.keyboard(ctx, time, info);
      this.plant(ctx, time);
      this.notebook(ctx);
      this.pen(ctx);
      if (info.mode === "sip") this.coaster(ctx);
      else this.mug(ctx, time);
    }

    effects(ctx, time, now, info) {
      const bob = this.bob;

      if (info.mode === "happy") {
        this.note(ctx, 648, 232 - (info.local / 1.4) * 46, "#ffd36a");
        this.note(ctx, 686, 268 - (info.local / 1.4) * 30, "#ff5fd2");
      } else if (info.mode === "think") {
        const lift = Math.round(Math.sin(time * 2.4) * 5);
        this.glyph(ctx, 654, 176 + lift, ["..##", ".#.#", "...#", "..#.", ".....", "..#."], "rgba(201,168,255,0.9)");
      } else if (info.mode === "sleepy") {
        const z = info.local;
        this.glyph(ctx, 640, 238 - z * 14, ["###", "..#", ".#.", "###"], "rgba(201,168,255,0.75)");
        this.glyph(ctx, 672, 274 - ((z + 0.7) % 1.6) * 14, ["###", "..#", ".#.", "###"], "rgba(159,140,216,0.55)");
      }

      const sip = info.mode === "sip";
      const source = sip ? { x: 402, y: 308 + bob } : { x: 652, y: 598 };
      for (const puff of this.steam) {
        puff.life += 0.012;
        if (puff.life > 1) {
          puff.life = 0;
          puff.drift = rand(-7, 7);
        }
        const x = source.x + Math.sin(puff.life * Math.PI * 2 + puff.drift) * 14 + puff.drift * puff.life * 2;
        const y = source.y - puff.life * 70;
        ctx.globalAlpha = Math.max(0, (sip ? 0.32 : 0.55) * (1 - puff.life));
        ctx.fillStyle = puff.life < 0.5 ? "#e9dcff" : "#b9a7e8";
        const size = sip ? Math.max(3, puff.size - 1) : puff.size;
        ctx.fillRect(Math.round(x / 5) * 5, Math.round(y / 5) * 5, size, size);
      }
      ctx.globalAlpha = 1;
      void now;
    }

    note(ctx, x, y, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 5, 25);
      ctx.fillRect(x + 5, y, 10, 5);
      ctx.fillRect(x - 10, y + 20, 15, 10);
    }

    glyph(ctx, x, y, rows, color) {
      ctx.fillStyle = color;
      rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx += 1) {
          if (row[rx] === "#") ctx.fillRect(x + rx * 5, Math.round((y + ry * 5) / 5) * 5, 5, 5);
        }
      });
    }
  }

  function boot() {
    const stage = document.querySelector("[data-portrait]");
    const image = stage && stage.querySelector("img");
    const canvas = stage && stage.querySelector("canvas");
    if (!stage || !image || !canvas) return;

    const root = document.documentElement;
    const reduced = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
    const allowed = () =>
      root.dataset.skin === "pixel" &&
      root.dataset.fx !== "off" &&
      root.dataset.motion !== "reduced" &&
      (!reduced.matches || root.dataset.motion === "full");

    const scene = new PortraitScene(stage, image, canvas);
    let visible = false;

    function sync() {
      const on = allowed() && visible && !document.hidden;
      if (on) scene.start();
      else scene.stop();
    }

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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
