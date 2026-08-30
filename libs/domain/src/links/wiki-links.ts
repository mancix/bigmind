import type { NoteAlias } from './note-link.js';
import { normalizeWikiLinkName } from '@bigmind/markdown';

// Canonical implementations now live in `@bigmind/markdown` (single source
// shared by web and mobile); these re-exports keep the domain API stable.
export { extractWikiLinks, normalizeWikiLinkName } from '@bigmind/markdown';

/**
 * Resolves a wiki-link name to a note by current title, then by alias.
 * Link *resolution* stays in the domain (it reasons about notes/aliases);
 * the markdown-level extraction lives in `@bigmind/markdown`.
 */
export function resolveWikiLinkTarget<
  TNote extends {
    id: string;
    title: string;
    deletedAt?: string;
  },
>(
  wikiLinkName: string,
  notes: readonly TNote[],
  aliases: readonly Pick<NoteAlias, 'noteId' | 'alias'>[],
): TNote | undefined {
  const normalized = normalizeWikiLinkName(wikiLinkName);
  const activeNotes = notes.filter((note) => !note.deletedAt);
  const currentTitle = activeNotes.find(
    (note) => normalizeWikiLinkName(note.title) === normalized,
  );

  if (currentTitle) return currentTitle;

  const alias = aliases.find(
    (candidate) => normalizeWikiLinkName(candidate.alias) === normalized,
  );

  return alias
    ? activeNotes.find((note) => note.id === alias.noteId)
    : undefined;
}
