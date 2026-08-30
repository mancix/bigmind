import { LinkRepository } from '@bigmind/features';

import { storage } from '../../storage';
import { outboxRepository } from '../../sync/outbox-repository';

export { LinkRepository } from '@bigmind/features';

/** Web link repository, backed by the Dexie storage adapter. */
export const linkRepository = new LinkRepository(storage, outboxRepository);
