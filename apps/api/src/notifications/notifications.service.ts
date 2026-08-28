import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { NotificationType } from '@bigmind/domain/notifications';
import { validateNotificationTitle } from '@bigmind/domain/notifications';

import { WorkspaceRepository } from '../workspaces/workspaces.repository';
import { NotificationsRepository } from './notifications.repository';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
    private readonly workspaceRepository: WorkspaceRepository,
  ) {}

  async list(workspaceId: string, requesterUserId: string) {
    await this.assertMember(workspaceId, requesterUserId);
    return this.notificationsRepository.list(workspaceId);
  }

  async create(
    workspaceId: string,
    data: { type: NotificationType; title: string; body?: string },
    requesterUserId: string,
  ) {
    await this.assertMember(workspaceId, requesterUserId);
    validateNotificationTitle(data.title);
    return this.notificationsRepository.create({
      id: randomUUID(),
      workspaceId,
      type: data.type,
      title: data.title.trim(),
      body: data.body ?? '',
      read: false,
      version: 1,
      createdAt: new Date(),
    });
  }

  async markRead(
    workspaceId: string,
    id: string,
    requesterUserId: string,
  ): Promise<void> {
    await this.assertMember(workspaceId, requesterUserId);
    const existing = await this.notificationsRepository.findById(id);
    if (!existing) throw new NotFoundException('Notification not found');
    await this.notificationsRepository.markRead(id);
  }

  async markAllRead(
    workspaceId: string,
    requesterUserId: string,
  ): Promise<void> {
    await this.assertMember(workspaceId, requesterUserId);
    await this.notificationsRepository.markAllRead(workspaceId);
  }

  async remove(
    workspaceId: string,
    id: string,
    requesterUserId: string,
  ): Promise<void> {
    await this.assertMember(workspaceId, requesterUserId);
    const existing = await this.notificationsRepository.findById(id);
    if (!existing) throw new NotFoundException('Notification not found');
    await this.notificationsRepository.delete(id);
  }

  private async assertMember(workspaceId: string, userId: string) {
    const role = await this.workspaceRepository.getUserRole(workspaceId, userId);
    if (!role) throw new ForbiddenException('Access denied to this workspace');
    return role;
  }
}
