import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./build.js";
import { yamlScalar } from "./note-store.js";

// Taxonomy is data: a note's collection and tags live in its own front-matter.
// Every bulk operation rewrites those two fields in place, keeps the rest of the
// file byte-identical, and leaves a one-step undo snapshot.
const KINDS = new Set(["collection", "tag"]);
const ACTIONS = new Set(["rename", "merge", "delete", "undo"]);
const COLLECTION_FALLBACK = "未分类";
const MAX_COLLECTION = 40;
const MAX_TAG = 30;

function noteFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md") && !name.startsWith("_") && !name.startsWith("."))
    .sort();
}

export function listTags(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[,，]/);
  return [...new Set(list.map((tag) => String(tag).trim()).filter(Boolean))];
}

export function collectionOf(data = {}) {
  return String(data.collection || "").trim() || "随笔";
}

function readFile(dir, name) {
  const raw = fs.readFileSync(path.join(dir, name), "utf8");
  const parsed = parseFrontmatter(raw, name);
  if (!parsed) return null;
  return {
    slug: path.basename(name, ".md"),
    file: name,
    raw,
    collection: collectionOf(parsed.data),
    tags: listTags(parsed.data.tags),
    hasCollection: parsed.data.collection != null,
    hasTags: parsed.data.tags != null
  };
}

export function collectTaxonomy(dir) {
  const collections = new Map();
  const tags = new Map();
  let notes = 0;
  for (const name of noteFiles(dir)) {
    const note = readFile(dir, name);
    if (!note) continue;
    notes += 1;
    collections.set(note.collection, (collections.get(note.collection) || 0) + 1);
    for (const tag of note.tags) tags.set(tag, (tags.get(tag) || 0) + 1);
  }
  const rank = (map) =>
    [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));
  return { collections: rank(collections), tags: rank(tags), notes };
}

export function normalizeName(kind, value) {
  const name = String(value == null ? "" : value).replace(/[\r\n]+/g, " ").trim();
  if (!name) return { ok: false, code: "empty", error: "名称不能为空" };
  if (kind === "tag" && /[,，]/.test(name)) {
    return { ok: false, code: "bad-name", error: "标签里不能有逗号" };
  }
  if (name.length > (kind === "tag" ? MAX_TAG : MAX_COLLECTION)) {
    return { ok: false, code: "bad-name", error: `名称不能超过 ${kind === "tag" ? MAX_TAG : MAX_COLLECTION} 个字` };
  }
  return { ok: true, name };
}

function setHeaderField(header, field, value) {
  const lines = header.split("\n");
  const pattern = new RegExp(`^${field}\\s*:`);
  const index = lines.findIndex((line) => pattern.test(line));
  if (value == null) {
    if (index >= 0) lines.splice(index, 1);
    return lines.join("\n");
  }
  const line = `${field}: ${value}`;
  if (index >= 0) lines[index] = line;
  else lines.push(line);
  return lines.join("\n");
}

// undefined = leave the field alone, null = delete the line, string/array = set it.
function rewriteFrontmatter(raw, { collection, tags } = {}) {
  const normalized = String(raw).replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return null;
  const close = normalized.indexOf("\n---", 4);
  if (close === -1) return null;
  let header = normalized.slice(4, close);
  if (collection !== undefined) {
    header = setHeaderField(header, "collection", collection == null ? null : yamlScalar(collection));
  }
  if (tags !== undefined) {
    header = setHeaderField(header, "tags", tags == null || !tags.length ? null : tags.map(yamlScalar).join(", "));
  }
  return `---\n${header}${normalized.slice(close)}`;
}

function writeAtomic(dir, name, raw) {
  const file = path.join(dir, name);
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, raw, "utf8");
  fs.renameSync(temp, file);
}

export function undoState(undoPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(undoPath, "utf8"));
    if (!parsed || !Array.isArray(parsed.changes) || !parsed.changes.length) return { canUndo: false };
    return { canUndo: true, at: parsed.at, action: parsed.action, kind: parsed.kind, affected: parsed.changes.length };
  } catch (error) {
    return { canUndo: false };
  }
}

export function applyTaxonomy({ dir, undoPath, action, kind, from, names, to }) {
  if (action === "undo") return undo({ dir, undoPath });
  if (!ACTIONS.has(action)) return { ok: false, code: "bad-action", error: "未知操作" };
  if (!KINDS.has(kind)) return { ok: false, code: "bad-kind", error: "未知分类类型" };

  let target = null;
  if (action !== "delete") {
    const checked = normalizeName(kind, to);
    if (!checked.ok) return checked;
    target = checked.name;
  }

  let sources = [];
  if (action === "rename") {
    sources = [String(from || "").trim()].filter(Boolean);
    if (!sources.length) return { ok: false, code: "empty", error: "缺少原名称" };
  } else if (action === "merge") {
    sources = [...new Set((Array.isArray(names) ? names : []).map((name) => String(name || "").trim()).filter(Boolean))];
    if (!sources.length) return { ok: false, code: "empty", error: "至少选择一个要合并的名称" };
  } else if (action === "delete") {
    const checked = normalizeName(kind, from);
    if (!checked.ok) return checked;
    sources = [checked.name];
  }
  if (target !== null) {
    if (action === "merge") {
      // Selecting the target as one of the merge sources is the normal case:
      // fold every other name into it.
      sources = sources.filter((name) => name !== target);
      if (!sources.length) return { ok: false, code: "same", error: "至少保留一个与目标不同的名称" };
    } else if (sources.includes(target)) {
      return { ok: false, code: "same", error: "新名称与原名称相同" };
    }
  }

  const changes = [];
  const affected = [];
  for (const name of noteFiles(dir)) {
    const note = readFile(dir, name);
    if (!note) continue;
    const hit = kind === "collection"
      ? sources.includes(note.collection)
      : note.tags.some((tag) => sources.includes(tag));
    if (!hit) continue;
    changes.push({
      slug: note.slug,
      file: note.file,
      collection: note.collection,
      tags: note.tags,
      hasCollection: note.hasCollection,
      hasTags: note.hasTags
    });
    affected.push(note);
  }

  if (!affected.length) {
    return { ok: true, action, kind, affected: 0, slugs: [], undoAt: undoState(undoPath).at || null };
  }

  const at = new Date().toISOString();
  fs.mkdirSync(path.dirname(undoPath), { recursive: true });
  fs.writeFileSync(undoPath, JSON.stringify({ at, action, kind, sources, changes }, null, 2), "utf8");

  const touched = [];
  for (const note of affected) {
    let next;
    if (kind === "collection") {
      next = rewriteFrontmatter(note.raw, {
        collection: action === "delete" ? COLLECTION_FALLBACK : target
      });
    } else {
      const tags = action === "delete"
        ? note.tags.filter((tag) => !sources.includes(tag))
        : [...new Set(note.tags.map((tag) => (sources.includes(tag) ? target : tag)))];
      next = rewriteFrontmatter(note.raw, { tags });
    }
    if (!next) continue;
    writeAtomic(dir, note.file, next);
    touched.push(note.slug);
  }

  return { ok: true, action, kind, affected: touched.length, slugs: touched, undoAt: at };
}

function undo({ dir, undoPath }) {
  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(undoPath, "utf8"));
  } catch (error) {
    return { ok: false, code: "no-undo", error: "没有可撤销的批量操作" };
  }
  if (!snapshot || !Array.isArray(snapshot.changes) || !snapshot.changes.length) {
    return { ok: false, code: "no-undo", error: "没有可撤销的批量操作" };
  }
  const restored = [];
  for (const change of snapshot.changes) {
    const file = path.join(dir, change.file);
    if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, "utf8");
    const next = rewriteFrontmatter(raw, {
      collection: change.hasCollection ? change.collection : null,
      tags: change.hasTags ? change.tags : null
    });
    if (!next) continue;
    writeAtomic(dir, change.file, next);
    restored.push(change.slug);
  }
  fs.rmSync(undoPath, { force: true });
  return { ok: true, action: "undo", affected: restored.length, slugs: restored };
}
