/* =========================================================
   kawaii / STUDY OS — desk link
   One small state bus for the write desk. localStorage keeps
   the last session across pages; BroadcastChannel makes two
   open tabs move together. Nothing leaves the browser.
   ========================================================= */

(function () {
  "use strict";

  const KEY = "kawaii.desk.v1";
  const CHANNEL = "kawaii.desk";
  const EVENT = "kawaii:deskstate";
  let channel = null;
  try {
    channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL) : null;
  } catch (error) {
    channel = null;
  }

  function clean(value) {
    if (!value || typeof value !== "object") return null;
    const text = (key, max) => String(value[key] == null ? "" : value[key]).slice(0, max);
    const num = (key) => Math.max(0, Number(value[key]) || 0);
    return {
      title: text("title", 80),
      tail: text("tail", 400),
      line: num("line") || 1,
      col: num("col") || 1,
      chars: num("chars"),
      caret: num("caret"),
      totalLines: num("totalLines") || 1,
      mode: text("mode", 12) || "edit",
      dirty: Boolean(value.dirty),
      savedAt: value.savedAt || null,
      at: num("at") || Date.now()
    };
  }

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? clean(JSON.parse(raw)) : null;
    } catch (error) {
      return null;
    }
  }

  function publish(state) {
    const value = clean(state);
    if (!value) return null;
    value.at = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch (error) {
      /* a full or blocked storage must not stop the editor */
    }
    if (channel) {
      try {
        channel.postMessage(value);
      } catch (error) {}
    }
    document.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
    return value;
  }

  function subscribe(fn) {
    const onCustom = (event) => fn(event.detail);
    const onStorage = (event) => {
      if (event.key !== KEY) return;
      const value = read();
      if (value) fn(value);
    };
    const onChannel = (event) => {
      const value = clean(event.data);
      if (value) fn(value);
    };
    document.addEventListener(EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    if (channel) channel.addEventListener("message", onChannel);
    return () => {
      document.removeEventListener(EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
      if (channel) channel.removeEventListener("message", onChannel);
    };
  }

  window.KawaiiDesk = { KEY, read, publish, subscribe, clean };
})();
