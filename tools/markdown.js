import { randomUUID } from 'node:crypto';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import mark from 'markdown-it-mark';
import footnote from 'markdown-it-footnote';
import deflist from 'markdown-it-deflist';
import taskLists from 'markdown-it-task-lists';
import { katex } from '@mdit/plugin-katex';
import sanitizeHtml from 'sanitize-html';
import { parseDocument, DomUtils } from 'htmlparser2';

const ALERTS = {
  note: 'NOTE / 备注', tip: 'TIP / 提示', important: 'IMPORTANT / 重要',
  warning: 'WARNING / 警告', caution: 'CAUTION / 注意'
};
const TAGS = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'a', 'img', 'figure', 'figcaption',
  'strong', 'em', 'b', 'i', 's', 'del', 'sub', 'sup', 'mark', 'small',
  'code', 'pre', 'kbd', 'samp', 'var', 'abbr', 'q', 'cite', 'time',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'div', 'span', 'section', 'details', 'summary', 'button', 'input', 'noscript'
];
const NON_TEXT_TAGS = ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'svg', 'math'];

function safeUrl(value, image = false) {
  if (!value || /[\u0000-\u0020\u007f\\]/u.test(value) || value.startsWith('//')) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    if (!image && /^mailto:/i.test(value)) return true;
    if (!/^https?:\/\//i.test(value)) return false;
    try { return Boolean(new URL(value).hostname); } catch { return false; }
  }
  return true;
}

function cleanAttributes(tagName, attributes) {
  const attribs = { ...attributes };
  for (const key of ['href', 'src']) {
    if (attribs[key] && !safeUrl(attribs[key], tagName === 'img')) delete attribs[key];
  }
  if (attribs.id && !/^(?:sec-\d+|fn(?:ref)?\d+(?::\d+)?)$/.test(attribs.id)) delete attribs.id;
  if (tagName === 'a') {
    if (/^https?:\/\//i.test(attribs.href || '')) {
      attribs.target = '_blank';
      attribs.rel = 'noopener noreferrer';
    } else {
      delete attribs.target;
      delete attribs.rel;
    }
  }
  if (tagName === 'input' && attribs.type === 'checkbox') attribs.disabled = '';
  if (tagName === 'button') attribs.type = 'button';
  return { tagName, attribs };
}

const POLICY = {
  allowedTags: TAGS,
  allowedAttributes: {
    '*': ['class', 'title', 'aria-hidden'],
    a: ['href', 'title', 'class', 'id', 'target', 'rel', 'data-lightbox', 'data-caption'],
    img: ['src', 'alt', 'title', 'loading', 'decoding'],
    div: ['class', 'data-lang'],
    button: ['class', 'type', 'data-copy'],
    input: ['class', 'type', 'checked', 'disabled'],
    details: ['open'], ol: ['start', 'class'], li: ['id', 'class', 'value'],
    th: ['scope', 'colspan', 'rowspan'], td: ['colspan', 'rowspan'],
    h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id']
  },
  allowedClasses: {
    '*': [
      'code-block', 'code-head', 'code-lang', 'code-copy', /^language-[\w+-]+$/,
      'diagram-block', 'diagram-head', 'diagram-dot', 'mermaid', 'wavedrom',
      'mindmap-embed', 'mindmap-embed__source', 'mindmap-embed__host',
      'callout', /^callout-(?:note|tip|important|warning|caution|label|body)$/,
      'md-figure', 'img-zoom', 'table-wrap', 'wiki-link', 'wiki-link--missing',
      'task-list-item', 'contains-task-list', 'task-list-item-checkbox',
      /^footnote(?:s|s-sep|s-list|-ref|-item|-backref)$/
    ]
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  nonTextTags: NON_TEXT_TAGS,
  parseStyleAttributes: false,
  transformTags: { '*': cleanAttributes },
  exclusiveFilter: (frame) => frame.tag === 'input' && frame.attribs.type !== 'checkbox'
};
// Author HTML cannot impersonate generated IDs, diagrams, copy controls or placeholders.
const RAW_POLICY = {
  ...POLICY,
  allowedTags: TAGS.filter((tag) => !['button', 'input', 'noscript'].includes(tag)),
  allowedAttributes: {
    '*': ['title'], a: ['href', 'title'], img: ['src', 'alt', 'title'],
    details: ['open'], ol: ['start'], li: ['value'],
    th: ['scope', 'colspan', 'rowspan'], td: ['colspan', 'rowspan']
  },
  allowedClasses: {}
};

function rawHtml(token) {
  if (token.type === 'html_block') return sanitizeHtml(token.content, RAW_POLICY);
  // Inline HTML tokens are individual tags. Keep paired closing tags rather than
  // letting a fragment sanitizer prematurely close every opening semantic tag.
  if (/^<\/[a-z][\w-]*\s*>$/i.test(token.content)) return token.content;
  return sanitizeHtml(token.content, RAW_POLICY).match(/^<[^>]+>/)?.[0] || '';
}

function noteResolver(catalog, slug) {
  const bySlug = new Map(catalog.map((note) => [note.slug, note]));
  const aliases = new Map();
  const add = (key, note) => {
    if (!aliases.has(key)) aliases.set(key, new Set());
    aliases.get(key).add(note);
  };
  for (const note of catalog) {
    const file = path.posix.normalize(note.file);
    for (const name of [file, file.replace(/^notes\//, ''), path.posix.basename(file)]) {
      add(name, note);
      add(name.replace(/\.md$/i, ''), note);
    }
  }
  const current = bySlug.get(slug);
  return (target, ordinary = false) => {
    let decoded;
    try { decoded = decodeURIComponent(target.trim()); } catch { return null; }
    const hash = decoded.indexOf('#');
    const name = hash < 0 ? decoded : decoded.slice(0, hash);
    const anchor = hash < 0 ? '' : decoded.slice(hash + 1);
    if (hash >= 0 && !/^[\p{L}\p{N}_][\p{L}\p{N}_.:-]*$/u.test(anchor)) return null;
    if (/[\\\u0000-\u001f\u007f]/u.test(name) || name.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(name)) return null;
    let note = !ordinary && bySlug.get(name);
    if (!name) note = current;
    if (!note) {
      const normalized = path.posix.normalize(name);
      const relative = path.posix.join(path.posix.dirname(current?.file || 'notes/source.md'), name);
      const keys = ordinary ? [name.startsWith('notes/') ? normalized : relative] : [normalized, relative];
      for (const key of keys) {
        const matches = aliases.get(key);
        if (matches?.size > 1) return null;
        if (matches?.size === 1) { note = [...matches][0]; break; }
      }
    }
    if (!note) return null;
    return { slug: note.slug, href: `note.html?slug=${encodeURIComponent(note.slug)}${anchor ? `#${encodeURIComponent(anchor)}` : ''}` };
  };
}

function inlineText(tokens = []) {
  return tokens.map((token) => {
    if (token.type === 'html_inline') return DomUtils.textContent(parseDocument(sanitizeHtml(token.content, RAW_POLICY)));
    if (token.type === 'softbreak' || token.type === 'hardbreak') return ' ';
    if (token.children) return inlineText(token.children);
    if (token.type === 'wiki_link') return token.meta.label;
    return token.nesting ? '' : token.content;
  }).join('');
}

function promoteImages(state) {
  const output = [];
  for (let i = 0; i < state.tokens.length; i++) {
    const open = state.tokens[i];
    const inline = state.tokens[i + 1];
    if (open.type !== 'paragraph_open' || inline?.type !== 'inline' || !inline.children?.some((token) => token.type === 'image')) {
      output.push(open);
      continue;
    }
    const close = state.tokens[i + 2];
    const stack = [];
    let fragment = [];
    const closing = (token) => new state.Token(token.type.replace(/_open$/, '_close'), token.tag, -1);
    const flush = () => {
      if (fragment.some((token) => token.nesting === 0 && token.content?.trim())) {
        const part = new state.Token('inline', '', 0);
        part.children = [...fragment, ...stack.toReversed().map(closing)];
        output.push(open, part, close);
      }
      fragment = [...stack];
    };
    for (const token of inline.children) {
      if (token.type === 'image') {
        flush();
        const figure = new state.Token('note_figure', 'figure', 0);
        const link = stack.findLast((item) => item.type === 'link_open');
        figure.meta = { image: token, href: link?.attrGet('href'), noteSlug: link?.meta?.noteSlug };
        output.push(figure);
      } else {
        fragment.push(token);
        if (token.nesting === 1) stack.push(token);
        if (token.nesting === -1) stack.pop();
      }
    }
    flush();
    i += 2;
  }
  state.tokens = output;
}

export function renderMarkdown(body, { catalog = [], slug = '' } = {}) {
  const md = new MarkdownIt({ html: true, breaks: false, linkify: false, typographer: false });
  const escape = md.utils.escapeHtml;
  const links = new Set();
  const brokenLinks = new Set();
  const resolve = noteResolver(catalog, slug);
  const math = [];
  const prefix = `MDMATH${randomUUID().replaceAll('-', '')}X`;
  let hasMermaid = false;
  let hasWaveDrom = false;

  md.use(sub).use(sup).use(mark).use(footnote).use(deflist)
    .use(taskLists, { enabled: false, label: false })
    .use(katex, {
      trust: false, throwOnError: false, output: 'htmlAndMathml',
      allowInlineWithSpace: false, maxExpand: 1000, maxSize: 20,
      logger: () => 'ignore'
    });
  // Keep the maintained plugin's delimiter parser and rendering options. Only
  // renderer output is vaulted; no original input can supply this random key.
  for (const type of ['math_inline', 'math_block']) {
    const renderer = md.renderer.rules[type];
    md.renderer.rules[type] = (tokens, index, options, env, self) => {
      const placeholder = `${prefix}${math.length}END`;
      math.push({ placeholder, html: renderer(tokens, index, options, env, self), text: tokens[index].content.trim() });
      return placeholder;
    };
  }

  md.inline.ruler.before('link', 'wiki_link', (state, silent) => {
    // Do not masquerade as a nested Markdown link during parseLinkLabel's probe.
    if (silent || state.linkLevel > 0 || !state.src.startsWith('[[', state.pos)) return false;
    const end = state.src.indexOf(']]', state.pos + 2);
    if (end < 0 || end >= state.posMax) return false;
    const content = state.src.slice(state.pos + 2, end);
    if (!content || /[\r\n]/.test(content)) return false;
    if (!silent) {
      const separator = content.indexOf('|');
      const target = (separator < 0 ? content : content.slice(0, separator)).trim();
      const label = separator < 0 ? target : content.slice(separator + 1).trim();
      const token = state.push('wiki_link', '', 0);
      token.meta = { target, label };
      token.content = label;
    }
    state.pos = end + 2;
    return true;
  });

  const missing = (target, label) => {
    brokenLinks.add(target);
    return `<span class="wiki-link--missing" title="${escape(`未找到或无法唯一解析笔记：${target}`)}">${escape(label)}</span>`;
  };
  md.renderer.rules.wiki_link = (tokens, index) => {
    const { target, label } = tokens[index].meta;
    const note = resolve(target);
    if (!note) return missing(target, label);
    links.add(note.slug);
    return `<a class="wiki-link" href="${escape(note.href)}">${escape(label)}</a>`;
  };
  md.renderer.rules.missing_link = (tokens, index) => {
    const { target, label } = tokens[index].meta;
    return missing(target, label);
  };
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    if (tokens[index].meta?.noteSlug) links.add(tokens[index].meta.noteSlug);
    return self.renderToken(tokens, index, options);
  };

  // This runs before task-lists inserts its own safe checkbox HTML.
  md.core.ruler.after('inline', 'note_inline', (state) => {
    for (const token of state.tokens) {
      if (token.type === 'html_block') token.content = rawHtml(token);
      if (!token.children) continue;
      let linkDepth = 0;
      for (let i = 0; i < token.children.length; i++) {
        const child = token.children[i];
        if (child.type === 'html_inline') child.content = rawHtml(child);
        if (child.type === 'link_open') {
          linkDepth++;
          const href = child.attrGet('href') || '';
          if (safeUrl(href) && !/^[a-z][a-z\d+.-]*:/i.test(href) && /\.md(?:#.*)?$/i.test(href)) {
            const note = resolve(href, true);
            if (note) {
              child.attrSet('href', note.href);
              child.attrJoin('class', 'wiki-link');
              child.meta = { ...child.meta, noteSlug: note.slug };
            } else {
              const end = token.children.findIndex((item, at) => at > i && item.type === 'link_close');
              const label = inlineText(token.children.slice(i + 1, end));
              child.type = 'missing_link';
              child.meta = { target: href, label };
              child.content = label;
              child.nesting = 0;
              token.children.splice(i + 1, end - i);
              linkDepth--;
            }
          }
        } else if (child.type === 'link_close') linkDepth--;
        if (child.type === 'math_inline' && linkDepth > 0) {
          child.type = 'text';
          child.content = `$${child.content}$`;
        }
      }
    }
  });

  md.core.ruler.push('note_blocks', (state) => {
    let heading = 0;
    const quotes = [];
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.type === 'heading_open') token.attrSet('id', `sec-${++heading}`);
      if (token.type === 'blockquote_open') {
        const paragraph = state.tokens[i + 1];
        const inline = state.tokens[i + 2];
        const first = inline?.children?.[0];
        const match = paragraph?.type === 'paragraph_open' && first?.type === 'text'
          && first.content.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]+|$)/i);
        const type = match ? match[1].toLowerCase() : null;
        quotes.push(type);
        if (type) {
          token.type = 'callout_open';
          token.meta = { type };
          first.content = first.content.slice(match[0].length);
          if (!first.content) {
            inline.children.shift();
            if (inline.children[0]?.type === 'softbreak') inline.children.shift();
          }
        }
      } else if (token.type === 'blockquote_close' && quotes.pop()) token.type = 'callout_close';
    }
    promoteImages(state);
  });

  md.renderer.rules.callout_open = (tokens, index) => {
    const type = tokens[index].meta.type;
    return `<div class="callout callout-${type}"><div class="callout-label">${ALERTS[type]}</div><div class="callout-body">\n`;
  };
  md.renderer.rules.callout_close = () => '</div></div>\n';
  md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';
  md.renderer.rules.note_figure = (tokens, index) => {
    const { image, href, noteSlug } = tokens[index].meta;
    if (noteSlug) links.add(noteSlug);
    const source = image.attrGet('src') || '';
    const alt = inlineText(image.children);
    const caption = image.attrGet('title') || alt;
    return `<figure class="md-figure"><a href="${escape(href || source)}" class="img-zoom" data-lightbox="note" data-caption="${escape(caption)}"><img src="${escape(source)}" alt="${escape(alt)}" loading="lazy" decoding="async"></a><figcaption>${escape(caption)}</figcaption></figure>\n`;
  };
  const code = (tokens, index) => {
    const token = tokens[index];
    const info = token.info.trim().split(/\s+/)[0];
    const language = /^[\w+-]+$/.test(info) ? info.toLowerCase() : 'text';
    const source = escape(token.content);
    if (language === 'mindmap') {
      return `<div class="mindmap-embed"><div class="diagram-head"><span>MINDMAP</span><span class="diagram-dot" aria-hidden="true"></span></div><pre class="mindmap-embed__source">${source}</pre><div class="mindmap-embed__host"></div></div>\n`;
    }
    let diagram = language === 'mermaid';
    if (language === 'wavedrom') {
      try {
        const value = JSON.parse(token.content);
        diagram = value !== null && typeof value === 'object' && !Array.isArray(value);
      } catch { diagram = false; }
    }
    if (diagram) {
      if (language === 'mermaid') hasMermaid = true;
      else hasWaveDrom = true;
      return `<div class="diagram-block"><div class="diagram-head"><span>${language.toUpperCase()}</span><span class="diagram-dot" aria-hidden="true"></span></div><div class="${language}">${source}</div><noscript><pre>${source}</pre></noscript></div>\n`;
    }
    return `<div class="code-block" data-lang="${language}"><div class="code-head"><span class="code-lang">${language}</span><button class="code-copy" type="button" data-copy>COPY</button></div><pre><code class="language-${language}">${source}</code></pre></div>\n`;
  };
  md.renderer.rules.fence = code;
  md.renderer.rules.code_block = code;

  const safe = sanitizeHtml(md.render(String(body)), POLICY);
  const restoreMath = (value, field) => math.reduce(
    (output, item) => output.replaceAll(item.placeholder, () => item[field]), value
  );
  const document = parseDocument(safe);
  const plain = (node) => restoreMath(DomUtils.textContent(node), 'text').replace(/\s+/g, ' ').trim();
  const toc = DomUtils.findAll(
    (node) => ['h2', 'h3'].includes(node.name) && /^sec-\d+$/.test(node.attribs.id || ''), document.children
  ).map((node) => ({ depth: Number(node.name[1]), id: node.attribs.id, text: plain(node) }));
  return {
    html: restoreMath(safe, 'html'), toc, text: plain(document),
    hasMath: math.length > 0, hasMermaid, hasWaveDrom,
    links: [...links], brokenLinks: [...brokenLinks]
  };
}

export function buildBacklinks(notes) {
  const bySlug = new Map(notes.map((note) => [note.slug, note]));
  for (const note of notes) note.backlinks = [];
  for (const source of notes) {
    for (const slug of new Set(source.links || [])) {
      const target = bySlug.get(slug);
      if (target && target !== source && !target.backlinks.some((item) => item.slug === source.slug)) {
        target.backlinks.push({ slug: source.slug, title: source.title });
      }
    }
  }
  return notes;
}
