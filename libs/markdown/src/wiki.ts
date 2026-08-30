/**
 * Wiki-link helpers shared by every editor surface (web + mobile).
 */

const WIKI_LINK_PATTERN = /\\?\[\\?\[([^[\]\n]+?)\\?\]\\?\]/g;

/** Canonical, case-insensitive wiki-link name (moved from `@bigmind/domain/links`). */
export function normalizeWikiLinkName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/** Unique wiki-link titles extracted from markdown (moved from `@bigmind/domain/links`). */
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

/** Un-escapes `\[\[…\]\]` that editors may leave behind (web Crepe behavior). */
export function normalizeWikiLinkMarkdown(markdown: string): string {
  return markdown.replace(/\\?\[\\?\[([^\]\n]*?)\\?\]\\?\]/g, '[[$1]]');
}

/**
 * Detects an in-progress `[[` trigger at the end of a text chunk (used by
 * the mobile suggestion popup and — later — the web editor).
 */
export function findWikiLinkTrigger(text: string): {
  query: string;
  start: number;
  end: number;
} | null {
  const match = text.match(/\[\[([^[\]\n]*)$/);
  if (!match) return null;
  return {
    query: match[1] ?? '',
    start: text.length - match[0].length,
    end: text.length,
  };
}

/**
 * Replaces the `[[query` range in `content` with the selected wiki link.
 * Keeps the authored text as the source of truth: `[[Title]]` (no graph work).
 */
export function insertWikiLink(
  content: string,
  trigger: { start: number; end: number },
  title: string,
): string {
  return (
    content.slice(0, trigger.start) +
    `[[${title}]]` +
    content.slice(trigger.end)
  );
}
