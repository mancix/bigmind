import { describe, expect, it } from 'vitest';

import {
  BacklinkIndex,
  extractBacklinks,
  findBacklinksForTitle,
  type BacklinkNote,
} from './backlinks.js';

const notes: BacklinkNote[] = [
  {
    id: 'n1',
    title: 'Rust',
    content: '# Rust\n\nOwnership notes.',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'n2',
    title: 'Ownership',
    content: 'See [[Rust]] and [[Lifetime]].',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'n3',
    title: 'Lifetime',
    content: 'Related: [[rust]] and again [[Rust|docs]].',
    updatedAt: '2026-01-03T00:00:00.000Z',
  },
  { id: 'n4', title: 'Unlinked', content: 'No wiki links here.' },
];

describe('extractBacklinks', () => {
  it('extracts outgoing references of a note', () => {
    const refs = extractBacklinks(notes[2]);
    expect(refs.map((r) => r.normalizedTitle)).toEqual(['rust', 'rust']);
  });
});

describe('BacklinkIndex.fromNotes', () => {
  const index = BacklinkIndex.fromNotes(notes);

  it('indexes case-insensitively via normalized titles', () => {
    const sources = index.sourcesForTitle('Rust');
    expect(sources.length).toBe(2);
    expect(sources.map((s) => s.sourceNoteId)).toEqual(['n3', 'n2']);
  });

  it('sorts backlinks by recency then id', () => {
    const sources = index.sourcesForTitle('rust');
    expect(sources[0].sourceNoteId).toBe('n3');
    expect(sources[1].sourceNoteId).toBe('n2');
  });

  it('aggregates multiple references per source', () => {
    const rust = index
      .sourcesForTitle('Rust')
      .find((s) => s.sourceNoteId === 'n3');
    expect(rust?.count).toBe(2);
    expect(rust?.references.map((r) => r.raw)).toEqual([
      '[[rust]]',
      '[[Rust|docs]]',
    ]);
  });

  it('exposes outgoing references per note', () => {
    expect(index.referencesFrom('n2').map((r) => r.title)).toEqual([
      'Rust',
      'Lifetime',
    ]);
    expect(index.referencesFrom('n4')).toEqual([]);
  });

  it('exposes targets and counts', () => {
    expect(new Set(index.targets())).toEqual(new Set(['rust', 'lifetime']));
    expect(index.targetCount).toBe(2);
    expect(index.sourceCount).toBe(2);
  });

  it('returns empty for an unknown title', () => {
    expect(index.sourcesForTitle('Missing')).toEqual([]);
  });
});

describe('BacklinkIndex updates', () => {
  it('adds, rebuilds, and removes notes immutably', () => {
    const base = BacklinkIndex.empty();
    const withNote = base.addNote(notes[1]);
    expect(base.sourcesForTitle('Rust')).toEqual([]);
    expect(withNote.sourcesForTitle('rust')).toHaveLength(1);

    // Rebuild with changed content (content edit).
    const edited: BacklinkNote = { ...notes[1], content: 'No links anymore.' };
    const rebuilt = withNote.rebuild(edited);
    expect(rebuilt.sourcesForTitle('rust')).toEqual([]);

    // Update back again, then remove.
    const updated = rebuilt.addNote(notes[1]);
    expect(updated.sourcesForTitle('rust')).toHaveLength(1);
    const removed = updated.removeNote('n2');
    expect(removed.sourcesForTitle('rust')).toEqual([]);
    expect(removed.sourceCount).toBe(0);
  });

  it('is consistent after incremental updates (index parity)', () => {
    const fromScratch = BacklinkIndex.fromNotes(notes);
    let incremental = BacklinkIndex.empty();
    for (const note of notes) incremental = incremental.addNote(note);
    expect([...incremental.targets()].sort()).toEqual(
      [...fromScratch.targets()].sort(),
    );
    expect(incremental.sourcesForTitle('rust')).toEqual(
      fromScratch.sourcesForTitle('rust'),
    );
  });
});

describe('findBacklinksForTitle', () => {
  it('builds an index and returns sources in one call', () => {
    const sources = findBacklinksForTitle(notes, 'Lifetime');
    expect(sources.map((s) => s.sourceNoteId)).toEqual(['n2']);
  });
});
