/* =========================================================
   kawaii / STUDY OS — clip inbox
   Screenshots, text and links dragged into the floating
   co-write TV land here for the next writing session.
   ========================================================= */

(function () {
  "use strict";

  const KEY = "kawaii.clips.v1";
  const MAX = 30;
  const EVENT = "kawaii:clips";

  function read() {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (!Array.isArray(list)) return [];
      return list.filter((clip) => clip && clip.id && clip.kind);
    } catch (error) {
      return [];
    }
  }

  function notify(list) {
    document.dispatchEvent(new CustomEvent(EVENT, { detail: list }));
  }

  function write(list) {
    const next = list.slice(0, MAX);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (error) {
      /* a full storage must not stop the desk */
    }
    notify(next);
    return next;
  }

  function add(input = {}) {
    const clip = {
      id: `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      kind: ["text", "image", "link", "file"].includes(input.kind) ? input.kind : "text",
      title: String(input.title || "").slice(0, 120),
      text: String(input.text || "").slice(0, 20000),
      url: String(input.url || "").slice(0, 500),
      source: String(input.source || "").slice(0, 200),
      at: new Date().toISOString()
    };
    const list = read();
    list.unshift(clip);
    write(list);
    return clip;
  }

  function remove(id) {
    write(read().filter((clip) => clip.id !== id));
  }

  function clear() {
    write([]);
  }

  function subscribe(fn) {
    const onCustom = (event) => fn(event.detail || read());
    const onStorage = (event) => {
      if (event.key === KEY) fn(read());
    };
    document.addEventListener(EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      document.removeEventListener(EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }

  function summary() {
    const list = read();
    return {
      total: list.length,
      images: list.filter((clip) => clip.kind === "image").length,
      text: list.filter((clip) => clip.kind === "text").length,
      links: list.filter((clip) => clip.kind === "link").length
    };
  }

  window.KawaiiClips = { KEY, read, add, remove, clear, subscribe, summary };
})();
