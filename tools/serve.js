import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { exec, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "./markdown.js";
import { listNotes, readNote, saveNote } from "./note-store.js";
import { collectTaxonomy, applyTaxonomy, undoState } from "./taxonomy.js";
import {
  COOKIE_NAME,
  isConfigured,
  setupPassword,
  verifyPassword,
  issueSession,
  sessionValid,
  parseCookies,
  createChallenge,
  checkChallenge,
  loginLock,
  recordFailure,
  recordSuccess
} from "./auth.js";
import { metricsView, recordView, toggleReaction, validVisitor } from "./metrics.js";
import { liveView, updateLive } from "./live.js";
import {
  readResources,
  writeResources,
  addResource,
  updateResource,
  removeResource,
  libraryView,
  detectLink,
  suggestCategory,
  UPLOAD_EXTENSIONS
} from "./resources.js";
import { probeUrl } from "./probe.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_PORT = Number(process.env.PORT || 4173);
const NOTES_DIR = path.resolve(ROOT, process.env.KAWAII_NOTES_DIR || "notes");
const ASSET_DIR = path.resolve(ROOT, process.env.KAWAII_ASSET_DIR || "assets/img");
const UNDO_FILE = path.resolve(ROOT, process.env.KAWAII_UNDO_FILE || "data/.taxonomy-undo.json");
const RESOURCES_FILE = path.resolve(ROOT, process.env.KAWAII_RESOURCES_FILE || "data/resources.json");
const FILES_DIR = path.resolve(ROOT, process.env.KAWAII_FILES_DIR || "files");
const AUTH_ENABLED = process.env.KAWAII_AUTH !== "off";
const AUTH_FILE = path.resolve(ROOT, process.env.KAWAII_AUTH_FILE || "data/auth.json");
const SETUP_CODE = AUTH_ENABLED && !isConfigured(AUTH_FILE) ? String(crypto.randomInt(100000, 999999)) : "";
const METRICS_FILE = path.resolve(ROOT, process.env.KAWAII_METRICS_FILE || "data/metrics.json");
const UPLOAD_MAX = 300 * 1024 * 1024;
const MAX_BODY = 2 * 1024 * 1024;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".pdf": "application/pdf"
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function resolveRequest(url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch (error) {
    return null;
  }
  if (pathname.startsWith("/files/")) {
    const name = path.basename(pathname);
    const filePath = path.normalize(path.join(FILES_DIR, name));
    if (!filePath.startsWith(FILES_DIR + path.sep)) return null;
    return filePath;
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return null;
  return filePath;
}

function serveFile(req, res, filePath, status = 200) {
  const ext = path.extname(filePath).toLowerCase();
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    send(res, 404, "404 Not Found");
    return;
  }
  const headers = {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
    "Accept-Ranges": "bytes"
  };
  const range = req && req.headers && req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (match) {
      let start = match[1] === "" ? null : Number(match[1]);
      let end = match[2] === "" ? null : Number(match[2]);
      if (start === null && end !== null) {
        start = Math.max(0, stat.size - end);
        end = stat.size - 1;
      }
      if (start !== null && end === null) end = stat.size - 1;
      if (start === null || start > end || start >= stat.size) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        res.end();
        return;
      }
      end = Math.min(end, stat.size - 1);
      res.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": end - start + 1
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }
  res.writeHead(status, { ...headers, "Content-Length": stat.size });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// A local server is still reachable from any page the browser opens: a JSON
// content type forces a preflight, and the origin check rejects it there.
function fromOwnPage(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch (error) {
    return false;
  }
}

/* ---------- author auth ---------- */

function isLoopback(req) {
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function authorRequest(req) {
  if (!AUTH_ENABLED) return true;
  const bearer = process.env.KAWAII_AUTHOR_TOKEN || "";
  if (bearer && String(req.headers.authorization || "") === `Bearer ${bearer}`) return true;
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  return sessionValid(AUTH_FILE, token);
}

function requireAuthor(req, res) {
  if (!AUTH_ENABLED) return true;
  if (!isConfigured(AUTH_FILE)) {
    sendJson(res, 401, { error: "作者密码还没有设置", code: "setup" });
    return false;
  }
  if (authorRequest(req)) return true;
  sendJson(res, 401, { error: "作者未登录", code: "auth" });
  return false;
}

function setSessionCookie(req, res, token) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${7 * 86400}`
  ];
  if (req.socket.encrypted) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function catalog() {
  return listNotes(NOTES_DIR).map((note) => ({ slug: note.slug, file: `notes/${note.slug}.md`, title: note.title }));
}

function rebuild() {
  if (process.env.KAWAII_NO_BUILD) return Promise.resolve({ ok: true, skipped: true, output: "" });
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(ROOT, "tools", "build.js")], { cwd: ROOT }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: `${stdout}${stderr}`.trim() });
    });
  });
}

const ASSET_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const ASSET_MAX = 3 * 1024 * 1024;

function saveAsset(payload = {}) {
  const name = String(payload.name || "").trim();
  if (!ASSET_NAME.test(name)) return { ok: false, code: "bad-name", error: "封面名只能用小写字母、数字和连字符" };
  const match = String(payload.dataUrl || "").match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return { ok: false, code: "bad-image", error: "只接受 PNG data URL" };
  const buffer = Buffer.from(match[1], "base64");
  if (!buffer.length) return { ok: false, code: "bad-image", error: "图片是空的" };
  if (buffer.length > ASSET_MAX) return { ok: false, code: "too-large", error: "图片超过 3MB" };

  const dir = ASSET_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const file = `assets/img/${name}-cover.png`;
  fs.writeFileSync(path.join(dir, `${name}-cover.png`), buffer);
  return { ok: true, path: file, bytes: buffer.length };
}

function uploadFileName(req) {
  let raw = String(req.headers["x-file-name"] || "");
  try {
    raw = decodeURIComponent(raw);
  } catch (error) {
    /* keep the raw header */
  }
  const base = path
    .basename(raw)
    .replace(/[^\w.\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);
  return base || "upload";
}

function handleUpload(req, res) {
  const original = uploadFileName(req);
  const ext = (original.match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase();
  if (!UPLOAD_EXTENSIONS.includes(ext)) {
    sendJson(res, 400, { error: "不支持的文件类型" });
    return;
  }
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const fileName = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const filePath = path.join(FILES_DIR, fileName);
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const out = fs.createWriteStream(temp);
  let size = 0;
  let done = false;
  const fail = (status, message) => {
    if (done) return;
    done = true;
    try {
      req.unpipe(out);
      out.destroy();
    } catch (error) {
      /* the stream may already be closed */
    }
    fs.rmSync(temp, { force: true });
    if (!res.headersSent) sendJson(res, status, { error: message });
    if (req.readable) req.resume();
  };

  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > UPLOAD_MAX) fail(413, "文件超过 300MB");
  });
  req.on("error", () => fail(500, "上传中断"));
  out.on("error", () => fail(500, "写入失败"));
  out.on("finish", () => {
    if (done) return;
    done = true;
    try {
      fs.renameSync(temp, filePath);
    } catch (error) {
      fs.rmSync(temp, { force: true });
      if (!res.headersSent) sendJson(res, 500, { error: "保存失败" });
      return;
    }
    sendJson(res, 200, { url: `/files/${fileName}`, size, name: original, extension: ext });
  });
  req.pipe(out);
}

async function handleApi(req, res, pathname, search) {
  if (req.method === "GET" && pathname === "/api/auth/status") {
    sendJson(res, 200, {
      enabled: AUTH_ENABLED,
      configured: isConfigured(AUTH_FILE),
      authed: authorRequest(req),
      needsSetupCode: AUTH_ENABLED && !isConfigured(AUTH_FILE) && !isLoopback(req)
    });
    return true;
  }
  if (req.method === "GET" && pathname === "/api/auth/challenge") {
    if (!AUTH_ENABLED) {
      sendJson(res, 200, { disabled: true });
      return true;
    }
    sendJson(res, 200, createChallenge());
    return true;
  }
  if (req.method === "POST" && pathname === "/api/auth/setup") {
    if (!fromOwnPage(req)) {
      sendJson(res, 403, { error: "origin not allowed" });
      return true;
    }
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
      sendJson(res, 415, { error: "content-type must be application/json" });
      return true;
    }
    if (!AUTH_ENABLED) {
      sendJson(res, 200, { ok: true, authed: true, disabled: true });
      return true;
    }
    if (isConfigured(AUTH_FILE)) {
      sendJson(res, 409, { error: "作者密码已经设置过了", code: "already" });
      return true;
    }
    const lock = loginLock();
    if (lock.locked) {
      res.setHeader("Retry-After", String(lock.retryAfter));
      sendJson(res, 429, { error: `尝试太频繁，${lock.retryAfter} 秒后再试`, code: "locked" });
      return true;
    }
    const payload = JSON.parse((await readBody(req)) || "{}");
    if (!isLoopback(req) && String(payload.setupCode || "") !== SETUP_CODE) {
      recordFailure();
      sendJson(res, 403, { error: "服务端设置码不正确", code: "setup-code" });
      return true;
    }
    const result = setupPassword(AUTH_FILE, payload.password, payload.confirm);
    if (!result.ok) {
      sendJson(res, 400, result);
      return true;
    }
    recordSuccess();
    setSessionCookie(req, res, issueSession(AUTH_FILE));
    sendJson(res, 200, { ok: true, authed: true });
    return true;
  }
  if (req.method === "POST" && pathname === "/api/auth/login") {
    if (!fromOwnPage(req)) {
      sendJson(res, 403, { error: "origin not allowed" });
      return true;
    }
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
      sendJson(res, 415, { error: "content-type must be application/json" });
      return true;
    }
    if (!AUTH_ENABLED) {
      sendJson(res, 200, { ok: true, authed: true, disabled: true });
      return true;
    }
    if (!isConfigured(AUTH_FILE)) {
      sendJson(res, 409, { error: "先设置作者密码", code: "setup" });
      return true;
    }
    const lock = loginLock();
    if (lock.locked) {
      res.setHeader("Retry-After", String(lock.retryAfter));
      sendJson(res, 429, { error: `尝试太频繁，${lock.retryAfter} 秒后再试`, code: "locked" });
      return true;
    }
    const payload = JSON.parse((await readBody(req)) || "{}");
    if (!checkChallenge(payload.challengeId, payload.answer)) {
      recordFailure();
      sendJson(res, 400, { error: "验证码不正确，换一题再试", code: "challenge" });
      return true;
    }
    if (!verifyPassword(AUTH_FILE, payload.password)) {
      recordFailure();
      sendJson(res, 401, { error: "密码不正确", code: "password" });
      return true;
    }
    recordSuccess();
    setSessionCookie(req, res, issueSession(AUTH_FILE));
    sendJson(res, 200, { ok: true, authed: true });
    return true;
  }
  if (req.method === "POST" && pathname === "/api/auth/logout") {
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true, authed: false });
    return true;
  }
  if (req.method === "GET" && pathname === "/api/notes") {
    if (!requireAuthor(req, res)) return true;
    sendJson(res, 200, { notes: listNotes(NOTES_DIR) });
    return true;
  }
  if (req.method === "GET" && pathname === "/api/note") {
    if (!requireAuthor(req, res)) return true;
    const slug = search.get("slug") || "";
    const result = readNote({ dir: NOTES_DIR, slug });
    sendJson(res, result.ok ? 200 : result.code === "missing" ? 404 : 400, result);
    return true;
  }
  if (req.method === "POST" && pathname === "/api/note/preview") {
    if (!fromOwnPage(req)) {
      sendJson(res, 403, { error: "origin not allowed" });
      return true;
    }
    const payload = JSON.parse((await readBody(req)) || "{}");
    const rendered = renderMarkdown(String(payload.body || ""), { catalog: catalog(), slug: String(payload.slug || "") });
    sendJson(res, 200, { html: rendered.html, text: rendered.text, hasMath: rendered.hasMath, hasMermaid: rendered.hasMermaid });
    return true;
  }
  if (req.method === "POST" && pathname === "/api/asset") {
    if (!fromOwnPage(req)) {
      sendJson(res, 403, { error: "origin not allowed" });
      return true;
    }
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
      sendJson(res, 415, { error: "content-type must be application/json" });
      return true;
    }
    if (!requireAuthor(req, res)) return true;
    const payload = JSON.parse((await readBody(req)) || "{}");
    const asset = saveAsset(payload);
    sendJson(res, asset.ok ? 200 : 400, asset);
    return true;
  }
  if (req.method === "POST" && pathname === "/api/note/save") {
    if (!fromOwnPage(req)) {
      sendJson(res, 403, { error: "origin not allowed" });
      return true;
    }
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
      sendJson(res, 415, { error: "content-type must be application/json" });
      return true;
    }
    if (!requireAuthor(req, res)) return true;
    const payload = JSON.parse((await readBody(req)) || "{}");
    const result = saveNote({
      dir: NOTES_DIR,
      slug: payload.slug,
      meta: payload.meta || {},
      body: String(payload.body || ""),
      overwrite: payload.overwrite === true
    });
    if (!result.ok) {
      sendJson(res, result.code === "exists" ? 409 : 400, result);
      return true;
    }
    const build = await rebuild();
    sendJson(res, 200, { ...result, build });
    return true;
  }
  if (req.method === "GET" && pathname === "/api/taxonomy") {
    sendJson(res, 200, { ...collectTaxonomy(NOTES_DIR), undo: undoState(UNDO_FILE) });
    return true;
  }
  if (req.method === "POST" && pathname === "/api/taxonomy") {
    if (!fromOwnPage(req)) {
      sendJson(res, 403, { error: "origin not allowed" });
      return true;
    }
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
      sendJson(res, 415, { error: "content-type must be application/json" });
      return true;
    }
    if (!requireAuthor(req, res)) return true;
    const payload = JSON.parse((await readBody(req)) || "{}");
    const result = applyTaxonomy({
      dir: NOTES_DIR,
      undoPath: UNDO_FILE,
      action: String(payload.action || ""),
      kind: String(payload.kind || ""),
      from: payload.from,
      names: payload.names,
      to: payload.to
    });
    if (!result.ok) {
      sendJson(res, result.code === "no-undo" ? 409 : 400, result);
      return true;
    }
    const build = result.affected ? await rebuild() : { ok: true, skipped: true, output: "" };
    sendJson(res, 200, { ...result, build, undo: undoState(UNDO_FILE) });
    return true;
  }
  if (req.method === "GET" && pathname === "/api/resources") {
    sendJson(res, 200, { ...libraryView(readResources(RESOURCES_FILE)), canWrite: true });
    return true;
  }
  if (req.method === "POST" && pathname === "/api/resources/probe") {
    if (!fromOwnPage(req)) {
      sendJson(res, 403, { error: "origin not allowed" });
      return true;
    }
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
      sendJson(res, 415, { error: "content-type must be application/json" });
      return true;
    }
    if (!requireAuthor(req, res)) return true;
    const payload = JSON.parse((await readBody(req)) || "{}");
    const url = String(payload.url || "").trim();
    const detected = detectLink(url, payload.kind);
    let result = null;
    let warning = "";
    try {
      result = await probeUrl(url, { allowPrivate: process.env.KAWAII_PROBE_ALLOW_PRIVATE === "1" });
    } catch (error) {
      warning = error.message;
    }
    if (!result && !detected.host) {
      sendJson(res, 400, { error: warning || "无法识别这个链接" });
      return true;
    }
    const metadata = (result && result.metadata) || { title: "", description: "", image: "" };
    const title = metadata.title || detected.host || url;
    sendJson(res, 200, {
      ok: true,
      warning,
      url: (result && result.url) || url,
      title,
      description: metadata.description || "",
      image: metadata.image || "",
      host: detected.host,
      provider: detected.provider,
      kind: detected.kind,
      embed: detected.embed,
      category: suggestCategory({ host: detected.host, kind: detected.kind, title, url }),
      fetched: Boolean(result && result.fetched)
    });
    return true;
  }
  if (req.method === "POST" && pathname === "/api/resources") {
    if (!fromOwnPage(req)) {
      sendJson(res, 403, { error: "origin not allowed" });
      return true;
    }
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
      sendJson(res, 415, { error: "content-type must be application/json" });
      return true;
    }
    if (!requireAuthor(req, res)) return true;
    const payload = JSON.parse((await readBody(req)) || "{}");
    const store = readResources(RESOURCES_FILE);
    let result;
    if (payload.action === "add") result = addResource(store, payload);
    else if (payload.action === "update") result = updateResource(store, payload);
    else if (payload.action === "remove") result = removeResource(store, payload.id);
    else {
      sendJson(res, 400, { error: "unknown action" });
      return true;
    }
    if (!result.ok) {
      sendJson(res, result.code === "missing" ? 404 : 400, result);
      return true;
    }
    writeResources(RESOURCES_FILE, store);
    sendJson(res, 200, { ...result, ...libraryView(store), canWrite: true });
    return true;
  }
  if (req.method === "POST" && pathname === "/api/resources/upload") {
    if (!fromOwnPage(req)) {
      sendJson(res, 403, { error: "origin not allowed" });
      return true;
    }
    if (!requireAuthor(req, res)) return true;
    if (req.headers["x-kawaii-upload"] !== "1") {
      sendJson(res, 415, { error: "missing upload header" });
      return true;
    }
    handleUpload(req, res);
    return true;
  }
  if (req.method === "GET" && pathname === "/api/live") {
    sendJson(res, 200, liveView());
    return true;
  }
  if (req.method === "POST" && pathname === "/api/live") {
    if (!requireAuthor(req, res)) return true;
    if (!fromOwnPage(req)) {
      sendJson(res, 403, { error: "origin not allowed" });
      return true;
    }
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
      sendJson(res, 415, { error: "content-type must be application/json" });
      return true;
    }
    const payload = JSON.parse((await readBody(req)) || "{}");
    sendJson(res, 200, updateLive(payload));
    return true;
  }
  if (req.method === "GET" && pathname === "/api/metrics") {
    const visitor = search.get("visitor") || "";
    sendJson(res, 200, metricsView(METRICS_FILE, validVisitor(visitor) ? visitor : ""));
    return true;
  }
  if (req.method === "POST" && (pathname === "/api/metrics/view" || pathname === "/api/metrics/react")) {
    if (!fromOwnPage(req)) {
      sendJson(res, 403, { error: "origin not allowed" });
      return true;
    }
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
      sendJson(res, 415, { error: "content-type must be application/json" });
      return true;
    }
    const payload = JSON.parse((await readBody(req)) || "{}");
    const slug = String(payload.slug || "");
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
      sendJson(res, 400, { error: "slug 不合法" });
      return true;
    }
    const known = listNotes(NOTES_DIR).some((note) => note.slug === slug);
    if (!known) {
      sendJson(res, 404, { error: "文章不存在" });
      return true;
    }
    if (pathname.endsWith("/view")) {
      sendJson(res, 200, { ok: true, counts: recordView(METRICS_FILE, slug) });
      return true;
    }
    const result = toggleReaction(METRICS_FILE, slug, String(payload.action || ""), payload.visitor, payload.on === true);
    sendJson(res, result.ok ? 200 : 400, result);
    return true;
  }
  if (pathname.startsWith("/api/")) {
    sendJson(res, 404, { error: "unknown api route" });
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", "http://localhost");
  try {
    if (await handleApi(req, res, requestUrl.pathname, requestUrl.searchParams)) return;
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method not allowed");
    return;
  }
  const filePath = resolveRequest(req.url || "/");
  if (!filePath) {
    send(res, 400, "Bad request");
    return;
  }
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      const notFound = path.join(ROOT, "404.html");
      if (fs.existsSync(notFound)) serveFile(req, res, notFound, 404);
      else send(res, 404, "404 Not Found");
      return;
    }
    if (req.method === "HEAD") {
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Content-Length": stat.size,
        "Accept-Ranges": "bytes"
      });
      res.end();
      return;
    }
    serveFile(req, res, filePath);
  });
});

function openBrowser(url) {
  const command =
    process.platform === "win32"
      ? `cmd /c start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(command, () => {});
}

function listen(port, attemptsLeft) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attemptsLeft > 0) {
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    console.error(`[serve] failed: ${error.message}`);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log("");
    console.log("  kawaii / STUDY OS — local preview");
    console.log(`  ${url}`);
    console.log("");
    console.log("  pages   /  logs.html  /  write.html  /  note.html  /  mindmap.html  /  resources.html  /  about.html");
    if (SETUP_CODE) {
      console.log(`  author  first-run setup code: ${SETUP_CODE} (only needed from a non-loopback address)`);
    }
    if (!AUTH_ENABLED) console.log("  author  auth disabled by KAWAII_AUTH=off");
    console.log("  stop    Ctrl + C");
    console.log("");
    if (process.argv.includes("--open")) openBrowser(url);
  });
}

listen(BASE_PORT, 10);
