/* =========================================================
   kawaii / STUDY OS — resource vault page
   ========================================================= */

(function () {
  "use strict";

  const Kawaii = window.Kawaii;
  if (!Kawaii) return;
  const { q, qa, escape, getQuery } = Kawaii.ui;

  const grid = q("[data-res-grid]");
  const empty = q("[data-res-empty]");
  const categoryHost = q("[data-res-categories]");
  const searchInput = q("[data-res-search]");
  const kindSelect = q("[data-res-kind]");
  const sortSelect = q("[data-res-sort]");
  const countNode = q("[data-res-count]");
  const modeNode = q("[data-res-mode]");
  const proposalHost = q("[data-res-proposals]");
  const addDialog = q("[data-res-add-dialog]");
  const viewDialog = q("[data-res-view]");
  if (!grid || !addDialog || !viewDialog) return;

  const KIND_LABELS = {
    file: "FILE",
    pdf: "PDF",
    video: "VIDEO",
    image: "IMAGE",
    site: "WEB",
    netdisk: "NETDISK"
  };
  const PROVIDERS = { bilibili: "B 站", youtube: "YouTube", quark: "夸克网盘", baidu: "百度网盘", upload: "本地上传", direct: "直链", web: "网页" };

  const state = {
    items: [],
    categories: [],
    canWrite: false,
    kind: getQuery("kind") || "",
    category: getQuery("category") || "",
    query: getQuery("q") || "",
    sort: ["new", "title", "size"].includes(getQuery("sort")) ? getQuery("sort") : "new",
    editing: null,
    mode: "link",
    pendingRemove: "",
    viewItem: null
  };

  if (searchInput && state.query) searchInput.value = state.query;
  if (kindSelect) kindSelect.value = state.kind;
  if (sortSelect) sortSelect.value = state.sort;

  /* ---------- tiny helpers ---------- */

  function safeUrl(url) {
    const value = String(url || "").trim();
    if (/^\/(files|assets)\//.test(value)) return value;
    if (/^https?:\/\//i.test(value)) return value;
    return "";
  }

  function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (!value) return "";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function providerName(provider) {
    return PROVIDERS[provider] || provider || "链接";
  }

  let toastNode = null;
  let toastTimer = 0;
  function toast(message) {
    if (!toastNode) {
      toastNode = document.createElement("p");
      toastNode.className = "res-toast";
      toastNode.setAttribute("role", "status");
      document.body.appendChild(toastNode);
    }
    toastNode.textContent = message;
    toastNode.classList.add("is-on");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastNode.classList.remove("is-on"), 2200);
  }

  async function copyText(text, label) {
    const value = String(text || "");
    if (!value) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const area = document.createElement("textarea");
        area.value = value;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      toast(`已复制${label || "链接"}`);
    } catch (error) {
      toast("复制失败，请手动选中");
    }
  }

  /* ---------- data ---------- */

  function normalize(data, canWrite) {
    const items = Array.isArray(data.items) ? data.items : [];
    let categories = [];
    if (Array.isArray(data.categories) && data.categories.length) {
      categories = data.categories
        .map((entry) => (typeof entry === "string" ? { name: entry, count: 0 } : entry))
        .filter((entry) => entry && entry.name);
    }
    const counts = new Map();
    items.forEach((item) => {
      const name = item.category || "其他";
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    const known = new Set(categories.map((entry) => entry.name));
    for (const [name] of counts) if (!known.has(name)) categories.push({ name, count: 0 });
    categories = categories.map((entry) => ({ name: entry.name, count: counts.get(entry.name) || 0 }));
    return { items, categories, canWrite: Boolean(canWrite) };
  }

  function applyData(data, canWrite) {
    const normalized = normalize(data, canWrite);
    state.items = normalized.items;
    state.categories = normalized.categories;
    state.canWrite = normalized.canWrite;
    if (datalist) datalist.innerHTML = state.categories.map((entry) => `<option value="${escape(entry.name)}"></option>`).join("");
  }

  const datalist = q("#res-category-options");
  const PROPOSAL_KEY = "kawaii.resource.proposals.v1";

  function readProposals() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PROPOSAL_KEY) || "null");
      if (!parsed || !Array.isArray(parsed.items)) return [];
      return parsed.items.filter((item) => item && item.title && /^https?:\/\//i.test(String(item.url || "")));
    } catch (error) {
      return [];
    }
  }

  function clearProposals() {
    try {
      localStorage.removeItem(PROPOSAL_KEY);
    } catch (error) {
      /* ignore */
    }
  }

  function renderProposals() {
    if (!proposalHost) return;
    const items = readProposals();
    proposalHost.hidden = !items.length;
    if (!items.length) {
      proposalHost.innerHTML = "";
      return;
    }
    proposalHost.innerHTML = `<div class="res-proposals__head">
  <span>AI PROPOSALS / AI 推荐</span>
  <span>${items.length} 条 · 导入前请自己核对链接</span>
</div>
<ul class="res-proposals__list">${items
      .map(
        (item) =>
          `<li><b>${escape(item.title)}</b><small>${escape(item.category || "其他")}${item.url ? ` · ${escape(item.url)}` : ""}</small></li>`
      )
      .join("")}</ul>
<div class="res-proposals__actions">
  <button class="btn btn--small btn--primary author-only" type="button" data-res-import${state.canWrite ? "" : " disabled"}>导入全部</button>
  <button class="btn btn--small" type="button" data-res-dismiss>忽略</button>
  <span class="res-proposals__hint">${state.canWrite ? "导入后会写进 data/resources.json" : "导入需要本地服务"}</span>
</div>`;
  }

  async function importProposals() {
    if (!state.canWrite) {
      toast("导入需要本地服务");
      return;
    }
    if (window.KawaiiAuth) {
      const ok = await window.KawaiiAuth.require();
      if (!ok) return;
    }
    const items = readProposals();
    if (!items.length) return;
    let ok = 0;
    let failed = 0;
    for (const item of items) {
      try {
        const data = await postResource({ action: "add", ...item });
        applyData(data, true);
        ok += 1;
      } catch (error) {
        failed += 1;
      }
    }
    clearProposals();
    render();
    renderProposals();
    toast(`已导入 ${ok} 条${failed ? `，${failed} 条失败` : ""}`);
  }

  async function load() {
    try {
      const response = await fetch("/api/resources", { cache: "no-store" });
      if (!response.ok) throw new Error("offline");
      const data = await response.json();
      applyData(data, data.canWrite === true);
    } catch (error) {
      try {
        const response = await fetch("data/resources.json", { cache: "no-store" });
        if (!response.ok) throw new Error("missing");
        applyData(await response.json(), false);
      } catch (inner) {
        applyData({ items: [], categories: [] }, false);
      }
    }
    render();
  }

  function filtered() {
    const needle = state.query.trim().toLowerCase();
    let list = state.items.filter((item) => {
      if (state.kind && item.kind !== state.kind) return false;
      if (state.category && (item.category || "其他") !== state.category) return false;
      if (!needle) return true;
      const haystack = [item.title, item.note, item.category, (item.tags || []).join(" "), item.host, providerName(item.provider)]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
    if (state.sort === "title") {
      list = list.slice().sort((a, b) => String(a.title).localeCompare(String(b.title), "zh"));
    } else if (state.sort === "size") {
      list = list.slice().sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0));
    } else {
      list = list.slice().sort((a, b) => String(b.addedAt || "").localeCompare(String(a.addedAt || "")));
    }
    return list;
  }

  /* ---------- render ---------- */

  function cardMarkup(item) {
    const file = item.url.startsWith("/files/") || item.url.startsWith("/assets/");
    const external = safeUrl(item.url);
    const download = file || item.kind === "pdf";
    const size = formatSize(item.size);
    const tags = (item.tags || []).slice(0, 4).map((tag) => `<span class="res-card__tag">#${escape(tag)}</span>`).join("");
    const pending = state.pendingRemove === item.id;
    return `<article class="res-card" data-id="${escape(item.id)}" data-kind="${escape(item.kind || "file")}" data-category="${escape(item.category || "其他")}">
  <div class="res-card__top">
    <span class="res-card__kind">${escape(KIND_LABELS[item.kind] || "FILE")}</span>
    <span class="res-card__host">${escape(item.host || providerName(item.provider))}</span>
  </div>
  <h2 class="res-card__title">${escape(item.title)}</h2>
  ${item.note ? `<p class="res-card__note">${escape(item.note)}</p>` : ""}
  <div class="res-card__meta">
    <span class="res-card__tag res-card__tag--cat">${escape(item.category || "其他")}</span>
    ${tags}
    ${size ? `<span class="res-card__size">${escape(size)}</span>` : ""}
  </div>
  <div class="res-card__actions">
    <button class="res-action" type="button" data-res-open>查看</button>
    ${download ? `<a class="res-action" href="${escape(item.url)}" download="${escape(item.fileName || item.title)}">下载</a>` : ""}
    ${external && !file ? `<a class="res-action" href="${escape(external)}" target="_blank" rel="noopener noreferrer">新窗口</a>` : ""}
    <button class="res-action" type="button" data-res-copy>复制链接</button>
    ${item.code ? `<button class="res-action" type="button" data-res-copy-code>复制提取码</button>` : ""}
    ${state.canWrite ? `<button class="res-action author-only" type="button" data-res-edit>编辑</button>` : ""}
    ${state.canWrite ? `<button class="res-action res-action--danger author-only${pending ? " res-action--confirm" : ""}" type="button" data-res-remove>${pending ? "确认删除" : "删除"}</button>` : ""}
  </div>
</article>`;
  }

  function emptyMarkup() {
    if (!state.items.length) {
      return `<p class="res-empty__title">VAULT IS EMPTY</p>
<p>还没有资源。把你正在读的书、数据手册、课程视频或网盘链接加进来，下次就不用翻收藏夹。</p>
<div class="res-empty__actions">
  ${state.canWrite ? `<button class="btn btn--primary author-only" type="button" data-res-add>添加第一条</button>
  <button class="btn author-only" type="button" data-res-quick="数据手册">加一本数据手册</button>
  <button class="btn author-only" type="button" data-res-quick="视频">加一门视频课</button>` : `<button class="btn" type="button" data-res-reset>查看全部</button>`}
</div>`;
    }
    return `<p class="res-empty__title">NO MATCH</p>
<p>没有匹配的资源。换一个关键词，或清空筛选。</p>
<div class="res-empty__actions"><button class="btn" type="button" data-res-reset>重置筛选</button></div>`;
  }

  function render() {
    const list = filtered();
    if (grid) grid.innerHTML = list.map(cardMarkup).join("");
    if (empty) {
      empty.hidden = list.length > 0;
      empty.innerHTML = list.length ? "" : emptyMarkup();
    }
    if (countNode) countNode.innerHTML = `<b>${list.length}</b> / ${state.items.length} ITEMS`;
    const totalNode = q("[data-res-total]");
    const filesNode = q("[data-res-files]");
    const categoriesNode = q("[data-res-category-count]");
    if (totalNode) totalNode.textContent = state.items.length;
    if (filesNode) filesNode.textContent = state.items.filter((item) => item.kind === "file" || item.kind === "pdf").length;
    if (categoriesNode) categoriesNode.textContent = state.categories.filter((entry) => entry.count > 0).length;

    if (categoryHost) {
      categoryHost.innerHTML =
        `<span class="filter-row__label">分类</span>` +
        [
          `<button class="chip" type="button" data-res-category="" aria-pressed="${state.category ? "false" : "true"}">全部</button>`,
          ...state.categories
            .filter((entry) => entry.count > 0 || entry.name === state.category)
            .map(
              (entry) =>
                `<button class="chip" type="button" data-res-category="${escape(entry.name)}" aria-pressed="${state.category === entry.name ? "true" : "false"}">${escape(entry.name)} <span aria-hidden="true">/</span> ${entry.count}</button>`
            )
        ].join("");
    }

    qa("[data-res-add]").forEach((button) => {
      button.hidden = !state.canWrite;
    });
    if (modeNode) {
      modeNode.hidden = state.canWrite;
      modeNode.textContent = state.canWrite ? "" : "静态预览：可以浏览和打开链接；添加、编辑、上传与删除需要本地服务（npm start）。";
    }
    renderProposals();
  }

  function syncUrl() {
    try {
      const url = new URL(window.location.href);
      const set = (key, value) => {
        if (value) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      };
      set("q", state.query.trim());
      set("kind", state.kind);
      set("category", state.category);
      set("sort", state.sort === "new" ? "" : state.sort);
      history.replaceState(null, "", url);
    } catch (error) {
      /* ignore */
    }
  }

  function resetFilters() {
    state.query = "";
    state.kind = "";
    state.category = "";
    if (searchInput) searchInput.value = "";
    if (kindSelect) kindSelect.value = "";
    render();
    syncUrl();
  }

  /* ---------- viewer ---------- */

  function panel(markup) {
    return `<div class="res-panel">${markup}</div>`;
  }

  function netdiskMarkup(item) {
    return panel(`<b>${escape(providerName(item.provider))} 链接</b><br>
${escape(item.note || "网盘资源需要先保存到自己网盘，再下载。")}<br>
${item.code ? `提取码 <span class="res-panel__code">${escape(item.code)}</span><br>` : ""}
<span class="res-panel__hint">本站不解析网盘直链，请用「新窗口打开」或「复制链接」。</span>
<div class="res-panel__actions">
  <button class="btn btn--small" type="button" data-res-panel-copy>复制链接</button>
  ${item.code ? `<button class="btn btn--small" type="button" data-res-panel-code>复制提取码</button>` : ""}
</div>`);
  }

  function viewerMarkup(item) {
    const url = safeUrl(item.url);
    if (!url) return panel("这个链接不被允许打开。");
    if (item.provider === "bilibili" || item.provider === "youtube") {
      if (item.embed) {
        return `<iframe src="${escape(item.embed)}" title="${escape(item.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
      }
      return panel("这个视频链接解析不出 BV / 视频 ID，请用「新窗口打开」。");
    }
    if (item.kind === "video") {
      if (/\.(mp4|webm)(\?|$)/i.test(url)) {
        return `<video controls preload="metadata" src="${escape(url)}"></video>`;
      }
      return panel("这个视频不支持页内播放，请用「新窗口打开」。");
    }
    if (item.kind === "pdf") {
      if (window.matchMedia("(max-width: 820px)").matches) {
        return panel("<b>移动端浏览器通常不内嵌 PDF。</b><br>用上面的「新窗口打开」或「下载文件」继续。");
      }
      return `<iframe src="${escape(url)}" title="${escape(item.title)}"></iframe>`;
    }
    if (item.kind === "image") return `<img src="${escape(url)}" alt="${escape(item.title)}">`;
    if (item.kind === "netdisk") return netdiskMarkup(item);
    if (item.kind === "site") {
      return `<div class="res-site"><p class="res-frame-hint">很多站点禁止被别的页面内嵌；下面空白是正常的，点上面「新窗口打开」即可。</p><iframe src="${escape(url)}" title="${escape(item.title)}" referrerpolicy="no-referrer"></iframe></div>`;
    }
    return panel(`<b>${escape(item.title)}</b><br>${item.size ? `${escape(formatSize(item.size))} · ` : ""}这个文件不适合页内预览，点「下载文件」或「新窗口打开」。`);
  }

  function openViewer(item) {
    state.viewItem = item;
    const title = q("[data-res-view-title]");
    const kind = q("[data-res-view-kind]");
    const host = q("[data-res-view-host]");
    const open = q("[data-res-view-open]");
    const download = q("[data-res-view-download]");
    const codeButton = q("[data-res-view-code]");
    const body = q("[data-res-view-body]");
    const status = q("[data-res-view-status]");
    if (title) title.textContent = item.title;
    if (kind) kind.textContent = `${KIND_LABELS[item.kind] || "FILE"} · ${item.category || "其他"}`;
    if (host) host.textContent = [item.host, providerName(item.provider)].filter(Boolean).join(" · ");
    if (open) {
      open.href = safeUrl(item.url) || "#";
      open.hidden = !safeUrl(item.url);
    }
    const isFile = item.url.startsWith("/files/") || item.url.startsWith("/assets/") || ["file", "pdf"].includes(item.kind);
    if (download) {
      download.hidden = !isFile;
      download.href = item.url;
      download.setAttribute("download", item.fileName || item.title);
    }
    if (codeButton) codeButton.hidden = !item.code;
    if (status) status.textContent = "";
    if (body) body.innerHTML = viewerMarkup(item);
    if (!viewDialog.open) viewDialog.showModal();
  }

  /* ---------- add / edit ---------- */

  function field(name) {
    return q(`[data-res-field="${name}"]`);
  }
  function uploadField(name) {
    return q(`[data-res-upload-field="${name}"]`);
  }

  function setAddMode(mode) {
    state.mode = mode === "upload" ? "upload" : "link";
    qa("[data-res-tab]").forEach((button) => {
      button.setAttribute("aria-selected", button.dataset.resTab === state.mode ? "true" : "false");
    });
    qa("[data-res-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.resPane !== state.mode;
    });
  }

  function setAddStatus(text, tone) {
    const node = q("[data-res-add-status]");
    if (!node) return;
    node.textContent = text || "";
    node.dataset.tone = tone || "";
  }

  function openAdd(mode = "add", item = null, presetCategory = "") {
    state.editing = item;
    state.pendingRemove = "";
    if (mode === "edit" && item) {
      const tag = q("[data-res-add-tag]");
      const title = q("[data-res-add-title]");
      if (tag) tag.textContent = "EDIT ENTRY / 编辑资源";
      if (title) title.textContent = "编辑资源";
      field("title").value = item.title || "";
      field("url").value = item.url || "";
      field("category").value = item.category || "其他";
      field("kind").value = item.kind || "";
      field("code").value = item.code || "";
      field("tags").value = (item.tags || []).join(", ");
      field("note").value = item.note || "";
      const save = q("[data-res-add-save]");
      if (save) save.textContent = "保存修改";
    } else {
      const tag = q("[data-res-add-tag]");
      const title = q("[data-res-add-title]");
      if (tag) tag.textContent = "NEW ENTRY / 新资源";
      if (title) title.textContent = "添加资源";
      field("title").value = "";
      field("url").value = "";
      field("category").value = presetCategory || "";
      field("kind").value = "";
      field("code").value = "";
      field("tags").value = "";
      field("note").value = "";
      uploadField("title").value = "";
      uploadField("file").value = "";
      uploadField("category").value = presetCategory || "";
      uploadField("tags").value = "";
      uploadField("note").value = "";
      const save = q("[data-res-add-save]");
      if (save) save.textContent = "保存";
    }
    qa("[data-res-tab]").forEach((button) => {
      button.hidden = Boolean(state.editing) && button.dataset.resTab === "upload";
    });
    setAddMode("link");
    setAddStatus("");
    if (!addDialog.open) addDialog.showModal();
  }

  function parseTags(value) {
    return String(value || "")
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  async function openAddGuarded(mode = "add", item = null, presetCategory = "") {
    if (window.KawaiiAuth) {
      const ok = await window.KawaiiAuth.require();
      if (!ok) return;
    }
    openAdd(mode, item, presetCategory);
  }

  async function postResource(payload) {
    const response = await fetch("/api/resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (response.status === 401) {
      if (window.KawaiiAuth) window.KawaiiAuth.require();
      throw new Error("作者未登录");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "保存失败");
    return data;
  }

  async function uploadFile(file) {
    const response = await fetch("/api/resources/upload", {
      method: "POST",
      headers: {
        "X-Kawaii-Upload": "1",
        "X-File-Name": encodeURIComponent(file.name),
        "Content-Type": file.type || "application/octet-stream"
      },
      body: file
    });
    if (response.status === 401) {
      if (window.KawaiiAuth) window.KawaiiAuth.require();
      throw new Error("作者未登录");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "上传失败");
    return data;
  }

  function kindFromExtension(ext) {
    if (ext === "pdf") return "pdf";
    if (ext === "mp4" || ext === "webm") return "video";
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
    return "file";
  }

  async function saveResource() {
    const save = q("[data-res-add-save]");
    if (save) save.disabled = true;
    setAddStatus("保存中…");
    try {
      if (state.editing) {
        const payload = {
          action: "update",
          id: state.editing.id,
          title: field("title").value.trim(),
          url: field("url").value.trim(),
          category: field("category").value.trim(),
          kind: field("kind").value || undefined,
          code: field("code").value.trim(),
          tags: parseTags(field("tags").value),
          note: field("note").value.trim()
        };
        const data = await postResource(payload);
        applyData(data, true);
        render();
        addDialog.close();
        toast("资源已更新");
        return;
      }
      if (state.mode === "upload") {
        const file = uploadField("file").files[0];
        const title = uploadField("title").value.trim();
        if (!file) throw new Error("先选一个文件");
        if (!title) throw new Error("标题不能为空");
        const uploaded = await uploadFile(file);
        const extension = String(uploaded.extension || "").toLowerCase();
        const data = await postResource({
          action: "add",
          title,
          url: uploaded.url,
          kind: kindFromExtension(extension),
          provider: "upload",
          category: uploadField("category").value.trim() || "其他",
          tags: parseTags(uploadField("tags").value),
          note: uploadField("note").value.trim(),
          fileName: uploaded.name,
          size: uploaded.size
        });
        applyData(data, true);
        render();
        addDialog.close();
        toast(`已上传 ${uploaded.name}`);
        return;
      }
      const payload = {
        action: "add",
        title: field("title").value.trim(),
        url: field("url").value.trim(),
        category: field("category").value.trim() || "其他",
        kind: field("kind").value || undefined,
        code: field("code").value.trim(),
        tags: parseTags(field("tags").value),
        note: field("note").value.trim()
      };
      if (!payload.title) throw new Error("标题不能为空");
      if (!payload.url) throw new Error("链接不能为空");
      const data = await postResource(payload);
      applyData(data, true);
      render();
      addDialog.close();
      toast("资源已加入");
    } catch (error) {
      setAddStatus(error.message || "保存失败", "error");
    } finally {
      if (save) save.disabled = false;
    }
  }

  async function removeItem(id) {
    if (window.KawaiiAuth) {
      const ok = await window.KawaiiAuth.require();
      if (!ok) return;
    }
    try {
      const data = await postResource({ action: "remove", id });
      applyData(data, true);
      state.pendingRemove = "";
      render();
      toast("资源已删除（文件仍保留在 files/）");
    } catch (error) {
      toast(error.message || "删除失败");
    }
  }

  /* ---------- smart intake ---------- */

  const intakeUrl = q("[data-res-intake-url]");
  const intakeGo = q("[data-res-intake-go]");
  const intakeFile = q("[data-res-intake-file]");
  const intakeStatus = q("[data-res-intake-status]");
  const dropOverlay = q("[data-res-drop]");

  function setIntakeStatus(text, tone) {
    if (!intakeStatus) return;
    intakeStatus.textContent = text || "";
    intakeStatus.dataset.tone = tone || "";
  }

  async function probeAndOpen(rawUrl) {
    const url = String(rawUrl || "").trim();
    if (!url) {
      setIntakeStatus("先粘贴一个网址。", "warn");
      return;
    }
    if (window.KawaiiAuth) {
      const ok = await window.KawaiiAuth.require();
      if (!ok) return;
    }
    setIntakeStatus("正在抓取标题、类型与分类建议…");
    let data = null;
    try {
      const response = await fetch("/api/resources/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "识别失败");
    } catch (error) {
      setIntakeStatus(`自动抓取失败：${error.message}。仍可手动填写。`, "error");
      data = { url, title: "", category: "其他", kind: "", fetched: false, warning: error.message };
    }
    openAdd("add");
    field("title").value = data.title || "";
    field("url").value = data.url || url;
    field("category").value = data.category || "其他";
    field("kind").value = data.kind || "";
    field("note").value = data.description ? String(data.description).slice(0, 200) : "";
    setAddStatus(
      data.fetched
        ? "已自动抓取标题和分类建议，确认后保存。"
        : "只识别了链接类型，标题和分类请手动补。",
      data.fetched ? "ok" : "warn"
    );
    setIntakeStatus("");
    if (intakeUrl) intakeUrl.value = "";
  }

  function categoryForUpload(kind) {
    if (kind === "pdf") return "电子书";
    if (kind === "video") return "视频";
    if (kind === "file") return "工具软件";
    return "其他";
  }

  async function quickUpload(file) {
    if (!file) return;
    if (window.KawaiiAuth) {
      const ok = await window.KawaiiAuth.require();
      if (!ok) return;
    }
    setIntakeStatus(`正在上传 ${file.name}…`);
    try {
      const uploaded = await uploadFile(file);
      const extension = String(uploaded.extension || "").toLowerCase();
      const kind = kindFromExtension(extension);
      const title = String(file.name || "上传文件").replace(/\.[^.]+$/, "") || "上传文件";
      const data = await postResource({
        action: "add",
        title,
        url: uploaded.url,
        kind,
        provider: "upload",
        category: categoryForUpload(kind),
        note: "拖拽 / 本地上传",
        fileName: uploaded.name,
        size: uploaded.size
      });
      applyData(data, true);
      render();
      setIntakeStatus(`已加入：${title}`, "ok");
    } catch (error) {
      setIntakeStatus(`上传失败：${error.message}`, "error");
    }
  }

  function draggedUrl(transfer) {
    const uri = (transfer && transfer.getData("text/uri-list")) || "";
    if (uri) return uri.split("\n")[0].trim();
    const text = (transfer && transfer.getData("text/plain")) || "";
    const match = text.match(/https?:\/\/\S+/i);
    return match ? match[0] : "";
  }

  function isImportDrag(event) {
    const transfer = event.dataTransfer;
    if (!transfer) return false;
    const types = Array.from(transfer.types || []);
    return types.includes("Files") || types.includes("text/uri-list");
  }

  function bindIntake() {
    if (intakeGo) intakeGo.addEventListener("click", () => probeAndOpen(intakeUrl ? intakeUrl.value : ""));
    if (intakeUrl) {
      intakeUrl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          probeAndOpen(intakeUrl.value);
        }
      });
    }
    if (intakeFile) {
      intakeFile.addEventListener("change", () => {
        const file = intakeFile.files && intakeFile.files[0];
        intakeFile.value = "";
        if (file) quickUpload(file);
      });
    }

    let dragDepth = 0;
    document.addEventListener("dragenter", (event) => {
      if (!isImportDrag(event)) return;
      event.preventDefault();
      dragDepth += 1;
      if (dropOverlay) dropOverlay.hidden = false;
    });
    document.addEventListener("dragover", (event) => {
      if (!isImportDrag(event)) return;
      event.preventDefault();
    });
    document.addEventListener("dragleave", (event) => {
      if (!isImportDrag(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth && dropOverlay) dropOverlay.hidden = true;
    });
    document.addEventListener("drop", (event) => {
      if (!isImportDrag(event)) return;
      if (event.target.closest('input[type="file"]')) return;
      event.preventDefault();
      dragDepth = 0;
      if (dropOverlay) dropOverlay.hidden = true;
      const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
      if (files.length) {
        quickUpload(files[0]);
        return;
      }
      const url = draggedUrl(event.dataTransfer);
      if (url) probeAndOpen(url);
    });
  }

  async function classifyWithAI() {
    if (!window.KawaiiAI || !window.KawaiiAI.configured()) {
      setAddStatus("先在 AI 面板里配置接口，才能用 AI 识别分类。", "warn");
      return;
    }
    const title = field("title").value.trim();
    const url = field("url").value.trim();
    if (!title && !url) {
      setAddStatus("先填标题或链接，再让 AI 分类。", "warn");
      return;
    }
    setAddStatus("AI 正在判断分类…");
    try {
      const reply = await window.KawaiiAI.chat({
        messages: [
          {
            role: "system",
            content:
              '你是个人学习资源库的分类助手。只输出一个 JSON 对象，不要 markdown：{"category":"电子书|课程|数据手册|开发板|工具软件|视频|网盘|其他","kind":"file|pdf|video|image|site|netdisk","tags":["最多5个"],"note":"一句话说明"}。'
          },
          {
            role: "user",
            content: `标题：${title}\n链接：${url}\n现有说明：${field("note").value.trim()}`
          }
        ],
        temperature: 0.2,
        maxTokens: 220
      });
      const match = String(reply).match(/\{[\s\S]*\}/);
      const data = JSON.parse(match ? match[0] : reply);
      if (data.category) field("category").value = String(data.category);
      if (["file", "pdf", "video", "image", "site", "netdisk"].includes(data.kind)) field("kind").value = data.kind;
      if (Array.isArray(data.tags)) field("tags").value = data.tags.slice(0, 5).join(", ");
      if (data.note) field("note").value = String(data.note).slice(0, 200);
      setAddStatus("AI 已填好分类、标签和说明，保存前可以再改。", "ok");
    } catch (error) {
      setAddStatus(`AI 识别失败：${error.message}`, "error");
    }
  }

  /* ---------- events ---------- */

  function bindGrid() {
    if (!grid) return;
    grid.addEventListener("click", (event) => {
      const card = event.target.closest(".res-card");
      if (!card) return;
      const item = state.items.find((entry) => entry.id === card.dataset.id);
      if (!item) return;
      if (event.target.closest("[data-res-open]")) {
        openViewer(item);
        return;
      }
      if (event.target.closest("[data-res-copy]")) {
        copyText(item.url, "链接");
        return;
      }
      if (event.target.closest("[data-res-copy-code]")) {
        copyText(item.code, "提取码");
        return;
      }
      if (event.target.closest("[data-res-edit]")) {
        openAddGuarded("edit", item);
        return;
      }
      if (event.target.closest("[data-res-remove]")) {
        if (state.pendingRemove === item.id) {
          removeItem(item.id);
        } else {
          state.pendingRemove = item.id;
          render();
        }
      }
    });
  }

  if (empty) {
    empty.addEventListener("click", (event) => {
      if (event.target.closest("[data-res-add]")) {
        openAddGuarded("add");
        return;
      }
      const quick = event.target.closest("[data-res-quick]");
      if (quick) {
        openAddGuarded("add", null, quick.dataset.resQuick);
        return;
      }
      if (event.target.closest("[data-res-reset]")) resetFilters();
    });
  }

  qa("[data-res-add]").forEach((button) => {
    if (button.closest("[data-res-empty]")) return;
    button.addEventListener("click", () => openAddGuarded("add"));
  });

  if (categoryHost) {
    categoryHost.addEventListener("click", (event) => {
      const button = event.target.closest("[data-res-category]");
      if (!button) return;
      state.category = button.dataset.resCategory;
      render();
      syncUrl();
    });
  }

  if (proposalHost) {
    proposalHost.addEventListener("click", (event) => {
      if (event.target.closest("[data-res-import]")) {
        importProposals();
        return;
      }
      if (event.target.closest("[data-res-dismiss]")) {
        clearProposals();
        renderProposals();
        toast("已忽略这批 AI 推荐");
      }
    });
  }

  if (kindSelect) {
    kindSelect.addEventListener("change", () => {
      state.kind = kindSelect.value;
      render();
      syncUrl();
    });
  }
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      state.sort = sortSelect.value;
      render();
      syncUrl();
    });
  }
  if (searchInput) {
    let timer = 0;
    searchInput.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        state.query = searchInput.value.trim();
        render();
        syncUrl();
      }, 110);
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        searchInput.value = "";
        state.query = "";
        render();
        syncUrl();
        searchInput.blur();
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = (event.target && event.target.tagName) || "";
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    if (event.key === "/") {
      event.preventDefault();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }
  });

  qa("[data-res-add-close]").forEach((button) => button.addEventListener("click", () => addDialog.close()));
  qa("[data-res-add-cancel]").forEach((button) => button.addEventListener("click", () => addDialog.close()));
  addDialog.addEventListener("click", (event) => {
    if (event.target === addDialog) addDialog.close();
  });
  qa("[data-res-tab]").forEach((button) => {
    button.addEventListener("click", () => setAddMode(button.dataset.resTab));
  });
  const saveButton = q("[data-res-add-save]");
  if (saveButton) saveButton.addEventListener("click", saveResource);

  qa("[data-res-view-close]").forEach((button) => button.addEventListener("click", () => viewDialog.close()));
  viewDialog.addEventListener("click", (event) => {
    if (event.target === viewDialog) viewDialog.close();
  });
  viewDialog.addEventListener("close", () => {
    const body = q("[data-res-view-body]");
    if (body) body.innerHTML = "";
    state.viewItem = null;
  });
  const viewBody = q("[data-res-view-body]");
  if (viewBody) {
    viewBody.addEventListener("click", (event) => {
      if (event.target.closest("[data-res-panel-copy]")) copyText(state.viewItem && state.viewItem.url, "链接");
      if (event.target.closest("[data-res-panel-code]")) copyText(state.viewItem && state.viewItem.code, "提取码");
    });
  }
  const viewCopy = q("[data-res-view-copy]");
  if (viewCopy) viewCopy.addEventListener("click", () => copyText(state.viewItem && state.viewItem.url, "链接"));
  const viewCode = q("[data-res-view-code]");
  if (viewCode) viewCode.addEventListener("click", () => copyText(state.viewItem && state.viewItem.code, "提取码"));

  bindGrid();
  bindIntake();
  const aiButton = q("[data-res-ai]");
  if (aiButton) aiButton.addEventListener("click", classifyWithAI);
  load();
})();
