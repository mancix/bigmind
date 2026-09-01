# Mobile Category Architecture

## Overview

Category management on mobile reuses the **shared `CategoryRepository`
(`@bigmind/features`), domain rules (`@bigmind/domain/categories`), contracts,
sync engine, and workspace architecture**. No business logic is duplicated:
hierarchical rules (cycles, delete guards, normalization), sync (outbox), and
workspace scoping all live in shared code; the mobile app adds only screens and
pure data-shaping helpers.

Related documents: [Mobile Architecture](mobile-architecture.md),
[Mobile Notes Architecture](mobile-notes.md),
[Synchronization Architecture](synchronization-architecture.md).

## Mobile Category Architecture

| Piece                        | File                                                      | Reuse                                   |
| ---------------------------- | --------------------------------------------------------- | --------------------------------------- |
| Categories tab stack         | `apps/mobile/src/navigation/CategoriesNavigator.tsx`      | native stack (list ⇄ detail)            |
| List screen                  | `apps/mobile/src/screens/categories/CategoriesListScreen.tsx` | `CategoryRepository.listTree()` + `create()` |
| Detail screen                | `apps/mobile/src/screens/categories/CategoryDetailScreen.tsx` | `findById()/update()/move()/create()/delete()` |
| Tree + rules                 | `@bigmind/domain/categories` (`buildCategoryTree`, guards) | shared with web                         |
| Description (Markdown)       | `MarkdownText` + shared `@bigmind/markdown` tokenizer     | same renderer as note previews          |
| Data-shaping helpers         | `apps/mobile/src/features/categories/category-utils.ts`   | pure, offline-safe                      |

The shared `CategoryRepository` guards:

- `CATEGORY_CYCLE` — moves/create cannot place a category inside itself or a
  descendant (`wouldCreateCategoryCycle`).
- `CATEGORY_NOT_EMPTY` — a category with subcategories cannot be deleted.
- `CATEGORY_HAS_NOTES` — a category with notes cannot be deleted.
- Name/icon normalization (`normalizeCategoryName`, `normalizeCategoryIcon`)
  and `getCategoryDescendantIds` are reused as-is.

## Category Hierarchy

- **Tree view** — the list screen renders roots; each row shows icon, name,
  **note count** (direct, from one `noteRepository.list()` pass) and
  **subcategory count**. Children are **lazy-loaded**: tapping the chevron
  expands a parent and only then are its child rows materialized
  (`visibleCategoryRows`), so huge trees stay cheap.
- **Virtualization** — the tree is flattened into `{node, depth}` rows and
  rendered in a `FlatList` (`initialNumToRender`, `windowSize`), so rendering
  stays flat at any depth/size.
- **Breadcrumb navigation** — the detail screen shows the ancestor chain
  (root › parent), tappable up; child categories are listed and `push` the
  detail screen down. Parent/child traversal is native-stack based.
- **Move** — the detail screen's Move dialog lists valid targets (the category
  and its descendants excluded via `getMoveTargets`); the shared repository
  still enforces the cycle rule server-side of the UI.

## Offline Category Management

All category operations are **local-first** (write to the storage adapter +
outbox) and therefore work fully offline, syncing later through the shared
engine:

| Operation | Offline behavior |
| --------- | ---------------- |
| **Create**    | `create({name, icon, description, parentId})` → local + outbox; works offline |
| **Rename**    | `update({name})` / `move({parentId})` → local + outbox |
| **Move**      | parent change validated locally (cycle guard), queued for sync |
| **Edit description** | markdown text stored locally, validated by the shared schema |
| **Delete**    | blocked by local guards while children/notes exist; otherwise local + outbox |

- **Search** — the list search is in-memory and **hierarchy-aware**:
  `searchCategoryRows` matches category names and keeps every **ancestor row**
  visible, so the path to a match is always shown. No network involved.
- **Sync feedback** — the `SyncStatusPill` (shared engine status) sits on the
  categories list, so users always know whether local changes synced.
- **Workspace scoping** — all repositories scope by the active workspace via
  the shared `WorkspaceContext`; switching workspaces clears/resyncs as
  documented in [Mobile Workspaces](mobile-workspaces.md).

## Performance

- Flattened virtualized rows (`FlatList`) — scales to large trees.
- Lazy expansion — child rows only render when expanded.
- Client-side search/filter — instant, no server round-trips.
- Section lists in the detail screen use `FlatList` with `ListHeaderComponent`.

## Testing

| Spec                                                | Covers                                                       |
| --------------------------------------------------- | ------------------------------------------------------------ |
| `features/categories/category-utils.spec.ts`        | flatten, lazy expand, hierarchy-aware search, note counts, ancestor chain, move targets |
| `screens/categories/categories-experience.spec.tsx` | offline create (parent + markdown), tree + note counts + expand, navigation to detail, breadcrumb/children/description preview, rename/edit-description/move offline, delete blocked by notes + successful delete, offline pill + offline search |

Shared rules (cycles, guards, normalization) are covered by the shared
`@bigmind/domain` and `@bigmind/features` suites.