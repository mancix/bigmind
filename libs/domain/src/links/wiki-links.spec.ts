import { describe, expect, it } from 'vitest';

import {
  extractWikiLinks,
  resolveWikiLinkTarget,
} from './wiki-links.js';

describe('wiki links', () => {
  it('extracts ordered unique canonical titles', () => {
    expect(extractWikiLinks(`
[[Rust]]
[[Ownership]]
[[Rust]]
[[Rust Programming]]
[[Borrowing|Displayed Text]]
`)).toEqual(['Rust', 'Ownership', 'Rust Programming', 'Borrowing']);
  });

  it('ignores malformed and empty syntax', () => {
    expect(extractWikiLinks('[[]] [[Open] [[Nested [[link]]]] [[ |Label]]'))
      .toEqual(['link']);
  });

  it('accepts brackets escaped by Markdown editors', () => {
    expect(extractWikiLinks(String.raw`\[\[Rust\]\] and [[Ownership]]`))
      .toEqual(['Rust', 'Ownership']);
  });

  it('resolves current titles before old aliases', () => {
    const notes = [
      { id: 'new', title: 'Rust', deletedAt: undefined },
      { id: 'renamed', title: 'Rust Programming', deletedAt: undefined },
    ];
    const aliases = [{ noteId: 'renamed', alias: 'Rust' }];

    expect(resolveWikiLinkTarget('rust', notes, aliases)?.id).toBe('new');
    expect(resolveWikiLinkTarget('Rust Programming', notes, aliases)?.id)
      .toBe('renamed');
  });

  it('resolves aliases and ignores deleted notes', () => {
    const notes = [
      { id: 'rust', title: 'Rust Programming', deletedAt: undefined },
      { id: 'old', title: 'Ownership', deletedAt: '2026-01-01T00:00:00.000Z' },
    ];
    const aliases = [
      { noteId: 'rust', alias: 'Rust' },
      { noteId: 'old', alias: 'Old ownership' },
    ];

    expect(resolveWikiLinkTarget('Rust', notes, aliases)?.id).toBe('rust');
    expect(resolveWikiLinkTarget('Old ownership', notes, aliases)).toBeUndefined();
  });
});
