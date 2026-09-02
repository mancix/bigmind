/**
 * Plain-text extraction and tokenization — the shared primitives behind note
 * previews, search indexing, and (future) AI features.
 *
 * Everything here is pure string processing: no parser state, no DOM, no
 * platform APIs. The web search index and the mobile preview both consume
 * these helpers so the "readable text" of a note is identical everywhere.
 */

/** Strips HTML comments (web-pasted content often carries them). */
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
/** Strips any remaining HTML tags (e.g. `<br>`, `<strong>`). */
const HTML_TAG_PATTERN = /<[^>]+>/g;
/** Keeps the alt text of images: `![alt](url)` → `alt`. */
const IMAGE_PATTERN = /!\[([^\]]*)\]\([^)]+\)/g;
/** Keeps the visible label of links: `[label](url)` → `label`. */
const LINK_PATTERN = /\[([^\]]+)\]\([^)]+\)/g;
/**
 * Removes Markdown formatting characters. `|` is included so table pipes
 * (`| a | b |`) and wiki-link labels (`[[Note|label]]`) collapse to plain
 *, readable text.
 */
const FORMATTING_PATTERN = /[#>*_`~[\]|-]/g;
/** Collapses runs of whitespace (newlines, tabs) into a single space. */
const WHITESPACE_PATTERN = /\s+/g;

/**
 * Extracts the plain, human-readable text of a Markdown document.
 *
 * "Remove formatting, preserve readability": headings/emphasis/code markers,
 * links (kept as their label), images (kept as their alt text) and raw HTML
 * are stripped, and whitespace is collapsed. Wiki links are preserved as
 * their title text (`[[My Note]]` → `My Note`).
 *
 * @returns trimmed plain text — the empty string when the input carried no
 * readable content (callers may choose a fallback, e.g. {@link preview.ts}).
 */
export function extractPlainText(markdown: string): string {
  return markdown
    .replace(HTML_COMMENT_PATTERN, ' ')
    .replace(HTML_TAG_PATTERN, ' ')
    .replace(IMAGE_PATTERN, '$1')
    .replace(LINK_PATTERN, '$1')
    .replace(FORMATTING_PATTERN, ' ')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim();
}

/**
 * Word separator used by {@link tokenize}: anything that is not a letter,
 * number, `_` or `-` (so `snake_case` and `kebab-case` stay single tokens;
 * punctuation and whitespace split words). Any script is supported.
 */
const WORD_SPLIT_PATTERN = /[^\p{L}\p{N}_-]+/gu;

/** Case-folds a single token for indexing/querying. */
export function normalizeToken(token: string): string {
  return token.toLocaleLowerCase();
}

/**
 * Splits text into lowercase word tokens.
 *
 * Used by search preparation (see {@link search.ts}) and the future search
 * index. Punctuation and whitespace separate tokens; `_`/`-` are treated as
 * word characters, and words of any script (Latin, Cyrillic, CJK, …) are
 * recognized.
 *
 * @example tokenize('Hello, [[My Note]]!') // ['hello', 'my', 'note']
 */
export function tokenize(text: string): string[] {
  return text
    .split(WORD_SPLIT_PATTERN)
    .map(normalizeToken)
    .filter((token) => token.length > 0);
}

/** Unique tokens in a text, in order of first appearance. */
export function uniqueTokens(text: string): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const token of tokenize(text)) {
    if (!seen.has(token)) {
      seen.add(token);
      unique.push(token);
    }
  }
  return unique;
}
