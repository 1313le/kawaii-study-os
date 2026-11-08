/* =========================================================
   kawaii / STUDY OS — article metrics
   Views, likes and favorites with an anonymous visitor id.
   Online uses /api/metrics; a static host falls back to
   per-browser counters so the buttons still work.
   ========================================================= */

(function () {
  "use strict";

  const KEY = "kawaii.metrics.v1";
  const VIEW_KEY = "kawaii.metrics.views.v1";
  const VISITOR_KEY = "kawaii.metrics.visitor.v1";
  const EVENT = "kawaii:metrics";
  const VIEW_WINDOW = 30 * 60 * 1000;

  const emptyCounts = () => ({ views: 0, likes: 0, favorites: 0 });
  let cached = { notes: {}, totals: emptyCounts(), mine: {}, offline: true };
  let readyResolve = null;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });

  function visitor() {
    try {
      let id = localStorage.getItem(VISITOR_KEY);
      if (!/^[a-z0-9-]{8,64}$/i.test(id || "")) {
        const random = crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
        id = `v-${random.replace(/-/g, "")}`;
        localStorage.setItem(VISITOR_KEY, id);
      }
      return id;
    } catch (error) {
      return "v-anonymous";
    }
  }

  function readLocal() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!data || typeof data !== "object") throw new Error("empty");
      return {
        notes: data.notes && typeof data.notes === "object" ? data.notes : {},
        mine: data.mine && typeof data.mine === "object" ? data.mine : {},
        totals: data.totals || emptyCounts()
      };
    } catch (error) {
      return { notes: {}, mine: {}, totals: emptyCounts() };
    }
  }

  function writeLocal(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ notes: data.notes || {}, mine: data.mine || {}, totals: data.totals || {} }));
    } catch (error) {
      /* storage may be full */
    }
  }

  function notify(slug) {
    document.dispatchEvent(new CustomEvent(EVENT, { detail: { slug } }));
  }

  function counts(slug) {
    const entry = cached.notes && cached.notes[slug];
    return entry ? { ...emptyCounts(), ...entry } : emptyCounts();
  }

  function localMine(slug) {
    return readLocal().mine[slug] || { like: false, favorite: false };
  }

  function mine(slug) {
    return (cached.mine && cached.mine[slug]) || localMine(slug);
  }

  async function load() {
    try {
      const response = await fetch(`/api/metrics?visitor=${encodeURIComponent(visitor())}`, { cache: "no-store" });
      if (!response.ok) throw new Error("offline");
      const data = await response.json();
      cached = {
        notes: data.notes || {},
        totals: data.totals || emptyCounts(),
        mine: data.mine || {},
        offline: false
      };
    } catch (error) {
      const local = readLocal();
      cached = { notes: local.notes, totals: local.totals, mine: local.mine, offline: true };
    }
    if (readyResolve) {
      readyResolve(cached);
      readyResolve = null;
    }
    notify(null);
    return cached;
  }

  async function view(slug) {
    if (!slug) return;
    const now = Date.now();
    let seen = {};
    try {
      seen = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
    } catch (error) {
      seen = {};
    }
    if (seen[slug] && now - seen[slug] < VIEW_WINDOW) return;
    seen[slug] = now;
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(seen));
    } catch (error) {
      /* ignore */
    }

    let serverCounts = null;
    try {
      const response = await fetch("/api/metrics/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug })
      });
      if (response.ok) {
        const data = await response.json();
        serverCounts = data.counts;
      }
    } catch (error) {
      /* offline */
    }

    const local = readLocal();
    const localCounts = { ...emptyCounts(), ...(local.notes[slug] || {}) };
    localCounts.views += 1;
    local.notes[slug] = localCounts;
    writeLocal(local);

    cached.notes[slug] = serverCounts || localCounts;
    if (serverCounts) cached.offline = false;
    notify(slug);
  }

  async function react(slug, action, on) {
    if (!slug || (action !== "like" && action !== "favorite")) return counts(slug);
    const key = action === "like" ? "like" : "favorite";
    const countKey = action === "like" ? "likes" : "favorites";
    const current = mine(slug);
    if (Boolean(current[key]) === Boolean(on)) return counts(slug);

    const local = readLocal();
    const nextMine = { ...(local.mine[slug] || { like: false, favorite: false }), [key]: Boolean(on) };
    local.mine[slug] = nextMine;
    const localCounts = { ...emptyCounts(), ...(local.notes[slug] || {}) };
    localCounts[countKey] = Math.max(0, (localCounts[countKey] || 0) + (on ? 1 : -1));
    local.notes[slug] = localCounts;
    writeLocal(local);

    cached.mine[slug] = nextMine;
    cached.notes[slug] = localCounts;
    notify(slug);

    try {
      const response = await fetch("/api/metrics/react", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, action, visitor: visitor(), on: Boolean(on) })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        cached.notes[slug] = data.counts || localCounts;
        cached.mine[slug] = { ...nextMine, [key]: data.on !== false };
        cached.offline = false;
      }
    } catch (error) {
      /* the optimistic local counts stay */
    }
    notify(slug);
    return counts(slug);
  }

  function subscribe(fn) {
    const handler = (event) => fn(event.detail ? event.detail.slug : null);
    document.addEventListener(EVENT, handler);
    return () => document.removeEventListener(EVENT, handler);
  }

  window.KawaiiMetrics = {
    ready() {
      return ready;
    },
    load,
    counts,
    mine,
    totals() {
      return cached.totals || emptyCounts();
    },
    view,
    react,
    subscribe,
    visitor,
    get offline() {
      return cached.offline;
    }
  };

  load();
})();
