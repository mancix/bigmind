import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  isCategoryIcon,
  type CategoryTreeNode,
} from '@bigmind/domain/categories';
import type { CategoryRecord } from '@bigmind/storage';
import {
  CategoryRepositoryError,
  type CategoryErrorCode,
} from '@bigmind/features';

import { MarkdownText } from '../../components/MarkdownText';
import {
  categoryRepository,
  noteRepository,
  subscribeToDataChanges,
} from '../../features/data/repositories';
import {
  getAncestorChain,
  getMoveTargets,
} from '../../features/categories/category-utils';
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

type ActiveModal = 'edit' | 'child' | 'description' | 'move' | null;

export function CategoryDetailScreen({ navigation, route }: Props) {
  const { categoryId } = route.params;
  const [category, setCategory] = useState<CategoryRecord | null>(null);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [tree, setTree] = useState<CategoryTreeNode[]>([]);
  const [noteTitles, setNoteTitles] = useState<{ id: string; title: string }[]>(
    [],
  );
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [description, setDescription] = useState('');
  const [moveParentId, setMoveParentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [loadedCategory, categoryList, notes] = await Promise.all([
      categoryRepository.findById(categoryId),
      categoryRepository.list(),
      noteRepository.list({ categoryId }),
    ]);
    if (!loadedCategory) {
      Alert.alert('Category not found', 'It may have been deleted.');
      navigation.goBack();
      return;
    }
    setCategory(loadedCategory);
    setCategories(categoryList);
    setTree(await categoryRepository.listTree());
    setNoteTitles(notes.map((note) => ({ id: note.id, title: note.title })));
    setError(null);
  }, [categoryId, navigation]);

  useEffect(() => {
    void refresh();
    return subscribeToDataChanges(() => void refresh());
  }, [refresh]);

  // Current node in the tree (for children display).
  const node = useMemo(() => {
    const walk = (nodes: CategoryTreeNode[]): CategoryTreeNode | undefined => {
      for (const n of nodes) {
        if (n.id === categoryId) return n;
        const found = walk(n.children);
        if (found) return found;
      }
      return undefined;
    };
    return walk(tree);
  }, [tree, categoryId]);

  const ancestors = useMemo(
    () => getAncestorChain(categories, categoryId),
    [categories, categoryId],
  );

  const saveRename = async () => {
    setError(null);
    try {
      await categoryRepository.update(categoryId, {
        name,
        icon: icon === '' ? undefined : icon,
      });
      setActiveModal(null);
      await refresh();
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const saveDescription = async () => {
    setError(null);
    try {
      await categoryRepository.update(categoryId, {
        description,
      });
      setActiveModal(null);
      await refresh();
    } catch (cause) {
      setError(describeError(cause));
    }
  };

  const saveMove = async () => {
    setError(null);
    try {
      await categoryRepository.move(categoryId, moveParentId);
      setActiveModal(null);
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
        description: description.trim() || '',
        parentId: categoryId,
      });
      setActiveModal(null);
      setName('');
      setIcon('');
      setDescription('');
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

  const moveTargets = getMoveTargets(categories, categoryId);
  const children = node?.children ?? [];

  return (
    <View style={styles.screen}>
      <FlatList
        data={noteTitles}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.categoryName} testID="category-title">
              {category.icon ? `${category.icon} ` : ''}
              {category.name}
            </Text>

            {ancestors.length > 0 ? (
              <View style={styles.breadcrumbRow} testID="category-breadcrumb">
                {ancestors.map((ancestor, index) => (
                  <Pressable
                    key={ancestor.id}
                    onPress={() =>
                      navigation.replace('CategoryDetail', {
                        categoryId: ancestor.id,
                      })
                    }
                  >
                    <Text style={styles.breadcrumb}>
                      {ancestor.name}
                      {index < ancestors.length - 1 ? ' › ' : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {category.description ? (
              <View testID="category-description-preview">
                <MarkdownText markdown={category.description} />
              </View>
            ) : null}

            {error ? (
              <Text style={styles.error} testID="category-header-error">
                {error}
              </Text>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                style={styles.actionButton}
                onPress={() => {
                  setName(category.name);
                  setIcon(category.icon ?? '');
                  setError(null);
                  setActiveModal('edit');
                }}
                testID="rename-category"
              >
                <Text style={styles.actionLabel}>Rename</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                onPress={() => {
                  setDescription(category.description);
                  setError(null);
                  setActiveModal('description');
                }}
                testID="edit-description"
              >
                <Text style={styles.actionLabel}>Description</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                onPress={() => {
                  setMoveParentId(category.parentId);
                  setError(null);
                  setActiveModal('move');
                }}
                testID="move-category"
              >
                <Text style={styles.actionLabel}>Move</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                onPress={() => {
                  setName('');
                  setIcon('');
                  setDescription('');
                  setError(null);
                  setActiveModal('child');
                }}
                testID="add-child-category"
              >
                <Text style={styles.actionLabel}>＋ Sub</Text>
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
              Subcategories ({children.length})
            </Text>
            {children.length === 0 ? (
              <Text style={styles.muted}>None.</Text>
            ) : (
              <View style={styles.childList}>
                {children.map((child) => (
                  <Pressable
                    key={child.id}
                    style={({ pressed }) => [
                      styles.childRow,
                      pressed && styles.pressed,
                    ]}
                    onPress={() =>
                      navigation.push('CategoryDetail', {
                        categoryId: child.id,
                      })
                    }
                    testID={`child-category-${child.id}`}
                  >
                    <Text style={styles.childIcon}>{child.icon ?? '🗂️'}</Text>
                    <Text style={styles.childName} numberOfLines={1}>
                      {child.name}
                    </Text>
                    <Text style={styles.childMeta}>
                      {child.children.length > 0
                        ? `${child.children.length} ▸`
                        : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

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

      {/* Rename / icon */}
      <Modal
        visible={activeModal === 'edit'}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveModal(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setActiveModal(null)}>
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

      {/* Description (Markdown) */}
      <Modal
        visible={activeModal === 'description'}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveModal(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setActiveModal(null)}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Description (Markdown)</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="Describe this category…"
              placeholderTextColor={colors.textMuted}
              multiline
              testID="description-input"
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
              onPress={() => void saveDescription()}
              testID="description-submit"
            >
              <Text style={styles.primaryLabel}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Move (parent selection) */}
      <Modal
        visible={activeModal === 'move'}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveModal(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setActiveModal(null)}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Move category</Text>
            <Text style={styles.muted}>
              Choose a new parent (the category itself and its descendants are
              excluded).
            </Text>
            <Pressable
              style={styles.parentRow}
              onPress={() => setMoveParentId(null)}
              testID="move-root"
            >
              <Text style={styles.parentRowLabel}>None (root)</Text>
              {category.parentId === null ? (
                <Text style={styles.check}>✓</Text>
              ) : null}
            </Pressable>
            <FlatList
              data={moveTargets}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.parentRow}
                  onPress={() => setMoveParentId(item.id)}
                  testID={`move-${item.id}`}
                >
                  <Text style={styles.parentRowLabel}>
                    {item.icon ? `${item.icon} ` : ''}
                    {item.name}
                  </Text>
                  {moveParentId === item.id ? (
                    <Text style={styles.check}>✓</Text>
                  ) : null}
                </Pressable>
              )}
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
              onPress={() => void saveMove()}
              testID="move-submit"
            >
              <Text style={styles.primaryLabel}>Move here</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* New subcategory */}
      <Modal
        visible={activeModal === 'child'}
        transparent
        animationType="fade"
        onRequestClose={() => setActiveModal(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setActiveModal(null)}>
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
            <TextInput
              style={[styles.input, styles.multiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="Description (Markdown, optional)"
              placeholderTextColor={colors.textMuted}
              multiline
              testID="child-description"
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
  },
  categoryName: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
  },
  breadcrumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
  },
  breadcrumb: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
    marginTop: spacing.sm,
  },
  childList: {
    gap: spacing.xs,
  },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  childIcon: {
    fontSize: 16,
  },
  childName: {
    flex: 1,
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
  childMeta: {
    color: colors.textMuted,
    fontSize: typography.caption,
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
  muted: {
    color: colors.textMuted,
    fontSize: typography.caption,
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
    maxHeight: '80%',
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
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  parentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  parentRowLabel: {
    color: colors.text,
    fontSize: typography.body,
  },
  check: {
    color: colors.accent,
    fontWeight: '700',
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