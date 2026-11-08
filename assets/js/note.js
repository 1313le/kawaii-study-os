/* =========================================================
   kawaii / STUDY OS — note page
   ========================================================= */

(function () {
  "use strict";

  const Kawaii = window.Kawaii;
  if (!Kawaii) return;
  const { q, qa, escape, formatDate, accentVar, getQuery, kindLabel, prefersReduced, reveal } = Kawaii.ui;
  const { notes, site } = Kawaii;

  const page = q("[data-note-page]");
  const titleNode = q("[data-note-title]");
  const summaryNode = q("[data-note-summary]");
  const metaNode = q("[data-note-meta]");
  const kickerNode = q("[data-note-kicker]");
  const breadcrumbNode = q("[data-note-breadcrumb]");
  const article = q("[data-note-article]");
  const tocNode = q("[data-toc]");
  const tagsNode = q("[data-note-tags]");
  const backlinksNode = q("[data-note-backlinks]");
  const navNode = q("[data-note-nav]");
  const coverNode = q("[data-note-cover]");
  const readingFill = q("[data-reading-fill]");

  const slug = getQuery("slug") || (notes.latest(1)[0] || {}).slug;
  const note = notes.find(slug);

  if (!note) {
    if (titleNode) titleNode.textContent = "404 / NOTE NOT FOUND";
    if (summaryNode) summaryNode.textContent = "找不到这篇文章。它可能被移动、重命名，或还没有被构建进 data/notes.generated.js。";
    if (metaNode) {
      metaNode.innerHTML = `<span>CHECK THE SLUG</span><span class="sep">/</span><a href="logs.html">返回日志 →</a>`;
    }
    if (article) {
      article.innerHTML = `<p>试试从 <a href="logs.html">学习日志</a> 进入，或者在终端里运行 <code>ls notes</code> 查看全部条目。</p>`;
    }
    if (tocNode && tocNode.closest(".note-aside")) tocNode.closest(".note-aside").hidden = true;
    if (backlinksNode) backlinksNode.hidden = true;
    return;
  }

  /* ---------- header ---------- */

  document.title = `${note.title} · ${site.brand || "kawaii"} / ${site.system || "STUDY OS"}`;
  const desc = document.querySelector('meta[name="description"]');
  if (desc && note.summary) desc.setAttribute("content", note.summary);

  if (page) {
    page.dataset.noteFx = note.fx || "none";
    page.style.setProperty("--note-accent", accentVar(note.accent));
  }

  if (breadcrumbNode) {
    const crumbs = [
      `<a href="index.html">首页</a>`,
      `<span class="sep" aria-hidden="true">/</span>`,
      `<a href="logs.html">笔记库</a>`
    ];
    if (note.collection) {
      crumbs.push(
        `<span class="sep" aria-hidden="true">/</span>`,
        `<a href="logs.html?collection=${encodeURIComponent(note.collection)}">${escape(note.collection)}</a>`
      );
    }
    crumbs.push(
      `<span class="sep" aria-hidden="true">/</span>`,
      `<span class="current">${escape(note.title)}</span>`
    );
    breadcrumbNode.innerHTML = crumbs.join("");
  }

  if (kickerNode) {
    const items = [
      `<span class="tag tag--kind">${escape(kindLabel(note.kind))}</span>`
    ];
    if (note.collection) items.push(`<a class="tag" href="logs.html?collection=${encodeURIComponent(note.collection)}">${escape(note.collection)}</a>`);
    items.push(`<span class="tag">FX / ${escape(String(note.fx || "none").toUpperCase())}</span>`);
    kickerNode.innerHTML = items.join("");
  }

  if (titleNode) titleNode.textContent = note.title;
  if (summaryNode) summaryNode.textContent = note.summary || "";

  if (metaNode) {
    metaNode.innerHTML = `<span>${formatDate(note.date)}</span>
<span class="sep" aria-hidden="true">/</span>
<span><b>${note.minutes}</b> MIN READ</span>
<span class="sep" aria-hidden="true">/</span>
<span>${Number(note.words || 0).toLocaleString("en-US")} WORDS</span>
<span class="sep" aria-hidden="true">/</span>
<a href="logs.html?collection=${encodeURIComponent(note.collection || "")}">${escape(note.collection || "随笔")}</a>`;
  }

  if (coverNode) {
    const media = window.KawaiiCover
      ? window.KawaiiCover.media(note)
      : `<img src="${escape(note.cover)}" alt="${escape(note.title)} 封面" decoding="async">`;
    coverNode.innerHTML = `${media}<figcaption class="note-cover__caption">NOTE COVER / ${escape(note.slug.toUpperCase())}</figcaption>`;
    coverNode.hidden = false;
  }

  /* ---------- metrics ---------- */

  const metricsApi = window.KawaiiMetrics;
  if (metricsApi) {
    const viewsNode = q("[data-note-views]");
    const likesNode = q("[data-note-likes]");
    const favoritesNode = q("[data-note-favorites]");
    const likeButton = q("[data-note-like]");
    const favoriteButton = q("[data-note-favorite]");
    const likeIcon = likeButton ? likeButton.querySelector(".note-reactions__icon") : null;
    const favoriteIcon = favoriteButton ? favoriteButton.querySelector(".note-reactions__icon") : null;
    const paint = () => {
      const counts = metricsApi.counts(note.slug);
      const mine = metricsApi.mine(note.slug);
      if (viewsNode) viewsNode.textContent = Number(counts.views || 0).toLocaleString("en-US");
      if (likesNode) likesNode.textContent = Number(counts.likes || 0).toLocaleString("en-US");
      if (favoritesNode) favoritesNode.textContent = Number(counts.favorites || 0).toLocaleString("en-US");
      if (likeButton) likeButton.setAttribute("aria-pressed", mine.like ? "true" : "false");
      if (favoriteButton) favoriteButton.setAttribute("aria-pressed", mine.favorite ? "true" : "false");
      if (likeIcon) likeIcon.textContent = mine.like ? "♥" : "♡";
      if (favoriteIcon) favoriteIcon.textContent = mine.favorite ? "★" : "☆";
    };
    paint();
    metricsApi.ready().then(() => {
      paint();
      metricsApi.view(note.slug);
    });
    metricsApi.subscribe(() => paint());
    if (likeButton) {
      likeButton.addEventListener("click", () => {
        metricsApi.react(note.slug, "like", !metricsApi.mine(note.slug).like);
      });
    }
    if (favoriteButton) {
      favoriteButton.addEventListener("click", () => {
        metricsApi.react(note.slug, "favorite", !metricsApi.mine(note.slug).favorite);
      });
    }
  }

  /* ---------- article ---------- */

  if (article) {
    article.innerHTML = note.html || "";
    if (window.KawaiiCodeTools) qa(".code-block", article).forEach((block) => window.KawaiiCodeTools.enhance(block));
    if (window.KawaiiDiagramTools) qa(".diagram-block", article).forEach((block) => window.KawaiiDiagramTools.enhance(block));
    if (window.KawaiiLabTools) window.KawaiiLabTools.render(article);
  }

  /* ---------- embedded mind maps ---------- */

  const embeddedMaps = [];

  function renderEmbeddedMaps() {
    if (!article || !window.KawaiiMindmap) return;
    qa(".mindmap-embed", article).forEach((embed) => {
      const sourceNode = embed.querySelector(".mindmap-embed__source");
      const host = embed.querySelector(".mindmap-embed__host");
      if (!sourceNode || !host) return;
      sourceNode.hidden = true;
      const controller = window.KawaiiMindmap.mount(host, {});
      controller.setSource(sourceNode.textContent || "", { title: `${note.title} · 导图`, slug: note.slug });
      embeddedMaps.push(controller);
    });
  }

  renderEmbeddedMaps();

  /* ---------- interactive checklists ---------- */

  const TASKS_KEY = "kawaii.tasks.v1";

  function readTaskState() {
    try {
      const all = JSON.parse(localStorage.getItem(TASKS_KEY) || "{}");
      return all && typeof all === "object" ? all : {};
    } catch (error) {
      return {};
    }
  }

  function setupChecklist() {
    if (!article) return;
    const boxes = qa('.article input[type="checkbox"]');
    if (!boxes.length) return;
    const stored = readTaskState()[note.slug] || [];
    boxes.forEach((box, index) => {
      box.disabled = false;
      box.dataset.taskIndex = String(index);
      box.checked = stored[index] === true;
      box.removeAttribute("aria-hidden");
      const item = box.closest("li");
      if (item) item.classList.toggle("is-checked", box.checked);
    });

    const bar = q("[data-note-taskbar]");
    const updateMeter = () => {
      const done = boxes.filter((box) => box.checked).length;
      if (!bar) return;
      bar.hidden = false;
      bar.innerHTML = `<span class="note-taskbar__label">CHECKLIST / 清单</span>
<span class="note-taskbar__count"><b>${done}</b> / ${boxes.length}</span>
<span class="note-taskbar__bar"><i style="width:${Math.round((done / boxes.length) * 100)}%"></i></span>
<span class="note-taskbar__hint">勾选会记住在这台浏览器</span>`;
    };

    boxes.forEach((box) => {
      box.addEventListener("change", () => {
        const next = readTaskState();
        const list = Array.isArray(next[note.slug]) ? next[note.slug].slice() : [];
        list[Number(box.dataset.taskIndex)] = box.checked;
        next[note.slug] = list;
        try {
          localStorage.setItem(TASKS_KEY, JSON.stringify(next));
        } catch (error) {
          /* storage may be full; the checkbox still reflects this visit */
        }
        const item = box.closest("li");
        if (item) item.classList.toggle("is-checked", box.checked);
        updateMeter();
      });
    });
    updateMeter();
  }

  setupChecklist();

  /* ---------- mind map view ---------- */

  const mapPanel = q("[data-note-map]");
  const mapHost = q("[data-note-map-host]");
  const mapToggle = q("[data-note-map-toggle]");
  const mapClose = q("[data-note-map-close]");
  const mapStatus = q("[data-note-map-status]");
  const mapHidden = new Map();
  let mapController = null;
  let mapOpen = false;

  function noteSource() {
    if (note.source) return note.source;
    const toc = Array.isArray(note.toc) ? note.toc : [];
    return toc.map((item) => `${"#".repeat(item.depth)} ${item.text}`).join("\n");
  }

  function setMapStatus(text) {
    if (mapStatus) mapStatus.textContent = text || "";
  }

  function hideForMap(node) {
    if (!node) return;
    mapHidden.set(node, node.hidden);
    node.hidden = true;
  }

  function restoreForMap(node) {
    if (!node) return;
    if (mapHidden.has(node)) node.hidden = mapHidden.get(node);
  }

  function openMap() {
    if (!mapPanel || !mapHost || !window.KawaiiMindmap) return;
    if (!mapController) {
      mapController = window.KawaiiMindmap.mount(mapHost, {
        onSelect(node) {
          setMapStatus(`${node.heading ? "标题" : "条目"} · 第 ${node.line + 1} 行 · ${node.children.length} 个分支`);
        },
        onLocate(node) {
          if (node.tocIndex < 0) {
            setMapStatus("这一条没有对应的小节标题");
            return;
          }
          const item = (note.toc || [])[node.tocIndex];
          const target = item ? document.getElementById(item.id) : null;
          if (!target) {
            setMapStatus("找不到对应章节");
            return;
          }
          closeMap();
          window.setTimeout(() => {
            target.scrollIntoView({ behavior: prefersReduced() ? "auto" : "smooth", block: "start" });
          }, 30);
        }
      });
    }
    mapController.setSource(noteSource(), { title: note.title, slug: note.slug });
    mapOpen = true;
    mapPanel.hidden = false;
    hideForMap(article);
    hideForMap(q("[data-note-taskbar]"));
    hideForMap(backlinksNode);
    hideForMap(tagsNode ? tagsNode.closest(".note-foot") : null);
    hideForMap(navNode);
    setMapStatus(`${note.title} · 单击选中，双击跳到对应章节`);
  }

  function closeMap() {
    if (!mapPanel) return;
    mapOpen = false;
    mapPanel.hidden = true;
    restoreForMap(article);
    restoreForMap(q("[data-note-taskbar]"));
    restoreForMap(backlinksNode);
    restoreForMap(tagsNode ? tagsNode.closest(".note-foot") : null);
    restoreForMap(navNode);
    measure();
    updateReading();
  }

  if (mapToggle) mapToggle.addEventListener("click", () => (mapOpen ? closeMap() : openMap()));
  if (mapClose) mapClose.addEventListener("click", closeMap);
  if (tocNode) {
    tocNode.addEventListener("click", (event) => {
      if (mapOpen && event.target.closest("a")) closeMap();
    });
  }
  document.addEventListener("kawaii:skinchange", () => {
    if (mapOpen && mapController) mapController.render();
    embeddedMaps.forEach((controller) => controller.render());
  });
  document.addEventListener("kawaii:daynightchange", () => {
    if (mapOpen && mapController) mapController.render();
    embeddedMaps.forEach((controller) => controller.render());
  });

  if (backlinksNode) {
    const list = Array.isArray(note.backlinks) ? note.backlinks : [];
    const links = q("[data-note-backlinks-list]", backlinksNode);
    if (links) {
      links.innerHTML = list
        .map(
          (item) =>
            `<li><a href="note.html?slug=${encodeURIComponent(item.slug)}">${escape(item.title)}</a></li>`
        )
        .join("");
    }
    backlinksNode.hidden = !list.length;
  }

  /* ---------- toc ---------- */

  const headings = [];
  if (tocNode) {
    const toc = Array.isArray(note.toc) ? note.toc : [];
    if (!toc.length) {
      tocNode.innerHTML = `<li class="toc-empty"><span>— NO SECTIONS —</span></li>`;
    } else {
      tocNode.innerHTML = toc
        .map(
          (item) =>
            `<li class="toc-h${item.depth}"><a href="#${escape(item.id)}">${escape(item.text)}</a></li>`
        )
        .join("");
      tocNode.querySelectorAll("a").forEach((link) => {
        const id = link.getAttribute("href").slice(1);
        const heading = document.getElementById(id);
        if (heading) headings.push(heading);
      });
    }
  }

  /* ---------- tags / nav ---------- */

  if (tagsNode) {
    tagsNode.innerHTML = (note.tags || [])
      .map((tag) => `<a class="tag" href="logs.html?tag=${encodeURIComponent(tag)}">${escape(tag)}</a>`)
      .join("");
  }

  if (navNode) {
    const list = notes.all;
    const index = list.findIndex((item) => item.slug === note.slug);
    const newer = index > 0 ? list[index - 1] : null;
    const older = index >= 0 && index < list.length - 1 ? list[index + 1] : null;
    navNode.innerHTML = `${
      newer
        ? `<a class="note-nav__item" href="note.html?slug=${encodeURIComponent(newer.slug)}"><span class="note-nav__dir">← NEWER / 更新</span><span class="note-nav__title">${escape(newer.title)}</span></a>`
        : `<span class="note-nav__item note-nav__empty"><span class="note-nav__dir">← NEWER</span><span class="note-nav__title">已经是最新一篇</span></span>`
    }${
      older
        ? `<a class="note-nav__item note-nav__item--next" href="note.html?slug=${encodeURIComponent(older.slug)}"><span class="note-nav__dir">OLDER / 更早 →</span><span class="note-nav__title">${escape(older.title)}</span></a>`
        : `<span class="note-nav__item note-nav__item--next note-nav__empty"><span class="note-nav__dir">OLDER →</span><span class="note-nav__title">已经到最早的日志</span></span>`
    }`;
  }

  /* ---------- reading progress ---------- */

  let articleTop = 0;
  let articleHeight = 1;

  function measure() {
    if (!article) return;
    const rect = article.getBoundingClientRect();
    articleTop = rect.top + window.scrollY;
    articleHeight = Math.max(1, article.offsetHeight);
  }

  function updateReading() {
    if (!readingFill || !article) return;
    const viewport = window.innerHeight;
    const start = articleTop - viewport * 0.25;
    const end = articleTop + articleHeight - viewport * 0.6;
    const ratio = Math.min(1, Math.max(0, (window.scrollY - start) / Math.max(1, end - start)));
    readingFill.style.width = (ratio * 100).toFixed(1) + "%";
  }

  let scrollTick = false;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollTick) return;
      scrollTick = true;
      window.requestAnimationFrame(() => {
        updateReading();
        updateTocActive();
        scrollTick = false;
      });
    },
    { passive: true }
  );

  window.addEventListener("resize", () => {
    measure();
    updateReading();
  });

  /* ---------- toc active ---------- */

  let activeHeading = null;

  function setActiveHeading(heading) {
    if (!tocNode || heading === activeHeading) return;
    activeHeading = heading;
    qa("a", tocNode).forEach((link) => {
      link.classList.toggle("is-active", link.getAttribute("href") === "#" + heading.id);
    });
  }

  function updateTocActive() {
    if (!headings.length) return;
    const marker = window.innerHeight * 0.3;
    let current = headings[0];
    headings.forEach((heading) => {
      if (heading.getBoundingClientRect().top <= marker) current = heading;
    });
    if (current) setActiveHeading(current);
  }

  if (headings.length && "IntersectionObserver" in window && !prefersReduced()) {
    const tocObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveHeading(entry.target);
        });
      },
      { rootMargin: "-18% 0px -68% 0px", threshold: 0 }
    );
    headings.forEach((heading) => tocObserver.observe(heading));
  }

  /* ---------- per-article fx ---------- */

  if (note.fx === "reveal" && article) {
    article.classList.add("article--reveal");
    Kawaii.ui.observeArticle(article);
  }

  if (note.fx === "scan" && article && "ResizeObserver" in window) {
    const measure = () => {
      article.style.setProperty("--article-h", `${article.offsetHeight}px`);
    };
    measure();
    new ResizeObserver(measure).observe(article);
  }

  /* ---------- code copy ---------- */

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        area.remove();
      }
    });
  }

  /* ---------- copy / print ---------- */

  qa("[data-copy-link]").forEach((button) => {
    button.addEventListener("click", () => {
      copyText(window.location.href).then(
        () => {
          button.textContent = "链接已复制 / COPIED";
          window.setTimeout(() => {
            button.textContent = "复制链接";
          }, 1300);
        },
        () => {
          button.textContent = "复制失败";
        }
      );
    });
  });

  /* ---------- print ---------- */

  let printDetails = [];

  function promoteImages() {
    const images = qa("img", article || document);
    images.forEach((img) => {
      if (img.loading === "lazy") img.loading = "eager";
    });
    return Promise.all(
      images.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => {})))
    );
  }

  function printNow() {
    const images = promoteImages();
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    const diagrams = window.KawaiiDiagramTools ? window.KawaiiDiagramTools.ready() : Promise.resolve();
    return diagrams
      .then(() => fonts)
      .then(() => images)
      .then(() => window.print())
      .catch(() => window.print());
  }

  qa("[data-print-page]").forEach((button) => {
    button.addEventListener("click", () => {
      button.disabled = true;
      printNow().then(() => {
        button.disabled = false;
      });
    });
  });

  window.addEventListener("beforeprint", () => {
    document.documentElement.classList.add("is-printing");
    printDetails = qa("article details").map((item) => ({ node: item, open: item.open }));
    printDetails.forEach((item) => {
      item.node.open = true;
    });
    if (window.KawaiiCodeTools) window.KawaiiCodeTools.setPrintState(true);
  });

  window.addEventListener("afterprint", () => {
    document.documentElement.classList.remove("is-printing");
    if (window.KawaiiCodeTools) window.KawaiiCodeTools.setPrintState(false);
    printDetails.forEach((item) => {
      item.node.open = item.open;
    });
    printDetails = [];
  });

  /* ---------- syntax highlight (lazy) ---------- */

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === "1") resolve();
        else {
          existing.addEventListener("load", resolve);
          existing.addEventListener("error", reject);
        }
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.defer = true;
      script.addEventListener("load", () => {
        script.dataset.loaded = "1";
        resolve();
      });
      script.addEventListener("error", reject);
      document.head.appendChild(script);
    });
  }

  if (article && article.querySelector(".code-block")) {
    loadScript("assets/vendor/highlight.min.js")
      .then(() => {
        if (window.KawaiiCodeTools) window.KawaiiCodeTools.rehighlight(article);
      })
      .catch(() => {});
  }

  /* ---------- mermaid ---------- */

  if (article && article.querySelector(".mermaid") && window.KawaiiDiagramTools) {
    window.KawaiiDiagramTools.render();
  }

  /* ---------- lightbox ---------- */

  function initLightbox() {
    const links = qa("[data-lightbox]", article);
    if (!links.length) return;

    const box = document.createElement("div");
    box.className = "lightbox";
    box.hidden = true;
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "图片预览");
    box.innerHTML = `<div class="lightbox__inner">
  <button class="lightbox__close" type="button" aria-label="关闭图片预览">×</button>
  <img class="lightbox__img" alt="">
  <p class="lightbox__caption"></p>
</div>`;
    document.body.appendChild(box);

    const image = q(".lightbox__img", box);
    const caption = q(".lightbox__caption", box);
    const closeButton = q(".lightbox__close", box);
    let trigger = null;

    function close() {
      box.hidden = true;
      document.body.style.overflow = "";
      if (trigger) trigger.focus();
    }

    function open(link) {
      trigger = link;
      const img = q("img", link);
      if (!img) return;
      image.src = img.currentSrc || img.src;
      image.alt = img.alt || "";
      caption.textContent = link.dataset.caption || img.alt || "";
      box.hidden = false;
      document.body.style.overflow = "hidden";
      closeButton.focus();
    }

    links.forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        open(link);
      });
    });

    closeButton.addEventListener("click", close);
    box.addEventListener("click", (event) => {
      if (event.target === box) close();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !box.hidden) close();
    });
  }

  initLightbox();

  /* ---------- bootstrapping ---------- */

  measure();
  updateReading();
  updateTocActive();
  reveal(document);

  /* late layout shifts (fonts, images) can change article height */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      measure();
      updateReading();
    });
  }
  window.addEventListener("load", () => {
    measure();
    updateReading();
  });
})();
