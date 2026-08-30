import { useCallback, useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { isCategoryIcon } from '@bigmind/domain/categories';
import type { CategoryTreeNode } from '@bigmind/domain/categories';
import { CategoryRepositoryError } from '@bigmind/features';

import {
  categoryRepository,
  subscribeToDataChanges,
} from '../../features/data/repositories';
import type { CategoriesStackParamList } from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<CategoriesStackParamList, 'CategoriesList'>;

export function CategoriesListScreen({ navigation }: Props) {
  const [tree, setTree] = useState<CategoryTreeNode[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setTree(await categoryRepository.listTree());
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

  const createCategory = async () => {
    setError(null);
    if (icon && !isCategoryIcon(icon)) {
      setError('Icon must be a single emoji.');
      return;
    }
    try {
      await categoryRepository.create({ name, icon: icon || null });
      setCreating(false);
      setName('');
      setIcon('');
      await refresh();
    } catch (cause) {
      if (cause instanceof CategoryRepositoryError) {
        setError(cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not create.');
      }
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void pullToRefresh()}
          />
        }
      >
        {tree.length === 0 ? (
          <Text style={styles.empty}>
            No categories yet — organize your notes.
          </Text>
        ) : (
          tree.map((category) => (
            <CategoryRow
              key={category.id}
              node={category}
              depth={0}
              onPress={(categoryId) =>
                navigation.navigate('CategoryDetail', { categoryId })
              }
            />
          ))
        )}
      </ScrollView>

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
        onPress={() => setCreating(true)}
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
    </View>
  );
}

interface CategoryRowProps {
  node: CategoryTreeNode;
  depth: number;
  onPress: (categoryId: string) => void;
}

function CategoryRow({ node, depth, onPress }: CategoryRowProps) {
  return (
    <View>
      <Pressable
        style={({ pressed }) => [
          styles.row,
          { marginLeft: depth * spacing.md },
          pressed && styles.pressed,
        ]}
        onPress={() => onPress(node.id)}
        testID={`category-row-${node.id}`}
      >
        <Text style={styles.rowIcon}>{node.icon ?? '🗂️'}</Text>
        <Text style={styles.rowName} numberOfLines={1}>
          {node.name}
        </Text>
        <Text style={styles.rowCount}>
          {node.children.length > 0 ? `▸ ${node.children.length}` : ''}
        </Text>
      </Pressable>
      {node.children.map((child) => (
        <CategoryRow
          key={child.id}
          node={child}
          depth={depth + 1}
          onPress={onPress}
        />
      ))}
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
    gap: spacing.xs,
    paddingBottom: 96,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: typography.body,
    marginTop: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.85,
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
  rowCount: {
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
});
