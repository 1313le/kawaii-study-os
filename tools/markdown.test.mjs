import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, DomUtils } from 'htmlparser2';
import { renderMarkdown, buildBacklinks } from './markdown.js';

const catalog = [
  { slug: 'source', file: 'notes/source.md', title: '源笔记' },
  { slug: '电路 & 电压', file: 'notes/voltage.md', title: '电压概念' },
  { slug: 'other', file: 'notes/nested/other-file.md', title: '其他' }
];
const dom = (html) => parseDocument(html);
const elements = (root, tag) => DomUtils.findAll((node) => node.name === tag, root.children);
const classed = (root, name) => DomUtils.findAll(
  (node) => (node.attribs?.class || '').split(/\s+/).includes(name), root.children
);
const text = (node) => DomUtils.textContent(node);
const parentTags = (node) => {
  const tags = [];
  for (let parent = node.parent; parent; parent = parent.parent) tags.push(parent.name);
  return tags;
};
const render = (body, options = {}) => renderMarkdown(body, { catalog, slug: 'source', ...options });

test('nested lists, disabled tasks, wrapped tables and strikethrough retain semantics', () => {
  const { html } = render('- parent\n  - child\n    1. deep\n\n- [x] done\n- [ ] todo\n\n| name | value |\n| --- | ---: |\n| ~~old~~ | new |');
  const root = dom(html);
  assert.ok(elements(root, 'ol').some((node) => parentTags(node).includes('li')));
  assert.equal(elements(root, 'input').length, 2);
  const [checked, unchecked] = elements(root, 'input');
  assert.equal(checked.attribs.type, 'checkbox');
  assert.ok(Object.hasOwn(checked.attribs, 'checked'));
  assert.ok(Object.hasOwn(checked.attribs, 'disabled'));
  assert.ok(!Object.hasOwn(unchecked.attribs, 'checked'));
  assert.equal(elements(root, 'table')[0].parent.attribs.class, 'table-wrap');
  assert.equal(text(elements(root, 's')[0]), 'old');
});

test('subscript, superscript and highlight are real inline elements', () => {
  const root = dom(render('H~2~O x^2^ ==重点==').html);
  assert.equal(elements(root, 'sub').map(text).join(), '2');
  assert.equal(elements(root, 'sup').map(text).join(), '2');
  assert.equal(elements(root, 'mark').map(text).join(), '重点');
});

test('footnotes retain safe reference targets and definition lists', () => {
  const root = dom(render('正文[^a] 和再次[^a]\n\n[^a]: 注释 **内容**\n\n术语\n: 定义').html);
  assert.equal(elements(root, 'dt').map(text).join(), '术语');
  assert.equal(elements(root, 'dd').map(text).join().trim(), '定义');
  const refs = classed(root, 'footnote-ref');
  assert.equal(refs.length, 2);
  const ids = new Set(DomUtils.findAll((node) => Boolean(node.attribs?.id), root.children).map((node) => node.attribs.id));
  for (const link of elements(root, 'a')) {
    if (link.attribs.href?.startsWith('#')) assert.ok(ids.has(link.attribs.href.slice(1)));
  }
  assert.ok(text(root).includes('注释 内容'));
});

test('inline and display KaTeX preserve HTML plus MathML without granting trust', () => {
  const result = render('行内 $U = IR$。\n\n$$\n\\frac{1}{2} + x^2\n$$\n\n$\\href{javascript:alert(1)}{x}$ $\\htmlStyle{background:url(javascript:alert(1))}{x}$');
  const root = dom(result.html);
  assert.equal(result.hasMath, true);
  assert.ok(classed(root, 'katex').length >= 2);
  assert.ok(classed(root, 'katex-display').length >= 1);
  assert.ok(classed(root, 'katex-html').length >= 2);
  assert.ok(elements(root, 'math').length >= 2);
  assert.ok(elements(root, 'annotation').some((node) => text(node) === 'U = IR'));
  assert.ok(!elements(root, 'a').some((node) => /javascript:/i.test(node.attribs.href || '')));
  assert.ok(!DomUtils.findAll((node) => /background|javascript:/i.test(node.attribs?.style || ''), root.children).length);
});

test('currency and escaped dollars stay literal', () => {
  const result = render('Price: $5 and $10; \\$20.');
  assert.equal(result.hasMath, false);
  assert.equal(result.text, 'Price: $5 and $10; $20.');
});

test('code, URLs, link labels and HTML attributes isolate wiki and math parsing', () => {
  const result = render('`[[voltage]] $x$ H~2~O ==mark==`\n\n[[$bad]]\n\n[link](https://example.com/$x$/a~b~?q=^z^)\n\n[ [[voltage]] $x$ ](https://example.com)\n\n<a href="https://example.com" title="$x$ [[voltage]]">raw</a>');
  const root = dom(result.html);
  assert.equal(text(elements(root, 'code')[0]), '[[voltage]] $x$ H~2~O ==mark==');
  assert.equal(elements(root, 'a')[0].attribs.href, 'https://example.com/$x$/a~b~?q=%5Ez%5E');
  assert.ok(elements(root, 'a').every((node) => !parentTags(node).includes('a')));
  assert.deepEqual(result.links, []);
  assert.equal(result.hasMath, false);
});

for (const type of ['note', 'tip', 'important', 'warning', 'caution']) {
  test(`${type} alert keeps nested content inside the callout body`, () => {
    const root = dom(render(`> [!${type.toUpperCase()}]\n> **标题**\n>\n> - 条目\n>   - 嵌套\n>\n> > 引用\n\n外部段落`).html);
    const callout = classed(root, `callout-${type}`)[0];
    assert.ok(callout);
    assert.equal(classed(callout, 'callout-label').length, 1);
    const body = classed(callout, 'callout-body')[0];
    assert.equal(elements(body, 'strong').map(text).join(), '标题');
    assert.equal(elements(body, 'li').length, 2);
    assert.equal(elements(body, 'blockquote').length, 1);
    assert.ok(!text(callout).includes('外部段落'));
    assert.ok(!text(body).includes(`[!${type.toUpperCase()}]`));
  });
}

test('the entire output is sanitized; safe semantic HTML survives', () => {
  const result = render(`<script>alert('script')</script>
<style>body{display:none}</style>
<iframe src="https://evil.example"></iframe><object data="https://evil.example"></object>
<svg onload="alert(1)"><script>alert(2)</script><foreignObject>svg-content</foreignObject></svg>
<math><mtext><img src=x onerror=alert(1)></mtext></math>
<img src="safe.png" onerror="alert(1)" style="background:url(javascript:alert(1))">
<a href="javascript:alert(1)" onclick="alert(1)">js</a>
<a href="jav&#x61;script:alert(1)">entity</a>
<a href="data:text/html,<script>alert(1)</script>">data</a>
<a href="//evil.example">protocol-relative</a>
<a href="\\\\evil.example">backslash</a>
<img src="data:image/svg+xml,evil"><img src="//evil.example/a.png">
<input type="text" autofocus onfocus="alert(1)"><button formaction="javascript:alert(1)">bad</button>
<div id="sec-1" class="mermaid" style="color:red">not-a-diagram</div>
<span data-math="0">MATH_PLACEHOLDER_0</span>
<details open><summary>展开</summary><p><kbd>Ctrl</kbd> <strong>保留</strong></p></details>

## 真标题`);
  const root = dom(result.html);
  for (const tag of ['script', 'style', 'iframe', 'object', 'svg', 'math', 'foreignobject']) {
    assert.equal(elements(root, tag).length, 0, tag);
  }
  const all = DomUtils.findAll(() => true, root.children);
  for (const node of all) {
    for (const [name, value] of Object.entries(node.attribs || {})) {
      assert.ok(!/^on|^style$|^srcdoc$|^formaction$/.test(name), name);
      if (name === 'href' || name === 'src') assert.ok(!/^(?:javascript:|data:|\/\/|\\)/i.test(value), value);
    }
  }
  assert.equal(classed(root, 'mermaid').length, 0);
  assert.equal(elements(root, 'input').length, 0);
  assert.equal(elements(root, 'details').length, 1);
  assert.equal(elements(root, 'summary').map(text).join(), '展开');
  assert.equal(elements(root, 'kbd').map(text).join(), 'Ctrl');
  assert.equal(elements(root, 'h2')[0].attribs.id, 'sec-1');
  assert.equal(all.filter((node) => node.attribs?.id === 'sec-1').length, 1);
});

test('allowed external links and relative images keep safe attributes and valid figure structure', () => {
  const root = dom(render('前文 ![说明](images/pic.png "图片标题") 后文\n\n![远程](https://example.com/a.png)\n\n[网站](https://example.com) [邮件](mailto:me@example.com) [FTP](ftp://example.com/a)\n\n[![缩略](images/pic.png)](https://example.com/full)').html);
  const figures = elements(root, 'figure');
  assert.equal(figures.length, 3);
  for (const figure of figures) {
    assert.ok(!parentTags(figure).includes('p'));
    const anchor = elements(figure, 'a')[0];
    assert.ok(anchor.attribs.class.includes('img-zoom'));
    assert.equal(anchor.attribs['data-lightbox'], 'note');
    assert.equal(elements(figure, 'img').length, 1);
    assert.equal(elements(figure, 'figcaption').length, 1);
  }
  assert.equal(elements(figures[0], 'img')[0].attribs.src, 'images/pic.png');
  assert.equal(elements(figures[0], 'a')[0].attribs['data-caption'], '图片标题');
  assert.ok(text(root).includes('前文') && text(root).includes('后文'));
  assert.ok(elements(root, 'a').every((node) => !parentTags(node).includes('a')));
  const external = elements(root, 'a').find((node) => text(node) === '网站');
  assert.equal(external.attribs.target, '_blank');
  assert.equal(external.attribs.rel, 'noopener noreferrer');
  assert.equal(elements(root, 'a').find((node) => text(node) === '邮件').attribs.href, 'mailto:me@example.com');
  assert.ok(!elements(root, 'a').some((node) => node.attribs.href?.startsWith('ftp:')));
});

test('TOC uses h2/h3 only with per-document sec-N heading IDs and plain text', () => {
  const result = render('# 一级\n\n## 二级 **重点** &amp;\n\n#### 四级\n\n### 三级 `code`\n\n## 二级 **重点** &amp;');
  assert.deepEqual(result.toc, [
    { depth: 2, id: 'sec-2', text: '二级 重点 &' },
    { depth: 3, id: 'sec-4', text: '三级 code' },
    { depth: 2, id: 'sec-5', text: '二级 重点 &' }
  ]);
  const root = dom(result.html);
  for (const item of result.toc) assert.ok(elements(root, `h${item.depth}`).some((node) => node.attribs.id === item.id));
  assert.equal(render('## 新笔记').toc[0].id, 'sec-1');
  assert.equal(render('plain').hasMath, false);
  assert.equal(render('plain').hasMermaid, false);
  assert.equal(render('plain').hasWaveDrom, false);
});

test('wiki resolves catalog slugs and file names, encodes destinations and escapes labels', () => {
  const result = render('[[电路 & 电压|电压]] [[voltage]] [[notes/voltage.md#sec-2|片段]] [[nested/other-file]] [[other|<img onerror=alert(1)>]] [[source]]');
  assert.deepEqual(result.links, ['电路 & 电压', 'other', 'source']);
  assert.deepEqual(result.brokenLinks, []);
  const links = classed(dom(result.html), 'wiki-link');
  assert.equal(links.length, 6);
  assert.equal(links[0].attribs.href, 'note.html?slug=%E7%94%B5%E8%B7%AF%20%26%20%E7%94%B5%E5%8E%8B');
  assert.equal(text(links[0]), '电压');
  assert.equal(text(links[1]), 'voltage');
  assert.ok(links[2].attribs.href.endsWith('#sec-2'));
  assert.equal(text(links[4]), '<img onerror=alert(1)>');
  assert.equal(elements(links[4], 'img').length, 0);
});

test('ordinary .md links resolve relative paths and record backlinks', () => {
  const result = render('[电压](./voltage.md#sec-2) [其他](notes/nested/other-file.md) [外部](https://example.com/voltage.md)');
  assert.deepEqual(result.links, ['电路 & 电压', 'other']);
  const links = elements(dom(result.html), 'a');
  assert.ok(links[0].attribs.href.endsWith('#sec-2'));
  assert.equal(links[1].attribs.href, 'note.html?slug=other');
  assert.equal(links[2].attribs.href, 'https://example.com/voltage.md');
  const nested = render('[向上](../voltage.md)', { slug: 'other' });
  assert.deepEqual(nested.links, ['电路 & 电压']);
});

test('missing and ambiguous targets stay visible without links to wrong pages', () => {
  const result = render('[[missing|<b>缺失</b>]] [[missing]] [不存在](gone.md) [[voltage#bad anchor]] [[same]]', {
    catalog: [...catalog,
      { slug: 'one', file: 'notes/a/same.md', title: '一' },
      { slug: 'two', file: 'notes/b/same.md', title: '二' }
    ]
  });
  assert.deepEqual(result.links, []);
  assert.deepEqual(result.brokenLinks, ['missing', 'gone.md', 'voltage#bad anchor', 'same']);
  const root = dom(result.html);
  const missing = classed(root, 'wiki-link--missing');
  assert.equal(missing.length, 5);
  assert.ok(missing.every((node) => node.name === 'span' && node.attribs.title));
  assert.equal(text(missing[0]), '<b>缺失</b>');
  assert.equal(elements(root, 'a').length, 0);
});

test('code wrappers preserve escaped raw code including final line and no generated line numbers', () => {
  const source = 'first\nlast<&>\n';
  const root = dom(render(`\`\`\`js\n${source}\`\`\``).html);
  const block = classed(root, 'code-block')[0];
  assert.equal(block.attribs['data-lang'], 'js');
  const header = classed(block, 'code-head')[0];
  assert.equal(text(classed(header, 'code-lang')[0]), 'js');
  assert.ok(Object.hasOwn(elements(header, 'button')[0].attribs, 'data-copy'));
  const code = elements(block, 'code')[0];
  assert.equal(code.parent.name, 'pre');
  assert.equal(code.attribs.class, 'language-js');
  assert.equal(text(code), source);
  assert.equal(code.children.length, 1);
  const noNewline = dom(render('```text\nlast line').html);
  assert.equal(text(elements(noNewline, 'code')[0]).trimEnd(), 'last line');
});

test('Mermaid and JSON-object WaveDrom are inert escaped text with noscript fallbacks', () => {
  const mermaid = 'graph TD\nA["<script>alert(1)</script>"] --> B\n';
  const wave = '{"signal":[{"name":"<img onerror=alert(1)>","wave":"01"}]}\n';
  const result = render(`\`\`\`mermaid\n${mermaid}\`\`\`\n\n\`\`\`wavedrom\n${wave}\`\`\``);
  const root = dom(result.html);
  assert.equal(result.hasMermaid, true);
  assert.equal(result.hasWaveDrom, true);
  assert.equal(text(classed(root, 'mermaid')[0]), mermaid);
  assert.equal(text(classed(root, 'wavedrom')[0]), wave);
  assert.equal(classed(root, 'diagram-block').length, 2);
  assert.equal(classed(root, 'diagram-head').length, 2);
  assert.equal(elements(root, 'noscript').length, 2);
  assert.equal(elements(root, 'script').length, 0);
  assert.equal(elements(root, 'img').length, 0);
  for (const invalid of ['null', '[]', '{signal: []}', 'alert(1)']) {
    const rejected = render(`\`\`\`wavedrom\n${invalid}\n\`\`\``);
    assert.equal(rejected.hasWaveDrom, false);
    assert.equal(classed(dom(rejected.html), 'wavedrom').length, 0);
    assert.equal(text(elements(dom(rejected.html), 'code')[0]), `${invalid}\n`);
  }
});

test('backlinks derive from real rendered links, deduplicate and ignore self or missing targets', () => {
  const notes = [
    { ...catalog[0], ...render('[[voltage]] [[voltage]] [[source]] [[missing]]') },
    { ...catalog[1], ...render('[[source]]', { slug: '电路 & 电压' }) },
    { ...catalog[2], ...render('[[source]]', { slug: 'other' }) }
  ];
  buildBacklinks(notes);
  assert.deepEqual(notes[0].backlinks, [
    { slug: '电路 & 电压', title: '电压概念' }, { slug: 'other', title: '其他' }
  ]);
  assert.deepEqual(notes[1].backlinks, [{ slug: 'source', title: '源笔记' }]);
  assert.deepEqual(notes[2].backlinks, []);
  buildBacklinks(notes);
  assert.equal(notes[0].backlinks.length, 2);
});

const noteSource = (file, header, body = '') => ({
  file, raw: `---\n${header}\n---\n${body}`
});

test('build prepares the complete valid catalog before rendering and reports broken links', async () => {
  const build = await import('./build.js');
  assert.equal(typeof build.buildNotes, 'function', 'build must expose its actual in-memory pipeline');
  const result = build.buildNotes([
    noteSource('first.md', 'title: 首篇\ndate: 2026-11-06', '[[target]] [[later-file]] [后篇](later-file.md) [[draft]] [[untitled]] [[undated]] [[discarded]]'),
    noteSource('later-file.md', 'title: 后篇\ndate: 2026-11-05\nslug: target'),
    noteSource('draft.md', 'title: 草稿\ndate: 2026-11-05\ndraft: true'),
    noteSource('untitled.md', 'date: 2026-11-05'),
    noteSource('undated.md', 'title: 缺少日期'),
    noteSource('discarded.md', 'title: 重复\ndate: 2026-11-05\nslug: target')
  ]);
  assert.deepEqual(result.notes.map((note) => note.slug), ['first', 'target']);
  assert.deepEqual(result.notes[0].links, ['target']);
  assert.deepEqual(result.notes[0].brokenLinks, ['draft', 'untitled', 'undated', 'discarded']);
  assert.deepEqual(result.notes[1].backlinks, [{ slug: 'first', title: '首篇' }]);
  assert.ok(result.warnings.some((warning) => warning.includes('discarded.md') && warning.includes('重复')));
  assert.ok(result.warnings.some((warning) => warning.includes('断链') && warning.includes('draft')));
});

test('build keeps free-text collections while enforcing kind and new render fields', async () => {
  const build = await import('./build.js');
  assert.equal(typeof build.buildNotes, 'function', 'build must expose its actual in-memory pipeline');
  const kinds = ['article', 'concept', 'experiment', 'debug', 'cornell', 'review', 'unsupported', ''];
  const result = build.buildNotes(kinds.map((kind, index) => noteSource(
    `kind-${index}.md`,
    `title: 类型${index}\ndate: 2026-11-06\nkind: ${kind}\ncollection: 电子基础\naccent: cyan\ntags: [电路, 电路, 复习]`,
    '## 标题\n\nH~2~O\n\n```wavedrom\n{"signal":[]}\n```'
  )));
  assert.deepEqual(result.notes.map((note) => note.kind), ['article', 'concept', 'experiment', 'debug', 'cornell', 'review', 'article', 'article']);
  const note = result.notes[0];
  assert.equal(note.file, 'notes/kind-0.md');
  assert.equal(note.title, '类型0');
  assert.equal(note.date, '2026-11-06');
  assert.equal(note.collection, '电子基础');
  assert.equal(note.trackId, undefined, 'the curriculum taxonomy is gone');
  assert.equal(note.accent, 'cyan');
  assert.equal(note.fx, 'reveal');
  assert.deepEqual(note.tags, ['电路', '复习']);
  assert.ok(note.summary && note.minutes >= 1 && note.words === note.text.length);
  assert.equal(note.hasWaveDrom, true);
  assert.equal(note.hasMath, false);
  assert.equal(note.hasMermaid, false);
  assert.deepEqual(note.links, []);
  assert.deepEqual(note.brokenLinks, []);
  assert.deepEqual(note.backlinks, []);
  assert.equal(note.toc[0].id, 'sec-1');
});
