/* =========================================================
   kawaii / STUDY OS — hero CRT theatre
   The pixel desk types code, the scope breathes, and
   STUDY_OS occasionally blue-screens. A story, not wallpaper.
   ========================================================= */

(function () {
  "use strict";

  const stage = document.querySelector("[data-hero-crt]");
  if (!stage) return;

  const screen = stage.querySelector("[data-crt-screen]");
  const codeEl = stage.querySelector("[data-crt-code]");
  const fileEl = stage.querySelector("[data-crt-file]");
  const modeEl = stage.querySelector("[data-crt-mode]");
  const bsodEl = stage.querySelector("[data-crt-bsod]");
  const flashEl = stage.querySelector("[data-crt-flash]");
  const keysEl = stage.querySelector("[data-crt-keys]");
  const liveEl = document.querySelector("[data-crt-live]");
  const frameEl = document.querySelector("[data-crt-frame]");
  const scopeEl = stage.querySelector("[data-crt-scope]");
  const visual = stage.parentElement;
  const consoleWindow = document.querySelector(".console-window");
  const windowStatus = document.querySelector(".console-window__status");
  const root = document.documentElement;
  const screenLabel = screen.getAttribute("aria-label") || "学习电脑的屏幕";
  const scopeCtx = scopeEl ? scopeEl.getContext("2d") : null;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const SNIPPETS = [
    {
      file: "~/fw/main.c",
      lines: [
        [["// blink PA5 @ 500ms", "dim"]],
        [["#include ", "pp"], ['"stm32.h"', "str"]],
        [],
        [["int ", "kw"], ["main", "fn"], ["(void) {", "punc"]],
        [["  HAL_Init", "fn"], ["();", "punc"]],
        [["  while ", "kw"], ["(1) {", "punc"]],
        [["    gpio_toggle", "fn"], ["(PA5);", "punc"]],
        [["    delay_ms", "fn"], ["(", "punc"], ["500", "num"], [");", "punc"]],
        [["  }", "punc"]],
        [["}", "punc"]],
      ],
    },
    {
      file: "~/fw/i2c_scan.c",
      lines: [
        [["// scan the I2C bus", "dim"]],
        [["for ", "kw"], ["(uint8_t a = 1;", "punc"]],
        [["     a < ", "punc"], ["127", "num"], ["; a++) {", "punc"]],
        [["  if ", "kw"], ["(i2c_ready(a))", "fn"]],
        [["    log", "fn"], ['("found", a);', "punc"]],
        [["}", "punc"]],
      ],
    },
    {
      file: "~/fw/pid.c",
      lines: [
        [["// keep the line straight", "dim"]],
        [["float ", "kw"], ["pid", "fn"], ["(float target,", "punc"]],
        [["          float now) {", "punc"]],
        [["  float err = target - now;", "punc"]],
        [["  sum += err * dt;", "punc"]],
        [["  return ", "kw"], ["kp * err + ki * sum;", "punc"]],
        [["}", "punc"]],
      ],
    },
    {
      file: "~/fw/scope.c",
      lines: [
        [["// probe PA0 on the scope", "dim"]],
        [["adc_start", "fn"], ["(PA0);", "punc"]],
        [["while ", "kw"], ["(1) {", "punc"]],
        [["  uint16_t ", "kw"], ["v = ", "punc"], ["adc_read", "fn"], ["(PA0);", "punc"]],
        [["  scope_push", "fn"], ["(v);", "punc"]],
        [["  delay_us", "fn"], ["(", "punc"], ["200", "num"], [");", "punc"]],
        [["}", "punc"]],
      ],
    },
  ];

  /* keyboard cells measured from hero-pixel.webp: 4 rows, split at the
     dark gaps so a copied keycap always stays inside its own socket */
  const KEY_ROWS = [
    { y0: 676, y1: 700, cells: [477, 517.5, 544.5, 572, 598.5, 623.5, 653.5, 679.5, 704.5, 731.5, 759, 788.5, 813, 842, 872, 885] },
    { y0: 700, y1: 719, cells: [480, 524, 553, 578.5, 605, 633, 663.5, 689.5, 716.5, 743.5, 770.5, 800, 829.5, 878.5] },
    { y0: 719, y1: 738, cells: [480, 532.5, 562.5, 588.5, 615.5, 645, 672, 701.5, 729.5, 757, 783.5, 810, 877] },
    { y0: 738, y1: 763, cells: [470, 504, 541.5, 577.5, 779.5, 814, 848.5, 884] }
  ];

  const KEY_CHARS = {
    q: [1, 1], w: [1, 2], e: [1, 3], r: [1, 4], t: [1, 5], y: [1, 6], u: [1, 7], i: [1, 8], o: [1, 9], p: [1, 10],
    a: [2, 1], s: [2, 2], d: [2, 3], f: [2, 4], g: [2, 5], h: [2, 6], j: [2, 7], k: [2, 8], l: [2, 9],
    z: [3, 1], x: [3, 2], c: [3, 4], v: [3, 5], b: [3, 6], n: [3, 6], m: [3, 5],
    1: [0, 1], 2: [0, 2], 3: [0, 3], 4: [0, 4], 5: [0, 5],
    6: [0, 6], 7: [0, 7], 8: [0, 8], 9: [0, 9], 0: [0, 10],
    "`": [0, 0], "~": [0, 0], "!": [0, 1], "@": [0, 2], "#": [0, 3], "$": [0, 4], "%": [0, 5],
    "^": [0, 6], "&": [0, 7], "*": [0, 8], "(": [0, 9], ")": [0, 10], "-": [0, 11], "_": [0, 11],
    "=": [0, 12], "+": [0, 12], "[": [1, 11], "]": [1, 12], "{": [1, 11], "}": [1, 12],
    "\\": [1, 12], "|": [1, 12], ";": [2, 10], ":": [2, 10], "'": [2, 10], '"': [1, 10],
    ",": [3, 2], "<": [3, 2], ".": [3, 4], ">": [3, 4], "/": [3, 4], "?": [3, 4],
    " ": [3, 3], "\n": [2, 11]
  };
  const KEY_SOCKET = "#24122b";
  const KEY_DEPTH = 5;
  const SHIFT_KEY = [3, 0];

  const keyCtx = keysEl && keysEl.getContext ? keysEl.getContext("2d") : null;
  if (keyCtx) keyCtx.imageSmoothingEnabled = false;
  const deskImage = visual ? visual.querySelector("img") : null;
  const scene = new window.KawaiiHeroScene(stage, deskImage);
  const keyOps = new Map();
  let keyPainted = [];
  let keyRaf = 0;
  let keyReady = false;

  if (deskImage) {
    if (deskImage.complete && deskImage.naturalWidth) keyReady = true;
    else deskImage.addEventListener("load", () => { keyReady = true; }, { once: true });
  }

  let running = false;
  let runToken = 0;
  let typingToken = 0;
  let phase = "idle";
  let visible = true;
  let snippetIndex = 0;
  let frames = 0;
  let firstCrash = true;
  let crashTimer = 0;
  let rebootTimer = 0;
  let cursor = null;
  let shakeTimer = 0;

  let scopeRaf = 0;
  let scopeLast = 0;
  let scopeTime = 0;
  let scopeMode = 0;
  let scopeModeUntil = 0;
  let scopeAmp = 1;

  const rand = (min, max) => min + Math.random() * (max - min);

  function setPhase(value) {
    phase = value;
    scene.setPhase(value);
  }

  function allowed() {
    return root.dataset.skin === "pixel" && root.dataset.fx !== "off" && root.dataset.motion !== "reduced" && (!reducedMotion.matches || root.dataset.motion === "full");
  }

  function pad(value) {
    return String(value).padStart(3, "0");
  }

  function sleep(ms, valid) {
    return new Promise((resolve) => {
      window.setTimeout(() => resolve(valid()), ms);
    });
  }

  function setWindowStatus(text, mode) {
    if (!windowStatus) return;
    windowStatus.textContent = text;
    windowStatus.classList.toggle("is-alert", mode === "alert");
    windowStatus.classList.toggle("is-booting", mode === "booting");
  }

  function setLive(text) {
    if (liveEl) liveEl.textContent = text;
  }

  function flashScreen() {
    flashEl.classList.remove("is-flashing");
    void flashEl.offsetWidth;
    flashEl.classList.add("is-flashing");
  }

  function shakeConsole() {
    if (!consoleWindow) return;
    window.clearTimeout(shakeTimer);
    consoleWindow.classList.remove("is-crashing");
    void consoleWindow.offsetWidth;
    consoleWindow.classList.add("is-crashing");
    shakeTimer = window.setTimeout(() => {
      consoleWindow.classList.remove("is-crashing");
    }, 520);
  }

  function keyForChar(character) {
    if (KEY_CHARS[character]) return KEY_CHARS[character];
    const lower = character.toLowerCase();
    if (KEY_CHARS[lower]) return KEY_CHARS[lower];
    const code = character.charCodeAt(0) || 0;
    return [2, 2 + (code % 8)];
  }

  function addKeyPress(row, col, now, hold) {
    const rowSpec = KEY_ROWS[row];
    if (!rowSpec || col < 0 || col >= rowSpec.cells.length - 1) return;
    keyOps.set(row + ":" + col, {
      cell: { x0: rowSpec.cells[col], x1: rowSpec.cells[col + 1], y0: rowSpec.y0, y1: rowSpec.y1 },
      start: now,
      hold
    });
  }

  function drawPressedKey(cell, shift) {
    if (!keyCtx || !deskImage || !keyReady) return;
    const { x0, x1, y0, y1 } = cell;
    const w = x1 - x0;
    const h = y1 - y0;
    const dy = y0 + shift;

    keyCtx.save();
    keyCtx.beginPath();
    keyCtx.rect(x0, y0, w, h);
    keyCtx.clip();
    keyCtx.fillStyle = KEY_SOCKET;
    keyCtx.fillRect(x0, y0, w, h);
    keyCtx.fillStyle = "rgba(16,7,22,0.34)";
    keyCtx.fillRect(x0, y0, w, Math.max(1, dy - y0));
    keyCtx.drawImage(deskImage, x0, y0, w, h, x0, dy, w, h);
    keyCtx.fillStyle = "rgba(16,7,22,0.4)";
    keyCtx.fillRect(x0 + 1, dy, Math.max(1, w - 2), 1);
    keyCtx.fillStyle = "rgba(255,226,210,0.2)";
    keyCtx.fillRect(x0 + 2, dy + 1, Math.max(1, w - 4), 1);
    keyCtx.restore();
  }

  function keyFrame() {
    keyRaf = 0;
    if (!running || phase !== "typing" || !keyCtx) {
      clearKeyboard();
      return;
    }

    const now = performance.now();
    keyOps.forEach((op, id) => {
      if (now - op.start > op.hold + 56) keyOps.delete(id);
    });

    keyPainted.forEach((cell) => {
      keyCtx.clearRect(cell.x0 - 1, cell.y0 - 1, cell.x1 - cell.x0 + 2, cell.y1 - cell.y0 + 2);
    });
    keyPainted = [];

    keyOps.forEach((op) => {
      const age = now - op.start;
      let shift = 0;
      if (age < 18) shift = 2;
      else if (age < op.hold) shift = KEY_DEPTH;
      else if (age < op.hold + 30) shift = 2;
      if (shift > 0) {
        drawPressedKey(op.cell, shift);
        keyPainted.push(op.cell);
      }
    });

    if (keyOps.size) keyRaf = window.requestAnimationFrame(keyFrame);
  }

  function clearKeyboard() {
    if (keyRaf) window.cancelAnimationFrame(keyRaf);
    keyRaf = 0;
    keyOps.clear();
    keyPainted = [];
    if (keyCtx && keysEl) keyCtx.clearRect(0, 0, keysEl.width, keysEl.height);
  }

  function pressKey(character) {
    if (!keyCtx || !keyReady || phase !== "typing") return;
    const now = performance.now();
    const hold = rand(48, 82);
    const [row, col] = keyForChar(character);
    addKeyPress(row, col, now, hold);

    if (character !== character.toLowerCase() && /[a-z]/i.test(character)) {
      addKeyPress(SHIFT_KEY[0], SHIFT_KEY[1], now, hold + 18);
    }

    if (!keyRaf) keyRaf = window.requestAnimationFrame(keyFrame);
  }

  /* ---------- code typing ---------- */

  async function typeSnippet(snippet, valid) {
    if (!valid()) return;

    fileEl.textContent = snippet.file;
    modeEl.textContent = "TX";
    frames += 1;
    if (frameEl) frameEl.textContent = "FRAME / " + pad(frames);
    codeEl.textContent = "";
    setPhase("typing");
    stage.classList.add("is-typing");

    cursor = document.createElement("span");
    cursor.className = "crt-cursor";
    cursor.setAttribute("aria-hidden", "true");

    for (const tokens of snippet.lines) {
      if (!valid()) break;

      const line = document.createElement("span");
      line.className = "crt-line";
      line.appendChild(cursor);
      codeEl.appendChild(line);
      pressKey("\n");

      for (const [text, cls] of tokens) {
        if (!valid()) return;
        const token = document.createElement("span");
        if (cls) token.className = "crt-t crt-t--" + cls;
        line.insertBefore(token, cursor);

        for (const character of text) {
          if (!valid()) return;
          token.textContent += character;
          pressKey(character);
          if (!(await sleep(rand(24, 62), valid))) return;
        }
      }

      if (!(await sleep(rand(90, 260), valid))) return;
    }

    stage.classList.remove("is-typing");
  }

  async function runSnippets(run) {
    const gen = ++typingToken;
    const valid = () => run === runToken && gen === typingToken && running && ["typing", "pointing", "compiling"].includes(phase);

    if (!(await sleep(rand(600, 1300), valid))) return;

    while (valid()) {
      await typeSnippet(SNIPPETS[snippetIndex], valid);
      if (!valid()) return;
      clearKeyboard();
      stage.classList.remove("is-typing");
      setPhase("pointing");
      modeEl.textContent = "RUN";
      if (!(await sleep(900, valid))) return;
      setPhase("compiling");
      modeEl.textContent = "CC";
      setWindowStatus("BUILD", "");
      if (!(await sleep(1100, valid))) return;
      if (firstCrash) {
        firstCrash = false;
        triggerCrash(run);
        return;
      }
      setWindowStatus("PASS", "");
      modeEl.textContent = "OK";
      if (!(await sleep(rand(1200, 2100), valid))) return;
      setPhase("typing");
      setWindowStatus("LIVE", "");
      snippetIndex = (snippetIndex + 1) % SNIPPETS.length;
    }
  }

  /* ---------- crash / reboot ---------- */

  function scheduleCrash(run, first) {
    window.clearTimeout(crashTimer);
    const delay = first ? rand(11000, 17000) : rand(28000, 52000);
    crashTimer = window.setTimeout(() => {
      if (run !== runToken || !running) return;
      triggerCrash(run);
    }, delay);
  }

  function triggerCrash(run) {
    if (run !== runToken || phase === "crash" || phase === "reboot") return;

    window.clearTimeout(crashTimer);
    typingToken += 1;
    setPhase("crash");
    clearKeyboard();
    stage.classList.remove("is-typing");
    stage.classList.add("is-bsod");
    bsodEl.hidden = false;
    modeEl.textContent = "ERR";
    fileEl.textContent = "~/kernel/panic";
    screen.setAttribute("aria-label", "蓝屏了：点击屏幕重启学习电脑");
    setWindowStatus("PANIC", "alert");
    if (frameEl) frameEl.textContent = "SIGNAL / LOST";
    setLive("学习电脑蓝屏了：你敲得太快，CPU 笑场了。点击屏幕可以重启。");
    flashScreen();
    shakeConsole();

    window.clearTimeout(rebootTimer);
    rebootTimer = window.setTimeout(() => {
      if (run !== runToken) return;
      reboot(run);
    }, rand(4000, 5200));
  }

  async function typeBoot(valid) {
    codeEl.textContent = "";
    cursor = document.createElement("span");
    cursor.className = "crt-cursor";
    cursor.setAttribute("aria-hidden", "true");

    const lines = [
      ["STUDY OS BIOS v1.0", "dim"],
      ["MEMORY TEST ... 640K OK", "punc"],
      ["LOAD KERNEL ... OK", "str"],
      ["MOUNT /NOTES ... OK", "str"],
    ];

    for (const [text, cls] of lines) {
      if (!valid()) return;
      const line = document.createElement("span");
      line.className = "crt-line";
      const token = document.createElement("span");
      token.className = "crt-t crt-t--" + cls;
      line.appendChild(token);
      line.appendChild(cursor);
      codeEl.appendChild(line);

      for (const character of text) {
        if (!valid()) return;
        token.textContent += character;
        if (!(await sleep(rand(9, 26), valid))) return;
      }
      if (!(await sleep(rand(110, 240), valid))) return;
    }
  }

  async function reboot(run) {
    if (run !== runToken) return;

    window.clearTimeout(rebootTimer);
    typingToken += 1;
    setPhase("reboot");
    clearKeyboard();
    stage.classList.remove("is-bsod");
    stage.classList.remove("is-typing");
    bsodEl.hidden = true;
    screen.setAttribute("aria-label", screenLabel);
    modeEl.textContent = "BIOS";
    fileEl.textContent = "STUDY OS / POST";
    setWindowStatus("BOOT", "booting");
    if (frameEl) frameEl.textContent = "REBOOT / 001";
    setLive("学习电脑正在重启。");
    flashScreen();
    codeEl.textContent = "";

    const gen = ++typingToken;
    const valid = () => run === runToken && gen === typingToken && running && phase === "reboot";

    if (!(await sleep(320, valid))) return;
    await typeBoot(valid);
    if (!valid()) return;
    if (!(await sleep(rand(500, 850), valid))) return;

    setPhase("typing");
    modeEl.textContent = "TX";
    setWindowStatus("LIVE", "");
    setLive("学习电脑重启完成，代码继续运行。");
    scheduleCrash(run, false);
    runSnippets(run);
  }

  /* ---------- oscilloscope ---------- */

  /* screen quad measured from hero-pixel.webp: the CRT sits on a slightly
     sheared plane, so everything is projected onto it instead of drawn flat */
  const SCOPE_QUAD = [
    [0, 0],
    [144, 11],
    [144, 135],
    [0, 120]
  ];

  function makeProjection(quad) {
    const [p0, p1, p2, p3] = quad;
    const dx1 = p1[0] - p2[0];
    const dx2 = p3[0] - p2[0];
    const dx3 = p0[0] - p1[0] + p2[0] - p3[0];
    const dy1 = p1[1] - p2[1];
    const dy2 = p3[1] - p2[1];
    const dy3 = p0[1] - p1[1] + p2[1] - p3[1];
    let g = 0;
    let h = 0;
    if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
      const den = dx1 * dy2 - dx2 * dy1;
      g = (dx3 * dy2 - dx2 * dy3) / den;
      h = (dx1 * dy3 - dx3 * dy1) / den;
    }
    const a = p1[0] - p0[0] + g * p1[0];
    const b = p3[0] - p0[0] + h * p3[0];
    const c = p0[0];
    const d = p1[1] - p0[1] + g * p1[1];
    const e = p3[1] - p0[1] + h * p3[1];
    const f = p0[1];
    return function project(u, v) {
      const w = g * u + h * v + 1;
      return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
    };
  }

  const scopeProject = makeProjection(SCOPE_QUAD);

  function waveAt(u, time, mode) {
    if (mode === 0) {
      return Math.sin(u * 18 + time * 3.4) * 0.72 + Math.sin(u * 5.5 - time * 1.1) * 0.18;
    }
    if (mode === 1) {
      return (Math.sin(u * 16 + time * 2.2) > 0 ? 1 : -1) * 0.55;
    }
    if (mode === 2) {
      const p = (u * 2.4 + time * 0.35) % 1;
      return (p * 2 - 1) * 0.72;
    }
    return Math.sin(u * 22 + time * 3.1 + Math.sin(time * 0.8) * 3) * 0.5 + Math.sin(u * 7 - time * 1.7) * 0.2;
  }

  function drawScope() {
    if (!scopeCtx || !scopeEl) return;
    const width = scopeEl.width;
    const height = scopeEl.height;
    const ctx = scopeCtx;
    const project = scopeProject;

    ctx.clearRect(0, 0, width, height);

    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#0b4a4a");
    bg.addColorStop(0.55, "#073a3d");
    bg.addColorStop(1, "#042630");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const shade = ctx.createRadialGradient(
      width * 0.54,
      height * 0.48,
      height * 0.1,
      width * 0.5,
      height * 0.54,
      width * 0.78
    );
    shade.addColorStop(0, "rgba(0, 0, 0, 0)");
    shade.addColorStop(0.66, "rgba(0, 0, 0, 0.06)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0.42)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height);

    function projectLine(u1, v1, u2, v2, color, lineWidth) {
      const a = project(u1, v1);
      const b = project(u2, v2);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    for (let i = 1; i < 8; i += 1) {
      projectLine(i / 8, 0, i / 8, 1, "rgba(96, 224, 192, 0.14)", 1.1);
    }
    for (let j = 1; j < 6; j += 1) {
      projectLine(0, j / 6, 1, j / 6, "rgba(96, 224, 192, 0.13)", 1.1);
    }
    projectLine(0.5, 0, 0.5, 1, "rgba(110, 240, 190, 0.2)", 1.4);
    projectLine(0, 0.5, 1, 0.5, "rgba(140, 255, 210, 0.26)", 1.5);

    const flat = phase === "crash" || phase === "reboot";
    const amplitude = 0.34 * scopeAmp;
    const wave = [];
    for (let i = 0; i <= 72; i += 1) {
      const u = i / 72;
      let v = 0.5 - waveAt(u, scopeTime, scopeMode) * amplitude;
      v += flat ? (Math.random() - 0.5) * 0.014 : 0;
      v = Math.max(0.03, Math.min(0.97, v));
      const p = project(u, v);
      wave.push(p);
    }

    function strokeWave(color, lineWidth) {
      ctx.beginPath();
      wave.forEach(([x, y], index) => {
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    strokeWave("rgba(74, 255, 92, 0.1)", 16);
    strokeWave("rgba(88, 255, 104, 0.2)", 10);
    strokeWave("rgba(126, 255, 116, 0.55)", 6.5);
    strokeWave("#a4f062", 4.2);

    const sweepU = ((scopeTime * 0.12) % 1.24) - 0.12;
    if (sweepU >= 0 && sweepU <= 1) {
      const top = project(sweepU, 0);
      const bottom = project(sweepU, 1);
      const sweep = ctx.createLinearGradient(top[0], top[1], bottom[0], bottom[1]);
      sweep.addColorStop(0, "rgba(170, 255, 210, 0)");
      sweep.addColorStop(0.55, "rgba(170, 255, 210, 0.12)");
      sweep.addColorStop(1, "rgba(170, 255, 210, 0)");
      ctx.strokeStyle = sweep;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(top[0], top[1]);
      ctx.lineTo(bottom[0], bottom[1]);
      ctx.stroke();
    }

    const glass = [
      [0.04, 1],
      [0.34, 1],
      [0.86, 0],
      [0.58, 0]
    ].map(([u, v]) => project(u, v));
    ctx.beginPath();
    glass.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    const sheen = ctx.createLinearGradient(glass[0][0], glass[0][1], glass[2][0], glass[2][1]);
    sheen.addColorStop(0, "rgba(220, 255, 240, 0.035)");
    sheen.addColorStop(1, "rgba(220, 255, 240, 0)");
    ctx.fillStyle = sheen;
    ctx.fill();
  }

  function scopeFrame(timestamp) {
    if (!running) return;
    scopeRaf = window.requestAnimationFrame(scopeFrame);
    if (!scopeLast) scopeLast = timestamp;
    if (timestamp - scopeLast < 32) return;
    const delta = Math.min(90, timestamp - scopeLast) / 1000;
    scopeLast = timestamp;
    scopeTime += delta;

    if (phase === "typing" && scopeTime > scopeModeUntil) {
      scopeMode = (scopeMode + 1) % 4;
      scopeModeUntil = scopeTime + rand(8, 14);
    }

    const target = phase === "crash" ? 0 : phase === "reboot" ? 0.28 : 1;
    scopeAmp += (target - scopeAmp) * Math.min(1, delta * 7);
    drawScope();
  }

  function startScope() {
    if (scopeRaf) window.cancelAnimationFrame(scopeRaf);
    scopeLast = 0;
    scopeTime = 0;
    scopeMode = 0;
    scopeModeUntil = rand(8, 12);
    scopeAmp = 1;
    drawScope();
    scopeRaf = window.requestAnimationFrame(scopeFrame);
  }

  function stopScope() {
    if (scopeRaf) window.cancelAnimationFrame(scopeRaf);
    scopeRaf = 0;
  }

  /* ---------- lifecycle ---------- */

  function start() {
    if (running || !allowed() || !visible || document.hidden) return;

    running = true;
    runToken += 1;
    typingToken += 1;
    setPhase("typing");
    snippetIndex = 0;
    frames = 0;
    firstCrash = true;

    stage.classList.add("is-on");
    stage.classList.remove("is-typing", "is-bsod");
    bsodEl.hidden = true;
    screen.setAttribute("aria-label", screenLabel);
    codeEl.textContent = "";
    clearKeyboard();
    modeEl.textContent = "BOOT";
    fileEl.textContent = "STUDY OS / POST";
    if (frameEl) frameEl.textContent = "FRAME / 001";
    setWindowStatus("LIVE", "");
    setLive("");

    const run = runToken;
    scene.start();
    startScope();
    runSnippets(run);
  }

  function stop() {
    if (!running && !stage.classList.contains("is-on")) return;

    running = false;
    runToken += 1;
    typingToken += 1;
    setPhase("idle");
    window.clearTimeout(crashTimer);
    window.clearTimeout(rebootTimer);
    window.clearTimeout(shakeTimer);
    scene.stop();
    stopScope();

    stage.classList.remove("is-on", "is-typing", "is-bsod");
    bsodEl.hidden = true;
    clearKeyboard();
    codeEl.textContent = "";
    screen.setAttribute("aria-label", screenLabel);
    if (frameEl) frameEl.textContent = "FRAME / 001";
    setWindowStatus("LIVE", "");
    if (consoleWindow) consoleWindow.classList.remove("is-crashing");
  }

  function evaluate() {
    if (allowed() && visible && !document.hidden) {
      if (!running) start();
    } else if (running) {
      stop();
    }
  }

  screen.addEventListener("click", () => {
    if (!running || !allowed()) return;
    if (phase === "crash") {
      reboot(runToken);
    } else if (phase === "typing") {
      triggerCrash(runToken);
    }
  });

  document.addEventListener("kawaii:skinchange", evaluate);
  document.addEventListener("kawaii:fxchange", evaluate);
document.addEventListener("kawaii:motionchange", evaluate);
  document.addEventListener("visibilitychange", evaluate);
  if (typeof reducedMotion.addEventListener === "function") {
    reducedMotion.addEventListener("change", evaluate);
  }

  if ("IntersectionObserver" in window && visual) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visible = entry.isIntersecting;
          evaluate();
        });
      },
      { threshold: 0.05 }
    );
    observer.observe(visual);
  }

  evaluate();
})();
