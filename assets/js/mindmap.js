/* =========================================================
   kawaii / STUDY OS — mind map
   Markdown is the source of truth; the map is a derived,
   collapsible two-sided tree rendered as a standalone SVG.
   ========================================================= */

(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const NODE_H = 30;
  const ROOT_H = 40;
  const V_GAP = 12;
  const H_GAP = 58;
  const PAD = 40;
  const FONT_SIZE = 13;
  const ROOT_FONT = 15;
  const MAX_TEXT_W = 210;
  const FONT_STACK = '"Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");

  function textWidth(text, size, bold) {
    measureCtx.font = `${bold ? 600 : 400} ${size}px ${FONT_STACK}`;
    return measureCtx.measureText(String(text)).width;
  }

  function fitText(text, size, bold) {
    const value = String(text || "").trim() || "…";
    if (textWidth(value, size, bold) <= MAX_TEXT_W) return value;
    let cut = value;
    while (cut.length > 1 && textWidth(`${cut}…`, size, bold) > MAX_TEXT_W) cut = cut.slice(0, -1);
    return `${cut}…`;
  }

  function nodeWidth(node) {
    const root = node.depth === 0;
    const size = root ? ROOT_FONT : FONT_SIZE;
    return Math.max(root ? 110 : 84, Math.min(MAX_TEXT_W + 26, textWidth(node.text, size, root) + 26));
  }

  function parse(text, title) {
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    const root = {
      text: String(title || "").trim() || "导图",
      depth: 0,
      line: 0,
      heading: true,
      tocIndex: -1,
      children: [],
      collapsed: false
    };
    const stack = [root];
    let fence = false;
    let tocIndex = 0;
    lines.forEach((line, index) => {
      if (/^\s*```/.test(line)) {
        fence = !fence;
        return;
      }
      if (fence) return;
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
        const parent = stack[stack.length - 1];
        const node = {
          text: heading[2].trim(),
          level,
          depth: parent.depth + 1,
          line: index,
          heading: true,
          tocIndex: tocIndex++,
          children: [],
          collapsed: false
        };
        parent.children.push(node);
        stack.push(node);
        return;
      }
      const item = line.match(/^\s*[-*+]\s+(?:\[[ xX]\]\s*)?(.+)$/);
      if (item && stack.length > 1) {
        const parent = stack[stack.length - 1];
        if (parent.children.length >= 26) return;
        parent.children.push({
          text: item[1].trim(),
          level: parent.level + 1,
          depth: parent.depth + 1,
          line: index,
          heading: false,
          tocIndex: -1,
          children: [],
          collapsed: false
        });
      }
    });

    if (!root.children.length) {
      lines.forEach((line, index) => {
        const value = line.trim();
        if (!value || /^```/.test(value)) return;
        root.children.push({
          text: value.slice(0, 80),
          level: 1,
          depth: 1,
          line: index,
          heading: false,
          tocIndex: -1,
          children: [],
          collapsed: false
        });
      });
    }
    return root;
  }

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const read = (name, fallback) => (cs.getPropertyValue(name) || "").trim() || fallback;
    return {
      ink: read("--ink-1", "#e8e6f0"),
      ink2: read("--ink-2", "#b9b4c9"),
      panel: read("--panel", "#141020"),
      line: read("--line-2", "#3a3350"),
      bg: read("--bg", "#0b0616"),
      rootInk: "#0b0616",
      accents: [
        read("--accent-2", "#b8ff5a"),
        read("--accent", "#ff5fd2"),
        read("--accent-3", "#5fd2ff"),
        read("--accent-4", "#ffb84d")
      ]
    };
  }

  function measure(node) {
    const kids = node.collapsed ? [] : node.children;
    const self = node.depth === 0 ? ROOT_H : NODE_H;
    node._nh = self;
    if (!kids.length) {
      node._h = self;
      return node._h;
    }
    let total = 0;
    kids.forEach((kid, index) => {
      total += measure(kid) + (index ? V_GAP : 0);
    });
    node._h = Math.max(self, total);
    return node._h;
  }

  function place(node, x, y, side) {
    node._x = x;
    node._y = y;
    node._side = side;
    node._w = nodeWidth(node);
    const kids = node.collapsed ? [] : node.children;
    if (!kids.length) return;
    let total = 0;
    kids.forEach((kid, index) => {
      total += kid._h + (index ? V_GAP : 0);
    });
    let cursor = y - total / 2;
    const edge = x + side * (node._w / 2);
    kids.forEach((kid) => {
      const yk = cursor + kid._h / 2;
      const kw = nodeWidth(kid);
      place(kid, edge + side * (H_GAP + kw / 2), yk, side);
      cursor += kid._h + V_GAP;
    });
  }

  function layout(root) {
    measure(root);
    root._x = 0;
    root._y = 0;
    root._side = 0;
    root._w = nodeWidth(root);
    const kids = root.collapsed ? [] : root.children;
    // Balance the two sides greedily while keeping the reading order.
    const sides = { left: { list: [], height: 0 }, right: { list: [], height: 0 } };
    kids.forEach((kid) => {
      measure(kid);
      const bucket = sides.left.height <= sides.right.height ? sides.left : sides.right;
      bucket.list.push(kid);
      bucket.height += kid._h + V_GAP;
    });
    for (const [name, bucket] of Object.entries(sides)) {
      if (!bucket.list.length) continue;
      const side = name === "left" ? -1 : 1;
      const total = bucket.list.reduce((sum, kid, index) => sum + kid._h + (index ? V_GAP : 0), 0);
      let cursor = -total / 2;
      bucket.list.forEach((kid) => {
        const y = cursor + kid._h / 2;
        const kw = nodeWidth(kid);
        place(kid, side * (root._w / 2 + H_GAP + kw / 2), y, side);
        cursor += kid._h + V_GAP;
      });
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    (function walk(node) {
      minX = Math.min(minX, node._x - node._w / 2);
      maxX = Math.max(maxX, node._x + node._w / 2);
      minY = Math.min(minY, node._y - node._nh / 2);
      maxY = Math.max(maxY, node._y + node._nh / 2);
      (node.collapsed ? [] : node.children).forEach(walk);
    })(root);
    return { x: minX - PAD, y: minY - PAD, w: maxX - minX + PAD * 2, h: maxY - minY + PAD * 2 };
  }

  function escapeXml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function edgePath(parent, child) {
    const px = parent.depth === 0 ? parent._x + child._side * (parent._w / 2) : parent._x + parent._side * (parent._w / 2);
    const cx = child._x - child._side * (child._w / 2);
    const mid = (px + cx) / 2;
    return `M ${px.toFixed(1)} ${parent._y.toFixed(1)} C ${mid.toFixed(1)} ${parent._y.toFixed(1)} ${mid.toFixed(1)} ${child._y.toFixed(1)} ${cx.toFixed(1)} ${child._y.toFixed(1)}`;
  }

  function nodeMarkup(node, colors) {
    const root = node.depth === 0;
    const accent = colors.accents[Math.max(0, node.depth - 1) % colors.accents.length];
    const fill = root ? accent : node.heading ? colors.panel : "none";
    const stroke = root ? accent : node.heading ? accent : colors.line;
    const ink = root ? colors.rootInk : node.heading ? colors.ink : colors.ink2;
    const text = fitText(node.text, root ? ROOT_FONT : FONT_SIZE, root);
    const kids = node.depth === 0 ? 0 : node.children.length;
    const badgeX = node._x + node._side * (node._w / 2 + 12);
    const badge = kids
      ? `<g class="mm-badge" data-mm-toggle="${node._id}" transform="translate(${badgeX.toFixed(1)} ${node._y.toFixed(1)})">
          <circle r="7.5" fill="${colors.panel}" stroke="${accent}" stroke-width="1.2"></circle>
          <path d="${node.collapsed ? "M -3 0 H 3 M 0 -3 V 3" : "M -3 0 H 3"}" stroke="${accent}" stroke-width="1.4" stroke-linecap="round"></path>
        </g>`
      : "";
    return `<g class="mm-node${root ? " mm-node--root" : node.heading ? " mm-node--heading" : " mm-node--leaf"}" data-mm-id="${node._id}" data-mm-line="${node.line}" data-mm-toc="${node.tocIndex}" data-mm-heading="${node.heading ? "1" : "0"}">
      <title>${escapeXml(node.text)}${kids ? `（${kids} 个分支）` : ""}</title>
      <rect x="${(node._x - node._w / 2).toFixed(1)}" y="${(node._y - node._nh / 2).toFixed(1)}" width="${node._w.toFixed(1)}" height="${node._nh}" rx="${root ? 9 : 6}" fill="${fill}" stroke="${stroke}" stroke-width="${root ? 0 : 1.1}"${node.collapsed ? ` stroke-dasharray="3 3"` : ""}></rect>
      <text x="${node._x.toFixed(1)}" y="${(node._y + (root ? ROOT_FONT : FONT_SIZE) * 0.36).toFixed(1)}" text-anchor="middle" fill="${ink}" font-family='${FONT_STACK}' font-size="${root ? ROOT_FONT : FONT_SIZE}" font-weight="${root || node.heading ? 600 : 400}">${escapeXml(text)}</text>
      ${badge}
    </g>`;
  }

  function svgMarkup(root, bounds, colors, slug) {
    let id = 0;
    let edges = "";
    let nodes = "";
    (function walk(node) {
      node._id = id++;
      const kids = node.collapsed ? [] : node.children;
      kids.forEach((kid) => {
        edges += `<path class="mm-edge" d="${edgePath(node, kid)}" fill="none" stroke="${colors.line}" stroke-width="1.1" opacity="0.85"></path>`;
        walk(kid);
      });
      nodes += nodeMarkup(node, colors);
    })(root);
    return `<svg class="mindmap-svg" xmlns="${NS}" viewBox="${bounds.x.toFixed(1)} ${bounds.y.toFixed(1)} ${bounds.w.toFixed(1)} ${bounds.h.toFixed(1)}" width="${Math.round(bounds.w)}" height="${Math.round(bounds.h)}" role="img" aria-label="${escapeXml(root.text)} 的思维导图" data-mm-slug="${escapeXml(slug || "")}">
  <rect class="mm-bg" x="${bounds.x.toFixed(1)}" y="${bounds.y.toFixed(1)}" width="${bounds.w.toFixed(1)}" height="${bounds.h.toFixed(1)}" fill="${colors.bg}"></rect>
  <g class="mm-edges">${edges}</g>
  <g class="mm-nodes">${nodes}</g>
</svg>`;
  }

  function mount(host, options = {}) {
    const state = { tree: null, bounds: null, view: null, colors: null, svg: null, slug: "", selected: null };

    function render() {
      if (!host || !state.tree) return;
      state.colors = readColors();
      state.bounds = layout(state.tree);
      host.innerHTML = svgMarkup(state.tree, state.bounds, state.colors, state.slug);
      state.svg = host.querySelector("svg");
      state.view = { ...state.bounds };
      applyView();
      bind();
      if (options.onRender) options.onRender(state);
    }

    function applyView() {
      if (!state.svg || !state.view) return;
      const v = state.view;
      state.svg.setAttribute("viewBox", `${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}`);
    }

    function setSource(text, { title, slug } = {}) {
      state.slug = slug || "";
      state.tree = parse(text, title);
      render();
    }

    function resetView() {
      if (!state.bounds) return;
      state.view = { ...state.bounds };
      applyView();
    }

    function expandAll() {
      (function walk(node) {
        node.collapsed = false;
        node.children.forEach(walk);
      })(state.tree);
      render();
    }

    function collapseTo(level) {
      (function walk(node) {
        node.collapsed = node.children.length > 0 && node.depth >= level;
        if (!node.collapsed) node.children.forEach(walk);
        else node.children.forEach((kid) => (kid.collapsed = false));
      })(state.tree);
      render();
    }

    function findNode(id) {
      let found = null;
      (function walk(node) {
        if (node._id === id) found = node;
        else if (!node.collapsed) node.children.forEach(walk);
      })(state.tree);
      return found;
    }

    function select(node) {
      state.selected = node;
      if (!state.svg) return;
      state.svg.querySelectorAll(".mm-node.is-selected").forEach((el) => el.classList.remove("is-selected"));
      const target = state.svg.querySelector(`[data-mm-id="${node._id}"]`);
      if (target) target.classList.add("is-selected");
      if (options.onSelect) options.onSelect(node);
    }

    function bind() {
      const svg = state.svg;
      if (!svg) return;
      svg.addEventListener("click", (event) => {
        const toggle = event.target.closest("[data-mm-toggle]");
        if (toggle) {
          event.stopPropagation();
          const node = findNode(Number(toggle.dataset.mmToggle));
          if (node && node.children.length) {
            node.collapsed = !node.collapsed;
            render();
          }
          return;
        }
        const group = event.target.closest(".mm-node");
        if (group) {
          const node = findNode(Number(group.dataset.mmId));
          if (node) select(node);
        }
      });
      svg.addEventListener("dblclick", (event) => {
        const group = event.target.closest(".mm-node");
        if (!group) return;
        const node = findNode(Number(group.dataset.mmId));
        if (node && options.onLocate) options.onLocate(node);
      });
      svg.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
          const rect = svg.getBoundingClientRect();
          const factor = Math.exp(event.deltaY * 0.0015);
          const minW = state.bounds.w * 0.22;
          const maxW = state.bounds.w * 4;
          const nextW = Math.max(minW, Math.min(maxW, state.view.w * factor));
          const ratio = nextW / state.view.w;
          const px = (event.clientX - rect.left) / rect.width;
          const py = (event.clientY - rect.top) / rect.height;
          state.view.x += state.view.w * px * (1 - ratio);
          state.view.y += state.view.h * py * (1 - ratio);
          state.view.w = nextW;
          state.view.h *= ratio;
          applyView();
        },
        { passive: false }
      );

      let drag = null;
      svg.addEventListener("pointerdown", (event) => {
        if (event.target.closest(".mm-node")) return;
        drag = { x: event.clientX, y: event.clientY, vx: state.view.x, vy: state.view.y };
        svg.setPointerCapture(event.pointerId);
        svg.classList.add("is-panning");
      });
      svg.addEventListener("pointermove", (event) => {
        if (!drag) return;
        const rect = svg.getBoundingClientRect();
        state.view.x = drag.vx - ((event.clientX - drag.x) / rect.width) * state.view.w;
        state.view.y = drag.vy - ((event.clientY - drag.y) / rect.height) * state.view.h;
        applyView();
      });
      const endDrag = () => {
        drag = null;
        svg.classList.remove("is-panning");
      };
      svg.addEventListener("pointerup", endDrag);
      svg.addEventListener("pointercancel", endDrag);
    }

    function exportMarkup() {
      if (!state.svg || !state.bounds) return "";
      const clone = state.svg.cloneNode(true);
      clone.setAttribute("xmlns", NS);
      clone.setAttribute("width", Math.round(state.bounds.w));
      clone.setAttribute("height", Math.round(state.bounds.h));
      clone.setAttribute("viewBox", `${state.bounds.x.toFixed(1)} ${state.bounds.y.toFixed(1)} ${state.bounds.w.toFixed(1)} ${state.bounds.h.toFixed(1)}`);
      clone.querySelectorAll(".mm-node.is-selected").forEach((el) => el.classList.remove("is-selected"));
      return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
    }

    function download(blob, name) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    function baseName() {
      return (state.slug || (state.tree && state.tree.text) || "mindmap").replace(/[^\w\u4e00-\u9fa5-]+/g, "-");
    }

    function exportSvg() {
      const markup = exportMarkup();
      if (!markup) return;
      download(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }), `${baseName()}.svg`);
    }

    async function exportPng() {
      const markup = exportMarkup();
      if (!markup || !state.bounds) return;
      const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      try {
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error("SVG 渲染失败"));
          image.src = url;
        });
        const scale = 2;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(state.bounds.w * scale);
        canvas.height = Math.round(state.bounds.h * scale);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = state.colors.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        if (png) download(png, `${baseName()}.png`);
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    return {
      setSource,
      render,
      resetView,
      expandAll,
      collapseTo,
      exportSvg,
      exportPng,
      select,
      get tree() {
        return state.tree;
      },
      get svg() {
        return state.svg;
      }
    };
  }

  window.KawaiiMindmap = { parse, mount };
})();
