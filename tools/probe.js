import dns from "node:dns/promises";
import net from "node:net";

// Metadata probe for the resource intake. The server fetches the page itself,
// so every hop is checked against private/link-local ranges first (SSRF guard).
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

function isPrivateIPv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
}

export function isPrivateAddress(address) {
  if (net.isIPv4(address)) return isPrivateIPv4(address);
  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    if (value === "::" || value === "::1") return true;
    if (value.startsWith("fc") || value.startsWith("fd")) return true;
    if (value.startsWith("fe80")) return true;
    if (value.startsWith("::ffff:")) return isPrivateIPv4(value.slice(7));
    return false;
  }
  return true;
}

export async function assertPublicHost(host, { allowPrivate = false } = {}) {
  if (allowPrivate) return true;
  if (!host || /^localhost$|\.local$|\.internal$|\.lan$/i.test(host)) {
    throw new Error("只接受公网地址");
  }
  let records = [];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch (error) {
    throw new Error("域名解析失败");
  }
  if (!records.length) throw new Error("域名解析失败");
  if (records.some((record) => isPrivateAddress(record.address))) {
    throw new Error("只接受公网地址");
  }
  return true;
}

function decodeEntities(value) {
  return String(value == null ? "" : value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function clean(value, max = 300) {
  return decodeEntities(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function extractMetadata(html, baseUrl = "") {
  const source = String(html || "");
  const meta = new Map();
  for (const tag of source.match(/<meta\s+[^>]*>/gi) || []) {
    const key = (tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/content\s*=\s*["']([\s\S]*?)["']/i) || [])[1];
    if (key && content) meta.set(key.toLowerCase(), content);
  }
  const titleTag = (source.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const canonical = (source.match(/<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*>/i) || [])[0] || "";
  const canonicalHref = (canonical.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
  const title = clean(meta.get("og:title") || meta.get("twitter:title") || titleTag, 160);
  const description = clean(
    meta.get("og:description") || meta.get("description") || meta.get("twitter:description"),
    400
  );
  let image = meta.get("og:image") || meta.get("twitter:image") || "";
  if (image && baseUrl) {
    try {
      image = new URL(image, baseUrl).href;
    } catch (error) {
      image = "";
    }
  }
  return { title, description, image, canonical: canonicalHref };
}

export async function probeUrl(url, options = {}) {
  const allowPrivate = options.allowPrivate === true;
  const timeout = Number(options.timeout) > 0 ? Number(options.timeout) : TIMEOUT_MS;
  let current;
  try {
    current = new URL(String(url || ""));
  } catch (error) {
    throw new Error("链接格式不对");
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!/^https?:$/.test(current.protocol)) throw new Error("只接受 http / https 链接");
    await assertPublicHost(current.hostname, { allowPrivate });
    const response = await fetch(current.href, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeout),
      headers: {
        "user-agent": "kawaii-study-os/1.0 (resource probe)",
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5"
      }
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("重定向缺少地址");
      current = new URL(location, current.href);
      continue;
    }
    if (!response.ok) throw new Error(`抓取失败 HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      return { url: current.href, fetched: true, contentType, metadata: { title: "", description: "", image: "" } };
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        reader.cancel().catch(() => {});
        break;
      }
      chunks.push(Buffer.from(value));
    }
    const html = new TextDecoder("utf-8").decode(Buffer.concat(chunks));
    return { url: current.href, fetched: true, contentType, metadata: extractMetadata(html, current.href) };
  }
  throw new Error("重定向次数过多");
}
