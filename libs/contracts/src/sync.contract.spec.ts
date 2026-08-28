import { describe, expect, it } from 'vitest';

import {
  categoryDataSchema,
  noteLinkDataSchema,
  pushRequestSchema,
  pushResponseSchema,
} from './sync.schemas.js';

describe('sync contract schemas', () => {
  it('rejects malformed operation identifiers', () => {
    expect(
      pushRequestSchema.safeParse({
        operations: [{ operationId: 'not-a-uuid' }],
      }).success,
    ).toBe(false);
  });

  it('parses accepted, rejected, and conflict result variants', () => {
    const result = pushResponseSchema.safeParse({
      results: [
        {
          status: 'accepted',
          operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
          entityId: '11111111-1111-4111-8111-111111111111',
          entityType: 'note',
          serverVersion: 1,
          serverSequence: 1,
        },
        {
          status: 'rejected',
          operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
          errorCode: 'note_not_found',
          message: 'The note does not exist.',
        },
        {
          status: 'conflict',
          operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003',
          entityId: '11111111-1111-4111-8111-111111111111',
          entityType: 'note',
          clientBaseVersion: 1,
          currentServerVersion: 2,
          currentServerData: {
            id: '11111111-1111-4111-8111-111111111111',
            title: 'Server note',
            content: '',
            categoryId: null,
            templateType: 'MARKDOWN',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:01:00.000Z',
            version: 2,
          },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('defaults legacy category payloads to no icon', () => {
    expect(categoryDataSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Work',
      parentId: null,
      position: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: 1,
      deletedAt: null,
    })).toMatchObject({ icon: null });
  });

  it('accepts a single emoji category icon and rejects text', () => {
    const category = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Work',
      parentId: null,
      position: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: 1,
      deletedAt: null,
    };

    expect(categoryDataSchema.safeParse({ ...category, icon: '👩🏽‍💻' }).success)
      .toBe(true);
    expect(categoryDataSchema.safeParse({ ...category, icon: 'work' }).success)
      .toBe(false);
    expect(categoryDataSchema.safeParse({ ...category, icon: '🚀📚' }).success)
      .toBe(false);
  });

  it('validates synchronized note links', () => {
    expect(noteLinkDataSchema.safeParse({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      sourceNoteId: '11111111-1111-4111-8111-111111111111',
      targetNoteId: '22222222-2222-4222-8222-222222222222',
      createdAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      version: 1,
    }).success).toBe(true);
  });
});
