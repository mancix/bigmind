import type { EntityId } from '../shared/entity-id.js';
import type { IsoTimestamp } from '../shared/timestamps.js';

export interface TodoList {
  id: EntityId;
  noteId: EntityId;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface TodoItem {
  id: EntityId;
  todoListId: EntityId;
  text: string;
  completed: boolean;
  position: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}
