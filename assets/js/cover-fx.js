/* =========================================================
   kawaii / STUDY OS — breadboard cover easter egg
   LED lights up -> battery sparks -> capacitor pops -> LED dies
   ========================================================= */

(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const TARGET = "cover-circuit.webp";
  const steps = ["off", "ignite", "lit", "zap", "boom", "dead", "repair"];
  const instances = [];

  const reducedMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

  function allowed() {
    const root = document.documentElement;
    return root.dataset.skin === "pixel" && root.dataset.fx !== "off" && root.dataset.motion !== "reduced" && (!reducedMotion.matches || root.dataset.motion === "full");
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  const CAP = { x: 950, y: 512 };

  const SCOPE_QUAD = [
    [830, -10],
    [1340, 34],
    [1310, 388],
    [800, 316]
  ];

  function makeProjection(quad) {
    const [p0, p1, p2, p3] = quad;
    const dx1 = p1[0] - p2[0];
    const dx2 = p3[0] - p2[0];
    const dx3 = p0[0] - p1[0] + p2[0] - p3[0];
    const dy1 = p1[1] - p2[1];
    const dy2 = p3[1] - p2[1];
    const dy3 = p0[1] - p1[1] + p2[1] - p3[1];
    let g = 0;
    let h = 0;
    if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
      const den = dx1 * dy2 - dx2 * dy1;
      g = (dx3 * dy2 - dx2 * dy3) / den;
      h = (dx1 * dy3 - dx3 * dy1) / den;
    }
    const a = p1[0] - p0[0] + g * p1[0];
    const b = p3[0] - p0[0] + h * p3[0];
    const c = p0[0];
    const d = p1[1] - p0[1] + g * p1[1];
    const e = p3[1] - p0[1] + h * p3[1];
    const f = p0[1];
    return function project(u, v) {
      const w = g * u + h * v + 1;
      return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
    };
  }

  const scopeProject = makeProjection(SCOPE_QUAD);

  function scopeMarkup() {
    return `
<g class="cfx-scope" aria-hidden="true">
  <image href="assets/img/cover-scope-plate.png" x="780" y="0" width="574" height="412" style="image-rendering:pixelated"/>
  <g mask="url(#cfxScopeMask)">
    <polyline class="cfx-scope-trace cfx-scope-trace--glow" points="0,0 0,0" fill="none" stroke="#3dff64" stroke-width="24" stroke-opacity="0.06"/>
    <polyline class="cfx-scope-trace cfx-scope-trace--mid" points="0,0 0,0" fill="none" stroke="#7bff7a" stroke-width="16" stroke-opacity="0.16"/>
    <polyline class="cfx-scope-trace cfx-scope-trace--core" points="0,0 0,0" fill="none" stroke="#b8ff71" stroke-width="10" stroke-linecap="square" stroke-linejoin="bevel" shape-rendering="crispEdges"/>
  </g>
</g>`;
  }

  function scopeWave(u, time, mode) {
    if (mode === 0) {
      return Math.sin(u * Math.PI * 4.4 + time * 2.4 + Math.sin(time * 0.6) * 0.8) * 0.62
        + Math.sin(u * Math.PI * 8.8 - time * 1.3) * 0.08;
    }
    if (mode === 1) {
      return (Math.sin(u * Math.PI * 4 + time * 1.9) > 0 ? 1 : -1) * 0.6;
    }
    if (mode === 2) {
      const p = ((u * 2.2 - time * 0.16) % 1 + 1) % 1;
      return (p * 2 - 1) * 0.65;
    }
    return Math.sin(u * Math.PI * 5.2 + time * 2.6 + Math.sin(time * 0.7) * 2.4) * 0.52 + Math.sin(u * Math.PI * 1.8 - time * 1.3) * 0.18;
  }

  function sparkMarkup() {
    let out = "";
    for (let i = 0; i < 16; i += 1) {
      const angle = (i / 16) * Math.PI * 2 + 0.26;
      const inner = 26 + (i % 3) * 8;
      const dist = 58 + (i % 5) * 17;
      const x = CAP.x + Math.cos(angle) * inner;
      const y = CAP.y + Math.sin(angle) * inner;
      const size = 3 + (i % 3) * 2;
      out += `<rect class="cfx-sparklet" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${size}" height="${size}" fill="${i % 3 ? "#ffd977" : "#ff9f4a"}" style="--dx:${(Math.cos(angle) * dist).toFixed(0)}px;--dy:${(Math.sin(angle) * dist - 10).toFixed(0)}px;--d:${(i % 4) * 0.03}s"/>`;
      if (i % 4 === 0) {
        out += `<circle class="cfx-ember-fly" cx="${(CAP.x + Math.cos(angle) * inner).toFixed(1)}" cy="${(CAP.y + Math.sin(angle) * inner).toFixed(1)}" r="${(2 + (i % 3) * 0.7).toFixed(1)}" fill="#ffb25e" style="--dx:${(Math.cos(angle) * (dist + 18)).toFixed(0)}px;--dy:${(Math.sin(angle) * (dist + 18) - 22).toFixed(0)}px;--d:${0.05 + (i % 3) * 0.04}s"/>`;
      }
    }
    return out;
  }

  function smokeMarkup() {
    const puffs = [
      [-30, -120, 0.0, 3.6, 24, 0],
      [24, -164, 0.22, 4.0, 30, 1],
      [-8, -206, 0.5, 4.4, 36, 2],
      [46, -120, 0.38, 3.2, 22, 1],
      [-54, -92, 0.66, 3.0, 20, 2],
      [8, -246, 0.9, 4.6, 42, 0],
      [30, -286, 1.25, 5.0, 50, 1]
    ];
    return puffs
      .map(
        ([dx, dy, delay, dur, radius, tone]) =>
          `<circle class="cfx-puff cfx-puff--${tone}" cx="${CAP.x}" cy="${CAP.y - 4}" r="${radius}" style="--dx:${dx}px;--dy:${dy}px;--d:${delay}s;--t:${dur}s"/>`
      )
      .join("");
  }

  function svgMarkup() {
    return `
<style>
  .cfx { opacity: 1; }
  .cfx .cfx-led-off { opacity: 0; transition: opacity 0.22s linear; }
  .cfx[data-phase="off"] .cfx-led-off,
  .cfx[data-phase="dead"] .cfx-led-off { opacity: 1; }
  .cfx[data-phase="ignite"] .cfx-led-off { animation: cfxFlicker 0.86s steps(1, end) forwards; }
  .cfx[data-phase="boom"] .cfx-led-off { animation: cfxDie 0.4s steps(1, end) forwards; }
  .cfx[data-phase="repair"] .cfx-led-off { animation: cfxRelight 1.12s steps(1, end) forwards; }
  .cfx[data-phase="lit"] .cfx-led-pulse { animation: cfxPulse 3.6s steps(6, end) infinite; }
  .cfx[data-phase="zap"] .cfx-led-pulse { animation: cfxSurge 0.6s steps(2, end) 2; }

  .cfx-heat { opacity: 0; }
  .cfx[data-phase="zap"] .cfx-heat { animation: cfxHeat 0.5s steps(3, end) 0.26s 2; }

  .cfx-zap { opacity: 0; }
  .cfx[data-phase="zap"] .cfx-zap { opacity: 1; }
  .cfx[data-phase="zap"] .cfx-arc--glow { animation: cfxArc 0.6s steps(1, end) 2; }
  .cfx[data-phase="zap"] .cfx-arc--core { animation: cfxArc 0.6s steps(1, end) 2; }
  .cfx[data-phase="zap"] .cfx-terminal-glow { animation: cfxTerminal 0.6s steps(2, end) 2; }
  .cfx[data-phase="zap"] .cfx-bzzt { animation: cfxBzzt 0.92s steps(2, end) forwards; }
  .cfx-zap .cfx-bzzt { opacity: 0; }

  .cfx-damage { opacity: 0; transition: opacity 0.16s steps(2, end); }
  .cfx[data-phase="boom"] .cfx-damage,
  .cfx[data-phase="dead"] .cfx-damage { opacity: 1; }
  .cfx[data-phase="repair"] .cfx-damage { animation: cfxHeal 1s steps(6, end) 0.34s both; }

  .cfx-flash-glow,
  .cfx-burst,
  .cfx-lid,
  .cfx-sparklet,
  .cfx-ember-fly,
  .cfx-debris,
  .cfx-pop,
  .cfx-repair,
  .cfx-puff { opacity: 0; }

  .cfx[data-phase="boom"] .cfx-flash-glow { animation: cfxFlashGlow 0.7s ease-out forwards; }
  .cfx[data-phase="boom"] .cfx-burst { animation: cfxBurst 0.62s steps(4, end) forwards; }
  .cfx[data-phase="boom"] .cfx-lid { animation: cfxLid 0.9s steps(5, end) 0.03s forwards; }
  .cfx[data-phase="boom"] .cfx-sparklet { animation: cfxSparklet 0.78s steps(5, end) var(--d, 0s) forwards; }
  .cfx[data-phase="boom"] .cfx-ember-fly { animation: cfxEmberFly 0.95s steps(6, end) var(--d, 0s) forwards; }
  .cfx[data-phase="boom"] .cfx-debris { animation: cfxDebris 0.95s steps(5, end) var(--d, 0s) forwards; }
  .cfx[data-phase="boom"] .cfx-pop { animation: cfxPop 0.72s steps(3, end) forwards; }
  .cfx[data-phase="dead"] .cfx-ember { animation: cfxEmber 1.9s steps(4, end) infinite; }

  .cfx.is-smoking .cfx-puff { animation: cfxPuff var(--t, 4s) steps(9, end) var(--d, 0s) forwards; }
  .cfx.is-repairing .cfx-puff { animation: none; opacity: 0; }

  .cfx-puff--0 { fill: #8a668e; }
  .cfx-puff--1 { fill: #74507a; }
  .cfx-puff--2 { fill: #96708f; }

  .cfx[data-phase="repair"] .cfx-repair { animation: cfxRepair 1.36s ease-in-out 0.08s forwards; }

  .cfx-burst { transform-box: view-box; transform-origin: 950px 512px; shape-rendering: crispEdges; }
  .cfx-lid { transform-box: fill-box; transform-origin: center; }
  .cfx-sparklet { transform-box: fill-box; transform-origin: center; }
  .cfx-ember-fly { transform-box: fill-box; transform-origin: center; }
  .cfx-puff { transform-box: fill-box; transform-origin: center; }
  .cfx-debris { transform-box: fill-box; transform-origin: center; }
  .cfx-pop { transform-box: fill-box; transform-origin: center; }

  @keyframes cfxFlicker {
    0% { opacity: 1; }
    10% { opacity: 0.25; }
    18% { opacity: 1; }
    30% { opacity: 0.08; }
    38% { opacity: 0.9; }
    52% { opacity: 0.12; }
    62% { opacity: 0.65; }
    78% { opacity: 0; }
    100% { opacity: 0; }
  }
  @keyframes cfxDie {
    0% { opacity: 0; }
    8% { opacity: 1; }
    16% { opacity: 0.08; }
    26% { opacity: 1; }
    36% { opacity: 0.35; }
    46% { opacity: 1; }
    100% { opacity: 1; }
  }
  @keyframes cfxRelight {
    0% { opacity: 1; }
    28% { opacity: 1; }
    34% { opacity: 0; }
    42% { opacity: 0.85; }
    48% { opacity: 0.1; }
    56% { opacity: 0.55; }
    64% { opacity: 0; }
    100% { opacity: 0; }
  }
  @keyframes cfxPulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.68; }
  }
  @keyframes cfxSurge {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
  }
  @keyframes cfxHeat {
    0%, 100% { opacity: 0; }
    50% { opacity: 0.8; }
  }
  @keyframes cfxArc {
    0%, 100% { opacity: 0; }
    8%, 24%, 40%, 58% { opacity: 1; }
    16%, 32%, 50%, 68% { opacity: 0.15; }
  }
  @keyframes cfxTerminal {
    0%, 100% { opacity: 0; }
    12%, 38%, 64% { opacity: 1; }
    26%, 52% { opacity: 0.2; }
  }
  @keyframes cfxBzzt {
    0% { opacity: 0; transform: translate(0, 0) scale(0.85); }
    18% { opacity: 1; transform: translate(0, -4px) scale(1); }
    70% { opacity: 1; transform: translate(0, -8px) scale(1); }
    100% { opacity: 0; transform: translate(0, -14px) scale(0.96); }
  }
  @keyframes cfxFlashGlow {
    0% { opacity: 0; transform: scale(0.25); }
    12% { opacity: 1; transform: scale(0.7); }
    40% { opacity: 0.7; transform: scale(1.02); }
    100% { opacity: 0; transform: scale(1.25); }
  }
  @keyframes cfxBurst {
    0% { opacity: 0; transform: scale(0.3); }
    25% { opacity: 1; transform: scale(1); }
    62% { opacity: 0.85; transform: scale(1.06); }
    100% { opacity: 0; transform: scale(1.22); }
  }
  @keyframes cfxSparklet {
    0% { opacity: 0; transform: translate(0, 0); }
    16% { opacity: 1; }
    100% { opacity: 0; transform: translate(var(--dx), var(--dy)); }
  }
  @keyframes cfxLid {
    0% { opacity: 0; transform: translate(0, 0) rotate(0deg); }
    12% { opacity: 1; }
    100% { opacity: 0; transform: translate(68px, -156px) rotate(156deg); }
  }
  @keyframes cfxHeal {
    0% { opacity: 1; }
    100% { opacity: 0; }
  }
  @keyframes cfxEmberFly {
    0% { opacity: 1; transform: translate(0, 0) scale(1); }
    70% { opacity: 0.8; }
    100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(0.2); }
  }
  @keyframes cfxDebris {
    0% { opacity: 0; transform: translate(0, 0) rotate(0deg); }
    14% { opacity: 1; }
    100% { opacity: 0; transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); }
  }
  @keyframes cfxPop {
    0% { opacity: 0; transform: scale(0.35) rotate(-9deg); }
    22% { opacity: 1; transform: scale(1.12) rotate(-4deg); }
    62% { opacity: 1; transform: scale(1) rotate(-4deg); }
    100% { opacity: 0; transform: scale(1.05) rotate(-2deg); }
  }
  @keyframes cfxPuff {
    0% { opacity: 0; transform: translate(0, 0) scale(0.34); }
    16% { opacity: 0.5; }
    55% { opacity: 0.34; }
    100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(2.4); }
  }
  @keyframes cfxEmber {
    0%, 100% { opacity: 0.15; }
    50% { opacity: 0.9; }
  }
  @keyframes cfxRepair {
    0% { opacity: 0; transform: translateY(-70px); }
    15% { opacity: 0.85; }
    70% { opacity: 0.65; }
    100% { opacity: 0; transform: translateY(150px); }
  }
</style>
<defs>
  <radialGradient id="cfxDim" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#130009" stop-opacity="0.9"/>
    <stop offset="0.42" stop-color="#17000b" stop-opacity="0.74"/>
    <stop offset="0.7" stop-color="#1a000d" stop-opacity="0.38"/>
    <stop offset="1" stop-color="#1a000d" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="cfxLedOff" x1="0" y1="0" x2="0.4" y2="1">
    <stop offset="0" stop-color="#4a0828"/>
    <stop offset="0.5" stop-color="#2b0316"/>
    <stop offset="1" stop-color="#130009"/>
  </linearGradient>
  <radialGradient id="cfxPulse" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#ff5b96" stop-opacity="0.16"/>
    <stop offset="0.55" stop-color="#ff3f86" stop-opacity="0.08"/>
    <stop offset="1" stop-color="#ff3f86" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="cfxFlash" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#ffffff"/>
    <stop offset="0.18" stop-color="#fff1b0"/>
    <stop offset="0.46" stop-color="#ff9b3d" stop-opacity="0.82"/>
    <stop offset="1" stop-color="#ff5d2e" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="cfxTerminal" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#fff8c7"/>
    <stop offset="0.35" stop-color="#ffd766" stop-opacity="0.9"/>
    <stop offset="1" stop-color="#ff9b28" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="cfxCan" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#29162c"/>
    <stop offset="0.45" stop-color="#120a17"/>
    <stop offset="1" stop-color="#08040c"/>
  </linearGradient>
  <linearGradient id="cfxRepair" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#bffcff" stop-opacity="0"/>
    <stop offset="0.5" stop-color="#bffcff" stop-opacity="0.5"/>
    <stop offset="1" stop-color="#6ff7ff" stop-opacity="0"/>
  </linearGradient>
  <mask id="cfxScopeMask" maskUnits="userSpaceOnUse" x="780" y="0" width="574" height="412">
    <image href="assets/img/cover-scope-mask.png" x="780" y="0" width="574" height="412"/>
  </mask>
  <filter id="cfxSmokeBlur" filterUnits="userSpaceOnUse" x="700" y="100" width="560" height="620">
    <feGaussianBlur stdDeviation="15"/>
  </filter>
  <filter id="cfxArcBlur" x="-80%" y="-80%" width="260%" height="260%">
    <feGaussianBlur stdDeviation="3.4"/>
  </filter>
</defs>

${scopeMarkup()}

<circle class="cfx-led-pulse" cx="660" cy="460" r="172" fill="url(#cfxPulse)"/>

<g class="cfx-led-off">
  <circle cx="660" cy="472" r="212" fill="url(#cfxDim)"/>
  <path d="M612 466 C612 442 632 428 660 428 C688 428 708 442 708 466 L708 516 L724 516 L724 534 C724 548 700 554 660 554 C620 554 596 548 596 534 L596 516 L612 516 Z" fill="url(#cfxLedOff)" stroke="#12000a" stroke-width="2"/>
  <path d="M616 520 L704 520" stroke="#2a0a1c" stroke-width="3" opacity="0.7"/>
  <path d="M628 452 C632 440 641 433 652 431" stroke="#56102f" stroke-width="4" opacity="0.55" fill="none" stroke-linecap="square"/>
  <path d="M640 468 l9 9 M649 468 l-9 9" stroke="#a03a60" stroke-width="3" stroke-linecap="square" opacity="0.85"/>
  <path d="M671 468 l9 9 M680 468 l-9 9" stroke="#a03a60" stroke-width="3" stroke-linecap="square" opacity="0.85"/>
  <path d="M654 492 L666 492" stroke="#8c3052" stroke-width="3" stroke-linecap="square" opacity="0.8"/>
</g>

<g class="cfx-zap" aria-hidden="true">
  <circle class="cfx-terminal-glow" cx="192" cy="318" r="36" fill="url(#cfxTerminal)"/>
  <circle class="cfx-terminal-glow" cx="288" cy="298" r="34" fill="url(#cfxTerminal)"/>
  <path class="cfx-arc cfx-arc--glow" d="M192 320 L207 289 L219 321 L232 283 L246 314 L260 286 L273 309 L288 296" fill="none" stroke="#ffb52e" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" opacity="0.5" filter="url(#cfxArcBlur)"/>
  <path class="cfx-arc cfx-arc--core" d="M192 320 L207 289 L219 321 L232 283 L246 314 L260 286 L273 309 L288 296" fill="none" stroke="#fff8ca" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M204 334 L195 360 M282 312 L296 340 M241 320 L236 350" stroke="#ffe27e" stroke-width="3" stroke-linecap="round" opacity="0.8"/>
  <text class="cfx-bzzt" x="160" y="402" fill="#ffe27e" font-family="'Press Start 2P', monospace" font-size="19" letter-spacing="1" paint-order="stroke" stroke="#210b00" stroke-width="5">BZZT</text>
  <circle class="cfx-heat" cx="950" cy="500" r="42" fill="url(#cfxTerminal)"/>
</g>

<g class="cfx-damage" aria-hidden="true">
  <ellipse cx="950" cy="624" rx="94" ry="26" fill="#09040c" opacity="0.6"/>
  <path d="M904 520 L916 506 L926 522 L938 505 L950 519 L962 505 L976 520 L988 506 L996 520 L994 604 Q994 618 966 618 L934 618 Q906 618 906 604 Z" fill="url(#cfxCan)" stroke="#060309" stroke-width="2"/>
  <path d="M908 518 L896 488 L920 504 L930 470 L946 500 L960 466 L972 500 L988 480 L992 520 L958 514 L936 516 Z" fill="#1a0d20" stroke="#553a60" stroke-width="2"/>
  <path d="M918 512 L932 512 L926 492 L944 506 L948 482 L960 506 L970 492 L966 514 Z" fill="#050208"/>
  <path d="M896 488 L920 504 M988 480 L992 520 M930 470 L946 500" stroke="#c9b6e8" stroke-width="3" opacity="0.55"/>
  <path d="M912 540 L918 560 L910 582 L922 600" stroke="#4a2247" stroke-width="4" opacity="0.6" fill="none"/>
  <path d="M982 536 L976 558 L984 576 L974 598" stroke="#3a1a3f" stroke-width="3" opacity="0.55" fill="none"/>
  <path d="M917 602 L925 596 M973 602 L965 596" stroke="#48deff" stroke-width="2" opacity="0.25"/>
  <g font-family="'Press Start 2P', monospace" font-size="8" fill="#7a2f4e" opacity="0.45">
    <text x="926" y="578">X</text>
    <text x="954" y="592">X</text>
  </g>
  <circle class="cfx-ember" cx="948" cy="520" r="3.6" fill="#ffb25e"/>
  <circle class="cfx-ember" cx="968" cy="540" r="2.6" fill="#ff7e51" style="animation-delay:0.7s"/>
  <circle class="cfx-ember" cx="930" cy="552" r="2.2" fill="#ffd37a" style="animation-delay:1.3s"/>
</g>

<g class="cfx-blast" aria-hidden="true">
  <circle class="cfx-flash-glow" cx="950" cy="512" r="150" fill="url(#cfxFlash)" style="transform-box:view-box;transform-origin:950px 512px"/>
  <ellipse class="cfx-lid" cx="958" cy="492" rx="26" ry="9" fill="#cbb9e9" stroke="#5b4268" stroke-width="2"/>
  <g class="cfx-burst">
    <polygon points="950,408 963,488 1042,502 975,530 990,610 950,550 910,610 925,530 858,502 937,488" fill="#fff4bf"/>
    <polygon points="950,444 958,502 1020,510 968,532 978,590 950,548 922,590 932,532 880,510 942,502" fill="#ffce63"/>
    <rect x="942" y="504" width="16" height="16" fill="#ffffff"/>
  </g>
  <g class="cfx-sparks">
    ${sparkMarkup()}
  </g>
  <g class="cfx-debris">
    <rect x="942" y="492" width="14" height="8" fill="#3b2442" style="--dx:-58px;--dy:-118px;--rot:-142deg;--d:0.02s"/>
    <rect x="960" y="498" width="9" height="6" fill="#24152d" style="--dx:54px;--dy:-132px;--rot:118deg;--d:0.08s"/>
    <rect x="930" y="500" width="7" height="10" fill="#512b51" style="--dx:-22px;--dy:-158px;--rot:76deg;--d:0.12s"/>
    <rect x="966" y="492" width="6" height="6" fill="#6a3d6a" style="--dx:38px;--dy:-96px;--rot:210deg;--d:0.05s"/>
  </g>
  <text class="cfx-pop" x="1018" y="452" fill="#ffe27e" font-family="'Press Start 2P', monospace" font-size="21" paint-order="stroke" stroke="#2b1000" stroke-width="6">POP!</text>
</g>

<g class="cfx-smoke" filter="url(#cfxSmokeBlur)" aria-hidden="true">
  ${smokeMarkup()}
</g>

<g class="cfx-repair" aria-hidden="true">
  <rect x="902" y="456" width="96" height="190" fill="url(#cfxRepair)"/>
  <path d="M908 492 L992 492 M908 532 L992 532 M908 572 L992 572 M908 612 L992 612" stroke="#bffcff" stroke-width="1.5" opacity="0.5"/>
</g>
`;
  }

  let maskSeq = 0;

  function createSvg() {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 1536 1024");
    svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("cfx");
    svg.setAttribute("data-phase", "off");
    // A shared mask id resolves to the first SVG; if that one is hidden the
    // later instance loses its clipping and the trace escapes the glass.
    svg.innerHTML = svgMarkup().replace(/cfxScopeMask/g, `cfxScopeMask-${++maskSeq}`);
    return svg;
  }

  function attach(img) {
    if (img.dataset.cfxReady) return;
    const parent = img.parentElement;
    if (!parent) return;
    img.dataset.cfxReady = "1";

    const svg = createSvg();
    img.insertAdjacentElement("afterend", svg);

    const instance = {
      img,
      parent,
      svg,
      active: false,
      visible: false,
      timer: 0,
      index: 0,
      phase: "",
      force: false,
      start: null,
      stop: null,
      sync: null
    };

    let loops = 0;

    const scopeEls = {
      glow: svg.querySelector(".cfx-scope-trace--glow"),
      mid: svg.querySelector(".cfx-scope-trace--mid"),
      core: svg.querySelector(".cfx-scope-trace--core")
    };
    let scopeRaf = 0;
    let scopeLast = 0;
    let scopeTime = 0;
    let scopeMode = 0;
    let scopeModeUntil = 7;
    let scopePhaseAt = 0;

    function drawScope() {
      if (!scopeEls.core) return;
      const phase = instance.phase;
      const since = (performance.now() - scopePhaseAt) / 1000;
      if (scopeTime > scopeModeUntil) {
        scopeMode = (scopeMode + 1) % 4;
        scopeModeUntil = scopeTime + rand(7, 12);
      }
      let amp = 1;
      let noise = 0;
      let flat = false;
      if (phase === "dead") {
        flat = true;
      } else if (phase === "boom") {
        if (since > 0.34) flat = true;
        else amp = 2.3;
      } else if (phase === "zap") {
        amp = 1.12;
        noise = 0.34;
      } else if (phase === "repair") {
        amp = Math.min(1, since / 1.05);
        if (Math.random() < 0.14) amp *= 0.15;
      } else if (phase === "ignite") {
        amp = Math.min(1, since / 0.45);
        if (Math.random() < 0.3) amp *= 0.25;
      }
      const pts = [];
      const count = 56;
      for (let i = 0; i <= count; i += 1) {
        const u = i / count;
        let value;
        if (flat) {
          value = (Math.random() - 0.5) * 0.035;
        } else {
          value = scopeWave(u, scopeTime, scopeMode) * amp;
          if (noise) value += (Math.random() - 0.5) * noise;
        }
        let v = 0.6 - value * 0.32;
        if (v < 0.045) v = 0.045;
        else if (v > 0.955) v = 0.955;
        const [x, y] = scopeProject(u, v);
        pts.push(`${Math.round(x / 6) * 6},${Math.round(y / 6) * 6}`);
      }
      const points = pts.join(" ");
      scopeEls.glow.setAttribute("points", points);
      scopeEls.mid.setAttribute("points", points);
      scopeEls.core.setAttribute("points", points);
    }

    function scopeFrame(timestamp) {
      scopeRaf = 0;
      if (!instance.active || !instance.visible || document.hidden || !allowed()) return;
      if (!scopeLast) scopeLast = timestamp;
      if (timestamp - scopeLast >= 32) {
        const delta = Math.min(90, timestamp - scopeLast) / 1000;
        scopeLast = timestamp;
        scopeTime += delta;
        drawScope();
      }
      scopeRaf = window.requestAnimationFrame(scopeFrame);
    }

    function startScope() {
      if (scopeRaf) return;
      scopeLast = 0;
      drawScope();
      scopeRaf = window.requestAnimationFrame(scopeFrame);
    }

    function stopScope() {
      if (scopeRaf) window.cancelAnimationFrame(scopeRaf);
      scopeRaf = 0;
    }

    function setPhase(phase) {
      if (instance.phase === phase) return;
      if (phase === "repair") loops += 1;
      instance.phase = phase;
      scopePhaseAt = performance.now();
      svg.setAttribute("data-phase", phase);
      svg.classList.toggle("is-zapping", phase === "zap");
      svg.classList.toggle("is-blasting", phase === "boom");
      svg.classList.toggle("is-smoking", phase === "boom" || phase === "dead");
      svg.classList.toggle("is-repairing", phase === "repair");
    }

    function durationFor(phase) {
      if (phase === "off") return 1200;
      if (phase === "ignite") return 900;
      if (phase === "lit") return loops === 0 ? rand(5500, 8000) : rand(12000, 17000);
      if (phase === "zap") return 1300;
      if (phase === "boom") return 1350;
      if (phase === "dead") return rand(4600, 6000);
      return 1650;
    }

    function step() {
      if (!instance.active || instance.force) return;
      const phase = steps[instance.index];
      setPhase(phase);
      const wait = durationFor(phase);
      instance.timer = window.setTimeout(() => {
        if (!instance.active || instance.force) return;
        if (phase === "repair") instance.index = steps.indexOf("lit");
        else instance.index += 1;
        step();
      }, wait);
    }

    function start() {
      if (!allowed() || !instance.visible || document.hidden || instance.force) return;
      if (instance.active) return;
      instance.active = true;
      instance.index = 0;
      setPhase("idle");
      step();
      startScope();
    }

    function stop(reset) {
      instance.active = false;
      window.clearTimeout(instance.timer);
      instance.timer = 0;
      stopScope();
      if (reset) setPhase("idle");
    }

    function sync() {
      const on = allowed();
      if (!on) {
        stop(true);
        svg.style.display = "none";
        return;
      }
      svg.style.display = "";
      if (instance.visible && !document.hidden) start();
      else stop(true);
    }

    instance.start = start;
    instance.stop = stop;
    instance.sync = sync;

    svg.addEventListener("cfx-inspect", (event) => {
      instance.force = true;
      instance.active = false;
      window.clearTimeout(instance.timer);
      setPhase(event.detail || "lit");
    });

    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            instance.visible = entry.isIntersecting;
            sync();
          });
        },
        { threshold: 0.2 }
      );
      observer.observe(parent);
    } else {
      instance.visible = true;
    }

    instances.push(instance);
    sync();
    return instance;
  }

  function scan(root) {
    (root || document).querySelectorAll('img[src*="' + TARGET + '"]').forEach(attach);
  }

  function syncAll() {
    scan(document);
    instances.forEach((instance) => instance.sync());
  }

  document.addEventListener("kawaii:skinchange", syncAll);
  document.addEventListener("kawaii:fxchange", syncAll);
document.addEventListener("kawaii:motionchange", syncAll);
  if (typeof reducedMotion.addEventListener === "function") {
    reducedMotion.addEventListener("change", syncAll);
  }
  document.addEventListener("visibilitychange", syncAll);

  function boot() {
    scan(document);
    if ("MutationObserver" in window) {
      const observer = new MutationObserver(() => scan(document));
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.KawaiiCoverFx = {
    scan() {
      scan(document);
    },
    instances
  };
})();
