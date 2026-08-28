import { Injectable } from '@nestjs/common';
import type {
  PullResponse,
  PushOperationResult,
  RemoteChange,
} from '@bigmind/contracts';
import { remoteChangeSchema } from '@bigmind/contracts';
import { and, asc, eq, gt, sql } from 'drizzle-orm';

import type { DatabaseTransaction } from '../database/database.service';
import { changeLog, syncOperations } from '../database/schema';

@Injectable()
export class SyncRepository {
  async lockOperation(
    transaction: DatabaseTransaction,
    operationId: string,
  ): Promise<void> {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${operationId}))`,
    );
  }

  async findProcessed(
    transaction: DatabaseTransaction,
    workspaceId: string,
    operationId: string,
  ): Promise<PushOperationResult | undefined> {
    const [processed] = await transaction
      .select({ result: syncOperations.resultPayload })
      .from(syncOperations)
      .where(
        and(
          eq(syncOperations.workspaceId, workspaceId),
          eq(syncOperations.operationId, operationId),
        ),
      )
      .limit(1);

    return processed?.result;
  }

  async saveProcessed(
    transaction: DatabaseTransaction,
    workspaceId: string,
    entityId: string,
    result: PushOperationResult,
  ): Promise<void> {
    await transaction.insert(syncOperations).values({
      operationId: result.operationId,
      workspaceId,
      entityId,
      resultStatus: result.status,
      resultPayload: result,
    });
  }

  async appendChange(
    transaction: DatabaseTransaction,
    workspaceId: string,
    change: Omit<RemoteChange, 'sequence'>,
  ): Promise<number> {
    const [inserted] = await transaction
      .insert(changeLog)
      .values({
        workspaceId,
        entityId: change.entityId,
        entityType: change.entityType,
        operationType: change.operationType,
        version: change.version,
        payload: change.payload,
        changedAt: new Date(change.changedAt),
      })
      .returning({ sequence: changeLog.sequence });

    if (!inserted) throw new Error('Failed to append the change log entry.');
    return inserted.sequence;
  }

  async pull(
    transaction: DatabaseTransaction,
    workspaceId: string,
    cursor: number,
    limit: number,
  ): Promise<PullResponse> {
    const rows = await transaction
      .select()
      .from(changeLog)
      .where(
        and(
          eq(changeLog.workspaceId, workspaceId),
          gt(changeLog.sequence, cursor),
        ),
      )
      .orderBy(asc(changeLog.sequence))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const changes: RemoteChange[] = page.map((row) => {
      const payload =
        row.entityType === 'note' &&
        row.payload &&
        typeof row.payload === 'object' &&
        !('categoryId' in row.payload)
          ? { ...row.payload, categoryId: null }
          : row.entityType === 'category' &&
              row.payload &&
              typeof row.payload === 'object' &&
              !('icon' in row.payload)
            ? { ...row.payload, icon: null }
            : row.payload;

      return remoteChangeSchema.parse({
        sequence: row.sequence,
        entityId: row.entityId,
        entityType: row.entityType,
        operationType: row.operationType,
        version: row.version,
        payload,
        changedAt: row.changedAt.toISOString(),
      });
    });

    return {
      changes,
      nextCursor: changes.at(-1)?.sequence ?? cursor,
      hasMore,
    };
  }
}
