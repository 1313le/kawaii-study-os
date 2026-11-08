/* =========================================================
   kawaii / STUDY OS — terminal emulator
   ========================================================= */

(function () {
  "use strict";

  const Kawaii = window.Kawaii;
  if (!Kawaii) return;
  const { escape, formatDate, formatDateCn } = Kawaii.ui;
  const { notes, stats } = Kawaii;
  const SITE = Kawaii.site;

  const PAGES = {
    home: "index.html",
    index: "index.html",
    logs: "logs.html",
    write: "write.html",
    map: "mindmap.html",
    mindmap: "mindmap.html",
    resources: "resources.html",
    res: "resources.html",
    about: "about.html",
    note: "logs.html"
  };

  const COMMANDS = [
    ["help", "显示命令清单"],
    ["ls", "列出页面 / 栏目 / 笔记 / 标签"],
    ["open", "打开页面、栏目或笔记 open <target>"],
    ["note", "打开指定笔记 note <slug>"],
    ["write", "打开写作台 write [slug]"],
    ["ask", "问站内 AI 助教 ask <问题>"],
    ["res", "查看资源库，或 res add 打开"],
    ["logs", "列出最新学习日志"],
    ["search", "检索笔记 search <关键词>"],
    ["stats", "查看写作统计 stats"],
    ["theme", "切换皮肤 theme [pixel|line]"],
    ["fx", "开启动效 fx [on|off]"],
    ["goto", "跳转页面 goto <home|logs|write|map|about>"],
    ["whoami", "显示当前身份"],
    ["neofetch", "显示系统信息"],
    ["date", "显示当前时间"],
    ["history", "显示命令历史"],
    ["clear", "清屏"],
    ["exit", "关闭终端"]
  ];

  let dialog = null;
  let output = null;
  let form = null;
  let input = null;
  let suggest = null;
  let initialized = false;
  let greeted = false;
  let history = loadHistory();
  let historyIndex = history.length;
  let draft = "";

  function loadHistory() {
    try {
      const raw = sessionStorage.getItem("kawaii.terminal.history");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.slice(-50) : [];
    } catch (error) {
      return [];
    }
  }

  function saveHistory() {
    try {
      sessionStorage.setItem("kawaii.terminal.history", JSON.stringify(history.slice(-50)));
    } catch (error) {
      /* ignore */
    }
  }

  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "terminal";
    dialog.id = "kawaii-terminal";
    dialog.setAttribute("aria-labelledby", "terminal-title");
    dialog.innerHTML = `<div class="terminal__frame">
  <div class="terminal__bar">
    <span class="console-dots" aria-hidden="true"><span></span><span></span><span></span></span>
    <span class="terminal__title" id="terminal-title"><b>${escape(SITE.terminalUser || "kawaii")}</b>@${escape(SITE.terminalHost || "study")}: ~ / console</span>
    <span class="terminal__hint">ESC CLOSE · ~ TOGGLE</span>
    <button class="terminal__close" type="button" data-terminal-close aria-label="关闭终端">×</button>
  </div>
  <div class="terminal__body">
    <div class="terminal__output" id="terminal-output" role="log" aria-live="polite" aria-label="终端输出"></div>
    <div class="terminal__suggest" id="terminal-suggest"></div>
    <form class="terminal__input-row" id="terminal-form" autocomplete="off">
      <label class="terminal__prompt" for="terminal-input"><b>${escape(SITE.terminalUser || "kawaii")}</b>@${escape(SITE.terminalHost || "study")}:<i>~</i>$</label>
      <input class="terminal__input" id="terminal-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="type help" aria-label="输入终端命令">
    </form>
    <div class="terminal__hints">
      <span><kbd>↑</kbd><kbd>↓</kbd> 历史</span>
      <span><kbd>TAB</kbd> 补全</span>
      <span><kbd>CTRL+L</kbd> 清屏</span>
      <span><kbd>ESC</kbd> 关闭</span>
    </div>
  </div>
</div>`;
    document.body.appendChild(dialog);

    output = dialog.querySelector("#terminal-output");
    form = dialog.querySelector("#terminal-form");
    input = dialog.querySelector("#terminal-input");
    suggest = dialog.querySelector("#terminal-suggest");

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const raw = input.value.trim();
      input.value = "";
      if (!raw) return;
      run(raw);
    });

    input.addEventListener("keydown", onInputKey);

    dialog.querySelector("[data-terminal-close]").addEventListener("click", close);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });

    renderSuggest();
  }

  function renderSuggest() {
    const items = ["help", "ls collections", "logs", "stats", "theme", "neofetch"];
    suggest.innerHTML = items
      .map((item) => `<button type="button" data-suggest="${escape(item)}">${escape(item)}</button>`)
      .join("");
    suggest.querySelectorAll("[data-suggest]").forEach((button) => {
      button.addEventListener("click", () => {
        input.value = button.dataset.suggest;
        input.focus();
      });
    });
  }

  function write(html, className) {
    const line = document.createElement("p");
    line.className = "t-line" + (className ? " t-line--" + className : "");
    line.innerHTML = html;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
    return line;
  }

  function writeText(text, className) {
    return write(escape(text), className);
  }

  function blank() {
    const line = document.createElement("p");
    line.className = "t-line t-line--gap";
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  }

  function greet() {
    if (greeted) {
      writeText("terminal ready. type `help` to continue.", "dim");
      return;
    }
    greeted = true;
    const lines = [
      ["KAWAII / STUDY OS · TERMINAL", "head"],
      ["BUILD / FLASH / LOG / REPEAT", "dim"],
      ["", "gap"]
    ];
    lines.forEach(([text, cls]) => {
      if (!text) blank();
      else writeText(text, cls);
    });

    const boot = [
      ["mount /dev/study", "OK"],
      ["index notes", `${notes.all.length} entries`],
      ["collections", `${stats.collections} defined`],
      ["link skin", document.documentElement.dataset.skin]
    ];
    boot.forEach(([label, value], index) => {
      window.setTimeout(() => {
        write(`[ OK ] ${escape(label)} <span class="t-line--dim">· ${escape(value)}</span>`, "ok");
      }, 45 * index);
    });

    window.setTimeout(() => {
      blank();
      writeText("SYSTEM ONLINE. 输入 help 查看命令，或直接说 search STM32。", "accent");
    }, 45 * boot.length + 30);
  }

  function open() {
    if (!initialized) {
      initialized = true;
      build();
    }
    if (!dialog) return;
    if (!dialog.open) {
      dialog.showModal();
      greet();
    }
    window.setTimeout(() => {
      if (input) input.focus();
    }, 30);
  }

  function close() {
    if (dialog && dialog.open) dialog.close();
  }

  /* ---------- navigation ---------- */

  function go(url) {
    close();
    window.setTimeout(() => {
      window.location.href = url;
    }, 80);
  }

  function noteUrl(slug) {
    return "note.html?slug=" + encodeURIComponent(slug);
  }

  function resolveTarget(raw) {
    if (!raw) return null;
    const target = raw.toLowerCase();
    if (PAGES[target]) return { url: PAGES[target], label: target };
    const collection = notes.collections().find((item) => item.name.toLowerCase() === target);
    if (collection) return { url: "logs.html?collection=" + encodeURIComponent(collection.name), label: collection.name };
    const note = notes.find(target);
    if (note) return { url: noteUrl(note.slug), label: note.title };
    return null;
  }

  /* ---------- commands ---------- */

  function printHelp() {
    writeText("COMMANDS / 命令", "head");
    COMMANDS.forEach(([name, desc]) => {
      write(`<code>${escape(name)}</code>  ${escape(desc)}`, "cmd");
    });
    blank();
    writeText("提示：Tab 补全，↑↓ 翻历史，~ 快速开关终端。", "dim");
  }

  function printLs(scope) {
    const area = String(scope || "").toLowerCase();
    if (!area || area === "pages" || area === "page") {
      writeText("PAGES / 页面", "head");
      ["home → index.html", "logs → logs.html", "write → write.html", "map → mindmap.html", "resources → resources.html", "about → about.html"].forEach((line) => {
        writeText("  " + line, "cmd");
      });
      writeText("再试：ls collections · ls notes · ls tags", "dim");
      return;
    }
    if (area === "collections" || area === "collection") {
      writeText("COLLECTIONS / 栏目", "head");
      notes.collections().forEach((col) => {
        write(
          `  <code>${escape(col.name)}</code>  <span class="t-line--dim">${col.count} notes</span>`,
          "cmd"
        );
      });
      return;
    }
    if (area === "notes" || area === "note") {
      writeText("NOTES / 笔记", "head");
      notes.all.forEach((note) => {
        write(
          `  <code>${escape(note.slug)}</code>  ${escape(note.title)} <span class="t-line--dim">${formatDate(note.date)}</span>`,
          "cmd"
        );
      });
      return;
    }
    if (area === "tags" || area === "tag") {
      writeText("TAGS / 标签", "head");
      writeText("  " + notes.tags().map((tag) => `#${tag.name}(${tag.count})`).join("  "), "cmd");
      return;
    }
    writeText(`ls: 未知范围 "${scope}"。可用：pages / collections / notes / tags`, "err");
  }

  function printLogs(count) {
    const n = Math.max(1, Math.min(20, Number(count) || 4));
    writeText(`LOGS / 最新 ${n} 条`, "head");
    notes.latest(n).forEach((note) => {
      write(
        `  ${formatDate(note.date)}  <a href="${noteUrl(note.slug)}">${escape(note.title)}</a> <span class="t-line--dim">· ${note.minutes} min</span>`,
        "cmd"
      );
    });
    blank();
    writeText("search <关键词> 可全文检索。", "dim");
  }

  function printSearch(query) {
    if (!query) {
      writeText("search: 需要一个关键词，例如 search STM32", "err");
      return;
    }
    const results = notes.search(query).slice(0, 8);
    if (!results.length) {
      writeText(`search: 没有与 "${query}" 匹配的笔记。`, "warn");
      return;
    }
    writeText(`SEARCH / "${query}" · ${results.length} 条`, "head");
    results.forEach((note) => {
      write(`  <a href="${noteUrl(note.slug)}">${escape(note.title)}</a> <span class="t-line--dim">· ${formatDate(note.date)}</span>`, "cmd");
      if (note.summary) writeText("    " + note.summary, "dim");
    });
    if (notes.search(query).length > results.length) {
      writeText("  仅显示前 8 条。", "dim");
    }
  }

  function printStats() {
    writeText("STATS / 写作统计", "head");
    write(`  <span class="t-bar"><i style="width:${stats.pct()}%"></i></span> ${stats.pct()}% · ${stats.notes}/${stats.goal} notes`, "ok");
    blank();
    write(`NOTES       : ${stats.notes}`, "cmd");
    write(`WORDS       : ${stats.words.toLocaleString("en-US")}`, "cmd");
    write(`TAGS        : ${stats.tags}`, "cmd");
    write(`COLLECTIONS : ${stats.collections}`, "cmd");
    blank();
    notes.collections().forEach((col) => {
      const share = stats.notes ? Math.round((col.count / stats.notes) * 100) : 0;
      write(
        `  ${escape(col.name)}  <span class="t-bar"><i style="width:${share}%"></i></span> ${col.count} notes`,
        "cmd"
      );
    });
    blank();
    writeText("写作目标可在 data/site.js 的 goalNotes 调整。", "dim");
  }

  function printNeofetch() {
    const skin = document.documentElement.dataset.skin;
    const art = [
      "   ██   ██   ",
      "  █████████ ",
      " ███████████",
      " ███████████",
      "  █████████ ",
      "   ███████  ",
      "    █████   ",
      "     ███    ",
      "      █     "
    ];
    art.forEach((line) => writeText(line, "ascii"));
    writeText(`${SITE.terminalUser || "kawaii"}@${SITE.terminalHost || "study"}`, "head");
    writeText("-------------------", "dim");
    write(`OS      : ${escape(SITE.system || "STUDY OS")} ${escape(SITE.version || "v1.0.0")}`, "cmd");
    write(`SKIN    : ${escape(skin)}`, "cmd");
    write(`COLS    : ${stats.collections} collections`, "cmd");
    write(`WORDS   : ${stats.words.toLocaleString("en-US")} · ${stats.pct()}% of goal`, "cmd");
    write(`NOTES   : ${notes.all.length} entries`, "cmd");
    write(`FOCUS   : ${escape(SITE.focus || "—")}`, "cmd");
    write(`SHELL   : study-sh 1.0`, "cmd");
  }

  function printRes() {
    writeText("RESOURCES / 资源库", "head");
    fetch("/api/resources", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!data) throw new Error("offline");
        const items = (data.items || []).slice(0, 6);
        if (!items.length) {
          writeText("资源库还是空的。运行 res add 打开资源库添加第一条。", "warn");
          return;
        }
        items.forEach((item) => {
          write(
            `  <a href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${escape(item.title)}</a> <span class="t-line--dim">· ${escape(item.category || "其他")}</span>`,
            "cmd"
          );
        });
        blank();
        writeText(`共 ${(data.items || []).length} 条 · res add 打开资源库`, "dim");
      })
      .catch(() => {
        writeText("资源库需要本地服务；打开 resources.html 也能浏览静态索引。", "warn");
      });
  }

  function run(raw) {
    history.push(raw);
    historyIndex = history.length;
    saveHistory();

    write(
      `<span class="prompt-user">${escape(SITE.terminalUser || "kawaii")}</span>@${escape(SITE.terminalHost || "study")}:<span class="prompt-path">~</span>$ ${escape(raw)}`,
      "cmd"
    );

    const parts = raw.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case "help":
      case "?":
        printHelp();
        break;
      case "ls":
      case "dir":
        printLs(args[0]);
        break;
      case "open":
      case "goto": {
        if (!args[0]) {
          writeText(`${command}: 需要目标。可用：home / logs / write / about / 栏目名 / 笔记 slug`, "err");
          break;
        }
        const target = resolveTarget(args.join(" "));
        if (!target) {
          writeText(`${command}: 未找到 "${args.join(" ")}"。`, "err");
          break;
        }
        writeText(`open → ${target.label}`, "ok");
        go(target.url);
        break;
      }
      case "note": {
        const slug = args[0];
        if (!slug) {
          writeText("note: 需要一个 slug，例如 note stm32-gpio", "err");
          break;
        }
        const note = notes.find(slug);
        if (!note) {
          writeText(`note: 未找到 "${slug}"。运行 ls notes 查看全部。`, "err");
          break;
        }
        writeText(`open → ${note.title}`, "ok");
        go(noteUrl(note.slug));
        break;
      }
      case "ask": {
        const question = args.join(" ").trim();
        if (!question) {
          writeText("ask: 直接问，例如 ask I2C 为什么要上拉", "err");
          break;
        }
        if (!window.KawaiiAgent) {
          writeText("ask: AI 模块没有加载", "err");
          break;
        }
        close();
        window.setTimeout(() => window.KawaiiAgent.open(question), 120);
        break;
      }
      case "write": {
        const slug = args[0];
        writeText(`open → 写作台${slug ? ` · ${slug}` : ""}`, "ok");
        go(slug ? `write.html?slug=${encodeURIComponent(slug)}` : "write.html");
        break;
      }
      case "logs":
      case "log":
        printLogs(args[0]);
        break;
      case "search":
      case "grep":
        printSearch(args.join(" "));
        break;
      case "stats":
        printStats();
        break;
      case "res":
      case "resources": {
        if (args[0] === "add" || args[0] === "open") {
          writeText("open → 资源库", "ok");
          go("resources.html");
        } else {
          printRes();
        }
        break;
      }
      case "theme":
      case "skin": {
        if (args[0] === "pixel" || args[0] === "line") {
          window.KawaiiTheme.setSkin(args[0]);
          writeText(`theme: ${args[0]}`, "ok");
        } else if (!args[0]) {
          window.KawaiiTheme.toggle();
          writeText(`theme: ${window.KawaiiTheme.current()}`, "ok");
        } else {
          writeText("theme: 可用 pixel / line", "err");
        }
        break;
      }
      case "fx": {
        if (args[0] === "on" || args[0] === "off") {
          window.KawaiiTheme.setFx(args[0]);
          writeText(`fx: ${args[0]}`, "ok");
        } else if (!args[0]) {
          window.KawaiiTheme.toggleFx();
          writeText(`fx: ${window.KawaiiTheme.fxOn() ? "on" : "off"}`, "ok");
        } else {
          writeText("fx: 可用 on / off", "err");
        }
        break;
      }
      case "whoami":
        write(`${escape(SITE.role || "硬件开发 / 学习者")} · ${escape(SITE.brand || "kawaii")}@${escape(SITE.terminalHost || "study")}`, "cmd");
        break;
      case "neofetch":
        printNeofetch();
        break;
      case "date":
        writeText(new Date().toLocaleString("zh-CN", { hour12: false }), "cmd");
        writeText(formatDateCn(new Date().toISOString()), "dim");
        break;
      case "history":
        writeText("HISTORY / 命令历史", "head");
        history.slice(-30).forEach((item, index) => {
          writeText(`  ${String(index + 1).padStart(2, "0")}  ${item}`, "dim");
        });
        break;
      case "clear":
      case "cls":
        output.innerHTML = "";
        break;
      case "exit":
      case "quit":
        close();
        break;
      case "sudo":
        writeText("sudo: 你已经是自己学习系统里的 root 了。", "warn");
        break;
      case "hello":
      case "hi":
        writeText("hello, kawaii. 今天想写点什么？", "accent");
        break;
      default:
        writeText(`${command}: 未知命令。输入 help 查看清单。`, "err");
        if (suggestCommand(command)) {
          writeText(`你是不是想输入：${suggestCommand(command)}`, "dim");
        }
    }
  }

  function suggestCommand(inputValue) {
    const match = COMMANDS.map(([name]) => name).find((name) => name.startsWith(inputValue.slice(0, 2)));
    return match || null;
  }

  function tabs() {
    const raw = input.value;
    const parts = raw.split(/\s+/);
    const prefix = parts[parts.length - 1] || "";
    let pool = [];
    if (parts.length === 1) {
      pool = COMMANDS.map(([name]) => name);
    } else {
      const command = parts[0];
      if (command === "open" || command === "goto") {
        pool = Object.keys(PAGES).concat(notes.collections().map((col) => col.name)).concat(notes.all.map((note) => note.slug));
      } else if (command === "note") {
        pool = notes.all.map((note) => note.slug);
      } else if (command === "ls") {
        pool = ["pages", "collections", "notes", "tags"];
      } else if (command === "theme") {
        pool = ["pixel", "line"];
      } else if (command === "fx") {
        pool = ["on", "off"];
      }
    }
    const matches = Array.from(new Set(pool.filter((item) => item.startsWith(prefix)))).sort();
    if (!matches.length) return;
    if (matches.length === 1) {
      parts[parts.length - 1] = matches[0];
      input.value = parts.join(" ");
    } else {
      blank();
      writeText(matches.join("   "), "accent");
    }
  }

  function onInputKey(event) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!history.length) return;
      if (historyIndex === history.length) draft = input.value;
      historyIndex = Math.max(0, historyIndex - 1);
      input.value = history[historyIndex] || "";
      input.setSelectionRange(input.value.length, input.value.length);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!history.length) return;
      historyIndex = Math.min(history.length, historyIndex + 1);
      input.value = historyIndex === history.length ? draft : history[historyIndex] || "";
      input.setSelectionRange(input.value.length, input.value.length);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      tabs();
      return;
    }
    if (event.key === "l" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      output.innerHTML = "";
    }
  }

  /* ---------- global hotkey ---------- */

  function hotkey(event) {
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = (event.target && event.target.tagName) || "";
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (event.target && event.target.isContentEditable);
    if (typing) return;
    if (event.key === "`" || event.key === "~") {
      if (dialog && dialog.open) {
        close();
      } else {
        event.preventDefault();
        open();
      }
    }
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-terminal-open]")) {
      event.preventDefault();
      open();
    }
  });

  document.addEventListener("keydown", hotkey);

  window.KawaiiTerminal = { open, close, run };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (document.querySelector("[data-terminal-open]")) {
        /* built lazily on first open */
      }
    });
  }
})();
