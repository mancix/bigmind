import type { NoteAlias } from './note-link.js';

const WIKI_LINK_PATTERN = /\\?\[\\?\[([^[\]\n]+?)\\?\]\\?\]/g;

export function normalizeWikiLinkName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function extractWikiLinks(markdown: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  for (const match of markdown.matchAll(WIKI_LINK_PATTERN)) {
    const canonicalTitle = match[1]?.split('|', 1)[0]?.trim();
    if (!canonicalTitle) continue;

    const normalized = normalizeWikiLinkName(canonicalTitle);
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    links.push(canonicalTitle);
  }

  return links;
}

export function resolveWikiLinkTarget<TNote extends {
  id: string;
  title: string;
  deletedAt?: string;
}>(
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
