import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../database/database.service';

@Injectable()
export class SearchRepository {
  constructor(private readonly database: DatabaseService) {}

  async search(
    workspaceId: string,
    query: string,
    limit: number,
    offset: number,
  ): Promise<{ items: Array<{ id: string; title: string; snippet: string; score: number }>; total: number }> {
    const tsQuery = sql`plainto_tsquery('english', ${query})`;
    const wsIdParam = sql`${workspaceId}::uuid`;
    const limitParam = sql`${limit}`;
    const offsetParam = sql`${offset}`;

    const [items, totalResult] = await Promise.all([
      this.database.db.execute(sql`
        SELECT
          id,
          title,
          ts_headline('english', content, ${tsQuery}, 'MaxWords=50, MinWords=20') AS snippet,
          ts_rank(search_vector, ${tsQuery}) AS score
        FROM notes
        WHERE workspace_id = ${wsIdParam}
          AND deleted_at IS NULL
          AND search_vector @@ ${tsQuery}
        ORDER BY score DESC, updated_at DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}
      `),
      this.database.db.execute(sql`
        SELECT COUNT(*)::int AS total
        FROM notes
        WHERE workspace_id = ${wsIdParam}
          AND deleted_at IS NULL
          AND search_vector @@ ${tsQuery}
      `),
    ]);

    const rows = items.rows as Array<{
      id: string;
      title: string;
      snippet: string;
      score: number;
    }>;

    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        snippet: row.snippet,
        score: row.score,
      })),
      total: (totalResult.rows[0] as { total: number } | undefined)?.total ?? 0,
    };
  }
}
