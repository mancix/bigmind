import { CategoryRepository } from '@bigmind/features';

import { storage } from '../../storage';
import { outboxRepository } from '../../sync/outbox-repository';

export {
  CategoryRepository,
  CategoryRepositoryError,
  type CategoryErrorCode,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from '@bigmind/features';

/** Web category repository, backed by the Dexie storage adapter. */
export const categoryRepository = new CategoryRepository(
  storage,
  outboxRepository,
);
