import fs from 'node:fs/promises';
import { openBrowser } from './browser-fixture.mjs';

const fixture = await openBrowser();
try {
  const page = await fixture.context.newPage();
  await page.goto('/index.html');
  const images = await page.evaluate(async () => {
    const source = new Image();
    source.src = 'assets/img/cover-circuit.webp';
    await source.decode();
    const width = 574, height = 412;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source,780,0,width,height,0,0,width,height);
    const pixels = ctx.getImageData(0,0,width,height);
    const region = new Uint8Array(width * height);
    const visited = new Uint8Array(width * height);
    const queue = [170 * width + 220];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const cell = queue[cursor];
      if (visited[cell]) continue;
      visited[cell] = 1;
      const x = cell % width, y = Math.floor(cell / width);
      const [r,g,b] = pixels.data.subarray(cell*4,cell*4+3);
      if (!((r < 32 && b < 65 && g < 110) || (g > r*1.15 && g > b*1.3))) continue;
      region[cell] = 1;
      if (x > 0) queue.push(cell-1);
      if (x < width-1) queue.push(cell+1);
      if (y > 0) queue.push(cell-width);
      if (y < height-1) queue.push(cell+width);
    }
    for (let y = 0; y < height; y++) {
      let left = width, right = -1;
      for (let x = 0; x < width; x++) if (region[y*width+x]) { left = Math.min(left,x); right = x; }
      for (let x = left; x <= right; x++) region[y*width+x] = 1;
    }
    const mask = document.createElement('canvas');
    mask.width = width; mask.height = height;
    const maskCtx = mask.getContext('2d');
    const alpha = maskCtx.createImageData(width,height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let inside = true;
      for (let dy = -4; dy <= 4 && inside; dy++) for (let dx = -4; dx <= 4; dx++) {
        const nx = x+dx, ny = Math.max(0,y+dy);
        if (nx < 0 || nx >= width || ny >= height || !region[ny*width+nx]) { inside = false; break; }
      }
      if (inside) alpha.data.set([255,255,255,255],(y*width+x)*4);
    }
    maskCtx.putImageData(alpha,0,0);
    const glass = document.createElement('canvas');
    glass.width = width; glass.height = height;
    const g = glass.getContext('2d');
    g.fillStyle = '#031323'; g.fillRect(0,0,width,height);
    for (let y = 0; y < height; y += 6) for (let x = 0; x < width; x += 6) {
      const shade = ((x*13+y*7)%19)/19;
      g.fillStyle = `rgba(0,4,18,${0.12+shade*0.16})`;
      g.fillRect(x,y,6,6);
    }
    const project = (u,v) => [50+u*510-v*30, -10+u*44+v*(326+u*28)];
    g.fillStyle = '#10483f';
    for (let col = 0; col <= 8; col++) for (let row = 0; row < 50; row++) {
      if (row%2) continue;
      const [x,y] = project(col/8,row/50);
      g.fillRect(Math.round(x/6)*6,Math.round(y/6)*6,6,6);
    }
    for (let row = 0; row <= 5; row++) for (let col = 0; col < 74; col++) {
      if (col%2) continue;
      const [x,y] = project(col/74,row/5);
      g.fillRect(Math.round(x/6)*6,Math.round(y/6)*6,6,6);
    }
    g.globalCompositeOperation = 'destination-in'; g.drawImage(mask,0,0);
    ctx.drawImage(glass,0,0);
    return {plate:canvas.toDataURL().split(',')[1],mask:mask.toDataURL().split(',')[1]};
  });
  for (const [name,base64] of Object.entries(images)) {
    await fs.writeFile(new URL(`../assets/img/cover-scope-${name}.png`,import.meta.url),Buffer.from(base64,'base64'));
  }
} finally { await fixture.close(); }
