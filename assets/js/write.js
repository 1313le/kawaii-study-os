/* =========================================================
   kawaii / STUDY OS — write desk
   The screen is a real textarea: IME, caret, undo and selection
   stay native, and only the chrome pretends to be 8-bit.
   ========================================================= */

(function () {
  "use strict";

  const SCREEN = document.querySelector("#write-screen");
  const PREVIEW = document.querySelector("[data-write-preview]");
  if (!SCREEN) return;

  const DRAFT_KEY = "kawaii.draft.v1";
  const KINDS = [
    ["article", "日志"],
    ["concept", "概念卡"],
    ["experiment", "实验记录"],
    ["debug", "排障记录"],
    ["cornell", "问答笔记"],
    ["review", "周复盘"]
  ];
  const ACCENTS = ["lime", "pink", "cyan", "amber", "blue"];
  const FX = ["reveal", "scan", "signal", "glitch", "type", "none"];

  const panelEl = document.querySelector("[data-ai-panel]");
  const panel = { mode: "polish", target: null, snapshot: null, result: null, hunks: [], previous: null };

  const FN = {
    open: false,
    panel: document.querySelector("[data-fn-deck]"),
    button: document.querySelector("[data-fn-open]"),
    led: document.querySelector("[data-fn-led]")
  };

  const LIVE_KEY = "kawaii.live.v1";
  const live = {
    enabled: (() => {
      try { return localStorage.getItem(LIVE_KEY) !== "off"; } catch (error) { return true; }
    })(),
    timer: 0,
    heartbeat: 0,
    busy: false
  };

  const state = {
    previewTimer: 0,
    slug: "",
    dirty: false,
    mode: "edit",
    savedAt: null,
    previewStale: true,
    draftTimer: 0,
    typewriter: false,
    outline: false,
    palette: { open: false, mode: "", items: [], index: 0, start: 0, query: "" },
    restoreSnapshot: -1
  };

  const $ = (selector) => document.querySelector(selector);
  const metaField = (name) => document.querySelector(`[data-meta="${name}"]`);
  const today = () => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  };
  const clock = () => new Date().toTimeString().slice(0, 5);

  const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/g;
  const LATIN_PATTERN = /[A-Za-z0-9_]+/g;

  function countWords(text) {
    return (String(text).match(CJK_PATTERN) || []).length + (String(text).match(LATIN_PATTERN) || []).length;
  }

  function readingMinutes(text) {
    const cjk = (String(text).match(CJK_PATTERN) || []).length;
    const latin = (String(text).match(LATIN_PATTERN) || []).length;
    return Math.max(1, Math.ceil(cjk / 350 + latin / 220));
  }

  function lineStartIndex(value, caret) {
    return value.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
  }

  function caretLine() {
    const value = SCREEN.value;
    const caret = SCREEN.selectionStart;
    const start = lineStartIndex(value, caret);
    const next = value.indexOf("\n", caret);
    return { value, caret, start, end: next === -1 ? value.length : next, prefix: value.slice(start, caret) };
  }

  function inFence(value, caret) {
    return ((value.slice(0, caret).match(/```/g) || []).length % 2) === 1;
  }

  function insertAtCaret(text) {
    SCREEN.setRangeText(text, SCREEN.selectionStart, SCREEN.selectionEnd, "end");
    SCREEN.dispatchEvent(new Event("input", { bubbles: true }));
    SCREEN.focus();
  }

  function parseHeadings(text) {
    const headings = [];
    let fence = false;
    let offset = 0;
    for (const line of String(text || "").split("\n")) {
      if (/^\s*```/.test(line)) fence = !fence;
      if (!fence) {
        const match = line.match(/^(#{1,6})\s+(.+)$/);
        if (match) headings.push({ level: match[1].length, text: match[2].trim(), index: offset });
      }
      offset += line.length + 1;
    }
    return headings;
  }

  /* ---------- typewriter + outline ---------- */

  let caretRaf = 0;
  function keepCaretVisible(force) {
    if ((!state.typewriter && !force) || state.mode === "preview") return;
    let mirror = document.querySelector("#write-caret-mirror");
    if (!mirror) {
      mirror = document.createElement("div");
      mirror.id = "write-caret-mirror";
      mirror.setAttribute("aria-hidden", "true");
      document.body.appendChild(mirror);
    }
    const cs = getComputedStyle(SCREEN);
    Object.assign(mirror.style, {
      position: "absolute",
      top: "0",
      left: "-99999px",
      visibility: "hidden",
      width: `${SCREEN.clientWidth}px`,
      font: cs.font,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      padding: cs.padding,
      border: cs.border,
      boxSizing: cs.boxSizing,
      whiteSpace: "pre-wrap",
      wordWrap: "break-word",
      overflowWrap: "break-word"
    });
    mirror.textContent = SCREEN.value.slice(0, SCREEN.selectionStart);
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirror.appendChild(marker);
    const top = marker.offsetTop;
    SCREEN.scrollTop = Math.max(0, top - SCREEN.clientHeight * 0.38);
    mirror.textContent = "";
  }

  function keepCaretVisibleSoon() {
    if (!state.typewriter || caretRaf) return;
    caretRaf = window.requestAnimationFrame(() => {
      caretRaf = 0;
      keepCaretVisible();
    });
  }

  function renderOutline() {
    const host = document.querySelector("[data-outline-list]");
    if (!host) return;
    const headings = parseHeadings(SCREEN.value);
    host.innerHTML = headings.length
      ? headings
        .map(
          (heading) =>
            `<li><button type="button" data-outline-index="${heading.index}" data-outline-level="${heading.level}">${escapeText(heading.text)}</button></li>`
        )
        .join("")
      : `<li class="screen__outline-empty">还没有标题。用 ## 写一行，大纲会自己长出来。</li>`;
    syncOutlineActive();
  }

  let outlineTimer = 0;
  function renderOutlineSoon() {
    if (!state.outline) return;
    window.clearTimeout(outlineTimer);
    outlineTimer = window.setTimeout(renderOutline, 220);
  }

  function syncOutlineActive() {
    if (!state.outline) return;
    const host = document.querySelector("[data-outline-list]");
    if (!host) return;
    const caret = SCREEN.selectionStart;
    const buttons = Array.from(host.querySelectorAll("[data-outline-index]"));
    let active = null;
    for (const button of buttons) {
      if (Number(button.dataset.outlineIndex) <= caret) active = button;
      else break;
    }
    buttons.forEach((button) => button.classList.toggle("is-active", button === active));
  }

  function toggleOutline(force) {
    const next = force === undefined ? !state.outline : Boolean(force);
    state.outline = next;
    const host = document.querySelector("[data-write-outline]");
    if (host) host.hidden = !next;
    const button = document.querySelector('[data-write-action="outline"]');
    if (button) button.setAttribute("aria-pressed", next ? "true" : "false");
    if (next) renderOutline();
    syncFnLed();
    SCREEN.focus();
  }

  /* ---------- slash menu + wiki-link completion ---------- */

  const TEMPLATES = {
    experiment: "## 目标\n\n## 接线 / 环境\n\n## 现象\n\n## 数据\n\n## 结论\n",
    debug: "## 现象\n\n## 我试过\n\n## 根因\n\n## 修正\n",
    review: "## 本周完成\n- \n\n## 卡点\n- \n\n## 最大的一个理解\n\n## 下周只做三件事\n1. \n2. \n3. \n",
    concept: "## 一句话定义\n\n## 类比\n\n## 最小可验证例子\n\n## 自测\n",
    daily: "## 今天做了什么\n\n## 卡点\n\n## 明天第一步\n"
  };

  const SLASH_COMMANDS = [
    { id: "h2", label: "标题 H2", hint: "## ", insert: "## " },
    { id: "h3", label: "标题 H3", hint: "### ", insert: "### " },
    { id: "list", label: "无序列表", hint: "- ", insert: "- " },
    { id: "task", label: "待办清单", hint: "- [ ] ", insert: "- [ ] " },
    { id: "quote", label: "引用", hint: "> ", insert: "> " },
    { id: "code", label: "代码块", hint: "```", insert: "```\n\n```", caret: 4 },
    { id: "table", label: "表格", hint: "| |", insert: "| 列 | 列 |\n| --- | --- |\n|  |  |" },
    { id: "divider", label: "分割线", hint: "---", insert: "\n---\n" },
    { id: "image", label: "图片", hint: "![]()", insert: "![图注](assets/img/)" },
    { id: "math", label: "公式", hint: "$$", insert: "$$\n\n$$", caret: 3 },
    { id: "mermaid", label: "Mermaid 图", hint: "flowchart", insert: "```mermaid\nflowchart LR\n    A --> B\n```" },
    { id: "callout-note", label: "说明框", hint: "> [!NOTE]", insert: "> [!NOTE]\n> 这里写说明。\n" },
    { id: "callout-tip", label: "提示框", hint: "> [!TIP]", insert: "> [!TIP]\n> 这里写提示。\n" },
    { id: "callout-warning", label: "警告框", hint: "> [!WARNING]", insert: "> [!WARNING]\n> 这里写警告。\n" },
    { id: "lab-pwm", label: "演示：PWM", hint: "```pwm", insert: "```pwm\n{\"frequency\": 1000, \"duty\": 30, \"voltage\": 3.3}\n```\n" },
    { id: "lab-rc", label: "演示：RC 充电", hint: "```rc", insert: "```rc\n{\"resistance\": 1000, \"capacitance\": 100, \"voltage\": 5}\n```\n" },
    { id: "wavedrom", label: "时序图 WaveDrom", hint: "```wavedrom", insert: "```wavedrom\n{\"signal\":[{\"name\":\"clk\",\"wave\":\"p....\"},{\"name\":\"data\",\"wave\":\"x.345\"}]}\n```\n" },
    { id: "mindmap", label: "嵌入导图", hint: "```mindmap", insert: "```mindmap\n# 中心主题\n## 分支一\n- 要点\n## 分支二\n- 要点\n```\n" },
    { id: "tpl-experiment", label: "模板：实验记录", hint: "TEMPLATE", insert: TEMPLATES.experiment, kind: "experiment" },
    { id: "tpl-debug", label: "模板：排障记录", hint: "TEMPLATE", insert: TEMPLATES.debug, kind: "debug" },
    { id: "tpl-review", label: "模板：周复盘", hint: "TEMPLATE", insert: TEMPLATES.review, kind: "review" },
    { id: "tpl-concept", label: "模板：概念卡", hint: "TEMPLATE", insert: TEMPLATES.concept, kind: "concept" },
    { id: "tpl-daily", label: "模板：今日日志", hint: "TEMPLATE", insert: TEMPLATES.daily, kind: "article" }
  ];

  function linkItems(query) {
    const needle = String(query || "").toLowerCase();
    const all = (window.Kawaii && window.Kawaii.notes && window.Kawaii.notes.all) || [];
    return all
      .filter(
        (note) =>
          !needle ||
          String(note.slug).toLowerCase().includes(needle) ||
          String(note.title).toLowerCase().includes(needle)
      )
      .slice(0, 8)
      .map((note) => ({ id: note.slug, label: note.title, hint: note.slug }));
  }

  function renderPalette() {
    const host = document.querySelector("[data-write-palette]");
    if (!host) return;
    const palette = state.palette;
    host.hidden = !palette.open;
    if (!palette.open) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = palette.items
      .map(
        (item, index) =>
          `<button type="button" role="option" data-palette-index="${index}" aria-selected="${index === palette.index}" class="screen__palette-item${index === palette.index ? " is-active" : ""}">
            <span>${escapeText(item.label)}</span><small>${escapeText(item.hint || "")}</small>
          </button>`
      )
      .join("");
    const active = host.querySelector(".is-active");
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  function closePalette() {
    if (!state.palette.open) return;
    state.palette.open = false;
    renderPalette();
  }

  function openPalette(mode, query, start, items) {
    if (!items.length) {
      closePalette();
      return;
    }
    Object.assign(state.palette, { open: true, mode, query, start, items, index: 0 });
    renderPalette();
  }

  function detectPalette() {
    if (state.mode === "preview" || SCREEN.selectionStart !== SCREEN.selectionEnd) {
      closePalette();
      return;
    }
    if (inFence(SCREEN.value, SCREEN.selectionStart)) {
      closePalette();
      return;
    }
    const { value, caret, prefix } = caretLine();
    const link = value.slice(0, caret).match(/\[\[([^\[\]\n]*)$/);
    if (link) {
      const query = link[1];
      openPalette("link", query, caret - query.length - 2, linkItems(query));
      return;
    }
    const slash = prefix.match(/^\s*\/([^\s/]*)$/);
    if (slash) {
      const query = slash[1].toLowerCase();
      const items = SLASH_COMMANDS.filter(
        (command) => !query || command.label.toLowerCase().includes(query) || command.id.includes(query)
      );
      openPalette("slash", query, caret - slash[1].length - 1, items);
      return;
    }
    closePalette();
  }

  function movePalette(step) {
    const palette = state.palette;
    if (!palette.open || !palette.items.length) return;
    palette.index = (palette.index + step + palette.items.length) % palette.items.length;
    renderPalette();
  }

  function choosePalette(index = state.palette.index) {
    const palette = state.palette;
    const item = palette.items[index];
    if (!item) return;
    const text = palette.mode === "link" ? `[[${item.id}]]` : item.insert;
    const start = palette.start;
    const end = SCREEN.selectionStart;
    SCREEN.setRangeText(text, start, end, "end");
    const caret = start + (palette.mode === "link" ? text.length : item.caret != null ? item.caret : text.length);
    SCREEN.setSelectionRange(caret, caret);
    if (item.kind && metaField("kind")) metaField("kind").value = item.kind;
    closePalette();
    SCREEN.dispatchEvent(new Event("input", { bubbles: true }));
    SCREEN.focus();
    keepCaretVisible(true);
  }

  /* ---------- snapshots ---------- */

  const SNAP_KEY = "kawaii.snapshots.v1";
  const SNAP_MAX = 8;
  const SNAP_REASONS = { save: "保存", auto: "自动", load: "载入", "before-restore": "恢复前" };

  function readSnapshots() {
    try {
      const list = JSON.parse(localStorage.getItem(SNAP_KEY) || "[]");
      return Array.isArray(list) ? list.filter((item) => item && typeof item.body === "string") : [];
    } catch (error) {
      return [];
    }
  }

  function writeSnapshots(list) {
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify(list.slice(0, SNAP_MAX)));
    } catch (error) {
      /* a full storage must never block writing */
    }
  }

  function takeSnapshot(reason) {
    const body = SCREEN.value;
    if (!String(body).trim()) return;
    const list = readSnapshots();
    const meta = readMeta();
    if (list[0] && list[0].body === body && list[0].slug === (meta.slug || state.slug)) return;
    list.unshift({
      at: new Date().toISOString(),
      slug: state.slug,
      body,
      meta,
      reason: reason || "auto"
    });
    writeSnapshots(list);
    if (document.querySelector("[data-snapshots]")?.open) renderSnapshots();
  }

  function renderSnapshots() {
    const host = document.querySelector("[data-snapshots-list]");
    if (!host) return;
    const list = readSnapshots();
    if (!list.length) {
      host.innerHTML = `<li class="snapshots__empty">还没有快照。写点内容，或按 Ctrl+S 保存一次。</li>`;
      return;
    }
    host.innerHTML = list
      .map((snap, index) => {
        const time = new Date(snap.at);
        const pad = (value) => String(value).padStart(2, "0");
        const label = `${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
        const pending = state.restoreSnapshot === index;
        return `<li class="snapshots__item">
          <div class="snapshots__meta"><b>${escapeText(snap.slug || "untitled")}</b>
          <small>${label} · ${snap.body.length} 字 · ${SNAP_REASONS[snap.reason] || "自动"}</small></div>
          <button class="btn btn--small${pending ? " btn--primary" : ""}" type="button" data-snapshot-restore="${index}">${pending ? "确认恢复" : "恢复"}</button>
        </li>`;
      })
      .join("");
  }

  function setSnapshotStatus(text) {
    const node = document.querySelector("[data-snapshots-status]");
    if (node) node.textContent = text || "";
  }

  function restoreSnapshot(index) {
    const list = readSnapshots();
    const snap = list[index];
    if (!snap) return;
    if (state.restoreSnapshot !== index) {
      state.restoreSnapshot = index;
      renderSnapshots();
      setSnapshotStatus("再点一次「确认恢复」。当前内容会先存成一版快照。");
      return;
    }
    takeSnapshot("before-restore");
    SCREEN.value = snap.body;
    writeMeta(snap.meta || {});
    if (snap.slug) {
      state.slug = snap.slug;
      metaField("slug").value = snap.slug;
    }
    state.restoreSnapshot = -1;
    markDirty();
    renderFile();
    renderStatus();
    renderOutline();
    if (document.body.classList.contains("is-immersive") || document.getElementById("write-screen")) {
      SCREEN.focus();
    }
    setSnapshotStatus(`已恢复到 ${snap.slug || "未命名"} 的这一版。`);
    renderSnapshots();
  }

  function openSnapshots() {
    const dialog = document.querySelector("[data-snapshots]");
    if (!dialog) return;
    state.restoreSnapshot = -1;
    setSnapshotStatus("");
    renderSnapshots();
    if (!dialog.open) dialog.showModal();
  }

  /* ---------- image paste / drop ---------- */

  async function fileToPngDataUrl(file) {
    if (file.type === "image/png") {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(file);
      });
    }
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    if (bitmap.close) bitmap.close();
    return canvas.toDataURL("image/png");
  }

  async function uploadImage(file) {
    if (!file || !/^image\//.test(file.type || "")) return;
    setSaved("正在上传图片…", "ok");
    try {
      const dataUrl = await fileToPngDataUrl(file);
      const name = `paste-${Date.now().toString(36)}`;
      const response = await fetch("/api/asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, dataUrl })
      });
      if (response.status === 401) {
        if (window.KawaiiAuth) window.KawaiiAuth.require();
        throw new Error("作者未登录");
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "上传失败");
      const alt = String(file.name || "粘贴图片").replace(/\.[^.]+$/, "") || "粘贴图片";
      insertAtCaret(`![${alt}](${data.path})`);
      setSaved("图片已插入正文", "ok");
    } catch (error) {
      const hosted = !window.location.port || window.location.protocol === "https:";
      setSaved(
        hosted || /Failed to fetch|NetworkError/.test(error.message)
          ? "图片上传需要本地服务"
          : `图片上传失败：${error.message}`,
        "error"
      );
    }
  }

  function bindImageIntake() {
    SCREEN.addEventListener("paste", (event) => {
      const items = Array.from((event.clipboardData && event.clipboardData.items) || []);
      const image = items.find((item) => item.kind === "file" && /^image\//.test(item.type));
      if (!image) return;
      event.preventDefault();
      const file = image.getAsFile();
      if (file) uploadImage(file);
    });
    SCREEN.addEventListener("dragover", (event) => {
      const items = Array.from((event.dataTransfer && event.dataTransfer.items) || []);
      if (!items.some((item) => item.kind === "file" && /^image\//.test(item.type))) return;
      event.preventDefault();
      SCREEN.classList.add("is-dropping");
    });
    SCREEN.addEventListener("dragleave", () => SCREEN.classList.remove("is-dropping"));
    SCREEN.addEventListener("drop", (event) => {
      SCREEN.classList.remove("is-dropping");
      const file = Array.from((event.dataTransfer && event.dataTransfer.files) || []).find((item) =>
        /^image\//.test(item.type)
      );
      if (!file) return;
      event.preventDefault();
      uploadImage(file);
    });
  }

  function defaultSlug() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `note-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  }

  /* ---------- metadata form ---------- */

  function fillSelect(select, items, keep) {
    if (!select) return;
    select.innerHTML = items.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    if (keep && items.some(([value]) => value === keep)) select.value = keep;
  }

  function buildMetaForm() {
    fillSelect(metaField("kind"), KINDS);
    fillSelect(metaField("accent"), ACCENTS.map((name) => [name, name]));
    fillSelect(metaField("fx"), FX.map((name) => [name, name]));
    metaField("date").value = today();
    metaField("accent").value = "lime";
    metaField("fx").value = "reveal";

    for (const field of document.querySelectorAll("[data-meta]")) {
      field.addEventListener("input", () => {
        if (field.dataset.meta === "slug") {
          state.slug = field.value.trim();
          renderFile();
        }
        markDirty();
      });
    }
  }

  function readMeta() {
    const value = (name) => (metaField(name) ? metaField(name).value.trim() : "");
    return {
      title: value("title"),
      date: value("date") || today(),
      kind: value("kind") || "article",
      collection: value("collection"),
      summary: value("summary"),
      tags: value("tags").split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      accent: value("accent") || "lime",
      fx: value("fx") || "reveal",
      cover: value("cover")
    };
  }

  function writeMeta(meta) {
    for (const name of ["title", "date", "kind", "summary", "tags", "cover", "collection"]) {
      if (metaField(name) && meta[name] !== undefined) {
        metaField(name).value = Array.isArray(meta[name]) ? meta[name].join(", ") : meta[name];
      }
    }
    if (meta.accent) metaField("accent").value = meta.accent;
    if (meta.fx) metaField("fx").value = meta.fx;
    refreshMirrors();
  }

  /* ---------- screen status ---------- */

  function renderFile() {
    const label = document.querySelector("[data-write-file]");
    if (label) label.textContent = state.slug ? `${state.slug}.md` : "UNTITLED.MD";
  }

  function renderStatus() {
    const value = SCREEN.value;
    const caret = SCREEN.selectionStart;
    const before = value.slice(0, caret);
    const line = before.split("\n").length;
    const col = before.length - before.lastIndexOf("\n");
    const pos = document.querySelector("[data-write-pos]");
    const count = document.querySelector("[data-write-count]");
    const mode = document.querySelector("[data-write-mode]");
    const badge = document.querySelector("[data-write-state]");
    if (pos) pos.textContent = `LN ${line} · COL ${col}`;
    if (count) count.textContent = `${value.length} CHARS`;
    const wordsNode = document.querySelector("[data-write-words]");
    if (wordsNode) wordsNode.textContent = `${countWords(value)} 字 · ${readingMinutes(value)} MIN`;
    const selectionNode = document.querySelector("[data-write-selection]");
    if (selectionNode) {
      const selected = SCREEN.selectionEnd - SCREEN.selectionStart;
      selectionNode.hidden = selected <= 0;
      if (selected > 0) {
        selectionNode.textContent = `SEL ${countWords(value.slice(SCREEN.selectionStart, SCREEN.selectionEnd))} 字`;
      }
    }
    keepCaretVisibleSoon();
    syncOutlineActive();
    if (mode) {
      mode.textContent =
        state.mode === "edit"
          ? "EDIT / MD"
          : state.mode === "split"
            ? "SPLIT / MD + HTML"
            : state.mode === "map"
              ? "MAP / TREE"
              : "PREVIEW / HTML";
    }
    if (badge) {
      badge.textContent = state.dirty ? "DRAFT" : state.savedAt ? "SYNCED" : "NEW";
      badge.classList.toggle("is-dirty", state.dirty && !state.savedAt);
      badge.classList.toggle("is-live", !state.dirty);
    }
    scheduleDeskState();
  }

  // The portrait CRT reads the same feed, so only the window around the caret
  // travels: a whole note would outgrow the bus and blur the tiny screen.
  let deskTimer = 0;
  function deskSnapshot() {
    const value = SCREEN.value;
    const caret = SCREEN.selectionStart || 0;
    const before = value.slice(0, caret);
    return {
      title: (metaField("title") && metaField("title").value.trim()) || "UNTITLED.MD",
      tail: before.split("\n").slice(-4).join("\n").slice(-260),
      line: before.split("\n").length,
      col: before.length - before.lastIndexOf("\n"),
      chars: value.length,
      caret,
      totalLines: value.split("\n").length,
      mode: state.mode,
      dirty: state.dirty,
      savedAt: state.savedAt
    };
  }

  function publishDeskState() {
    if (window.KawaiiDesk) window.KawaiiDesk.publish(deskSnapshot());
    scheduleLive();
  }

  function scheduleDeskState() {
    clearTimeout(deskTimer);
    deskTimer = setTimeout(publishDeskState, 160);
  }

  function liveButton() {
    return document.querySelector("[data-live-toggle]");
  }

  function syncLiveButton() {
    const button = liveButton();
    if (!button) return;
    button.setAttribute("aria-pressed", live.enabled ? "true" : "false");
    button.title = live.enabled
      ? "LIVE 已开启：公开标题与光标前 4 行；点击暂停"
      : "LIVE 已暂停：点击恢复公开写作";
  }

  async function pushLive() {
    if (!live.enabled || live.busy) return;
    live.busy = true;
    try {
      const response = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, state: deskSnapshot() })
      });
      if (response.status === 401 || response.status === 403) {
        // Keep the preference on; the auth event retries when the author
        // finishes setting up or logging in.
        setSaved("LIVE 等待作者登录", "error");
      }
    } catch (error) {
      /* static hosting or a stopped server: the local bus still works */
    } finally {
      live.busy = false;
    }
  }

  function scheduleLive() {
    if (!live.enabled) return;
    clearTimeout(live.timer);
    live.timer = setTimeout(pushLive, 700);
  }

  function setLiveEnabled(next) {
    live.enabled = Boolean(next);
    try { localStorage.setItem(LIVE_KEY, live.enabled ? "on" : "off"); } catch (error) {}
    syncLiveButton();
    if (!live.enabled) {
      clearTimeout(live.timer);
      const body = JSON.stringify({ enabled: false });
      const sent = navigator.sendBeacon && navigator.sendBeacon("/api/live", new Blob([body], { type: "application/json" }));
      if (!sent) {
        fetch("/api/live", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
      setSaved("LIVE 已暂停 · 草稿不再公开", "ok");
      return;
    }
    setSaved("LIVE 已开启 · 标题 + 光标前 4 行会公开", "ok");
    pushLive();
  }

  function setSaved(text, kind) {
    const node = document.querySelector("[data-write-saved]");
    if (!node) return;
    node.textContent = text;
    node.classList.toggle("is-saved", kind === "ok");
    node.classList.toggle("is-error", kind === "error");
    node.title = text;
  }

  function setLamp(name, on) {
    const lamp = document.querySelector(`[data-lamp="${name}"]`);
    if (lamp) lamp.classList.toggle("is-on", Boolean(on));
  }

  function markDirty() {
    state.dirty = true;
    state.previewStale = true;
    renderStatus();
    scheduleDraft();
    if (state.mode === "map") {
      clearTimeout(state.previewTimer);
      state.previewTimer = setTimeout(renderWriteMap, 220);
    } else if (state.mode !== 'edit') {
      clearTimeout(state.previewTimer);
      state.previewTimer = setTimeout(renderPreview, 220);
    }
  }

  /* ---------- drafts ---------- */

  function scheduleDraft() {
    clearTimeout(state.draftTimer);
    state.draftTimer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          slug: state.slug,
          meta: readMeta(),
          body: SCREEN.value,
          at: new Date().toISOString()
        }));
      } catch (error) {
        /* a full or blocked storage must not stop the editor */
      }
    }, 700);
  }

  function readDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed.body === "string" ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function dropDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (error) {}
  }

  /* ---------- preview ---------- */

  const VIEWS = ["edit", "split", "preview", "map"];

  function setMode(mode) {
    state.mode = VIEWS.includes(mode) ? mode : "edit";
    const screen = document.querySelector("[data-screen]");
    if (screen) screen.dataset.view = state.mode;
    SCREEN.hidden = state.mode === "preview" || state.mode === "map";
    PREVIEW.hidden = state.mode === "edit" || state.mode === "map";
    const mapNode = document.querySelector("[data-write-map]");
    if (mapNode) mapNode.hidden = state.mode !== "map";
    if (state.mode === "map") renderWriteMap();
    else if (state.mode !== "edit") renderPreview();
    const label = document.querySelector("[data-view-label]");
    if (label) {
      label.textContent =
        state.mode === "edit" ? "分屏" : state.mode === "split" ? "预览" : state.mode === "preview" ? "导图" : "编辑";
    }
    renderStatus();
    if (state.mode !== "preview" && state.mode !== "map") SCREEN.focus();
  }

  let writeMap = null;

  function renderWriteMap() {
    const host = document.querySelector("[data-write-map]");
    if (!host || !window.KawaiiMindmap) return;
    if (!writeMap) {
      writeMap = window.KawaiiMindmap.mount(host, {
        onSelect(node) {
          setSaved(`导图 · ${node.heading ? "标题" : "条目"} · 第 ${node.line + 1} 行`);
        },
        onLocate(node) {
          const lines = SCREEN.value.split("\n");
          let offset = 0;
          for (let i = 0; i < node.line && i < lines.length; i += 1) offset += lines[i].length + 1;
          setMode("edit");
          SCREEN.setSelectionRange(offset, offset);
          SCREEN.focus();
          keepCaretVisible(true);
        }
      });
    }
    writeMap.setSource(SCREEN.value, {
      title: metaField("title").value || "导图",
      slug: metaField("slug").value
    });
  }

  // Rendering locally keeps the preview alive on any static host, and keeps it
  // in step with the caret instead of waiting on a round trip.
  let previewToken = 0;

  function mountPreviewMaps() {
    if (!window.KawaiiMindmap || !PREVIEW) return;
    Array.from(PREVIEW.querySelectorAll(".mindmap-embed")).forEach((embed) => {
      const sourceNode = embed.querySelector(".mindmap-embed__source");
      const host = embed.querySelector(".mindmap-embed__host");
      if (!sourceNode || !host) return;
      sourceNode.hidden = true;
      const controller = window.KawaiiMindmap.mount(host, {});
      controller.setSource(sourceNode.textContent || "", { title: "导图预览", slug: state.slug });
    });
  }

  function renderPreview() {
    const body = SCREEN.value;
    const ratio = SCREEN.scrollTop / Math.max(1, SCREEN.scrollHeight - SCREEN.clientHeight);
    if (window.KawaiiMarkdown) {
      PREVIEW.innerHTML = window.KawaiiMarkdown.render(body) || '<p class="screen__empty">（空文档）</p>';
    }
    PREVIEW.scrollTop = ratio * Math.max(0, PREVIEW.scrollHeight - PREVIEW.clientHeight);
    state.previewStale = false;
    mountPreviewMaps();
    const token = ++previewToken;
    fetch("/api/note/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: state.slug, body })
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data || token !== previewToken || SCREEN.value !== body) return;
        const currentRatio = PREVIEW.scrollTop / Math.max(1, PREVIEW.scrollHeight - PREVIEW.clientHeight);
        PREVIEW.innerHTML = data.html || '<p class="screen__empty">（空文档）</p>';
        PREVIEW.scrollTop = currentRatio * Math.max(0, PREVIEW.scrollHeight - PREVIEW.clientHeight);
        mountPreviewMaps();
      })
      .catch(() => {
        /* static hosting keeps the local preview */
      });
  }

  function cycleView() {
    const next = VIEWS[(VIEWS.indexOf(state.mode) + 1) % VIEWS.length];
    setMode(next);
    setSaved(
      next === "edit" ? "EDIT / MD" : next === "split" ? "SPLIT VIEW" : next === "map" ? "MIND MAP" : "PREVIEW",
      "ok"
    );
  }

  /* ---------- compose / export ---------- */

  function quote(value) {
    const text = String(value == null ? "" : value).replace(/[\r\n]+/g, " ").trim();
    if (!text) return "";
    if (/^["']|: | #|^\s|\s$/.test(text)) return text.includes('"') ? `'${text}'` : `"${text}"`;
    return text;
  }

  function compose() {
    const meta = readMeta();
    const lines = [
      "---",
      `title: ${quote(meta.title)}`,
      `date: ${quote(meta.date)}`,
      `kind: ${quote(meta.kind)}`
    ];
    if (meta.summary) lines.push(`summary: ${quote(meta.summary)}`);
    if (meta.tags.length) lines.push(`tags: ${meta.tags.map(quote).join(", ")}`);
    for (const key of ["collection", "accent", "fx", "cover"]) {
      if (meta[key]) lines.push(`${key}: ${quote(meta[key])}`);
    }
    lines.push("---", "", SCREEN.value.replace(/\r\n/g, "\n").replace(/^\s*\n/, ""));
    return lines.join("\n");
  }

  function exportNote() {
    const text = compose();
    const name = `${state.slug || defaultSlug()}.md`;
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setSaved(`已导出 ${name}`, "ok");
  }

  /* ---------- save / load ---------- */

  function localProblem(meta) {
    if (!meta.title) return "标题不能为空";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) return "日期必须是 YYYY-MM-DD";
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(state.slug)) return "SLUG 只能用小写字母、数字和连字符";
    return "";
  }

  async function save({ overwrite = false } = {}) {
    const meta = readMeta();
    const problem = localProblem(meta);
    if (problem) {
      setSaved(problem, "error");
      (problem.includes("标题") ? metaField("title") : problem.includes("SLUG") ? metaField("slug") : metaField("date")).focus();
      return { ok: false, error: problem };
    }
    setLamp("io", true);
    setSaved("SAVING…");
    try {
      const response = await fetch("/api/note/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: state.slug, meta, body: SCREEN.value, overwrite })
      });
      if (response.status === 409) {
        setLamp("io", false);
        setSaved("文件已存在", "error");
        if (window.confirm(`notes/${state.slug}.md 已经存在，要覆盖它吗？`)) {
          return save({ overwrite: true });
        }
        return { ok: false, code: "exists" };
      }
      if (response.status === 401) {
        setLamp("io", false);
        setSaved("作者未登录，先解锁写作台", "error");
        if (window.KawaiiAuth) window.KawaiiAuth.require();
        return { ok: false, code: "auth" };
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `保存失败 HTTP ${response.status}`);
      const warnings = result.build && result.build.ok === false ? "（重建失败，检查终端）" : "";
      state.dirty = false;
      state.savedAt = new Date().toISOString();
      dropDraft();
      takeSnapshot("save");
      renderStatus();
      setSaved(`已保存 ${clock()}${warnings}`, warnings ? "error" : "ok");
      return { ok: true, result };
    } catch (error) {
      const hosted = !window.location.port || window.location.protocol === "https:";
      setSaved(hosted ? "保存需要本地预览服务" : `保存失败：${error.message}`, "error");
      return { ok: false, error: error.message };
    } finally {
      setLamp("io", false);
    }
  }

  async function loadSlug(slug) {
    if (!slug) {
      state.slug = defaultSlug();
      metaField("slug").value = state.slug;
      SCREEN.value = "";
      writeMeta({ title: "", date: today(), kind: "article", tags: [], accent: "lime", fx: "reveal" });
      state.dirty = false;
      state.savedAt = null;
      state.previewStale = true;
      renderFile();
      renderStatus();
      setSaved("新笔记");
      setMode("edit");
      return { ok: true };
    }
    setSaved("LOADING…");
    try {
      const response = await fetch(`/api/note?slug=${encodeURIComponent(slug)}`);
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
      state.slug = slug;
      metaField("slug").value = slug;
      writeMeta(result.meta);
      SCREEN.value = result.body;
      state.dirty = false;
      state.savedAt = new Date().toISOString();
      state.previewStale = true;
      takeSnapshot("load");
      renderFile();
      renderStatus();
      setSaved("已载入", "ok");
      setMode("edit");
      return { ok: true, result };
    } catch (error) {
      setSaved(`载入失败：${error.message}`, "error");
      return { ok: false, error: error.message };
    }
  }

  async function loadIndex() {
    const select = document.querySelector("[data-write-load]");
    if (!select) return;
    try {
      const response = await fetch("/api/notes");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { notes } = await response.json();
      select.innerHTML = ['<option value="">— 新笔记 —</option>']
        .concat(notes.map((note) => `<option value="${note.slug}">${note.date} · ${note.title}</option>`))
        .join("");
      select.disabled = false;
      select.onchange = () => {
        if (state.dirty && !window.confirm("当前还没保存，切换会丢掉改动。继续吗？")) {
          select.value = state.slug;
          return;
        }
        loadSlug(select.value);
      };
    } catch (error) {
      select.innerHTML = '<option value="">作者解锁后可载入笔记</option>';
      select.disabled = true;
    }
  }

  function newNote() {
    if (state.dirty && !window.confirm("当前还没保存，新建会丢掉改动。继续吗？")) return;
    state.slug = defaultSlug();
    metaField("slug").value = state.slug;
    SCREEN.value = "";
    renderFile();
    loadSlug("");
  }

  /* ---------- AI ---------- */

  function aiTarget() {
    const start = SCREEN.selectionStart;
    const end = SCREEN.selectionEnd;
    if (end > start) return { start, end, text: SCREEN.value.slice(start, end) };
    return { start: 0, end: SCREEN.value.length, text: SCREEN.value };
  }

  function replaceRange(start, end, text) {
    SCREEN.focus();
    SCREEN.setSelectionRange(start, end);
    let native = false;
    try {
      native = document.execCommand("insertText", false, text);
    } catch (error) {
      native = false;
    }
    if (!native) {
      SCREEN.setRangeText(text, start, end, "end");
      SCREEN.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function panelButtons() {
    return {
      accept: document.querySelector("[data-ai-accept]"),
      ignore: document.querySelector("[data-ai-ignore]"),
      undo: document.querySelector("[data-ai-undo]"),
      configure: document.querySelector("[data-ai-configure]"),
      compare: document.querySelector("[data-ai-compare]"),
      hunks: document.querySelector("[data-ai-hunks]"),
      body: document.querySelector("[data-ai-body]"),
      config: document.querySelector("[data-ai-config]"),
      status: document.querySelector("[data-ai-status]"),
      error: document.querySelector("[data-ai-error]")
    };
  }

  function show(node, visible) {
    if (node) node.hidden = !visible;
  }

  function renderConfig() {
    const ui = panelButtons();
    const config = window.KawaiiAI.load();
    show(ui.config, true);
    show(ui.body, false);
    show(ui.accept, false);
    show(ui.ignore, false);
    show(ui.configure, true);
    ui.configure.textContent = "保存配置";
    document.querySelector('[data-ai-field="endpoint"]').value = config.endpoint;
    document.querySelector('[data-ai-field="model"]').value = config.model;
    document.querySelector('[data-ai-field="key"]').value = config.key;
    document.querySelector('[data-ai-field="remember"]').checked = config.remember;
    show(ui.error, false);
    document.querySelector('[data-ai-field="endpoint"]').focus();
  }

  function readConfigForm() {
    return {
      endpoint: document.querySelector('[data-ai-field="endpoint"]').value.trim(),
      model: document.querySelector('[data-ai-field="model"]').value.trim(),
      key: document.querySelector('[data-ai-field="key"]').value.trim(),
      remember: document.querySelector('[data-ai-field="remember"]').checked
    };
  }

  function aiStatus(text) {
    const ui = panelButtons();
    show(ui.status, Boolean(text));
    ui.status.textContent = text || "";
  }

  function aiError(text) {
    const ui = panelButtons();
    show(ui.error, Boolean(text));
    show(ui.config, Boolean(text) && !window.KawaiiAI.configured());
    if (text) ui.error.textContent = text;
  }

  async function runAI(mode) {
    panel.mode = mode;
    panel.target = aiTarget();
    panel.snapshot = SCREEN.value;
    panel.result = null;
    panel.hunks = [];
    document.querySelector("[data-ai-title]").textContent = mode === "polish" ? "润色" : "纠错";
    const ui = panelButtons();
    show(ui.compare, false);
    show(ui.hunks, false);
    show(ui.accept, false);
    show(ui.ignore, true);
    show(ui.configure, true);
    if (window.KawaiiAI.configured()) {
      show(ui.config, false);
      show(ui.body, true);
    }
    ui.configure.textContent = "配置 AI";
    show(ui.undo, Boolean(panel.previous));
    aiError("");
    if (!panelEl.open) panelEl.showModal();
    if (!window.KawaiiAI.configured()) {
      aiStatus("");
      renderConfig();
      return;
    }
    if (!panel.target.text.trim()) {
      aiStatus("先写点内容，再让 AI 帮手。");
      return;
    }
    aiStatus(mode === "polish" ? "润色中…（只在你确认后才替换正文）" : "校对中…（只会给出清单，不自动改）");
    try {
      if (mode === "polish") {
        panel.result = await window.KawaiiAI.polish(panel.target.text);
        document.querySelector("[data-ai-old]").textContent = panel.target.text;
        document.querySelector("[data-ai-new]").textContent = panel.result;
        show(ui.compare, true);
        show(ui.accept, true);
        aiStatus("左右对照一下，采用后会替换选中的那段。");
      } else {
        panel.hunks = await window.KawaiiAI.proofread(panel.target.text);
        if (!panel.hunks.length) {
          aiStatus("没找到确定的问题。");
          return;
        }
        ui.hunks.innerHTML = panel.hunks
          .map((hunk, index) => `<li data-hunk="${index}"${hunk.count !== 1 ? ' class="is-taken"' : ""}>
            <div><del>${escapeText(hunk.find)}</del> → <ins>${escapeText(hunk.replace)}</ins></div>
            <button class="btn" type="button" data-hunk-take="${index}"${hunk.count !== 1 ? " disabled" : ""}>采用</button>
            <small>${escapeText(hunk.reason)}${hunk.count !== 1 ? `（原文里出现 ${hunk.count} 次，需手动改）` : ""}</small>
          </li>`)
          .join("");
        show(ui.hunks, true);
        aiStatus(`找到 ${panel.hunks.length} 处，逐条采用。`);
      }
    } catch (error) {
      aiStatus("");
      aiError(error.message);
    }
  }

  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function guardSnapshot() {
    if (SCREEN.value === panel.snapshot) return true;
    aiError("正文在生成期间被改过了，为了不覆盖你的新内容，请重新生成。");
    return false;
  }

  function afterApply(message) {
    const ui = panelButtons();
    markDirty();
    renderStatus();
    aiStatus(message);
    show(ui.accept, false);
    show(ui.compare, false);
    show(ui.hunks, false);
    show(ui.undo, true);
  }

  function acceptPolish() {
    if (!panel.result || !guardSnapshot()) return;
    panel.previous = SCREEN.value;
    replaceRange(panel.target.start, panel.target.start + panel.target.text.length, panel.result);
    afterApply("已采用，可以用 Ctrl + Z 或下面的撤销回退。");
  }

  function acceptHunk(index) {
    const hunk = panel.hunks[index];
    if (!hunk || !guardSnapshot()) return;
    const at = SCREEN.value.indexOf(hunk.find);
    if (at === -1) {
      aiStatus("这一段已经不在正文里了。");
      return;
    }
    panel.previous = panel.previous || SCREEN.value;
    replaceRange(at, at + hunk.find.length, hunk.replace);
    panel.snapshot = SCREEN.value;
    const item = document.querySelector(`[data-hunk="${index}"]`);
    if (item) {
      item.classList.add("is-taken");
      const button = item.querySelector("[data-hunk-take]");
      if (button) button.disabled = true;
    }
    markDirty();
    renderStatus();
    aiStatus("已改一处，继续或关掉面板。");
    show(panelButtons().undo, true);
  }

  function undoAI() {
    if (!panel.previous) return;
    const target = panel.previous;
    panel.previous = null;
    panel.snapshot = SCREEN.value;
    replaceRange(0, SCREEN.value.length, target);
    markDirty();
    renderStatus();
    aiStatus("已撤销上一次采用。");
    show(panelButtons().undo, false);
  }

  /* ---------- cover import ---------- */

  const coverState = { source: null };

  function fitSource(image) {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 176;
    const ctx = canvas.getContext("2d");
    const scale = Math.max(320 / image.naturalWidth, 176 / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, (320 - w) / 2, (176 - h) / 2, w, h);
    return canvas;
  }

  function pixelate(source, block, colors) {
    const columns = Math.max(8, Math.round(320 / block));
    const rows = Math.max(5, Math.round(176 / block));
    const small = document.createElement("canvas");
    small.width = columns;
    small.height = rows;
    const sctx = small.getContext("2d");
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(source, 0, 0, columns, rows);

    const frame = sctx.getImageData(0, 0, columns, rows);
    const levels = Math.min(8, Math.max(2, Math.round(colors)));
    const step = 255 / (levels - 1);
    for (let i = 0; i < frame.data.length; i += 4) {
      frame.data[i] = Math.round(frame.data[i] / step) * step;
      frame.data[i + 1] = Math.round(frame.data[i + 1] / step) * step;
      frame.data[i + 2] = Math.round(frame.data[i + 2] / step) * step;
    }
    sctx.putImageData(frame, 0, 0);

    const out = document.createElement("canvas");
    out.width = 320;
    out.height = 176;
    const octx = out.getContext("2d");
    octx.imageSmoothingEnabled = false;
    octx.drawImage(small, 0, 0, 320, 176);
    return out;
  }

  function renderCoverPreview() {
    if (!coverState.source) return;
    const block = Number(document.querySelector("[data-cover-pixel]").value) || 4;
    const colors = Number(document.querySelector("[data-cover-colors]").value) || 4;
    const generated = pixelate(coverState.source, block, colors);
    const canvas = document.querySelector("[data-cover-canvas]");
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(generated, 0, 0);
  }

  function bindCoverImport() {
    const file = document.querySelector("[data-cover-file]");
    const panel = document.querySelector("[data-cover-import]");
    if (!file || !panel) return;
    for (const selector of ["[data-cover-pixel]", "[data-cover-colors]"]) {
      document.querySelector(selector).addEventListener("input", renderCoverPreview);
    }
    file.addEventListener("change", () => {
      const chosen = file.files && file.files[0];
      if (!chosen) return;
      const url = URL.createObjectURL(chosen);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        coverState.source = fitSource(image);
        panel.hidden = false;
        renderCoverPreview();
        document.querySelector("[data-cover-hint]").textContent = "拖动滑杆调颗粒，满意再上传。";
      };
      image.src = url;
    });

    document.querySelector("[data-cover-apply]").addEventListener("click", async () => {
      const hint = document.querySelector("[data-cover-hint]");
      if (!coverState.source) {
        hint.textContent = "先选一张图片。";
        return;
      }
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(state.slug)) {
        hint.textContent = "先把 SLUG 改成小写字母/数字/连字符。";
        return;
      }
      const dataUrl = document.querySelector("[data-cover-canvas]").toDataURL("image/png");
      hint.textContent = "上传中…";
      try {
        const response = await fetch("/api/asset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: state.slug, dataUrl })
        });
        if (response.status === 401) {
          if (window.KawaiiAuth) window.KawaiiAuth.require();
          throw new Error("作者未登录");
        }
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
        const select = metaField("cover");
        let option = select.querySelector(`option[value="${result.path}"]`);
        if (!option) {
          option = document.createElement("option");
          option.value = result.path;
          option.textContent = `自定义：${result.path.split("/").pop()}`;
          select.appendChild(option);
        }
        select.value = result.path;
        markDirty();
        hint.textContent = `已设为封面（${Math.round(result.bytes / 1024)} KB）`;
      } catch (error) {
        hint.textContent = /Failed to fetch|NetworkError/.test(error.message)
          ? "上传需要本地服务：node tools/serve.js"
          : `上传失败：${error.message}`;
      }
    });
  }

  /* ---------- wiring ---------- */

  const ACTIONS = {
    view: () => cycleView(),
    save: () => save(),
    polish: () => runAI("polish"),
    proofread: () => runAI("proofread"),
    export: () => exportNote(),
    fullscreen: () => toggleImmersive(),
    new: () => newNote(),
    typewriter: () => toggleTypewriter(),
    focus: () => toggleFocus(),
    outline: () => toggleOutline()
  };

  function fnActiveCount() {
    return [
      state.typewriter,
      state.outline,
      document.body.classList.contains("is-focus"),
      document.body.classList.contains("is-immersive")
    ].filter(Boolean).length;
  }

  function syncFnLed() {
    if (!FN.button) return;
    const active = fnActiveCount();
    FN.button.classList.toggle("has-mode", active > 0);
    FN.button.dataset.active = String(active);
    FN.button.title = active ? `${active} 个扩展功能开启；F5–F10` : "展开功能键 F5–F10";
    if (FN.led) FN.led.classList.toggle("is-on", active > 0);
  }

  function setFn(open, options = {}) {
    if (!FN.panel || !FN.button) return;
    FN.open = Boolean(open);
    FN.panel.hidden = !FN.open;
    FN.button.setAttribute("aria-expanded", FN.open ? "true" : "false");
    document.body.classList.toggle("fn-open", FN.open);
    syncFnLed();
    if (FN.open) {
      const first = FN.panel.querySelector(".fn-key");
      window.requestAnimationFrame(() => {
        if (first) first.focus({ preventScroll: true });
      });
    } else if (options.restore !== false) {
      FN.button.focus({ preventScroll: true });
    }
  }

  function act(name) {
    const action = ACTIONS[name];
    if (action) action();
  }

  function bindKeys() {
    const fKeys = {
      F1: "view",
      F2: "save",
      F3: "polish",
      F4: "proofread",
      F5: "export",
      F6: "fullscreen",
      F7: "new",
      F8: "typewriter",
      F9: "focus",
      F10: "outline"
    };
    const altKeys = {
      1: "view",
      2: "save",
      3: "polish",
      4: "proofread",
      5: "export",
      6: "fullscreen",
      7: "new",
      8: "typewriter",
      9: "focus",
      0: "outline"
    };
    document.addEventListener("keydown", (event) => {
      if (state.palette.open) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          movePalette(event.key === "ArrowDown" ? 1 : -1);
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          choosePalette();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closePalette();
          return;
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
        return;
      }
      if (fKeys[event.key] && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (FN.open && ["F5", "F6", "F7"].includes(event.key)) setFn(false, { restore: false });
        act(fKeys[event.key]);
        return;
      }
      if (event.altKey && altKeys[event.key]) {
        event.preventDefault();
        act(altKeys[event.key]);
        return;
      }
      if (event.key === "Escape" && FN.open) {
        event.preventDefault();
        setFn(false);
        return;
      }
      if (event.key === "Escape" && document.body.classList.contains("is-immersive")) {
        toggleImmersive(false);
        return;
      }
      if (event.key === "Escape" && document.body.classList.contains("is-focus")) {
        toggleFocus(false);
      }
    });
  }

  /* ---------- screen look ---------- */

  const SCREEN_KEY = "kawaii.screen.v1";
  const FONTS = [
    ["pixel", "像素"],
    ["mono", "等宽"],
    ["read", "衬线"]
  ];
  const GLOWS = [
    ["green", "绿"],
    ["amber", "琥珀"],
    ["white", "白"]
  ];
  const FONT_SIZES = { pixel: 13, mono: 15, read: 16 };

  function readLook() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SCREEN_KEY) || "{}");
      const size = Number(parsed.fontSize);
      return {
        font: FONTS.some(([id]) => id === parsed.font) ? parsed.font : "pixel",
        glow: GLOWS.some(([id]) => id === parsed.glow) ? parsed.glow : "green",
        typewriter: parsed.typewriter === true,
        fontSize: Number.isFinite(size) ? Math.min(24, Math.max(12, Math.round(size))) : null
      };
    } catch (error) {
      return { font: "pixel", glow: "green", typewriter: false, fontSize: null };
    }
  }

  function applyLook(look) {
    const screen = document.querySelector("[data-screen]");
    if (!screen) return;
    const size = Math.min(24, Math.max(12, Number(look.fontSize) || FONT_SIZES[look.font] || 14));
    screen.dataset.screenFont = look.font;
    screen.dataset.screenGlow = look.glow;
    screen.dataset.typewriter = look.typewriter ? "on" : "off";
    screen.style.setProperty("--editor-size", `${size}px`);
    state.typewriter = Boolean(look.typewriter);
    const fontLabel = document.querySelector("[data-screen-font-label]");
    const glowLabel = document.querySelector("[data-screen-glow-label]");
    const sizeLabel = document.querySelector("[data-screen-size-label]");
    if (fontLabel) fontLabel.textContent = (FONTS.find(([id]) => id === look.font) || FONTS[0])[1];
    if (glowLabel) glowLabel.textContent = (GLOWS.find(([id]) => id === look.glow) || GLOWS[0])[1];
    if (sizeLabel) sizeLabel.textContent = `${size}px`;
    const typeButton = document.querySelector('[data-write-action="typewriter"]');
    if (typeButton) typeButton.setAttribute("aria-pressed", state.typewriter ? "true" : "false");
    syncFnLed();
    try {
      localStorage.setItem(SCREEN_KEY, JSON.stringify({ ...look, fontSize: size }));
    } catch (error) {
      /* the look still applies for this page */
    }
  }

  function toggleTypewriter() {
    const look = readLook();
    applyLook({ ...look, typewriter: !look.typewriter });
    setSaved(state.typewriter ? "打字机滚动已开启" : "打字机滚动已关闭", "ok");
    if (state.typewriter) keepCaretVisible(true);
    SCREEN.focus();
  }

  function toggleFocus(force) {
    const next = force === undefined ? !document.body.classList.contains("is-focus") : Boolean(force);
    if (next && document.body.classList.contains("is-immersive")) toggleImmersive(false);
    document.body.classList.toggle("is-focus", next);
    const button = document.querySelector('[data-write-action="focus"]');
    if (button) button.setAttribute("aria-pressed", next ? "true" : "false");
    syncFnLed();
    setSaved(next ? "焦点模式 · Esc 退出" : "已退出焦点模式", "ok");
    SCREEN.focus();
  }

  function bindScreenLook() {
    applyLook(readLook());

    const cycleFont = () => {
      const look = readLook();
      const index = FONTS.findIndex(([id]) => id === look.font);
      applyLook({ ...look, font: FONTS[(index + 1) % FONTS.length][0] });
    };
    const cycleGlow = () => {
      const look = readLook();
      const index = GLOWS.findIndex(([id]) => id === look.glow);
      applyLook({ ...look, glow: GLOWS[(index + 1) % GLOWS.length][0] });
    };
    const adjustSize = (delta) => {
      const look = readLook();
      const base = look.fontSize || FONT_SIZES[look.font] || 14;
      applyLook({ ...look, fontSize: Math.min(24, Math.max(12, base + delta)) });
      keepCaretVisible(true);
    };

    document.querySelector("[data-screen-font]").addEventListener("click", cycleFont);
    document.querySelector("[data-screen-glow]").addEventListener("click", cycleGlow);
    const down = document.querySelector("[data-screen-size-down]");
    const up = document.querySelector("[data-screen-size-up]");
    if (down) down.addEventListener("click", () => adjustSize(-1));
    if (up) up.addEventListener("click", () => adjustSize(1));
  }

  /* ---------- immersive ---------- */

  async function toggleImmersive(force) {
    const next = force === undefined ? !document.body.classList.contains("is-immersive") : Boolean(force);
    document.body.classList.toggle("is-immersive", next);
    try {
      if (next && document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else if (!next && document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch (error) {
      /* the class alone still gives a full-window desk when the API is blocked */
    }
    const fullButton = document.querySelector('[data-write-action="fullscreen"]');
    const label = fullButton && fullButton.querySelector("span");
    if (label) label.textContent = next ? "退出全屏" : "全屏";
    if (fullButton) fullButton.setAttribute("aria-pressed", next ? "true" : "false");
    syncFnLed();
    setSaved(next ? "IMMERSIVE · Esc 退出" : "已退出全屏", "ok");
    SCREEN.focus();
  }

  function syncMirrors() {
    for (const name of ["title", "collection", "date"]) {
      const source = metaField(name);
      const mirror = document.querySelector(`[data-meta-mirror="${name}"]`);
      if (!source || !mirror) continue;
      mirror.addEventListener("input", () => {
        source.value = mirror.value;
        source.dispatchEvent(new Event("input", { bubbles: true }));
      });
      source.addEventListener("input", () => {
        if (mirror.value !== source.value) mirror.value = source.value;
      });
      mirror.value = source.value;
    }
  }

  function refreshMirrors() {
    for (const name of ["title", "collection", "date"]) {
      const source = metaField(name);
      const mirror = document.querySelector(`[data-meta-mirror="${name}"]`);
      if (source && mirror) mirror.value = source.value;
    }
  }

  function bind() {
    buildMetaForm();
    bindKeys();
    bindScreenLook();
    bindCoverImport();
    syncMirrors();

    const tagSuggest = document.querySelector("[data-tag-suggest]");
    if (tagSuggest) {
      tagSuggest.addEventListener("click", (event) => {
        const button = event.target.closest("[data-tag-add]");
        if (!button) return;
        const field = metaField("tags");
        if (!field) return;
        const tags = field.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
        const name = button.dataset.tagAdd;
        if (!tags.includes(name)) {
          tags.push(name);
          field.value = tags.join(", ");
          field.dispatchEvent(new Event("input", { bubbles: true }));
        }
        field.focus();
      });
    }

    bindImageIntake();
    bindInbox();
    document.querySelectorAll("[data-float-open]").forEach((button) => {
      if (!button.closest("[data-write-inbox]")) button.addEventListener("click", openFloat);
    });
    document.addEventListener("kawaii:auth", (event) => {
      if (event.detail && event.detail.authed) loadIndex();
    });
    document.addEventListener("kawaii:write-insert", (event) => {
      const markdown = event.detail && event.detail.markdown;
      if (!markdown) return;
      insertAtCaret(String(markdown).endsWith("\n") ? String(markdown) : `${markdown}\n`);
      setSaved("AI 已插入内容块", "ok");
    });
    document.addEventListener("kawaii:write-style", (event) => {
      const detail = event.detail || {};
      const accent = metaField("accent");
      const fx = metaField("fx");
      const cover = metaField("cover");
      if (detail.accent && accent) accent.value = detail.accent;
      if (detail.fx && fx) fx.value = detail.fx;
      if (detail.cover && cover) {
        if (!cover.querySelector(`option[value="${detail.cover}"]`)) {
          const option = document.createElement("option");
          option.value = detail.cover;
          option.textContent = detail.cover;
          cover.appendChild(option);
        }
        cover.value = detail.cover;
      }
      refreshMirrors();
      markDirty();
      setSaved("AI 已更新样式", "ok");
    });
    const aiCreate = document.querySelector("[data-write-ai-create]");
    if (aiCreate) {
      aiCreate.addEventListener("click", () => {
        if (window.KawaiiAgent) window.KawaiiAgent.open();
        else setSaved("AI 模块没有加载", "error");
      });
    }

    const snapshotsDialog = document.querySelector("[data-snapshots]");
    const snapshotsOpen = document.querySelector("[data-snapshots-open]");
    if (snapshotsOpen) snapshotsOpen.addEventListener("click", openSnapshots);
    if (snapshotsDialog) {
      const closeSnapshots = () => snapshotsDialog.close();
      const closeButton = snapshotsDialog.querySelector("[data-snapshots-close]");
      if (closeButton) closeButton.addEventListener("click", closeSnapshots);
      snapshotsDialog.addEventListener("click", (event) => {
        if (event.target === snapshotsDialog) closeSnapshots();
      });
      snapshotsDialog.addEventListener("close", () => {
        state.restoreSnapshot = -1;
        setSnapshotStatus("");
      });
      const list = snapshotsDialog.querySelector("[data-snapshots-list]");
      if (list) {
        list.addEventListener("click", (event) => {
          const button = event.target.closest("[data-snapshot-restore]");
          if (button) restoreSnapshot(Number(button.dataset.snapshotRestore));
        });
      }
    }

    const outlineList = document.querySelector("[data-outline-list]");
    if (outlineList) {
      outlineList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-outline-index]");
        if (!button) return;
        const index = Number(button.dataset.outlineIndex);
        SCREEN.setSelectionRange(index, index);
        SCREEN.focus();
        keepCaretVisible(true);
        renderStatus();
      });
    }
    const outlineClose = document.querySelector("[data-outline-close]");
    if (outlineClose) outlineClose.addEventListener("click", () => toggleOutline(false));

    const paletteHost = document.querySelector("[data-write-palette]");
    if (paletteHost) {
      paletteHost.addEventListener("click", (event) => {
        const button = event.target.closest("[data-palette-index]");
        if (button) choosePalette(Number(button.dataset.paletteIndex));
      });
    }

    SCREEN.addEventListener("input", () => {
      markDirty();
      detectPalette();
      renderOutlineSoon();
    });
    for (const event of ["click", "keyup", "select"]) {
      SCREEN.addEventListener(event, renderStatus);
    }
    SCREEN.addEventListener("keyup", detectPalette);
    SCREEN.addEventListener("click", detectPalette);
    document.addEventListener("kawaii:skinchange", () => {
      if (state.mode === "map" && writeMap) writeMap.render();
    });

    // Ratio-based sync: exact line anchoring drifts on wrapped CJK anyway, and a
    // shared scroll ratio is what readers of split editors already expect.
    let scrollLock = 0;
    const linkScroll = (from, to) => {
      from.addEventListener("scroll", () => {
        if (state.mode !== "split") return;
        const now = performance.now();
        if (now - scrollLock < 80) return;
        scrollLock = now;
        const span = Math.max(1, from.scrollHeight - from.clientHeight);
        to.scrollTop = (from.scrollTop / span) * Math.max(0, to.scrollHeight - to.clientHeight);
      });
    };
    linkScroll(SCREEN, PREVIEW);
    linkScroll(PREVIEW, SCREEN);
    document.querySelectorAll("[data-write-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const name = button.dataset.writeAction;
        if (FN.open && ["export", "fullscreen", "new"].includes(name)) setFn(false, { restore: false });
        act(name);
      });
    });

    if (FN.button) {
      FN.button.addEventListener("click", () => setFn(!FN.open));
    }
    if (FN.panel) {
      FN.panel.addEventListener("click", (event) => {
        if (event.target.closest("[data-fn-close]")) {
          event.preventDefault();
          setFn(false);
        }
      });
    }
    document.addEventListener("pointerdown", (event) => {
      if (!FN.open) return;
      if (event.target.closest("[data-fn-deck]") || event.target.closest("[data-fn-open]")) return;
      setFn(false, { restore: false });
    });
    syncFnLed();

    const liveToggle = liveButton();
    if (liveToggle) liveToggle.addEventListener("click", () => setLiveEnabled(!live.enabled));
    syncLiveButton();
    if (live.enabled) {
      clearInterval(live.heartbeat);
      live.heartbeat = window.setInterval(() => {
        if (live.enabled && !document.hidden) pushLive();
      }, 15000);
      window.setTimeout(pushLive, 900);
    }
    document.addEventListener("kawaii:auth", (event) => {
      if (event.detail && event.detail.authed && live.enabled) pushLive();
    });
    window.addEventListener("pagehide", () => {
      if (!live.enabled) return;
      const body = JSON.stringify({ enabled: false });
      if (navigator.sendBeacon) navigator.sendBeacon("/api/live", new Blob([body], { type: "application/json" }));
    });

    const ui = panelButtons();
    ui.configure.addEventListener("click", () => {
      if (ui.config.hidden) {
        renderConfig();
        return;
      }
      const config = readConfigForm();
      if (!config.endpoint || !config.model || !config.key) {
        aiError("三项都要填：接口地址、模型名、API Key。");
        return;
      }
      window.KawaiiAI.save(config);
      aiError("");
      show(ui.config, false);
      runAI(panel.mode);
    });
    ui.accept.addEventListener("click", acceptPolish);
    ui.ignore.addEventListener("click", () => panelEl.close());
    document.querySelector("[data-ai-close]").addEventListener("click", () => panelEl.close());
    ui.undo.addEventListener("click", undoAI);
    ui.hunks.addEventListener("click", (event) => {
      const button = event.target.closest("[data-hunk-take]");
      if (button && !button.disabled) acceptHunk(Number(button.dataset.hunkTake));
    });
    panelEl.addEventListener("close", () => {
      show(ui.error, false);
    });

    const screen = document.querySelector("[data-screen]");
    if (screen && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      screen.classList.add("is-on");
    }
  }

  function fillCollections() {
    const list = document.querySelector("#collection-options");
    if (!list) return;
    const names = new Set(((window.NOTES_META && window.NOTES_META.collections) || []).map((item) => item.name));
    for (const note of (window.Kawaii && window.Kawaii.notes.all) || []) {
      if (note.collection) names.add(note.collection);
    }
    list.innerHTML = [...names].map((name) => `<option value="${escapeText(name)}"></option>`).join("");
  }

  function fillTags() {
    const list = document.querySelector("#tag-options");
    const host = document.querySelector("[data-tag-suggest]");
    const names = new Set(((window.NOTES_META && window.NOTES_META.tags) || []).map((item) => item.name));
    for (const note of (window.Kawaii && window.Kawaii.notes.all) || []) {
      for (const tag of note.tags || []) names.add(tag);
    }
    if (list) {
      list.innerHTML = [...names].map((name) => `<option value="${escapeText(name)}"></option>`).join("");
    }
    if (!host) return;
    const ranked = window.Kawaii && window.Kawaii.notes && window.Kawaii.notes.tags
      ? window.Kawaii.notes.tags().slice(0, 12)
      : [...names].slice(0, 12).map((name) => ({ name, count: 0 }));
    host.innerHTML = ranked.length
      ? `<span class="field__suggest-label">常用标签</span>${ranked
        .map((tag) => `<button class="chip chip--tiny" type="button" data-tag-add="${escapeText(tag.name)}">${escapeText(tag.name)} <span aria-hidden="true">/</span> ${tag.count}</button>`)
        .join("")}`
      : "";
  }

  const CLIPS = window.KawaiiClips;
  const CLIP_LABELS = { text: "TXT", image: "IMG", link: "LINK", file: "FILE" };

  function renderInbox() {
    const host = document.querySelector("[data-write-inbox]");
    if (!host) return;
    const clips = CLIPS ? CLIPS.read() : [];
    if (!clips.length) {
      host.innerHTML = `<div class="inbox__empty">
  <p>素材箱是空的。打开悬浮共写，把截图、文本或链接拖进小电视，它们会出现在这里。</p>
  <button class="btn btn--small" type="button" data-float-open>打开悬浮共写</button>
</div>`;
      return;
    }
    host.innerHTML =
      clips
        .map((clip) => {
          const time = new Date(clip.at);
          const pad = (value) => String(value).padStart(2, "0");
          const stamp = `${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
          const preview =
            clip.kind === "image"
              ? `<img class="inbox__thumb" src="${escapeText(clip.url)}" alt="${escapeText(clip.title || "截图")}" loading="lazy">`
              : `<p class="inbox__text">${escapeText((clip.text || clip.url || "").slice(0, 180))}</p>`;
          return `<article class="inbox__item" data-clip-id="${escapeText(clip.id)}" data-clip-kind="${escapeText(clip.kind)}">
  <div class="inbox__top"><span class="inbox__kind">${CLIP_LABELS[clip.kind] || "TXT"}</span><span class="inbox__time">${stamp}</span></div>
  <h3 class="inbox__title">${escapeText(clip.title || "未命名素材")}</h3>
  ${preview}
  <div class="inbox__actions">
    <button class="res-action" type="button" data-clip-insert>插入</button>
    <button class="res-action" type="button" data-clip-copy>复制</button>
    <button class="res-action res-action--danger" type="button" data-clip-remove>删除</button>
  </div>
</article>`;
        })
        .join("") + `<div class="inbox__foot"><button class="res-action" type="button" data-clip-clear>清空素材箱</button></div>`;
  }

  function insertClip(clip) {
    if (!clip) return;
    if (clip.kind === "image") insertAtCaret(`![${clip.title || "截图"}](${clip.url})`);
    else if (clip.kind === "link") insertAtCaret(`[${clip.title || clip.url}](${clip.url})`);
    else insertAtCaret(`${String(clip.text || "").replace(/\s+$/, "")}\n`);
    setSaved("素材已插入正文", "ok");
  }

  async function copyClip(clip) {
    const text = clip.kind === "image" ? clip.url : clip.kind === "link" ? clip.url : clip.text || "";
    try {
      await navigator.clipboard.writeText(text);
      setSaved("素材已复制", "ok");
    } catch (error) {
      setSaved("复制失败，请手动选中", "error");
    }
  }

  function bindInbox() {
    const host = document.querySelector("[data-write-inbox]");
    if (!host) return;
    if (CLIPS) CLIPS.subscribe(renderInbox);
    host.addEventListener("click", (event) => {
      if (event.target.closest("[data-float-open]")) {
        openFloat();
        return;
      }
      if (event.target.closest("[data-clip-clear]")) {
        if (CLIPS) CLIPS.clear();
        setSaved("素材箱已清空", "ok");
        return;
      }
      const item = event.target.closest("[data-clip-id]");
      if (!item || !CLIPS) return;
      const clip = CLIPS.read().find((entry) => entry.id === item.dataset.clipId);
      if (!clip) return;
      if (event.target.closest("[data-clip-insert]")) {
        insertClip(clip);
        return;
      }
      if (event.target.closest("[data-clip-copy]")) {
        copyClip(clip);
        return;
      }
      if (event.target.closest("[data-clip-remove]")) {
        CLIPS.remove(clip.id);
        setSaved("已删除素材", "ok");
      }
    });
    renderInbox();
  }

  function openFloat() {
    if (!window.KawaiiFloat) {
      setSaved("悬浮共写模块没有加载", "error");
      return;
    }
    const prefer = new URLSearchParams(window.location.search).get("float") === "popup" ? "popup" : undefined;
    window.KawaiiFloat.open({
      prefer,
      onReturn: () => {
        window.focus();
        setSaved("已回到写作台", "ok");
        SCREEN.focus();
      },
      onInsert: (text) => {
        insertAtCaret(`${String(text).replace(/\n+$/, "")}\n`);
        setSaved("已从悬浮窗插入一句", "ok");
      }
    })
      .then((ui) => {
        setSaved(ui.mode === "pip" ? "悬浮共写已置顶" : "悬浮共写在独立小窗里", "ok");
      })
      .catch((error) => setSaved(error.message || "无法打开悬浮窗", "error"));
  }

  async function init() {
    bind();
    fillCollections();
    fillTags();
    state.slug = defaultSlug();
    metaField("slug").value = state.slug;
    renderFile();
    setMode("edit");

    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("slug");
    if (wanted) {
      await loadSlug(wanted);
    } else {
      const draft = readDraft();
      if (draft && String(draft.body || "").trim()) {
        writeMeta(draft.meta || {});
        state.slug = draft.slug || state.slug;
        metaField("slug").value = state.slug;
        SCREEN.value = draft.body;
        state.dirty = true;
        setSaved("已恢复上次草稿", "ok");
      } else {
        setSaved("未保存");
      }
      const presetCollection = params.get("collection");
      const presetTags = params.get("tags");
      if (presetCollection && !metaField("collection").value) metaField("collection").value = presetCollection;
      if (presetTags && !metaField("tags").value) {
        metaField("tags").value = presetTags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).join(", ");
      }
      if (presetCollection || presetTags) {
        refreshMirrors();
        setSaved("已从分类管理带入，写一篇新笔记", "ok");
      }
      renderFile();
      renderStatus();
    }

    await loadIndex();
    renderOutline();
    window.setInterval(() => {
      if (state.dirty) takeSnapshot("auto");
    }, 120000);
    SCREEN.focus();
  }

  window.WriteDesk = {
    state,
    compose,
    save,
    loadSlug,
    setMode,
    runAI,
    readMeta,
    pixelate,
    fitSource,
    get body() {
      return SCREEN.value;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
