import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 4291;
let server;
let base;
let notesDir;

const META = {
  title: '本地写接口验收',
  date: '2026-11-07',
  kind: 'experiment',
  summary: '一次只写一个文件的保存测试。',
  tags: ['writing', 'api'],
  collection: '电子基础',
  accent: 'lime',
  fx: 'reveal'
};

before(async () => {
  notesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kawaii-api-'));
  server = spawn(process.execPath, ['tools/serve.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(PORT), KAWAII_NOTES_DIR: notesDir, KAWAII_NO_BUILD: '1', KAWAII_AUTH: 'off' },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  base = await new Promise((resolve, reject) => {
    server.stdout.on('data', (data) => {
      const found = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (found) resolve(found[0]);
    });
    server.on('exit', (code) => reject(new Error(`serve exited ${code}`)));
  });
});

after(async () => {
  server?.kill();
  if (notesDir) fs.rmSync(notesDir, { recursive: true, force: true });
});

const post = (route, payload, headers = {}) =>
  fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload)
  });

test('the editor can list what is already in the writing folder', async () => {
  const empty = await (await fetch(`${base}/api/notes`)).json();
  assert.deepEqual(empty.notes, [], 'the temp folder starts empty');

  await post('/api/note/save', { slug: 'listed-one', meta: META, body: 'x\n' });
  const response = await fetch(`${base}/api/notes`);
  assert.equal(response.status, 200);
  const { notes } = await response.json();
  assert.equal(notes.length, 1);
  assert.equal(notes[0].slug, 'listed-one');
  assert.equal(notes[0].title, META.title);
  assert.equal(notes[0].kind, 'experiment');
});

test('preview renders markdown with the site pipeline and strips scripts', async () => {
  const response = await post('/api/note/preview', {
    slug: 'draft',
    body: '## 现象\n\n$V = IR$\n\n<script>alert(1)</script>\n\n| a | b |\n| - | - |\n| 1 | 2 |\n'
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.match(result.html, /<h2[^>]*>现象<\/h2>/);
  assert.equal(result.hasMath, true);
  assert.ok(!/<script/i.test(result.html), 'a script tag survived the preview');
  assert.match(result.html, /<table/);
});

test('saving writes one file, refuses a silent overwrite, and honours an explicit one', async () => {
  const slug = 'api-round-trip';
  const created = await post('/api/note/save', { slug, meta: META, body: '## 一\n\n正文。\n' });
  assert.equal(created.status, 200);
  const file = path.join(notesDir, `${slug}.md`);
  const first = fs.readFileSync(file, 'utf8');
  assert.ok(first.startsWith('---\ntitle: 本地写接口验收'), 'frontmatter is written first');
  assert.ok(first.includes('tags: writing, api'));

  const again = await post('/api/note/save', { slug, meta: { ...META, title: '不该生效' }, body: '第二版\n' });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).code, 'exists');
  assert.equal(fs.readFileSync(file, 'utf8'), first, 'a refused save must not touch the file');

  const forced = await post('/api/note/save', { slug, overwrite: true, meta: { ...META, title: '显式覆盖' }, body: '第二版\n' });
  assert.equal(forced.status, 200);
  assert.ok(fs.readFileSync(file, 'utf8').includes('title: 显式覆盖'));

  const loaded = await fetch(`${base}/api/note?slug=${slug}`);
  assert.equal(loaded.status, 200);
  const note = await loaded.json();
  assert.equal(note.meta.title, '显式覆盖');
  assert.equal(note.body, '第二版\n');
});

test('a page from another origin cannot write, even while the server is up', async () => {
  const before = fs.readdirSync(notesDir).sort();
  const response = await post(
    '/api/note/save',
    { slug: 'csrf-attempt', meta: META, body: 'x\n' },
    { Origin: 'https://evil.example' }
  );
  assert.equal(response.status, 403);
  assert.deepEqual(fs.readdirSync(notesDir).sort(), before, 'nothing may be written for a foreign origin');

  const plain = await fetch(`${base}/api/note/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ slug: 'plain-attempt', meta: META, body: 'x\n' })
  });
  assert.equal(plain.status, 415);
});

test('a traversal slug is rejected before it reaches the filesystem', async () => {
  const response = await post('/api/note/save', { slug: '../../escape', meta: META, body: 'x\n' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'bad-slug');
  assert.ok(!fs.existsSync(path.resolve(notesDir, '../../escape.md')));
});
