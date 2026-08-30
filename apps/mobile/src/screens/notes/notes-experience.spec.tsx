import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { noteRepository } from '../../features/data/repositories';
import { storage } from '../../storage';
import type { NotesStackParamList } from '../../navigation/types';
import { NotesListScreen } from './NotesListScreen';
import { NoteDetailScreen } from './NoteDetailScreen';

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
} as unknown as NativeStackScreenProps<
  NotesStackParamList,
  'NotesList'
>['navigation'];

describe('notes experience', () => {
  beforeEach(async () => {
    await storage.clearAll();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await storage.clearAll();
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
});
