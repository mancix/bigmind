const RECENTS_KEY = 'bigmind_recent_notes';
const MAX_RECENTS = 3;

export interface RecentNote {
  id: string;
  title: string;
  templateType: string;
  openedAt: string;
}

export function getRecentNotes(): RecentNote[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentNote[];
  } catch {
    return [];
  }
}

export function recordRecentNote(note: { id: string; title: string; templateType: string }): void {
  const recents = getRecentNotes().filter((r) => r.id !== note.id);
  recents.unshift({
    id: note.id,
    title: note.title,
    templateType: note.templateType,
    openedAt: new Date().toISOString(),
  });
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
  window.dispatchEvent(new CustomEvent('recents-changed'));
}

export function removeRecentNote(noteId: string): void {
  const recents = getRecentNotes().filter((r) => r.id !== noteId);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  window.dispatchEvent(new CustomEvent('recents-changed'));
}

export function clearRecentNotes(): void {
  localStorage.removeItem(RECENTS_KEY);
  window.dispatchEvent(new CustomEvent('recents-changed'));
}
