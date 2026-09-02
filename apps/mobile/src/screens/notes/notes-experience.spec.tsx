import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  categoryRepository,
  conflictRepository,
  linkRepository,
  mobileOutbox,
  noteRepository,
  remindersRepository,
} from '../../features/data/repositories';
import { storage } from '../../storage';
import { mobileSyncEngine } from '../../sync/sync-service';
import type { NotesStackParamList } from '../../navigation/types';
import { NotesListScreen } from './NotesListScreen';
import { NoteDetailScreen } from './NoteDetailScreen';

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  push: jest.fn(),
} as unknown as NativeStackScreenProps<
  NotesStackParamList,
  'NotesList'
>['navigation'];

describe('notes experience', () => {
  beforeEach(async () => {
    await storage.clearAll();
    jest.clearAllMocks();
    mobileSyncEngine.setOnline(true);
  });

  afterEach(async () => {
    await storage.clearAll();
    mobileSyncEngine.setOnline(true);
    jest.restoreAllMocks();
  });

  it('lists notes sorted by recency and opens the detail screen', async () => {
    await noteRepository.create({ title: 'Older', content: 'first' });
    const recent = await noteRepository.create({
      title: 'Newer',
      content: 'lorem **ipsum**',
    });

    const { findByText, getByTestId } = render(
      <NotesListScreen
        navigation={
          navigation as unknown as NativeStackScreenProps<
            NotesStackParamList,
            'NotesList'
          >['navigation']
        }
      />,
    );

    expect(await findByText('Newer')).toBeTruthy();
    // The shared domain rule renders a plain-text preview.
    expect(await findByText('lorem ipsum')).toBeTruthy();

    fireEvent.press(getByTestId(`note-row-${recent}`));
    expect(navigation.navigate).toHaveBeenCalledWith('NoteDetail', {
      noteId: recent,
    });
  });

  it('creates a new note from the list and opens its detail', async () => {
    const { getByTestId } = render(
      <NotesListScreen
        navigation={
          navigation as unknown as NativeStackScreenProps<
            NotesStackParamList,
            'NotesList'
          >['navigation']
        }
      />,
    );

    fireEvent.press(getByTestId('new-note'));

    await waitFor(() => expect(navigation.navigate).toHaveBeenCalled());
    expect(await noteRepository.count()).toBe(1);
  });

  it('loads, edits, and saves a note through the shared repository', async () => {
    const noteId = await noteRepository.create({
      title: 'Before',
      content: 'a',
    });

    const { getByTestId, findByTestId } = render(
      <NoteDetailScreen
        navigation={
          navigation as unknown as NativeStackScreenProps<
            NotesStackParamList,
            'NoteDetail'
          >['navigation']
        }
        route={
          {
            key: 'note-detail',
            name: 'NoteDetail',
            params: { noteId },
          } as unknown as NativeStackScreenProps<
            NotesStackParamList,
            'NoteDetail'
          >['route']
        }
      />,
    );

    // Read mode first — the detail screen opens as the read-only view.
    expect(await findByTestId('note-detail-title')).toBeTruthy();
    fireEvent.press(getByTestId('note-edit'));

    const titleInput = await findByTestId('note-title');
    expect(titleInput.props.value).toBe('Before');

    fireEvent.changeText(titleInput, 'After');
    fireEvent.changeText(getByTestId('note-content'), 'edited content');
    fireEvent.press(getByTestId('note-save'));

    await waitFor(async () => {
      const stored = await noteRepository.findById(noteId);
      expect(stored?.title).toBe('After');
      expect(stored?.content).toBe('edited content');
    });
  });

  // ── Editor autosave (debounced, offline-safe) ────────────────────

  it('autosaves content and title after inactivity and updates backlinks/wiki links', async () => {
    const target = await noteRepository.create({ title: 'Target' });
    const noteId = await noteRepository.create({
      title: 'Draft',
      content: 'See [[Target]]',
    });

    const { getByTestId, findByTestId } = render(
      <NoteDetailScreen
        navigation={
          navigation as unknown as NativeStackScreenProps<
            NotesStackParamList,
            'NoteDetail'
          >['navigation']
        }
        route={
          {
            key: 'note-detail',
            name: 'NoteDetail',
            params: { noteId },
          } as unknown as NativeStackScreenProps<
            NotesStackParamList,
            'NoteDetail'
          >['route']
        }
      />,
    );

    expect(await findByTestId('note-detail-title')).toBeTruthy();
    fireEvent.press(getByTestId('note-edit'));
    await findByTestId('note-title');

    // Typing starts a debounce; inactivity (auto delay) flushes the draft to
    // the shared repository WITHOUT leaving edit mode.
    fireEvent.changeText(getByTestId('note-content'), 'See [[Target]] again');

    await waitFor(
      async () => {
        const stored = await noteRepository.findById(noteId);
        expect(stored?.content).toBe('See [[Target]] again');
      },
      { timeout: 3000 },
    );

    // Still in edit mode (autosave must not exit), and a sync op is queued.
    expect(getByTestId('note-content')).toBeTruthy();
    const operations = await mobileOutbox.listForEntity(noteId, 'note');
    expect(operations.at(-1)?.payload).toMatchObject({
      content: 'See [[Target]] again',
    });

    // Wiki links were rebuilt: Target now has a backlink from the draft.
    const backlinks = await linkRepository.getBacklinks(target);
    expect(backlinks.map((backlink) => backlink.id)).toContain(noteId);

    // Editing the title autosaves too.
    fireEvent.changeText(getByTestId('note-title'), 'Renamed draft');
    await waitFor(
      async () => {
        const stored = await noteRepository.findById(noteId);
        expect(stored?.title).toBe('Renamed draft');
      },
      { timeout: 3000 },
    );
  });

  it('autosaves edits made fully offline (outbox queued, no network)', async () => {
    const noteId = await noteRepository.create({
      title: 'Offline draft',
      content: 'v1',
    });
    mobileSyncEngine.setOnline(false);

    const { getByTestId, findByTestId } = render(
      <NoteDetailScreen
        navigation={
          navigation as unknown as NativeStackScreenProps<
            NotesStackParamList,
            'NoteDetail'
          >['navigation']
        }
        route={
          {
            key: 'note-detail',
            name: 'NoteDetail',
            params: { noteId },
          } as unknown as NativeStackScreenProps<
            NotesStackParamList,
            'NoteDetail'
          >['route']
        }
      />,
    );

    expect(await findByTestId('note-detail-title')).toBeTruthy();
    fireEvent.press(getByTestId('note-edit'));
    await findByTestId('note-title');

    fireEvent.changeText(getByTestId('note-content'), 'v2 written offline');

    // Fully offline: the debounced autosave writes locally and coalesces a
    // pending outbox update — nothing reaches the network.
    await waitFor(
      async () => {
        const stored = await noteRepository.findById(noteId);
        expect(stored?.content).toBe('v2 written offline');
      },
      { timeout: 3000 },
    );
    const operations = await mobileOutbox.listForEntity(noteId, 'note');
    expect(operations.at(-1)?.payload).toMatchObject({
      content: 'v2 written offline',
    });
    expect(operations.at(-1)?.status).toBe('pending');

    // The detail screen reflects the offline save state.
    expect(await findByTestId('note-save-state')).toBeTruthy();
  });

  it('searches notes by title and content offline', async () => {
    const rust = await noteRepository.create({
      title: 'Rust notes',
      content: 'ownership',
    });
    const recipes = await noteRepository.create({
      title: 'Recipes',
      content: 'risotto',
    });
    const rustic = await noteRepository.create({
      title: 'Ideas',
      content: 'rustic cabin',
    });

    const { getByTestId, queryByTestId, findByTestId } = render(
      <NotesListScreen
        navigation={
          navigation as unknown as NativeStackScreenProps<
            NotesStackParamList,
            'NotesList'
          >['navigation']
        }
      />,
    );
    await findByTestId(`note-row-${rust}`);

    // Title match (case-insensitive substring).
    fireEvent.changeText(getByTestId('note-search'), 'rust');
    await waitFor(() => {
      expect(queryByTestId(`note-row-${recipes}`)).toBeNull();
    });
    expect(queryByTestId(`note-row-${rust}`)).toBeTruthy();
    expect(queryByTestId(`note-row-${rustic}`)).toBeTruthy();

    // Content match.
    fireEvent.changeText(getByTestId('note-search'), 'risotto');
    await waitFor(() => {
      expect(queryByTestId(`note-row-${rust}`)).toBeNull();
    });
    expect(queryByTestId(`note-row-${recipes}`)).toBeTruthy();

    // No match → everything is filtered out.
    fireEvent.changeText(getByTestId('note-search'), 'zzz-no-match');
    await waitFor(() => {
      expect(queryByTestId(`note-row-${recipes}`)).toBeNull();
    });
  });

  it('sorts the note list alphabetically with the A–Z toggle', async () => {
    const zebra = await noteRepository.create({ title: 'Zebra' });
    const alpha = await noteRepository.create({ title: 'Alpha' });
    const mango = await noteRepository.create({ title: 'Mango' });
    // Whatever the exact recency tie-break, the repository's default order
    // matches what the screen shows before the toggle.
    const defaultOrder = (await noteRepository.list()).map((note) => note.id);

    const { getByTestId, getAllByTestId } = render(
      <NotesListScreen
        navigation={
          navigation as unknown as NativeStackScreenProps<
            NotesStackParamList,
            'NotesList'
          >['navigation']
        }
      />,
    );

    await waitFor(() => {
      const rows = getAllByTestId(/^note-row-/);
      expect(rows).toHaveLength(3);
      expect(rows[0].props.testID).toBe(`note-row-${defaultOrder[0]}`);
    });

    fireEvent.press(getByTestId('sort-alpha'));

    await waitFor(() => {
      const rows = getAllByTestId(/^note-row-/);
      expect(rows[0].props.testID).toBe(`note-row-${alpha}`);
      expect(rows[1].props.testID).toBe(`note-row-${mango}`);
      expect(rows[2].props.testID).toBe(`note-row-${zebra}`);
    });
  });

  it('deletes a note offline after confirmation', async () => {
    const noteId = await noteRepository.create({
      title: 'Draft',
      content: 'x',
    });
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { getByTestId, findByTestId } = render(
      <NoteDetailScreen
        navigation={
          navigation as unknown as NativeStackScreenProps<
            NotesStackParamList,
            'NoteDetail'
          >['navigation']
        }
        route={
          {
            key: 'note-detail',
            name: 'NoteDetail',
            params: { noteId },
          } as unknown as NativeStackScreenProps<
            NotesStackParamList,
            'NoteDetail'
          >['route']
        }
      />,
    );
    // Read mode first — the detail screen opens as the read-only view.
    await findByTestId('note-detail-title');
    fireEvent.press(getByTestId('note-edit'));
    await findByTestId('note-title');

    fireEvent.press(getByTestId('note-delete'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete note?',
      expect.any(String),
      expect.any(Array),
    );
    const buttons = alertSpy.mock.calls[0][2] as {
      text: string;
      style?: string;
      onPress?: () => Promise<void>;
    }[];
    const destructive = buttons.find(
      (button) => button.style === 'destructive',
    );
    expect(destructive?.text).toBe('Delete');

    await destructive?.onPress?.();

    await waitFor(async () => {
      expect(await noteRepository.findById(noteId)).toBeUndefined();
    });
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('shows offline sync feedback while notes stay available', async () => {
    await noteRepository.create({
      title: 'Offline note',
      content: 'still here',
    });

    // Take the app offline at the shared sync level (connectivity provider).
    mobileSyncEngine.setOnline(false);

    const { getByTestId, findByText } = render(
      <NotesListScreen
        navigation={
          navigation as unknown as NativeStackScreenProps<
            NotesStackParamList,
            'NotesList'
          >['navigation']
        }
      />,
    );

    // The shared sync status surfaces as an offline pill…
    expect(await findByText('Offline')).toBeTruthy();
    // …while local notes remain visible and searchable.
    expect(await findByText('Offline note')).toBeTruthy();
    fireEvent.changeText(getByTestId('note-search'), 'still');
    expect(await findByText('Offline note')).toBeTruthy();
  });

  // ── Read-mode note detail (the central screen) ─────────────────────

  function renderDetail(noteId: string) {
    return render(
      <NoteDetailScreen
        navigation={
          navigation as unknown as NativeStackScreenProps<
            NotesStackParamList,
            'NoteDetail'
          >['navigation']
        }
        route={
          {
            key: 'note-detail',
            name: 'NoteDetail',
            params: { noteId },
          } as unknown as NativeStackScreenProps<
            NotesStackParamList,
            'NoteDetail'
          >['route']
        }
      />,
    );
  }

  it('loads a note in read mode and renders shared markdown (headings, bold, checklists, wiki)', async () => {
    const noteId = await noteRepository.create({
      title: 'Meeting notes',
      content:
        '# Agenda\n\nSome **bold** and *italic* and `code`\n\n- [ ] open task\n- [x] done task\n\n> quoted line\n\nSee [[Target]]',
    });

    const { getByTestId, findByText } = renderDetail(noteId);

    expect(await findByText('Meeting notes')).toBeTruthy();
    expect(await getByTestId('note-detail-markdown')).toBeTruthy();
    // heading + inline formatting
    expect(await findByText('Agenda')).toBeTruthy();
    expect(await findByText('bold')).toBeTruthy();
    expect(await findByText('italic')).toBeTruthy();
    // checklists render their state glyphs
    expect(await findByText('open task')).toBeTruthy();
    expect(await findByText('done task')).toBeTruthy();
    // blockquotes
    expect(await findByText('quoted line')).toBeTruthy();
    // wiki links render with their label
    expect(await findByText('[[Target]]')).toBeTruthy();

    // Created/updated timestamps are shown.
    expect(getByTestId('note-dates').props.children.join('')).toMatch(
      /Created .+ · Updated/,
    );
  });

  it('navigates to the target note when a wiki link is tapped', async () => {
    await noteRepository.create({ title: 'Target', content: '' });
    const source = await noteRepository.create({
      title: 'Source',
      content: 'See [[Target]]',
    });
    const target = (await noteRepository.list()).find(
      (n) => n.title === 'Target',
    );

    const { findByText } = renderDetail(source);
    fireEvent.press(await findByText('[[Target]]'));

    expect(navigation.push).toHaveBeenCalledWith('NoteDetail', {
      noteId: target?.id,
    });
  });

  it('clearly indicates and reports missing wiki links', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const noteId = await noteRepository.create({
      title: 'Drafts',
      content: 'needs [[Missing Project]]',
    });

    const { findByText } = renderDetail(noteId);
    const missing = await findByText('[[Missing Project]]');
    // Still rendered (visually distinguished by the renderer).
    expect(missing).toBeTruthy();

    fireEvent.press(missing);
    expect(alertSpy).toHaveBeenCalledWith(
      'Note not found',
      expect.stringContaining('Missing Project'),
    );
  });

  it('shows backlinks with a preview and navigates to the source note', async () => {
    const target = await noteRepository.create({
      title: 'Target',
      content: '',
    });
    const source = await noteRepository.create({
      title: 'Source note',
      content: 'references [[Target]] for review',
    });

    const { getByTestId, findByTestId, findByText } = renderDetail(target);

    expect(await findByTestId('note-backlinks')).toBeTruthy();
    expect(await findByText('Source note')).toBeTruthy();

    fireEvent.press(getByTestId(`backlink-${source}`));
    expect(navigation.push).toHaveBeenCalledWith('NoteDetail', {
      noteId: source,
    });
  });

  it('shows related reminders, navigates to them, and can create one for the note', async () => {
    const noteId = await noteRepository.create({
      title: 'Shipped',
      content: '',
    });
    const reminderId = await remindersRepository.create({
      title: 'Follow up',
      dueAt: new Date(Date.now() + 3600_000).toISOString(),
      linkedNoteId: noteId,
    });

    const { getByTestId, findByTestId, findByText } = renderDetail(noteId);

    expect(await findByTestId('note-reminders')).toBeTruthy();
    expect(await findByText('☐ Follow up')).toBeTruthy();

    fireEvent.press(getByTestId(`related-reminder-${reminderId}`));
    expect(navigation.navigate).toHaveBeenCalledWith('Reminders', {
      screen: 'ReminderDetail',
      params: { reminderId },
    });

    // Creating a reminder from the note pre-links it.
    fireEvent.press(getByTestId('note-add-reminder'));
    expect(navigation.navigate).toHaveBeenCalledWith('Reminders', {
      screen: 'ReminderForm',
      params: { defaultLinkedNoteId: noteId },
    });
  });

  it('shows the category path and navigates to the category detail', async () => {
    const root = await categoryRepository.create({
      name: 'Project',
      icon: '🚀',
    });
    const docs = await categoryRepository.create({
      name: 'Docs',
      parentId: root,
    });
    const noteId = await noteRepository.create({
      title: 'Categorized',
      content: '',
      categoryId: docs,
    });

    const { getByTestId, findByTestId, findByText } = renderDetail(noteId);

    expect(await findByTestId('note-category-path')).toBeTruthy();
    expect(await findByText(/🗂️ Project \/ Docs/)).toBeTruthy();

    fireEvent.press(getByTestId('note-category-path'));
    expect(navigation.navigate).toHaveBeenCalledWith('Categories', {
      screen: 'CategoryDetail',
      params: { categoryId: docs },
    });
  });

  it('shows a conflict indicator when the note has unresolved conflicts', async () => {
    const noteId = await noteRepository.create({
      title: 'Clash',
      content: 'a',
    });
    await conflictRepository.create({
      entityType: 'note',
      entityId: noteId,
      conflictType: 'content',
      localVersion: 1,
      remoteVersion: 2,
      localSnapshot: { version: 1, entity: { id: noteId, title: 'Local' } },
      remoteSnapshot: { version: 2, entity: { id: noteId, title: 'Remote' } },
    });
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { getByTestId, findByTestId } = renderDetail(noteId);

    const banner = await findByTestId('note-conflict-banner');
    expect(banner).toBeTruthy();
    fireEvent.press(banner);
    expect(alertSpy).toHaveBeenCalledWith(
      'Conflict detected',
      expect.stringContaining('review is coming to mobile soon'),
    );
  });

  it('keeps the note, backlinks and reminders readable while offline', async () => {
    const noteId = await noteRepository.create({
      title: 'Offline doc',
      content: 'still here',
    });
    const source = await noteRepository.create({
      title: 'Backlinker',
      content: 'ref [[Offline doc]]',
    });
    const reminderId = await remindersRepository.create({
      title: 'Offline reminder',
      dueAt: new Date(Date.now() + 3600_000).toISOString(),
      linkedNoteId: noteId,
    });

    mobileSyncEngine.setOnline(false);

    const { findByTestId, findByText } = renderDetail(noteId);

    // Shared sync status pill reports offline…
    expect(await findByText('Offline')).toBeTruthy();
    // …while content, backlinks and reminders stay readable.
    expect(await findByText('still here')).toBeTruthy();
    expect(await findByTestId(`backlink-${source}`)).toBeTruthy();
    expect(await findByText('☐ Offline reminder')).toBeTruthy();
    expect(await findByTestId(`related-reminder-${reminderId}`)).toBeTruthy();
  });
});
