import { NotificationsRepository } from '@bigmind/features';

import { storage } from '../../storage';
import { outboxRepository } from '../../sync/outbox-repository';
import { webWorkspaceContext } from '../workspaces/workspace-store';

export {
  NotificationsRepository,
  type CreateNotificationInput,
} from '@bigmind/features';

/** Web notification repository, backed by the Dexie storage adapter. */
export const notificationsRepository = new NotificationsRepository(
  storage,
  outboxRepository,
  webWorkspaceContext,
);