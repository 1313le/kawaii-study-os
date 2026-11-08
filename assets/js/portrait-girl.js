/* =========================================================
   kawaii / STUDY OS — portrait scene (fully procedural)
   Everything is drawn on a 5px grid: room, window, desk, monitor,
   lamp, mug, and the cat girl herself. No photo underneath means
   no matte seams, and every pixel can act.
   ========================================================= */

(function () {
  "use strict";

  const GRID = 160;        // 160 cells across 800px
  const CELL = 5;
  const GIRL = { x: 42, y: 34, size: 72 };  // girl grid inside the scene grid
  const LOOP = 15.5;

  const C = {
    skyTop: "#130b22",
    skyLow: "#1e1236",
    wall: "#160e26",
    wallEdge: "#241738",
    window: "#0d0a1a",
    windowRim: "#3a2a63",
    city: "#2a1d4a",
    cityLit: "#5a3f9e",
    star: "#c9a8ff",
    moon: "#f3e6ff",
    desk: "#1b1129",
    deskLip: "#2c1c44",
    deskGlow: "rgba(184,255,90,0.35)",
    deskPink: "rgba(255,95,210,0.28)",
    monitor: "#0c0818",
    monitorRim: "#35255c",
    screen: "#07130c",
    screenInk: "#b8ff5a",
    lamp: "#2a1a3c",
    lampGlow: "rgba(255,95,210,0.5)",
    mug: "#241738",
    mugRim: "rgba(184,255,90,0.65)",
    chair: "#151024",
    chairRim: "#241738",
    ink: "#0b0714",
    inkSoft: "#140e22",
    rimLime: "rgba(184,255,90,0.85)",
    rimLimeSoft: "rgba(184,255,90,0.35)",
    rimPink: "rgba(255,95,210,0.8)",
    rimPinkSoft: "rgba(255,95,210,0.3)",
    eye: "#b8feff",
    eyeGlow: "rgba(120,240,255,0.35)",
    pupil: "#06121a",
    white: "#ffffff",
    hand: "#ffb39c",
    handShade: "#c96f57",
    cup: "#0f0a1c",
    cupRim: "rgba(184,255,90,0.7)",
    note: "#ffd36a",
    chest: "rgba(184,255,90,0.16)"
  };

  /* ---------- room, drawn once ---------- */

  /* Back layer: everything that stays behind the standing girl. */
  function backMarkup(px) {
    // wall gradient by bands
    for (let y = 0; y < 160; y += 1) {
      const t = y / 160;
      const r = Math.round(19 + (30 - 19) * t);
      const g = Math.round(11 + (18 - 11) * t);
      const b = Math.round(34 + (54 - 34) * t);
      px(0, y, 160, 1, `rgb(${r},${g},${b})`);
    }

    // window
    px(8, 10, 56, 58, C.windowRim);
    px(9, 11, 54, 56, C.window);
    px(36, 11, 1, 56, C.windowRim);
    px(9, 38, 54, 1, C.windowRim);
    // moon
    px(18, 18, 9, 9, C.moon);
    px(17, 19, 11, 7, C.moon);
    px(19, 17, 7, 11, C.moon);
    // city
    const towers = [
      [12, 44, 6, 24], [19, 40, 7, 28], [27, 47, 5, 21], [33, 42, 8, 26],
      [42, 49, 6, 19], [49, 45, 7, 23], [57, 51, 5, 17]
    ];
    towers.forEach(([x, y, w, h]) => {
      px(x, y, w, h, C.city);
      px(x, y, w, 1, C.cityLit);
    });
    // lit windows
    const lights = [
      [13, 46], [16, 52], [21, 43], [24, 49], [28, 50], [35, 45], [38, 53],
      [44, 52], [50, 48], [53, 54], [58, 53], [14, 57], [22, 55], [36, 58]
    ];
    lights.forEach(([x, y], index) => px(x, y, 1, 1, index % 3 === 0 ? "#ff5fd2" : "#b8ff5a"));
    // window sill glow
    px(9, 66, 54, 1, C.windowRim);

    // monitor, standing behind her left shoulder
    px(2, 62, 42, 50, C.monitorRim);
    px(3, 63, 40, 48, C.monitor);
    px(5, 66, 36, 40, C.screen);
    px(5, 66, 36, 1, "rgba(184,255,90,0.5)");
    px(5, 66, 1, 40, "rgba(184,255,90,0.3)");
    px(7, 69, 12, 1, C.screenInk);
    px(7, 72, 20, 1, "rgba(184,255,90,0.55)");
    px(7, 75, 16, 1, "rgba(184,255,90,0.4)");
    px(7, 78, 24, 1, "rgba(184,255,90,0.3)");
    px(7, 82, 9, 1, "rgba(184,255,90,0.85)");
    // stand reaches the new desk line
    px(20, 108, 6, 10, C.monitorRim);

    // lamp
    px(146, 44, 4, 22, C.lamp);
    px(140, 40, 16, 4, C.lamp);
    px(142, 44, 12, 3, C.lampGlow);
    px(147, 66, 2, 8, C.lamp);
    px(140, 74, 16, 2, C.lampGlow);

    // shelf with books
    px(118, 14, 40, 2, C.chairRim);
    px(120, 6, 4, 8, "#3a2a63");
    px(125, 4, 4, 10, "#2a3f63");
    px(130, 7, 4, 7, "#4a2a63");
    px(135, 2, 4, 12, "#2f3a63");
    px(140, 5, 4, 9, "#3a2a63");
    px(145, 8, 4, 6, "#2a3f63");
    // poster, moved clear of her hair
    px(132, 82, 12, 16, C.chairRim);
    px(133, 83, 10, 14, "#1d1330");
    // tiny cat portrait on the poster
    px(135, 86, 1, 2, "rgba(184,255,90,0.8)");
    px(140, 86, 1, 2, "rgba(255,95,210,0.8)");
    px(135, 88, 6, 4, "#8f74c9");
    px(136, 90, 1, 1, "#ff5fd2");
    px(139, 90, 1, 1, "#ff5fd2");
    px(137, 91, 2, 1, "#241738");
    px(137, 94, 3, 1, "rgba(255,95,210,0.7)");
  }

  /* Front layer: desk surface (seen from above) and its front apron. */
  function deskMarkup(px) {
    // surface
    px(0, 118, 160, 20, C.desk);
    px(0, 118, 160, 1, C.deskLip);
    px(0, 118, 160, 1, "rgba(184,255,90,0.18)");
    px(0, 119, 160, 2, "rgba(255,95,210,0.12)");
    px(0, 121, 52, 2, C.deskGlow);
    px(118, 121, 42, 2, "rgba(255,95,210,0.15)");
    px(0, 128, 160, 1, "rgba(255,255,255,0.025)");
    px(0, 133, 160, 1, "rgba(255,255,255,0.02)");

    // front edge, then the apron
    px(0, 138, 160, 22, "#150d22");
    px(0, 138, 160, 1, "rgba(184,255,90,0.3)");
    px(0, 139, 160, 1, "rgba(255,95,210,0.16)");
    px(0, 159, 160, 1, "rgba(0,0,0,0.45)");

    // two drawers with soft handles
    px(12, 143, 58, 14, "#1b1229");
    px(12, 143, 58, 1, "#2c1c44");
    px(12, 156, 58, 1, "#0f0918");
    px(37, 149, 8, 2, "rgba(184,255,90,0.45)");
    px(90, 143, 58, 14, "#1b1229");
    px(90, 143, 58, 1, "#2c1c44");
    px(90, 156, 58, 1, "#0f0918");
    px(115, 149, 8, 2, "rgba(255,95,210,0.35)");

    // side vignettes
    px(0, 118, 3, 42, "rgba(7,3,15,0.32)");
    px(157, 118, 3, 42, "rgba(7,3,15,0.32)");
  }

  /* ---------- girl ---------- */

  const CHAIR = [
    [1, 28, 44], [2, 24, 48], [3, 21, 51], [4, 19, 53], [5, 17, 55],
    [6, 16, 56], [7, 15, 57], [8, 14, 58], [9, 14, 58], [10, 13, 59],
    [11, 13, 59], [12, 12, 60], [13, 12, 60], [14, 12, 60], [15, 12, 60],
    [16, 12, 60], [17, 12, 60], [18, 12, 60], [19, 12, 60], [20, 11, 61],
    [21, 11, 61], [22, 11, 61], [23, 11, 61], [24, 11, 61], [25, 11, 61],
    [26, 11, 61], [27, 11, 61], [28, 11, 61], [29, 11, 61], [30, 11, 61],
    [31, 11, 61], [32, 11, 61], [33, 11, 61], [34, 11, 61], [35, 11, 61],
    [36, 11, 61], [37, 11, 61], [38, 12, 60], [39, 13, 59], [40, 15, 57]
  ];

  const HAIR = [
    [3, 27, 45], [4, 23, 49], [5, 20, 52], [6, 18, 54], [7, 16, 56],
    [8, 15, 57], [9, 14, 58], [10, 13, 59], [11, 13, 59], [12, 12, 60],
    [13, 12, 60], [14, 12, 60], [15, 12, 60], [16, 12, 60], [17, 12, 60],
    [18, 12, 60], [19, 12, 60], [20, 11, 61], [21, 11, 61], [22, 11, 61],
    [23, 11, 61], [24, 11, 61], [25, 11, 61], [26, 11, 61], [27, 11, 61],
    [28, 11, 61], [29, 11, 61], [30, 11, 61], [31, 11, 61], [32, 12, 60],
    [33, 13, 59], [34, 14, 58], [35, 16, 56], [36, 18, 54], [37, 20, 52],
    [38, 23, 49]
  ];

  const BODY = [
    [42, 27, 45], [43, 24, 48], [44, 22, 50], [45, 21, 51], [46, 20, 52],
    [47, 19, 53], [48, 19, 53], [49, 18, 54], [50, 18, 54], [51, 18, 54],
    [52, 17, 55], [53, 17, 55], [54, 17, 55], [55, 17, 55], [56, 17, 55],
    [57, 17, 55], [58, 17, 55], [59, 17, 55], [60, 17, 55], [61, 17, 55],
    [62, 17, 55], [63, 17, 55], [64, 17, 55]
  ];

  function stateAt(time) {
    const t = time % LOOP;
    if (t < 3.4) return { mode: "type", local: t };
    if (t < 5.0) return { mode: "idle", local: t - 3.4 };
    if (t < 9.4) return { mode: "sip", local: t - 5.0 };
    if (t < 10.8) return { mode: "happy", local: t - 9.4 };
    return { mode: "idle", local: t - 10.8 };
  }

  function blinkAt(time) {
    const cycle = time % 4.6;
    return cycle > 4.3 && cycle < 4.45;
  }

  function ease(value) {
    const t = Math.max(0, Math.min(1, value));
    return 1 - Math.pow(1 - t, 3);
  }

  function spans(px, table, fill) {
    for (const row of table) px(row[1], row[0], row[2] - row[1] + 1, 1, fill);
  }

  function rim(px, table, left, right) {
    for (const row of table) {
      px(row[1], row[0], 1, 1, left);
      px(row[2], row[0], 1, 1, right);
    }
  }

  function ears(px, twitch) {
    const lift = Math.round(twitch);
    for (let i = 0; i < 13; i += 1) {
      const h = i + 2 + lift;
      px(14 + i, 17 - i - lift, 1, h, C.ink);
      px(57 - i, 17 - i - lift, 1, h, C.ink);
      px(14 + i, 17 - i - lift, 1, 1, i > 4 ? C.rimLimeSoft : C.rimLime);
      px(57 - i, 17 - i - lift, 1, 1, i > 4 ? C.rimPinkSoft : C.rimPink);
    }
  }

  function face(px, bob, state, blink) {
    const y = bob;
    px(22, 10 + y, 28, 30, C.ink);
    px(21, 14 + y, 30, 22, C.ink);
    px(20, 18 + y, 32, 16, C.ink);
    px(23, 40 + y, 26, 2, C.ink);
    px(21, 12 + y, 30, 6, C.ink);
    px(20, 18 + y, 5, 8, C.ink);
    px(47, 18 + y, 5, 8, C.ink);
    px(24, 20 + y, 24, 14, C.inkSoft);

    const closed = blink || state.mode === "sip";
    const happy = state.mode === "happy";
    const look = state.mode === "type" ? 1 : 0;

    if (happy) {
      happyEye(px, 24, 26 + y);
      happyEye(px, 39, 26 + y);
    } else if (closed) {
      px(24, 29 + y, 9, 1, C.eye);
      px(39, 29 + y, 9, 1, C.eye);
    } else {
      glowEye(px, 24, 25 + y, look);
      glowEye(px, 39, 25 + y, look);
    }
    px(28, 38 + y, 16, 1, C.chest);
  }

  function glowEye(px, x, y, look) {
    px(x - 1, y - 1, 11, 8, C.eyeGlow);
    px(x, y, 9, 6, C.eye);
    px(x + 3, y + 1 + look, 3, 4, C.pupil);
    px(x + 2, y + 1, 2, 2, C.white);
    px(x, y + 5, 9, 1, C.eyeGlow);
  }

  function happyEye(px, x, y) {
    px(x + 1, y + 3, 2, 1, C.eye);
    px(x + 3, y + 2, 2, 1, C.eye);
    px(x + 5, y + 3, 2, 1, C.eye);
    px(x + 3, y + 3, 2, 1, C.eye);
  }

  function neck(px) {
    px(31, 38, 10, 5, C.ink);
    px(29, 41, 14, 2, C.ink);
    px(36, 42, 2, 1, C.rimPink);
  }

  function body(px) {
    spans(px, BODY, C.ink);
    rim(px, BODY, C.rimLime, C.rimPink);
    for (let i = 0; i < BODY.length; i += 1) {
      const row = BODY[i];
      px(row[1] + 1, row[0], 1, 1, C.chest);
      px(row[2] - 1, row[0], 1, 1, C.chest);
    }
    px(30, 42, 12, 1, C.rimLimeSoft);
  }

  function headphones(px, bob) {
    px(20, 8 + bob, 32, 2, C.ink);
    px(20, 8 + bob, 32, 1, C.rimPinkSoft);
    px(18, 10 + bob, 3, 3, C.ink);
    px(51, 10 + bob, 3, 3, C.ink);
    [12, 53].forEach((x) => {
      px(x, 24 + bob, 7, 14, C.ink);
      px(x, 24 + bob, 1, 14, C.rimLimeSoft);
      px(x + 6, 24 + bob, 1, 14, C.rimPinkSoft);
      px(x + 2, 29 + bob, 3, 1, C.rimLime);
      px(x + 2, 31 + bob, 3, 1, C.rimLime);
      px(x + 2, 33 + bob, 3, 1, C.rimLimeSoft);
    });
  }

  function arm(px, side, handX, handY, elbowY) {
    const shoulderX = side < 0 ? 19 : 53;
    const elbowX = side < 0 ? 13 : 59;
    const shoulderY = 45;
    const stepsA = Math.max(Math.abs(elbowX - shoulderX), Math.abs(elbowY - shoulderY));
    for (let i = 0; i <= stepsA; i += 1) {
      const x = Math.round(shoulderX + ((elbowX - shoulderX) * i) / stepsA);
      const y = Math.round(shoulderY + ((elbowY - shoulderY) * i) / stepsA);
      px(x - 1, y, 4, 3, C.ink);
      px(side < 0 ? x - 1 : x + 2, y, 1, 3, side < 0 ? C.rimLimeSoft : C.rimPinkSoft);
    }
    const stepsB = Math.max(Math.abs(handX - elbowX), Math.abs(handY - elbowY));
    for (let i = 0; i <= stepsB; i += 1) {
      const x = Math.round(elbowX + ((handX - elbowX) * i) / stepsB);
      const y = Math.round(elbowY + ((handY - elbowY) * i) / stepsB);
      px(x - 1, y, 3, 3, C.inkSoft);
    }
    px(handX - 2, handY, 5, 4, C.hand);
    px(handX - 2, handY + 4, 5, 1, C.handShade);
    px(handX - 2, handY, 5, 1, C.rimLime);
  }

  function cup(px, x, y, tilt) {
    const cx = Math.round(x);
    const cy = Math.round(y);
    px(cx, cy, 9, 7, C.cup);
    px(cx, cy, 9, 1, C.cupRim);
    px(cx + 8, cy + 2, 1, 3, C.cup);
    px(cx + 1, cy + 2, 7, 1, C.rimPinkSoft);
    if (tilt) px(cx + 4, cy - 1, 5, 2, C.cup);
  }

  function note(px, progress) {
    const y = Math.round(24 - progress * 14);
    px(62, y, 1, 4, C.note);
    px(63, y, 2, 1, C.note);
    px(61, y + 3, 2, 1, C.note);
  }

  function girl(pxFor, time) {
    const px = pxFor;
    const state = stateAt(time);
    const blink = blinkAt(time);
    const bob = Math.round(Math.sin(time * 1.35) * 0.6);
    const twitch = Math.max(0, Math.sin(time * 0.63) - 0.94) * 26;

    let leftHandY = 58;
    let rightHandY = 58;
    let cupX = 58;
    let cupY = 60;
    let cupTilt = false;
    let rightElbow = 52;

    if (state.mode === "type") {
      const beat = Math.sin(time * 9);
      leftHandY = beat > 0 ? 55 : 59;
      rightHandY = beat > 0 ? 59 : 55;
    } else if (state.mode === "sip") {
      const local = state.local;
      const rise = ease((local - 0.35) / 1.1);
      const fall = ease((local - 2.6) / 1.1);
      const lift = Math.max(0, rise - fall);
      cupX = 58 + (36 - 58) * lift;
      cupY = 60 + (40 - 60) * lift;
      cupTilt = lift > 0.72;
      rightHandY = 59 - 16 * lift;
      rightElbow = 52 - 7 * lift;
    }

    spans(px, CHAIR, C.chair);
    rim(px, CHAIR, C.rimLimeSoft, C.rimPinkSoft);
    body(px);
    neck(px);
    spans(px, HAIR, C.ink);
    rim(px, HAIR, C.rimLime, C.rimPink);
    ears(px, twitch);
    face(px, bob, state, blink);
    headphones(px, bob);
    arm(px, -1, 31, leftHandY, 52);
    arm(px, 1, 41, rightHandY, rightElbow);
    if (state.mode === "sip") cup(px, cupX, cupY, cupTilt);
    if (state.mode === "happy") note(px, state.local / 1.4);
  }

  function paintBack(canvas) {
    const ctx = canvas.getContext("2d");
    const px = (cx, cy, w, h, fill) => {
      ctx.fillStyle = fill;
      ctx.fillRect(cx * CELL, cy * CELL, w * CELL, h * CELL);
    };
    backMarkup(px);
  }

  function paintDesk(canvas) {
    const ctx = canvas.getContext("2d");
    const px = (cx, cy, w, h, fill) => {
      ctx.fillStyle = fill;
      ctx.fillRect(cx * CELL, cy * CELL, w * CELL, h * CELL);
    };
    deskMarkup(px);
  }

  function paintGirl(ctx, time) {
    const px = (cx, cy, w, h, fill) => {
      ctx.fillStyle = fill;
      ctx.fillRect((GIRL.x + cx) * CELL, (GIRL.y + cy) * CELL, w * CELL, h * CELL);
    };
    girl(px, time);
  }

  window.KawaiiGirl = {
    grid: GRID,
    cell: CELL,
    stateAt: stateAt,
    paintRoom: paintBack,
    paintBack: paintBack,
    paintDesk: paintDesk,
    paint: paintGirl
  };
})();
