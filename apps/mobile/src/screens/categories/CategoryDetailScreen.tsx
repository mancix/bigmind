import { useCallback, useEffect, useState } from 'react';
import { type CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { isCategoryIcon } from '@bigmind/domain/categories';
import type { CategoryRecord } from '@bigmind/storage';
import {
  CategoryRepositoryError,
  type CategoryErrorCode,
} from '@bigmind/features';

import {
  categoryRepository,
  noteRepository,
} from '../../features/data/repositories';
import type {
  CategoriesStackParamList,
  RootTabParamList,
} from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';

type Props = CompositeScreenProps<
  NativeStackScreenProps<CategoriesStackParamList, 'CategoryDetail'>,
  BottomTabScreenProps<RootTabParamList>
>;

const ERROR_MESSAGES: Record<CategoryErrorCode, string> = {
  CATEGORY_NOT_FOUND: 'The category does not exist.',
  CATEGORY_NAME_INVALID: 'Category name cannot be empty.',
  CATEGORY_PARENT_NOT_FOUND: 'The parent category does not exist.',
  CATEGORY_CYCLE: 'A category cannot be moved inside itself.',
  CATEGORY_NOT_EMPTY: 'Delete its subcategories first.',
  CATEGORY_HAS_NOTES: 'Move or delete its notes first.',
};

function describeError(cause: unknown): string {
  if (cause instanceof CategoryRepositoryError) {
    return ERROR_MESSAGES[cause.code] ?? cause.message;
  }
  return cause instanceof Error ? cause.message : 'Something went wrong.';
}

export function CategoryDetailScreen({ navigation, route }: Props) {
  const { categoryId } = route.params;
  const [category, setCategory] = useState<CategoryRecord | null>(null);
  const [noteTitles, setNoteTitles] = useState<{ id: string; title: string }[]>(
    [],
  );
  const [editing, setEditing] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [loadedCategory, notes] = await Promise.all([
      categoryRepository.findById(categoryId),
      noteRepository.list({ categoryId }),
    ]);
    if (!loadedCategory) {
      Alert.alert('Category not found', 'It may have been deleted.');
      navigation.goBack();
      return;
    }
    setCategory(loadedCategory);
    setNoteTitles(notes.map((note) => ({ id: note.id, title: note.title })));
    setError(null);
  }, [categoryId, navigation]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveRename = async () => {
    setError(null);
    try {
      await categoryRepository.update(categoryId, {
        name,
        icon: icon === '' ? undefined : icon,
      });
      setEditing(false);
      await refresh();
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const createChild = async () => {
    setError(null);
    if (icon && !isCategoryIcon(icon)) {
      setError('Icon must be a single emoji.');
      return;
    }
    try {
      await categoryRepository.create({
        name,
        icon: icon || null,
        parentId: categoryId,
      });
      setAddingChild(false);
      setName('');
      setIcon('');
      await refresh();
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const confirmDelete = () => {
    Alert.alert('Delete category?', 'Children and notes block deletion.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await categoryRepository.delete(categoryId);
            navigation.goBack();
          } catch (cause) {
            setError(describeError(cause));
          }
        },
      },
    ]);
  };

  if (!category) {
    return <View style={styles.screen} />;
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={noteTitles}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.categoryName}>
              {category.icon ? `${category.icon} ` : ''}
              {category.name}
            </Text>
            {category.description ? (
              <Text style={styles.description}>{category.description}</Text>
            ) : null}
            <View style={styles.actions}>
              <Pressable
                style={styles.actionButton}
                onPress={() => {
                  setName(category.name);
                  setIcon(category.icon ?? '');
                  setError(null);
                  setEditing(true);
                }}
                testID="rename-category"
              >
                <Text style={styles.actionLabel}>Rename</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                onPress={() => {
                  setName('');
                  setIcon('');
                  setError(null);
                  setAddingChild(true);
                }}
                testID="add-child-category"
              >
                <Text style={styles.actionLabel}>＋ Subcategory</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.dangerButton]}
                onPress={confirmDelete}
                testID="delete-category"
              >
                <Text style={[styles.actionLabel, styles.dangerLabel]}>
                  Delete
                </Text>
              </Pressable>
            </View>
            <Text style={styles.sectionTitle}>
              Notes in this category ({noteTitles.length})
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.noteRow, pressed && styles.pressed]}
            onPress={() =>
              navigation.navigate('Notes', {
                screen: 'NoteDetail',
                params: { noteId: item.id },
              })
            }
            testID={`category-note-${item.id}`}
          >
            <Text style={styles.noteTitle} numberOfLines={1}>
              {item.title}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No notes in this category yet.</Text>
        }
      />

      <Modal
        visible={editing}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setEditing(false)}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Rename category</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Name"
              placeholderTextColor={colors.textMuted}
              autoFocus
              testID="rename-name"
            />
            <TextInput
              style={styles.input}
              value={icon}
              onChangeText={setIcon}
              placeholder="Icon (optional emoji)"
              placeholderTextColor={colors.textMuted}
              testID="rename-icon"
            />
            {error ? (
              <Text style={styles.error} testID="category-detail-error">
                {error}
              </Text>
            ) : null}
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
              ]}
              onPress={() => void saveRename()}
              testID="rename-submit"
            >
              <Text style={styles.primaryLabel}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={addingChild}
        transparent
        animationType="fade"
        onRequestClose={() => setAddingChild(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setAddingChild(false)}
        >
          <View style={styles.card}>
            <Text style={styles.cardTitle}>New subcategory</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Name"
              placeholderTextColor={colors.textMuted}
              autoFocus
              testID="child-name"
            />
            <TextInput
              style={styles.input}
              value={icon}
              onChangeText={setIcon}
              placeholder="Icon (optional emoji)"
              placeholderTextColor={colors.textMuted}
              testID="child-icon"
            />
            {error ? (
              <Text style={styles.error} testID="category-detail-error">
                {error}
              </Text>
            ) : null}
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
              ]}
              onPress={() => void createChild()}
              testID="child-submit"
            >
              <Text style={styles.primaryLabel}>Create</Text>
            </Pressable>
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
  content: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  header: {
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  categoryName: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
  description: {
    color: colors.textMuted,
    fontSize: typography.body,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  dangerButton: {
    borderColor: colors.danger,
  },
  actionLabel: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  dangerLabel: {
    color: colors.danger,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  noteRow: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  pressed: {
    opacity: 0.85,
  },
  noteTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
  empty: {
    color: colors.textMuted,
    fontSize: typography.body,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: '700',
  },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.text,
    fontSize: typography.body,
  },
  error: {
    color: colors.danger,
    fontSize: typography.caption,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryLabel: {
    color: colors.background,
    fontSize: typography.body,
    fontWeight: '700',
  },
});
