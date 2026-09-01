import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { isCategoryIcon, type CategoryTreeNode } from '@bigmind/domain/categories';
import type { CategoryRecord, NoteRecord } from '@bigmind/storage';
import { CategoryRepositoryError } from '@bigmind/features';

import { SyncStatusPill } from '../../components/SyncStatusPill';
import {
  categoryRepository,
  noteRepository,
  subscribeToDataChanges,
} from '../../features/data/repositories';
import {
  countNotesByCategory,
  searchCategoryRows,
  visibleCategoryRows,
  type FlatCategoryRow,
} from '../../features/categories/category-utils';
import type { CategoriesStackParamList } from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<CategoriesStackParamList, 'CategoriesList'>;

export function CategoriesListScreen({ navigation }: Props) {
  const [tree, setTree] = useState<CategoryTreeNode[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [noteCounts, setNoteCounts] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [parentPickerVisible, setParentPickerVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [categoryList, notes] = await Promise.all([
      categoryRepository.list(),
      noteRepository.list(),
    ]);
    setCategories(categoryList);
    setTree(await categoryRepository.listTree());
    setNoteCounts(countNotesByCategory(notes as NoteRecord[]));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeToDataChanges(() => void refresh());
  }, [refresh]);

  useEffect(() => {
    setExpanded(new Set());
  }, [query]);

  const pullToRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const rows = useMemo(() => {
    if (query.trim()) {
      return searchCategoryRows(tree, query);
    }
    return visibleCategoryRows(tree, expanded);
  }, [tree, query, expanded]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const openCreate = (parent: string | null = null) => {
    setName('');
    setIcon('');
    setDescription('');
    setParentId(parent);
    setError(null);
    setCreating(true);
  };

  const createCategory = async () => {
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
        parentId,
      });
      setCreating(false);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof CategoryRepositoryError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : 'Could not create.',
      );
    }
  };

  const parentName = parentId
    ? categories.find((category) => category.id === parentId)?.name
    : null;

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search categories"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          testID="category-search"
        />
        <View style={styles.statusRow}>
          <SyncStatusPill />
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>Loading categories...</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.node.id}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          windowSize={7}
          maxToRenderPerBatch={20}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void pullToRefresh()}
            />
          }
          contentContainerStyle={[
            styles.list,
            rows.length === 0 && styles.listEmpty,
          ]}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {tree.length === 0
                ? 'No categories yet — organize your notes.'
                : `No categories match "${query}".`}
            </Text>
          }
          renderItem={({ item }) => (
            <CategoryRow
              row={item}
              noteCount={noteCounts.get(item.node.id) ?? 0}
              expanded={expanded.has(item.node.id)}
              onToggle={() => toggle(item.node.id)}
              onPress={() =>
                navigation.navigate('CategoryDetail', {
                  categoryId: item.node.id,
                })
              }
              onCreateChild={() => openCreate(item.node.id)}
            />
          )}
        />
      )}

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
        onPress={() => openCreate(null)}
        testID="new-category"
      >
        <Text style={styles.fabLabel}>＋ New category</Text>
      </Pressable>

      <Modal
        visible={creating}
        transparent
        animationType="fade"
        onRequestClose={() => setCreating(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setCreating(false)}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>New category</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Name"
              placeholderTextColor={colors.textMuted}
              autoFocus
              testID="category-name"
            />
            <TextInput
              style={styles.input}
              value={icon}
              onChangeText={setIcon}
              placeholder="Icon (optional emoji)"
              placeholderTextColor={colors.textMuted}
              testID="category-icon"
            />
            <Pressable
              style={styles.parentButton}
              onPress={() => setParentPickerVisible(true)}
              testID="category-parent"
            >
              <Text style={styles.parentLabel}>
                {parentName ? `Parent: ${parentName}` : 'Parent: none (root)'}
              </Text>
            </Pressable>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="Description (Markdown, optional)"
              placeholderTextColor={colors.textMuted}
              multiline
              testID="category-description"
            />
            {error ? (
              <Text style={styles.error} testID="category-error">
                {error}
              </Text>
            ) : null}
            <Pressable
              style={({ pressed }) => [
                styles.createButton,
                pressed && styles.pressed,
              ]}
              onPress={() => void createCategory()}
              testID="category-submit"
            >
              <Text style={styles.createLabel}>Create</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={parentPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setParentPickerVisible(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setParentPickerVisible(false)}
        >
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Parent category</Text>
            <Pressable
              style={styles.parentRow}
              onPress={() => {
                setParentId(null);
                setParentPickerVisible(false);
              }}
              testID="parent-root"
            >
              <Text style={styles.parentRowLabel}>None (root)</Text>
            </Pressable>
            <FlatList
              data={flattenForPicker(tree)}
              keyExtractor={(row) => row.id}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.parentRow}
                  onPress={() => {
                    setParentId(item.id);
                    setParentPickerVisible(false);
                  }}
                  testID={`parent-${item.id}`}
                >
                  <Text style={styles.parentRowLabel}>
                    {'  '.repeat(item.depth)}
                    {item.icon ? `${item.icon} ` : ''}
                    {item.name}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

interface CategoryRowProps {
  row: FlatCategoryRow;
  noteCount: number;
  expanded: boolean;
  onToggle: () => void;
  onPress: () => void;
  onCreateChild: () => void;
}

function CategoryRow({
  row,
  noteCount,
  expanded,
  onToggle,
  onPress,
  onCreateChild,
}: CategoryRowProps) {
  const { node, depth } = row;
  const hasChildren = node.children.length > 0;
  return (
    <View style={[styles.row, { marginLeft: depth * spacing.md }]}>
      <Pressable
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
        onPress={onPress}
        testID={`category-row-${node.id}`}
      >
        {hasChildren ? (
          <Pressable onPress={onToggle} hitSlop={8} testID={`toggle-${node.id}`}>
            <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
          </Pressable>
        ) : (
          <Text style={styles.chevronPlaceholder}> </Text>
        )}
        <Text style={styles.rowIcon}>{node.icon ?? '🗂️'}</Text>
        <Text style={styles.rowName} numberOfLines={1}>
          {node.name}
        </Text>
        <Text style={styles.rowMeta}>
          {hasChildren ? `${node.children.length} ▸` : ''}
          {noteCount > 0 ? ` ${noteCount} notes` : ''}
        </Text>
      </Pressable>
      <Pressable onPress={onCreateChild} style={styles.inlineAdd} testID={`add-child-${node.id}`}>
        <Text style={styles.inlineAddLabel}>＋</Text>
      </Pressable>
    </View>
  );
}

function flattenForPicker(tree: CategoryTreeNode[]): {
  id: string;
  name: string;
  icon: string | null;
  depth: number;
}[] {
  const out: ReturnType<typeof flattenForPicker> = [];
  const walk = (nodes: CategoryTreeNode[], depth: number) => {
    for (const node of nodes) {
      out.push({ id: node.id, name: node.name, icon: node.icon, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(tree, 0);
  return out;
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
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  list: {
    padding: spacing.md,
    gap: spacing.xs,
    paddingBottom: 96,
  },
  listEmpty: {
    flexGrow: 1,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: typography.body,
    marginTop: spacing.xl,
  },
  row: {
    gap: spacing.xs,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.85,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: typography.caption,
    width: 14,
  },
  chevronPlaceholder: {
    width: 14,
  },
  rowIcon: {
    fontSize: 16,
  },
  rowName: {
    flex: 1,
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
  rowMeta: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  inlineAdd: {
    marginLeft: spacing.lg + spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  inlineAddLabel: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '700',
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
  fabLabel: {
    color: colors.background,
    fontSize: typography.body,
    fontWeight: '700',
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
    minHeight: 64,
    textAlignVertical: 'top',
  },
  parentButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  parentLabel: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  parentRow: {
    paddingVertical: spacing.sm,
  },
  parentRowLabel: {
    color: colors.text,
    fontSize: typography.body,
  },
  error: {
    color: colors.danger,
    fontSize: typography.caption,
  },
  createButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  createLabel: {
    color: colors.background,
    fontSize: typography.body,
    fontWeight: '700',
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
});