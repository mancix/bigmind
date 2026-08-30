import { NoteRepository } from '@bigmind/features';

import { storage } from '../../storage';
import { outboxRepository } from '../../sync/outbox-repository';

export {
  NoteRepository,
  type CreateNoteInput,
  type NoteListQuery,
  type UpdateNoteInput,
} from '@bigmind/features';

/** Web note repository, backed by the Dexie storage adapter. */
export const noteRepository = new NoteRepository(storage, outboxRepository);
