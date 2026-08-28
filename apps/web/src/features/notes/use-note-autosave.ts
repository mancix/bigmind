import { useCallback, useEffect, useRef, useState } from 'react';

import {
  noteRepository,
  type UpdateNoteInput,
} from './note-repository';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseNoteAutosaveOptions {
  noteId: string;
  delay?: number;
}

export function useNoteAutosave({
  noteId,
  delay = 600,
}: UseNoteAutosaveOptions) {
  const [status, setStatus] = useState<SaveStatus>('idle');

  const pendingChangesRef = useRef<UpdateNoteInput>({});
  const timeoutRef = useRef<number | undefined>(undefined);
  const savePromiseRef = useRef<Promise<void> | null>(null);

  const savePendingChanges = useCallback(async () => {
    const changes = pendingChangesRef.current;

    if (Object.keys(changes).length === 0) {
      return;
    }

    pendingChangesRef.current = {};
    setStatus('saving');

    const savePromise = noteRepository.update(noteId, changes);
    savePromiseRef.current = savePromise;

    try {
      await savePromise;
      setStatus('saved');
    } catch (error) {
      pendingChangesRef.current = {
        ...changes,
        ...pendingChangesRef.current,
      };

      setStatus('error');
      console.error('Failed to save note locally.', error);
    } finally {
      if (savePromiseRef.current === savePromise) {
        savePromiseRef.current = null;
      }
    }
  }, [noteId]);

  const scheduleSave = useCallback(
    (changes: UpdateNoteInput) => {
      pendingChangesRef.current = {
        ...pendingChangesRef.current,
        ...changes,
      };

      setStatus('idle');

      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = undefined;
        void savePendingChanges();
      }, delay);
    },
    [delay, savePendingChanges],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
      }

      void savePendingChanges();
    };
  }, [savePendingChanges]);

  return {
    status,
    scheduleSave,
    saveNow: savePendingChanges,
  };
}