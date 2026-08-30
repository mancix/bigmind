import MiniSearch from 'minisearch';

import { storage, type NoteRecord } from '../../storage';
import type { SearchResult } from './search.types';

interface SearchDocument {
  id: string;
  title: string;
  content: string;
}

function generatePreview(
  content: string,
  query: string,
  maxLength = 120,
): string {
  if (!content) return '';

  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerContent.indexOf(lowerQuery);

  if (matchIndex === -1) {
    return content.length > maxLength
      ? content.slice(0, maxLength) + '…'
      : content;
  }

  const contextSize = Math.floor((maxLength - query.length) / 2);
  const start = Math.max(0, matchIndex - contextSize);
  const end = Math.min(content.length, start + maxLength);

  let snippet = content.slice(start, end);
  if (start > 0) snippet = '…' + snippet;
  if (end < content.length) snippet = snippet + '…';

  return snippet;
}

export class NoteSearchIndex {
  private miniSearch: MiniSearch<SearchDocument>;
  private ready = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.miniSearch = new MiniSearch<SearchDocument>({
      fields: ['title', 'content'],
      storeFields: ['title', 'content'],
      searchOptions: {
        boost: { title: 2 },
        prefix: true,
        fuzzy: 0.2,
      },
    });
  }

  get isReady(): boolean {
    return this.ready;
  }

  async initialize(): Promise<void> {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const notes = await storage.notes
        .filter((note) => !note.deletedAt)
        .toArray();

      const documents: SearchDocument[] = notes.map((note) => ({
        id: note.id,
        title: note.title,
        content: note.content,
      }));

      if (documents.length > 0) {
        this.miniSearch.removeAll();
        await this.miniSearch.addAllAsync(documents);
      }

      this.ready = true;
    })();

    return this.initPromise;
  }

  search(query: string): SearchResult[] {
    if (!this.ready || !query.trim()) return [];

    const results = this.miniSearch.search(query);

    return results.map((result) => ({
      id: result.id as string,
      title: result.title as string,
      score: result.score,
      preview: generatePreview(result.content as string, query),
    }));
  }

  async addNote(note: NoteRecord): Promise<void> {
    if (!this.ready) return;
    if (note.deletedAt) {
      this.removeNote(note.id);
      return;
    }

    const doc: SearchDocument = {
      id: note.id,
      title: note.title,
      content: note.content,
    };
    try {
      this.miniSearch.discard(doc.id);
    } catch {
      // document not yet indexed — safe to ignore
    }
    this.miniSearch.add(doc);
  }

  removeNote(id: string): void {
    if (!this.ready) return;
    try {
      this.miniSearch.discard(id);
    } catch {
      // document not in index — safe to ignore
    }
  }

  clear(): void {
    this.miniSearch.removeAll();
    this.ready = false;
  }
}
