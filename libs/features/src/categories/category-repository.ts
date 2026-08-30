import {
  buildCategoryTree,
  getCategoryDescendantIds,
  isCategoryDeleted,
  normalizeCategoryIcon,
  normalizeCategoryName,
  wouldCreateCategoryCycle,
  type CategoryTreeNode,
} from '@bigmind/domain/categories';
import type {
  CategoryRecord,
  OutboxRecord,
  StorageAdapter,
} from '@bigmind/storage';
import { requestBackgroundSync, type SyncOutbox } from '@bigmind/sync';

import { generateId } from '../id.js';

export type CategoryErrorCode =
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_NAME_INVALID'
  | 'CATEGORY_PARENT_NOT_FOUND'
  | 'CATEGORY_CYCLE'
  | 'CATEGORY_NOT_EMPTY'
  | 'CATEGORY_HAS_NOTES';

export class CategoryRepositoryError extends Error {
  constructor(
    readonly code: CategoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CategoryRepositoryError';
  }
}

export interface CreateCategoryInput {
  name: string;
  description?: string;
  icon?: string | null;
  parentId?: string | null;
}

export interface UpdateCategoryInput {
  name?: string;
  description?: string;
  icon?: string | null;
  parentId?: string | null;
  position?: number;
}

/**
 * Category repository shared by the web app and the mobile app.
 * Pure logic over the {@link StorageAdapter} + outbox abstractions — nothing
 * platform-specific.
 */
export class CategoryRepository {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly outbox: SyncOutbox,
  ) {}

  async list(): Promise<CategoryRecord[]> {
    return (await this.storage.categories.toArray()).filter(
      (category) => !isCategoryDeleted(category),
    );
  }

  async tree(): Promise<CategoryTreeNode[]> {
    return buildCategoryTree(await this.list());
  }

  async listTree(): Promise<CategoryTreeNode[]> {
    return this.tree();
  }

  async count(): Promise<number> {
    return (await this.list()).length;
  }

  async findById(id: string): Promise<CategoryRecord | undefined> {
    const category = await this.storage.categories.get(id);
    return category && !isCategoryDeleted(category) ? category : undefined;
  }

  async create(input: CreateCategoryInput): Promise<string> {
    const categoryId = await this.outbox.transactionWithCategories(async () => {
      const parentId = input.parentId ?? null;
      await this.assertParent(parentId);
      const timestamp = this.now();
      const category: CategoryRecord = {
        id: this.generateId(),
        name: this.normalizeName(input.name),
        description: input.description ?? '',
        icon: normalizeCategoryIcon(input.icon),
        parentId,
        position: await this.nextPosition(parentId),
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 0,
        deletedAt: null,
        syncStatus: 'pending',
      };
      await this.storage.categories.add(category);
      await this.outbox.add(
        this.createOperation('create', category, timestamp),
      );
      return category.id;
    });

    requestBackgroundSync();
    return categoryId;
  }

  async update(id: string, changes: UpdateCategoryInput): Promise<void> {
    await this.outbox.transactionWithCategories(async () => {
      const existing = await this.requireCategory(id);
      const parentId =
        changes.parentId === undefined ? existing.parentId : changes.parentId;
      await this.assertParent(parentId);
      const categories = await this.list();
      if (wouldCreateCategoryCycle(categories, id, parentId)) {
        throw new CategoryRepositoryError(
          'CATEGORY_CYCLE',
          'A category cannot be moved inside itself or one of its descendants.',
        );
      }
      const timestamp = this.now();
      const category: CategoryRecord = {
        ...existing,
        name:
          changes.name === undefined
            ? existing.name
            : this.normalizeName(changes.name),
        description:
          changes.description === undefined
            ? existing.description
            : changes.description,
        icon:
          changes.icon === undefined
            ? existing.icon
            : normalizeCategoryIcon(changes.icon),
        parentId,
        position:
          changes.position === undefined
            ? changes.parentId !== undefined && parentId !== existing.parentId
              ? await this.nextPosition(parentId)
              : existing.position
            : Math.max(0, Math.trunc(changes.position)),
        updatedAt: timestamp,
        syncStatus: 'pending',
        conflict: undefined,
      };
      await this.storage.categories.put(category);
      await this.upsertOperation(category, timestamp);
    });

    requestBackgroundSync();
  }

  async rename(id: string, name: string): Promise<void> {
    return this.update(id, { name });
  }

  async setIcon(id: string, icon: string | null): Promise<void> {
    return this.update(id, { icon });
  }

  async move(id: string, parentId: string | null): Promise<void> {
    return this.update(id, { parentId });
  }

  async reorder(id: string, position: number): Promise<void> {
    return this.update(id, { position });
  }

  async delete(id: string): Promise<void> {
    await this.outbox.transactionWithEntities(async () => {
      const existing = await this.requireCategory(id);
      if ((await this.list()).some((category) => category.parentId === id)) {
        throw new CategoryRepositoryError(
          'CATEGORY_NOT_EMPTY',
          'This category is not empty.',
        );
      }
      if (
        await this.storage.notes
          .filter((note) => !note.deletedAt && note.categoryId === id)
          .count()
      ) {
        throw new CategoryRepositoryError(
          'CATEGORY_HAS_NOTES',
          'This category contains notes.',
        );
      }
      const operations = await this.coalescableOperations(id);
      if (operations.some((operation) => operation.operation === 'create')) {
        await this.storage.categories.delete(id);
        await this.outbox.removeMany(operations.map(({ id }) => id));
        return;
      }
      const timestamp = this.now();
      const category: CategoryRecord = {
        ...existing,
        deletedAt: timestamp,
        updatedAt: timestamp,
        syncStatus: 'pending',
        conflict: undefined,
      };
      await this.storage.categories.put(category);
      const reusable =
        operations.find(({ operation }) => operation === 'delete') ??
        operations.find(({ operation }) => operation === 'update');
      if (reusable) {
        await this.outbox.save({
          ...this.resetOperation(reusable, category),
          operation: 'delete',
        });
      } else {
        await this.outbox.add(
          this.createOperation('delete', category, timestamp),
        );
      }
    });

    requestBackgroundSync();
  }

  async descendantIds(id: string): Promise<string[]> {
    return [...getCategoryDescendantIds(await this.list(), id)];
  }

  async getDescendants(id: string): Promise<CategoryRecord[]> {
    const ids = new Set(await this.descendantIds(id));
    return (await this.list()).filter(({ id }) => ids.has(id));
  }

  private async requireCategory(id: string): Promise<CategoryRecord> {
    const category = await this.findById(id);
    if (!category) {
      throw new CategoryRepositoryError(
        'CATEGORY_NOT_FOUND',
        'The category does not exist.',
      );
    }
    return category;
  }

  private async assertParent(parentId: string | null): Promise<void> {
    if (parentId && !(await this.findById(parentId))) {
      throw new CategoryRepositoryError(
        'CATEGORY_PARENT_NOT_FOUND',
        'The parent category does not exist.',
      );
    }
  }

  private normalizeName(name: string): string {
    try {
      return normalizeCategoryName(name);
    } catch {
      throw new CategoryRepositoryError(
        'CATEGORY_NAME_INVALID',
        'Category name cannot be empty.',
      );
    }
  }

  private async nextPosition(parentId: string | null): Promise<number> {
    const siblings = (await this.list()).filter(
      (category) => category.parentId === parentId,
    );
    return siblings.length
      ? Math.max(...siblings.map(({ position }) => position)) + 1
      : 0;
  }

  private async coalescableOperations(id: string): Promise<OutboxRecord[]> {
    return (await this.outbox.listForEntity(id, 'category')).filter(
      ({ status }) => status === 'pending' || status === 'failed',
    );
  }

  private async upsertOperation(
    category: CategoryRecord,
    timestamp: string,
  ): Promise<void> {
    const operations = await this.coalescableOperations(category.id);
    const reusable =
      operations.find(({ operation }) => operation === 'create') ??
      operations.find(({ operation }) => operation === 'update');
    if (reusable) {
      await this.outbox.save(this.resetOperation(reusable, category));
    } else {
      await this.outbox.add(
        this.createOperation('update', category, timestamp),
      );
    }
  }

  private createOperation(
    operation: OutboxRecord['operation'],
    category: CategoryRecord,
    createdAt: string,
  ): OutboxRecord {
    return {
      id: this.generateId(),
      entityId: category.id,
      entityType: 'category',
      operation,
      baseVersion: category.version,
      payload: category,
      createdAt,
      retryCount: 0,
      status: 'pending',
    };
  }

  private resetOperation(
    operation: OutboxRecord,
    payload: CategoryRecord,
  ): OutboxRecord {
    return {
      ...operation,
      payload,
      retryCount: 0,
      status: 'pending',
      lastError: undefined,
      nextRetryAt: undefined,
      processingStartedAt: undefined,
    };
  }

  private generateId(): string {
    return generateId();
  }

  private now(): string {
    return new Date().toISOString();
  }
}
