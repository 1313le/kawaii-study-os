/* =========================================================
   kawaii / STUDY OS — code block reading tools
   line gutters, wrap, fold, raw copy, print state
   ========================================================= */

(function () {
  "use strict";

  const FOLD_AFTER = 18;
  const FOLD_LABEL = "展开";
  const UNFOLD_LABEL = "收起";
  const records = new WeakMap();
  const printSnapshots = new WeakMap();

  function framesOf(element) {
    return { tag: element.tagName.toLowerCase(), attrs: Array.from(element.attributes, (a) => [a.name, a.value]) };
  }

  function collectRuns(node, stack, runs) {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        if (child.nodeValue) runs.push({ text: child.nodeValue, stack });
        return;
      }
      if (child.nodeType !== 1) return;
      collectRuns(child, stack.concat(framesOf(child)), runs);
    });
  }

  function toLines(runs, total) {
    const lines = [[]];
    runs.forEach((run) => {
      run.text.split("\n").forEach((part, index) => {
        if (index) lines.push([]);
        if (part) lines[lines.length - 1].push({ text: part, stack: run.stack });
      });
    });
    while (lines.length < total) lines.push([]);
    return lines.slice(0, total);
  }

  function buildLine(runs) {
    const line = document.createElement("div");
    line.className = "code-line";
    runs.forEach((run) => {
      let parent = line;
      run.stack.forEach((frame) => {
        const element = document.createElement(frame.tag);
        frame.attrs.forEach((pair) => element.setAttribute(pair[0], pair[1]));
        parent.appendChild(element);
        parent = element;
      });
      parent.appendChild(document.createTextNode(run.text));
    });
    return line;
  }

  function split(code, total) {
    const runs = [];
    collectRuns(code, [], runs);
    const lines = toLines(runs, total);
    const fragment = document.createDocumentFragment();
    lines.forEach((runsOfLine) => fragment.appendChild(buildLine(runsOfLine)));
    code.replaceChildren(fragment);
    return lines.length;
  }

  function toolButton(block, kind) {
    const head = block.querySelector(".code-head");
    if (!head) return null;
    const existing = head.querySelector(`[data-code-${kind}]`);
    if (existing) return existing;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-tool";
    button.setAttribute(`data-code-${kind}`, "");
    head.insertBefore(button, head.querySelector("[data-copy]"));
    return button;
  }

  function applyFold(block, open) {
    const button = block.querySelector("[data-code-fold]");
    block.classList.toggle("is-folded", !open);
    if (!button) return;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.textContent = open ? UNFOLD_LABEL : FOLD_LABEL;
  }

  function applyWrap(block, on) {
    const button = block.querySelector("[data-code-wrap]");
    block.classList.toggle("is-wrap", on);
    if (!button) return;
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.classList.toggle("is-on", on);
  }

  function copySource(block) {
    const record = records.get(block);
    return record ? record.raw : (block.querySelector("pre code") || { textContent: "" }).textContent;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        area.remove();
      }
    });
  }

  function wireCopy(block) {
    const button = block.querySelector("[data-copy]");
    if (!button || button.dataset.wired === "1") return;
    button.dataset.wired = "1";
    button.addEventListener("click", () => {
      copyText(copySource(block)).then(
        () => {
          const original = button.textContent;
          button.textContent = "COPIED";
          button.classList.add("is-copied");
          window.setTimeout(() => {
            button.textContent = original;
            button.classList.remove("is-copied");
          }, 1300);
        },
        () => {
          button.textContent = "FAILED";
        }
      );
    });
  }

  function enhance(block) {
    if (!block || !block.classList.contains("code-block")) return;
    const code = block.querySelector("pre > code");
    if (!code) return;
    let record = records.get(block);
    if (!record) {
      record = { raw: code.textContent, plain: code.innerHTML };
      records.set(block, record);
    }
    const total = record.raw.split("\n").length;
    split(code, total);
    wireCopy(block);

    const collapsible = total > FOLD_AFTER;
    const wrap = toolButton(block, "wrap");
    if (wrap && wrap.dataset.wired !== "1") {
      wrap.dataset.wired = "1";
      wrap.textContent = "换行";
      wrap.setAttribute("aria-pressed", "false");
      wrap.addEventListener("click", () => applyWrap(block, !block.classList.contains("is-wrap")));
    }

    const fold = collapsible ? toolButton(block, "fold") : null;
    if (fold) {
      if (fold.dataset.wired !== "1") {
        fold.dataset.wired = "1";
        fold.addEventListener("click", () => applyFold(block, block.classList.contains("is-folded")));
      }
      if (!fold.hasAttribute("aria-expanded")) applyFold(block, false);
    }
  }

  function rehighlight(root) {
    if (!window.hljs) return false;
    const blocks = Array.from((root || document).querySelectorAll(".code-block"));
    blocks.forEach((block) => {
      const record = records.get(block);
      const code = block.querySelector("pre > code");
      if (!record || !code) return;
      code.innerHTML = record.plain;
      try {
        window.hljs.highlightElement(code);
      } catch (error) {
        return;
      }
      split(code, record.raw.split("\n").length);
    });
    return true;
  }

  function setPrintState(on) {
    document.querySelectorAll(".code-block").forEach((block) => {
      if (on) {
        printSnapshots.set(block, {
          folded: block.classList.contains("is-folded"),
          wrapped: block.classList.contains("is-wrap")
        });
        applyFold(block, true);
        applyWrap(block, true);
        return;
      }
      const snapshot = printSnapshots.get(block);
      if (!snapshot) return;
      printSnapshots.delete(block);
      applyFold(block, !snapshot.folded);
      applyWrap(block, snapshot.wrapped);
    });
  }

  window.KawaiiCodeTools = {
    FOLD_AFTER,
    enhance,
    rehighlight,
    copySource,
    setPrintState
  };
})();
