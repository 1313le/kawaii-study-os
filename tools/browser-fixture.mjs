import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

export async function openBrowser() {
  const metricsFile = path.join(os.tmpdir(), `kawaii-fixture-metrics-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(metricsFile, JSON.stringify({ version: 1, notes: {} }), 'utf8');
  const server = spawn(process.execPath, ['tools/serve.js'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, PORT: '4261', KAWAII_AUTH: 'off', KAWAII_METRICS_FILE: metricsFile },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const baseURL = await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.on('exit', code => reject(new Error(`Preview exited: ${code}`)));
    server.stdout.on('data', data => {
      const url = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (url) resolve(url[0]);
    });
  });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (error) {
    server.kill();
    throw error;
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL });
  return {
    browser, context, baseURL,
    async close() {
      await browser.close();
      const exited = once(server, 'exit');
      server.kill();
      await exited;
      fs.rmSync(metricsFile, { force: true });
    }
  };
}
