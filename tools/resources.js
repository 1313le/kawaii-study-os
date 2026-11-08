import fs from "node:fs";
import path from "node:path";

// The resource library is plain data: data/resources.json lists links and
// uploads, files/ holds the uploaded originals. Everything is additive except
// an explicit remove, and every write is atomic.
export const DEFAULT_CATEGORIES = ["电子书", "课程", "数据手册", "开发板", "工具软件", "视频", "网盘", "其他"];

const KINDS = new Set(["file", "pdf", "video", "image", "site", "netdisk"]);
const EXT_KIND = {
  pdf: "pdf",
  epub: "file",
  mobi: "file",
  azw3: "file",
  zip: "file",
  rar: "file",
  "7z": "file",
  exe: "file",
  msi: "file",
  apk: "file",
  dmg: "file",
  iso: "file",
  mp4: "video",
  webm: "video",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  txt: "file",
  md: "file",
  doc: "file",
  docx: "file",
  ppt: "file",
  pptx: "file",
  xls: "file",
  xlsx: "file",
  csv: "file"
};

export const UPLOAD_EXTENSIONS = Object.keys(EXT_KIND);

export function emptyStore() {
  return { version: 1, categories: [...DEFAULT_CATEGORIES], items: [] };
}

export function readResources(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || !Array.isArray(parsed.items)) return emptyStore();
    return {
      version: 1,
      categories: Array.isArray(parsed.categories) && parsed.categories.length ? parsed.categories : [...DEFAULT_CATEGORIES],
      items: parsed.items.filter((item) => item && item.id && item.title)
    };
  } catch (error) {
    return emptyStore();
  }
}

export function writeResources(file, store) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), "utf8");
  fs.renameSync(temp, file);
}

function text(value, max) {
  return String(value == null ? "" : value).replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function urlProblem(url) {
  const value = String(url || "").trim();
  if (!value) return "链接不能为空";
  if (value.startsWith("/files/") || value.startsWith("/assets/")) return "";
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    return "链接格式不对";
  }
  if (!/^https?:$/.test(parsed.protocol)) return "只接受 http / https 链接";
  return "";
}

export function bvidFrom(url) {
  const match = String(url || "").match(/(BV[0-9A-Za-z]{8,12})/);
  return match ? match[1] : "";
}

export function youtubeId(url) {
  try {
    const parsed = new URL(String(url));
    if (/youtu\.be$/.test(parsed.hostname)) return parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (/youtube(-nocookie)?\.com$/.test(parsed.hostname)) {
      if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts[0] === "embed" || parts[0] === "shorts") return parts[1] || "";
    }
  } catch (error) {
    /* not a URL */
  }
  return "";
}

export function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch (error) {
    return "";
  }
}

export function suggestCategory({ host = "", kind = "", title = "", url = "" } = {}) {
  const haystack = `${title} ${url}`.toLowerCase();
  if (kind === "netdisk" || /quark|baidu/.test(host)) return "网盘";
  if (kind === "video" || /bilibili|youtube/.test(host)) return "视频";
  if (
    kind === "pdf" ||
    /st\.com|ti\.com|nxp\.com|microchip\.com|espressif\.com|analog\.com|arm\.com|renesas\.com/.test(host)
  ) {
    return "数据手册";
  }
  if (/github\.com|gitee\.com|gitlab\.com/.test(host)) return "工具软件";
  if (/oreilly|packt|manning|book|ebook|epub|azw3/.test(haystack)) return "电子书";
  if (/course|tutorial|learn|academy|课程/.test(haystack)) return "课程";
  if (/开发板|devkit|evaluation board|nucleo|discovery|board/.test(haystack)) return "开发板";
  return "其他";
}

export function detectLink(url, fallbackKind) {
  const value = String(url || "").trim();
  const ext = (value.split("?")[0].split("#")[0].match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase();
  if (value.startsWith("/files/") || value.startsWith("/assets/")) {
    return { provider: "upload", kind: EXT_KIND[ext] || (KINDS.has(fallbackKind) ? fallbackKind : "file"), host: "", embed: "" };
  }
  const host = hostOf(value);
  if (/bilibili\.com$/.test(host) || host === "b23.tv") {
    const bvid = bvidFrom(value);
    return {
      provider: "bilibili",
      kind: "video",
      host,
      embed: bvid ? `https://player.bilibili.com/player.html?bvid=${bvid}&p=1&autoplay=0` : ""
    };
  }
  if (/youtube\.com$|youtu\.be$|youtube-nocookie\.com$/.test(host)) {
    const id = youtubeId(value);
    return {
      provider: "youtube",
      kind: "video",
      host,
      embed: id ? `https://www.youtube-nocookie.com/embed/${id}` : ""
    };
  }
  if (host === "pan.quark.cn" || host === "quark.cn") return { provider: "quark", kind: "netdisk", host, embed: "" };
  if (host === "pan.baidu.com" || host === "yun.baidu.com") return { provider: "baidu", kind: "netdisk", host, embed: "" };
  if (EXT_KIND[ext]) return { provider: "direct", kind: EXT_KIND[ext], host, embed: "" };
  return { provider: "web", kind: KINDS.has(fallbackKind) ? fallbackKind : "site", host, embed: "" };
}

export function addResource(store, payload = {}) {
  const title = text(payload.title, 80);
  if (!title) return { ok: false, code: "bad-title", error: "标题不能为空" };
  const url = String(payload.url || "").trim();
  const problem = urlProblem(url);
  if (problem) return { ok: false, code: "bad-url", error: problem };

  const detected = detectLink(url, payload.kind);
  const kind = KINDS.has(payload.kind) ? payload.kind : detected.kind;
  const category = text(payload.category, 30) || "其他";
  const tags = Array.isArray(payload.tags)
    ? [...new Set(payload.tags.map((tag) => text(tag, 20)).filter(Boolean))].slice(0, 12)
    : [];
  const item = {
    id: `res-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    url,
    kind,
    provider: text(payload.provider, 20) || detected.provider,
    host: detected.host,
    embed: text(payload.embed, 500) || detected.embed,
    code: text(payload.code, 20),
    note: text(payload.note, 200),
    category,
    tags,
    fileName: text(payload.fileName, 120),
    size: Number.isFinite(Number(payload.size)) ? Math.max(0, Number(payload.size)) : 0,
    addedAt: new Date().toISOString()
  };
  store.items.unshift(item);
  if (!store.categories.includes(category)) store.categories.push(category);
  return { ok: true, item };
}

export function updateResource(store, payload = {}) {
  const item = store.items.find((entry) => entry.id === payload.id);
  if (!item) return { ok: false, code: "missing", error: "资源不存在" };
  if (payload.title !== undefined) {
    const title = text(payload.title, 80);
    if (!title) return { ok: false, code: "bad-title", error: "标题不能为空" };
    item.title = title;
  }
  if (payload.url !== undefined) {
    const problem = urlProblem(payload.url);
    if (problem) return { ok: false, code: "bad-url", error: problem };
    item.url = String(payload.url).trim();
    const detected = detectLink(item.url, payload.kind);
    item.host = detected.host;
    item.embed = detected.embed;
    item.provider = detected.provider;
    if (!payload.kind) item.kind = detected.kind;
  }
  if (payload.kind !== undefined && KINDS.has(payload.kind)) item.kind = payload.kind;
  if (payload.category !== undefined) {
    const category = text(payload.category, 30) || "其他";
    item.category = category;
    if (!store.categories.includes(category)) store.categories.push(category);
  }
  if (payload.code !== undefined) item.code = text(payload.code, 20);
  if (payload.note !== undefined) item.note = text(payload.note, 200);
  if (Array.isArray(payload.tags)) {
    item.tags = [...new Set(payload.tags.map((tag) => text(tag, 20)).filter(Boolean))].slice(0, 12);
  }
  item.updatedAt = new Date().toISOString();
  return { ok: true, item };
}

export function removeResource(store, id) {
  const index = store.items.findIndex((entry) => entry.id === id);
  if (index === -1) return { ok: false, code: "missing", error: "资源不存在" };
  const [item] = store.items.splice(index, 1);
  return { ok: true, item };
}

export function libraryView(store) {
  const counts = new Map();
  for (const item of store.items) counts.set(item.category, (counts.get(item.category) || 0) + 1);
  return {
    categories: store.categories.map((name) => ({ name, count: counts.get(name) || 0 })),
    items: store.items,
    total: store.items.length
  };
}
