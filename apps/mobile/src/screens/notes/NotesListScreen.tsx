import { useCallback, useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createNotePreview } from '@bigmind/domain/notes';
import type { NoteRecord } from '@bigmind/storage';

import {
  categoryRepository,
  noteRepository,
  subscribeToDataChanges,
} from '../../features/data/repositories';
import type { NotesStackParamList } from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<NotesStackParamList, 'NotesList'>;

export function NotesListScreen({ navigation }: Props) {
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [categoryNames, setCategoryNames] = useState<Record<string, string>>(
    {},
  );
  const [refreshing, setRefreshing] = useState(false);

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
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeToDataChanges(() => void refresh());
  }, [refresh]);

  const pullToRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const createNote = async () => {
    const noteId = await noteRepository.create();
    navigation.navigate('NoteDetail', { noteId });
  };

  return (
    <View style={styles.screen}>
      <FlatList
        data={notes}
        keyExtractor={(note) => note.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void pullToRefresh()}
          />
        }
        contentContainerStyle={[
          styles.list,
          notes.length === 0 && styles.listEmpty,
        ]}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No notes yet — create your first note.
          </Text>
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
  list: {
    padding: spacing.md,
    gap: spacing.sm,
    paddingBottom: 96,
  },
  listEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
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
