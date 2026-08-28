import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';

import { linkRepository } from './link-repository';

interface NoteLinksPanelProps {
  noteId: string;
}

export function NoteLinksPanel({ noteId }: NoteLinksPanelProps) {
  const outgoing = useLiveQuery(
    () => linkRepository.getOutgoingLinks(noteId),
    [noteId],
  );
  const backlinks = useLiveQuery(
    () => linkRepository.getBacklinks(noteId),
    [noteId],
  );

  return (
    <section className="mt-10 grid gap-8 border-t border-slate-200 pt-8 sm:grid-cols-2">
      <LinkList title="Outgoing Links" notes={outgoing} />
      <LinkList title="Backlinks" notes={backlinks} />
    </section>
  );
}

function LinkList({
  title,
  notes,
}: {
  title: string;
  notes: { id: string; title: string }[] | undefined;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {notes === undefined ? (
        <p className="mt-3 text-sm text-slate-400">Loading links...</p>
      ) : notes.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No links</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {notes.map((note) => (
            <li key={note.id}>
              <Link
                to="/notes/$noteId"
                params={{ noteId: note.id }}
                className="text-sm font-medium text-blue-600 hover:underline"
              >
                {note.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
