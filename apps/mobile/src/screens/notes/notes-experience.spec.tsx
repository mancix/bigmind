import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { noteRepository } from '../../features/data/repositories';
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
    const noteId = await noteRepository.create({ title: 'Draft', content: 'x' });
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
    const destructive = buttons.find((button) => button.style === 'destructive');
    expect(destructive?.text).toBe('Delete');

    await destructive?.onPress?.();

    await waitFor(async () => {
      expect(await noteRepository.findById(noteId)).toBeUndefined();
    });
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('shows offline sync feedback while notes stay available', async () => {
    await noteRepository.create({ title: 'Offline note', content: 'still here' });

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
});
