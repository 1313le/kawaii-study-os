/* =========================================================
   kawaii / STUDY OS — taxonomy manager
   Collections and tags are front-matter data. This dialog
   rewrites them through /api/taxonomy and keeps one undo step.
   ========================================================= */

(function () {
  "use strict";

  const Kawaii = window.Kawaii;
  if (!Kawaii) return;
  const { q, escape } = Kawaii.ui;

  const dialog = q("[data-taxonomy]");
  const opener = q("[data-taxonomy-open]");
  if (!dialog || !opener) return;

  const listHost = q("[data-taxonomy-list]");
  const statusNode = q("[data-taxonomy-status]");
  const noteNode = q("[data-taxonomy-note]");
  const undoButton = q("[data-taxonomy-undo]");
  const mergeTarget = q("[data-taxonomy-merge-target]");
  const mergeButton = q("[data-taxonomy-merge]");
  const createInput = q("[data-taxonomy-create]");
  const createGo = q("[data-taxonomy-create-go]");
  const createLabel = q("[data-taxonomy-create-label]");
  const tabButtons = Array.from(document.querySelectorAll("[data-taxonomy-tab]"));

  const LABELS = { collection: "栏目", tag: "标签" };
  const state = { tab: "collection", data: null, picks: new Set(), busy: false, online: false, editing: false };

  function items() {
    if (!state.data) return [];
    return state.tab === "collection" ? state.data.collections || [] : state.data.tags || [];
  }

  function setStatus(text, tone) {
    if (!statusNode) return;
    statusNode.textContent = text || "";
    statusNode.dataset.tone = tone || "";
  }

  function renderTabs() {
    tabButtons.forEach((button) => {
      const active = button.dataset.taxonomyTab === state.tab;
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    for (const kind of ["collection", "tag"]) {
      const node = q(`[data-taxonomy-tab-count="${kind}"]`);
      if (!node) continue;
      const list = kind === "collection" ? (state.data && state.data.collections) || [] : (state.data && state.data.tags) || [];
      node.textContent = list.length;
    }
    if (createLabel) createLabel.textContent = LABELS[state.tab];
  }

  function rowMarkup(item) {
    const picks = state.online
      ? `<input type="checkbox" data-taxonomy-pick value="${escape(item.name)}" aria-label="选择 ${escape(item.name)}"${state.picks.has(item.name) ? " checked" : ""}>`
      : "";
    const actions = state.online
      ? `<div class="taxonomy__actions">
        <button class="taxonomy__action" type="button" data-taxonomy-rename aria-label="重命名 ${escape(item.name)}">重命名</button>
        <button class="taxonomy__action taxonomy__action--danger" type="button" data-taxonomy-delete aria-label="删除 ${escape(item.name)}">删除</button>
      </div>`
      : "";
    return `<div class="taxonomy__row" data-row-name="${escape(item.name)}" data-row-kind="${state.tab}">
  <label class="taxonomy__pick">${picks}<span class="taxonomy__name">${escape(item.name)}</span></label>
  <span class="taxonomy__count">${item.count} 篇</span>
  ${actions}
</div>`;
  }

  function renderList() {
    state.editing = false;
    if (!listHost) return;
    if (!state.data) {
      listHost.innerHTML = `<div class="taxonomy__empty">正在读取分类…</div>`;
      return;
    }
    const list = items();
    if (!list.length) {
      listHost.innerHTML = `<div class="taxonomy__empty">还没有${LABELS[state.tab]}。在写作台写第一篇时填一个，或者用下面的「新建」。</div>`;
      return;
    }
    listHost.innerHTML = list.map(rowMarkup).join("");
  }

  function syncMerge() {
    if (!mergeButton) return;
    const ready = state.online && !state.busy && state.picks.size > 0 && String(mergeTarget.value || "").trim().length > 0;
    mergeButton.disabled = !ready;
  }

  function localData() {
    const meta = window.NOTES_META || {};
    return {
      collections: meta.collections || [],
      tags: meta.tags || [],
      notes: meta.count || 0,
      undo: { canUndo: false }
    };
  }

  async function load() {
    setStatus("读取分类…");
    try {
      const response = await fetch("/api/taxonomy", { cache: "no-store" });
      if (!response.ok) throw new Error("offline");
      state.data = await response.json();
      state.online = true;
      if (noteNode) noteNode.textContent = "重命名、合并与删除会直接改写 notes/ 里的 front-matter。每次批量操作都保留一步撤销。";
    } catch (error) {
      state.online = false;
      state.data = localData();
      if (noteNode) noteNode.textContent = "当前是静态预览：只能查看分类。启动本地服务（npm start）后可以重命名、合并与删除。";
      setStatus("静态预览 · 只读", "warn");
    }
    if (undoButton) {
      undoButton.hidden = !(state.data.undo && state.data.undo.canUndo);
      undoButton.textContent = "撤销上一次操作";
    }
    state.picks.clear();
    if (mergeTarget) mergeTarget.value = "";
    renderTabs();
    renderList();
    syncMerge();
    if (state.online) setStatus(`共 ${state.data.notes || 0} 篇笔记`);
  }

  async function send(payload, label) {
    if (state.busy || !state.online) return;
    state.busy = true;
    syncMerge();
    setStatus(`${label}中…`);
    try {
      const response = await fetch("/api/taxonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (response.status === 401) {
        if (window.KawaiiAuth) window.KawaiiAuth.require();
        throw new Error("作者未登录");
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "操作失败");
      const count = Number(data.affected) || 0;
      setStatus(data.action === "undo" ? `已撤销，恢复 ${count} 篇笔记` : `已更新 ${count} 篇笔记，正在刷新…`);
      state.picks.clear();
      window.setTimeout(() => window.location.reload(), 720);
    } catch (error) {
      state.busy = false;
      syncMerge();
      setStatus(error.message || "操作失败", "error");
    }
  }

  /* ---------- inline rename / delete ---------- */

  function startRename(row) {
    const name = row.dataset.rowName;
    const nameNode = row.querySelector(".taxonomy__name");
    const actions = row.querySelector(".taxonomy__actions");
    const count = row.querySelector(".taxonomy__count");
    if (!nameNode || !actions) return;
    state.editing = true;
    row.classList.add("is-editing");
    if (count) count.hidden = true;
    nameNode.innerHTML = `<input class="taxonomy__input" type="text" data-rename-input value="${escape(name)}" aria-label="新的名称">`;
    actions.innerHTML = `<button class="taxonomy__action" type="button" data-rename-save>保存</button>
<button class="taxonomy__action" type="button" data-rename-cancel>取消</button>`;
    const input = nameNode.querySelector("[data-rename-input]");
    if (input) {
      input.focus();
      input.select();
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitRename(row, input.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          renderList();
          syncMerge();
        }
      });
    }
  }

  function commitRename(row, value) {
    const from = row.dataset.rowName;
    const to = String(value || "").trim();
    if (!to || to === from) {
      setStatus("名称没有变化", "warn");
      return;
    }
    send({ action: "rename", kind: state.tab, from, to }, "重命名");
  }

  function startDelete(row) {
    const name = row.dataset.rowName;
    const actions = row.querySelector(".taxonomy__actions");
    if (!actions) return;
    state.editing = true;
    row.classList.add("is-editing", "is-danger");
    const hint = state.tab === "collection" ? "笔记会归到「未分类」" : "所有笔记会移除这个标签";
    actions.innerHTML = `<span class="taxonomy__warn">${hint}</span>
<button class="taxonomy__action taxonomy__action--danger" type="button" data-delete-confirm>确认删除</button>
<button class="taxonomy__action" type="button" data-delete-cancel>取消</button>`;
  }

  /* ---------- wiring ---------- */

  opener.addEventListener("click", async () => {
    if (dialog.open) return;
    if (window.KawaiiAuth) {
      const ok = await window.KawaiiAuth.require();
      if (!ok) return;
    }
    dialog.showModal();
    load();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener("cancel", (event) => {
    if (state.editing) {
      event.preventDefault();
      renderList();
      syncMerge();
    }
  });

  const closeButton = q("[data-taxonomy-close]");
  if (closeButton) closeButton.addEventListener("click", () => dialog.close());

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.taxonomyTab === "tag" ? "tag" : "collection";
      if (next === state.tab) return;
      state.tab = next;
      state.picks.clear();
      if (mergeTarget) mergeTarget.value = "";
      setStatus("");
      renderTabs();
      renderList();
      syncMerge();
    });
  });

  if (listHost) {
    listHost.addEventListener("change", (event) => {
      const pick = event.target.closest("[data-taxonomy-pick]");
      if (!pick) return;
      if (pick.checked) state.picks.add(pick.value);
      else state.picks.delete(pick.value);
      syncMerge();
    });

    listHost.addEventListener("click", (event) => {
      const row = event.target.closest(".taxonomy__row");
      if (!row) return;
      if (event.target.closest("[data-taxonomy-rename]")) {
        startRename(row);
        return;
      }
      if (event.target.closest("[data-taxonomy-delete]")) {
        startDelete(row);
        return;
      }
      if (event.target.closest("[data-rename-cancel]") || event.target.closest("[data-delete-cancel]")) {
        renderList();
        syncMerge();
        return;
      }
      if (event.target.closest("[data-rename-save]")) {
        const input = row.querySelector("[data-rename-input]");
        commitRename(row, input ? input.value : "");
        return;
      }
      if (event.target.closest("[data-delete-confirm]")) {
        send({ action: "delete", kind: state.tab, from: row.dataset.rowName }, "删除");
      }
    });
  }

  if (mergeTarget) {
    mergeTarget.addEventListener("input", syncMerge);
    mergeTarget.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !mergeButton.disabled) {
        event.preventDefault();
        mergeButton.click();
      }
    });
  }

  if (mergeButton) {
    mergeButton.addEventListener("click", () => {
      const to = String(mergeTarget.value || "").trim();
      if (!to || !state.picks.size) return;
      send({ action: "merge", kind: state.tab, names: [...state.picks], to }, "合并");
    });
  }

  if (undoButton) {
    undoButton.addEventListener("click", () => send({ action: "undo" }, "撤销"));
  }

  if (createGo) {
    createGo.addEventListener("click", () => {
      const name = String(createInput.value || "").trim();
      if (!name) {
        setStatus("先输入一个名称", "warn");
        return;
      }
      const param = state.tab === "collection" ? "collection" : "tags";
      window.location.href = `write.html?${param}=${encodeURIComponent(name)}`;
    });
    createInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        createGo.click();
      }
    });
  }

  dialog.addEventListener("close", () => {
    state.picks.clear();
    state.editing = false;
  });
})();
