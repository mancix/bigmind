import { Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { DatabaseService, type DatabaseTransaction } from '../database/database.service';
import { type NewRefreshToken, type RefreshTokenRow, refreshTokens } from '../database/schema';

@Injectable()
export class RefreshTokensRepository {
  constructor(private readonly database: DatabaseService) {}

  private db(tx?: DatabaseTransaction) {
    return tx ?? this.database.db;
  }

  async create(
    values: NewRefreshToken,
    tx?: DatabaseTransaction,
  ): Promise<RefreshTokenRow> {
    const [created] = await this.db(tx)
      .insert(refreshTokens)
      .values(values)
      .returning();

    return created;
  }

  async findValidByHash(
    tokenHash: string,
    tx?: DatabaseTransaction,
  ): Promise<RefreshTokenRow | undefined> {
    const [token] = await this.db(tx)
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          sql`${refreshTokens.expiresAt} > now()`,
        ),
      )
      .limit(1);

    return token;
  }

  async revoke(
    id: string,
    tx?: DatabaseTransaction,
  ): Promise<void> {
    await this.db(tx)
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, id));
  }

  async revokeAllForUser(
    userId: string,
    tx?: DatabaseTransaction,
  ): Promise<void> {
    await this.db(tx)
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }
}
