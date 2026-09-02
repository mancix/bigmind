/**
 * Wiki-link helpers shared by every editor surface (web + mobile), link
 * indexers, backlink utilities, search, and the future graph view.
 */

/**
 * Code regions (fenced blocks + inline spans) where `[[...]]` must be treated
 * as literal text. Returns a boolean mask aligned with `markdown`.
 *
 * Editors escape wiki links as `\[[...]\]`; code fences use ``` ```.
 */
function computeCodeMask(markdown: string): boolean[] {
  const mask = new Array<boolean>(markdown.length).fill(false);
  const lines = markdown.split('\n');
  let offset = 0;
  let inFence: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (inFence) {
      if (trimmed.startsWith(inFence)) {
        inFence = null;
      } else {
        for (let i = 0; i < line.length; i += 1) mask[offset + i] = true;
      }
    } else if (trimmed.startsWith('```')) {
      // Fence marker: the leading backtick run (` ```` `, ```` ``` ` ```, …).
      inFence = trimmed.match(/^(`+)/)?.[1] ?? '```';
      // Opening fence line itself is code too.
      for (let i = 0; i < line.length; i += 1) mask[offset + i] = true;
    } else {
      // Inline code spans: `...` (runs of backticks).
      let i = 0;
      while (i < line.length) {
        if (line[i] === '`') {
          const runStart = i;
          while (i < line.length && line[i] === '`') i += 1;
          const ticks = i - runStart;
          const end = line.indexOf('`'.repeat(ticks), i);
          if (end === -1) {
            for (let j = runStart; j < line.length; j += 1) {
              mask[offset + j] = true;
            }
            i = line.length;
            break;
          }
          for (
            let j = runStart;
            j <= end + ticks - 1 && j < line.length;
            j += 1
          ) {
            mask[offset + j] = true;
          }
          i = end + ticks;
        } else {
          i += 1;
        }
      }
    }
    offset += line.length + 1; // +1 for the '\n'
  }

  // Guard against trailing-newline overflow.
  for (let i = offset; i < mask.length; i += 1) mask[i] = false;
  return mask;
}

/**
 * A single `[[…]]` occurrence, with the position information needed by
 * backlink indexers, search snippets, the graph view, and editors.
 */
export interface WikiLinkReference {
  /** Title as authored (text before any `|` label), trimmed. */
  title: string;
  /** Text after `|`, when present (e.g. `[[Note|label]]` → `label`). */
  label?: string;
  /** {@link normalizeWikiLinkName} of {@link WikiLinkReference.title}. */
  normalizedTitle: string;
  /** Exact source text (`[[title]]`, `[[title|label]]`, possibly `\`-escaped). */
  raw: string;
  /** Character offset of the opening `[` (escapes excluded). */
  start: number;
  /** Character offset just past the closing `]` (escapes excluded). */
  end: number;
  /** 1-based line of the opening `[`. */
  line: number;
  /** 1-based column of the opening `[`. */
  column: number;
}

const WIKI_LINK_PATTERN =
  /\\?\[\\?\[([^[\]\n]+?)(?:\|([^[\]\n]+?))?\\?\]\\?\]/g;

/** 1-based line/column for a character offset. */
function positionAt(
  markdown: string,
  offset: number,
): { line: number; column: number } {
  const before = markdown.slice(0, offset);
  const lineBreak = before.lastIndexOf('\n');
  return {
    line: (before.match(/\n/g)?.length ?? 0) + 1,
    column: offset - lineBreak,
  };
}

/**
 * Finds every wiki-link reference in a document, in source order.
 *
 * Skips fenced code blocks and inline code spans (a `[[title]]` pasted in a
 * code sample is literal text, not a link). Handles editor-escaped brackets
 * (`\[[Rust]\]`), the `|label` form of `[[Title|Label]]`, and malformed
 * syntax (empty titles, unbalanced brackets) by ignoring it.
 */
export function findWikiLinkReferences(markdown: string): WikiLinkReference[] {
  const references: WikiLinkReference[] = [];
  const code = computeCodeMask(markdown);
  WIKI_LINK_PATTERN.lastIndex = 0;

  for (const match of markdown.matchAll(WIKI_LINK_PATTERN)) {
    const start = match.index ?? 0;
    if (code[start]) continue;
    const title = match[1]?.trim() ?? '';
    if (!title || title === '|') continue;
    const raw = match[0];
    const end = start + raw.length;
    const { line, column } = positionAt(markdown, start);
    references.push({
      title,
      label: match[2]?.trim() || undefined,
      normalizedTitle: normalizeWikiLinkName(title),
      raw,
      start,
      end,
      line,
      column,
    });
  }

  return references;
}

/** Canonical, case-insensitive wiki-link name (moved from `@bigmind/domain/links`). */
export function normalizeWikiLinkName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/**
 * Unique wiki-link titles extracted from markdown, in first-appearance order.
 *
 * Built on {@link findWikiLinkReferences}, so wiki links in code blocks are
 * (correctly) ignored. Labels are dropped: `[[Note|Label]]` counts as `Note`.
 */
export function extractWikiLinks(markdown: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  for (const reference of findWikiLinkReferences(markdown)) {
    if (seen.has(reference.normalizedTitle)) continue;
    seen.add(reference.normalizedTitle);
    links.push(reference.title);
  }

  return links;
}

/**
 * Normalizes every wiki link in a document: un-escapes `\[[Title]\]` that
 * editors (web Crepe, native format bar) may leave behind, so the stored
 * source of truth always has clean `[[Title]]`. Code regions are untouched.
 */
export function normalizeWikiLinks(markdown: string): string {
  const code = computeCodeMask(markdown);
  const UNESCAPE = /\\?\[\\?\[([^\]\n]*?)\\?\]\\?\]/g;

  let result = '';
  let last = 0;
  for (const match of markdown.matchAll(UNESCAPE)) {
    const start = match.index;
    if (start == null) break;
    if (code[start]) continue;
    result += markdown.slice(last, start) + `[[${match[1]}]]`;
    last = start + match[0].length;
  }
  result += markdown.slice(last);
  return result;
}

/**
 * @deprecated Use {@link normalizeWikiLinks} (identical behavior, plural
 * naming matches the rest of the wiki-link API).
 */
export const normalizeWikiLinkMarkdown = normalizeWikiLinks;

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
