import { useCallback, useEffect, useMemo, useState } from 'react';
import { type CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { noteDataSchema } from '@bigmind/contracts';
import { resolveWikiLinkTarget } from '@bigmind/domain/links';
import { normalizeWikiLinkName } from '@bigmind/markdown';
import type {
  CategoryRecord,
  NoteAliasRecord,
  NoteRecord,
  ReminderRecord,
} from '@bigmind/storage';

import { MarkdownEditView } from '../../components/MarkdownEditView';
import { MarkdownText } from '../../components/MarkdownText';
import { SyncStatusPill } from '../../components/SyncStatusPill';
import { TodoListView } from '../../components/TodoListView';
import { getAncestorChain } from '../../features/categories/category-utils';
import {
  categoryRepository,
  conflictRepository,
  linkRepository,
  noteRepository,
  remindersRepository,
  subscribeToDataChanges,
} from '../../features/data/repositories';
import { formatDue } from '../../features/reminders/reminder-list';
import type {
  NotesStackParamList,
  RootTabParamList,
} from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';

type Props = CompositeScreenProps<
  NativeStackScreenProps<NotesStackParamList, 'NoteDetail'>,
  BottomTabScreenProps<RootTabParamList>
>;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type ViewMode = 'read' | 'edit';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Note Detail — the central screen of the mobile app.
 *
 * Read mode (default) renders the note through the SHARED markdown tokenizer
 * (`MarkdownText` + `@bigmind/markdown`), shows wiki links (tap → target note,
 * missing notes clearly indicated), backlinks, related reminders, category
 * path, created/updated dates, the shared sync status, and a conflict
 * awareness indicator. Edit mode keeps the shipped native editor
 * (`MarkdownEditView` / `TodoListView` + shared `NoteRepository`).
 *
 * Every read of note/backlink/reminder data goes through the shared
 * repositories — offline-first, outbox-synced, workspace-scoped — with no
 * duplicated business logic.
 */
export function NoteDetailScreen({ navigation, route }: Props) {
  const { noteId } = route.params;
  const [mode, setMode] = useState<ViewMode>('read');

  const [note, setNote] = useState<NoteRecord | null>(null);
  const [allNotes, setAllNotes] = useState<NoteRecord[]>([]);
  const [aliases, setAliases] = useState<NoteAliasRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [backlinks, setBacklinks] = useState<NoteRecord[]>([]);
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [conflictCount, setConflictCount] = useState(0);

  // Edit-mode state (the shipped native editor).
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [noteTitles, setNoteTitles] = useState<{ id: string; title: string }[]>(
    [],
  );
  const [pickerVisible, setPickerVisible] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [loadedNote, loadedCategories, loadedNotes, loadedAliases, open] =
      await Promise.all([
        noteRepository.findById(noteId),
        categoryRepository.list(),
        noteRepository.list(),
        linkRepository.listAllAliases(),
        conflictRepository.listOpen(),
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
    setNoteTitles(
      loadedNotes.map((loaded) => ({ id: loaded.id, title: loaded.title })),
    );
    setAllNotes(loadedNotes);
    setAliases(loadedAliases);
    setBacklinks(await linkRepository.getBacklinks(noteId));
    setReminders(await remindersRepository.listForNote(noteId));
    setConflictCount(
      open.filter((conflict) => conflict.entityId === noteId).length,
    );
  }, [navigation, noteId]);

  useEffect(() => {
    void refresh();
    return subscribeToDataChanges(() => void refresh());
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
      setMode('read');
      void refresh();
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

  /** Resolve `[[wiki]]` titles via the SHARED domain resolver (title + alias). */
  const handleWikiPress = useCallback(
    (wikiTitle: string) => {
      const target = resolveWikiLinkTarget(wikiTitle, allNotes, aliases);
      if (target) {
        navigation.push('NoteDetail', { noteId: target.id });
        return;
      }
      Alert.alert(
        'Note not found',
        `"${wikiTitle}" does not exist yet — create it to resolve this link.`,
      );
    },
    [aliases, allNotes, navigation],
  );

  const handleLinkPress = useCallback((url: string) => {
    if (/^https?:\/\//i.test(url)) {
      void Linking.openURL(url).catch(() => undefined);
    }
  }, []);

  /** Normalized wiki-link names that resolve today (styles missing links). */
  const resolvedWikiTitles = useMemo(() => {
    const set = new Set<string>();
    for (const loaded of allNotes) {
      if (!loaded.deletedAt) set.add(normalizeWikiLinkName(loaded.title));
    }
    for (const alias of aliases) set.add(normalizeWikiLinkName(alias.alias));
    return set;
  }, [allNotes, aliases]);

  const selectedCategory = categories.find(
    (category) => category.id === categoryId,
  );

  /** Root→…→leaf path for the note's category breadcrumb. */
  const categoryPath = useMemo(() => {
    if (!note?.categoryId) return null;
    const chain = getAncestorChain(categories, note.categoryId);
    const category = categories.find((c) => c.id === note.categoryId);
    if (!category) return null;
    return [...chain, category].map((c) => c.name).join(' / ');
  }, [categories, note]);

  const hasConflict =
    conflictCount > 0 || note?.syncStatus === 'conflict';

  const openCategoryDetail = () => {
    if (note?.categoryId) {
      navigation.navigate('Categories', {
        screen: 'CategoryDetail',
        params: { categoryId: note.categoryId },
      });
    }
  };

  const openReminderDetail = (reminder: ReminderRecord) => {
    navigation.navigate('Reminders', {
      screen: 'ReminderDetail',
      params: { reminderId: reminder.id },
    });
  };

  const createReminderForNote = () => {
    navigation.navigate('Reminders', {
      screen: 'ReminderForm',
      params: { defaultLinkedNoteId: noteId },
    });
  };

  const renderBacklink = ({ item }: { item: NoteRecord }) => (
    <Pressable
      style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
      onPress={() => navigation.push('NoteDetail', { noteId: item.id })}
      testID={`backlink-${item.id}`}
    >
      <Text style={styles.linkTitle} numberOfLines={1}>
        {item.title}
      </Text>
      {item.content ? (
        <Text style={styles.linkPreview} numberOfLines={2}>
          {item.content.replace(/[#*`[\]]/g, '')}
        </Text>
      ) : null}
    </Pressable>
  );

  const renderReminder = ({ item }: { item: ReminderRecord }) => (
    <Pressable
      style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
      onPress={() => openReminderDetail(item)}
      testID={`related-reminder-${item.id}`}
    >
      <View style={styles.reminderRow}>
        <Text
          style={[
            styles.linkTitle,
            item.completed && styles.linkTitleDone,
          ]}
          numberOfLines={1}
        >
          {item.completed ? '☑' : '☐'} {item.title}
        </Text>
        <Text style={styles.reminderDue}>{formatDue(item.dueAt)}</Text>
      </View>
    </Pressable>
  );

  if (!note) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Loading note…</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        testID="note-detail-scroll"
      >
        {mode === 'read' ? (
          <>
            {/* ── Header: title + status ─────────────────────────────── */}
            <Text style={styles.title} testID="note-detail-title">
              {note.title}
            </Text>
            <View style={styles.statusRow} testID="note-detail-status-row">
              <SyncStatusPill />
              <Text style={styles.syncNoteText}>
                {note.syncStatus === 'pending'
                  ? 'Saved locally'
                  : note.syncStatus === 'conflict'
                    ? 'Conflict'
                    : `v${note.version}`}
              </Text>
            </View>

            {/* ── Conflict awareness (resolution is a future screen) ── */}
            {hasConflict ? (
              <Pressable
                style={({ pressed }) => [
                  styles.conflictBanner,
                  pressed && styles.pressed,
                ]}
                onPress={() =>
                  Alert.alert(
                    'Conflict detected',
                    'This note has unresolved changes. Conflict review is coming to mobile soon.',
                  )
                }
                testID="note-conflict-banner"
              >
                <Text style={styles.conflictBannerText}>
                  ⚠ Conflict — review needed
                </Text>
              </Pressable>
            ) : null}

            {/* ── Metadata: category path + created/updated ─────────── */}
            <View style={styles.metaRow}>
              {categoryPath ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.categoryChip,
                    pressed && styles.pressed,
                  ]}
                  onPress={openCategoryDetail}
                  testID="note-category-path"
                >
                  <Text style={styles.categoryChipText} numberOfLines={1}>
                    🗂️ {categoryPath}
                  </Text>
                </Pressable>
              ) : (
                <View style={styles.categoryChip}>
                  <Text style={styles.categoryChipText}>Uncategorized</Text>
                </View>
              )}
            </View>
            <Text style={styles.dates} testID="note-dates">
              Created {formatDate(note.createdAt)} · Updated{' '}
              {formatDate(note.updatedAt)}
            </Text>

            {/* ── Content (read-only, shared markdown renderer) ─────── */}
            {note.templateType === 'TODO_LIST' ? (
              <TodoListView noteId={noteId} />
            ) : (
              <MarkdownText
                markdown={note.content}
                onWikiPress={handleWikiPress}
                onLinkPress={handleLinkPress}
                resolvedWikiTitles={resolvedWikiTitles}
                testID="note-detail-markdown"
              />
            )}

            {/* ── Backlinks ─────────────────────────────────────────── */}
            {backlinks.length > 0 ? (
              <View testID="note-backlinks">
                <Text style={styles.sectionLabel}>
                  Backlinks ({backlinks.length})
                </Text>
                <FlatList
                  data={backlinks}
                  keyExtractor={(item) => item.id}
                  renderItem={renderBacklink}
                  scrollEnabled={false}
                  initialNumToRender={30}
                  maxToRenderPerBatch={30}
                />
              </View>
            ) : null}

            {/* ── Related reminders ─────────────────────────────────── */}
            <View testID="note-reminders">
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionLabel}>
                  Reminders ({reminders.length})
                </Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.addReminderButton,
                    pressed && styles.pressed,
                  ]}
                  onPress={createReminderForNote}
                  testID="note-add-reminder"
                >
                  <Text style={styles.addReminderLabel}>＋ Add reminder</Text>
                </Pressable>
              </View>
              {reminders.length > 0 ? (
                <FlatList
                  data={reminders}
                  keyExtractor={(item) => item.id}
                  renderItem={renderReminder}
                  scrollEnabled={false}
                  initialNumToRender={30}
                  maxToRenderPerBatch={30}
                />
              ) : (
                <Text style={styles.muted}>No reminders linked to this note.</Text>
              )}
            </View>

            {/* ── Actions ───────────────────────────────────────────── */}
            <Pressable
              style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
              onPress={() => setMode('edit')}
              testID="note-edit"
            >
              <Text style={styles.editButtonLabel}>Edit note</Text>
            </Pressable>
          </>
        ) : (
          <>
            {/* ── Edit mode: shipped native editor ──────────────────── */}
            <TextInput
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder="Untitled note"
              placeholderTextColor={colors.textMuted}
              testID="note-title"
            />

            {note.templateType === 'TODO_LIST' ? (
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
                {note.syncStatus === 'pending'
                  ? 'Saved locally, waiting to sync'
                  : note.syncStatus === 'conflict'
                    ? 'Conflict — review needed'
                    : `Synced · v${note.version}`}
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

            <Pressable
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && styles.pressed,
              ]}
              onPress={() => {
                setMode('read');
                setError(null);
                void refresh();
              }}
              testID="note-cancel-edit"
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>

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
          </>
        )}
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
                { id: null as string | null, name: 'Uncategorized', icon: null },
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  muted: {
    color: colors.textMuted,
    fontSize: typography.body,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  syncNoteText: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  conflictBanner: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    padding: spacing.sm,
  },
  conflictBannerText: {
    color: colors.danger,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  categoryChip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  categoryChipText: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  dates: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  addReminderButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  addReminderLabel: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  linkRow: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: 2,
    marginBottom: spacing.xs,
  },
  linkTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
  linkTitleDone: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  linkPreview: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  reminderRow: {
    gap: 2,
  },
  reminderDue: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  editButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  editButtonLabel: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '600',
  },
  titleInput: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
  categoryButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.sm,
    maxWidth: '70%',
  },
  categoryButtonLabel: {
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  syncState: {
    flexShrink: 1,
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  error: {
    color: colors.danger,
    fontSize: typography.caption,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  saveLabel: {
    color: colors.background,
    fontSize: typography.body,
    fontWeight: '700',
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  cancelLabel: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
  deleteButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  deleteLabel: {
    color: colors.danger,
    fontSize: typography.body,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.85,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  pickerCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    maxHeight: '70%',
  },
  pickerTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  pickerRow: {
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerRowLabel: {
    color: colors.text,
    fontSize: typography.body,
  },
  pickerCheck: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '700',
  },
});