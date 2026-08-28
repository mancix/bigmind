import { describe, expect, it } from 'vitest';

import type { Category } from './category.js';
import {
  buildCategoryTree,
  getCategoryDescendantIds,
  isCategoryIcon,
  isRootCategory,
  normalizeCategoryIcon,
  normalizeCategoryName,
  sortCategoriesByPosition,
  wouldCreateCategoryCycle,
} from './category-rules.js';

const categories: Category[] = [
  category('root-b', 'Root B', null, 2),
  category('root-a', 'Root A', null, 1),
  category('child-b', 'Child B', 'root-a', 2),
  category('child-a', 'Child A', 'root-a', 1),
  category('grandchild', 'Grandchild', 'child-a', 0),
];

describe('category rules', () => {
  it('normalizes category names and rejects empty values', () => {
    expect(normalizeCategoryName('  Programming  ')).toBe('Programming');
    expect(() => normalizeCategoryName('   ')).toThrow(
      'Category name cannot be empty.',
    );
  });

  it('normalizes optional category icons', () => {
    expect(normalizeCategoryIcon('  🚀  ')).toBe('🚀');
    expect(normalizeCategoryIcon('👩🏽‍💻')).toBe('👩🏽‍💻');
    expect(normalizeCategoryIcon('🇮🇹')).toBe('🇮🇹');
    expect(normalizeCategoryIcon('   ')).toBeNull();
    expect(normalizeCategoryIcon(null)).toBeNull();
    expect(() => normalizeCategoryIcon('work')).toThrow(
      'Category icon must be a single emoji.',
    );
    expect(() => normalizeCategoryIcon('🚀📚')).toThrow(
      'Category icon must be a single emoji.',
    );
  });

  it('recognizes a single system emoji', () => {
    expect(isCategoryIcon('❤️')).toBe(true);
    expect(isCategoryIcon('1️⃣')).toBe(true);
    expect(isCategoryIcon('a')).toBe(false);
    expect(isCategoryIcon('1')).toBe(false);
  });

  it('detects root categories', () => {
    expect(isRootCategory(categories[0])).toBe(true);
    expect(isRootCategory(categories[2])).toBe(false);
  });

  it('sorts siblings by position', () => {
    expect(sortCategoriesByPosition(categories.slice(0, 2)).map(({ id }) => id))
      .toEqual(['root-a', 'root-b']);
  });

  it('builds an ordered category tree', () => {
    const tree = buildCategoryTree(categories);

    expect(tree.map(({ id }) => id)).toEqual(['root-a', 'root-b']);
    expect(tree[0]?.children.map(({ id }) => id)).toEqual([
      'child-a',
      'child-b',
    ]);
    expect(tree[0]?.children[0]?.children[0]?.id).toBe('grandchild');
  });

  it('returns every descendant id', () => {
    expect(getCategoryDescendantIds(categories, 'root-a')).toEqual([
      'child-b',
      'child-a',
      'grandchild',
    ]);
  });

  it('detects moves that would create cycles', () => {
    expect(wouldCreateCategoryCycle(categories, 'root-a', 'root-a')).toBe(true);
    expect(wouldCreateCategoryCycle(categories, 'root-a', 'grandchild')).toBe(
      true,
    );
    expect(wouldCreateCategoryCycle(categories, 'child-a', 'root-b')).toBe(
      false,
    );
  });
});

function category(
  id: string,
  name: string,
  parentId: string | null,
  position: number,
): Category {
  return {
    id,
    name,
    icon: null,
    parentId,
    position,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 0,
    deletedAt: null,
  };
}
