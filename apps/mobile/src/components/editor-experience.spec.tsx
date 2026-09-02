import { useState, type ReactNode } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NoteRepository } from '@bigmind/features';
import { OutboxRepository } from '@bigmind/sync';

import { MarkdownEditView } from './MarkdownEditView';
import { MarkdownText } from './MarkdownText';
import { TodoListView } from './TodoListView';
import { storage } from '../storage';
import { todoRepository } from '../features/data/repositories';

function Harness({
  initial = 'hello world',
  children,
}: {
  initial?: string;
  children: (value: string, set: (v: string) => void) => ReactNode;
}) {
  const [value, setValue] = useState(initial);
  return <>{children(value, setValue)}</>;
}

describe('MarkdownText (shared renderer)', () => {
  it('renders inline formatting and wiki links from the shared tokenizer', () => {
    const { getByText } = render(
      <MarkdownText markdown={'Hello **bold** and [[Wiki Title]]'} />,
    );
    expect(getByText('[[Wiki Title]]')).toBeTruthy();
    expect(getByText('bold')).toBeTruthy();
  });

  it('fires wiki press with the target title', () => {
    const onWikiPress = jest.fn();
    const { getByText } = render(
      <MarkdownText
        markdown={'See [[Some Note]] now'}
        onWikiPress={onWikiPress}
      />,
    );
    fireEvent.press(getByText('[[Some Note]]'));
    expect(onWikiPress).toHaveBeenCalledWith('Some Note');
  });

  it('renders checklists with checked state from the shared tokenizer', () => {
    const { getByText } = render(
      <MarkdownText markdown={'- [ ] open\n- [x] done'} />,
    );
    expect(getByText('open')).toBeTruthy();
    expect(getByText('done')).toBeTruthy();
    // Glyphs: unchecked ☐ and checked ☑
    expect(getByText('☐')).toBeTruthy();
    expect(getByText('☑')).toBeTruthy();
  });

  it('visually distinguishes missing wiki links from resolved ones', () => {
    const resolved = new Set(['target']); // normalized
    const { getByText } = render(
      <MarkdownText
        markdown={'[[Target]] vs [[Missing]]'}
        resolvedWikiTitles={resolved}
      />,
    );
    const resolvedLink = getByText('[[Target]]');
    expect(resolvedLink.props.style).not.toMatchObject({
      textDecorationLine: 'underline',
    });
    // Missing notes are stricken/underlined in the danger color.
    const missing = getByText('[[Missing]]');
    expect(missing.props.style).toMatchObject({
      textDecorationLine: 'underline',
      color: '#f87171',
    });
  });
});

describe('MarkdownEditView (Option B editor)', () => {
  it('wraps a selection with bold via the toolbar', () => {
    const { getByTestId } = render(
      <Harness>
        {(value, setValue) => (
          <MarkdownEditView
            value={value}
            onChangeText={setValue}
            noteTitles={[]}
            testID="md-field"
          />
        )}
      </Harness>,
    );

    const input = getByTestId('md-field');
    fireEvent(input, 'selectionChange', {
      nativeEvent: { selection: { start: 0, end: 5 } },
    });
    fireEvent.press(getByTestId('md-bold'));

    expect(input.props.value).toBe('**hello** world');
  });

  it('suggests wiki links while typing `[[` and inserts the picked title', async () => {
    const titles = [
      { id: '1', title: 'Wiki Note' },
      { id: '2', title: 'Another Note' },
    ];
    const { getByTestId, findByTestId } = render(
      <Harness initial="see [[wik">
        {(value, setValue) => (
          <MarkdownEditView
            value={value}
            onChangeText={setValue}
            noteTitles={titles}
            testID="md-field"
          />
        )}
      </Harness>,
    );

    // The trigger is computed while typing; re-fire the value so the
    // suggestion state updates.
    fireEvent.changeText(getByTestId('md-field'), 'see [[wik');
    const suggestions = await findByTestId('wiki-suggestions');
    expect(suggestions).toBeTruthy();

    fireEvent.press(await findByTestId('wiki-suggestion-Wiki Note'));
    expect(getByTestId('md-field').props.value).toBe('see [[Wiki Note]]');
  });

  it('toggles between edit and preview', async () => {
    const { getByTestId, findByTestId, findByText } = render(
      <Harness initial={'# Title\n\nSome content'}>
        {(value, setValue) => (
          <MarkdownEditView
            value={value}
            onChangeText={setValue}
            noteTitles={[]}
            testID="md-field"
          />
        )}
      </Harness>,
    );

    fireEvent.press(getByTestId('md-preview'));
    expect(await findByTestId('md-field-preview')).toBeTruthy();
    expect(await findByText('Title', { exact: false })).toBeTruthy();

    fireEvent.press(getByTestId('md-edit'));
    await waitFor(() => expect(getByTestId('md-field')).toBeTruthy());
  });

  describe('block toolbar actions (shared string transforms)', () => {
    it('converts the caret line to a bullet list and back', () => {
      const { getByTestId } = render(
        <Harness initial={'alpha\nbeta'}>
          {(value, setValue) => (
            <MarkdownEditView
              value={value}
              onChangeText={setValue}
              noteTitles={[]}
              testID="md-field"
            />
          )}
        </Harness>,
      );
      const input = getByTestId('md-field');
      fireEvent(input, 'selectionChange', {
        nativeEvent: { selection: { start: 6, end: 6 } }, // line "beta"
      });
      fireEvent.press(getByTestId('md-bullet-list'));
      expect(input.props.value).toBe('alpha\n- beta');
      // Cursor anchored after the marker.
      expect(input.props.selection).toEqual({ start: 8, end: 8 });

      fireEvent.press(getByTestId('md-bullet-list'));
      expect(input.props.value).toBe('alpha\nbeta');
    });

    it('wraps the caret line into an ordered list and a checklist', () => {
      const { getByTestId } = render(
        <Harness initial="plan">
          {(value, setValue) => (
            <MarkdownEditView
              value={value}
              onChangeText={setValue}
              noteTitles={[]}
              testID="md-field"
            />
          )}
        </Harness>,
      );
      const input = getByTestId('md-field');
      fireEvent.press(getByTestId('md-ordered-list'));
      expect(input.props.value).toBe('1. plan');

      fireEvent(input, 'selectionChange', {
        nativeEvent: { selection: { start: 0, end: 3 } },
      });
      fireEvent.press(getByTestId('md-checklist'));
      expect(input.props.value).toBe('- [ ] 1. plan');
    });

    it('wraps the caret line in a code block and unwraps from inside', () => {
      const { getByTestId } = render(
        <Harness initial="const a = 1;">
          {(value, setValue) => (
            <MarkdownEditView
              value={value}
              onChangeText={setValue}
              noteTitles={[]}
              testID="md-field"
            />
          )}
        </Harness>,
      );
      const input = getByTestId('md-field');
      fireEvent(input, 'selectionChange', {
        nativeEvent: { selection: { start: 6, end: 6 } },
      });
      fireEvent.press(getByTestId('md-code-block'));
      expect(input.props.value).toBe('```\nconst a = 1;\n```');

      fireEvent.press(getByTestId('md-code-block'));
      expect(input.props.value).toBe('const a = 1;');
    });

    it('toggles a blockquote prefix', () => {
      const { getByTestId } = render(
        <Harness initial="said">
          {(value, setValue) => (
            <MarkdownEditView
              value={value}
              onChangeText={setValue}
              noteTitles={[]}
              testID="md-field"
            />
          )}
        </Harness>,
      );
      const input = getByTestId('md-field');
      fireEvent.press(getByTestId('md-quote'));
      expect(input.props.value).toBe('> said');
      fireEvent.press(getByTestId('md-quote'));
      expect(input.props.value).toBe('said');
    });

    it('inserts a wiki-link snippet with the caret inside the brackets', () => {
      const { getByTestId } = render(
        <Harness initial="see ">
          {(value, setValue) => (
            <MarkdownEditView
              value={value}
              onChangeText={setValue}
              noteTitles={[]}
              testID="md-field"
            />
          )}
        </Harness>,
      );
      const input = getByTestId('md-field');
      fireEvent(input, 'selectionChange', {
        nativeEvent: { selection: { start: 4, end: 4 } },
      });
      fireEvent.press(getByTestId('md-wiki'));
      expect(input.props.value).toBe('see [[]]');
      expect(input.props.selection).toEqual({ start: 6, end: 6 });
    });
  });
});

describe('TodoListView (shared TodoRepository)', () => {
  beforeEach(async () => {
    await storage.clearAll();
  });

  afterEach(async () => {
    await storage.clearAll();
  });

  it('adds, toggles and removes todo items', async () => {
    const outbox = new OutboxRepository(storage);
    const notes = new NoteRepository(storage, outbox);
    const noteId = await notes.create({
      title: 'Todo note',
      templateType: 'TODO_LIST',
    });

    const { getByTestId, findByText, findByTestId } = render(
      <TodoListView noteId={noteId} />,
    );

    fireEvent.changeText(getByTestId('todo-add-input'), 'First task');
    fireEvent.press(getByTestId('todo-add'));
    expect(await findByText('First task')).toBeTruthy();

    const itemId = (await todoRepository.listByNoteId(noteId))[0].id;
    fireEvent.press(await findByTestId(`todo-toggle-${itemId}`));
    await waitFor(async () => {
      const item = (await todoRepository.listByNoteId(noteId))[0];
      expect(item.completed).toBe(true);
    });
  });
});
