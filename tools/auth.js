import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Author auth for a single-owner site: a PBKDF2 password in data/auth.json,
// stateless HMAC session cookies, a per-boot arithmetic challenge, and a
// process-wide lock after repeated failures. Reading stays public; every
// mutation goes through requireAuthor() in serve.js.
export const COOKIE_NAME = "kawaii_auth";
const ITERATIONS = 210000;
const KEYLEN = 32;
const SESSION_DAYS = 7;
const CHALLENGE_MS = 5 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = Number(process.env.KAWAII_AUTH_LOCK_MS || 30000);

const bootSecret = crypto.randomBytes(32);
const usedChallenges = new Map();
const failures = { count: 0, lockedUntil: 0 };

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temp, file);
}

export function readAuth(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || !data.hash || !data.salt || !data.secret) return null;
    return data;
  } catch (error) {
    return null;
  }
}

export function isConfigured(file) {
  return Boolean(readAuth(file));
}

function hashPassword(password, salt) {
  return crypto
    .pbkdf2Sync(String(password), Buffer.from(salt, "base64"), ITERATIONS, KEYLEN, "sha256")
    .toString("base64");
}

export function setupPassword(file, password, confirm) {
  if (readAuth(file)) return { ok: false, code: "already", error: "作者密码已经设置过了" };
  const value = String(password || "");
  if (value.length < 8) return { ok: false, code: "weak", error: "密码至少 8 位" };
  if (value !== String(confirm || "")) return { ok: false, code: "mismatch", error: "两次输入的密码不一致" };
  const salt = crypto.randomBytes(16).toString("base64");
  const secret = crypto.randomBytes(32).toString("base64");
  atomicWrite(file, {
    version: 1,
    salt,
    hash: hashPassword(value, salt),
    iterations: ITERATIONS,
    secret,
    createdAt: new Date().toISOString()
  });
  return { ok: true };
}

export function verifyPassword(file, password) {
  const auth = readAuth(file);
  if (!auth) return false;
  const expected = Buffer.from(auth.hash, "base64");
  const actual = Buffer.from(hashPassword(password, auth.salt), "base64");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function issueSession(file) {
  const auth = readAuth(file);
  if (!auth) return "";
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const nonce = crypto.randomBytes(12).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp, nonce })).toString("base64url");
  const sig = crypto.createHmac("sha256", Buffer.from(auth.secret, "base64")).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function sessionValid(file, token) {
  const auth = readAuth(file);
  if (!auth || !token) return false;
  const [payload, sig] = String(token).split(".");
  if (!payload || !sig) return false;
  const expected = crypto.createHmac("sha256", Buffer.from(auth.secret, "base64")).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(data.exp) > Date.now();
  } catch (error) {
    return false;
  }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch (error) {
      out[key] = part.slice(index + 1).trim();
    }
  }
  return out;
}

export function createChallenge() {
  const a = crypto.randomInt(2, 10);
  const b = crypto.randomInt(2, 10);
  const exp = Date.now() + CHALLENGE_MS;
  const payload = Buffer.from(
    JSON.stringify({ a, b, exp, n: crypto.randomBytes(6).toString("base64url") })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", bootSecret).update(payload).digest("base64url");
  return { id: `${payload}.${sig}`, question: `${a} + ${b} = ?` };
}

export function checkChallenge(id, answer) {
  const [payload, sig] = String(id || "").split(".");
  if (!payload || !sig) return false;
  const expected = crypto.createHmac("sha256", bootSecret).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return false;
  if (usedChallenges.has(id)) return false;
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (error) {
    return false;
  }
  if (!data || Number(data.exp) < Date.now()) return false;
  if (Number(answer) !== Number(data.a) + Number(data.b)) return false;
  usedChallenges.set(id, Number(data.exp));
  for (const [key, until] of usedChallenges) if (until < Date.now()) usedChallenges.delete(key);
  return true;
}

export function loginLock() {
  if (Date.now() < failures.lockedUntil) {
    return { locked: true, retryAfter: Math.max(1, Math.ceil((failures.lockedUntil - Date.now()) / 1000)) };
  }
  return { locked: false, retryAfter: 0 };
}

export function recordFailure() {
  failures.count += 1;
  if (failures.count >= MAX_FAILS) {
    failures.lockedUntil = Date.now() + LOCK_MS;
    failures.count = 0;
  }
}

export function recordSuccess() {
  failures.count = 0;
  failures.lockedUntil = 0;
}
