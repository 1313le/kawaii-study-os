/* =========================================================
   kawaii / STUDY OS — floating co-write station
   A Document Picture-in-Picture window (popup fallback) that
   stays on top while browsing other pages. It mirrors the desk
   position, accepts dropped screenshots / text / links with a
   transfer animation, and can type a line straight into the note.
   ========================================================= */

(function () {
  "use strict";

  const WIDTH = 400;
  const HEIGHT = 380;
  const FEATURES = "popup=yes,width=400,height=380,resizable=yes,scrollbars=no";
  let active = null;

  function escapeText(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (error) {
      return "链接";
    }
  }

  function stylesheetLinks() {
    return Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((link) => link.href);
  }

  function prepare(win) {
    const doc = win.document;
    doc.documentElement.lang = "zh-CN";
    doc.documentElement.dataset.skin = document.documentElement.dataset.skin;
    doc.documentElement.dataset.fx = document.documentElement.dataset.fx;
    if (document.documentElement.dataset.motion) {
      doc.documentElement.dataset.motion = document.documentElement.dataset.motion;
    }
    doc.title = "CO-WRITE / kawaii";
    doc.head.innerHTML = "";
    const meta = doc.createElement("meta");
    meta.name = "viewport";
    meta.content = "width=device-width, initial-scale=1";
    doc.head.appendChild(meta);
    for (const href of stylesheetLinks()) {
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      doc.head.appendChild(link);
    }
    doc.body.className = "pip-body";
    doc.body.innerHTML = "";
  }

  function markup() {
    return `<div class="pip-shell" data-pip-shell>
  <div class="pip-top">
    <span class="pip-brand">kawaii<span>/ CO-WRITE</span></span>
    <span class="pip-live" data-pip-live data-on="off"><i></i>LIVE</span>
    <button class="pip-close" type="button" data-pip-close aria-label="关闭悬浮窗">×</button>
  </div>
  <div class="pip-screen" data-pip-screen>
    <div class="pip-scan" aria-hidden="true"></div>
    <div class="pip-head">
      <b class="pip-title" data-pip-title>UNTITLED.MD</b>
      <span class="pip-mode" data-pip-mode>EDIT</span>
    </div>
    <div class="pip-pos">
      <span data-pip-line>LN 1</span>
      <span data-pip-col>COL 1</span>
      <span data-pip-chars>0 CHARS</span>
    </div>
    <ol class="pip-tail" data-pip-tail><li class="pip-tail__empty">打开写作台后，这里会实时显示光标位置。</li></ol>
    <div class="pip-progress"><i data-pip-progress></i></div>
    <div class="pip-hint" data-pip-hint>把截图 / 文本 / 链接拖进来（或 Ctrl+V）</div>
    <div class="pip-anim" data-pip-anim hidden aria-hidden="true">
      <span class="pip-chip" data-pip-chip>IMG</span>
    </div>
  </div>
  <div class="pip-foot">
    <button class="pip-btn pip-btn--primary" type="button" data-pip-return>返回写作台</button>
    <button class="pip-btn" type="button" data-pip-toggle-write>直接写</button>
    <span class="pip-count" data-pip-count>素材 0</span>
  </div>
  <div class="pip-writer" data-pip-writer hidden>
    <textarea class="pip-input" data-pip-input placeholder="写一句，Enter 插到写作台；Shift+Enter 换行"></textarea>
    <button class="pip-btn pip-btn--primary" type="button" data-pip-send>插入</button>
  </div>
</div>`;
  }

  function toPng(file) {
    if (file.type === "image/png") {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(file);
      });
    }
    return createImageBitmap(file).then((bitmap) => {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      if (bitmap.close) bitmap.close();
      return canvas.toDataURL("image/png");
    });
  }

  async function uploadClipImage(file) {
    const dataUrl = await toPng(file);
    const name = `clip-${Date.now().toString(36)}`;
    const response = await fetch("/api/asset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, dataUrl })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "图片上传失败");
    return window.KawaiiClips.add({
      kind: "image",
      url: data.path,
      title: String(file.name || "粘贴截图").slice(0, 80),
      source: "float"
    });
  }

  function mount(win, api = {}) {
    const doc = win.document;
    prepare(win);
    doc.body.innerHTML = markup();
    const $ = (name) => doc.querySelector(`[data-pip-${name}]`);
    const shell = $("shell");
    const screen = $("screen");
    const anim = $("anim");
    const chip = $("chip");
    const hint = $("hint");
    const input = $("input");
    const writer = $("writer");
    let lastState = window.KawaiiDesk ? window.KawaiiDesk.read() : null;
    let animTimer = 0;
    let hintTimer = 0;

    const HINT_DEFAULT = "把截图 / 文本 / 链接拖进来（或 Ctrl+V）";

    function setHint(text) {
      if (!hint) return;
      hint.textContent = text;
      window.clearTimeout(hintTimer);
      if (text !== HINT_DEFAULT) {
        hintTimer = window.setTimeout(() => {
          if (hint) hint.textContent = HINT_DEFAULT;
        }, 2600);
      }
    }

    function render(state) {
      lastState = state;
      const live = $("live");
      const clips = window.KawaiiClips ? window.KawaiiClips.summary() : null;
      const count = $("count");
      if (count && clips) count.textContent = `素材 ${clips.total}`;
      if (!state) {
        $("title").textContent = "等待写作台…";
        $("line").textContent = "LN —";
        $("col").textContent = "COL —";
        $("chars").textContent = "0 CHARS";
        $("mode").textContent = "IDLE";
        $("progress").style.width = "0%";
        $("tail").innerHTML = `<li class="pip-tail__empty">打开写作台后，这里会实时显示光标位置。</li>`;
        if (live) live.dataset.on = "off";
        return;
      }
      $("title").textContent = state.title || "UNTITLED.MD";
      $("line").textContent = `LN ${state.line}`;
      $("col").textContent = `COL ${state.col}`;
      $("chars").textContent = `${state.chars} CHARS`;
      $("mode").textContent = String(state.mode || "edit").toUpperCase();
      $("progress").style.width = `${Math.min(100, Math.round((state.line / Math.max(1, state.totalLines)) * 100))}%`;
      if (live) live.dataset.on = Date.now() - (state.at || 0) < 4000 ? "on" : "off";
      const lines = String(state.tail || "").split("\n").filter((line) => line.trim()).slice(-3);
      $("tail").innerHTML = lines.length
        ? lines
          .map(
            (text, index) =>
              `<li${index === lines.length - 1 ? ' class="is-current"' : ""}>${escapeText(text)}${index === lines.length - 1 ? '<i class="pip-caret"></i>' : ""}</li>`
          )
          .join("")
        : `<li class="pip-tail__empty">光标还在第一行。</li>`;
    }

    function animateIntake(kind, x, y, pending) {
      if (!anim || !chip || !screen) return;
      anim.hidden = false;
      chip.textContent = kind === "image" ? "IMG" : kind === "link" ? "LINK" : "TXT";
      const rect = screen.getBoundingClientRect();
      const px = Math.max(8, Math.min(rect.width - 48, x - rect.left));
      const py = Math.max(8, Math.min(rect.height - 30, y - rect.top));
      chip.style.left = `${px}px`;
      chip.style.top = `${py}px`;
      chip.style.setProperty("--dx", `${rect.width / 2 - px - 18}px`);
      chip.style.setProperty("--dy", `${rect.height / 2 - py - 12}px`);
      chip.classList.remove("is-flying");
      void chip.offsetWidth;
      chip.classList.add("is-flying");
      screen.classList.add("is-scanning");
      setHint(pending ? "正在接收…" : "正在传送…");
    }

    function finishIntake(message) {
      if (screen) screen.classList.remove("is-scanning");
      setHint(message);
      window.clearTimeout(animTimer);
      animTimer = window.setTimeout(() => {
        if (anim) anim.hidden = true;
        if (chip) chip.classList.remove("is-flying");
      }, 520);
    }

    function failIntake(message) {
      if (screen) screen.classList.remove("is-scanning");
      setHint(message || "接收失败");
      window.clearTimeout(animTimer);
      animTimer = window.setTimeout(() => {
        if (anim) anim.hidden = true;
        if (chip) chip.classList.remove("is-flying");
      }, 520);
    }

    function addTextClip(text, uri, source) {
      if (!window.KawaiiClips) return null;
      const clean = String(text || "").trim();
      const link = String(uri || "").split("\n")[0] || (/^https?:\/\/\S+$/i.test(clean) ? clean : "");
      if (link) {
        return window.KawaiiClips.add({
          kind: "link",
          url: link,
          title: clean && clean !== link ? clean.slice(0, 80) : hostOf(link),
          text: clean || link,
          source
        });
      }
      if (!clean) return null;
      return window.KawaiiClips.add({
        kind: "text",
        text: clean,
        title: clean.split("\n")[0].slice(0, 80),
        source
      });
    }

    async function intakeImages(files, x, y) {
      const file = Array.from(files || []).find((item) => /^image\//.test(item.type));
      if (!file) return;
      animateIntake("image", x, y, true);
      try {
        await uploadClipImage(file);
        finishIntake("图片已送达写作台");
      } catch (error) {
        const hosted = !window.location.port || window.location.protocol === "https:";
        failIntake(hosted ? "图片上传需要本地服务" : error.message);
      }
    }

    function handleDrop(event) {
      event.preventDefault();
      shell.classList.remove("is-drag");
      const transfer = event.dataTransfer;
      const imageFiles = Array.from((transfer && transfer.files) || []).filter((file) => /^image\//.test(file.type));
      if (imageFiles.length) {
        intakeImages(imageFiles, event.clientX, event.clientY);
        return;
      }
      const uri = (transfer && transfer.getData("text/uri-list")) || "";
      const text = (transfer && transfer.getData("text/plain")) || "";
      if (!uri && !text) {
        setHint("只接收截图 / 文本 / 链接");
        return;
      }
      const clip = addTextClip(text, uri, "drag");
      if (!clip) {
        setHint("没有可接收的内容");
        return;
      }
      animateIntake(clip.kind, event.clientX, event.clientY, false);
      finishIntake(clip.kind === "link" ? "链接已送达写作台" : "文本已送达写作台");
    }

    function handlePaste(event) {
      const items = Array.from((event.clipboardData && event.clipboardData.items) || []);
      const image = items.find((item) => item.kind === "file" && /^image\//.test(item.type));
      if (image) {
        event.preventDefault();
        const rect = screen ? screen.getBoundingClientRect() : { left: 0, top: 0, width: 320, height: 200 };
        intakeImages([image.getAsFile()], rect.left + rect.width / 2, rect.top + rect.height / 2);
        return;
      }
      if (event.target === input) return;
      const text = (event.clipboardData && event.clipboardData.getData("text/plain")) || "";
      const uri = (event.clipboardData && event.clipboardData.getData("text/uri-list")) || "";
      if (!text && !uri) return;
      event.preventDefault();
      const clip = addTextClip(text, uri, "paste");
      if (!clip) return;
      const rect = screen ? screen.getBoundingClientRect() : { left: 0, top: 0, width: 320, height: 200 };
      animateIntake(clip.kind, rect.left + rect.width / 2, rect.top + rect.height / 2, false);
      finishIntake(clip.kind === "link" ? "链接已送达写作台" : "文本已送达写作台");
    }

    function sendQuick() {
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;
      if (api.onInsert) api.onInsert(text);
      input.value = "";
      setHint("已插入写作台");
      input.focus();
    }

    shell.addEventListener("dragover", (event) => {
      event.preventDefault();
      shell.classList.add("is-drag");
    });
    shell.addEventListener("dragleave", (event) => {
      if (event.target === shell || !shell.contains(event.relatedTarget)) shell.classList.remove("is-drag");
    });
    shell.addEventListener("drop", handleDrop);
    doc.addEventListener("paste", handlePaste);

    $("close").addEventListener("click", () => {
      try {
        win.close();
      } catch (error) {
        /* ignore */
      }
    });
    $("return").addEventListener("click", () => {
      if (api.onReturn) api.onReturn();
      try {
        win.close();
      } catch (error) {
        /* ignore */
      }
    });
    $("toggle-write").addEventListener("click", () => {
      if (!writer) return;
      writer.hidden = !writer.hidden;
      if (!writer.hidden && input) input.focus();
    });
    $("send").addEventListener("click", sendQuick);
    if (input) {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          sendQuick();
        } else if (event.key === "Enter" && event.shiftKey) {
          /* allow a newline */
        } else if (event.key === "Escape") {
          writer.hidden = true;
        }
      });
    }

    const unsubscribe = window.KawaiiDesk ? window.KawaiiDesk.subscribe(render) : null;
    const unsubscribeClips = window.KawaiiClips
      ? window.KawaiiClips.subscribe(() => render(lastState))
      : null;
    const liveTimer = window.setInterval(() => render(lastState), 3000);
    const onSkin = () => {
      win.document.documentElement.dataset.skin = document.documentElement.dataset.skin;
      win.document.documentElement.dataset.fx = document.documentElement.dataset.fx;
    };
    document.addEventListener("kawaii:skinchange", onSkin);

    render(lastState);
    if (input) win.setTimeout(() => input.focus(), 60);

    return {
      mode: "float",
      win,
      update: render,
      dispose() {
        if (unsubscribe) unsubscribe();
        if (unsubscribeClips) unsubscribeClips();
        window.clearInterval(liveTimer);
        window.clearTimeout(animTimer);
        window.clearTimeout(hintTimer);
        document.removeEventListener("kawaii:skinchange", onSkin);
      }
    };
  }

  function setup(win, mode, options) {
    const ui = mount(win, {
      onReturn: options.onReturn,
      onInsert: options.onInsert
    });
    ui.mode = mode;
    active = ui;
    win.addEventListener("pagehide", () => {
      ui.dispose();
      if (active === ui) active = null;
    });
    try {
      win.focus();
    } catch (error) {
      /* ignore */
    }
    return ui;
  }

  function open(options = {}) {
    if (active && active.win && !active.win.closed) {
      try {
        active.win.focus();
      } catch (error) {
        /* ignore */
      }
      return Promise.resolve(active);
    }
    const prefer = options.prefer === "popup" ? "popup" : "auto";
    if (prefer === "auto" && "documentPictureInPicture" in window) {
      let request = null;
      try {
        request = window.documentPictureInPicture.requestWindow({ width: WIDTH, height: HEIGHT });
      } catch (error) {
        request = null;
      }
      if (request) {
        return request
          .then((win) => setup(win, "pip", options))
          .catch(() => {
            const win = window.open("", "kawaii-float", FEATURES);
            if (!win) throw new Error("浏览器拦截了悬浮窗，请允许弹窗后重试");
            return setup(win, "popup", options);
          });
      }
    }
    const win = window.open("", "kawaii-float", FEATURES);
    if (!win) return Promise.reject(new Error("浏览器拦截了悬浮窗，请允许弹窗后重试"));
    return Promise.resolve(setup(win, "popup", options));
  }

  function close() {
    if (active && active.win && !active.win.closed) {
      try {
        active.win.close();
      } catch (error) {
        /* ignore */
      }
    }
    active = null;
  }

  window.KawaiiFloat = { open, close, mount, get active() { return active; } };
})();
