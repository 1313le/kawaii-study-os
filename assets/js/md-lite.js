/* =========================================================
   kawaii / STUDY OS — md-lite
   A small, escape-first Markdown renderer for the live writing
   preview. Everything is escaped before any tag is emitted, so
   a note can never inject markup into its own preview.
   ========================================================= */

(function () {
  "use strict";

  function escapeText(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function inline(text) {
    let out = escapeText(text);
    const code = [];
    out = out.replace(/`([^`]+)`/g, (_, body) => {
      code.push(`<code>${body}</code>`);
      return `\u0000${code.length - 1}\u0000`;
    });
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) =>
      `<img src="${src}" alt="${alt}" loading="lazy" decoding="async">`);
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) =>
      `<a href="${href}" rel="noopener noreferrer">${label}</a>`);
    out = out.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, slug, label) =>
      `<a class="wiki" href="note.html?slug=${encodeURIComponent(slug.trim())}">${label || slug}</a>`);
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    out = out.replace(/==([^=]+)==/g, "<mark>$1</mark>");
    out = out.replace(/\u0000(\d+)\u0000/g, (_, index) => code[Number(index)]);
    return out;
  }

  function renderTable(lines) {
    const rows = lines.map((line) => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim()));
    if (rows.length < 2) return "";
    const head = rows[0];
    const body = rows.slice(2);
    return `<table class="md-table"><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${body
      .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>`;
  }

  const LIST_ITEM = /^\s*([-*+]|\d+\.)\s+(.*)$/;
  const TASK_ITEM = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/;

  function render(text) {
    const source = String(text || "").replace(/\r\n/g, "\n");
    const lines = source.split("\n");
    const out = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (!line.trim()) {
        index += 1;
        continue;
      }

      const fence = line.match(/^\s*```(\S*)\s*$/);
      if (fence) {
        const code = [];
        index += 1;
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
          code.push(lines[index]);
          index += 1;
        }
        index += 1;
        out.push(`<pre class="md-code"${fence[1] ? ` data-lang="${escapeText(fence[1])}"` : ""}><code>${escapeText(code.join("\n"))}</code></pre>`);
        continue;
      }

      if (/^\s{0,3}(#{1,6})\s+/.test(line)) {
        const level = line.match(/^\s{0,3}(#{1,6})\s+/)[1].length;
        const body = line.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/\s+#+\s*$/, "");
        out.push(`<h${level}>${inline(body)}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^\s{0,3}(---+|\*\*\*+|___+)\s*$/.test(line)) {
        out.push("<hr>");
        index += 1;
        continue;
      }

      if (/^\s{0,3}>\s?/.test(line)) {
        const quote = [];
        while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
          quote.push(lines[index].replace(/^\s{0,3}>\s?/, ""));
          index += 1;
        }
        out.push(`<blockquote>${render(quote.join("\n"))}</blockquote>`);
        continue;
      }

      if (/^\s*\|/.test(line) && index + 1 < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[index + 1])) {
        const table = [];
        while (index < lines.length && /^\s*\|/.test(lines[index])) {
          table.push(lines[index]);
          index += 1;
        }
        out.push(renderTable(table));
        continue;
      }

      if (TASK_ITEM.test(line) || LIST_ITEM.test(line)) {
        const ordered = /^\s*\d+\.\s+/.test(line);
        const items = [];
        while (index < lines.length && (TASK_ITEM.test(lines[index]) || LIST_ITEM.test(lines[index]))) {
          const task = lines[index].match(TASK_ITEM);
          if (task) {
            const checked = task[1].toLowerCase() === "x";
            items.push(`<li class="md-task${checked ? " is-done" : ""}"><span class="md-task__box" aria-hidden="true">${checked ? "✓" : ""}</span>${inline(task[2])}</li>`);
          } else {
            items.push(`<li>${inline(lines[index].replace(LIST_ITEM, "$2"))}</li>`);
          }
          index += 1;
        }
        out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
        continue;
      }

      const paragraph = [];
      while (
        index < lines.length &&
        lines[index].trim() &&
        !/^\s*```/.test(lines[index]) &&
        !/^\s{0,3}#{1,6}\s+/.test(lines[index]) &&
        !/^\s{0,3}>\s?/.test(lines[index]) &&
        !LIST_ITEM.test(lines[index]) &&
        !/^\s{0,3}(---+|\*\*\*+|___+)\s*$/.test(lines[index])
      ) {
        paragraph.push(lines[index]);
        index += 1;
      }
      out.push(`<p>${inline(paragraph.join("\n"))}</p>`);
    }

    return out.join("\n");
  }

  window.KawaiiMarkdown = { render, escape: escapeText };
})();
