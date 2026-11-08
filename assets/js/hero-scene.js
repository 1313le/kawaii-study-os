(function () {
  "use strict";

  const PATCHES = [
    { name: "cat", x: 170, y: 480, width: 390, height: 195 },
    { name: "mouse", x: 1045, y: 683, width: 165, height: 108 },
    { name: "water", x: 1158, y: 298, width: 185, height: 81 }
  ];

  function influence(x, y, cx, cy, rx, ry) {
    const distance = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    return Math.max(0, 1 - distance) ** 2;
  }

  class HeroScene {
    constructor(stage, image) {
      this.stage = stage;
      this.image = image;
      this.layers = [];
      this.phase = "idle";
      this.running = false;
      this.raf = 0;
      this.last = 0;
      this.started = 0;
      this.phaseAt = 0;
      this.startledAt = -10000;
      this.frame = this.frame.bind(this);
      if (image.complete && image.naturalWidth) this.prepare();
      else image.addEventListener("load", () => this.prepare(), { once: true });
    }

    prepare() {
      this.layers = PATCHES.map(spec => {
        const canvas = document.createElement("canvas");
        canvas.className = "hero-scene__layer";
        canvas.dataset.sceneLayer = spec.name;
        canvas.setAttribute("aria-hidden", "true");
        canvas.width = spec.width;
        canvas.height = spec.height;
        Object.assign(canvas.style, {
          left: `${spec.x / 1536 * 100}%`, top: `${spec.y / 1024 * 100}%`,
          width: `${spec.width / 1536 * 100}%`, height: `${spec.height / 1024 * 100}%`
        });
        this.stage.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.image, spec.x, spec.y, spec.width, spec.height, 0, 0, spec.width, spec.height);
        const source = ctx.getImageData(0, 0, spec.width, spec.height);
        const output = new ImageData(new Uint8ClampedArray(source.data), spec.width, spec.height);
        const weights = new Float32Array(spec.width * spec.height * 3);
        for (let y = 4; y < spec.height - 4; y++) {
          for (let x = 4; x < spec.width - 4; x++) {
            const i = (y * spec.width + x) * 3;
            const edge = Math.min(1, (x - 3) / 12, (y - 3) / 12, (spec.width - 4 - x) / 12, (spec.height - 4 - y) / 12);
            if (spec.name === "cat") {
              const ground = Math.max(0, Math.min(1, (168 - y) / 24));
              weights[i] = influence(x, y, 135, 86, 155, 95) * edge * ground;
              weights[i + 1] = influence(x, y, 278, 112, 102, 74) * edge * ground;
              weights[i + 2] = influence(x, y, 253, 61, 41, 48) * edge;
            } else if (spec.name === "mouse") {
              weights[i] = influence(x, y, 85, 51, 79, 49) * edge;
            } else {
              weights[i] = edge;
            }
          }
        }
        return { ...spec, canvas, ctx, source, output, weights };
      });
    }

    setPhase(phase) {
      this.phase = phase;
      this.phaseAt = performance.now();
      if (phase === "crash") this.startledAt = this.phaseAt;
      this.stage.dataset.phase = phase;
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.started = performance.now();
      this.startledAt = -10000;
      this.last = 0;
      this.raf = requestAnimationFrame(this.frame);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }

    frame(now) {
      if (!this.running) return;
      this.raf = requestAnimationFrame(this.frame);
      if (now - this.last < 80) return;
      this.last = now;
      const time = (now - this.started) / 1000;
      const age = (now - this.phaseAt) / 1000;
      const surprise = Math.max(0, 1 - (now - this.startledAt) / 1300);
      const breath = 2.3 + Math.sin(time * 1.65) * 2.3;
      const ear = Math.max(0, Math.sin(time * 0.7) - 0.88) * 34;
      const point = this.phase === "pointing" ? Math.sin(Math.min(1, age / 0.9) * Math.PI) : 0;
      const click = this.phase === "pointing" && age > 0.52 && age < 0.7 ? 3 : 0;
      for (const layer of this.layers) this.paint(layer, { time, surprise, breath, ear, point, click });
    }

    paint(layer, motion) {
      const { width, height, source, output, weights, ctx, name } = layer;
      for (let y = 0; y < height; y++) {
        const ripple = Math.sin(motion.time * 2 + y * 0.21) * 3;
        for (let x = 0; x < width; x++) {
          const cell = y * width + x;
          const w = cell * 3;
          let dx = 0, dy = 0;
          if (name === "cat") {
            dx = motion.surprise * 4 * weights[w + 1];
            dy = -(motion.breath * weights[w] + motion.surprise * 9 * weights[w + 1] + (motion.ear + motion.surprise * 5) * weights[w + 2]);
          } else if (name === "mouse") {
            dx = motion.point * 7 * weights[w];
            dy = (motion.point * -2 + motion.click) * weights[w];
          } else {
            dx = ripple * weights[w];
          }
          const sx = Math.max(0, Math.min(width - 1, x - Math.round(dx)));
          const sy = Math.max(0, Math.min(height - 1, y - Math.round(dy)));
          const from = (sy * width + sx) * 4;
          const to = cell * 4;
          output.data[to] = source.data[from];
          output.data[to + 1] = source.data[from + 1];
          output.data[to + 2] = source.data[from + 2];
          output.data[to + 3] = 255;
        }
      }
      ctx.putImageData(output, 0, 0);
    }
  }

  window.KawaiiHeroScene = HeroScene;
})();
