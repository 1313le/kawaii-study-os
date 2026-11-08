/* =========================================================
   kawaii / STUDY OS — theme controller
   ========================================================= */

(function () {
  "use strict";

  const SKIN_KEY = "kawaii.skin.v1";
  const FX_KEY = "kawaii.fx.v1";
  const DAYNIGHT_KEY = "kawaii.daynight.v1";
  const SKINS = ["pixel", "line"];
  const DAYNIGHT_PREFS = ["auto", "day", "night"];
  const root = document.documentElement;
  const listeners = new Set();

  function isDayHour() {
    const hour = new Date().getHours();
    return hour >= 6 && hour < 18;
  }

  function dayNightPref() {
    const saved = read(DAYNIGHT_KEY, "auto");
    return DAYNIGHT_PREFS.includes(saved) ? saved : "auto";
  }

  function dayNightMode() {
    const pref = dayNightPref();
    return pref === "auto" ? (isDayHour() ? "day" : "night") : pref;
  }

  function applyDayNight({ silent = false } = {}) {
    const mode = dayNightMode();
    const changed = root.dataset.daynight !== mode;
    root.dataset.daynight = mode;
    syncButtons();
    if (changed && !silent) emit("kawaii:daynightchange", { mode, pref: dayNightPref() });
    return mode;
  }

  function setDayNight(pref) {
    const next = DAYNIGHT_PREFS.includes(pref) ? pref : "auto";
    write(DAYNIGHT_KEY, next);
    applyDayNight();
    return dayNightMode();
  }

  function cycleDayNight() {
    const index = DAYNIGHT_PREFS.indexOf(dayNightPref());
    return setDayNight(DAYNIGHT_PREFS[(index + 1) % DAYNIGHT_PREFS.length]);
  }

  function read(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (error) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      /* storage may be blocked; the current session still works */
    }
  }

  function normalizeSkin(value) {
    return SKINS.includes(value) ? value : "pixel";
  }

  function current() {
    return normalizeSkin(root.dataset.skin || read(SKIN_KEY, "pixel"));
  }

  function fxOn() {
    return (root.dataset.fx || read(FX_KEY, "on")) !== "off";
  }

  function syncButtons() {
    const skin = current();
    const on = fxOn();
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-label", `切换主题，当前 ${skin === "pixel" ? "PIXEL" : "LINE"}`);
      button.setAttribute("aria-pressed", skin === "pixel" ? "false" : "true");
      const label = button.querySelector("[data-theme-label]");
      if (label) label.textContent = skin === "pixel" ? "PIXEL" : "LINE";
      const glyph = button.querySelector("[data-theme-glyph]");
      if (glyph) glyph.textContent = skin === "pixel" ? "▚" : "◻";
    });
    document.querySelectorAll("[data-fx-toggle]").forEach((button) => {
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.setAttribute("aria-label", on ? "关闭动效" : "开启动效");
      const label = button.querySelector("[data-fx-label]");
      if (label) label.textContent = on ? "FX ON" : "FX OFF";
    });
    const pref = dayNightPref();
    const mode = dayNightMode();
    document.querySelectorAll("[data-daynight-toggle]").forEach((button) => {
      button.setAttribute("aria-label", `日夜模式：${pref === "auto" ? "跟随时间" : pref === "day" ? "白天" : "夜间"}（当前${mode === "day" ? "白天" : "夜间"}）`);
      button.setAttribute("aria-pressed", pref === "auto" ? "false" : "true");
      const label = button.querySelector("[data-daynight-label]");
      if (label) label.textContent = pref === "auto" ? "AUTO" : pref === "day" ? "DAY" : "NIGHT";
      const glyph = button.querySelector("[data-daynight-glyph]");
      if (glyph) glyph.textContent = mode === "day" ? "☀" : "☾";
    });
  }

  function emit(name, detail) {
    const event = new CustomEvent(name, { detail });
    document.dispatchEvent(event);
    listeners.forEach((fn) => {
      try {
        fn(detail, name);
      } catch (error) {
        console.error(error);
      }
    });
  }

  function preferredSkin() {
    try {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "line" : "pixel";
    } catch (error) {
      return "pixel";
    }
  }

  function ensureWipe() {
    let wipe = document.querySelector(".theme-wipe");
    if (!wipe) {
      wipe = document.createElement("div");
      wipe.className = "theme-wipe";
      wipe.setAttribute("aria-hidden", "true");
      document.body.appendChild(wipe);
    }
    return wipe;
  }

  let switching = false;

  function setSkin(next, options) {
    const skin = normalizeSkin(next);
    const settings = Object.assign({ animate: true, silent: false }, options);
    if (skin === current()) {
      syncButtons();
      return;
    }
    if (switching) return;
    switching = true;

    const apply = () => {
      root.dataset.skin = skin;
      write(SKIN_KEY, skin);
      syncButtons();
      if (!settings.silent) {
        emit("kawaii:skinchange", { skin });
        emit("kawaii:theme", { skin });
      }
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!settings.animate || reduced) {
      apply();
      switching = false;
      return;
    }

    const wipe = ensureWipe();
    wipe.classList.add("is-active");
    window.setTimeout(apply, 190);
    window.setTimeout(() => {
      wipe.classList.remove("is-active");
      switching = false;
    }, 540);
  }

  function toggle() {
    setSkin(current() === "pixel" ? "line" : "pixel");
  }

  function setFx(value, options) {
    const settings = Object.assign({ silent: false }, options);
    const next = value === "off" ? "off" : "on";
    root.dataset.fx = next;
    write(FX_KEY, next);
    if (next === "on") {
      // Turning effects on is an explicit request, so it also lifts an OS-level freeze.
      try {
        localStorage.setItem("kawaii.motion.v1", "full");
      } catch (error) {
        /* private mode: the attribute below still applies for this page */
      }
      root.dataset.motion = "full";
    }
    syncButtons();
    if (!settings.silent) emit("kawaii:fxchange", { fx: next, on: next === "on" });
  }

  function toggleFx() {
    setFx(root.dataset.fx === "off" ? "on" : "off");
  }

  let wired = false;

  function init() {
    if (!root.dataset.skin) {
      root.dataset.skin = normalizeSkin(read(SKIN_KEY, preferredSkin()));
    }
    if (!root.dataset.fx) {
      root.dataset.fx = read(FX_KEY, "on") === "off" ? "off" : "on";
    }
    if (!root.dataset.daynight) applyDayNight({ silent: true });
    syncButtons();
    if (wired) return;
    wired = true;

    document.addEventListener("click", (event) => {
      const themeButton = event.target.closest("[data-theme-toggle]");
      if (themeButton) {
        event.preventDefault();
        toggle();
        return;
      }
      const fxButton = event.target.closest("[data-fx-toggle]");
      if (fxButton) {
        event.preventDefault();
        toggleFx();
        return;
      }
      const dayNightButton = event.target.closest("[data-daynight-toggle]");
      if (dayNightButton) {
        event.preventDefault();
        cycleDayNight();
      }
    });

    window.addEventListener("storage", (event) => {
      if (event.key === SKIN_KEY && event.newValue) {
        root.dataset.skin = normalizeSkin(event.newValue);
        syncButtons();
        emit("kawaii:skinchange", { skin: current() });
      }
      if (event.key === FX_KEY && event.newValue) {
        root.dataset.fx = event.newValue === "off" ? "off" : "on";
        syncButtons();
        emit("kawaii:fxchange", { fx: root.dataset.fx, on: root.dataset.fx === "on" });
      }
      if (event.key === DAYNIGHT_KEY) {
        applyDayNight();
      }
    });

    window.setInterval(() => {
      if (dayNightPref() !== "auto") return;
      if (root.dataset.daynight !== dayNightMode()) applyDayNight();
    }, 60 * 1000);
  }

  window.KawaiiTheme = {
    current,
    setSkin,
    toggle,
    fxOn,
    setFx,
    toggleFx,
    dayNightPref,
    dayNightMode,
    setDayNight,
    cycleDayNight,
    applyDayNight,
    init,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };

  init();
})();
