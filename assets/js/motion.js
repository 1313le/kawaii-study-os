/* =========================================================
   kawaii / STUDY OS — motion switch
   The OS can ask for reduced motion; the site must not freeze
   silently because of it. This module explains why nothing
   moves and offers one click back to full motion.
   ========================================================= */

(function () {
  "use strict";

  const KEY = "kawaii.motion.v1";
  const DISMISS = "kawaii.motion.dismissed";
  const root = document.documentElement;
  const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  let note = null;

  function stored() {
    try {
      return localStorage.getItem(KEY) || "";
    } catch (error) {
      return "";
    }
  }

  function remember(value) {
    try {
      localStorage.setItem(KEY, value);
    } catch (error) {
      /* private mode: the attribute still decides for this page */
    }
  }

  function apply(value) {
    if (value) root.dataset.motion = value;
    else delete root.dataset.motion;
  }

  function state() {
    const explicit = stored();
    const osReduced = Boolean(mq.matches);
    const fxOff = root.dataset.fx === "off";
    return {
      explicit,
      osReduced,
      fxOff,
      suspended: fxOff || explicit === "reduced" || (osReduced && explicit !== "full")
    };
  }

  function reason(info) {
    if (info.fxOff) return "站内的 FX 开关是关闭的";
    if (info.explicit === "reduced") return "你之前选择了「保持关闭」";
    return "系统开启了「减少动态效果」";
  }

  function notify() {
    document.dispatchEvent(new CustomEvent("kawaii:motionchange", { detail: { mode: stored() || "auto" } }));
  }

  function resume() {
    remember("full");
    apply("full");
    if (root.dataset.fx === "off" && window.KawaiiTheme) {
      window.KawaiiTheme.setFx("on");
    } else {
      document.dispatchEvent(new CustomEvent("kawaii:fxchange", {
        detail: { fx: root.dataset.fx || "on", on: root.dataset.fx !== "off" }
      }));
    }
    notify();
    hide();
  }

  function keepOff() {
    remember("reduced");
    apply("reduced");
    notify();
    hide();
  }

  function build() {
    if (note) return note;
    note = document.createElement("div");
    note.className = "motion-note";
    note.setAttribute("role", "status");
    note.innerHTML = `
<span class="motion-note__glyph" aria-hidden="true">▚</span>
<div class="motion-note__copy">
  <b>动效暂停了</b>
  <span data-motion-reason></span>
</div>
<button class="motion-note__go" type="button" data-motion-resume>恢复动效</button>
<button class="motion-note__x" type="button" data-motion-keep aria-label="保持关闭">×</button>`;
    note.querySelector("[data-motion-resume]").addEventListener("click", resume);
    note.querySelector("[data-motion-keep]").addEventListener("click", () => {
      const info = state();
      if (info.fxOff) hide();
      else keepOff();
    });
    document.body.appendChild(note);
    return note;
  }

  function hide() {
    try {
      sessionStorage.setItem(DISMISS, "1");
    } catch (error) {}
    if (note) note.hidden = true;
  }

  function dismissed() {
    try {
      return sessionStorage.getItem(DISMISS) === "1";
    } catch (error) {
      return false;
    }
  }

  function sync() {
    if (!document.body) return;
    const info = state();
    if (!info.suspended || dismissed()) {
      if (note) note.hidden = true;
      return;
    }
    const box = build();
    box.querySelector("[data-motion-reason]").textContent = reason(info);
    box.hidden = false;
  }

  document.addEventListener("kawaii:fxchange", () => {
    if (document.body) sync();
  });
  if (typeof mq.addEventListener === "function") mq.addEventListener("change", sync);
  document.addEventListener("kawaii:motionchange", sync);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", sync);
  } else {
    sync();
  }

  window.KawaiiMotion = {
    state,
    resume,
    keepOff,
    sync,
    set(value) {
      remember(value === "reduced" ? "reduced" : "full");
      apply(stored());
      notify();
      sync();
    }
  };
})();
