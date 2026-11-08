/* =========================================================
   kawaii / STUDY OS — blog shell
   Shared author profile card and CSDN-style article rows for
   the home page and the article library.
   ========================================================= */

(function () {
  "use strict";

  const Kawaii = window.Kawaii;
  if (!Kawaii) return;
  const { escape, formatDate, kindLabel } = Kawaii.ui;
  const { notes, stats, site } = Kawaii;

  function formatCount(value) {
    const n = Number(value) || 0;
    if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, "")}w`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
    return String(n);
  }

  function metricCounts(slug) {
    return window.KawaiiMetrics
      ? window.KawaiiMetrics.counts(slug)
      : { views: 0, likes: 0, favorites: 0 };
  }

  function profileMarkup() {
    const totals = window.KawaiiMetrics ? window.KawaiiMetrics.totals() : { views: 0, likes: 0, favorites: 0 };
    const collections = notes.collections().slice(0, 6);
    const search =
      document.body.dataset.page === "logs"
        ? ""
        : `<form class="blog-profile__search" action="logs.html" method="get" role="search">
  <span class="blog-profile__search-icon" aria-hidden="true">⌕</span>
  <input type="search" name="q" placeholder="搜标题、标签或正文…" aria-label="搜索文章">
  <button type="submit" aria-label="搜索">↵</button>
</form>`;
    return `<div class="blog-profile__avatar catgirl-avatar" data-catgirl data-frame="type">
  <span class="catgirl-avatar__grid" aria-hidden="true"></span>
  <span class="catgirl-avatar__glow" aria-hidden="true"></span>
  <span class="blog-profile__status" aria-hidden="true" title="在线"></span>
  <img class="catgirl-avatar__sprite" data-catgirl-img src="assets/img/catgirl-idle.png" alt="" width="128" height="192" decoding="async">
  <div class="catgirl-avatar__readout" aria-hidden="true">
    <span class="catgirl-avatar__label">STATUS / LIVE</span>
    <span class="catgirl-avatar__caption"><i aria-hidden="true"></i><span data-catgirl-caption>敲代码中</span></span>
  </div>
</div>
<h1 class="blog-profile__name">${escape(site.brand || "kawaii")}</h1>
<p class="blog-profile__role">${escape(site.role || "硬件开发 / 学习者")}</p>
<p class="blog-profile__bio">${escape(site.description || site.intro || "把学习记录下来。")}</p>
${search}
<dl class="blog-profile__stats">
  <div><dt>文章</dt><dd>${stats.notes}</dd></div>
  <div><dt>阅读</dt><dd>${formatCount(totals.views)}</dd></div>
  <div><dt>获赞</dt><dd>${formatCount(totals.likes)}</dd></div>
  <div><dt>收藏</dt><dd>${formatCount(totals.favorites)}</dd></div>
</dl>
<div class="blog-profile__section">
  <div class="blog-profile__section-head"><span>我的栏目</span><a href="logs.html">全部</a></div>
  <ul class="blog-profile__cols">
    ${collections
      .map(
        (col) =>
          `<li><a href="logs.html?collection=${encodeURIComponent(col.name)}"><span>${escape(col.name)}</span><b>${col.count} 篇</b></a></li>`
      )
      .join("")}
  </ul>
</div>
<div class="blog-profile__foot">
  <a class="btn btn--small btn--primary" href="logs.html">读全部文章 <span aria-hidden="true">→</span></a>
  <a class="btn btn--small" href="about.html">关于我</a>
</div>`;
  }

  function mountProfile(host) {
    if (!host) return;
    const paint = () => {
      host.innerHTML = profileMarkup();
      if (window.KawaiiCatgirl) window.KawaiiCatgirl.scan(host);
    };
    paint();
    if (window.KawaiiMetrics) {
      window.KawaiiMetrics.ready().then(paint);
      window.KawaiiMetrics.subscribe(paint);
    }
  }

  function rowMarkup(note, options = {}) {
    const highlight = typeof options.highlight === "function" ? options.highlight : (value) => escape(value);
    const counts = metricCounts(note.slug);
    const cover = window.KawaiiCover ? window.KawaiiCover.media(note) : "";
    const tags = (note.tags || []).slice(0, 4).map((tag) => `<span class="tag">${escape(tag)}</span>`).join("");
    const featured = Boolean(options.featured);
    const flag = featured
      ? `<span class="note-card__flag">${escape(options.flag || "FEATURED / 精选")}</span>`
      : "";
    return `<a class="note-card note-card--row${featured ? " note-card--featured" : ""}" href="note.html?slug=${encodeURIComponent(note.slug)}" data-slug="${escape(note.slug)}">
  <div class="note-card__body">
    ${flag}
    <div class="note-card__meta">
      <span class="note-card__kind">${escape(kindLabel(note.kind))}</span>
      <span class="dot" aria-hidden="true"></span>
      <span>${formatDate(note.date)}</span>
      <span class="dot" aria-hidden="true"></span>
      <span>${note.minutes} MIN</span>
      <span class="dot" aria-hidden="true"></span>
      <span>${escape(note.collection || "随笔")}</span>
    </div>
    <h2 class="note-card__title">${highlight(note.title)}</h2>
    <p class="note-card__summary">${highlight(note.summary || "")}</p>
    <div class="note-card__foot">
      <div class="note-card__tags">${tags}</div>
      <div class="note-card__metrics">
        <span class="note-card__metric" title="阅读">◉ ${formatCount(counts.views)}</span>
        <span class="note-card__metric" title="点赞">♥ ${formatCount(counts.likes)}</span>
        <span class="note-card__metric" title="收藏">☆ ${formatCount(counts.favorites)}</span>
      </div>
    </div>
  </div>
  <div class="note-card__cover">${cover}</div>
</a>`;
  }

  function sortNotes(list, sort) {
    const copy = list.slice();
    if (sort === "views" || sort === "likes" || sort === "favorites") {
      copy.sort((a, b) => {
        const cb = metricCounts(b.slug)[sort] || 0;
        const ca = metricCounts(a.slug)[sort] || 0;
        return cb - ca || String(b.date).localeCompare(String(a.date));
      });
      return copy;
    }
    return copy.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  window.KawaiiBlog = { formatCount, profileMarkup, mountProfile, rowMarkup, sortNotes };

  function autoMount() {
    document.querySelectorAll("[data-blog-profile]").forEach((host) => mountProfile(host));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
  } else {
    autoMount();
  }
})();
