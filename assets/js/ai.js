/* =========================================================
   kawaii / STUDY OS — AI client (BYOK)
   One chokepoint for every request so the key can never leak
   into a log line or a second endpoint.
   ========================================================= */

(function () {
  "use strict";

  const KEY = "kawaii.ai.v1";
  const TIMEOUT = 90000;

  const POLISH_PROMPT = [
    "你在帮一位中文嵌入式学习者改写他的 Markdown 学习笔记。",
    "要求：",
    "1. 只改文字表达：句子更清楚、更有顺序，删掉重复和口水话，保留他本人的语气和经验判断。",
    "2. Markdown 结构必须原样保留：标题层级、列表符号、代码块、行内代码、链接、公式、表格、引用都不要动。",
    "3. 不要新增事实，不要编造数据或结论，不要补写他没写的内容。",
    "4. 不要输出解释、前言或代码围栏，直接输出改写后的 Markdown 正文。"
  ].join("\n");

  const PROOFREAD_PROMPT = [
    "你在校对一位中文嵌入式学习者的 Markdown 笔记，只找确定的问题。",
    "范围：错别字、用词错误、专业术语写错（例如 IIC→I2C、上拉/下拉混淆、寄存器名拼错）、标点与物理单位错误、明显语病。",
    "要求：",
    "1. 只输出一个 JSON 数组，不要解释，不要代码围栏。",
    '2. 每项形如 {"find":"原文片段","replace":"改后片段","reason":"为什么改"}。',
    "3. find 必须是原文里逐字出现、并且只出现一次的短片段（一行以内）。",
    "4. 拿不准的不要列。没有确定的问题就输出 []。"
  ].join("\n");

  function readJson(store) {
    try {
      const raw = store.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function load() {
    const saved = readJson(sessionStorage) || readJson(localStorage);
    return {
      endpoint: String(saved?.endpoint || ""),
      model: String(saved?.model || ""),
      key: String(saved?.key || ""),
      remember: Boolean(readJson(localStorage))
    };
  }

  function save(config) {
    const payload = JSON.stringify({
      endpoint: String(config.endpoint || "").trim(),
      model: String(config.model || "").trim(),
      key: String(config.key || "").trim()
    });
    try {
      sessionStorage.setItem(KEY, payload);
    } catch (error) {
      /* a private-mode browser may refuse session storage; the form still works for this page */
    }
    try {
      if (config.remember) localStorage.setItem(KEY, payload);
      else localStorage.removeItem(KEY);
    } catch (error) {
      /* nothing to do: the key stays in memory only */
    }
  }

  function clear() {
    try {
      sessionStorage.removeItem(KEY);
    } catch (error) {}
    try {
      localStorage.removeItem(KEY);
    } catch (error) {}
  }

  function configured() {
    const config = load();
    return Boolean(config.endpoint && config.model && config.key);
  }

  function normalizeEndpoint(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    return /\/chat\/completions\/?$/i.test(url) ? url.replace(/\/$/, "") : `${url.replace(/\/+$/, "")}/chat/completions`;
  }

  const RETRY_STATUS = new Set([500, 502, 503, 504]);

  function statusHint(status) {
    return {
      400: "请求被服务商拒绝：检查模型名，或该接口不支持所用参数。",
      401: "Key 无效或已过期：去配置里重新粘贴 Key。",
      402: "账户余额不足：到服务商侧充值后再试。",
      403: "Key 没有该模型或接口的权限：换模型或检查权限。",
      404: "接口或模型不存在：检查地址是否到 /v1、模型名是否在拉取的列表里。",
      408: "服务商响应超时：稍后重试。",
      413: "内容过大（图片或文字超限制）：压缩附件后再试。",
      422: "服务商无法处理该请求：检查模型与附件格式。",
      429: "触发限流：等十几秒再重试。",
      500: "服务商内部错误：多为瞬时故障或该模型暂不可用，可重试或换模型。",
      502: "服务商网关错误：稍后重试。",
      503: "服务商服务不可用：稍后重试。",
      504: "服务商网关超时：稍后重试或换更快的模型。"
    }[status] || "服务商返回了意外状态，稍后重试。";
  }

  function modelsEndpoint(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const base = url.replace(/\/chat\/completions\/?$/i, "").replace(/\/+$/, "");
    return `${base}/models`;
  }

  async function listModels({ endpoint, key } = {}) {
    const config = load();
    const base = String(endpoint || config.endpoint || "").trim();
    const secret = String(key || config.key || "").trim();
    if (!base) throw new Error("先填接口地址，再拉模型列表。");
    if (!secret) throw new Error("先填 API Key，再拉模型列表。");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    let response;
    try {
      response = await fetch(modelsEndpoint(base), {
        method: "GET",
        headers: { Authorization: `Bearer ${secret}` },
        signal: controller.signal
      });
    } catch (error) {
      const reason = error.name === "AbortError" ? "等待超时" : "请求没有发出去";
      throw new Error(`${reason}：拉不到模型列表（接口不可达或不允许浏览器直连 CORS）。可以手填模型名。`);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new Error(`拉模型列表失败（HTTP ${response.status}）：${statusHint(response.status)} 可以手填模型名。`);
    }
    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error("模型列表不是 JSON，检查一下接口地址。可以手填模型名。");
    }
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const ids = [...new Set(list.map((item) => (typeof item === "string" ? item : item && item.id)).filter((id) => typeof id === "string" && id.trim()))].sort();
    if (!ids.length) throw new Error("接口没返回任何模型，可以手填模型名。");
    return ids;
  }

  async function chat({ messages, temperature = 0.3, maxTokens = 1600 }) {
    const config = load();
    if (!config.endpoint || !config.model || !config.key) {
      throw new Error("AI 还没配置：先在写作台的 AI 面板里填接口、模型和密钥。");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    let response;
    try {
      for (let attempt = 0; ; attempt += 1) {
        response = await fetch(normalizeEndpoint(config.endpoint), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` },
          body: JSON.stringify({
            model: config.model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false
          }),
          signal: controller.signal
        });
        if (response.ok) break;
        if (attempt === 0 && RETRY_STATUS.has(response.status)) {
          await new Promise((resolve) => setTimeout(resolve, 900));
          continue;
        }
        throw new Error(`接口返回 HTTP ${response.status}：${statusHint(response.status)}`);
      }
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("等待超时：接口地址不可达，或该接口不允许浏览器直连（CORS）。DeepSeek / Kimi / SiliconFlow / OpenRouter 可以直连，智谱需要中转。");
      }
      if (error instanceof TypeError) {
        throw new Error("请求没有发出去：接口地址不可达，或该接口不允许浏览器直连（CORS）。DeepSeek / Kimi / SiliconFlow / OpenRouter 可以直连，智谱需要中转。");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error("接口返回的不是 JSON，检查一下地址是不是 /chat/completions。");
    }
    const content = data?.choices?.[0]?.message?.content;
    if (!content || !String(content).trim()) throw new Error("接口没有返回正文。");
    return String(content).trim();
  }

  async function polish(text) {
    const result = await chat({
      messages: [
        { role: "system", content: POLISH_PROMPT },
        { role: "user", content: text }
      ],
      maxTokens: Math.min(6000, Math.max(1400, Math.ceil(text.length * 1.7)))
    });
    const cleaned = result.replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/, "").trim();
    if (!cleaned) throw new Error("润色结果为空。");
    return cleaned;
  }

  function parseHunks(raw) {
    const body = String(raw || "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    const start = body.indexOf("[");
    const end = body.lastIndexOf("]");
    if (start === -1 || end <= start) return [];
    let list;
    try {
      list = JSON.parse(body.slice(start, end + 1));
    } catch (error) {
      throw new Error("错题清单不是合法 JSON，可以让 AI 重跑一次。");
    }
    if (!Array.isArray(list)) return [];
    return list
      .filter((item) => item && typeof item.find === "string" && typeof item.replace === "string")
      .map((item) => ({
        find: item.find,
        replace: item.replace,
        reason: String(item.reason || "").trim()
      }));
  }

  function countOf(haystack, needle) {
    if (!needle) return 0;
    let count = 0;
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      count += 1;
      index = haystack.indexOf(needle, index + needle.length);
    }
    return count;
  }

  async function proofread(text) {
    const raw = await chat({
      messages: [
        { role: "system", content: PROOFREAD_PROMPT },
        { role: "user", content: text }
      ],
      temperature: 0.1
    });
    return parseHunks(raw).map((hunk) => ({ ...hunk, count: countOf(text, hunk.find) }));
  }

  window.KawaiiAI = {
    load,
    save,
    clear,
    configured,
    normalizeEndpoint,
    listModels,
    chat,
    polish,
    proofread,
    parseHunks
  };
})();
