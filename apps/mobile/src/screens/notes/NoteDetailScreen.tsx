import { useCallback, useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { noteDataSchema } from '@bigmind/contracts';
import type { CategoryRecord, NoteRecord } from '@bigmind/storage';

import { MarkdownEditView } from '../../components/MarkdownEditView';
import { TodoListView } from '../../components/TodoListView';
import {
  categoryRepository,
  linkRepository,
  noteRepository,
} from '../../features/data/repositories';
import type { NotesStackParamList } from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<NotesStackParamList, 'NoteDetail'>;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function NoteDetailScreen({ navigation, route }: Props) {
  const { noteId } = route.params;
  const [note, setNote] = useState<NoteRecord | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [noteTitles, setNoteTitles] = useState<{ id: string; title: string }[]>(
    [],
  );
  const [backlinks, setBacklinks] = useState<NoteRecord[]>([]);
  const [outgoing, setOutgoing] = useState<NoteRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [loadedNote, loadedCategories, titles] = await Promise.all([
      noteRepository.findById(noteId),
      categoryRepository.list(),
      noteRepository.list(),
    ]);
    if (!loadedNote) {
      Alert.alert('Note not found', 'It may have been deleted.');
      navigation.goBack();
      return;
    }
    setNote(loadedNote);
    setTitle(loadedNote.title);
    setContent(loadedNote.content);
    setCategoryId(loadedNote.categoryId);
    setCategories(loadedCategories);
    setNoteTitles(titles.map((note) => ({ id: note.id, title: note.title })));
    setBacklinks(await linkRepository.getBacklinks(noteId));
    setOutgoing(await linkRepository.getOutgoingLinks(noteId));
  }, [navigation, noteId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    if (!note) return;
    setSaveState('saving');
    setError(null);

    // Reuse the shared contract schema before persisting anything.
    const parsed = noteDataSchema.safeParse({
      ...note,
      title,
      content,
      categoryId,
      deletedAt: undefined,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? 'The note content is not valid.',
      );
      setSaveState('error');
      return;
    }

    try {
      await noteRepository.update(noteId, { title, content, categoryId });
      setSaveState('saved');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
      setSaveState('error');
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete note?',
      `"${title || 'Untitled note'}" will be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await noteRepository.delete(noteId);
            navigation.goBack();
          },
        },
      ],
    );
  };

  const selectedCategory = categories.find(
    (category) => category.id === categoryId,
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          placeholder="Untitled note"
          placeholderTextColor={colors.textMuted}
          testID="note-title"
        />

        {note?.templateType === 'TODO_LIST' ? (
          <TodoListView noteId={noteId} />
        ) : (
          <MarkdownEditView
            value={content}
            onChangeText={setContent}
            noteTitles={noteTitles}
            placeholder="Start writing…"
            testID="note-content"
          />
        )}

        <View style={styles.metaRow}>
          <Pressable
            style={styles.categoryButton}
            onPress={() => setPickerVisible(true)}
            testID="note-category"
          >
            <Text style={styles.categoryButtonLabel}>
              {selectedCategory
                ? `${selectedCategory.icon ?? '🗂️'} ${selectedCategory.name}`
                : 'Uncategorized'}
            </Text>
          </Pressable>
          <Text style={styles.syncState}>
            {note?.syncStatus === 'pending'
              ? 'Saved locally, waiting to sync'
              : note?.syncStatus === 'conflict'
                ? 'Conflict — review needed'
                : `Synced · v${note?.version ?? 0}`}
          </Text>
        </View>

        {error ? (
          <Text style={styles.error} testID="note-error">
            {error}
          </Text>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            styles.saveButton,
            pressed && styles.pressed,
          ]}
          onPress={() => void save()}
          disabled={saveState === 'saving'}
          testID="note-save"
        >
          <Text style={styles.saveLabel}>
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'saved'
                ? 'Saved ✓'
                : 'Save note'}
          </Text>
        </Pressable>

        {(backlinks.length > 0 || outgoing.length > 0) && (
          <View style={styles.linksSection} testID="note-links">
            {backlinks.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Backlinks</Text>
                {backlinks.map((note) => (
                  <Pressable
                    key={note.id}
                    style={styles.linkRow}
                    onPress={() =>
                      navigation.push('NoteDetail', { noteId: note.id })
                    }
                    testID={`backlink-${note.id}`}
                  >
                    <Text style={styles.linkTitle}>{note.title}</Text>
                  </Pressable>
                ))}
              </>
            )}
            {outgoing.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Outgoing links</Text>
                {outgoing.map((note) => (
                  <Pressable
                    key={note.id}
                    style={styles.linkRow}
                    onPress={() =>
                      navigation.push('NoteDetail', { noteId: note.id })
                    }
                  >
                    <Text style={styles.linkTitle}>{note.title}</Text>
                  </Pressable>
                ))}
              </>
            )}
          </View>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.deleteButton,
            pressed && styles.pressed,
          ]}
          onPress={confirmDelete}
          testID="note-delete"
        >
          <Text style={styles.deleteLabel}>Delete note</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={pickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerVisible(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setPickerVisible(false)}
        >
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Move to category</Text>
            <FlatList
              data={[
                {
                  id: null as string | null,
                  name: 'Uncategorized',
                  icon: null,
                },
                ...categories,
              ]}
              keyExtractor={(item) => item.id ?? 'none'}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.pickerRow}
                  onPress={() => {
                    setCategoryId(item.id);
                    setPickerVisible(false);
                  }}
                >
                  <Text style={styles.pickerRowLabel}>
                    {item.icon ? `${item.icon} ` : ''}
                    {item.name}
                  </Text>
                  {item.id === categoryId ? (
                    <Text style={styles.pickerCheck}>✓</Text>
                  ) : null}
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  titleInput: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  categoryButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  categoryButtonLabel: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  syncState: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  error: {
    color: colors.danger,
    fontSize: typography.caption,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  deleteButton: {
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  pressed: {
    opacity: 0.85,
  },
  saveLabel: {
    color: colors.background,
    fontSize: typography.body,
    fontWeight: '700',
  },
  deleteLabel: {
    color: colors.danger,
    fontSize: typography.body,
    fontWeight: '600',
  },
  linksSection: {
    gap: spacing.xs,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  linkRow: {
    paddingVertical: spacing.xs,
  },
  linkTitle: {
    color: colors.accent,
    fontSize: typography.body,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  pickerCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    maxHeight: 420,
  },
  pickerTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  pickerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
  },
  pickerRowLabel: {
    color: colors.text,
    fontSize: typography.body,
  },
  pickerCheck: {
    color: colors.accent,
    fontSize: typography.body,
    fontWeight: '700',
  },
});
