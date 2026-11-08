import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "./build.js";

// notes/<slug>.md is the unit of storage; the slug is also the URL, so it is
// restricted to what survives a query string and a file name unchanged.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FIELDS = ["collection", "cover", "accent", "fx", "draft"];

export function slugProblem(slug) {
  const text = String(slug || "");
  if (!text) return "slug 不能为空";
  if (!SLUG_PATTERN.test(text)) return "slug 只能用小写字母、数字和连字符，且不能以连字符开头";
  return "";
}

function scalar(value) {
  const text = String(value == null ? "" : value).replace(/[\r\n]+/g, " ").trim();
  if (!text) return "";
  if (/^["']|: | #|^\s|\s$/.test(text)) {
    return text.includes('"') ? `'${text}'` : `"${text}"`;
  }
  return text;
}

export { scalar as yamlScalar };

function tagList(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || "").split(/[,，]/);
  return [...new Set(list.map((tag) => String(tag).trim()).filter(Boolean))];
}

export function composeNote({ meta = {}, body = "" }) {
  const tags = tagList(meta.tags);
  const lines = [
    "---",
    `title: ${scalar(meta.title)}`,
    `date: ${scalar(meta.date)}`,
    `kind: ${scalar(meta.kind || "article")}`
  ];
  const summary = scalar(meta.summary);
  if (summary) lines.push(`summary: ${summary}`);
  if (tags.length) lines.push(`tags: ${tags.map((tag) => scalar(tag)).join(", ")}`);
  for (const field of FIELDS) {
    const value = scalar(meta[field]);
    if (value) lines.push(`${field}: ${value}`);
  }
  lines.push("---", "", String(body).replace(/\r\n/g, "\n").replace(/^\s*\n/, ""));

  return lines.join("\n");
}

function validate(meta) {
  if (!String(meta.title || "").trim()) return { code: "bad-title", error: "标题不能为空" };
  if (!DATE_PATTERN.test(String(meta.date || ""))) {
    return { code: "bad-date", error: "日期必须是 YYYY-MM-DD" };
  }
  return null;
}

export function notePath(dir, slug) {
  return path.join(dir, `${slug}.md`);
}

export function saveNote({ dir, slug, meta = {}, body = "", overwrite = false }) {
  const slugError = slugProblem(slug);
  if (slugError) return { ok: false, code: "bad-slug", error: slugError };
  const invalid = validate(meta);
  if (invalid) return { ok: false, ...invalid };

  fs.mkdirSync(dir, { recursive: true });
  const file = notePath(dir, slug);
  if (fs.existsSync(file) && !overwrite) {
    return { ok: false, code: "exists", error: `notes/${slug}.md 已经存在` };
  }

  const text = composeNote({ meta, body });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, text, "utf8");
  fs.renameSync(temp, file);
  return { ok: true, slug, file: `notes/${slug}.md` };
}

function metaFrom(data = {}) {
  return {
    title: String(data.title || ""),
    date: String(data.date || ""),
    kind: String(data.kind || "article"),
    summary: String(data.summary || ""),
    tags: tagList(data.tags),
    collection: String(data.collection || ""),
    cover: String(data.cover || ""),
    accent: String(data.accent || ""),
    fx: String(data.fx || "")
  };
}

export function readNote({ dir, slug }) {
  const slugError = slugProblem(slug);
  if (slugError) return { ok: false, code: "bad-slug", error: slugError };
  const file = notePath(dir, slug);
  if (!fs.existsSync(file)) return { ok: false, code: "missing", error: `notes/${slug}.md 不存在` };
  const parsed = parseFrontmatter(fs.readFileSync(file, "utf8"), `${slug}.md`);
  if (!parsed) return { ok: false, code: "unparsed", error: "frontmatter 无法解析" };
  return { ok: true, slug, meta: metaFrom(parsed.data), body: parsed.body };
}

export function listNotes(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
    .map((name) => {
      const slug = path.basename(name, ".md");
      const parsed = parseFrontmatter(fs.readFileSync(path.join(dir, name), "utf8"), name);
      const data = parsed ? parsed.data : {};
      return { slug, title: String(data.title || slug), date: String(data.date || ""), kind: String(data.kind || "article") };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));
}
