/**
 * Backlink extraction, indexing, and updates.
 *
 * Pure, platform-independent utilities that turn note contents into a
 * backlink index. Repositories (link rebuilds), search (which notes reference
 * a queried topic), and the future graph view (edges between notes) consume
 * this same index, so they can never disagree about what links where.
 *
 * Semantics: a note A has a **backlink** to note B when A's Markdown content
 * contains `[[B]]`. Titles are canonicalized with `normalizeWikiLinkName`
 * (trim + case-fold), matching link resolution in `@bigmind/domain`.
 */

import type { WikiLinkReference } from './wiki.js';
import { findWikiLinkReferences, normalizeWikiLinkName } from './wiki.js';

/** Minimal note shape the indexer needs — storage-agnostic. */
export interface BacklinkNote {
  id: string;
  /** Authored title (used for display, not matching). */
  title: string;
  content: string;
  updatedAt?: string;
}

/**
 * One note that references a given target title, plus every occurrence.
 * The `references` array is in source order and carries positions, so
 * consumers can build snippets ("…around `[[B]]`…"), jump-to-position links,
 * or graph edges without re-parsing.
 */
export interface BacklinkSource {
  sourceNoteId: string;
  sourceTitle: string;
  references: WikiLinkReference[];
  /** `references.length` — convenience for sorting by strength. */
  count: number;
  updatedAt?: string;
}

/** A note's outgoing references, keyed by its id. */
export interface NoteOutgoingLinks {
  noteId: string;
  references: WikiLinkReference[];
}

/** Internal storage: normalized target title → sources. */
type EntryMap = ReadonlyMap<string, readonly BacklinkSource[]>;
type BySource = ReadonlyMap<string, NoteOutgoingLinks>;

/**
 * Immutable backlink index.
 *
 * All mutating operations return a NEW index (structural sharing is trivial;
 * maps are rebuilt per update). This keeps repository/reducer flows simple:
 * `index.update(note)` then commit the returned index — no hidden state.
 */
export class BacklinkIndex {
  private constructor(
    private readonly byTarget: EntryMap,
    private readonly bySource: BySource,
  ) {}

  /** Empty index. */
  static empty(): BacklinkIndex {
    return new BacklinkIndex(new Map(), new Map());
  }

  /** Builds an index over many notes in one pass (O(total content length)). */
  static fromNotes(notes: readonly BacklinkNote[]): BacklinkIndex {
    const byTarget = new Map<string, BacklinkSource[]>();
    const bySource = new Map<string, NoteOutgoingLinks>();

    for (const note of notes) {
      const references = findWikiLinkReferences(note.content);
      if (references.length === 0) continue;
      bySource.set(note.id, { noteId: note.id, references });
      for (const reference of references) {
        appendSource(byTarget, reference.normalizedTitle, note, reference);
      }
    }

    return new BacklinkIndex(byTarget, bySource);
  }

  /** Indexes one note (replaces any previous entry for the same id). */
  addNote(note: BacklinkNote): BacklinkIndex {
    return this.removeNote(note.id).addNoteUnchecked(note);
  }

  /** Removes a note's references from the index. No-op when absent. */
  removeNote(noteId: string): BacklinkIndex {
    const outgoing = this.bySource.get(noteId);
    if (!outgoing) return this;

    const byTarget = new Map<string, BacklinkSource[]>();
    for (const [title, sources] of this.byTarget) {
      const remaining = sources.filter(
        (source) => source.sourceNoteId !== noteId,
      );
      if (remaining.length > 0) byTarget.set(title, remaining);
    }
    const bySource = new Map(this.bySource);
    bySource.delete(noteId);
    return new BacklinkIndex(byTarget, bySource);
  }

  /** Re-builds a note's entry from scratch (used on content changes). */
  rebuild(note: BacklinkNote): BacklinkIndex {
    return this.addNote(note);
  }

  /**
   * Backlink sources for a target title. Case-insensitive, trims whitespace.
   * Ordered by `updatedAt` (descending, when present) then source id.
   */
  sourcesForTitle(title: string): readonly BacklinkSource[] {
    const normalized = normalizeWikiLinkName(title);
    const sources = this.byTarget.get(normalized);
    if (!sources) return [];
    return [...sources].sort(
      (left, right) =>
        (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '') ||
        left.sourceNoteId.localeCompare(right.sourceNoteId),
    );
  }

  /** Every reference a given note points at (empty when note is not indexed). */
  referencesFrom(noteId: string): readonly WikiLinkReference[] {
    return this.bySource.get(noteId)?.references ?? [];
  }

  /** All normalized target titles currently referenced by any note. */
  targets(): readonly string[] {
    return [...this.byTarget.keys()];
  }

  /** Number of distinct target titles. */
  get targetCount(): number {
    return this.byTarget.size;
  }

  /** Number of notes that are currently indexed (have ≥1 reference). */
  get sourceCount(): number {
    return this.bySource.size;
  }

  private addNoteUnchecked(note: BacklinkNote): BacklinkIndex {
    const references = findWikiLinkReferences(note.content);
    if (references.length === 0) return this;

    const bySource = new Map(this.bySource);
    bySource.set(note.id, { noteId: note.id, references });

    const byTarget = new Map<string, BacklinkSource[]>();
    for (const [title, sources] of this.byTarget) {
      byTarget.set(
        title,
        sources.filter((source) => source.sourceNoteId !== note.id),
      );
    }
    for (const reference of references) {
      appendSource(byTarget, reference.normalizedTitle, note, reference);
    }

    return new BacklinkIndex(byTarget, bySource);
  }
}

function appendSource(
  byTarget: Map<string, BacklinkSource[]>,
  normalizedTitle: string,
  note: BacklinkNote,
  reference: WikiLinkReference,
): void {
  const existing = byTarget.get(normalizedTitle);
  if (existing) {
    const last = existing[existing.length - 1];
    if (last.sourceNoteId === note.id) {
      last.references.push(reference);
      last.count += 1;
      return;
    }
    existing.push(sourceEntry(note, reference));
  } else {
    byTarget.set(normalizedTitle, [sourceEntry(note, reference)]);
  }
}

function sourceEntry(
  note: BacklinkNote,
  reference: WikiLinkReference,
): BacklinkSource {
  return {
    sourceNoteId: note.id,
    sourceTitle: note.title,
    references: [reference],
    count: 1,
    ...(note.updatedAt !== undefined ? { updatedAt: note.updatedAt } : {}),
  };
}

/**
 * Extracts the outgoing wiki-link references of a single note — the raw
 * material behind {@link BacklinkIndex} and any custom link graph.
 */
export function extractBacklinks(note: BacklinkNote): WikiLinkReference[] {
  return findWikiLinkReferences(note.content);
}

/**
 * One-shot helper: build the index and return the backlinks for `title`.
 * Convenience for read-only consumers (e.g. a single-note backlink panel)
 * that do not maintain an index.
 */
export function findBacklinksForTitle(
  notes: readonly BacklinkNote[],
  title: string,
): readonly BacklinkSource[] {
  return BacklinkIndex.fromNotes(notes).sourcesForTitle(title);
}
