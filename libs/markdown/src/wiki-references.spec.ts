import { describe, expect, it } from 'vitest';

import {
  extractWikiLinks,
  findWikiLinkReferences,
  normalizeWikiLinks,
  normalizeWikiLinkName,
} from './wiki.js';
import { parseMarkdown } from './parse.js';

describe('findWikiLinkReferences', () => {
  it('finds plain wiki links and reports positions', () => {
    const refs = findWikiLinkReferences(
      'See [[Project]] and [[My Note|alias]] here.',
    );
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({
      title: 'Project',
      normalizedTitle: 'project',
      raw: '[[Project]]',
      start: 4,
      end: 15,
      line: 1,
      column: 5,
      label: undefined,
    });
    expect(refs[1]).toMatchObject({
      title: 'My Note',
      label: 'alias',
      normalizedTitle: 'my note',
    });
  });

  it('supports the requested syntax families', () => {
    expect(
      findWikiLinkReferences('[[Project]] [[Shopping List]] [[My Note]]').map(
        (r) => r.title,
      ),
    ).toEqual(['Project', 'Shopping List', 'My Note']);
  });

  it('tracks line/column across newlines', () => {
    const refs = findWikiLinkReferences('# Heading\n\n[[Alpha]]');
    expect(refs[0]).toMatchObject({ line: 3, column: 1 });
  });

  it('handles editor-escaped brackets', () => {
    const refs = findWikiLinkReferences(String.raw`See \[\[Rust\]\] here`);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ title: 'Rust', start: 4 });
  });

  it('ignores wiki links inside fenced code blocks and inline code', () => {
    const markdown = [
      'Intro',
      '',
      '```md',
      '[[NotALink]]',
      '```',
      '',
      '`[[AlsoLiteral]]` and [[RealLink]]',
    ].join('\n');
    const refs = findWikiLinkReferences(markdown);
    expect(refs.map((r) => r.title)).toEqual(['RealLink']);
  });

  it('ignores malformed syntax', () => {
    expect(
      findWikiLinkReferences(
        '[[]] [[Open] [[Nested [[link]]]] [[ |Label]]',
      ).map((r) => r.title),
    ).toEqual(['link']);
  });
});

describe('extractWikiLinks', () => {
  it('deduplicates by normalized title, keeping first authored casing', () => {
    expect(
      extractWikiLinks('[[Alpha]] and [[alpha]] and [[Beta|B]] and [[Beta]]'),
    ).toEqual(['Alpha', 'Beta']);
  });

  it('skips links inside code blocks (unlike the legacy regex)', () => {
    expect(extractWikiLinks('```\n[[NotARef]]\n```\n\n[[RealRef]]')).toEqual([
      'RealRef',
    ]);
  });
});

describe('normalizeWikiLinks', () => {
  it('un-escapes editor-produced wiki links', () => {
    expect(normalizeWikiLinks(String.raw`\[\[Rust\]\] and [[Ownership]]`)).toBe(
      '[[Rust]] and [[Ownership]]',
    );
  });

  it('keeps labels intact', () => {
    expect(normalizeWikiLinks(String.raw`\[\[Rust|docs\]\]`)).toBe(
      '[[Rust|docs]]',
    );
  });

  it('does not touch code regions', () => {
    const input = '```\n\\[[literal]]\n```\n\n\\[[Real]]';
    expect(normalizeWikiLinks(input)).toBe(
      '```\n\\[[literal]]\n```\n\n[[Real]]',
    );
  });

  it('is consistent with the shared tokenizer', () => {
    const raw = String.raw`\[\[Note\]\]`;
    const normalized = normalizeWikiLinks(raw);
    const blocks = parseMarkdown(normalized);
    const wiki = blocks[0].type === 'paragraph' ? blocks[0].content[0] : null;
    expect(wiki).toMatchObject({ type: 'wiki', title: 'Note' });
  });
});

describe('normalizeWikiLinkName', () => {
  it('trims and case-folds', () => {
    expect(normalizeWikiLinkName('  My Note  ')).toBe('my note');
  });
});
