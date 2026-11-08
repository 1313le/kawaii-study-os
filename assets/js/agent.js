/* =========================================================
   kawaii / STUDY OS — in-site assistant
   A pixel robot teacher that knows this blog, can look notes
   up with read-only tools, and reads the files you hand it.
   ========================================================= */

(function () {
  "use strict";

  const MAX_TOOL_ROUNDS = 3;
  const NOTE_SLICE = 4000;
  const MAX_ATTACHMENTS = 4;
  const MAX_IMAGE = 4 * 1024 * 1024;
  const MAX_TEXT = 200 * 1024;
  const state = { busy: false, history: [], open: false, attachments: [] };

  const PROVIDERS = [
    { id: "deepseek", name: "DeepSeek", endpoint: "https://api.deepseek.com/v1", model: "deepseek-chat", keys: "https://platform.deepseek.com/api_keys" },
    { id: "kimi", name: "Kimi", endpoint: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", keys: "https://platform.moonshot.cn/console/api-keys" },
    { id: "siliconflow", name: "SiliconFlow", endpoint: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct", keys: "https://cloud.siliconflow.cn/account/ak" },
    { id: "openrouter", name: "OpenRouter", endpoint: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", keys: "https://openrouter.ai/keys" },
    { id: "custom", name: "自定义", endpoint: "", model: "", keys: "" }
  ];

  function notes() {
    return (window.Kawaii && window.Kawaii.notes && window.Kawaii.notes.all) || [];
  }

  function collections() {
    return (window.Kawaii && window.Kawaii.notes && window.Kawaii.notes.collections()) || [];
  }

  function corpus() {
    return notes()
      .map((note) => {
        const tags = (note.tags || []).join(", ");
        const text = String(note.text || "").slice(0, NOTE_SLICE);
        return [
          `### ${note.title}`,
          `slug: ${note.slug} | ${note.date} | ${note.kind} | 栏目: ${note.collection || "随笔"} | 标签: ${tags}`,
          `摘要: ${note.summary || ""}`,
          text
        ].join("\n");
      })
      .join("\n\n");
  }

  function outline() {
    return collections()
      .map((col) => {
        const list = (window.Kawaii.notes.byCollection(col.name) || []).slice(0, 12);
        return `## ${col.name}（${col.count} 篇）\n${list.map((note) => `- ${note.title}(${note.slug})`).join("\n")}`;
      })
      .join("\n");
  }

  function systemPrompt() {
    return [
      "你是 kawaii / STUDY OS 的站内写作助教，说话像一位耐心的机器人老师。这是一个纯内容记录站：站长写博客、做学习笔记、画思维导图、存学习资源，栏目完全由他自己定义。",
      "站内事实只能来自下面两块资料；资料里没有的，就说「站内没写过，我按通用知识讲」，不要编造他写过的内容。",
      "回答规则：",
      "1. 中文，先给结论，再给理由；默认不超过 220 字，他要求详细时才展开。",
      "2. 教概念时用这个结构：一句类比 → 最小可验证步骤 → 一句自测题。",
      "3. 引用站内笔记时写出标题和 slug，方便他点开。",
      "4. 用户可能附上图片或文件：先说明你从附件里看到了什么，再回答；看不清就说看不清。",
      "5. 需要更多资料时，只输出一个 JSON 对象，不要有别的文字：",
      '   {"tool":"search_notes","args":{"query":"关键词"}}',
      '   {"tool":"read_note","args":{"slug":"笔记 slug"}}',
      '   {"tool":"list_collections","args":{}}',
      '   {"tool":"propose_resources","args":{"items":[{"title":"...","url":"https://...","category":"数据手册","note":"..."}]}}',
      '   {"tool":"insert_block","args":{"type":"callout-warning","text":"..."}}',
      '   {"tool":"apply_style","args":{"accent":"cyan","fx":"scan","cover":"template:circuit"}}',
      '   {"tool":"site_action","args":{"theme":"line"}}  或  {"fx":false}',
      "   只有他明确要求换皮肤、开关动效时才用 site_action；跳转和写笔记让他自己点。",
      "   只有他明确要你推荐外部学习资源时才用 propose_resources；只给有把握的官方链接，不确定就给搜索关键词，不要编造 URL。导入始终由他在资源库页确认。",
      "   只有作者在写作台明确要排版、特效或封面时才用 insert_block / apply_style；不要替他编造事实。可用块：heading / callout-note / callout-tip / callout-warning / task / table / mermaid / mindmap / wavedrom / lab-pwm / lab-rc。",
      "   拿到结果后继续用中文回答，不要重复 JSON。",
      "",
      "【站内笔记】",
      corpus(),
      "",
      "【栏目结构】",
      outline()
    ].join("\n");
  }

  /* ---------- tools ---------- */

  function toolSearch(args) {
    const query = String(args.query || "").trim();
    if (!query) return "缺少 query。";
    const found = (window.Kawaii.notes.search(query) || []).slice(0, 5);
    if (!found.length) return `没有匹配「${query}」的笔记。`;
    return found.map((note) => `- ${note.title} (slug: ${note.slug})：${note.summary || ""}`).join("\n");
  }

  function toolRead(args) {
    const slug = String(args.slug || "").trim();
    const note = notes().find((item) => item.slug === slug);
    if (!note) return `没有 slug 为「${slug}」的笔记。`;
    return `# ${note.title}\n${String(note.text || "").slice(0, 6000)}`;
  }

  function toolCollections() {
    const cols = collections();
    if (!cols.length) return "还没有栏目。";
    return cols
      .map((col) => {
        const list = (window.Kawaii.notes.byCollection(col.name) || []).slice(0, 12);
        return `## ${col.name}（${col.count} 篇）\n${list.map((note) => `- ${note.title} (${note.slug})`).join("\n")}`;
      })
      .join("\n\n");
  }

  // Only reversible, local, immediately visible switches: a page jump or a note
  // save stays a click the owner makes himself.
  function toolAction(args) {
    const theme = window.KawaiiTheme;
    const done = [];
    if (args.theme && theme) {
      theme.setSkin(args.theme === "line" ? "line" : "pixel");
      done.push(`皮肤切到 ${args.theme === "line" ? "线稿" : "像素"}`);
    }
    if (typeof args.fx === "boolean" && theme) {
      theme.setFx(args.fx ? "on" : "off");
      done.push(`动效已${args.fx ? "开启" : "关闭"}`);
    }
    return done.length ? `已执行：${done.join("；")}。` : "没有可执行的动作（只支持 theme / fx）。";
  }

  const PROPOSAL_KEY = "kawaii.resource.proposals.v1";

  function toolPropose(args) {
    const list = Array.isArray(args.items) ? args.items : [];
    const items = [];
    for (const raw of list) {
      if (!raw) continue;
      const title = String(raw.title || "").trim().slice(0, 80);
      const url = String(raw.url || "").trim();
      if (!title || !/^https?:\/\//i.test(url)) continue;
      const item = {
        title,
        url,
        category: String(raw.category || "其他").trim().slice(0, 30),
        note: String(raw.note || "").trim().slice(0, 200),
        tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 8).map((tag) => String(tag).trim().slice(0, 20)).filter(Boolean) : []
      };
      if (["file", "pdf", "video", "image", "site", "netdisk"].includes(raw.kind)) item.kind = raw.kind;
      items.push(item);
    }
    if (!items.length) return "没有可导入的资源：每条都需要 title 与 http(s) 链接。";
    try {
      localStorage.setItem(PROPOSAL_KEY, JSON.stringify({ at: new Date().toISOString(), items }));
    } catch (error) {
      return "浏览器存储不可写，推荐没能保存。";
    }
    return `已把 ${items.length} 条推荐放进资源库页的「AI 推荐」区（尚未导入）：${items
      .map((item) => item.title)
      .join("、")}。请他打开 resources.html 核对后一键导入。`;
  }

  const FENCE = "```";

  const BLOCK_BUILDERS = {
    heading: (text) => `## ${text || "小标题"}\n`,
    "callout-note": (text) => `> [!NOTE]\n> ${text || "说明"}\n`,
    "callout-tip": (text) => `> [!TIP]\n> ${text || "提示"}\n`,
    "callout-warning": (text) => `> [!WARNING]\n> ${text || "警告"}\n`,
    task: (text) => `- [ ] ${text || "待办"}\n`,
    table: (text) => `| 列 | 列 |\n| --- | --- |\n| ${text || ""} |  |\n`,
    divider: () => "\n---\n",
    mermaid: (text) => `${FENCE}mermaid\n${text || "flowchart LR\n    A --> B"}\n${FENCE}\n`,
    mindmap: (text) => `${FENCE}mindmap\n${text || "# 中心主题\n## 分支一\n- 要点\n## 分支二\n- 要点"}\n${FENCE}\n`,
    wavedrom: (text) => `${FENCE}wavedrom\n${text || '{"signal":[{"name":"clk","wave":"p...."}]}'}\n${FENCE}\n`,
    "lab-pwm": (text) => `${FENCE}pwm\n${text || '{"frequency": 1000, "duty": 30, "voltage": 3.3}'}\n${FENCE}\n`,
    "lab-rc": (text) => `${FENCE}rc\n${text || '{"resistance": 1000, "capacitance": 100, "voltage": 5}'}\n${FENCE}\n`
  };

  function toolInsert(args) {
    if (!document.querySelector('[data-page="write"]')) {
      return "写作台没有打开：请他先在 write.html 打开文章，再插入内容块。";
    }
    const type = String(args.type || "").trim();
    const build = BLOCK_BUILDERS[type];
    if (!build) {
      return `不支持「${type || "空"}」；可用：${Object.keys(BLOCK_BUILDERS).join(" / ")}。`;
    }
    const markdown = build(String(args.text || "").slice(0, 4000));
    document.dispatchEvent(new CustomEvent("kawaii:write-insert", { detail: { markdown, type } }));
    return `已把「${type}」插入到写作台光标处。`;
  }

  function toolStyle(args) {
    if (!document.querySelector('[data-page="write"]')) {
      return "写作台没有打开：样式只能应用到正在写的文章。";
    }
    const detail = {};
    if (["lime", "pink", "cyan", "amber", "blue"].includes(args.accent)) detail.accent = args.accent;
    if (["reveal", "scan", "signal", "glitch", "type", "none"].includes(args.fx)) detail.fx = args.fx;
    const cover = String(args.cover || "");
    if (/^template:[a-z]+$/.test(cover) || /^assets\/img\/[a-z0-9._-]+$/i.test(cover)) detail.cover = cover;
    if (!Object.keys(detail).length) return "没有可应用的样式（accent / fx / cover）。";
    document.dispatchEvent(new CustomEvent("kawaii:write-style", { detail }));
    return `已应用：${Object.entries(detail).map(([key, value]) => `${key}=${value}`).join("，")}。`;
  }

  const TOOLS = {
    search_notes: toolSearch,
    read_note: toolRead,
    list_collections: toolCollections,
    propose_resources: toolPropose,
    insert_block: toolInsert,
    apply_style: toolStyle,
    site_action: toolAction
  };

  function parseToolCall(reply) {
    const text = String(reply || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    if (!text.startsWith("{") || !text.endsWith("}")) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.tool === "string" && TOOLS[parsed.tool]) {
        return { tool: parsed.tool, args: parsed.args || {} };
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  /* ---------- ask ---------- */

  async function ask(question, { onStage, attachments = [] } = {}) {
    const text = String(question || "").trim();
    if (!text && !attachments.length) throw new Error("问题不能为空。");
    if (!window.KawaiiAI) throw new Error("AI 模块没有加载。");
    if (!window.KawaiiAI.configured()) throw new Error("AI 还没配置：点下面的「配置 AI」，选一个服务商填 Key 就能用。");

    const images = attachments.filter((item) => item.kind === "image");
    const files = attachments.filter((item) => item.kind === "file");
    let prompt = text || (images.length ? "看看这张图，告诉我你看到了什么。" : "看看这些附件。");
    for (const file of files) prompt += `\n\n【附件 ${file.name}】\n${String(file.text || "").slice(0, 8000)}`;

    const userContent = images.length
      ? [{ type: "text", text: prompt }, ...images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } }))]
      : prompt;

    let messages = [
      { role: "system", content: systemPrompt() },
      ...state.history.slice(-6),
      { role: "user", content: userContent }
    ];
    const trace = [];
    let note = "";

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      let reply;
      try {
        reply = await window.KawaiiAI.chat({ messages, temperature: 0.4, maxTokens: 1200 });
      } catch (error) {
        // A provider that cannot read images must not swallow the whole question.
        if (images.length && !note && /HTTP (400|404|413|422|5\d\d)/.test(error.message)) {
          note = "该接口不支持图片输入，本轮已改用纯文本回答。";
          if (onStage) onStage("接口不收图片，改纯文本…");
          const stripped = `${prompt}\n\n【说明：用户附了图片 ${images.map((image) => image.name).join("、")}，但该接口不支持图片输入，图片未发送。请仅按文字回答，并先说明你看不到图片。】`;
          messages = [
            { role: "system", content: systemPrompt() },
            ...state.history.slice(-6),
            { role: "user", content: stripped }
          ];
          continue;
        }
        throw error;
      }
      const call = parseToolCall(reply);
      if (!call) {
        state.history.push({ role: "user", content: prompt }, { role: "assistant", content: reply });
        state.history = state.history.slice(-12);
        return { text: reply, trace, note };
      }
      const result = TOOLS[call.tool](call.args);
      trace.push({ tool: call.tool, args: call.args, result: String(result).slice(0, 400) });
      if (onStage) onStage(`查资料：${call.tool}…`);
      messages.push({ role: "assistant", content: reply }, { role: "user", content: `【${call.tool} 结果】\n${result}` });
    }
    return { text: "查了太多轮还没收敛，换个更具体的问法试试。", trace, note };
  }

  /* ---------- robot ---------- */

  const ROBOT = '<canvas class="robot" width="128" height="128" aria-hidden="true"></canvas>';

  // Pixel robot drawn frame by frame: 32x32 cells, four shades, no smoothing.
  const ROBOT_COL = { line: "#0c0817", body: "#3a2a63", light: "#55408c", dark: "#241a42", visor: "#120c22", eye: "#b8ff5a", eyeDim: "#4c7a1f", pink: "#ff5fd2" };

  function paintRobot(canvas, mood, time) {
    const ctx = canvas.getContext("2d");
    const size = canvas.width / 32;
    const px = (x, y, w, h, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x * size), Math.round(y * size), Math.ceil(w * size), Math.ceil(h * size));
    };
    const bob = Math.round(Math.sin(time * 1.8) * 0.7);
    const blink = Math.floor(time * 2) % 7 === 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // antenna
    px(15, 5 + bob, 2, 5, ROBOT_COL.light);
    px(14, 2 + bob, 4, 3, ROBOT_COL.line);
    px(15, 3 + bob, 2, 1, Math.floor(time * 2) % 2 ? ROBOT_COL.eyeDim : ROBOT_COL.eye);
    // ears
    px(5, 12 + bob, 2, 6, ROBOT_COL.light);
    px(25, 12 + bob, 2, 6, ROBOT_COL.light);
    // head
    px(6, 7 + bob, 20, 17, ROBOT_COL.line);
    px(7, 8 + bob, 18, 15, ROBOT_COL.body);
    px(7, 8 + bob, 18, 1, ROBOT_COL.light);
    // visor
    px(9, 11 + bob, 14, 8, ROBOT_COL.visor);
    const scan = mood === "thinking" ? Math.round(Math.sin(time * 6) * 2) : 0;
    if (blink) {
      px(11 + scan, 14 + bob, 3, 1, ROBOT_COL.eye);
      px(18 + scan, 14 + bob, 3, 1, ROBOT_COL.eye);
    } else {
      px(11 + scan, 13 + bob, 3, 3, ROBOT_COL.eye);
      px(18 + scan, 13 + bob, 3, 3, ROBOT_COL.eye);
    }
    // mouth
    if (mood === "talking") {
      px(13, 20 + bob, 6, Math.floor(time * 12) % 2 ? 1 : 2, ROBOT_COL.eye);
    } else if (mood === "thinking") {
      px(13, 20 + bob, 6, 1, ROBOT_COL.eyeDim);
    } else {
      px(13, 20 + bob, 6, 1, ROBOT_COL.light);
    }
    // body
    px(9, 24 + bob, 14, 6, ROBOT_COL.line);
    px(10, 25 + bob, 12, 4, ROBOT_COL.dark);
    px(11, 26 + bob, 2, 2, ROBOT_COL.pink);
    px(15, 26 + bob, 2, 2, ROBOT_COL.eye);
    px(19, 26 + bob, 2, 2, ROBOT_COL.light);
    px(6, 24 + bob, 2, 5, ROBOT_COL.body);
    px(24, 24 + bob, 2, 5, ROBOT_COL.body);
    px(11, 30, 10, 1, "rgba(0,0,0,0.35)");
  }

  function startRobot(canvas, moodOf) {
    if (!canvas) return;
    const still = () => (window.Kawaii && window.Kawaii.ui && window.Kawaii.ui.prefersReduced ? window.Kawaii.ui.prefersReduced() : false) || document.documentElement.dataset.fx === "off";
    let last = 0;
    const loop = (now) => {
      canvas.__raf = requestAnimationFrame(loop);
      if (!canvas.isConnected) { cancelAnimationFrame(canvas.__raf); return; }
      if (!canvas.closest("dialog").open) return;
      if (now - last < 125) return;
      last = now;
      paintRobot(canvas, moodOf(), now / 1000);
    };
    paintRobot(canvas, moodOf(), 0);
    if (!still()) canvas.__raf = requestAnimationFrame(loop);
  }

  /* ---------- panel ---------- */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function escapeText(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function buildPanel() {
    const dialog = el("dialog", "agent");
    dialog.setAttribute("aria-labelledby", "agent-title");
    dialog.dataset.mood = "idle";
    dialog.innerHTML = `
<div class="agent__head">
  <div class="agent__bot">${ROBOT}</div>
  <div class="agent__who">
    <span class="agent__tag">AI / 机器人助教</span>
    <h2 class="agent__title" id="agent-title">问这个站</h2>
  </div>
  <button class="agent__close" type="button" data-agent-close aria-label="关闭">×</button>
</div>

<section class="agent__setup" data-agent-setup hidden>
  <p class="agent__setup-lede">选一个服务商，粘贴它给你的 Key。接口地址和模型名会自动填好，也可以自己改。</p>
  <div class="agent__providers" role="group" aria-label="服务商">
    ${PROVIDERS.map((provider) => `<button type="button" class="agent__provider" data-provider="${provider.id}">${provider.name}</button>`).join("")}
  </div>
  <div class="agent__setup-grid">
    <label class="agent__field"><span class="agent__label">接口地址</span><input type="url" data-ai-field="endpoint" placeholder="https://api.deepseek.com/v1" autocomplete="off"></label>
    <label class="agent__field"><span class="agent__label">模型</span><input type="text" data-ai-field="model" placeholder="deepseek-chat" autocomplete="off"></label>
    <label class="agent__field agent__field--wide"><span class="agent__label">API Key</span><input type="password" data-ai-field="key" placeholder="sk-..." autocomplete="off"></label>
  </div>
  <div class="agent__setup-row agent__setup-row--models">
    <button class="btn btn--ghost agent__models-btn" type="button" data-agent-models>拉取模型列表</button>
    <select class="agent__model-pick" data-ai-model-pick hidden aria-label="从服务商拉取的模型"></select>
  </div>
  <div class="agent__setup-row">
    <a class="agent__keys" data-ai-keys href="#" target="_blank" rel="noopener noreferrer" hidden>去这个服务商拿 Key ↗</a>
    <label class="agent__remember"><input type="checkbox" data-ai-field="remember"> 记住在这台设备</label>
  </div>
  <p class="agent__setup-msg" data-agent-setup-msg></p>
  <div class="agent__setup-actions">
    <button class="btn btn--primary" type="button" data-agent-save>保存并测试</button>
    <button class="btn btn--ghost" type="button" data-agent-cancel>取消</button>
  </div>
</section>

<div class="agent__log" data-agent-log>
  <div class="agent__msg agent__msg--bot">
    <p>我知道这个站里写过什么，也能看你传上来的图和文件。可以问：</p>
    <ul class="agent__suggest" data-agent-suggest>
      <li><button type="button">我卡在中断优先级，用我自己的笔记讲一遍</button></li>
      <li><button type="button">把 I2C 排障那篇总结成三句话</button></li>
      <li><button type="button">我下一步该写哪篇笔记</button></li>
    </ul>
  </div>
</div>

<ul class="agent__attachments" data-agent-attachments hidden></ul>

<form class="agent__form" data-agent-form>
  <button class="agent__attach" type="button" data-agent-attach aria-label="添加图片或文件" title="添加图片或文件">＋</button>
  <input type="file" data-agent-file hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,.md,.txt,.json,.c,.h,.py,.js,.csv">
  <label class="agent__field">
    <span class="agent__label">ASK / 提问 · 也可以把图片拖进来</span>
    <input type="text" data-agent-input placeholder="例如：这张示波器截图里，上升沿为什么这么慢？" autocomplete="off">
  </label>
  <button class="btn btn--primary" type="submit" data-agent-send>发送</button>
</form>
<div class="agent__foot">
  <span class="agent__status" data-agent-status></span>
  <button class="btn btn--ghost" type="button" data-agent-config>配置 AI</button>
</div>`;

    const log = dialog.querySelector("[data-agent-log]");
    const input = dialog.querySelector("[data-agent-input]");
    const status = dialog.querySelector("[data-agent-status]");
    const field = (name) => dialog.querySelector(`[data-ai-field="${name}"]`);
    const setup = dialog.querySelector("[data-agent-setup]");
    const setupMsg = dialog.querySelector("[data-agent-setup-msg]");
    const modelPick = dialog.querySelector("[data-ai-model-pick]");
    const modelsBtn = dialog.querySelector("[data-agent-models]");
    const form = dialog.querySelector("[data-agent-form]");
    let provider = "deepseek";

    function setMood(mood) {
      dialog.dataset.mood = mood;
    }

    function append(kind, text) {
      const message = el("div", `agent__msg agent__msg--${kind}`, text);
      log.appendChild(message);
      log.scrollTop = log.scrollHeight;
      return message;
    }

    /* ----- setup ----- */

    function paintProviders() {
      dialog.querySelectorAll("[data-provider]").forEach((button) => {
        button.setAttribute("aria-pressed", button.dataset.provider === provider ? "true" : "false");
      });
      const chosen = PROVIDERS.find((item) => item.id === provider);
      const keys = dialog.querySelector("[data-ai-keys]");
      keys.hidden = !chosen || !chosen.keys;
      if (chosen && chosen.keys) keys.href = chosen.keys;
    }

    function fillSetup() {
      const config = window.KawaiiAI.load();
      field("endpoint").value = config.endpoint;
      field("model").value = config.model;
      field("key").value = config.key;
      field("remember").checked = config.remember;
      provider = PROVIDERS.find((item) => item.endpoint && config.endpoint.startsWith(item.endpoint))?.id || "deepseek";
      paintProviders();
      setupMsg.textContent = config.endpoint ? "已经保存过一个接口，可以直接改。" : "";
      setupMsg.className = "agent__setup-msg";
    }

    function pickProvider(id) {
      provider = id;
      const chosen = PROVIDERS.find((item) => item.id === id);
      if (chosen && id !== "custom") {
        field("endpoint").value = chosen.endpoint;
        field("model").value = chosen.model;
      }
      paintProviders();
      resetModelPick();
      (id === "custom" ? field("endpoint") : field("key")).focus();
      if (id !== "custom" && field("key").value.trim()) fetchModels();
    }

    function openSetup() {
      fillSetup();
      resetModelPick();
      setup.hidden = false;
      log.hidden = true;
      form.hidden = true;
      dialog.querySelector("[data-agent-config]").hidden = true;
      dialog.querySelector("[data-agent-attachments]").hidden = true;
      status.textContent = "";
      setMood("idle");
      field("key").focus();
    }

    function closeSetup() {
      setup.hidden = true;
      log.hidden = false;
      form.hidden = false;
      dialog.querySelector("[data-agent-config]").hidden = false;
      paintAttachments();
      input.focus();
    }

    async function saveAndTest() {
      const config = {
        endpoint: field("endpoint").value.trim(),
        model: field("model").value.trim(),
        key: field("key").value.trim(),
        remember: field("remember").checked
      };
      if (!config.endpoint || !config.model || !config.key) {
        setupMsg.textContent = "三项都要填：接口地址、模型名、API Key。";
        setupMsg.className = "agent__setup-msg is-error";
        return;
      }
      window.KawaiiAI.save(config);
      setupMsg.textContent = `正在用 ${config.model} 测试连接…`;
      setupMsg.className = "agent__setup-msg";
      setMood("thinking");
      try {
        const reply = await window.KawaiiAI.chat({
          messages: [{ role: "user", content: "只回复两个字：在的" }],
          maxTokens: 16,
          temperature: 0
        });
        setupMsg.textContent = `连接成功，机器人说：${String(reply).slice(0, 24)}`;
        setupMsg.className = "agent__setup-msg is-ok";
        status.textContent = "AI 已就绪";
        window.setTimeout(closeSetup, 700);
      } catch (error) {
        const saved = /HTTP 5\d\d/.test(error.message) ? " 配置已保存：稍后点「保存并测试」重试，或在上方列表换个模型。" : "";
        setupMsg.textContent = `${error.message}${saved}`;
        setupMsg.className = "agent__setup-msg is-error";
        status.textContent = saved ? "连接测试未通过（配置已保存）" : "配置未通过";
      } finally {
        setMood("idle");
      }
    }

    /* ----- model list ----- */

    function resetModelPick() {
      modelPick.hidden = true;
      modelPick.innerHTML = "";
    }

    // A native select fires no change when its shown option is re-picked,
    // so the picker must never display a model the field does not hold.
    function syncPickFromField() {
      const ids = [...modelPick.options].map((option) => option.value).filter(Boolean);
      const current = field("model").value.trim();
      modelPick.value = ids.includes(current) ? current : "";
    }

    let modelsBusy = false;
    async function fetchModels() {
      if (modelsBusy) return;
      const endpoint = field("endpoint").value.trim();
      const key = field("key").value.trim();
      if (!endpoint || !key) {
        setupMsg.textContent = "先填接口地址和 API Key，再拉模型列表。";
        setupMsg.className = "agent__setup-msg is-error";
        return;
      }
      modelsBusy = true;
      modelsBtn.disabled = true;
      const label = modelsBtn.textContent;
      modelsBtn.textContent = "拉取中…";
      setupMsg.textContent = "拉取模型列表中…";
      setupMsg.className = "agent__setup-msg";
      try {
        const ids = await window.KawaiiAI.listModels({ endpoint, key });
        modelPick.innerHTML = `<option value="">手填 / 待选择</option>` + ids.map((id) => `<option value="${escapeText(id)}">${escapeText(id)}</option>`).join("");
        syncPickFromField();
        modelPick.hidden = false;
        setupMsg.textContent = `拉到 ${ids.length} 个模型，点下拉选择或继续手填。`;
        setupMsg.className = "agent__setup-msg is-ok";
      } catch (error) {
        resetModelPick();
        setupMsg.textContent = error.message;
        setupMsg.className = "agent__setup-msg is-error";
      } finally {
        modelsBusy = false;
        modelsBtn.disabled = false;
        modelsBtn.textContent = label;
      }
    }

    /* ----- attachments ----- */

    function paintAttachments() {
      const host = dialog.querySelector("[data-agent-attachments]");
      host.innerHTML = state.attachments
        .map((item, index) => `<li class="agent__chip${item.kind === "image" ? " agent__chip--image" : ""}" data-chip="${index}">
  ${item.kind === "image" ? `<img src="${item.dataUrl}" alt="${escapeText(item.name)}" loading="lazy">` : '<span class="agent__chip-glyph" aria-hidden="true">▤</span>'}
  <span class="agent__chip-name">${escapeText(item.name)}</span>
  <span class="agent__chip-size">${Math.max(1, Math.round(item.size / 1024))}K</span>
  <i class="agent__chip-scan" aria-hidden="true"></i>
  <button type="button" data-chip-remove="${index}" aria-label="移除">×</button>
</li>`)
        .join("");
      host.hidden = !state.attachments.length;
    }

    function readFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        if (/^image\//.test(file.type)) {
          if (file.size > MAX_IMAGE) {
            reject(new Error(`${file.name} 超过 4MB，先压一下再传。`));
            return;
          }
          reader.onload = () => resolve({ kind: "image", name: file.name, size: file.size, dataUrl: String(reader.result) });
          reader.readAsDataURL(file);
          return;
        }
        if (file.size > MAX_TEXT) {
          reject(new Error(`${file.name} 超过 200KB，先截取一段。`));
          return;
        }
        reader.onload = () => resolve({ kind: "file", name: file.name, size: file.size, text: String(reader.result).slice(0, 8000) });
        reader.readAsText(file);
      });
    }

    async function addFiles(fileList) {
      for (const file of [...fileList]) {
        if (state.attachments.length >= MAX_ATTACHMENTS) {
          status.textContent = `最多带 ${MAX_ATTACHMENTS} 个附件`;
          break;
        }
        try {
          const item = await readFile(file);
          state.attachments.push(item);
          setMood("thinking");
          window.setTimeout(() => setMood("idle"), 260);
          paintAttachments();
          status.textContent = "";
        } catch (error) {
          status.textContent = error.message;
        }
      }
    }

    /* ----- send ----- */

    async function submit(question) {
      if (state.busy) return;
      if (!question.trim() && !state.attachments.length) return;
      state.busy = true;
      setMood("thinking");
      status.textContent = "思考中…";
      const attachments = state.attachments.slice();
      state.attachments = [];
      paintAttachments();

      append("user", question || `（${attachments.length} 个附件）`);
      if (attachments.length) {
        const note = el("div", "agent__sent-files");
        note.innerHTML = attachments
          .map((item) => `<span class="agent__sent-file">${item.kind === "image" ? "▣" : "▤"} ${escapeText(item.name)}</span>`)
          .join("");
        log.appendChild(note);
      }
      const pending = append("bot", "…");
      try {
        const answer = await ask(question, { attachments, onStage: (stage) => { pending.textContent = stage; } });
        setMood("talking");
        pending.textContent = answer.text;
        let anchor = pending.nextSibling;
        if (answer.trace.length) {
          const traceEl = el("div", "agent__trace", `工具：${answer.trace.map((item) => item.tool).join(" → ")}`);
          log.insertBefore(traceEl, anchor);
          anchor = traceEl.nextSibling;
        }
        if (answer.note) log.insertBefore(el("div", "agent__trace", answer.note), anchor);
        status.textContent = "";
        input.value = "";
        window.setTimeout(() => setMood("idle"), 1400);
      } catch (error) {
        pending.textContent = error.message;
        pending.classList.add("agent__msg--error");
        status.textContent = "出错了";
        setMood("idle");
      } finally {
        state.busy = false;
        input.focus();
      }
    }

    /* ----- wiring ----- */

    dialog.querySelector("[data-agent-close]").addEventListener("click", () => dialog.close());
    dialog.querySelector("[data-agent-suggest]").addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (button) submit(button.textContent);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit(input.value);
    });
    dialog.querySelector("[data-agent-config]").addEventListener("click", openSetup);
    dialog.querySelector("[data-agent-cancel]").addEventListener("click", closeSetup);
    dialog.querySelector("[data-agent-save]").addEventListener("click", saveAndTest);
    modelsBtn.addEventListener("click", fetchModels);
    modelPick.addEventListener("change", () => {
      if (modelPick.value) field("model").value = modelPick.value;
    });
    field("model").addEventListener("input", syncPickFromField);
    dialog.querySelectorAll("[data-provider]").forEach((button) => {
      button.addEventListener("click", () => pickProvider(button.dataset.provider));
    });

    const fileInput = dialog.querySelector("[data-agent-file]");
    dialog.querySelector("[data-agent-attach]").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      addFiles(fileInput.files);
      fileInput.value = "";
    });
    dialog.addEventListener("dragover", (event) => {
      event.preventDefault();
      dialog.classList.add("is-dropping");
    });
    dialog.addEventListener("dragleave", () => dialog.classList.remove("is-dropping"));
    dialog.addEventListener("drop", (event) => {
      event.preventDefault();
      dialog.classList.remove("is-dropping");
      if (event.dataTransfer && event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
    });
    input.addEventListener("paste", (event) => {
      const files = [...((event.clipboardData && event.clipboardData.files) || [])];
      if (files.length) {
        event.preventDefault();
        addFiles(files);
      }
    });
    dialog.querySelector("[data-agent-attachments]").addEventListener("click", (event) => {
      const button = event.target.closest("[data-chip-remove]");
      if (!button) return;
      state.attachments.splice(Number(button.dataset.chipRemove), 1);
      paintAttachments();
    });
    dialog.addEventListener("close", () => {
      state.open = false;
      setMood("idle");
    });

    paintAttachments();
    document.body.appendChild(dialog);
    startRobot(dialog.querySelector(".robot"), () => dialog.dataset.mood || "idle");
    return { dialog, input, log, status, setMood, openSetup, closeSetup, paintAttachments };
  }

  let panel = null;

  function ensurePanel() {
    if (!panel) panel = buildPanel();
    return panel;
  }

  function open(question) {
    const ui = ensurePanel();
    state.open = true;
    if (!ui.dialog.open) ui.dialog.showModal();
    if (question) {
      ui.input.value = question;
      ui.dialog.querySelector("[data-agent-form]").requestSubmit();
    } else if (!window.KawaiiAI.configured()) {
      ui.openSetup();
    } else {
      ui.input.focus();
    }
  }

  function mountLauncher() {
    if (document.querySelector("[data-agent-open]")) return;
    const button = el("button", "agent-launcher");
    button.type = "button";
    button.setAttribute("data-agent-open", "");
    button.setAttribute("aria-label", "问 AI 助教（快捷键 Ctrl + K）");
    button.innerHTML = '<span class="agent-launcher__glyph" aria-hidden="true">AI</span><span class="agent-launcher__label">问助教</span>';
    button.addEventListener("click", () => open());
    document.body.appendChild(button);

    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
      }
    });
  }

  function boot() {
    if (!window.Kawaii) return;
    mountLauncher();
  }

  window.KawaiiAgent = {
    ask,
    open,
    corpusStats() {
      return { notes: notes().length, chars: corpus().length };
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
