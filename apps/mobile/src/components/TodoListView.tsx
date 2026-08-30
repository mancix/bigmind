import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { TodoItemRecord } from '@bigmind/storage';

import { todoRepository } from '../features/data/repositories';
import { colors, spacing, typography } from '../theme';

interface TodoListViewProps {
  noteId: string;
}

/**
 * Native todo-list editor for `TODO_LIST` notes. Todos are separate synced
 * entities managed by the shared `TodoRepository` — never markdown.
 */
export function TodoListView({ noteId }: TodoListViewProps) {
  const [items, setItems] = useState<TodoItemRecord[]>([]);
  const [newText, setNewText] = useState('');

  const refresh = useCallback(async () => {
    setItems(await todoRepository.listByNoteId(noteId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async () => {
    const text = newText.trim();
    if (!text) return;
    await todoRepository.create(noteId, text);
    setNewText('');
    await refresh();
  };

  const toggle = async (id: string) => {
    await todoRepository.toggle(id);
    await refresh();
  };

  const remove = async (id: string) => {
    await todoRepository.remove(id);
    await refresh();
  };

  const move = async (id: string, offset: number) => {
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return;
    await todoRepository.reorder(noteId, id, index + offset);
    await refresh();
  };

  const remaining = items.filter((item) => !item.completed).length;

  return (
    <View>
      <Text style={styles.counter}>
        {remaining}/{items.length} remaining
      </Text>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.addRow}>
            <TextInput
              style={styles.addInput}
              value={newText}
              onChangeText={setNewText}
              placeholder="Add a task…"
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={() => void add()}
              testID="todo-add-input"
            />
            <Pressable
              style={styles.addButton}
              onPress={() => void add()}
              testID="todo-add"
            >
              <Text style={styles.addLabel}>＋</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            <Pressable
              style={styles.checkbox}
              onPress={() => void toggle(item.id)}
              testID={`todo-toggle-${item.id}`}
            >
              <Text style={styles.checkboxLabel}>
                {item.completed ? '✓' : ''}
              </Text>
            </Pressable>
            <Text
              style={[styles.itemText, item.completed && styles.itemDone]}
              numberOfLines={2}
            >
              {item.text}
            </Text>
            <View style={styles.rowActions}>
              <Pressable
                style={styles.rowButton}
                onPress={() => void move(item.id, -1)}
                disabled={index === 0}
                testID={`todo-up-${item.id}`}
              >
                <Text style={styles.rowButtonLabel}>▲</Text>
              </Pressable>
              <Pressable
                style={styles.rowButton}
                onPress={() => void move(item.id, 1)}
                disabled={index === items.length - 1}
                testID={`todo-down-${item.id}`}
              >
                <Text style={styles.rowButtonLabel}>▼</Text>
              </Pressable>
              <Pressable
                style={styles.rowButton}
                onPress={() => void remove(item.id)}
                testID={`todo-delete-${item.id}`}
              >
                <Text style={[styles.rowButtonLabel, styles.deleteLabel]}>
                  ✕
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  counter: {
    color: colors.textMuted,
    fontSize: typography.caption,
    marginBottom: spacing.sm,
  },
  addRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  addInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: typography.body,
  },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  addLabel: {
    color: colors.background,
    fontSize: 18,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxLabel: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  itemText: {
    flex: 1,
    color: colors.text,
    fontSize: typography.body,
  },
  itemDone: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  rowActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  rowButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  rowButtonLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  deleteLabel: {
    color: colors.danger,
  },
});
