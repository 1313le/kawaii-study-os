import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, buildBacklinks } from './markdown.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const NOTES_DIR = path.join(ROOT, 'notes');
const OUT_FILE = path.join(ROOT, 'data', 'notes.generated.js');

const warnings = [];
const ACCENTS = new Set(['lime', 'pink', 'cyan', 'amber', 'blue']);
const FX = new Set(['scan', 'glitch', 'signal', 'reveal', 'type', 'none']);
const KINDS = new Set(['article', 'concept', 'experiment', 'debug', 'cornell', 'review']);
export const TEMPLATES = new Set(['circuit', 'waveform', 'grid', 'ladder', 'chip', 'terminal']);

export function parseFrontmatter(raw, file) {
  if (!raw.startsWith('---')) {
    warnings.push(`${file}: 缺少 frontmatter，已跳过。`);
    return null;
  }

  const closeIndex = raw.indexOf('\n---', 4);
  if (closeIndex === -1) {
    warnings.push(`${file}: frontmatter 没有闭合，已跳过。`);
    return null;
  }

  const header = raw.slice(4, closeIndex).trim();
  const body = raw.slice(closeIndex + 4).replace(/^\s*\n/, '');
  const data = {};

  for (const line of header.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
    data[key] = value;
  }

  return { data, body };
}

function splitTags(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[,，]/);
  return [...new Set(list.map((tag) => String(tag).trim()).filter(Boolean))];
}

function readingMinutes(text) {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = (text.match(/[A-Za-z0-9_]+/g) || []).length;
  return Math.max(1, Math.ceil(cjk / 350 + latin / 220));
}

function prepareNote({ file, raw }) {
  const parsed = parseFrontmatter(raw, file);
  if (!parsed) return null;
  const { data, body } = parsed;
  if (String(data.draft).toLowerCase() === 'true') return null;
  if (!String(data.title || '').trim()) {
    warnings.push(`${file}: 缺少 title，已跳过。`);
    return null;
  }
  if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) {
    warnings.push(`${file}: 缺少或非法 date，已跳过。`);
    return null;
  }
  const slug = String(data.slug || path.basename(file, '.md')).trim();
  if (!slug) {
    warnings.push(`${file}: slug 为空，已跳过。`);
    return null;
  }
  return { file, slug, data, body };
}

function buildNote(prepared, catalog) {
  const { file, slug, data, body } = prepared;
  const rendered = renderMarkdown(body, { catalog, slug });
  const { text } = rendered;

  let cover = String(data.cover || '').trim();
  if (cover.startsWith('template:')) {
    if (!TEMPLATES.has(cover.slice('template:'.length))) {
      warnings.push(`${file}: 未知封面模板 "${cover}"，回退为按类型生成`);
      cover = '';
    }
  } else if (cover && !fs.existsSync(path.join(ROOT, cover))) {
    warnings.push(`${file}: 封面不存在 "${cover}"`);
    cover = '';
  }

  const accent = ACCENTS.has(String(data.accent)) ? String(data.accent) : 'lime';
  const fx = FX.has(String(data.fx)) ? String(data.fx) : 'reveal';
  const kind = KINDS.has(String(data.kind)) ? String(data.kind) : 'article';
  const tags = splitTags(data.tags);
  const summary = String(data.summary || '').trim() || text.slice(0, 90) + (text.length > 90 ? '…' : '');
  const minutes = readingMinutes(`${summary} ${text}`);
  const collection = String(data.collection || '').trim() || '随笔';

  return {
    slug,
    file: `notes/${file}`,
    title: String(data.title),
    date: String(data.date),
    summary,
    tags,
    cover,
    accent,
    fx,
    minutes,
    collection,
    kind,
    ...rendered,
    source: body,
    backlinks: [],
    words: text.length
  };
}

// The CLI and in-memory fixture tests share the same two-pass pipeline.
export function buildNotes(sources) {
  warnings.length = 0;
  const prepared = [];
  const slugs = new Set();
  for (const source of sources) {
    const note = prepareNote(source);
    if (!note) continue;
    if (slugs.has(note.slug)) {
      warnings.push(`${note.file}: slug "${note.slug}" 重复，已跳过。`);
      continue;
    }
    slugs.add(note.slug);
    prepared.push(note);
  }
  const catalog = prepared.map(({ slug, file, data }) => ({ slug, file: `notes/${file}`, title: String(data.title) }));
  const notes = prepared.map((note) => buildNote(note, catalog));
  buildBacklinks(notes);
  for (const note of notes) {
    for (const target of note.brokenLinks) warnings.push(`${note.file}: 断链 "${target}"，已保留为不可跳转的文本。`);
  }
  return { notes, warnings: [...warnings] };
}

function main() {
  const files = fs
    .readdirSync(NOTES_DIR)
    .filter((file) => file.endsWith('.md') && !path.basename(file).startsWith('_'))
    .sort();
  const sources = files.map((file) => ({ file, raw: fs.readFileSync(path.join(NOTES_DIR, file), 'utf8') }));
  const { notes, warnings: buildWarnings } = buildNotes(sources);
  notes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));

  const tagCounts = new Map();
  for (const note of notes) {
    for (const tag of note.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }
  const tags = [...tagCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));

  const meta = {
    count: notes.length,
    words: notes.reduce((sum, note) => sum + (note.words || 0), 0),
    updated: notes[0]?.date || '',
    tags,
    collections: [...notes.reduce((map, note) => map.set(note.collection, (map.get(note.collection) || 0) + 1), new Map())]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN')),
    years: [...notes.reduce((map, note) => map.set(note.date.slice(0, 4), (map.get(note.date.slice(0, 4)) || 0) + 1), new Map())]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => b.year.localeCompare(a.year)),
    generatedAt: new Date().toISOString()
  };

  const payload = `/* Generated by tools/build.js — do not edit by hand. */\nwindow.NOTES = ${JSON.stringify(notes, null, 2)};\n\nwindow.NOTES_META = ${JSON.stringify(meta, null, 2)};\n`;
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, payload, 'utf8');

  console.log(`[build] ${notes.length} notes -> data/notes.generated.js`);
  console.log(`[build] ${meta.tags.length} tags, updated ${meta.updated || 'n/a'}`);
  if (buildWarnings.length) {
    console.log(`[build] ${buildWarnings.length} warning(s):`);
    for (const warning of buildWarnings) console.log(`  - ${warning}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main();
