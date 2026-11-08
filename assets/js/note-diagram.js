/* =========================================================
   kawaii / STUDY OS — diagram tools
   strict Mermaid rendering, enlarge dialog, source view
   ========================================================= */

(function () {
  "use strict";

  const MIN_SCALE = 0.5;
  const MAX_SCALE = 3;
  const STEP = 1.25;
  const LIB = "assets/vendor/mermaid.min.js";

  const records = new WeakMap();
  const blocks = [];
  let generation = 0;
  let renderSeq = 0;
  let queue = Promise.resolve();
  let loader = null;
  let dialog = null;
  let scale = 1;
  let trigger = null;

  function configFor(skin) {
    if (skin === "line") {
      return {
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: '"Albert Sans", "PingFang SC", "Microsoft YaHei", sans-serif',
        themeVariables: {
          background: "#f7f6f2",
          primaryColor: "#f7f6f2",
          primaryTextColor: "#161616",
          primaryBorderColor: "#161616",
          secondaryColor: "#ecebe5",
          secondaryTextColor: "#161616",
          secondaryBorderColor: "#b9b7b0",
          tertiaryColor: "#ffffff",
          lineColor: "#145cff",
          textColor: "#161616",
          mainBkg: "#f7f6f2",
          nodeBorder: "#161616",
          clusterBkg: "#f1f0eb",
          clusterBorder: "#b9b7b0",
          edgeLabelBackground: "#f7f6f2",
          fontFamily: '"Albert Sans", "PingFang SC", sans-serif',
          fontSize: "14px"
        }
      };
    }
    return {
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
      darkMode: true,
      fontFamily: '"Cascadia Mono", "PingFang SC", "Microsoft YaHei", monospace',
      themeVariables: {
        background: "#07030f",
        primaryColor: "#2a1748",
        primaryTextColor: "#f8f0ff",
        primaryBorderColor: "#ff5fd2",
        secondaryColor: "#1c1033",
        secondaryTextColor: "#f8f0ff",
        secondaryBorderColor: "#5d3789",
        tertiaryColor: "#150c27",
        tertiaryTextColor: "#c8b6e2",
        lineColor: "#6ff7ff",
        textColor: "#f8f0ff",
        mainBkg: "#2a1748",
        nodeBorder: "#6ff7ff",
        clusterBkg: "#150c27",
        clusterBorder: "#5d3789",
        edgeLabelBackground: "#07030f",
        fontFamily: '"Cascadia Mono", "PingFang SC", monospace',
        fontSize: "14px"
      }
    };
  }

  function ensureLibrary() {
    if (loader) return loader;
    loader = new Promise((resolve, reject) => {
      if (window.mermaid) {
        resolve(window.mermaid);
        return;
      }
      const script = document.createElement("script");
      script.src = LIB;
      script.defer = true;
      script.addEventListener("load", () => {
        if (window.mermaid) resolve(window.mermaid);
        else reject(new Error("mermaid missing"));
      });
      script.addEventListener("error", () => reject(new Error("mermaid load failed")));
      document.head.appendChild(script);
    });
    return loader;
  }

  function headOf(block) {
    return block.querySelector(".diagram-head");
  }

  function actionsOf(block) {
    const head = headOf(block);
    if (!head) return null;
    let box = head.querySelector(".diagram-actions");
    if (box) return box;
    box = document.createElement("span");
    box.className = "diagram-actions";
    const dot = head.querySelector(".diagram-dot");
    if (dot) box.appendChild(dot);
    head.appendChild(box);
    return box;
  }

  function setStatus(block, text) {
    const box = actionsOf(block);
    if (!box) return;
    const existing = box.querySelector("[data-diagram-status]");
    if (!text) {
      if (existing) existing.remove();
      return;
    }
    if (existing) {
      existing.textContent = text;
      return;
    }
    const status = document.createElement("span");
    status.className = "diagram-status";
    status.dataset.diagramStatus = "";
    status.textContent = text;
    box.insertBefore(status, box.querySelector("[data-diagram-open]"));
  }

  function actionButton(block, kind, label, title) {
    const box = actionsOf(block);
    if (!box) return null;
    const existing = box.querySelector(`[data-diagram-${kind}]`);
    if (existing) return existing;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "diagram-action";
    button.setAttribute(`data-diagram-${kind}`, "");
    button.setAttribute("aria-label", title);
    button.textContent = label;
    box.appendChild(button);
    return button;
  }

  function previewOf() {
    return dialog.querySelector("[data-diagram-preview]");
  }

  function applyScale() {
    const preview = previewOf();
    const svg = preview.querySelector("svg");
    const base = Number(preview.dataset.base) || 0;
    if (svg && base) svg.style.width = `${Math.round(base * scale)}px`;
    dialog.querySelector("[data-diagram-scale]").textContent = `${Math.round(scale * 100)}%`;
    dialog.querySelector('[data-diagram-zoom="in"]').disabled = scale >= MAX_SCALE;
    dialog.querySelector('[data-diagram-zoom="out"]').disabled = scale <= MIN_SCALE;
  }

  function setMode(mode) {
    dialog.dataset.mode = mode;
    dialog.querySelectorAll("[data-diagram-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.diagramMode === mode ? "true" : "false");
    });
  }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "diagram-dialog";
    dialog.setAttribute("aria-label", "图表查看");
    dialog.dataset.mode = "preview";
    dialog.innerHTML = `
<div class="diagram-dialog__bar">
  <span class="diagram-dialog__title" data-diagram-title>DIAGRAM</span>
  <span class="diagram-dialog__zoom">
    <span class="diagram-dialog__scale" data-diagram-scale>100%</span>
    <button type="button" class="diagram-dialog__btn" data-diagram-zoom="out" aria-label="缩小">−</button>
    <button type="button" class="diagram-dialog__btn" data-diagram-zoom="in" aria-label="放大">+</button>
    <button type="button" class="diagram-dialog__btn" data-diagram-zoom="reset" aria-label="原始大小">1:1</button>
  </span>
  <span class="diagram-dialog__modes">
    <button type="button" class="diagram-dialog__btn" data-diagram-mode="preview">图</button>
    <button type="button" class="diagram-dialog__btn" data-diagram-mode="source">源</button>
  </span>
  <button type="button" class="diagram-dialog__btn diagram-dialog__btn--close" data-diagram-close aria-label="关闭">×</button>
</div>
<div class="diagram-dialog__stage">
  <div class="diagram-dialog__preview" data-diagram-preview></div>
  <pre class="diagram-dialog__source" data-diagram-source-content tabindex="0"></pre>
</div>`;
    document.body.appendChild(dialog);

    dialog.querySelectorAll("[data-diagram-zoom]").forEach((button) => {
      button.addEventListener("click", () => {
        const kind = button.dataset.diagramZoom;
        if (kind === "reset") scale = 1;
        else if (kind === "in") scale = Math.min(MAX_SCALE, scale * STEP);
        else scale = Math.max(MIN_SCALE, scale / STEP);
        applyScale();
      });
    });
    dialog.querySelectorAll("[data-diagram-mode]").forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.diagramMode));
    });
    dialog.querySelector("[data-diagram-close]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      previewOf().replaceChildren();
      if (trigger && trigger.isConnected) trigger.focus();
      trigger = null;
    });
    return dialog;
  }

  function openDialog(block, mode, opener) {
    ensureDialog();
    const record = records.get(block);
    const source = record ? record.source : "";
    const svg = block.querySelector(".mermaid svg");
    let view = mode;
    trigger = opener || null;
    scale = 1;
    dialog.querySelector("[data-diagram-title]").textContent =
      (block.querySelector(".diagram-head span:first-child") || { textContent: "DIAGRAM" }).textContent;
    dialog.querySelector("[data-diagram-source-content]").textContent = source;
    previewOf().replaceChildren();
    if (svg) previewOf().appendChild(document.importNode(svg, true));
    else view = "source";
    setMode(view);
    dialog.showModal();
    const preview = previewOf();
    const scaled = preview.querySelector("svg");
    preview.dataset.base = scaled ? String(Math.round(scaled.getBoundingClientRect().width)) : "";
    if (scaled) {
      scaled.style.maxWidth = "none";
      scaled.style.height = "auto";
    }
    applyScale();
  }

  function stripInteraction(svg) {
    svg.querySelectorAll("[class]").forEach((element) => {
      if (element.classList.contains("clickable")) element.classList.remove("clickable");
    });
    svg.querySelectorAll("*").forEach((element) => {
      Array.from(element.attributes).forEach((attr) => {
        if (/^on/i.test(attr.name)) element.removeAttribute(attr.name);
      });
    });
  }

  function renderBlock(block, lib) {
    const record = records.get(block);
    const body = block.querySelector(".mermaid");
    if (!record || !body) return Promise.resolve();
    return lib.render(`kmd-${++renderSeq}`, record.source).then(
      (result) => {
        if (result && result.svg) {
          body.classList.remove("mermaid--error");
          body.innerHTML = result.svg;
          const svg = body.querySelector("svg");
          if (svg) stripInteraction(svg);
          setStatus(block, "");
          return;
        }
        throw new Error("empty render");
      },
      (error) => {
        body.classList.add("mermaid--error");
        body.textContent = record.source;
        setStatus(block, "RENDER ERROR");
      }
    );
  }

  function markOffline() {
    blocks.forEach((block) => {
      const record = records.get(block);
      const body = block.querySelector(".mermaid");
      if (!body) return;
      body.classList.add("mermaid--error");
      body.textContent = record.source;
      setStatus(block, "MERMAID OFFLINE");
    });
  }

  function run(generationId, skin) {
    if (generationId !== generation) return Promise.resolve();
    return ensureLibrary().then(
      (lib) => {
        if (generationId !== generation) return undefined;
        lib.initialize(configFor(skin));
        return blocks.reduce(
          (chain, block) => chain.then(() => (generationId === generation ? renderBlock(block, lib) : undefined)),
          Promise.resolve()
        );
      },
      () => {
        if (generationId !== generation) return undefined;
        markOffline();
      }
    );
  }

  function schedule() {
    const generationId = ++generation;
    const skin = document.documentElement.dataset.skin;
    // One failed pass must not wedge the queue behind it.
    queue = queue.then(() => run(generationId, skin)).catch(() => {});
    return queue;
  }

  function enhance(block, source) {
    if (!block || !block.classList.contains("diagram-block")) return;
    const body = block.querySelector(".mermaid");
    let record = records.get(block);
    if (!record) {
      const textNode = body || block.querySelector(".wavedrom");
      record = { source: textNode ? textNode.textContent : "" };
      records.set(block, record);
      blocks.push(block);
      const open = actionButton(block, "open", "放大", "放大查看图表");
      if (open && open.dataset.wired !== "1") {
        open.dataset.wired = "1";
        open.addEventListener("click", () => openDialog(block, "preview", open));
      }
      const show = actionButton(block, "source", "源码", "查看图表源码");
      if (show && show.dataset.wired !== "1") {
        show.dataset.wired = "1";
        show.addEventListener("click", () => openDialog(block, "source", show));
      }
      return;
    }
    if (source === undefined) return;
    const next = String(source);
    if (record.source === next) return;
    record.source = next;
    if (body) body.textContent = next;
    setStatus(block, "");
    schedule();
  }

  function ready() {
    return queue;
  }

  document.addEventListener("kawaii:skinchange", () => {
    if (blocks.length) schedule();
  });

  window.KawaiiDiagramTools = { enhance, render: schedule, ready };
})();
