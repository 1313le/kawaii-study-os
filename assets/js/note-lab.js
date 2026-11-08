/* =========================================================
   kawaii / STUDY OS — note lab
   allowlisted JSON -> PWM / RC widgets, WaveDrom timing
   ========================================================= */

(function () {
  "use strict";

  const SKIN_LIB = "assets/vendor/wavedrom-skin.js";
  const WAVE_LIB = "assets/vendor/wavedrom.min.js";
  const MAX_LANES = 200;
  const MAX_WAVE = 500;
  const WAVE_CHARS = /^[0123456789xznpNPulhLdDvV. ]*$/;
  const PLOT_W = 320;
  const PLOT_H = 96;
  const TOP = 18;
  const BASE = 78;

  const done = new WeakSet();
  const waves = [];
  let loader = null;
  let seq = 0;

  function qa(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  const ok = (config) => ({ ok: true, config });
  const fail = (message) => ({ ok: false, message });

  function number(value, min, max) {
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
  }

  function parseJSON(raw) {
    let value;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      return null;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    return value;
  }

  function onlyKeys(value, allowed) {
    return Object.keys(value).every((key) => allowed.indexOf(key) !== -1);
  }

  function stringList(value, max, limit) {
    return (
      Array.isArray(value) &&
      value.length <= max &&
      value.every((item) => typeof item === "string" && item.length <= limit)
    );
  }

  /* ---------- PWM ---------- */

  function pwmSquare(duty) {
    const cycles = 4;
    const period = PLOT_W / cycles;
    const high = (period * duty) / 100;
    let path = `M 0 ${BASE}`;
    for (let index = 0; index < cycles; index++) {
      const start = index * period;
      path += ` L ${round(start)} ${TOP} L ${round(start + high)} ${TOP} L ${round(start + high)} ${BASE}`;
      path += ` L ${round(start + period)} ${BASE}`;
    }
    return path;
  }

  function formatHz(hz) {
    if (hz >= 1e6) return `${round(hz / 1e6)} MHz`;
    if (hz >= 1e3) return `${round(hz / 1e3)} kHz`;
    return `${round(hz)} Hz`;
  }

  const PWM = {
    title: "PWM / 占空比",
    parse(raw) {
      const value = parseJSON(raw);
      if (!value) return fail("JSON 无法解析，只接受一个参数对象。");
      if (!onlyKeys(value, ["frequency", "duty", "voltage"])) return fail("字段不在允许列表（frequency / duty / voltage）。");
      if (!number(value.frequency, 1, 1e6)) return fail("frequency 必须是 1 … 1000000 之间的有限数值。");
      const duty = value.duty === undefined ? 50 : value.duty;
      if (!number(duty, 0, 100)) return fail("duty 必须是 0 … 100 之间的有限数值。");
      const voltage = value.voltage === undefined ? 3.3 : value.voltage;
      if (!number(voltage, 0, 100)) return fail("voltage 必须是 0 … 100 之间的有限数值。");
      return ok({ frequency: value.frequency, duty, voltage });
    },
    build(config) {
      const box = document.createElement("div");
      box.className = "lab";
      box.dataset.lab = "pwm";
      box.innerHTML = `<div class="lab__plot"><svg viewBox="0 0 ${PLOT_W} ${PLOT_H}" preserveAspectRatio="none" role="img" aria-label="PWM 方波示意">
<line class="lab__grid" x1="0" y1="${TOP}" x2="${PLOT_W}" y2="${TOP}"></line>
<line class="lab__grid" x1="0" y1="${BASE}" x2="${PLOT_W}" y2="${BASE}"></line>
<path class="lab__wave" d=""></path></svg></div>
<label class="lab__control"><span class="lab__control-name">占空比</span>
<input type="range" min="0" max="100" step="1" aria-label="占空比">
<output class="lab__control-value" data-value="duty"></output></label>
<dl class="lab__values">
<div><dt>平均电压</dt><dd data-value="average"></dd></div>
<div><dt>高电平</dt><dd data-value="high"></dd></div>
<div><dt>频率</dt><dd data-value="frequency"></dd></div>
<div><dt>周期</dt><dd data-value="period"></dd></div>
</dl>`;
      const slider = box.querySelector("input[type=range]");
      const wave = box.querySelector(".lab__wave");
      slider.value = String(config.duty);
      box.querySelector('[data-value="high"]').textContent = `${config.voltage.toFixed(3)} V`;
      box.querySelector('[data-value="frequency"]').textContent = formatHz(config.frequency);
      box.querySelector('[data-value="period"]').textContent = `${(1e6 / config.frequency).toFixed(2)} µs`;
      const update = () => {
        const duty = number(Number(slider.value), 0, 100) ? Number(slider.value) : 0;
        wave.setAttribute("d", pwmSquare(duty));
        box.querySelector('[data-value="duty"]').textContent = `${duty.toFixed(0)} %`;
        box.querySelector('[data-value="average"]').textContent = `${((config.voltage * duty) / 100).toFixed(3)} V`;
      };
      slider.addEventListener("input", update);
      update();
      return box;
    }
  };

  /* ---------- RC ---------- */

  function rcCurve() {
    const steps = 64;
    let path = "";
    for (let index = 0; index <= steps; index++) {
      const t = (5 * index) / steps;
      const x = (PLOT_W * index) / steps;
      const y = BASE - (BASE - TOP) * (1 - Math.exp(-t));
      path += `${index === 0 ? "M" : " L"} ${round(x)} ${round(y)}`;
    }
    return path;
  }

  function rcPoint(observe) {
    const x = (PLOT_W * observe) / 5;
    const y = BASE - (BASE - TOP) * (1 - Math.exp(-observe));
    return { x: round(x), y: round(y) };
  }

  function formatTau(ms) {
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
    if (ms < 1) return `${(ms * 1000).toFixed(2)} µs`;
    return `${ms.toFixed(2)} ms`;
  }

  const RC = {
    title: "RC / 时间常数",
    parse(raw) {
      const value = parseJSON(raw);
      if (!value) return fail("JSON 无法解析，只接受一个参数对象。");
      if (!onlyKeys(value, ["resistance", "capacitance", "voltage", "observe"])) {
        return fail("字段不在允许列表（resistance / capacitance / voltage / observe）。");
      }
      if (!number(value.resistance, 1, 1e9)) return fail("resistance 必须是 1 … 1e9 Ω 之间的有限数值。");
      if (!number(value.capacitance, 0.001, 1e6)) return fail("capacitance 必须是 0.001 … 1e6 µF 之间的有限数值。");
      const voltage = value.voltage === undefined ? 3.3 : value.voltage;
      if (!number(voltage, 0, 100)) return fail("voltage 必须是 0 … 100 之间的有限数值。");
      const observe = value.observe === undefined ? 1 : value.observe;
      if (!number(observe, 0, 5)) return fail("observe 必须是 0 … 5 个时间常数之间。");
      return ok({ resistance: value.resistance, capacitance: value.capacitance, voltage, observe });
    },
    build(config) {
      const tauMs = (config.resistance * config.capacitance) / 1000;
      const box = document.createElement("div");
      box.className = "lab";
      box.dataset.lab = "rc";
      box.innerHTML = `<div class="lab__plot"><svg viewBox="0 0 ${PLOT_W} ${PLOT_H}" preserveAspectRatio="none" role="img" aria-label="RC 充电曲线">
<path class="lab__grid" d="M 0 ${TOP} L ${PLOT_W} ${TOP} M 0 ${BASE} L ${PLOT_W} ${BASE}"></path>
<path class="lab__curve" d="${rcCurve()}"></path>
<line class="lab__guide" x1="0" y1="${TOP}" x2="0" y2="${BASE}"></line>
<circle class="lab__marker" r="4" cx="0" cy="0"></circle></svg></div>
<label class="lab__control"><span class="lab__control-name">观察时刻</span>
<input type="range" min="0" max="5" step="0.05" aria-label="观察时刻">
<output class="lab__control-value" data-value="observe"></output></label>
<dl class="lab__values">
<div><dt>时间常数 τ</dt><dd data-value="tau"></dd></div>
<div><dt>充电电压</dt><dd data-value="charge"></dd></div>
<div><dt>充满</dt><dd data-value="target"></dd></div>
</dl>`;
      const slider = box.querySelector("input[type=range]");
      const marker = box.querySelector(".lab__marker");
      const guide = box.querySelector(".lab__guide");
      slider.value = String(config.observe);
      box.querySelector('[data-value="tau"]').textContent = formatTau(tauMs);
      box.querySelector('[data-value="target"]').textContent = `${config.voltage.toFixed(3)} V`;
      const update = () => {
        const observe = number(Number(slider.value), 0, 5) ? Number(slider.value) : 0;
        const point = rcPoint(observe);
        marker.setAttribute("cx", String(point.x));
        marker.setAttribute("cy", String(point.y));
        guide.setAttribute("x1", String(point.x));
        guide.setAttribute("x2", String(point.x));
        box.querySelector('[data-value="observe"]').textContent = `${observe.toFixed(2)} τ`;
        box.querySelector('[data-value="charge"]').textContent = `${(config.voltage * (1 - Math.exp(-observe))).toFixed(3)} V`;
      };
      slider.addEventListener("input", update);
      update();
      return box;
    }
  };

  const CODE_LABS = { pwm: PWM, rc: RC };

  /* ---------- WaveDrom ---------- */

  const DARK_SKIN = "kawaii-dark";
  const WAVE_BG = "#150c27";
  // WaveDrom ships one light datasheet skin; the pixel theme needs the same
  // diagram with its palette moved onto the site palette.
  const WAVE_COLORS = {
    "#000": "#c9b6e0",
    "#fff": WAVE_BG,
    "#aaa": "#6b5a86",
    "#0041c4": "#6ff7ff",
    "#f6b900": "#ffc93c",
    "#f60000": "#ff5c7a",
    "#00ab00": "#b8ff5a",
    "#ffffb4": "#4a3d10",
    "#ffe0b9": "#4a3413",
    "#b9e0ff": "#123a52",
    "#ccfdfe": "#0f4142",
    "#cdfdc5": "#144219",
    "#f0c1fb": "#3d1a45",
    "#f5c2c0": "#4a1a18"
  };

  function mapHex(hex) {
    return WAVE_COLORS[hex.toLowerCase()] || hex;
  }

  function darkValue(value) {
    if (typeof value !== "string") return value;
    const css = value
      .replace(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/g, mapHex)
      .replace(/\bwhite\b/gi, WAVE_BG)
      .replace(/\bblack\b/gi, "#c9b6e0");
    return value.indexOf("{") === -1 ? css : `${css}text{fill:#e9dcff}`;
  }

  function darkSkin(skin) {
    if (Array.isArray(skin)) return skin.map(darkSkin);
    if (skin !== null && typeof skin === "object") {
      const copy = {};
      for (const key of Object.keys(skin)) copy[key] = darkSkin(skin[key]);
      return copy;
    }
    return darkValue(skin);
  }

  function registerDarkSkin() {
    const skins = window.WaveSkin;
    if (skins && !skins[DARK_SKIN] && skins.default) skins[DARK_SKIN] = darkSkin(skins.default);
  }

  let printing = false;

  function waveSkin() {
    // Paper output always gets the light datasheet, whatever the screen theme is.
    return printing || document.documentElement.dataset.skin === "line" ? "default" : DARK_SKIN;
  }

  function validateLane(lane) {
    if (lane === null || typeof lane !== "object" || Array.isArray(lane)) {
      return fail("每条信号必须是对象，不支持分组数组。");
    }
    if (!onlyKeys(lane, ["name", "wave", "data", "phase"])) return fail("信号字段不在允许列表。");
    if (lane.name !== undefined && typeof lane.name !== "string") return fail("name 必须是字符串。");
    if (lane.wave !== undefined) {
      if (typeof lane.wave !== "string") return fail("wave 必须是字符串。");
      if (lane.wave.length > MAX_WAVE) return fail(`wave 最多 ${MAX_WAVE} 个周期。`);
      if (!WAVE_CHARS.test(lane.wave)) return fail("wave 含不支持的字符。");
    }
    if (lane.phase !== undefined && !number(lane.phase, -5, 5)) return fail("phase 必须是 -5 … 5。");
    if (lane.data !== undefined) {
      if (!stringList(lane.data, MAX_WAVE, 64)) return fail("data 必须是不超过 64 字符的字符串数组。");
    }
    return ok(lane);
  }

  function validateWave(raw) {
    const value = parseJSON(raw);
    if (!value) return fail("JSON 无法解析，只接受 WaveDrom 参数对象。");
    if (!onlyKeys(value, ["signal", "head", "foot", "config"])) return fail("顶层字段不在允许列表。");
    if (!Array.isArray(value.signal)) return fail("signal 必须是数组。");
    if (value.signal.length > MAX_LANES) return fail(`信号数量最多 ${MAX_LANES} 条。`);
    const signal = [];
    for (const lane of value.signal) {
      const result = validateLane(lane);
      if (!result.ok) return result;
      signal.push(result.config);
    }
    for (const key of ["head", "foot"]) {
      if (value[key] === undefined) continue;
      const part = value[key];
      if (part === null || typeof part !== "object" || Array.isArray(part)) return fail(`${key} 必须是对象。`);
      if (!onlyKeys(part, ["tick", "to", "text"])) return fail(`${key} 字段不在允许列表。`);
      if (part.tick !== undefined && !stringList(part.tick, MAX_WAVE, 16)) return fail(`${key}.tick 必须是短字符串数组。`);
      if (part.to !== undefined && !stringList(part.to, MAX_WAVE, 16)) return fail(`${key}.to 必须是短字符串数组。`);
      if (part.text !== undefined && typeof part.text !== "string") return fail(`${key}.text 必须是字符串。`);
    }
    if (value.config !== undefined) {
      const config = value.config;
      if (config === null || typeof config !== "object" || Array.isArray(config)) return fail("config 必须是对象。");
      if (!onlyKeys(config, ["hscale", "scale", "title", "skin", "legend"])) return fail("config 字段不在允许列表。");
      if (config.hscale !== undefined && !number(config.hscale, 1, 10)) return fail("config.hscale 必须是 1 … 10。");
      if (config.scale !== undefined && !number(config.scale, 0.2, 10)) return fail("config.scale 必须是 0.2 … 10。");
      if (config.title !== undefined && typeof config.title !== "string") return fail("config.title 必须是字符串。");
      if (config.legend !== undefined && !stringList(config.legend, 32, 80)) return fail("config.legend 必须是短字符串数组。");
      if (config.skin !== undefined && !/^[\w-]{1,32}$/.test(config.skin)) return fail("config.skin 不是合法名称。");
    }
    return ok(value);
  }

  function ensureLibrary() {
    if (loader) return loader;
    loader = new Promise((resolve, reject) => {
      const load = (src) =>
        new Promise((resolveScript, rejectScript) => {
          const script = document.createElement("script");
          script.src = src;
          script.defer = true;
          script.addEventListener("load", () => resolveScript());
          script.addEventListener("error", () => rejectScript(new Error(`load failed: ${src}`)));
          document.head.appendChild(script);
        });
      load(SKIN_LIB)
        .then(() => load(WAVE_LIB))
        .then(() => {
          if (window.WaveDrom && window.WaveDrom.RenderWaveForm) {
            registerDarkSkin();
            resolve(window.WaveDrom);
          } else reject(new Error("WaveDrom missing"));
        })
        .catch(reject);
    });
    return loader;
  }

  function errorNode(message) {
    const node = document.createElement("p");
    node.className = "lab-error";
    node.setAttribute("role", "alert");
    node.textContent = message;
    return node;
  }

  function renderCodeLabs(root) {
    qa(".code-block", root).forEach((block) => {
      const kind = (block.dataset.lang || "").toLowerCase();
      const lab = CODE_LABS[kind];
      if (!lab || done.has(block)) return;
      done.add(block);
      const code = block.querySelector("pre code") || block.querySelector("code");
      const result = lab.parse(code ? code.textContent : "");
      if (!result.ok) {
        block.appendChild(errorNode(`${lab.title}：${result.message}`));
        return;
      }
      const head = block.querySelector(".code-head");
      block.insertBefore(lab.build(result.config), head ? head.nextSibling : block.firstChild);
    });
  }

  function renderWaves(root) {
    const hosts = [];
    qa(".wavedrom", root).forEach((host) => {
      if (done.has(host)) return;
      done.add(host);
      hosts.push({ host, block: host.closest(".diagram-block") || host, result: validateWave(host.textContent) });
    });
    if (!hosts.length) return;
    const rejected = hosts.filter((item) => !item.result.ok);
    const accepted = hosts.filter((item) => item.result.ok);
    const report = () => rejected.forEach((item) => item.block.appendChild(errorNode(`WaveDrom：${item.result.message}`)));
    if (!accepted.length) {
      report();
      return;
    }
    // Errors wait for the library so a rejected block and a rendered one settle together.
    ensureLibrary().then(
      (lib) => {
        accepted.forEach((item) => {
          const record = { lib, index: ++seq, host: item.host, source: item.result.config };
          item.host.id = `kwd-${record.index}`;
          item.host.textContent = "";
          waves.push(record);
          drawWave(record);
        });
        report();
      },
      () => {
        accepted.forEach((item) => item.block.appendChild(errorNode("WaveDrom：波形库未能加载，源码仍可查看。")));
        report();
      }
    );
  }

  function drawWave(record) {
    // WaveDrom 3.8 renders into getElementById(prefix + index), mutates the source
    // object, and picks the skin from WaveSkin, so each pass gets a fresh copy.
    const source = JSON.parse(JSON.stringify(record.source));
    const skin = waveSkin();
    source.config = Object.assign({}, source.config, { skin });
    record.lib.RenderWaveForm(record.index, source, "kwd-", false, false);
    // The renderer paints a white backdrop of its own, outside the skin definition.
    qa("rect[style]", record.host).forEach((rect) => {
      if (!/fill:\s*(white|#fff\b)/i.test(rect.getAttribute("style") || "")) return;
      rect.style.fill = skin === DARK_SKIN ? WAVE_BG : "white";
    });
  }

  function rerenderWaves() {
    registerDarkSkin();
    waves.forEach(drawWave);
  }

  function render(root) {
    renderCodeLabs(root);
    renderWaves(root);
  }

  window.KawaiiLabTools = { render };

  document.addEventListener("kawaii:skinchange", rerenderWaves);

  window.addEventListener("beforeprint", () => {
    printing = true;
    rerenderWaves();
  });
  window.addEventListener("afterprint", () => {
    printing = false;
    rerenderWaves();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => render(document));
  } else {
    render(document);
  }
})();
