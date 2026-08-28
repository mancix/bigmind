export interface NoteLink {
  id: string;
  sourceNoteId: string;
  targetNoteId: string;
  createdAt: string;
}

export interface NoteAlias {
  id: string;
  noteId: string;
  alias: string;
  createdAt: string;
}
