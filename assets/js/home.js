/* =========================================================
   kawaii / STUDY OS — home page (blog shell)
   ========================================================= */

(function () {
  "use strict";

  const Kawaii = window.Kawaii;
  if (!Kawaii) return;
  const { q, escape, reveal } = Kawaii.ui;
  const { notes } = Kawaii;

  const logHost = q("[data-home-logs]");
  const resHost = q("[data-home-res]");
  const sortButtons = Array.from(document.querySelectorAll("[data-blog-sort]"));
  let sort = "new";

  const FLAGS = { new: "FEATURED / 最新", views: "TOP / 最热", likes: "TOP / 点赞", favorites: "TOP / 收藏" };

  function renderFeed() {
    if (!logHost) return;
    const list = window.KawaiiBlog
      ? window.KawaiiBlog.sortNotes(notes.all, sort).slice(0, 5)
      : notes.latest(5);
    if (!list.length) {
      logHost.innerHTML = `<div class="logs-empty"><p class="logs-empty__title">NO SIGNAL</p><p>还没有文章。运行 npm run build 后生成。</p></div>`;
      return;
    }
    logHost.innerHTML = list
      .map((note, index) =>
        window.KawaiiBlog ? window.KawaiiBlog.rowMarkup(note, { featured: index === 0, flag: FLAGS[sort] || FLAGS.new }) : ""
      )
      .join("");
    reveal(logHost);
  }

  function bindTabs() {
    sortButtons.forEach((button) => {
      button.addEventListener("click", () => {
        sort = button.dataset.blogSort || "new";
        sortButtons.forEach((item) => item.setAttribute("aria-pressed", item === button ? "true" : "false"));
        renderFeed();
      });
    });
  }

  const RES_KIND = { file: "FILE", pdf: "PDF", video: "VIDEO", image: "IMAGE", site: "WEB", netdisk: "NETDISK" };

  async function renderResources() {
    if (!resHost) return;
    let data = null;
    try {
      const response = await fetch("/api/resources", { cache: "no-store" });
      if (response.ok) data = await response.json();
    } catch (error) {
      /* static hosting falls back to the committed json */
    }
    if (!data) {
      try {
        const response = await fetch("data/resources.json", { cache: "no-store" });
        if (response.ok) data = await response.json();
      } catch (error) {
        /* the strip keeps its loading text */
      }
    }
    const items = (data && Array.isArray(data.items) ? data.items : []).slice(0, 3);
    if (!items.length) {
      resHost.innerHTML = `<div class="res-home__empty">
  <p>把常翻的数据手册、课程视频和网盘链接收进同一个抽屉：页内看、直接下、一键新窗口。</p>
  <a class="section-link" href="resources.html">添加第一条资源 <span aria-hidden="true">→</span></a>
</div>`;
      return;
    }
    resHost.innerHTML = `<div class="res-home__grid">${items
      .map(
        (item) => `<a class="res-home__item" href="resources.html">
  <span class="res-home__kind">${escape(RES_KIND[item.kind] || "FILE")}</span>
  <b>${escape(item.title)}</b>
  <small>${escape(item.category || "其他")}${item.host ? ` · ${escape(item.host)}` : ""}</small>
</a>`
      )
      .join("")}</div>
<div class="res-home__foot"><a class="section-link" href="resources.html">全部 ${data.items.length} 条 <span aria-hidden="true">→</span></a></div>`;
    reveal(resHost);
  }

  function init() {
    bindTabs();
    renderFeed();
    renderResources();
    if (window.KawaiiMetrics) {
      window.KawaiiMetrics.ready().then(renderFeed);
      window.KawaiiMetrics.subscribe(renderFeed);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
