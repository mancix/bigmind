import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DatabaseService, type DatabaseTransaction } from '../database/database.service';
import { type NewUser, type UserRow, users } from '../database/schema';

@Injectable()
export class UsersRepository {
  constructor(private readonly database: DatabaseService) {}

  private db(tx?: DatabaseTransaction) {
    return tx ?? this.database.db;
  }

  async findById(
    id: string,
    tx?: DatabaseTransaction,
  ): Promise<UserRow | undefined> {
    const [user] = await this.db(tx)
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return user;
  }

  async findByEmail(
    email: string,
    tx?: DatabaseTransaction,
  ): Promise<UserRow | undefined> {
    const [user] = await this.db(tx)
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    return user;
  }

  async create(
    values: NewUser,
    tx?: DatabaseTransaction,
  ): Promise<UserRow> {
    const [created] = await this.db(tx)
      .insert(users)
      .values(values)
      .returning();

    return created;
  }
}
