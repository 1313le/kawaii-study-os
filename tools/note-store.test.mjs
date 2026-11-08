import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildNotes } from './build.js';
import { composeNote, saveNote, readNote } from './note-store.js';

const META = {
  title: 'I2C 上拉电阻到底该多大',
  date: '2026-11-07',
  kind: 'debug',
  summary: '从 4.7k 换成 2.2k 之后波形才方起来。',
  tags: ['I2C', '上拉', '示波器'],
  collection: '电子基础',
  accent: 'cyan',
  fx: 'signal'
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kawaii-notes-'));
}

test('a composed note parses back through the real build pipeline', () => {
  const text = composeNote({ meta: META, body: '## 现象\n\nSCL 上升沿是圆弧。\n' });
  assert.ok(text.startsWith('---\n'), 'frontmatter must open the file');
  assert.ok(text.includes('title: I2C 上拉电阻到底该多大'));

  const { notes, warnings } = buildNotes([{ file: 'i2c-pullup.md', raw: text }]);
  assert.deepEqual(warnings, []);
  assert.equal(notes.length, 1);
  const note = notes[0];
  assert.equal(note.title, META.title);
  assert.equal(note.date, META.date);
  assert.equal(note.kind, 'debug');
  assert.deepEqual(note.tags, META.tags);
  assert.equal(note.accent, 'cyan');
  assert.equal(note.fx, 'signal');
  assert.equal(note.collection, '电子基础');
  assert.equal(note.slug, 'i2c-pullup', 'the slug comes from the file name');
  assert.match(note.html, /<h2[^>]*>现象<\/h2>/);
});

test('saving refuses to overwrite an existing note and keeps its bytes', () => {
  const dir = tempDir();
  const first = saveNote({ dir, slug: 'i2c-pullup', meta: META, body: 'old body\n' });
  assert.equal(first.ok, true);
  const before = fs.readFileSync(path.join(dir, 'i2c-pullup.md'), 'utf8');

  const again = saveNote({ dir, slug: 'i2c-pullup', meta: { ...META, title: '新标题' }, body: 'new body\n' });
  assert.equal(again.ok, false);
  assert.equal(again.code, 'exists');
  assert.equal(fs.readFileSync(path.join(dir, 'i2c-pullup.md'), 'utf8'), before);

  const forced = saveNote({ dir, slug: 'i2c-pullup', meta: { ...META, title: '新标题' }, body: 'new body\n', overwrite: true });
  assert.equal(forced.ok, true);
  const after = fs.readFileSync(path.join(dir, 'i2c-pullup.md'), 'utf8');
  assert.ok(after.includes('新标题'));
  assert.ok(after.endsWith('new body\n'));
});

test('unsafe slugs and empty titles never reach the filesystem', () => {
  const dir = tempDir();
  for (const slug of ['../escape', 'a/b', 'UPPER', 'with space', '', '.hidden']) {
    const result = saveNote({ dir, slug, meta: META, body: 'x\n' });
    assert.equal(result.ok, false, `slug ${JSON.stringify(slug)} was accepted`);
    assert.equal(result.code, 'bad-slug');
  }
  assert.deepEqual(fs.readdirSync(dir), [], 'nothing should be written for a rejected slug');

  const badTitle = saveNote({ dir, slug: 'ok-slug', meta: { ...META, title: '  ' }, body: 'x\n' });
  assert.equal(badTitle.ok, false);
  assert.equal(badTitle.code, 'bad-title');

  const badDate = saveNote({ dir, slug: 'ok-slug', meta: { ...META, date: '2026/11/7' }, body: 'x\n' });
  assert.equal(badDate.ok, false);
  assert.equal(badDate.code, 'bad-date');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a saved note reads back into the editor unchanged', () => {
  const dir = tempDir();
  const body = '## 一\n\n第一段 `code`\n\n```c\nint main(void) { return 0; }\n```\n';
  assert.equal(saveNote({ dir, slug: 'round-trip', meta: META, body }).ok, true);
  const loaded = readNote({ dir, slug: 'round-trip' });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.body, body);
  assert.equal(loaded.meta.title, META.title);
  assert.deepEqual(loaded.meta.tags, META.tags);
  assert.equal(loaded.meta.collection, '电子基础');
  assert.equal(loaded.meta.kind, 'debug');
});

test('values that break YAML on one line are quoted, not corrupted', () => {
  const text = composeNote({
    meta: { ...META, title: '寄存器表: 0x4001 0000', summary: "它叫 'GPIOA' 的基地址" },
    body: 'x\n'
  });
  const { notes, warnings } = buildNotes([{ file: 'quoted.md', raw: text }]);
  assert.deepEqual(warnings, []);
  assert.equal(notes[0].title, '寄存器表: 0x4001 0000');
  assert.equal(notes[0].summary, "它叫 'GPIOA' 的基地址");
});

test('a cover may be a template id, and an unknown one falls back instead of breaking the build', () => {
  const good = composeNote({ meta: { ...META, cover: 'template:chip' }, body: 'x\n' });
  const parsed = buildNotes([{ file: 'tpl.md', raw: good }]);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.notes[0].cover, 'template:chip');

  const bad = composeNote({ meta: { ...META, cover: 'template:no-such' }, body: 'x\n' });
  const fallback = buildNotes([{ file: 'bad.md', raw: bad }]);
  assert.equal(fallback.notes[0].cover, '');
  assert.match(fallback.warnings.join('\n'), /未知封面模板/);
});

test('a column is free text and survives the build without any fixed taxonomy', () => {
  const meta = { ...META, title: '周末去看了一场雨', kind: 'article', collection: '生活' };
  const text = composeNote({ meta, body: '今天没有写代码。\n' });
  const parsed = buildNotes([{ file: 'rain.md', raw: text }]);
  assert.deepEqual(parsed.warnings.filter((line) => /未知/.test(line)), []);
  const note = parsed.notes[0];
  assert.equal(note.collection, '生活');
  assert.equal(note.trackId, undefined, 'notes no longer carry a curriculum track');
  assert.equal(note.title, '周末去看了一场雨');

  const unclassified = buildNotes([{ file: 'plain.md', raw: composeNote({ meta: { ...META, collection: '' }, body: 'x\n' }) }]);
  assert.equal(unclassified.notes[0].collection, '随笔', 'anything unclassified still gets a column');
});