import {
  getCategoryDescendantIds,
  type CategoryTreeNode,
} from '@bigmind/domain/categories';
import type { CategoryRecord, NoteRecord } from '@bigmind/storage';

/**
 * Pure, platform-independent category helpers: tree flattening (for
 * virtualized lists), hierarchy-aware name search, note counts, and ancestor
 * paths. The shared `CategoryRepository` stays the single source of truth for
 * persistence and business rules (cycles, delete guards); these helpers only
 * shape data for fast, offline-safe rendering.
 */

export interface FlatCategoryRow {
  node: CategoryTreeNode;
  depth: number;
}

/** Flatten a category tree into rows with depth (for a virtualized FlatList). */
export function flattenCategoryTree(
  tree: CategoryTreeNode[],
): FlatCategoryRow[] {
  const rows: FlatCategoryRow[] = [];
  const walk = (nodes: CategoryTreeNode[], depth: number) => {
    for (const node of nodes) {
      rows.push({ node, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return rows;
}

/**
 * Visible rows for the tree given a set of expanded ids (lazy children):
 * roots are always visible; children render only when their parent is
 * expanded. This keeps huge trees cheap: child rows are materialized on
 * demand, not all at once.
 */
export function visibleCategoryRows(
  tree: CategoryTreeNode[],
  expandedIds: ReadonlySet<string>,
): FlatCategoryRow[] {
  const rows: FlatCategoryRow[] = [];
  const walk = (nodes: CategoryTreeNode[], depth: number, visible: boolean) => {
    for (const node of nodes) {
      rows.push({ node, depth });
      if (visible && expandedIds.has(node.id)) {
        walk(node.children, depth + 1, true);
      }
    }
  };
  // Roots are always visible; their children depend on expansion.
  walk(tree, 0, true);
  return rows;
}

/**
 * Hierarchy-aware name search: returns the flattened rows whose name matches
 * the query, plus every ancestor row of a match (so the path is visible).
 * Works fully offline.
 */
export function searchCategoryRows(
  tree: CategoryTreeNode[],
  query: string,
): FlatCategoryRow[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) {
    return flattenCategoryTree(tree);
  }

  const matches = new Set<string>();
  const collect = (nodes: CategoryTreeNode[], ancestors: string[]) => {
    for (const node of nodes) {
      const matched =
        node.name.toLocaleLowerCase().includes(needle) ||
        node.children.some((child) => childMatches(child, needle));
      if (matched) {
        for (const ancestorId of ancestors) {
          matches.add(ancestorId);
        }
        matches.add(node.id);
      }
      collect(node.children, [...ancestors, node.id]);
    }
  };
  collect(tree, []);

  return flattenCategoryTree(tree).filter((row) => matches.has(row.node.id));
}

function childMatches(node: CategoryTreeNode, needle: string): boolean {
  return (
    node.name.toLocaleLowerCase().includes(needle) ||
    node.children.some((child) => childMatches(child, needle))
  );
}

/** Direct note counts per category (one pass over the loaded notes). */
export function countNotesByCategory(
  notes: readonly NoteRecord[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    if (!note.categoryId) continue;
    counts.set(note.categoryId, (counts.get(note.categoryId) ?? 0) + 1);
  }
  return counts;
}

/** Ancestor chain root→…→parent for breadcrumb / "parent category" display. */
export function getAncestorChain(
  categories: readonly CategoryRecord[],
  categoryId: string,
): CategoryRecord[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const chain: CategoryRecord[] = [];
  const visited = new Set<string>();
  let current = byId.get(categoryId);
  while (current?.parentId && !visited.has(current.parentId)) {
    visited.add(current.parentId);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

/** Valid move targets: every category except the category and its descendants. */
export function getMoveTargets(
  categories: readonly CategoryRecord[],
  categoryId: string,
): CategoryRecord[] {
  const excluded = getCategoryDescendantIds(categories, categoryId);
  const excludedSet = new Set([categoryId, ...excluded]);
  return categories.filter((category) => !excludedSet.has(category.id));
}