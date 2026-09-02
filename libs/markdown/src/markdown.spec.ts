import { describe, expect, it } from 'vitest';

import { parseMarkdown } from './parse.js';
import {
  findWikiLinkTrigger,
  insertWikiLink,
  normalizeWikiLinkMarkdown,
} from './wiki.js';
import { rankTitles } from './ranking.js';
import { insertLink, toggleHeading, toggleInline } from './format.js';

describe('parseMarkdown', () => {
  it('parses headings, paragraphs and inline formatting', () => {
    const blocks = parseMarkdown('# Title\n\nSome **bold** and *italic* text.');
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 });
    expect(blocks[1]).toMatchObject({
      type: 'paragraph',
      content: [
        { type: 'text', value: 'Some ' },
        { type: 'bold', content: [{ type: 'text', value: 'bold' }] },
        { type: 'text', value: ' and ' },
        { type: 'italic', content: [{ type: 'text', value: 'italic' }] },
        { type: 'text', value: ' text.' },
      ],
    });
  });

  it('parses wiki links, links and inline code', () => {
    const blocks = parseMarkdown(
      'See [[Note title|Label]] and [site](https://x.test) `code`',
    );
    const content = blocks[0];
    expect(content).toMatchObject({
      type: 'paragraph',
      content: [
        { type: 'text', value: 'See ' },
        { type: 'wiki', title: 'Note title', label: 'Label' },
        { type: 'text', value: ' and ' },
        { type: 'link', url: 'https://x.test' },
        { type: 'text', value: ' ' },
        { type: 'code', value: 'code' },
      ],
    });
  });

  it('parses code fences, quotes, hr, and lists', () => {
    const blocks = parseMarkdown(
      '```ts\nconst a = 1;\n```\n\n> quote line\n\n---\n\n- one\n- two\n\n1. first\n2. second',
    );
    expect(blocks[0]).toMatchObject({
      type: 'code',
      language: 'ts',
      content: 'const a = 1;',
    });
    expect(blocks[1]).toMatchObject({ type: 'blockquote' });
    expect(blocks[2]).toMatchObject({ type: 'hr' });
    expect(blocks[3]).toMatchObject({
      type: 'list',
      ordered: false,
      items: [expect.anything(), expect.anything()],
    });
    expect(blocks[4]).toMatchObject({ type: 'list', ordered: true });
    // Plain list items carry checked: null.
    expect(blocks[3].type === 'list' && blocks[3].items).toEqual([
      { checked: null, content: [{ type: 'text', value: 'one' }] },
      { checked: null, content: [{ type: 'text', value: 'two' }] },
    ]);
  });

  it('parses gf-style checklists with checked state', () => {
    const blocks = parseMarkdown('- [ ] open task\n- [x] done task\n- [X] also done\n- plain item');
    expect(blocks[0]).toMatchObject({ type: 'list', ordered: false });
    expect(blocks[0].type === 'list' && blocks[0].items).toEqual([
      { checked: false, content: [{ type: 'text', value: 'open task' }] },
      { checked: true, content: [{ type: 'text', value: 'done task' }] },
      { checked: true, content: [{ type: 'text', value: 'also done' }] },
      { checked: null, content: [{ type: 'text', value: 'plain item' }] },
    ]);
  });

  it('keeps checklist inline formatting inside item content', () => {
    const blocks = parseMarkdown('- [ ] **bold** task with [[Wiki]]');
    expect(blocks[0].type === 'list' && blocks[0].items[0]).toMatchObject({
      checked: false,
      content: [
        { type: 'bold', content: [{ type: 'text', value: 'bold' }] },
        { type: 'text', value: ' task with ' },
        { type: 'wiki', title: 'Wiki' },
      ],
    });
  });

  it('parses tables', () => {
    const blocks = parseMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(blocks[0]).toMatchObject({
      type: 'table',
      header: ['A', 'B'],
      rows: [['1', '2']],
    });
  });
});

describe('wiki helpers', () => {
  it('normalizes escaped wiki links', () => {
    expect(normalizeWikiLinkMarkdown('\\[\\[Title\\]\\]')).toBe('[[Title]]');
    expect(normalizeWikiLinkMarkdown('plain [[ok]] text')).toBe(
      'plain [[ok]] text',
    );
  });

  it('finds an in-progress [[ trigger', () => {
    expect(findWikiLinkTrigger('write a [[wik')).toEqual({
      query: 'wik',
      start: 8,
      end: 13,
    });
    expect(findWikiLinkTrigger('no trigger here')).toBeNull();
  });

  it('inserts a selected wiki link into the source text', () => {
    const trigger = findWikiLinkTrigger('see [[wik')!;
    expect(insertWikiLink('see [[wik', trigger, 'Wiki Note')).toBe(
      'see [[Wiki Note]]',
    );
  });
});

describe('rankTitles', () => {
  it('ranks exact starts first, then substring, then fuzzy', () => {
    const candidates = [
      { title: 'Zebra wiki' },
      { title: 'Wiki note' },
      { title: 'My Wick' },
      { title: 'aaaa' },
    ];
    const ranked = rankTitles(candidates, 'wik').map((c) => c.title);
    expect(ranked[0]).toBe('Wiki note');
    expect(ranked[1]).toBe('Zebra wiki');
  });
});
describe('format transforms (toolbar)', () => {
  it('wraps and unwraps bold, italic and code', () => {
    const bold = toggleInline('hello world', 0, 5, 'bold');
    expect(bold.text).toBe('**hello** world');
    const unwrap = toggleInline(bold.text, 0, 9, 'bold');
    expect(unwrap.text).toBe('hello world');

    const italic = toggleInline('abc', 1, 2, 'italic');
    expect(italic.text).toBe('a*b*c');
    expect(italic.start).toBe(2);

    const code = toggleInline('x = 1', 0, 5, 'code');
    expect(code.text).toBe('`x = 1`');
  });

  it('inserts a bold template with the caret inside when nothing is selected', () => {
    const result = toggleInline('abcd', 1, 1, 'bold');
    expect(result.text).toBe('a****bcd');
    expect(result.start).toBe(3);
    expect(result.end).toBe(3);
  });

  it('toggles a heading prefix on the caret line', () => {
    const result = toggleInline.bind(null);
    void result;
    const heading = toggleHeading('intro\nline two', 6, 6);
    expect(heading.text).toBe('intro\n## line two');
    const unheading = toggleHeading(heading.text, 8, 8);
    expect(unheading.text).toBe('intro\nline two');
  });

  it('inserts a link snippet with the caret in the url', () => {
    const result = insertLink('see ', 4, 4);
    expect(result.text).toBe('see [link](https://)');
    expect(result.start).toBe(result.text.length - 1);
  });
});
