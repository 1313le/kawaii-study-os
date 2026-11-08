/* =========================================================
   kawaii / STUDY OS — site shell + shared data layer
   ========================================================= */

(function () {
  "use strict";

  const SITE = window.SITE || {};
  const NOTES = Array.isArray(window.NOTES) ? window.NOTES : [];
  const NOTES_META = window.NOTES_META || {};

  const ACCENTS = {
    lime: "var(--accent-2)",
    pink: "var(--accent)",
    cyan: "var(--accent-3)",
    amber: "var(--accent-4)"
  };

  /* ---------- tiny helpers ---------- */

  function q(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function stripTags(value) {
    return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  function formatDate(value) {
    if (!value) return "—";
    const text = String(value).slice(0, 10);
    return text.replace(/-/g, ".");
  }

  function formatDateCn(value) {
    if (!value) return "—";
    const parts = String(value).slice(0, 10).split("-");
    if (parts.length !== 3) return value;
    return `${parts[0]} 年 ${Number(parts[1])} 月 ${Number(parts[2])} 日`;
  }

  function accentVar(name) {
    return ACCENTS[name] || "var(--accent)";
  }

  function siteText(key, fallback) {
    return SITE[key] != null && SITE[key] !== "" ? SITE[key] : fallback;
  }

  function getQuery(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (error) {
      return null;
    }
  }

  function prefersReduced() {
    const motion = document.documentElement.dataset.motion;
    if (motion === "full") return false;
    if (motion === "reduced") return true;
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (error) {
      return false;
    }
  }

  /* ---------- notes helpers ---------- */

  const sortedNotes = NOTES.slice().sort((a, b) => {
    const da = String(a.date || "");
    const db = String(b.date || "");
    return db.localeCompare(da);
  });

  const noteMap = new Map(sortedNotes.map((note) => [note.slug, note]));

  const collectionCounts = new Map();
  sortedNotes.forEach((note) => {
    const name = String(note.collection || "随笔");
    collectionCounts.set(name, (collectionCounts.get(name) || 0) + 1);
  });
  const collectionsList = Array.from(collectionCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));

  const notes = {
    all: sortedNotes,
    meta: NOTES_META,
    find(slug) {
      return noteMap.get(slug) || null;
    },
    latest(count) {
      return sortedNotes.slice(0, count || 3);
    },
    byTag(tag) {
      return sortedNotes.filter((note) => (note.tags || []).includes(tag));
    },
    byCollection(name) {
      return sortedNotes.filter((note) => String(note.collection || "随笔") === name);
    },
    collections() {
      return collectionsList;
    },
    tags() {
      const counts = new Map();
      sortedNotes.forEach((note) => {
        (note.tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
      });
      return Array.from(counts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));
    },
    search(query) {
      const needle = String(query || "").trim().toLowerCase();
      if (!needle) return sortedNotes;
      const terms = needle.split(/\s+/).filter(Boolean);
      return sortedNotes.filter((note) => {
        const haystack = [
          note.title,
          note.summary,
          (note.tags || []).join(" "),
          note.collection,
          stripTags(note.text || "")
        ]
          .join(" ")
          .toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
    }
  };

  /* ---------- writing stats ---------- */

  const goalNotes = Number(SITE.goalNotes) > 0 ? Number(SITE.goalNotes) : 100;

  const stats = {
    notes: sortedNotes.length,
    words: sortedNotes.reduce((sum, note) => sum + (Number(note.words) || 0), 0),
    tags: notes.tags().length,
    collections: collectionsList.length,
    goal: goalNotes,
    pct() {
      return Math.min(100, Math.round((sortedNotes.length / goalNotes) * 100));
    }
  };

  /* ---------- footer LED sign ---------- */

  function syncWordmark() {
    const pct = stats.pct();
    qa(".footer-wordmark").forEach((sign) => {
      const changed = sign.dataset.led !== undefined && sign.dataset.led !== String(pct);
      sign.dataset.led = String(pct);
      sign.style.setProperty("--led", pct + "%");
      if (changed && sign.classList.contains("is-lit")) {
        sign.classList.remove("is-lit");
        void sign.offsetWidth;
        sign.classList.add("is-lit");
      }
    });
    qa("[data-footer-goal]").forEach((node) => {
      node.textContent = `WRITING GOAL ${pct}% · ${stats.notes}/${stats.goal}`;
    });
  }

  function initWordmark() {
    const signs = qa(".footer-wordmark");
    if (!signs.length) return;
    syncWordmark();
    const fxAllowed = () => !window.KawaiiTheme || window.KawaiiTheme.fxOn();
    const light = (sign) => {
      if (prefersReduced() || !fxAllowed()) return;
      sign.classList.add("is-lit");
    };
    if (!("IntersectionObserver" in window)) {
      signs.forEach(light);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        light(entry.target);
      });
    }, { threshold: 0.35 });
    signs.forEach((sign) => {
      observer.observe(sign);
      sign.addEventListener("pointerenter", () => {
        if (prefersReduced() || !fxAllowed() || !sign.classList.contains("is-lit")) return;
        sign.classList.remove("is-lit");
        void sign.offsetWidth;
        sign.classList.add("is-lit");
      });
    });
  }

  /* ---------- header / footer ---------- */

  // The masthead mark is the delivered catgirl portrait itself, cropped from
  // avatar-catgirl.png at the ear tips and chin. The line-skin hero keeps
  // rasterising the same full portrait, so the small mark and the field share
  // one face. The light rim is CSS; the asset stays transparent.
  const MARK = {
    src: "assets/img/avatar-mark.png",
    size: 24
  };

  // Kept for the linefield fallback and existing emblem tests.
  const EMBLEM = {
    size: 120,
    faces: [
      { points: "26,39 60,56 60,90 26,73", tone: 0.3 },
      { points: "60,56 94,39 94,73 60,90", tone: 0.5 },
      { points: "60,22 94,39 60,56 26,39", tone: 0.72 },
      { points: "60,30 77,38.5 60,47 43,38.5", tone: 1 },
      { points: "26,45 12,52 12,55 26,48", tone: 1 },
      { points: "26,55 12,62 12,65 26,58", tone: 1 },
      { points: "26,65 12,72 12,75 26,68", tone: 1 },
      { points: "94,45 108,52 108,55 94,48", tone: 1 },
      { points: "94,55 108,62 108,65 94,58", tone: 1 },
      { points: "94,65 108,72 108,75 94,68", tone: 1 }
    ]
  };

  function emblemMark(className) {
    return `<img class="${className}" data-emblem-mark src="${MARK.src}" alt="" width="${MARK.size}" height="${MARK.size}" decoding="async" draggable="false">`;
  }

  const NAV_ITEMS = [
    { page: "home", href: "index.html", label: "首页", index: "01" },
    { page: "logs", href: "logs.html", label: "文章", index: "02" },
    { page: "resources", href: "resources.html", label: "资源", index: "03" },
    { page: "about", href: "about.html", label: "关于", index: "04" }
  ];

  function renderHeader() {
    const host = q("[data-site-header]");
    if (!host) return;
    const page = document.body.dataset.page || "";
    const activePage = page === "note" ? "logs" : page;
    const links = NAV_ITEMS.map(
      (item) =>
        `<a class="nav__link" href="${item.href}" data-nav="${item.page}"${
          item.page === activePage ? ' aria-current="page"' : ""
        }><span class="nav__index">${item.index}</span>${item.label}</a>`
    ).join("");

    host.innerHTML = `<div class="masthead__inner container">
  <a class="brand" href="index.html" aria-label="${escapeHtml(siteText("brand", "kawaii"))} / STUDY OS 首页">
    ${emblemMark("brand__mark")}
    <span class="brand__name">${escapeHtml(siteText("brand", "kawaii"))}</span>
    <span class="brand__suffix">/ ${escapeHtml(siteText("system", "STUDY OS"))}</span>
  </a>
  <nav class="nav" aria-label="主导航">${links}</nav>
  <div class="masthead__tools">
    <span class="sys-clock" data-clock aria-hidden="true">--:--:--</span>
    <button class="icon-btn" type="button" data-daynight-toggle aria-label="切换日夜模式" aria-pressed="false">
      <span class="icon-btn__glyph" data-daynight-glyph aria-hidden="true">◐</span>
      <span data-daynight-label>AUTO</span>
    </button>
    <button class="icon-btn" type="button" data-theme-toggle aria-label="切换主题" aria-pressed="false">
      <span class="icon-btn__glyph" data-theme-glyph aria-hidden="true">▚</span>
      <span data-theme-label>PIXEL</span>
    </button>
    <button class="icon-btn" type="button" data-fx-toggle aria-label="关闭动效" aria-pressed="true">
      <span data-fx-label>FX ON</span>
    </button>
    <button class="icon-btn icon-btn--terminal" type="button" data-terminal-open aria-label="打开终端（快捷键 ~）">
      <span aria-hidden="true">&gt;_</span><span class="icon-btn__key">~</span>
    </button>
    <a class="icon-btn icon-btn--author" href="write.html" aria-label="作者入口" title="作者入口">
      <span aria-hidden="true">✎</span>
    </a>
  </div>
</div>`;
  }

  function initReadingBar() {
    const bar = document.createElement("div");
    bar.className = "reading-bar";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);
    let queued = false;
    const update = () => {
      queued = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      bar.style.transform = "scaleX(" + ratio.toFixed(4) + ")";
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    update();
  }

  function renderFooter() {
    const host = q("[data-site-footer]");
    if (!host) return;
    const nav = NAV_ITEMS.map(
      (item) => `<a href="${item.href}">${item.index} / ${item.label}</a>`
    ).join("");
    const year = new Date().getFullYear();
    const synced = formatDate(NOTES_META.updated || SITE.startDate);
    host.innerHTML = `<div class="container footer-inner">
  <div class="footer-top">
    <div class="footer-brand">
      <span class="footer-brand__line">${emblemMark("footer-mark")}${escapeHtml(siteText("brand", "kawaii"))}</span>
      <p class="footer-tagline">${escapeHtml(siteText("tagline", ""))}</p>
      <p>${escapeHtml(siteText("description", ""))}</p>
    </div>
    <nav class="footer-nav" aria-label="页脚导航">
      <span class="footer-nav__label">SITEMAP / 导航</span>
      ${nav}
    </nav>
    <div class="footer-status">
      <span class="footer-status__label">SYSTEM / 状态</span>
      <span class="status-line"><i class="dot" aria-hidden="true"></i>${escapeHtml(siteText("status", "SYSTEM ONLINE"))}</span>
      <span>BUILD ${escapeHtml(siteText("version", "v1.0.0"))} · EST. ${escapeHtml(siteText("established", "2026"))}</span>
      <span>LAST SYNC ${escapeHtml(synced)} · ${NOTES_META.count || NOTES.length} NOTES</span>
      <span data-footer-goal>WRITING GOAL —</span>
    </div>
  </div>
  <div class="footer-wordmark" aria-hidden="true">${escapeHtml(siteText("brand", "kawaii"))}<span class="footer-wordmark__led">${escapeHtml(siteText("brand", "kawaii"))}</span></div>
  <div class="footer-bottom">
    <span>© ${year} ${escapeHtml(siteText("brand", "kawaii"))} · BUILT WITH HTML / CSS / JS · ${escapeHtml(siteText("footerNote", "BUILD / FLASH / LOG / REPEAT"))}</span>
    <span>PRESS <kbd>~</kbd> FOR TERMINAL · <a href="#top">BACK TO TOP ↑</a></span>
  </div>
</div>`;
  }

  function renderSocials() {
    qa("[data-socials]").forEach((host) => {
      const socials = Array.isArray(SITE.socials) ? SITE.socials : [];
      host.innerHTML = socials
        .map((item) => {
          const label = `${escapeHtml(item.label || item.id)} · ${escapeHtml(item.handle || "")}`;
          if (item.href) {
            return `<a class="contact-link" href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer"><span class="contact-link__id">${escapeHtml(item.id || "link")}</span>${label}<span aria-hidden="true">↗</span></a>`;
          }
          return `<span class="contact-link contact-link--static" aria-disabled="true"><span class="contact-link__id">${escapeHtml(item.id || "link")}</span>${label}</span>`;
        })
        .join("");
    });
  }

  function applySiteText() {
    qa("[data-site-text]").forEach((node) => {
      const key = node.dataset.siteText;
      if (SITE[key] != null && SITE[key] !== "") node.textContent = SITE[key];
    });
    qa("[data-stat]").forEach((node) => {
      const key = node.dataset.stat;
      const values = {
        notes: stats.notes,
        words: stats.words,
        tags: stats.tags,
        collections: stats.collections,
        goal: stats.goal
      };
      if (values[key] != null) node.textContent = values[key];
    });
    qa("[data-year]").forEach((node) => {
      node.textContent = String(new Date().getFullYear());
    });
  }

  /* ---------- clock ---------- */

  function initClock() {
    const nodes = qa("[data-clock]");
    if (!nodes.length) return;
    const tick = () => {
      const now = new Date();
      const text = [now.getHours(), now.getMinutes(), now.getSeconds()]
        .map((value) => String(value).padStart(2, "0"))
        .join(":");
      nodes.forEach((node) => {
        node.textContent = text;
      });
    };
    tick();
    window.setInterval(tick, 1000);
  }

  /* ---------- reveal ---------- */

  let revealObserver = null;

  function reveal(root) {
    const items = qa(".reveal:not(.is-in)", root);
    if (!items.length) return;
    if (prefersReduced() || !("IntersectionObserver" in window)) {
      items.forEach((item) => item.classList.add("is-in"));
      return;
    }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-in");
              revealObserver.unobserve(entry.target);
            }
          });
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
      );
    }
    items.forEach((item) => revealObserver.observe(item));
  }

  function observeArticle(article) {
    if (!article) return;
    const blocks = qa(":scope > *", article);
    if (!blocks.length) return;
    blocks.forEach((block) => block.classList.add("reveal-block"));
    if (prefersReduced() || !("IntersectionObserver" in window)) {
      blocks.forEach((block) => block.classList.add("is-in"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.06 }
    );
    blocks.forEach((block) => observer.observe(block));
  }

  /* ---------- boot screen ---------- */

  function initBoot() {
    const screen = q("#boot-screen");
    const booting = document.documentElement.classList.contains("boot-on");
    if (!screen || !booting) return;
    try {
      sessionStorage.setItem("kawaii.booted", "1");
    } catch (error) {
      /* ignore */
    }

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      screen.classList.add("is-done");
      document.documentElement.classList.remove("boot-on");
      window.setTimeout(() => {
        screen.setAttribute("hidden", "");
      }, 450);
      document.removeEventListener("keydown", finish, true);
      screen.removeEventListener("click", finish);
    };

    screen.addEventListener("click", finish);
    document.addEventListener("keydown", finish, true);
    window.setTimeout(finish, prefersReduced() ? 100 : 1500);
  }

  /* ---------- init ---------- */

  function init() {
    renderHeader();
    renderFooter();
    renderSocials();
    applySiteText();
    initWordmark();
    initClock();
    reveal(document);
    initBoot();

    if (window.KawaiiTheme) window.KawaiiTheme.init();

    document.addEventListener("kawaii:fxchange", (event) => {
      const lit = !!(event.detail && event.detail.on) && !prefersReduced();
      qa(".footer-wordmark").forEach((sign) => sign.classList.toggle("is-lit", lit));
    });

    initReadingBar();

    document.addEventListener("kawaii:motionchange", (event) => {
      if (!event.detail || event.detail.mode !== "full") return;
      qa(".footer-wordmark").forEach((sign) => sign.classList.add("is-lit"));
    });
  }

  const KIND_LABELS = {
    article: "日志",
    concept: "概念卡",
    experiment: "实验记录",
    debug: "排障记录",
    cornell: "问答笔记",
    review: "周复盘"
  };

  const kindLabel = (kind) => KIND_LABELS[kind] || KIND_LABELS.article;

  window.Kawaii = {
    site: SITE,
    notes,
    stats,
    emblem: EMBLEM,
    logo: MARK,
    ui: {
      q,
      qa,
      escape: escapeHtml,
      stripTags,
      formatDate,
      formatDateCn,
      accentVar,
      siteText,
      getQuery,
      kindLabel,
      prefersReduced,
      reveal,
      observeArticle
    }
  };

  init();
})();