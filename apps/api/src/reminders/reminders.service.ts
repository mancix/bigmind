import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { validateReminderTitle } from '@bigmind/domain/reminders';

import { WorkspaceRepository } from '../workspaces/workspaces.repository';
import { RemindersRepository } from './reminders.repository';

@Injectable()
export class RemindersService {
  constructor(
    private readonly remindersRepository: RemindersRepository,
    private readonly workspaceRepository: WorkspaceRepository,
  ) {}

  async list(workspaceId: string, requesterUserId: string) {
    await this.assertMember(workspaceId, requesterUserId);
    return this.remindersRepository.list(workspaceId);
  }

  async create(
    workspaceId: string,
    data: { title: string; description?: string; dueAt: string; linkedNoteId?: string | null },
    requesterUserId: string,
  ) {
    const role = await this.assertMember(workspaceId, requesterUserId);
    if (role === 'VIEWER') throw new ForbiddenException('Access denied');
    validateReminderTitle(data.title);
    if (!data.dueAt) throw new BadRequestException('dueAt is required');

    const now = new Date();
    return this.remindersRepository.create({
      id: randomUUID(),
      workspaceId,
      title: data.title.trim(),
      description: data.description ?? '',
      dueAt: new Date(data.dueAt),
      completed: false,
      createdBy: requesterUserId,
      linkedNoteId: data.linkedNoteId ?? null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  async update(
    workspaceId: string,
    id: string,
    data: { title?: string; description?: string; dueAt?: string; completed?: boolean; linkedNoteId?: string | null },
    requesterUserId: string,
  ) {
    const role = await this.assertMember(workspaceId, requesterUserId);
    if (role === 'VIEWER') throw new ForbiddenException('Access denied');
    if (data.title !== undefined) validateReminderTitle(data.title);

    return this.remindersRepository.update(id, {
      ...(data.title !== undefined ? { title: data.title.trim() } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.dueAt !== undefined ? { dueAt: new Date(data.dueAt) } : {}),
      ...(data.completed !== undefined ? { completed: data.completed } : {}),
      ...(data.linkedNoteId !== undefined ? { linkedNoteId: data.linkedNoteId } : {}),
      updatedAt: new Date(),
    });
  }

  async remove(
    workspaceId: string,
    id: string,
    requesterUserId: string,
  ): Promise<void> {
    const role = await this.assertMember(workspaceId, requesterUserId);
    if (role === 'VIEWER') throw new ForbiddenException('Access denied');
    await this.remindersRepository.softDelete(id);
  }

  private async assertMember(workspaceId: string, userId: string) {
    const role = await this.workspaceRepository.getUserRole(workspaceId, userId);
    if (!role) throw new ForbiddenException('Access denied to this workspace');
    return role;
  }
}
