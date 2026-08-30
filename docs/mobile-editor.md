# Mobile Note Editing — Technical Evaluation & Recommendation

Status: **evaluation + implementation**. Fases 1–2 of the roadmap below are **shipped**: the shared `@bigmind/markdown` library, the native `MarkdownEditView` (toolbar, `[[` wiki-link suggestions, preview), `TodoListView` over the shared `TodoRepository`, and backlinks in the note detail. The recommendation (Option B) is now the implemented architecture; Phase 3 (parity & integration) remains.

---

## 1. Current web editor analysis

### 1.1 Milkdown integration

The web note editor is **Milkdown Crepe** (`@milkdown/crepe@7.21.2`, ProseMirror-based WYSIWYG), used only for `MARKDOWN`-template notes:

```text
apps/web/src/features/notes/components/markdown-editor.tsx
  Crepe instance (root div, defaultValue, markdownUpdated listener)
  Wiki-link suggestion popup (browser-only machinery):
    - window.getSelection() / document.createRange()
    - document.execCommand('insertText')
    - MutationObserver + requestAnimationFrame
    - TreeWalker text-offset math
    - global keydown capture (ArrowDown/Up, Enter, Escape)
  Output: normalized Markdown string via normalizeWikiLinkMarkdown()
```

**Reusable elsewhere:** the editor is a thin “textarea over ProseMirror” — its contract with the app is just `(markdown: string) => onChange`. Everything else in the file (selection, execCommand, MutationObserver) is **browser-specific**.

### 1.2 Markdown storage format

Notes store **raw CommonMark-ish Markdown** in `NoteRecord.content` (string), with inline wiki links as `[[Note title]]` (also `[[Title|Label]]`). No HTML, no JSON blocks. The only normalization applied on save is `normalizeWikiLinkMarkdown` (un-escapes wiki-link brackets). This is ideal for portability: the source of truth is plain text shared by every client.

### 1.3 Wiki link support — already shared

The parsing/business logic is **pure and lives in `@bigmind/domain/links`** (used by web and mobile today):

- `extractWikiLinks(markdown)` → list of titles
- `normalizeWikiLinkName(value)` → canonical form
- `resolveWikiLinkTarget(title, notes, aliases)` → target resolution

The `LinkRepository` in **`@bigmind/features`** (already shared, used by mobile) rebuilds links/aliases on every note write, so **mobile gets wiki-link and backlink maintenance for free** once it saves through the shared repository. What is _not_ shared: the editor’s suggestion popup (DOM) and the fuzzy ranking helper it embeds (`rankNotes`/`fuzzyScore`) — those should be extracted (see §4).

### 1.4 Todo list support

`TODO_LIST`-template notes are **not** edited in Markdown at all. Todos live in a separate, synced `todoItems` table (sync entity `todo_item`, contract `todoItemDataSchema`) and are edited with a dedicated React component (`todo-editor.tsx` + `todoRepository`). The web editor therefore never parses todo markdown. **This model is already shared** (contracts + storage records + sync types); only the `TodoRepository` still lives in the web app (candidate for the `@bigmind/features` extraction — same pattern as notes/categories).

### 1.5 Category descriptions

`Category.description` is a short Markdown field rendered on the web with a **hand-rolled renderer** (`apps/web/src/features/categories/render-markdown.ts`) that supports code blocks, lists, tables, inline formatting, external links, and `[[wiki]]` links. It is web-only (produces an HTML string).

### 1.6 Future reminder integration

`ReminderRecord.linkedNoteId` (shared domain/storage/contracts) already connects a reminder to a note. A mobile note detail can surface/handle reminders with a native modal; no editor change is required.

### 1.7 Summary — reusable vs web-specific

| Concern                                            | Status                                                   |
| -------------------------------------------------- | -------------------------------------------------------- |
| `[[Title]]` parsing, alias keys, target resolution | ✅ shared (`@bigmind/domain/links`)                      |
| Link/backlink maintenance on write                 | ✅ shared (`@bigmind/features` LinkRepository)           |
| Plain-text previews (`createNotePreview`)          | ✅ shared (`@bigmind/domain/notes`)                      |
| Note/todo/reminder contracts                       | ✅ shared (`@bigmind/contracts`)                         |
| Outbox sync of edits                               | ✅ shared (`@bigmind/sync`)                              |
| Todo item storage/CRUD model                       | ✅ shared (except the `TodoRepository` class — web-only) |
| Markdown → rich preview rendering                  | ⚠️ web-only (`render-markdown.ts`, HTML)                 |
| WYSIWYG editing (Milkdown/Crepe)                   | ❌ browser-only                                          |
| Wiki-link suggestion UI + fuzzy ranking            | ⚠️ ranking extractable, UI browser-only                  |
| Todo list editor UI                                | ❌ web component (reusable model, not UI)                |

---

## 2. Mobile strategies — comparison

Weighted criteria: **maintainability (5), shared business logic (4), offline-first (4), markdown fidelity (4), Android UX (3), bundle size (3), wiki-link compatibility (3), future features (2).**

| Criterion                                                   | A. Native Markdown editor (plain `TextInput`)                                     | B. Markdown editor + preview (recommended candidate)         | C. WebView + Milkdown (price parity)                                                                                 | D. Native Rich Text editor                                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Maintenance cost                                            | **Very low** — no deps, RN primitives only                                        | **Low** — shared renderer once, tested everywhere            | **High** — WebView bridge, offline assets, JS↔native sync, version pinning of the web editor, keyboard/height quirks | **High** — heavy native deps (or WebView under the hood), serialization round-trips, wiki-link/backlink custom work |
| Bundle size                                                 | **~0 KB** editor-specific                                                         | **Small** (a tokenizer/renderer ≈ few KB, shared)            | **Very large** — web app + Crepe + ProseMirror inside WebView                                                        | **Large** — rich-text engine + native modules                                                                       |
| Android UX                                                  | Native keyboard, autogrow textarea; raw markdown visible                          | Native textarea + **live preview tab/split**; best balance   | WebView text input is historically quirky (keyboard, scrolling, IME); extra jar between views                        | Good WYSIWYG feel but hard to keep native feel + custom autocomplete                                                |
| Offline support                                             | **Perfect** — local edits through shared repo/outbox                              | **Perfect** — same                                           | Complex: asset bundling for offline WebView                                                                          | Good, but transform layer adds failure modes                                                                        |
| Markdown fidelity                                           | **Exact by construction** — authored text is the source of truth                  | **Exact** — text is source of truth; preview is display-only | Perfect (same editor) but tied to web behavior                                                                       | **Risk** — WYSIWYG → markdown serialization can lose constructs                                                     |
| Wiki-link compatibility                                     | Needs `[[` suggestion → pure-ranking helper + native list; text stays `[[Title]]` | Same, plus rendered links in preview (shared parser)         | Reuse web popup, but must feed candidates + resolve taps through bridge                                              | Must build custom wiki-link nodes/extensions                                                                        |
| Future features (tables, reminders, category picker, todos) | Anything text-level works; structured features are native components              | Same, plus structured **preview** for tables/code            | Fastest parity for any web feature, but each needs bridge work                                                       | Depends on engine extensions; high effort per feature                                                               |
| **Total score** (weighted)                                  | **≈ 4.1**                                                                         | **≈ 4.6**                                                    | ≈ 2.6                                                                                                                | ≈ 2.4                                                                                                               |

### Notes on scoring

- **A/B** share the same editing core; B differs only by adding a shared renderer + preview toggle, which also unlocks web preview parity later.
- **C** looks attractive for “one editor”, but it multiplies every future feature by a native↔WebView bridge, forces bundling the web editor for offline, and is the hardest to test on CI. It is best treated as an **escape hatch**, not the default.
- **D** (e.g. React Native rich-text libs) typically wrap ProseMirror in a WebView anyway (tentap-style), so it inherits C’s costs _plus_ a markdown serialization/fidelity risk.

---

## 3. Recommended architecture

**Long-term recommendation: Option B — native Markdown editing (`TextInput` multiline) + live preview, with structured features (todos, category picker, reminders) as native components on top of the shared repositories.**

Rationale against the stated priorities:

- **Maintainability / low complexity** — zero editor frameworks; one small, shared, typed Markdown renderer; no bridge, no version pinning, no native build extras. Android autogrow `TextInput` (already used by the mobile note detail) is the whole “editor engine”.
- **Shared business logic** — every write goes through the already-shared `NoteRepository` (outbox coalescing, wiki-link maintenance). The only new shared code is a **renderer + tokenizer** and the wiki-link **ranking helper** (pure functions).
- **Offline-first** — plain text + local storage + outbox: identical guarantees to the web.
- **Markdown fidelity** — the stored text is the source of truth (same as web); no serialization layer can corrupt it.
- **Android UX** — native keyboard/autocorrect/autogrow; preview tab for formatted reading; structured popups (wiki suggestion, category picker) are native and reliable.

Architecture after Phase 3:

```text
libs/
  domain/      note rules, wiki-link parsing (existing)
  features/    NoteRepository, LinkRepository (+ TodoRepository later)  (existing + extension)
  markdown/    NEW shared: tokenizer → MarkdownRow[]; renderers
               (RN component render + optional HTML for web preview parity)
  contracts/   note/todo/reminder schemas (existing)
  sync/        engine + outbox (existing)

apps/mobile
  screens/notes/NoteDetailScreen  (existing)
    ├─ template MARKDOWN → MarkdownEditView (TextInput + toolbar/preview toggle)
    ├─ template TODO_LIST -> TodoListView   (shared repo + items list)
    └─ wiki-link suggestion list (shared ranking helper)
```

---

## 4. Shared components to extract

| Component                                                                    | Where it lives today                      | Proposal                                                                                             | New lib                             |
| ---------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Markdown block parse (headings, paragraphs, lists, code, quotes, tables, hr) | `render-markdown.ts` (web, HTML-only)     | Pure `parseMarkdown(md): MarkdownRow[]` (block + inline) with escaping rules identical to today      | **`@bigmind/markdown`**             |
| Inline parse (bold, italic, code, links, `[[wiki]]`)                         | web editor (regex) + `render-markdown.ts` | Same tokenizer shared by preview and link serialization                                              | `@bigmind/markdown`                 |
| Wiki-link suggestion ranking (`rankNotes`/`fuzzyScore`)                      | `markdown-editor.tsx` (browser)           | Pure `rankNotesTitles(notes, query)` used by mobile autocomplete and (later) web                     | `@bigmind/markdown` (or `features`) |
| Wiki-link markdown normalization                                             | `markdown-editor.tsx`                     | `normalizeWikiLinkMarkdown` (already generic)                                                        | `@bigmind/markdown`                 |
| Preview serializer (RN-friendly)                                             | —                                         | `MarkdownText` React component over the tokenizer (Android-first)                                    | `@bigmind/markdown`                 |
| Web preview parity                                                           | `render-markdown.ts`                      | Optionally re-implement the web’s HTML rendering over the shared tokenizer (Phase 3, only if needed) | `@bigmind/markdown`                 |
| Todo CRUD                                                                    | `apps/web/.../todo-repository.ts` (web)   | Extract `TodoRepository` to `@bigmind/features` (same migration as notes/categories)                 | `@bigmind/features`                 |
| Note serialization                                                           | — (content is already text)               | No-op: shared repo + `noteDataSchema` already guarantee the shape                                    | —                                   |

No web behavior changes are proposed: Milkdown stays the web editor; `render-markdown.ts` stays until Phase 3 decides on parity.

---

## 5. Migration plan (no editor code yet)

### Phase 1 — Shared foundations (platform-agnostic) ✅ shipped

1. Create `@bigmind/markdown`: `parseMarkdown` (block+inline), `normalizeWikiLinkMarkdown`, ranking helper, and a `MarkdownText` render component. — done
2. Port the current web wiki-link behavior 1:1 into the tokenizer tests (fidelity lock: same input → same structure as `render-markdown.ts`). — done (inline/code/link/wiki/format transforms covered by `markdown.spec.ts`)
3. Optional: extract `TodoRepository` into `@bigmind/features` (pattern already proven with notes/categories). — done
4. Update mobile note detail to **render the preview** from the shared renderer (read-mode) for `MARKDOWN` notes — while edits still use the plain `TextInput`. — done (preview toggle in `MarkdownEditView`)

### Phase 2 — Editing UX (mobile only) ✅ shipped

1. Replace the raw `TextInput` with `MarkdownEditView`: multiline editor + formatting toolbar (B/I/`/link/heading) implemented as **pure string transforms** over the shared tokenizer. — done (format.ts)
2. **Wiki-link suggestion**: `[[` triggers a native suggestion list fed by the shared ranking helper; insertion writes plain `[[Title]]` text (link resolution happens server-side and via the shared `LinkRepository` on save — no editor-side graph). — done
3. Preview toggle (edit ⇄ preview, and split option on tablets); debounced autosave (already safe via outbox coalescing). — preview toggle done; tablet split + debounced autosave pending polish
4. `TODO_LIST` notes: native `TodoListView` over the shared todo repository (create/check/reorder), mirroring the web `TodoEditor`. — done

### Phase 3 — Parity & integration

1. iOS polish (keyboard avoidance, safe areas, Smart Punctuation off), RTL-safe rendering.
2. Reminders integration from note detail (native modal, `linkedNoteId`), category picker refinements, backlinks/outgoing links panel in the detail (shared `LinkRepository`).
3. Activate sync (SQLite `StorageAdapter` + `@bigmind/sync` supervisor) so edits flow end-to-end; conflict review screen.
4. Optional: re-implement web preview HTML over the shared tokenizer to remove `render-markdown.ts` divergence; keep WebView+Milkdown only as a documented escape hatch for future features the tokenizer cannot cover.

---

## 6. Risks

| Risk                                                                    | Mitigation                                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Markdown renderer divergence** between preview and web                | Single shared tokenizer + fidelity tests locked to `render-markdown.ts` behavior; keep renderer display-only                     |
| **Authoring ergonomics** (raw markdown vs WYSIWYG)                      | Toolbar string-transforms + live preview; decide later whether advanced tables need more                                         |
| **Android `TextInput` quirks** (multiline autogrow, soft-keyboard, IME) | Use the already-proven plain multiline `TextInput` from the note detail; avoid third-party text editors; test on emulator+device |
| **Wiki-link UX without WYSIWYG**                                        | Suggestion popup is text-level (same data as web): pure ranking helper + native list keeps parity of behavior, not of pixels     |
| **WebView path (if ever adopted)**                                      | Never the default; if needed it is a _fallback feature island_, isolated behind a feature flag, not the editor root              |
| **Fidelity of TODO/reminders**                                          | Never parsed from markdown — shared entities/contracts guarantee round-tripping                                                  |
| **Bundle growth**                                                       | Target ≈ 0 significant editor deps; tokenizer targets a few KB gz                                                                |

---

## 7. Validation note

This document proposes **no code changes**; the workspace remains green under the standard validation (see repository CI): lint, unit tests, typecheck, and build for all 9+ projects.
