const TTL = Number(process.env.KAWAII_LIVE_TTL_MS || 45000);
const MAX_TITLE = 80;
const MAX_TAIL = 400;

const store = {
  enabled: false,
  state: null,
  at: 0
};

function text(value, max) {
  return String(value == null ? "" : value).slice(0, max);
}

function number(value) {
  return Math.max(0, Math.min(1e9, Number(value) || 0));
}

function cleanState(payload) {
  if (!payload || typeof payload !== "object") return null;
  return {
    title: text(payload.title, MAX_TITLE) || "UNTITLED.MD",
    tail: text(payload.tail, MAX_TAIL),
    line: number(payload.line) || 1,
    col: number(payload.col) || 1,
    chars: number(payload.chars),
    caret: number(payload.caret),
    totalLines: number(payload.totalLines) || 1,
    mode: text(payload.mode, 12) || "edit",
    dirty: Boolean(payload.dirty),
    savedAt: payload.savedAt || null
  };
}

export function liveView() {
  const live = store.enabled && Date.now() - store.at < TTL;
  return {
    enabled: store.enabled,
    live,
    state: live ? store.state : null,
    at: store.at
  };
}

export function updateLive(payload = {}) {
  if (payload.enabled !== true) {
    store.enabled = false;
    store.state = null;
    store.at = Date.now();
    return liveView();
  }
  const state = cleanState(payload.state);
  if (!state) return { ...liveView(), error: "bad-state" };
  store.enabled = true;
  store.state = state;
  store.at = Date.now();
  return liveView();
}

export function touchLive() {
  if (store.enabled) store.at = Date.now();
  return liveView();
}

export function resetLive() {
  store.enabled = false;
  store.state = null;
  store.at = 0;
}
