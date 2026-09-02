# Markdown Architecture

The `@bigmind/markdown` library is the **single source of truth for Markdown
processing** across the BigMind ecosystem (web PWA, React Native app, shared
domain/features libraries, and future graph view, search indexing, and AI
features).

It is **pure TypeScript** with zero dependencies — no React, React Native,
browser, DOM, or persistence APIs — so it runs identically in a Hermes JS
runtime, a web bundle, Vitest, and Node.

```
apps/web ──┐
apps/mobile ──┤
libs/domain ──┼──► @bigmind/markdown  (libs/markdown)
libs/features ──┤        │
graph/search/AI ──┘        ├── parser (AST)
                           ├── wiki links + backlinks
                           ├── previews + search prep
                           ├── renderer abstraction
                           └── editor formatting transforms
```

---

## 1. AST Structure

The parser produces a small, platform-independent AST with two layers.

### Blocks (`parseMarkdown` → `MarkdownBlock[]` / `MarkdownAst`)

| Node         | Fields                                                            |
| ------------ | ----------------------------------------------------------------- |
| `heading`    | `level: 1–6`, `content: InlineToken[]`                            |
| `paragraph`  | `content: InlineToken[]`                                          |
| `list`       | `ordered: boolean`, `items: MarkdownListItem[]`                   |
| `list item`  | `checked: boolean \| null` (checklists), `content: InlineToken[]` |
| `code`       | `language: string \| null`, `content: string`                     |
| `blockquote` | `content: InlineToken[]`                                          |
| `table`      | `header: string[]`, `rows: string[][]`                            |
| `hr`         | —                                                                 |

### Inline tokens (`parseInline` → `InlineToken[]`)

`text`, `bold`, `italic`, `code`, `link` (`url` + content), `wiki`
(`title` + optional `label`).

The AST is the _only_ interface renderers see; the raw Markdown text remains
the source of truth for editing (selection-based transforms never rewrite the
AST).

## 2. Parser Design

- **Deterministic**: line-oriented block scanning with a state machine —
  same input always yields the same AST.
- **Testable**: pure functions, no I/O; the entire parser is exercised by
  `markdown.spec.ts` and `canonical.spec.ts` (which locks the legacy web
  renderer parity byte-for-byte).
- **Platform independent**: no DOM, no timers, no `Buffer`.
- **Failure-tolerant**: unmatched Markdown markers fall back to plain text
  (like the original web renderer), so note content is never lost.
- Code fences, inline code, links, and wiki links take precedence over
  emphasis, preventing `**`/`*` inside code from being parsed as formatting.

## 3. Wiki-Link System

Wiki links use `[[Title]]` and `[[Title|Label]]` syntax.

| API                        | Purpose                                                   |
| -------------------------- | --------------------------------------------------------- |
| `findWikiLinkReferences()` | every occurrence with **positions** (line/column/offsets) |
| `extractWikiLinks()`       | unique titles, first-appearance order                     |
| `normalizeWikiLinks()`     | un-escape editor `\[[Title]\]` output                     |
| `normalizeWikiLinkName()`  | canonical key: trim + case-fold                           |
| `findWikiLinkTrigger()`    | in-progress `[[` detection for the suggestion popup       |
| `insertWikiLink()`         | replace a `[[query` range with a selected title           |

References inside fenced/inline code are ignored (code samples are literal).
Malformed syntax (`[[]]`, unbalanced brackets, blank titles) is skipped.

## 4. Backlinks

`backlinks.ts` provides an immutable `BacklinkIndex`:

- **Extraction** — `extractBacklinks(note)` / `findWikiLinkReferences()`:
  the wiki-link references inside a single note.
- **Indexing** — `BacklinkIndex.fromNotes(notes)`: inverted map from
  normalized target title → sources, aggregated in one pass.
- **Updates** — `addNote`, `rebuild`, `removeNote` return **new** indexes
  (pure), matching repository/reducer flows.
- **Queries** — `sourcesForTitle(title)` (sorted by recency), `referencesFrom
(noteId)`, `targets()`, plus the one-shot `findBacklinksForTitle()`.

Reusable by **repositories** (link rebuilds on content change), **search**
(which notes reference a topic), and the **graph view** (edges + weights).

## 5. Note Previews

`createMarkdownPreview(markdown, maxLength?)` strips Markdown/HTML
formatting while preserving readability (link labels, image alt text, wiki
titles) and truncates with `…`. `createNotePreview` is kept as a deprecated
alias; both build on `extractPlainText` so previews and search indexing can
never diverge (`EMPTY_NOTE_PREVIEW` for empty content).

## 6. Search Preparation

`search.ts` / `text.ts` expose:

- `extractPlainText(markdown)` — readable plain text.
- `tokenize(text)` / `uniqueTokens(text)` / `normalizeToken(token)` —
  Unicode-aware, case-folded token streams.
- `prepareForIndexing(markdown, includeTokens?)` — plain text + token counts.
- `createSearchDocument(note)` — `{ id, title, content: plainText }`, the
  exact shape the web MiniSearch index consumes.

No search-engine logic lives here (no scoring, no inverted files, no query
language) — the library only prepares text; engines consume the results.

## 7. Renderer Abstraction

`renderer.ts` defines:

- `InlineRenderer` — `renderInline(tokens)`.
- `MarkdownRenderer` — `renderBlocks(ast)` + `render(markdown)`.
- `createHtmlRenderer(options)` — the forward-looking HTML implementation
  (headings, lists incl. checklists with `data-checked`, code blocks,
  blockquotes, tables, `wiki-link` anchors).

Adding future renderers (React Web, React Native, HTML/PDF export) means
implementing the two interfaces over the same AST — **the parser is never
modified**. The legacy `renderMarkdown` (byte-for-byte port of the original
web renderer) is retained only for backward-compatibility parity and is
locked by `canonical.spec.ts`.

## 8. Editor Formatting Transforms

`format.ts` keeps selection-based edits pure and unit-tested:
`toggleInline`, `toggleHeading`, `insertLink`. `ranking.ts` provides
`rankTitles`/`fuzzyScore` for `[[` suggestions. Both are used by the web
editor and the native editor.

## 9. Future Graph Integration

The graph view will consume `BacklinkIndex` directly:

- **Nodes** — notes with titles.
- **Edges** — `sourcesForTitle(title)` gives weighted incoming links
  (`count`, per-reference positions for tooltips/jump-to), and
  `referencesFrom(noteId)` gives outgoing links.
- **Updates** — note content changes call `index.rebuild(note)`; deletion
  calls `removeNote(id)`; the immutable index makes snapshot/undo trivial.

## 10. Migration Status

- Web `render-markdown.ts` → re-export of `renderMarkdown`.
- Web editor & mobile editor → `@bigmind/markdown` tokens/helpers.
- Web search index → `createSearchDocument` (plain-text content).
- `@bigmind/domain` re-exports preview + wiki-link APIs (stable domain
  surface; implementation lives here).
- Repositories (`@bigmind/features` `LinkRepository`) → `extractWikiLinks`
  from this library.

Duplicated Markdown utilities outside this library are considered a defect:
all new Markdown processing must land here first.
