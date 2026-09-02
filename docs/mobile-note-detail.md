# Mobile Note Detail Architecture

The Note Detail screen is the **central screen** of the mobile app. It is
read-mode-first: it renders the stored Markdown through the shared markdown
infrastructure and layers the graph on top — wiki links, backlinks, related
reminders, category path, sync status, and conflict awareness — all backed by
the **shared repositories** (`@bigmind/features`), the **shared domain rules**
(`@bigmind/domain`), the **shared markdown tokenizer** (`@bigmind/markdown`),
and the **shared sync engine** (`@bigmind/sync`). Nothing is reimplemented on
mobile.

```
Notes tab (native stack)
└── NoteDetail { noteId }          ← from NotesList, Categories tab,
                                     wiki-link/backlink push, reminder links
      read mode (default)
        ├── title + SyncStatusPill (shared engine) + conflict indicator
        ├── category path chip        → Categories tab → CategoryDetail
        ├── created / updated dates
        ├── rendered Markdown (MarkdownText + @bigmind/markdown)
        │     ├── headings · bold · italic · code · lists · checklists
        │     ├── blockquotes · links · tables
        │     └── [[wiki links]]      → tap → target note | missing note alert
        ├── Backlinks (title + preview, virtualized) → push source note
        ├── Related reminders (title + due, virtualized)
        │     ├── tap → Reminders tab → ReminderDetail
        │     └── ＋ Add reminder → Reminders tab → ReminderForm (pre-linked)
        └── Edit note → edit mode (shipped native editor)
      edit mode
        ├── title input + category picker (shared CategoryRepository)
        ├── MarkdownEditView (OPTION B editor) or TodoListView
        ├── save (validated by shared noteDataSchema) / cancel / delete
```

## Read Mode

Read mode is the default and satisfies the "read-only first" milestone without
removing the already-shipped editor: an **Edit note** action switches into edit
mode, which keeps the existing `MarkdownEditView` / `TodoListView` flow
unchanged.

### Markdown rendering

`MarkdownText` (`apps/mobile/src/components/MarkdownText.tsx`) renders the
**shared `@bigmind/markdown` tokenizer** output (`parse.ts` / `inline.ts`) into
native components:

- Headings (H1–H3 styled, H4+), paragraphs, bold, italic, inline code, fenced
  code, ordered/unordered lists, **`- [ ]` / `- [x]` checklists** (blocked in
  the shared parser, glyphs ☐/☑), blockquotes, external links, horizontal
  rules, and tables.
- Fully **offline** — the renderer is pure string → view; no network, no
  index dependency.
- Markdown stays the source of truth; the renderer is display-only.

### Wiki links

`[[Title]]` / `[[Title|Label]]` tokens are parsed by the shared inline
tokenizer and rendered as tappable text:

- **Tap → target note**: the screen resolves `[[title]]` with the shared
  `resolveWikiLinkTarget(title, notes, aliases)` (`@bigmind/domain/links`) —
  current title first, then rename aliases (`LinkRepository.listAllAliases()`)
  — and pushes `NoteDetail` on the Notes stack.
- **Missing notes clearly indicated**: wiki links that do not resolve today
  render in the danger color with an underline
  (`MarkdownText.resolvedWikiTitles`), and tapping them reports
  “`"<title>" does not exist yet`” via `Alert`.
- **Reuse**: extraction, normalization, aliases, and resolution all come from
  the shared `@bigmind/markdown` + `@bigmind/domain/links` + shared
  `LinkRepository` — the exact logic the web and sync use.

### Backlinks

`LinkRepository.getBacklinks(noteId)` returns every active note whose
`noteLinks` record points at this note (maintained by
`NoteRepository` → `LinkRepository.rebuildForNote` on every edit). The section
shows source title + a two-line plain-text preview and **pushes** the source
note (so backlink trails keep native stack history). Rows render in an
inner `FlatList` (virtualized) so long backlink lists stay cheap.

### Related reminders

`RemindersRepository.listForNote(noteId)` (shared, workspace-scoped, added for
this screen) returns reminders with `linkedNoteId === noteId`, due-date
ascending. The section shows title + due time (+ completion glyph), routes taps
to the Reminders tab (`ReminderDetail`), and offers **＋ Add reminder**, which
opens `ReminderForm` with `defaultLinkedNoteId` so the new reminder starts
linked to this note (the form pre-fills the link; see
[Mobile Reminders](mobile-reminders.md)).

### Category information

The note's category is rendered as a breadcrumb path built from the shared
`CategoryRepository.list()` + `getAncestorChain()` (root → … → leaf). The chip
navigates to the **Categories tab → CategoryDetail** so the user can manage the
category context without leaving the flow. Uncategorized notes show an
`Uncategorized` chip.

### Sync status

The shared engine's status is surfaced with the same `SyncStatusPill` used
everywhere (`idle → Synced`, `syncing`, `offline`, `auth_required → Login
required`, `error`), alongside the per-note `syncStatus` +
`version`. The screen re-renders on the shared data-change bus
(`subscribeToDataChanges`, same bus `SyncActivator` fires after a sync pass).

### Conflict awareness

A note with unresolved changes shows a **conflict banner** when either

- `note.syncStatus === 'conflict'` (set by the shared sync engine), or
- an **open** `ConflictRecord` exists for the entity
  (`conflictRepository.listOpen()` filtered by `entityId`).

The banner is an *indicator only*: tapping it reports that conflict review is
the future conflict screen seam. **Resolution is not implemented** (web has
`/conflicts`; mobile gets it in a follow-up using the same shared
`ConflictRepository`).

## Navigation

All entry points reuse the existing stacks (React Navigation, no new
navigation infrastructure):

| From                        | To                     | Mechanism                                    |
| --------------------------- | ---------------------- | -------------------------------------------- |
| Notes List                  | Note Detail            | `NotesNavigator.push`                        |
| Categories → CategoryDetail | Note Detail            | cross-tab `navigate('Notes', …)`             |
| Reminder (detail)           | Linked Note            | cross-tab `navigate('Notes', …)`             |
| Wiki link                   | Target Note            | `NoteDetail.push` (same stack)               |
| Backlink                    | Source Note            | `NoteDetail.push` (same stack)               |
| Note Detail (category chip) | Category Detail        | cross-tab `navigate('Categories', …)`        |
| Note Detail → reminder      | Reminder Detail / Form | cross-tab `navigate('Reminders', …)`         |

## Offline Behavior

Verified by tests: with the engine offline (`mobileSyncEngine.setOnline(false)`)

- the note, its rendered Markdown, backlinks, and related reminders stay
  readable (all reads hit the local `StorageAdapter`);
- the `SyncStatusPill` reports `Offline` so the state is explicit;
- edits/deletes still write locally through the outbox and sync later.

## Performance

- Backlinks and reminders render in **virtualized inner `FlatList`s**
  (`scrollEnabled={false}` inside the page `ScrollView`, tuned batching) —
  long lists do not flatten to a full `map`.
- Wiki resolution is memoized against loaded notes + aliases
  (`resolvedWikiTitles` `Set<normalized>`), so re-renders are O(1) per token.
- The page stays a single `ScrollView`; the renderer walks the shared token
  tree once per render.
- All section data is loaded in one parallel pass
  (`Promise.all` over shared repository reads).

## Future Editor Foundation

This screen is the foundation the upcoming editor milestones build on:

- **Editor integration**: edit mode already hosts the shipped Option-B editor
  (`MarkdownEditView`/`TodoListView`); richer editors (tables, category
  picker, reminders integration) slot into the same mode without touching
  read mode. See [Mobile Editor Evaluation](mobile-editor.md).
- **Templates**: `templateType` already switches `TODO_LIST` notes to
  `TodoListView`; template-driven rendering extends the same switch.
- **Notifications**: the reminders section is the future seam for
  due/overdue alerts (see [Mobile Reminders](mobile-reminders.md)).

## Testing

| Spec                                                    | Covers                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `screens/notes/notes-experience.spec.tsx` (detail block) | read-mode loading, markdown rendering (headings/bold/checklists/wiki), wiki-link navigation, missing-link indication, backlinks + navigation, related reminders + navigation + create, category path + navigation, conflict indicator, offline readability |
| `components/editor-experience.spec.tsx`                 | `MarkdownText` checklists + resolved/missing wiki styling               |
| `libs/markdown` (shared)                                | checklist parsing (block shape, inline content)                          |
| `libs/features` (shared)                                | `RemindersRepository.listForNote` workspace scoping + sorting            |

Shared behavior (outbox, previews, wiki-link extraction/resolution) is covered
by the shared suites; mobile tests verify the wiring only.