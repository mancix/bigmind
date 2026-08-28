import { db, type NoteRecord } from '../../storage/database';
import { NoteSearchIndex } from './search-index';
import type { SearchResult } from './search.types';

export class SearchService {
  private index: NoteSearchIndex;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private onCreating: ((_primKey: unknown, obj: NoteRecord) => void) | null = null;
  private onUpdating: ((modifications: object, primKey: unknown, obj: NoteRecord) => void) | null = null;
  private onDeleting: ((primKey: unknown) => void) | null = null;

  constructor() {
    this.index = new NoteSearchIndex();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      await this.index.initialize();
      this.subscribeToNotes();
      this.initialized = true;
    })();

    return this.initPromise;
  }

  destroy(): void {
    if (this.onCreating) {
      db.notes.hook('creating').unsubscribe(this.onCreating);
      this.onCreating = null;
    }
    if (this.onUpdating) {
      db.notes.hook('updating').unsubscribe(this.onUpdating);
      this.onUpdating = null;
    }
    if (this.onDeleting) {
      db.notes.hook('deleting').unsubscribe(this.onDeleting);
      this.onDeleting = null;
    }
    this.index.clear();
    this.initialized = false;
  }

  search(query: string): SearchResult[] {
    return this.index.search(query);
  }

  private subscribeToNotes(): void {
    this.onCreating = (_primKey: unknown, obj: NoteRecord) => {
      if (!obj.deletedAt) {
        this.index.addNote(obj);
      }
    };
    db.notes.hook('creating').subscribe(this.onCreating);

    this.onUpdating = (modifications: object, primKey: unknown, obj: NoteRecord) => {
      const updated: NoteRecord = {
        ...obj,
        ...(modifications as Partial<NoteRecord>),
        id: primKey as string,
      };

      if (updated.deletedAt) {
        this.index.removeNote(updated.id);
      } else {
        this.index.addNote(updated);
      }
    };
    db.notes.hook('updating').subscribe(this.onUpdating);

    this.onDeleting = (primKey: unknown) => {
      this.index.removeNote(primKey as string);
    };
    db.notes.hook('deleting').subscribe(this.onDeleting);
  }
}

export const searchService = new SearchService();
