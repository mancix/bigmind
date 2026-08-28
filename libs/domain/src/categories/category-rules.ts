import type { Category, CategoryTreeNode } from './category.js';

export class CategoryNameError extends Error {
  readonly code = 'CATEGORY_NAME_INVALID';

  constructor() {
    super('Category name cannot be empty.');
    this.name = 'CategoryNameError';
  }
}

export class CategoryIconError extends Error {
  readonly code = 'CATEGORY_ICON_INVALID';

  constructor() {
    super('Category icon must be a single emoji.');
    this.name = 'CategoryIconError';
  }
}

const CATEGORY_EMOJI_PATTERN = /^(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|\uFE0E)?\p{Emoji_Modifier}?(?:\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|\uFE0E)?\p{Emoji_Modifier}?)*?)$/u;

export function normalizeCategoryName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new CategoryNameError();
  }

  return normalized;
}

export function normalizeCategoryIcon(icon?: string | null): string | null {
  const normalized = icon?.trim();

  if (!normalized) return null;

  if (!isCategoryIcon(normalized)) {
    throw new CategoryIconError();
  }

  return normalized;
}

export function isCategoryIcon(value: string): boolean {
  return CATEGORY_EMOJI_PATTERN.test(value);
}

export function isCategoryDeleted(
  category: Pick<Category, 'deletedAt'>,
): boolean {
  return category.deletedAt !== null;
}

export function isRootCategory(
  category: Pick<Category, 'parentId'>,
): boolean {
  return category.parentId === null;
}

export function sortCategoriesByPosition<T extends Pick<Category, 'position' | 'name'>>(
  categories: readonly T[],
): T[] {
  return [...categories].sort(
    (left, right) =>
      left.position - right.position || left.name.localeCompare(right.name),
  );
}

export function buildCategoryTree(
  categories: readonly Category[],
): CategoryTreeNode[] {
  const active = categories.filter((category) => !isCategoryDeleted(category));
  const nodes = new Map<string, CategoryTreeNode>(
    active.map((category) => [category.id, { ...category, children: [] }]),
  );
  const roots: CategoryTreeNode[] = [];

  for (const category of sortCategoriesByPosition(active)) {
    const node = nodes.get(category.id);

    if (!node) continue;

    const parent = category.parentId ? nodes.get(category.parentId) : undefined;

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  for (const node of nodes.values()) {
    node.children = sortCategoriesByPosition(node.children);
  }

  return sortCategoriesByPosition(roots);
}

export function getCategoryDescendantIds(
  categories: readonly Category[],
  categoryId: string,
): string[] {
  const childrenByParent = new Map<string, string[]>();

  for (const category of categories) {
    if (isCategoryDeleted(category) || !category.parentId) continue;
    const children = childrenByParent.get(category.parentId) ?? [];
    children.push(category.id);
    childrenByParent.set(category.parentId, children);
  }

  const descendants: string[] = [];
  const pending = [...(childrenByParent.get(categoryId) ?? [])];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    descendants.push(current);
    pending.push(...(childrenByParent.get(current) ?? []));
  }

  return descendants;
}

export function wouldCreateCategoryCycle(
  categories: readonly Category[],
  categoryId: string,
  newParentId: string | null,
): boolean {
  return (
    newParentId === categoryId ||
    (newParentId !== null &&
      getCategoryDescendantIds(categories, categoryId).includes(newParentId))
  );
}
