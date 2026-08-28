const FAVORITES_KEY = 'bigmind_favorite_notes';
const MAX_FAVORITES = 5;

export interface FavoriteNote {
  id: string;
  title: string;
  templateType: string;
  addedAt: string;
}

export function getFavoriteNotes(): FavoriteNote[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as FavoriteNote[];
  } catch {
    return [];
  }
}

export function isFavorite(noteId: string): boolean {
  return getFavoriteNotes().some((f) => f.id === noteId);
}

export function toggleFavoriteNote(note: { id: string; title: string; templateType: string }): { added: boolean; error?: string } {
  const favorites = getFavoriteNotes();
  const existing = favorites.findIndex((f) => f.id === note.id);

  if (existing !== -1) {
    favorites.splice(existing, 1);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    return { added: false };
  }

  if (favorites.length >= MAX_FAVORITES) {
    return {
      added: false,
      error: `You already have ${MAX_FAVORITES} favorites. Please remove one before adding a new one.`,
    };
  }

  favorites.unshift({
    id: note.id,
    title: note.title,
    templateType: note.templateType,
    addedAt: new Date().toISOString(),
  });
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  return { added: true };
}

export function removeFavoriteNote(noteId: string): void {
  const favorites = getFavoriteNotes().filter((f) => f.id !== noteId);
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
}
