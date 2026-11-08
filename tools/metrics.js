import fs from "node:fs";
import path from "node:path";

// Public article metrics: views, likes and favorites. Reactions are deduped by
// an anonymous visitor id so one browser counts once; no accounts are involved.
const ACTIONS = new Set(["like", "favorite"]);
const MAX_VISITORS = 5000;
const VISITOR_PATTERN = /^[a-z0-9-]{8,64}$/i;

function empty() {
  return { version: 1, notes: {} };
}

export function readMetrics(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || typeof data.notes !== "object" || !data.notes) return empty();
    return { version: 1, notes: data.notes };
  } catch (error) {
    return empty();
  }
}

function writeMetrics(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temp, file);
}

function entry(data, slug) {
  if (!data.notes[slug] || typeof data.notes[slug] !== "object") {
    data.notes[slug] = { views: 0, likedBy: [], favoritedBy: [] };
  }
  const note = data.notes[slug];
  note.views = Math.max(0, Number(note.views) || 0);
  if (!Array.isArray(note.likedBy)) note.likedBy = [];
  if (!Array.isArray(note.favoritedBy)) note.favoritedBy = [];
  return note;
}

export function countsOf(note = {}) {
  return {
    views: Math.max(0, Number(note.views) || 0),
    likes: Array.isArray(note.likedBy) ? note.likedBy.length : 0,
    favorites: Array.isArray(note.favoritedBy) ? note.favoritedBy.length : 0
  };
}

export function recordView(file, slug) {
  const data = readMetrics(file);
  const note = entry(data, slug);
  note.views += 1;
  note.lastViewedAt = new Date().toISOString();
  writeMetrics(file, data);
  return countsOf(note);
}

export function toggleReaction(file, slug, action, visitor, on) {
  if (!ACTIONS.has(action)) return { ok: false, code: "bad-action", error: "未知操作" };
  if (!VISITOR_PATTERN.test(String(visitor || ""))) {
    return { ok: false, code: "bad-visitor", error: "访客标识不合法" };
  }
  const data = readMetrics(file);
  const note = entry(data, slug);
  const key = action === "like" ? "likedBy" : "favoritedBy";
  const list = note[key];
  const index = list.indexOf(visitor);
  if (on && index === -1 && list.length < MAX_VISITORS) list.push(visitor);
  if (!on && index !== -1) list.splice(index, 1);
  note.updatedAt = new Date().toISOString();
  writeMetrics(file, data);
  return { ok: true, counts: countsOf(note), on: list.includes(visitor) };
}

export function metricsView(file, visitor) {
  const data = readMetrics(file);
  const notes = {};
  const mine = {};
  const totals = { views: 0, likes: 0, favorites: 0 };
  for (const [slug, note] of Object.entries(data.notes)) {
    const counts = countsOf(note);
    notes[slug] = counts;
    totals.views += counts.views;
    totals.likes += counts.likes;
    totals.favorites += counts.favorites;
    if (visitor) {
      mine[slug] = {
        like: Array.isArray(note.likedBy) && note.likedBy.includes(visitor),
        favorite: Array.isArray(note.favoritedBy) && note.favoritedBy.includes(visitor)
      };
    }
  }
  return { notes, totals, mine, updatedAt: new Date().toISOString() };
}

export function validVisitor(visitor) {
  return VISITOR_PATTERN.test(String(visitor || ""));
}
