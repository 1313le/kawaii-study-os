/* =========================================================
   kawaii / STUDY OS — generated note covers
   Six seeded templates so a note without a photo still has an
   identity. Same slug, same drawing; motion only on hover.
   ========================================================= */

(function () {
  "use strict";

  const W = 320;
  const H = 176;
  const NAMES = ["circuit", "waveform", "grid", "ladder", "chip", "terminal"];
  const BY_KIND = {
    article: "waveform",
    concept: "circuit",
    experiment: "waveform",
    debug: "terminal",
    cornell: "grid",
    review: "ladder"
  };

  function hash(text) {
    let value = 2166136261;
    const source = String(text || "kawaii");
    for (let i = 0; i < source.length; i += 1) {
      value ^= source.charCodeAt(i);
      value = Math.imul(value, 16777619);
    }
    return value >>> 0;
  }

  function seeded(seed) {
    let state = seed || 1;
    return function next() {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function templateId(note) {
    const raw = String(note.cover || "");
    if (raw.startsWith("template:")) {
      const id = raw.slice("template:".length);
      if (NAMES.includes(id)) return id;
    }
    return BY_KIND[note.kind] || "waveform";
  }

  function round(value) {
    return Math.round(value * 10) / 10;
  }

  /* ---------- templates ---------- */

  function circuit(random) {
    const rows = [42, 88, 134];
    const traces = [];
    const pads = [];
    rows.forEach((y, index) => {
      const turn = 74 + Math.round(random() * 120);
      const jog = index % 2 ? 26 : -26;
      traces.push(`<path class="ct-trace" d="M24 ${y}H${turn}V${y + jog}H${turn + 46}V${y}H296"/>`);
      pads.push(`<rect class="ct-pad" x="20" y="${y - 4}" width="8" height="8"/>`);
      pads.push(`<rect class="ct-pad" x="292" y="${y - 4}" width="8" height="8"/>`);
    });
    const chipX = 112 + Math.round(random() * 40);
    const pins = [];
    for (let i = 0; i < 4; i += 1) {
      const y = 66 + i * 12;
      pins.push(`<rect class="ct-pin" x="${chipX - 6}" y="${y}" width="6" height="3"/>`);
      pins.push(`<rect class="ct-pin" x="${chipX + 62}" y="${y}" width="6" height="3"/>`);
    }
    return `
<g class="ct-layer">
  ${traces.join("")}
  <rect class="ct-body" x="${chipX}" y="58" width="62" height="58"/>
  <circle class="ct-die" cx="${chipX + 14}" cy="72" r="3"/>
  ${pins.join("")}
  ${pads.join("")}
  <rect class="ct-via" x="152" y="120" width="8" height="8"/>
  <rect class="ct-via" x="196" y="52" width="8" height="8"/>
</g>`;
  }

  function waveform(random) {
    const grid = [];
    for (let i = 1; i < 8; i += 1) grid.push(`<path class="ct-grid" d="M${i * 40} 16V160"/>`);
    for (let i = 1; i < 5; i += 1) grid.push(`<path class="ct-grid" d="M16 ${16 + i * 29}H304"/>`);
    const mode = Math.round(random() * 2);
    const phase = random() * Math.PI * 2;
    const points = [];
    const steps = 48;
    for (let i = 0; i <= steps; i += 1) {
      const u = i / steps;
      const x = 16 + u * 288;
      let value;
      if (mode === 0) value = Math.sin(u * Math.PI * 3.1 + phase) * 0.78 + Math.sin(u * Math.PI * 7.4) * 0.12;
      else if (mode === 1) value = (Math.sin(u * Math.PI * 4 + phase) >= 0 ? 1 : -1) * 0.62;
      else value = (Math.abs(((u * 2 + phase) % 1) - 0.5) * 2 - 0.5) * 1.3;
      points.push(`${round(x)},${round(88 - value * 54)}`);
    }
    const last = points[points.length - 1].split(",");
    return `
<g class="ct-layer">
  ${grid.join("")}
  <path class="ct-axis" d="M16 88H304"/>
  <polyline class="ct-wave" points="${points.join(" ")}"/>
  <circle class="ct-peak" cx="${last[0]}" cy="${last[1]}" r="3"/>
  <path class="ct-tick" d="M16 150h10M48 150h4M64 150h4M84 150h10"/>
</g>`;
  }

  function grid(random) {
    const cells = [];
    const cols = 12;
    const rows = 7;
    const size = 14;
    const gap = 4;
    const offsetX = (W - cols * size - (cols - 1) * gap) / 2;
    const offsetY = (H - rows * size - (rows - 1) * gap) / 2;
    let cursor = -1;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        const lit = random() < 0.24;
        if (lit && cursor === -1 && index > cols * 3) cursor = index;
        cells.push(
          `<rect class="ct-cell${lit ? " is-lit" : ""}" x="${round(offsetX + col * (size + gap))}" y="${round(offsetY + row * (size + gap))}" width="${size}" height="${size}" style="--d:${round((row + col) * 0.02)}s"/>`
        );
      }
    }
    if (cursor >= 0) {
      const row = Math.floor(cursor / cols);
      const col = cursor % cols;
      cells.push(
        `<rect class="ct-cursor" x="${round(offsetX + col * (size + gap) - 2)}" y="${round(offsetY + row * (size + gap) - 2)}" width="${size + 4}" height="${size + 4}"/>`
      );
    }
    return `<g class="ct-layer">${cells.join("")}</g>`;
  }

  function ladder(random) {
    const rungs = [44, 78, 112, 146];
    const parts = [`<path class="ct-rail" d="M52 16V160M268 16V160"/>`];
    rungs.forEach((y, index) => {
      const closed = random() < 0.5;
      const contactX = 96 + Math.round(random() * 40);
      parts.push(`<path class="ct-rung" d="M52 ${y}H${contactX - 12}M${contactX + 12} ${y}H214"/>`);
      parts.push(
        `<path class="ct-contact${closed ? " is-closed" : ""}" d="M${contactX - 10} ${y - 8}L${contactX + 10} ${y - 8}" style="--i:${index}"/>`
      );
      parts.push(`<circle class="ct-coil" cx="238" cy="${y}" r="10"/>`);
      parts.push(`<path class="ct-coil-mark" d="M233 ${y - 4}h10M233 ${y + 4}h10"/>`);
    });
    return `<g class="ct-layer">${parts.join("")}</g>`;
  }

  function chip(random) {
    const size = 84;
    const x = 118;
    const y = 46;
    const pins = [];
    for (let i = 0; i < 5; i += 1) {
      const offset = y + 12 + i * 14;
      pins.push(`<rect class="ct-leg" x="${x - 14}" y="${offset}" width="14" height="5" style="--i:${i}"/>`);
      pins.push(`<rect class="ct-leg" x="${x + size}" y="${offset}" width="14" height="5" style="--i:${i + 5}"/>`);
      pins.push(`<rect class="ct-leg" x="${x + 12 + i * 14}" y="${y - 14}" width="5" height="14" style="--i:${i + 10}"/>`);
      pins.push(`<rect class="ct-leg" x="${x + 12 + i * 14}" y="${y + size}" width="5" height="14" style="--i:${i + 15}"/>`);
    }
    const code = [];
    for (let i = 0; i < 4; i += 1) {
      code.push(`<rect class="ct-code" x="${x + 16}" y="${y + 22 + i * 10}" width="${round(18 + random() * 34)}" height="4"/>`);
    }
    return `
<g class="ct-layer">
  ${pins.join("")}
  <rect class="ct-package" x="${x}" y="${y}" width="${size}" height="${size}"/>
  <circle class="ct-notch" cx="${x + 16}" cy="${y + 16}" r="4"/>
  ${code.join("")}
  <rect class="ct-die" x="${x + 30}" y="${y + 34}" width="${size - 60}" height="${size - 68}"/>
</g>`;
  }

  function terminal(random) {
    const bars = [];
    const lines = 5;
    for (let i = 0; i < lines; i += 1) {
      const width = round(60 + random() * 180);
      bars.push(`<rect class="ct-line" x="40" y="${58 + i * 18}" width="${i === lines - 1 ? 34 : width}" height="6" style="--i:${i}"/>`);
    }
    return `
<g class="ct-layer">
  <rect class="ct-window" x="22" y="26" width="276" height="124" rx="4"/>
  <path class="ct-title" d="M22 48H298"/>
  <circle class="ct-dot" cx="36" cy="37" r="3"/>
  <circle class="ct-dot" cx="48" cy="37" r="3"/>
  <circle class="ct-dot" cx="60" cy="37" r="3"/>
  <path class="ct-prompt" d="M40 62l7 5-7 5"/>
  ${bars.join("")}
  <rect class="ct-cursor" x="78" y="${58 + (lines - 1) * 18 - 2}" width="7" height="10"/>
</g>`;
  }

  const BUILDERS = { circuit, waveform, grid, ladder, chip, terminal };

  function svgFor(note) {
    const id = templateId(note);
    const seedText = `${note.slug || note.title || "note"}:${id}`;
    const inner = BUILDERS[id](seeded(hash(seedText)));
    return `<svg class="ct-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-template="${id}">${inner}</svg>`;
  }

  function markup(note) {
    const accent = (window.Kawaii && window.Kawaii.ui && window.Kawaii.ui.accentVar)
      ? window.Kawaii.ui.accentVar(note.accent)
      : "var(--accent)";
    const id = templateId(note);
    return `<div class="cover-tpl" data-template="${id}" style="--cover-accent:${accent}">${svgFor(note)}</div>`;
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

  // Every note has a cover: a chosen template, a real image, or the one its
  // kind implies. Callers only wrap this in their own container.
  function media(note) {
    const raw = String(note.cover || "");
    if (raw && !raw.startsWith("template:")) {
      return `<img src="${escapeText(raw)}" alt="${escapeText(note.title)} 封面" loading="lazy" decoding="async">`;
    }
    return markup(note);
  }

  window.KawaiiCover = {
    names: NAMES,
    templateId,
    svgFor,
    markup,
    media
  };
})();
