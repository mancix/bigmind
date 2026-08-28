import { Injectable } from '@nestjs/common';
import type {
  CategorySyncOperation,
  NoteLinkSyncOperation,
  NoteSyncOperation,
  PullResponse,
  PushOperationResult,
  SyncOperation,
} from '@bigmind/contracts';

import {
  CategoriesService,
  type CategoryMutationResult,
} from '../categories/categories.service';
import {
  DatabaseService,
  type DatabaseTransaction,
} from '../database/database.service';
import { NotesService, type NoteMutationResult } from '../notes/notes.service';
import { LinksService } from '../links/links.service';
import { SyncRepository } from './sync.repository';

@Injectable()
export class SyncService {
  constructor(
    private readonly database: DatabaseService,
    private readonly notes: NotesService,
    private readonly categories: CategoriesService,
    private readonly links: LinksService,
    private readonly syncRepository: SyncRepository,
  ) {}

  async push(operations: SyncOperation[], workspaceId: string): Promise<PushOperationResult[]> {
    return this.database.db.transaction(async (transaction) => {
      const results: PushOperationResult[] = [];
      const order: Record<string, number> = { category: 0, note: 1, link: 2, todo_item: 3, reminder: 4, notification: 5 };
      const ordered = [...operations].sort(
        (left, right) => order[left.entityType] - order[right.entityType],
      );

      for (const operation of ordered) {
        await this.syncRepository.lockOperation(transaction, operation.operationId);
        const processed = await this.syncRepository.findProcessed(
          transaction,
          workspaceId,
          operation.operationId,
        );
        if (processed) {
          results.push(processed);
          continue;
        }
        const result = await this.processOperation(transaction, operation, workspaceId);
        await this.syncRepository.saveProcessed(
          transaction,
          workspaceId,
          operation.entityId,
          result,
        );
        results.push(result);
      }
      return results;
    });
  }

  async pull(cursor: number, limit: number, workspaceId: string): Promise<PullResponse> {
    return this.database.db.transaction((transaction) =>
      this.syncRepository.pull(
        transaction,
        workspaceId,
        cursor,
        limit,
      ),
    );
  }

  private async processOperation(
    transaction: DatabaseTransaction,
    operation: SyncOperation,
    workspaceId: string,
  ): Promise<PushOperationResult> {
    if (operation.entityId !== operation.payload.id) {
      return {
        status: 'rejected',
        operationId: operation.operationId,
        errorCode: 'entity_id_mismatch',
        message: 'The entity id must match the payload id.',
      };
    }
    if (operation.entityType === 'note') {
      return this.processNote(transaction, operation, workspaceId);
    }
    if (operation.entityType === 'category') {
      return this.processCategory(transaction, operation, workspaceId);
    }
    if (operation.entityType === 'todo_item') {
      return this.processTodoItem(transaction, operation, workspaceId);
    }
    if (operation.entityType === 'reminder') {
      return this.processReminder(transaction, operation, workspaceId);
    }
    if (operation.entityType === 'notification') {
      return this.processNotification(transaction, operation, workspaceId);
    }
    return this.processLink(transaction, operation, workspaceId);
  }

  private async processNote(
    transaction: DatabaseTransaction,
    operation: NoteSyncOperation,
    workspaceId: string,
  ): Promise<PushOperationResult> {
    if (
      operation.payload.categoryId &&
      !(await this.categories.existsActive(
        transaction,
        workspaceId,
        operation.payload.categoryId,
      ))
    ) {
      return this.rejected(
        operation,
        'CATEGORY_NOT_FOUND',
        'The assigned category does not exist.',
      );
    }
    const mutation = await this.mutateNote(transaction, operation, workspaceId);
    if (mutation.status === 'not_found') {
      return this.rejected(operation, 'note_not_found', 'The note does not exist.');
    }
    if (mutation.status === 'conflict') {
      return {
        status: 'conflict',
        operationId: operation.operationId,
        entityId: operation.entityId,
        entityType: 'note',
        clientBaseVersion: operation.baseVersion,
        currentServerVersion: mutation.note.version,
        currentServerData: this.notes.toContractNote(mutation.note),
      };
    }
    const payload = this.notes.toContractNote(mutation.note);
    const serverSequence = await this.syncRepository.appendChange(
      transaction,
      workspaceId,
      {
        entityId: operation.entityId,
        entityType: 'note',
        operationType: operation.operationType,
        version: mutation.note.version,
        payload,
        changedAt: mutation.note.updatedAt.toISOString(),
      },
    );

    if (operation.operationType === 'delete') {
      const deletedLinks = await this.links.deleteForNote(
        transaction,
        workspaceId,
        operation.entityId,
        mutation.note.updatedAt,
      );
      for (const link of deletedLinks) {
        await this.appendLinkChange(transaction, link, 'delete', workspaceId);
      }
    }
    return {
      status: 'accepted',
      operationId: operation.operationId,
      entityId: operation.entityId,
      entityType: 'note',
      serverVersion: mutation.note.version,
      serverSequence,
    };
  }

  private async processCategory(
    transaction: DatabaseTransaction,
    operation: CategorySyncOperation,
    workspaceId: string,
  ): Promise<PushOperationResult> {
    const mutation = await this.mutateCategory(transaction, operation, workspaceId);
    if (mutation.status === 'not_found') {
      return this.rejected(
        operation,
        'CATEGORY_NOT_FOUND',
        'The category does not exist.',
      );
    }
    if (mutation.status === 'rejected') {
      return this.rejected(operation, mutation.code, mutation.message);
    }
    if (mutation.status === 'conflict') {
      return {
        status: 'conflict',
        operationId: operation.operationId,
        entityId: operation.entityId,
        entityType: 'category',
        clientBaseVersion: operation.baseVersion,
        currentServerVersion: mutation.category.version,
        currentServerData: this.categories.toContractCategory(mutation.category),
      };
    }
    const payload = this.categories.toContractCategory(mutation.category);
    const serverSequence = await this.syncRepository.appendChange(
      transaction,
      workspaceId,
      {
        entityId: operation.entityId,
        entityType: 'category',
        operationType: operation.operationType,
        version: mutation.category.version,
        payload,
        changedAt: mutation.category.updatedAt.toISOString(),
      },
    );
    return {
      status: 'accepted',
      operationId: operation.operationId,
      entityId: operation.entityId,
      entityType: 'category',
      serverVersion: mutation.category.version,
      serverSequence,
    };
  }

  private async processLink(
    transaction: DatabaseTransaction,
    operation: NoteLinkSyncOperation,
    workspaceId: string,
  ): Promise<PushOperationResult> {
    const mutation = operation.operationType === 'create'
      ? await this.links.create(transaction, workspaceId, operation)
      : await this.links.delete(transaction, workspaceId, operation);

    if (mutation.status === 'not_found') {
      return this.rejected(operation, 'LINK_NOT_FOUND', 'The link does not exist.');
    }
    if (mutation.status === 'rejected') {
      return this.rejected(operation, mutation.code, mutation.message);
    }
    if (mutation.status === 'conflict') {
      return this.rejected(
        operation,
        'LINK_VERSION_CONFLICT',
        'The link has changed since the local operation.',
      );
    }

    const serverSequence = await this.appendLinkChange(
      transaction,
      mutation.link,
      operation.operationType,
      workspaceId,
    );
    return {
      status: 'accepted',
      operationId: operation.operationId,
      entityId: operation.entityId,
      entityType: 'link',
      serverVersion: mutation.link.version,
      serverSequence,
    };
  }

  private async processTodoItem(
    transaction: DatabaseTransaction,
    operation: SyncOperation,
    workspaceId: string,
  ): Promise<PushOperationResult> {
    const serverSequence = await this.syncRepository.appendChange(
      transaction,
      workspaceId,
      {
        entityId: operation.entityId,
        entityType: 'todo_item',
        operationType: operation.operationType,
        version: operation.baseVersion + 1,
        payload: operation.payload,
        changedAt: operation.createdAt,
      },
    );

    return {
      status: 'accepted',
      operationId: operation.operationId,
      entityId: operation.entityId,
      entityType: 'todo_item',
      serverVersion: operation.baseVersion + 1,
      serverSequence,
    };
  }

  private async processReminder(
    transaction: DatabaseTransaction,
    operation: SyncOperation,
    workspaceId: string,
  ): Promise<PushOperationResult> {
    const serverSequence = await this.syncRepository.appendChange(
      transaction,
      workspaceId,
      {
        entityId: operation.entityId,
        entityType: 'reminder',
        operationType: operation.operationType,
        version: operation.baseVersion + 1,
        payload: operation.payload,
        changedAt: operation.createdAt,
      },
    );

    return {
      status: 'accepted',
      operationId: operation.operationId,
      entityId: operation.entityId,
      entityType: 'reminder',
      serverVersion: operation.baseVersion + 1,
      serverSequence,
    };
  }

  private async processNotification(
    transaction: DatabaseTransaction,
    operation: SyncOperation,
    workspaceId: string,
  ): Promise<PushOperationResult> {
    const serverSequence = await this.syncRepository.appendChange(
      transaction,
      workspaceId,
      {
        entityId: operation.entityId,
        entityType: 'notification',
        operationType: operation.operationType,
        version: operation.baseVersion + 1,
        payload: operation.payload,
        changedAt: operation.createdAt,
      },
    );

    return {
      status: 'accepted',
      operationId: operation.operationId,
      entityId: operation.entityId,
      entityType: 'notification',
      serverVersion: operation.baseVersion + 1,
      serverSequence,
    };
  }

  private appendLinkChange(
    transaction: DatabaseTransaction,
    link: Parameters<LinksService['toContractLink']>[0],
    operationType: 'create' | 'delete',
    workspaceId: string,
  ): Promise<number> {
    return this.syncRepository.appendChange(
      transaction,
      workspaceId,
      {
        entityId: link.id,
        entityType: 'link',
        operationType,
        version: link.version,
        payload: this.links.toContractLink(link),
        changedAt: (link.deletedAt ?? link.createdAt).toISOString(),
      },
    );
  }

  private mutateNote(
    transaction: DatabaseTransaction,
    operation: NoteSyncOperation,
    workspaceId: string,
  ): Promise<NoteMutationResult> {
    switch (operation.operationType) {
      case 'create': return this.notes.create(transaction, workspaceId, operation);
      case 'update': return this.notes.update(transaction, workspaceId, operation);
      case 'delete': return this.notes.delete(transaction, workspaceId, operation);
    }
  }

  private mutateCategory(
    transaction: DatabaseTransaction,
    operation: CategorySyncOperation,
    workspaceId: string,
  ): Promise<CategoryMutationResult> {
    switch (operation.operationType) {
      case 'create': return this.categories.create(transaction, workspaceId, operation);
      case 'update': return this.categories.update(transaction, workspaceId, operation);
      case 'delete': return this.categories.delete(transaction, workspaceId, operation);
    }
  }

  private rejected(
    operation: SyncOperation,
    errorCode: string,
    message: string,
  ): PushOperationResult {
    return {
      status: 'rejected',
      operationId: operation.operationId,
      errorCode,
      message,
    };
  }
}
