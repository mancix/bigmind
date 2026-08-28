import { Injectable } from '@nestjs/common';
import type { CategoryData, CategorySyncOperation } from '@bigmind/contracts';
import {
  normalizeCategoryIcon,
  normalizeCategoryName,
} from '@bigmind/domain/categories';

import type { DatabaseTransaction } from '../database/database.service';
import {
  CategoriesRepository,
  type CategoryRow,
} from './categories.repository';

export type CategoryMutationResult =
  | { status: 'accepted'; category: CategoryRow }
  | { status: 'not_found' }
  | { status: 'conflict'; category: CategoryRow }
  | { status: 'rejected'; code: string; message: string };

@Injectable()
export class CategoriesService {
  constructor(private readonly repository: CategoriesRepository) {}

  async existsActive(
    transaction: DatabaseTransaction,
    workspaceId: string,
    id: string,
  ): Promise<boolean> {
    const category = await this.repository.findById(transaction, workspaceId, id);
    return Boolean(category && !category.deletedAt);
  }

  async create(
    transaction: DatabaseTransaction,
    workspaceId: string,
    operation: CategorySyncOperation,
  ): Promise<CategoryMutationResult> {
    const invalid = await this.validate(transaction, workspaceId, operation);
    if (invalid) return invalid;
    const created = await this.repository.create(transaction, {
      id: operation.entityId,
      workspaceId,
      name: normalizeCategoryName(operation.payload.name),
      description: operation.payload.description ?? '',
      icon: normalizeCategoryIcon(operation.payload.icon),
      parentId: operation.payload.parentId,
      position: operation.payload.position,
      version: 1,
      createdAt: new Date(operation.payload.createdAt),
      updatedAt: new Date(operation.payload.updatedAt),
      deletedAt: null,
    });
    if (created) return { status: 'accepted', category: created };
    const current = await this.repository.findById(
      transaction,
      workspaceId,
      operation.entityId,
    );
    return current
      ? { status: 'conflict', category: current }
      : { status: 'not_found' };
  }

  async update(
    transaction: DatabaseTransaction,
    workspaceId: string,
    operation: CategorySyncOperation,
  ): Promise<CategoryMutationResult> {
    const invalid = await this.validate(transaction, workspaceId, operation);
    if (invalid) return invalid;
    const updated = await this.repository.update(
      transaction,
      workspaceId,
      operation.entityId,
      operation.baseVersion,
      {
        name: normalizeCategoryName(operation.payload.name),
        description: operation.payload.description ?? '',
        icon: normalizeCategoryIcon(operation.payload.icon),
        parentId: operation.payload.parentId,
        position: operation.payload.position,
        updatedAt: new Date(operation.payload.updatedAt),
      },
    );
    if (updated) return { status: 'accepted', category: updated };
    return this.notFoundOrConflict(transaction, workspaceId, operation.entityId);
  }

  async delete(
    transaction: DatabaseTransaction,
    workspaceId: string,
    operation: CategorySyncOperation,
  ): Promise<CategoryMutationResult> {
    if (
      await this.repository.hasActiveChildren(
        transaction,
        workspaceId,
        operation.entityId,
      )
    ) {
      return {
        status: 'rejected',
        code: 'CATEGORY_NOT_EMPTY',
        message: 'Move or delete the subcategories first.',
      };
    }
    if (
      await this.repository.hasActiveNotes(
        transaction,
        workspaceId,
        operation.entityId,
      )
    ) {
      return {
        status: 'rejected',
        code: 'CATEGORY_HAS_NOTES',
        message: 'Move the notes out of this category first.',
      };
    }
    const deleted = await this.repository.softDelete(
      transaction,
      workspaceId,
      operation.entityId,
      operation.baseVersion,
      operation.payload.deletedAt
        ? new Date(operation.payload.deletedAt)
        : new Date(),
    );
    if (deleted) return { status: 'accepted', category: deleted };
    return this.notFoundOrConflict(transaction, workspaceId, operation.entityId);
  }

  toContractCategory(category: CategoryRow): CategoryData {
    return {
      id: category.id,
      name: category.name,
      description: category.description ?? '',
      icon: category.icon,
      parentId: category.parentId,
      position: category.position,
      version: category.version,
      createdAt: category.createdAt.toISOString(),
      updatedAt: category.updatedAt.toISOString(),
      deletedAt: category.deletedAt?.toISOString() ?? null,
    };
  }

  private async validate(
    transaction: DatabaseTransaction,
    workspaceId: string,
    operation: CategorySyncOperation,
  ): Promise<Extract<CategoryMutationResult, { status: 'rejected' }> | undefined> {
    try {
      normalizeCategoryName(operation.payload.name);
    } catch {
      return {
        status: 'rejected',
        code: 'CATEGORY_NAME_INVALID',
        message: 'Category name cannot be empty.',
      };
    }
    let parentId = operation.payload.parentId;
    const visited = new Set<string>([operation.entityId]);
    while (parentId) {
      if (visited.has(parentId)) {
        return {
          status: 'rejected',
          code: 'CATEGORY_CYCLE',
          message: 'A category cannot be moved inside its descendants.',
        };
      }
      visited.add(parentId);
      const parent = await this.repository.findById(transaction, workspaceId, parentId);
      if (!parent || parent.deletedAt) {
        return {
          status: 'rejected',
          code: 'CATEGORY_PARENT_NOT_FOUND',
          message: 'The parent category does not exist.',
        };
      }
      parentId = parent.parentId;
    }
    return undefined;
  }

  private async notFoundOrConflict(
    transaction: DatabaseTransaction,
    workspaceId: string,
    id: string,
  ): Promise<CategoryMutationResult> {
    const current = await this.repository.findById(transaction, workspaceId, id);
    return current
      ? { status: 'conflict', category: current }
      : { status: 'not_found' };
  }
}
