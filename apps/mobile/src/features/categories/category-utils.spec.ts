import type { CategoryRecord, CategoryTreeNode, NoteRecord } from '@bigmind/storage';

import {
  countNotesByCategory,
  flattenCategoryTree,
  getAncestorChain,
  getMoveTargets,
  searchCategoryRows,
  visibleCategoryRows,
} from './category-utils';

function category(id: string, name: string, parentId: string | null = null): CategoryRecord {
  return {
    id,
    name,
    description: '',
    icon: null,
    parentId,
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 0,
    deletedAt: null,
  };
}

function note(id: string, categoryId: string | null): NoteRecord {
  return {
    id,
    title: 't',
    content: '',
    categoryId,
    templateType: 'MARKDOWN',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 0,
    syncStatus: 'synced',
  };
}

/** root → [child-a → [grand-a]], [child-b] */
function sampleTree(): CategoryTreeNode[] {
  const grandA = { ...category('g', 'Grand A', 'c'), children: [] };
  const childA = { ...category('c', 'Child A', 'r'), children: [grandA] };
  const childB = { ...category('c2', 'Child B', 'r'), children: [] };
  const root = { ...category('r', 'Root', null), children: [childA, childB] };
  return [root];
}

const CATEGORIES = [
  category('r', 'Root'),
  category('c', 'Child A', 'r'),
  category('c2', 'Child B', 'r'),
  category('g', 'Grand A', 'c'),
];

describe('category utils', () => {
  it('flattens the tree with depth', () => {
    const rows = flattenCategoryTree(sampleTree());
    expect(rows).toEqual([
      { node: expect.objectContaining({ id: 'r' }), depth: 0 },
      { node: expect.objectContaining({ id: 'c' }), depth: 1 },
      { node: expect.objectContaining({ id: 'g' }), depth: 2 },
      { node: expect.objectContaining({ id: 'c2' }), depth: 1 },
    ]);
  });

  it('renders children lazily only for expanded parents', () => {
    const collapsed = visibleCategoryRows(sampleTree(), new Set());
    expect(collapsed.map((row) => row.node.id)).toEqual(['r']);

    const expanded = visibleCategoryRows(sampleTree(), new Set(['r']));
    expect(expanded.map((row) => row.node.id)).toEqual(['r', 'c', 'c2']);

    const deep = visibleCategoryRows(sampleTree(), new Set(['r', 'c']));
    expect(deep.map((row) => row.node.id)).toEqual(['r', 'c', 'g', 'c2']);
  });

  it('searches category names and keeps ancestor rows (hierarchy-aware)', () => {
    const rows = searchCategoryRows(sampleTree(), 'grand');
    expect(rows.map((row) => row.node.id)).toEqual(['r', 'c', 'g']);
  });

  it('returns the full tree for an empty search', () => {
    expect(searchCategoryRows(sampleTree(), '   ')).toHaveLength(4);
  });

  it('counts direct notes per category', () => {
    const counts = countNotesByCategory([
      note('n1', 'c'),
      note('n2', 'c'),
      note('n3', 'r'),
      note('n4', null),
    ]);
    expect(counts.get('c')).toBe(2);
    expect(counts.get('r')).toBe(1);
    expect(counts.has('c2')).toBe(false);
  });

  it('builds the ancestor chain root→parent', () => {
    expect(getAncestorChain(CATEGORIES, 'g').map((c) => c.id)).toEqual([
      'r',
      'c',
    ]);
    expect(getAncestorChain(CATEGORIES, 'r')).toEqual([]);
    expect(getAncestorChain(CATEGORIES, 'missing')).toEqual([]);
  });

  it('offers move targets excluding the category and its descendants', () => {
    // Moving 'r' (root) excludes its whole subtree → nothing to choose.
    expect(getMoveTargets(CATEGORIES, 'r')).toEqual([]);
    // Moving 'c' excludes 'c' and its descendant 'g', but allows 'r' and 'c2'.
    expect(getMoveTargets(CATEGORIES, 'c').map((t) => t.id).sort()).toEqual([
      'c2',
      'r',
    ]);
    // Moving a leaf removes only itself.
    expect(getMoveTargets(CATEGORIES, 'g').map((t) => t.id).sort()).toEqual([
      'c',
      'c2',
      'r',
    ]);
  });
});