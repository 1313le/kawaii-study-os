/* =========================================================
   kawaii / STUDY OS — mind map workbench page
   ========================================================= */

(function () {
  "use strict";

  const Kawaii = window.Kawaii;
  if (!Kawaii || !window.KawaiiMindmap) return;
  const { q, escape, getQuery } = Kawaii.ui;

  const host = q("[data-map-host]");
  const select = q("[data-map-note]");
  const source = q("[data-map-source]");
  const empty = q("[data-map-empty]");
  const status = q("[data-map-status]");
  const nodesNode = q("[data-map-nodes]");
  const depthNode = q("[data-map-depth]");
  if (!host || !source) return;

  const state = { title: "导图", slug: "", timer: 0 };

  const controller = window.KawaiiMindmap.mount(host, {
    onSelect(node) {
      setStatus(`${node.heading ? "标题" : "条目"} · 第 ${node.line + 1} 行 · ${node.children.length} 个分支`);
    },
    onLocate(node) {
      locate(node);
    }
  });

  function setStatus(text) {
    if (status) status.textContent = text || "";
  }

  function stats(tree) {
    let nodes = 0;
    let depth = 0;
    (function walk(node, level) {
      nodes += 1;
      depth = Math.max(depth, level);
      node.children.forEach((kid) => walk(kid, level + 1));
    })(tree, 0);
    return { nodes, depth };
  }

  function sourceOf(note) {
    if (note.source) return note.source;
    const toc = Array.isArray(note.toc) ? note.toc : [];
    return toc.map((item) => `${"#".repeat(item.depth)} ${item.text}`).join("\n");
  }

  function render({ quiet = false } = {}) {
    const text = source.value.trim();
    if (empty) empty.hidden = Boolean(text);
    if (!text) {
      host.innerHTML = "";
      if (nodesNode) nodesNode.textContent = "0";
      if (depthNode) depthNode.textContent = "0";
      if (!quiet) setStatus("");
      return;
    }
    controller.setSource(source.value, { title: state.title, slug: state.slug });
    const audit = stats(controller.tree);
    if (nodesNode) nodesNode.textContent = audit.nodes;
    if (depthNode) depthNode.textContent = audit.depth;
    if (!quiet) setStatus(`${state.title} · ${audit.nodes} 个节点 · ${audit.depth + 1} 层`);
  }

  function locate(node) {
    const lines = source.value.split("\n");
    let start = 0;
    for (let i = 0; i < node.line && i < lines.length; i += 1) start += lines[i].length + 1;
    const end = start + (lines[node.line] || "").length;
    source.focus();
    source.setSelectionRange(start, end);
    const lineHeight = parseFloat(getComputedStyle(source).lineHeight) || 22;
    source.scrollTop = Math.max(0, node.line * lineHeight - source.clientHeight / 2);
    setStatus(`已定位到第 ${node.line + 1} 行`);
  }

  function loadNote(note) {
    state.title = note.title;
    state.slug = note.slug;
    source.value = sourceOf(note);
    render();
  }

  if (select) {
    const notes = Kawaii.notes.all;
    select.innerHTML =
      '<option value="">— 选择一篇 —</option>' +
      notes.map((note) => `<option value="${escape(note.slug)}">${escape(note.date)} · ${escape(note.title)}</option>`).join("");
    select.addEventListener("change", () => {
      const note = Kawaii.notes.find(select.value);
      if (!note) {
        state.title = "导图";
        state.slug = "";
        source.value = "";
        render();
        return;
      }
      loadNote(note);
    });
    const wanted = getQuery("slug");
    const initial = notes.find((note) => note.slug === wanted) || notes[0];
    if (initial) {
      select.value = initial.slug;
      loadNote(initial);
    }
  }

  source.addEventListener("input", () => {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => render(), 260);
  });

  const action = (selector, handler) => {
    const button = q(selector);
    if (button) button.addEventListener("click", handler);
  };

  action("[data-map-expand]", () => {
    controller.expandAll();
    setStatus("已展开全部节点");
  });
  action("[data-map-collapse]", () => {
    controller.collapseTo(2);
    setStatus("已折叠到二级");
  });
  action("[data-map-reset]", () => {
    controller.resetView();
    setStatus("视图已重置");
  });
  action("[data-map-embed]", async () => {
    const value = source.value.trim();
    if (!value) {
      setStatus("先载入或粘贴一份 Markdown，再复制嵌入片段。");
      return;
    }
    const fence = "```mindmap\n" + value + "\n```\n";
    try {
      await navigator.clipboard.writeText(fence);
      setStatus("已复制嵌入片段，粘到写作台或文章里即可显示导图。");
    } catch (error) {
      setStatus("复制失败，请手动选中左边源文。");
    }
  });
  action("[data-map-svg]", () => {
    controller.exportSvg();
    setStatus("已导出 SVG");
  });
  action("[data-map-png]", async () => {
    try {
      await controller.exportPng();
      setStatus("已导出 PNG");
    } catch (error) {
      setStatus(`PNG 导出失败：${error.message}`);
    }
  });

  const workspace = q(".map-workspace");
  const sourceToggle = q("[data-map-source-toggle]");
  if (sourceToggle && workspace) {
    sourceToggle.addEventListener("click", () => {
      const collapsed = workspace.classList.toggle("is-source-collapsed");
      sourceToggle.textContent = collapsed ? "展开" : "收起";
      window.setTimeout(() => controller.render(), 60);
    });
  }

  document.addEventListener("kawaii:skinchange", () => {
    if (source.value.trim()) controller.render();
  });

  render();
})();
