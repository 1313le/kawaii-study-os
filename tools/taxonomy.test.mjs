import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeNote } from './note-store.js';
import { applyTaxonomy, collectTaxonomy, normalizeName } from './taxonomy.js';

const BASE = { date: '2026-11-08', kind: 'article' };
const note = (meta, body = '## 正文\n\n内容。\n') => composeNote({ meta: { ...BASE, ...meta }, body });

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kawaii-taxonomy-'));
  const dir = path.join(root, 'notes');
  fs.mkdirSync(dir);
  return { root, dir, undoPath: path.join(root, 'undo.json') };
}

function seed(dir, notes) {
  for (const [file, text] of Object.entries(notes)) fs.writeFileSync(path.join(dir, file), text, 'utf8');
}

function read(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

test('taxonomy counts collections and tags straight from the notes', () => {
  const { dir } = workspace();
  seed(dir, {
    'a.md': note({ title: 'A', collection: '电子基础', tags: ['电路', 'KVL'] }),
    'b.md': note({ title: 'B', collection: '电子基础', tags: ['电路'] }),
    'c.md': note({ title: 'C', tags: ['随笔'] })
  });
  const audit = collectTaxonomy(dir);
  assert.equal(audit.notes, 3);
  assert.deepEqual(audit.collections, [
    { name: '电子基础', count: 2 },
    { name: '随笔', count: 1 }
  ]);
  assert.equal(audit.tags.find((tag) => tag.name === '电路').count, 2);
});

test('renaming a collection rewrites only that field and keeps the body intact', () => {
  const { dir, undoPath } = workspace();
  const body = '## 现象\n\n上升沿是圆弧。\n\n```c\nint main(void) { return 0; }\n```\n';
  seed(dir, {
    'a.md': note({ title: 'A', collection: '电子基础', tags: ['电路'] }, body),
    'b.md': note({ title: 'B', collection: '随笔', tags: ['生活'] }, body)
  });
  const before = read(dir, 'b.md');
  const result = applyTaxonomy({ dir, undoPath, action: 'rename', kind: 'collection', from: '电子基础', to: '电子学' });
  assert.equal(result.ok, true);
  assert.equal(result.affected, 1);
  assert.ok(read(dir, 'a.md').includes('collection: 电子学'));
  assert.ok(read(dir, 'a.md').endsWith(body), 'the body must survive byte-for-byte');
  assert.ok(read(dir, 'a.md').includes('tags: 电路'), 'unrelated fields stay');
  assert.equal(read(dir, 'b.md'), before, 'untouched notes are not rewritten');
  assert.deepEqual(collectTaxonomy(dir).collections.map((item) => item.name).sort(), ['电子学', '随笔']);
});

test('merging tags folds several names into one without duplicates', () => {
  const { dir, undoPath } = workspace();
  seed(dir, {
    'a.md': note({ title: 'A', tags: ['电路', 'KVL'] }),
    'b.md': note({ title: 'B', tags: ['KCL', '电路'] }),
    'c.md': note({ title: 'C', tags: ['定律'] })
  });
  const result = applyTaxonomy({ dir, undoPath, action: 'merge', kind: 'tag', names: ['KVL', 'KCL', '定律'], to: '定律' });
  assert.equal(result.ok, true);
  assert.equal(result.affected, 2, 'only notes still using a folded name are rewritten');
  assert.ok(read(dir, 'a.md').includes('tags: 电路, 定律'));
  assert.ok(read(dir, 'b.md').includes('tags: 定律, 电路'));
  assert.ok(read(dir, 'c.md').includes('tags: 定律'));
  assert.equal(collectTaxonomy(dir).tags.find((tag) => tag.name === '定律').count, 3);
});

test('deleting a collection parks its notes in 未分类; deleting a tag strips it', () => {
  const { dir, undoPath } = workspace();
  seed(dir, {
    'a.md': note({ title: 'A', collection: '临时', tags: ['草稿', '电路'] }),
    'b.md': note({ title: 'B', collection: '临时', tags: ['电路'] })
  });
  applyTaxonomy({ dir, undoPath, action: 'delete', kind: 'collection', from: '临时' });
  assert.ok(read(dir, 'a.md').includes('collection: 未分类'));
  assert.ok(read(dir, 'a.md').includes('tags: 草稿, 电路'));

  applyTaxonomy({ dir, undoPath, action: 'delete', kind: 'tag', from: '草稿' });
  assert.ok(read(dir, 'a.md').includes('tags: 电路'));
  assert.ok(!read(dir, 'a.md').includes('草稿'));
});

test('undo restores the exact previous fields, including an absent collection line', () => {
  const { dir, undoPath } = workspace();
  seed(dir, {
    'a.md': note({ title: 'A', collection: '电子基础', tags: ['电路', 'KVL'] }),
    'b.md': note({ title: 'B', tags: ['生活'] })
  });
  const aBefore = read(dir, 'a.md');
  const bBefore = read(dir, 'b.md');

  applyTaxonomy({ dir, undoPath, action: 'rename', kind: 'collection', from: '电子基础', to: '电子学' });
  const undone = applyTaxonomy({ dir, undoPath, action: 'undo' });
  assert.equal(undone.ok, true);
  assert.equal(undone.affected, 1);
  assert.equal(read(dir, 'a.md'), aBefore, 'rename undo restores the file verbatim');

  applyTaxonomy({ dir, undoPath, action: 'delete', kind: 'collection', from: '随笔' });
  assert.ok(read(dir, 'b.md').includes('collection: 未分类'));
  applyTaxonomy({ dir, undoPath, action: 'undo' });
  assert.equal(read(dir, 'b.md'), bBefore, 'a note that never had a collection gets the line removed again');
});

test('bad names and no-op renames are rejected before any file is written', () => {
  const { dir, undoPath } = workspace();
  seed(dir, { 'a.md': note({ title: 'A', collection: '电子基础', tags: ['电路'] }) });
  const before = read(dir, 'a.md');

  assert.equal(normalizeName('collection', '   ').ok, false);
  assert.equal(normalizeName('tag', 'a,b').ok, false);
  assert.equal(normalizeName('collection', 'x'.repeat(41)).ok, false);

  for (const payload of [
    { action: 'rename', kind: 'collection', from: '电子基础', to: '   ' },
    { action: 'rename', kind: 'tag', from: '电路', to: 'a,b' },
    { action: 'rename', kind: 'collection', from: '电子基础', to: '电子基础' },
    { action: 'merge', kind: 'tag', names: [], to: '定律' },
    { action: 'delete', kind: 'planet', from: '电子基础' }
  ]) {
    const result = applyTaxonomy({ dir, undoPath, ...payload });
    assert.equal(result.ok, false, JSON.stringify(payload));
  }
  assert.equal(read(dir, 'a.md'), before);
  assert.equal(fs.existsSync(undoPath), false, 'a rejected operation leaves no undo state');
});

test('the taxonomy api lists, renames, undoes and rejects foreign origins', async () => {
  const { dir, undoPath } = workspace();
  seed(dir, {
    'a.md': note({ title: 'A', collection: '电子基础', tags: ['电路'] }),
    'b.md': note({ title: 'B', collection: '随笔', tags: ['生活'] })
  });
  const port = 4293;
  const server = spawn(process.execPath, ['tools/serve.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      KAWAII_NOTES_DIR: dir,
      KAWAII_UNDO_FILE: undoPath,
      KAWAII_NO_BUILD: '1', KAWAII_AUTH: 'off'
    },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const base = await new Promise((resolve, reject) => {
    server.stdout.on('data', (data) => {
      const found = data.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (found) resolve(found[0]);
    });
    server.on('exit', (code) => reject(new Error(`serve exited ${code}`)));
  });
  const post = (payload, headers = {}) =>
    fetch(`${base}/api/taxonomy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload)
    });
  try {
    const listed = await (await fetch(`${base}/api/taxonomy`)).json();
    assert.equal(listed.notes, 2);
    assert.equal(listed.undo.canUndo, false);

    const renamed = await post({ action: 'rename', kind: 'collection', from: '电子基础', to: '电子学' });
    assert.equal(renamed.status, 200);
    const result = await renamed.json();
    assert.equal(result.affected, 1);
    assert.equal(result.undo.canUndo, true);
    assert.ok(read(dir, 'a.md').includes('collection: 电子学'));

    const undone = await post({ action: 'undo' });
    assert.equal(undone.status, 200);
    assert.ok(read(dir, 'a.md').includes('collection: 电子基础'));

    const foreign = await post(
      { action: 'rename', kind: 'collection', from: '电子基础', to: 'hack' },
      { Origin: 'https://evil.example' }
    );
    assert.equal(foreign.status, 403);
    assert.ok(read(dir, 'a.md').includes('collection: 电子基础'));

    const plain = await fetch(`${base}/api/taxonomy`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'undo' })
    });
    assert.equal(plain.status, 415);

    const noUndo = await post({ action: 'undo' });
    assert.equal(noUndo.status, 409);
  } finally {
    server.kill();
  }
});
