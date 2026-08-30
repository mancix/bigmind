import { describe, expect, it } from 'vitest';

import { renderMarkdown } from './render-markdown.js';
import { createNotePreview, EMPTY_NOTE_PREVIEW } from './preview.js';
import { extractWikiLinks, normalizeWikiLinkName } from './wiki.js';
import { parseMarkdown } from './parse.js';

/**
 * Parity snapshots: the exact outputs of the legacy web renderer
 * (`apps/web/src/features/categories/render-markdown.ts`) captured before the
 * move. They lock the shared implementation against future divergence.
 */
const BASELINE: Record<string, string> = {
  inline:
    '<p>Hello <strong>bold</strong> and <em>it</em> <code>code</code> and <a href="https://x.test" class="external-link">link</a> &amp; <a href="#" class="wiki-link" data-note-title="Wiki">[[Wiki]]</a></p>',
  headings: '<p><h1>H1</h1>\n<h2>H2</h2>\n<h3>H3</h3></p>',
  lists:
    '<p><ul><li>one</li>\n<li>two</li>\n<li>alpha</li>\n<li>beta</li></ul></p>',
  table:
    '<p><tr><td>a</td><td>b</td></tr>\n\n<tr><td>1</td><td>2</td></tr></p>',
  code: '<p>Before\n<pre><code>const a = 1;</code></pre>\nAfter</p>',
  empty: '<p>\u00A0</p>\n<p>\n</p>\n<p>\n</p>\n<p>\u00A0</p>',
  quote: '<p>&gt; quoted</p>',
};

describe('renderMarkdown (canonical web renderer)', () => {
  it('matches the legacy web output byte-for-byte (snapshot)', () => {
    const fixtures: Record<string, string> = {
      inline:
        'Hello **bold** and *it* `code` and [link](https://x.test) & [[Wiki]]',
      headings: '# H1\n## H2\n### H3',
      lists: '- one\n- two\n1. alpha\n2. beta',
      table: '| a | b |\n|---|---|\n| 1 | 2 |',
      code: 'Before\n```\nconst a = 1;\n```\nAfter',
      empty: '\n\n',
      quote: '> quoted',
    };
    for (const [key, input] of Object.entries(fixtures)) {
      expect(renderMarkdown(input), key).toBe(BASELINE[key]);
    }
  });

  it('keeps empty paragraphs visible (nbsp behavior)', () => {
    expect(renderMarkdown('One\n\nTwo')).toBe('<p>One\n</p>\n<p>\nTwo</p>');
  });
});

describe('note preview generation (shared)', () => {
  const fixtures: Array<[string, string]> = [
    [
      '# Title\n\nSome **bold** text with [[wiki]]',
      'Title Some bold text with wiki',
    ],
    ['Plain', 'Plain'],
    ['', EMPTY_NOTE_PREVIEW],
    ['  \n\n  ', EMPTY_NOTE_PREVIEW],
  ];

  it('produces identical plain-text previews', () => {
    for (const [markdown, expected] of fixtures) {
      expect(createNotePreview(markdown)).toBe(expected);
    }
  });

  it('truncates with an ellipsis within maxLength', () => {
    const long = createNotePreview('abcdefghij', 6);
    expect(long).toBe('abcde…');
    expect(createNotePreview('ab', 1)).toBe('…');
    expect(createNotePreview('x', 0)).toBe('');
  });

  it('is consistent with the shared tokenizer', () => {
    const markdown = 'Hello **world** and [[Wiki]]';
    const blocks = parseMarkdown(markdown);
    expect(blocks).not.toHaveLength(0);
    expect(createNotePreview(markdown)).toBe('Hello world and Wiki');
  });
});

describe('wiki-link extraction & normalization (sourced in @bigmind/markdown)', () => {
  it('extracts unique wiki links and normalizes names', () => {
    expect(
      extractWikiLinks('See [[Alpha]] and [[Alpha]] and [[Beta|Label]]'),
    ).toEqual(['Alpha', 'Beta']);
    expect(normalizeWikiLinkName('  Hello World  ')).toBe('hello world');
  });
});
