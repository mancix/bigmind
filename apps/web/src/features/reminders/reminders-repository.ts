import { RemindersRepository } from '@bigmind/features';

import { storage } from '../../storage';
import { outboxRepository } from '../../sync/outbox-repository';
import { webWorkspaceContext } from '../workspaces/workspace-store';

export {
  RemindersRepository,
  type CreateReminderInput,
  type UpdateReminderInput,
} from '@bigmind/features';

/** Web reminder repository, backed by the Dexie storage adapter. */
export const remindersRepository = new RemindersRepository(
  storage,
  outboxRepository,
  webWorkspaceContext,
);