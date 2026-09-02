/**
 * Search preparation — pure utilities that turn Markdown into indexable text.
 *
 * Deliberately NO search engine logic: no scoring, no inverted index, no
 * query language. The web app's MiniSearch index and (future) native/full-text
 * indexes consume the prepared documents produced here, so every consumer
 * indexes exactly the same text.
 *
 * A prepared document keeps the plain text (for snippets/preview) and the
 * token stream (for matching) separate, so consumers can pick what they need.
 */

import { extractPlainText, tokenize, uniqueTokens } from './text.js';

/** A note as seen by indexing — the minimal shape every storage adapter can provide. */
export interface IndexableNote {
  id: string;
  title: string;
  content: string;
  deletedAt?: string;
}

/** Input prepared for an index: plain text plus the token stream. */
export interface PreparedDocument {
  /** Plain, human-readable text (see {@link extractPlainText}). */
  plainText: string;
  /** Lowercased word tokens in order of appearance. */
  tokens: string[];
  /** Unique tokens, first-appearance order. */
  uniqueTokens: string[];
  tokenCount: number;
  uniqueTokenCount: number;
}

/**
 * Prepares a single Markdown string for indexing.
 *
 * @param markdown raw note content
 * @param includeTokens set to `false` when only the plain text is needed
 * (e.g. a full-text search engine that tokenizes itself)
 */
export function prepareForIndexing(
  markdown: string,
  includeTokens = true,
): PreparedDocument {
  const plainText = extractPlainText(markdown);
  if (!includeTokens) {
    return {
      plainText,
      tokens: [],
      uniqueTokens: [],
      tokenCount: 0,
      uniqueTokenCount: 0,
    };
  }
  const tokens = tokenize(plainText);
  const uniques = uniqueTokens(plainText);
  return {
    plainText,
    tokens,
    uniqueTokens: uniques,
    tokenCount: tokens.length,
    uniqueTokenCount: uniques.length,
  };
}

/**
 * Prepares a note (id + title + content) into the shape a search engine
 * consumes: `id` carried through, `title` kept verbatim, `content` replaced
 * with the extracted plain text so Markdown syntax never pollutes matches.
 */
export function createSearchDocument(note: IndexableNote): {
  id: string;
  title: string;
  content: string;
} {
  return {
    id: note.id,
    title: note.title,
    content: extractPlainText(note.content),
  };
}

export { extractPlainText, tokenize, uniqueTokens } from './text.js';
