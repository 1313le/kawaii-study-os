/* =========================================================
   kawaii / STUDY OS — logs page
   ========================================================= */

(function () {
  "use strict";

  const Kawaii = window.Kawaii;
  if (!Kawaii) return;
  const { q, qa, escape, reveal, getQuery, kindLabel } = Kawaii.ui;
  const { notes } = Kawaii;

  const grid = q("[data-logs-grid]");
  const countNode = q("[data-logs-count]");
  const filterHost = q("[data-logs-filters]");
  const tagModeHost = q("[data-logs-tagmode]");
  const collectionHost = q("[data-logs-collections]");
  const viewHost = q("[data-logs-view-group]");
  const searchInput = q("[data-logs-search]");
  const kindSelect = q("[data-logs-kind]");

  const initialTags = (getQuery("tags") || getQuery("tag") || "")
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  const state = {
    tags: [...new Set(initialTags)],
    tagMode: getQuery("tagmode") === "or" ? "or" : "and",
    query: getQuery("q") || "",
    kind: getQuery("kind") || "",
    collection: getQuery("collection") || "",
    sort: ["new", "views", "likes", "favorites"].includes(getQuery("sort")) ? getQuery("sort") : "new",
    view: getQuery("view") === "archive" ? "archive" : "grid"
  };

  const TAG_LIMIT = 12;
  let tagsExpanded = false;

  if (searchInput && state.query) searchInput.value = state.query;
  if (kindSelect) {
    kindSelect.value = state.kind;
    state.kind = kindSelect.value;
  }
  function formatCount(value) {
    const n = Number(value) || 0;
    if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, "")}w`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
    return String(n);
  }

  function highlight(value) {
    const text = escape(value == null ? "" : value);
    const query = state.query.trim();
    if (!query) return text;
    const terms = query
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!terms.length) return text;
    try {
      return text.replace(new RegExp(`(${terms.join("|")})`, "gi"), "<mark>$1</mark>");
    } catch (error) {
      return text;
    }
  }

  const tabButtons = Array.from(document.querySelectorAll("[data-logs-tab]"));

  function syncTabs() {
    tabButtons.forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.logsTab === state.sort ? "true" : "false");
    });
  }

  function setSort(sort) {
    state.sort = ["new", "views", "likes", "favorites"].includes(sort) ? sort : "new";
    syncTabs();
    render();
    syncUrl();
  }

  function cardMarkup(note) {
    if (window.KawaiiBlog) return window.KawaiiBlog.rowMarkup(note, { highlight });
    return `<a class="note-card" href="note.html?slug=${encodeURIComponent(note.slug)}">
  <h2 class="note-card__title">${highlight(note.title)}</h2>
</a>`;
  }

  function filtered() {
    let list = notes.all;
    if (state.tags.length) {
      list = list.filter((note) => {
        const tags = note.tags || [];
        return state.tagMode === "or"
          ? state.tags.some((tag) => tags.includes(tag))
          : state.tags.every((tag) => tags.includes(tag));
      });
    }
    if (state.kind) list = list.filter((note) => (note.kind || "article") === state.kind);
    if (state.collection) list = list.filter((note) => note.collection === state.collection);
    if (state.query) {
      const pool = new Set(notes.search(state.query).map((note) => note.slug));
      list = list.filter((note) => pool.has(note.slug));
    }
    if (state.sort !== "new" && window.KawaiiMetrics) {
      const key = state.sort;
      list = list.slice().sort((a, b) => {
        const cb = window.KawaiiMetrics.counts(b.slug)[key] || 0;
        const ca = window.KawaiiMetrics.counts(a.slug)[key] || 0;
        return cb - ca || String(b.date).localeCompare(String(a.date));
      });
    }
    return list;
  }

  function renderFilters() {
    if (!filterHost) return;
    const tags = notes.tags();
    const visible = tagsExpanded
      ? tags
      : tags.filter((tag, index) => index < TAG_LIMIT || state.tags.includes(tag.name));
    const hidden = tags.length - visible.length;
    const toggle =
      tags.length > TAG_LIMIT
        ? tagsExpanded
          ? `<button class="chip chip--toggle" type="button" data-tags-toggle aria-expanded="true">收起标签 <span aria-hidden="true">−</span></button>`
          : hidden > 0
            ? `<button class="chip chip--toggle" type="button" data-tags-toggle aria-expanded="false">更多标签 <span aria-hidden="true">+${hidden}</span></button>`
            : ""
        : "";
    filterHost.innerHTML = `<span class="filter-row__label">标签</span>
<button class="chip" type="button" data-tag="" aria-pressed="${state.tags.length ? "false" : "true"}">全部 <span aria-hidden="true">/</span> ${notes.all.length}</button>
${visible
  .map(
    (tag) =>
      `<button class="chip" type="button" data-tag="${escape(tag.name)}" aria-pressed="${state.tags.includes(tag.name) ? "true" : "false"}">${escape(tag.name)} <span aria-hidden="true">/</span> ${tag.count}</button>`
  )
  .join("")}${toggle}`;
  }

  function renderTagMode() {
    if (!tagModeHost) return;
    if (state.tags.length < 2) {
      tagModeHost.hidden = true;
      tagModeHost.innerHTML = "";
      return;
    }
    tagModeHost.hidden = false;
    tagModeHost.innerHTML = `<span class="filter-row__label">标签组合</span>
<button class="chip" type="button" data-tagmode="and" aria-pressed="${state.tagMode === "and" ? "true" : "false"}">同时包含 <span aria-hidden="true">AND</span></button>
<button class="chip" type="button" data-tagmode="or" aria-pressed="${state.tagMode === "or" ? "true" : "false"}">任一包含 <span aria-hidden="true">OR</span></button>
<span class="filter-row__hint">${state.tags.map((tag) => "#" + escape(tag)).join(state.tagMode === "or" ? " 或 " : " 且 ")}</span>`;
  }

  function renderCollections() {
    if (!collectionHost) return;
    const collections = (window.NOTES_META && window.NOTES_META.collections) || [];
    collectionHost.innerHTML =
      `<span class="filter-row__label">栏目</span>` +
      [
        `<button class="chip" type="button" data-collection="" aria-pressed="${state.collection ? "false" : "true"}">全部</button>`,
        ...collections.map(
          (item) =>
            `<button class="chip" type="button" data-collection="${escape(item.name)}" aria-pressed="${state.collection === item.name ? "true" : "false"}">${escape(item.name)} <span aria-hidden="true">/</span> ${item.count}</button>`
        )
      ].join("");
  }

  function archiveMarkup(list) {
    const groups = new Map();
    for (const note of list) {
      const year = note.date.slice(0, 4);
      const month = note.date.slice(5, 7);
      if (!groups.has(year)) groups.set(year, new Map());
      if (!groups.get(year).has(month)) groups.get(year).set(month, []);
      groups.get(year).get(month).push(note);
    }
    return [...groups.entries()]
      .map(([year, months]) => {
        const count = [...months.values()].reduce((sum, items) => sum + items.length, 0);
        return `<section class="archive__year">
  <header class="archive__year-head"><h2>${escape(year)}</h2><span>${count} ENTRIES</span></header>
  ${[...months.entries()]
    .map(
      ([month, items]) => `<div class="archive__month">
    <h3>${Number(month)} 月</h3>
    <ol class="archive__list">
      ${items
        .map(
          (note) => `<li class="archive__item">
        <time datetime="${escape(note.date)}">${escape(note.date.slice(5))}</time>
        <a class="archive__title" href="note.html?slug=${encodeURIComponent(note.slug)}">${highlight(note.title)}</a>
        <span class="archive__kind">${escape(kindLabel(note.kind))}</span>
        ${note.collection ? `<span class="archive__collection">${escape(note.collection)}</span>` : ""}
        <span class="archive__metrics">◉ ${formatCount(window.KawaiiMetrics ? window.KawaiiMetrics.counts(note.slug).views : 0)} · ♥ ${formatCount(window.KawaiiMetrics ? window.KawaiiMetrics.counts(note.slug).likes : 0)} · ☆ ${formatCount(window.KawaiiMetrics ? window.KawaiiMetrics.counts(note.slug).favorites : 0)}</span>
      </li>`
        )
        .join("")}
    </ol>
  </div>`
    )
    .join("")}
</section>`;
      })
      .join("");
  }

  function render() {
    if (!grid) return;
    const list = filtered();
    if (countNode) {
      countNode.innerHTML = `<b>${list.length}</b> / ${notes.all.length} ENTRIES`;
    }
    if (!list.length) {
      grid.innerHTML = `<div class="logs-empty" style="grid-column:1/-1">
  <p class="logs-empty__title">NO MATCH FOUND</p>
  <p>没有找到匹配的日志。换一个关键词，或清空筛选。</p>
  <button class="btn btn--small" type="button" data-clear-filters>RESET FILTERS / 重置</button>
</div>`;
      return;
    }
    if (state.view === "archive") {
      grid.className = "note-grid note-grid--archive";
      grid.innerHTML = `<div class="archive">${archiveMarkup(list)}</div>`;
      reveal(grid);
      return;
    }
    grid.className = "note-grid";
    grid.innerHTML = list.map(cardMarkup).join("");
    reveal(grid);
  }

  function syncUrl() {
    try {
      const url = new URL(window.location.href);
      if (state.query) url.searchParams.set("q", state.query);
      else url.searchParams.delete("q");
      if (state.tags.length) url.searchParams.set("tags", state.tags.join(","));
      else url.searchParams.delete("tags");
      url.searchParams.delete("tag");
      if (state.tags.length > 1 && state.tagMode === "or") url.searchParams.set("tagmode", "or");
      else url.searchParams.delete("tagmode");
      if (state.kind) url.searchParams.set("kind", state.kind);
      else url.searchParams.delete("kind");
      if (state.collection) url.searchParams.set("collection", state.collection);
      else url.searchParams.delete("collection");
      if (state.sort !== "new") url.searchParams.set("sort", state.sort);
      else url.searchParams.delete("sort");
      if (state.view === "archive") url.searchParams.set("view", "archive");
      else url.searchParams.delete("view");
      history.replaceState(null, "", url);
    } catch (error) {
      /* ignore */
    }
  }

  function setTag(tag) {
    if (!tag) state.tags = [];
    else if (state.tags.includes(tag)) state.tags = state.tags.filter((item) => item !== tag);
    else state.tags = [...state.tags, tag];
    renderFilters();
    renderTagMode();
    render();
    syncUrl();
  }

  function setTagMode(mode) {
    state.tagMode = mode === "or" ? "or" : "and";
    renderTagMode();
    render();
    syncUrl();
  }

  let searchTimer = 0;

  function reset() {
    state.tags = [];
    state.tagMode = "and";
    tagsExpanded = false;
    state.query = "";
    state.kind = "";
    state.collection = "";
    state.sort = "new";
    if (searchInput) searchInput.value = "";
    if (kindSelect) kindSelect.value = "";
    syncTabs();
    renderFilters();
    renderTagMode();
    renderCollections();
    render();
    syncUrl();
  }

  function setView(view) {
    state.view = view === "archive" ? "archive" : "grid";
    document.querySelectorAll("[data-logs-view]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.logsView === state.view ? "true" : "false");
    });
    render();
    syncUrl();
  }

  function bind() {
    if (filterHost) {
      filterHost.addEventListener("click", (event) => {
        const toggle = event.target.closest("[data-tags-toggle]");
        if (toggle) {
          tagsExpanded = !tagsExpanded;
          renderFilters();
          return;
        }
        const button = event.target.closest("[data-tag]");
        if (!button) return;
        setTag(button.dataset.tag);
      });
    }

    if (collectionHost) {
      collectionHost.addEventListener("click", (event) => {
        const button = event.target.closest("[data-collection]");
        if (!button) return;
        state.collection = button.dataset.collection;
        renderCollections();
        render();
        syncUrl();
      });
    }

    if (tagModeHost) {
      tagModeHost.addEventListener("click", (event) => {
        const button = event.target.closest("[data-tagmode]");
        if (button) setTagMode(button.dataset.tagmode);
      });
    }

    if (viewHost) {
      viewHost.addEventListener("click", (event) => {
        const button = event.target.closest("[data-logs-view]");
        if (button) setView(button.dataset.logsView);
      });
    }

    if (kindSelect) {
      kindSelect.addEventListener("change", () => {
        state.kind = kindSelect.value;
        render();
        syncUrl();
      });
    }

    tabButtons.forEach((button) => {
      button.addEventListener("click", () => setSort(button.dataset.logsTab));
    });

    if (grid) {
      grid.addEventListener("click", (event) => {
        if (event.target.closest("[data-clear-filters]")) reset();
      });
    }

    if (searchInput) {
      searchInput.addEventListener("input", () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
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
  }

  renderFilters();
  renderTagMode();
  renderCollections();
  syncTabs();
  setView(state.view);
  render();
  bind();

  if (window.KawaiiMetrics) {
    window.KawaiiMetrics.ready().then(() => render());
    window.KawaiiMetrics.subscribe(() => render());
  }
})();
