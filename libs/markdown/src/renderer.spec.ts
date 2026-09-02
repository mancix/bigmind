import { describe, expect, it } from 'vitest';

import {
  createHtmlRenderer,
  escapeHtmlText,
  renderMarkdownHtml,
} from './renderer.js';
import { parseMarkdown } from './parse.js';

describe('escapeHtmlText', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtmlText('<div a="b">&</div>')).toBe(
      '&lt;div a=&quot;b&quot;&gt;&amp;&lt;/div&gt;',
    );
  });
});

describe('createHtmlRenderer', () => {
  const renderer = createHtmlRenderer();

  it('renders headings and paragraphs', () => {
    expect(renderer.render('# Title\n\nBody')).toBe(
      '<h1>Title</h1>\n<p>Body</p>',
    );
  });

  it('renders inline formatting and links', () => {
    const html = renderer.render('**bold** *it* `code` [x](https://x.test)');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain(
      '<a href="https://x.test" class="external-link">x</a>',
    );
  });

  it('renders wiki links as data-carrying anchors (or plain text)', () => {
    expect(renderer.render('[[Rust]]')).toBe(
      '<p><a href="#" class="wiki-link" data-note-title="Rust">Rust</a></p>',
    );
    expect(renderer.render('[[Rust|docs]]')).toContain(
      'data-note-title="Rust"',
    );
    expect(
      createHtmlRenderer({ renderWikiLinksAsAnchors: false }).render(
        '[[Rust]]',
      ),
    ).toBe('<p>[[Rust]]</p>');
  });

  it('renders checklists with state attributes', () => {
    const html = renderer.render('- [x] done\n- [ ] todo\n- plain');
    expect(html).toContain('class="task-list"');
    expect(html).toContain(
      '<li class="task-list-item" data-checked="true"><span class="task-list-checkbox" aria-hidden="true">☑</span>done</li>',
    );
    expect(html).toContain('data-checked="false"');
    expect(html).toContain('<li class="">plain</li>');
  });

  it('renders code blocks, blockquotes and hr', () => {
    const html = renderer.render('```ts\nconst a = 1;\n```\n\n> quote\n\n---');
    expect(html).toContain(
      '<pre><code class="language-ts">const a = 1;</code></pre>',
    );
    expect(html).toContain('<blockquote><p>quote</p></blockquote>');
    expect(html).toContain('<hr />');
  });

  it('renders tables', () => {
    const html = renderer.render('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<thead><tr><th>a</th><th>b</th></tr></thead>');
    expect(html).toContain('<tr><td>1</td><td>2</td></tr>');
  });

  it('escapes user content', () => {
    expect(renderer.render('<script>alert(1)</script>')).not.toContain(
      '<script>',
    );
    expect(renderer.render('**a < b**')).toContain('&lt;');
  });

  it('works from an already-parsed AST (renderer abstraction)', () => {
    const ast = parseMarkdown('# H\n\n- one');
    const html = renderer.renderBlocks(ast);
    expect(html).toBe(
      '<h1>H</h1>\n<ul class="">\n<li class="">one</li>\n</ul>',
    );
  });
});

describe('renderMarkdownHtml', () => {
  it('is a parse-and-render convenience', () => {
    expect(renderMarkdownHtml('# X')).toBe('<h1>X</h1>');
  });
});
