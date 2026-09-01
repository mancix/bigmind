import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { createNotePreview } from '@bigmind/domain/notes';
import type { NoteRecord } from '@bigmind/storage';

import { SyncStatusPill } from '../../components/SyncStatusPill';
import {
  categoryRepository,
  noteRepository,
  subscribeToDataChanges,
} from '../../features/data/repositories';
import {
  buildNoteList,
  NOTE_PAGE_SIZE,
  NOTE_SORT_LABELS,
  NOTE_SORT_MODES,
  type NoteSortMode,
} from '../../features/notes/note-list';
import type { NotesStackParamList } from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<NotesStackParamList, 'NotesList'>;

export function NotesListScreen({ navigation }: Props) {
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [categoryNames, setCategoryNames] = useState<Record<string, string>>(
    {},
  );
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<NoteSortMode>('updated');
  const [visibleCount, setVisibleCount] = useState(NOTE_PAGE_SIZE);

  const refresh = useCallback(async () => {
    const [list, categories] = await Promise.all([
      noteRepository.list(),
      categoryRepository.list(),
    ]);
    setNotes(list);
    setCategoryNames(
      Object.fromEntries(
        categories.map((category) => [category.id, category.name]),
      ),
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeToDataChanges(() => void refresh());
  }, [refresh]);

  // Reset pagination whenever the search or sort changes.
  useEffect(() => {
    setVisibleCount(NOTE_PAGE_SIZE);
  }, [query, sortMode]);

  const pullToRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  // Filter → sort → paginate in pure helpers (fast, offline-safe).
  const visibleNotes = useMemo(
    () =>
      buildNoteList(notes, {
        query,
        sortMode,
        limit: visibleCount,
      }),
    [notes, query, sortMode, visibleCount],
  );

  const createNote = async () => {
    const noteId = await noteRepository.create();
    navigation.navigate('NoteDetail', { noteId });
  };

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search notes (title or content)"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          testID="note-search"
        />
        <View style={styles.sortRow}>
          {NOTE_SORT_MODES.map((mode) => (
            <Pressable
              key={mode}
              testID={`sort-${mode}`}
              onPress={() => setSortMode(mode)}
              style={[styles.sortButton, sortMode === mode && styles.sortActive]}
            >
              <Text
                style={[
                  styles.sortLabel,
                  sortMode === mode && styles.sortLabelActive,
                ]}
              >
                {NOTE_SORT_LABELS[mode]}
              </Text>
            </Pressable>
          ))}
          <SyncStatusPill />
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>Loading notes...</Text>
        </View>
      ) : (
        <FlatList
          data={visibleNotes}
          keyExtractor={(note) => note.id}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          windowSize={7}
          maxToRenderPerBatch={20}
          updateCellsBatchingPeriod={40}
          onEndReachedThreshold={0.4}
          onEndReached={() =>
            setVisibleCount((count) => count + NOTE_PAGE_SIZE)
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void pullToRefresh()}
            />
          }
          contentContainerStyle={[
            styles.list,
            visibleNotes.length === 0 && styles.listEmpty,
          ]}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.empty}>
                {notes.length === 0
                  ? `No notes yet — tap "${'＋ New note'}" to create one.`
                  : `No notes match "${query}".`}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const categoryName = item.categoryId
              ? categoryNames[item.categoryId]
              : undefined;
            const preview = createNotePreview(item.content);
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  pressed && styles.rowPressed,
                ]}
                onPress={() =>
                  navigation.navigate('NoteDetail', { noteId: item.id })
                }
                testID={`note-row-${item.id}`}
              >
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                {preview ? (
                  <Text style={styles.rowPreview} numberOfLines={2}>
                    {preview}
                  </Text>
                ) : null}
                <View style={styles.metaRow}>
                  {categoryName ? (
                    <Text style={styles.rowCategory} numberOfLines={1}>
                      {categoryName}
                    </Text>
                  ) : null}
                  <Text style={styles.rowMeta}>
                    {new Date(item.updatedAt).toLocaleDateString()}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={() => void createNote()}
        testID="new-note"
      >
        <Text style={styles.fabLabel}>＋ New note</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  toolbar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  searchInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: typography.body,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sortButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  sortActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceAlt,
  },
  sortLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  sortLabelActive: {
    color: colors.primary,
  },
  list: {
    padding: spacing.md,
    gap: spacing.sm,
    paddingBottom: 96,
  },
  listEmpty: {
    flexGrow: 1,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: typography.body,
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: '700',
  },
  rowPreview: {
    color: colors.textMuted,
    fontSize: typography.body,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  rowMeta: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  rowCategory: {
    flexShrink: 1,
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  muted: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    elevation: 4,
  },
  fabPressed: {
    opacity: 0.85,
  },
  fabLabel: {
    color: colors.background,
    fontSize: typography.body,
    fontWeight: '700',
  },
});