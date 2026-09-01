import { useCallback, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useWorkspaces } from '../../features/workspaces/workspace-context';
import {
  canManageWorkspace,
  workspaceType,
} from '../../features/workspaces/workspace-roles';
import type { WorkspacesStackParamList } from '../../navigation/types';
import { Screen } from '../../components/Screen';
import { colors, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<WorkspacesStackParamList, 'WorkspacesList'>;

const roleColors: Record<string, string> = {
  OWNER: colors.primary,
  EDITOR: colors.accent,
  VIEWER: colors.textMuted,
};

/** Workspace list: switch the active workspace, refresh, and manage. */
export function WorkspacesListScreen({ navigation }: Props) {
  const { workspaces, currentWorkspace, isLoading, switchWorkspace, refresh } =
    useWorkspaces();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await refresh();
    } catch {
      setError('Could not refresh workspaces. Showing cached list.');
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const switchTo = async (id: string) => {
    setError(null);
    try {
      await switchWorkspace(id);
    } catch {
      setError('Could not switch workspace. Try again.');
    }
  };

  return (
    <Screen title="Workspaces" subtitle="Switch, create, and manage workspaces">
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isLoading && workspaces.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>Loading workspaces...</Text>
        </View>
      ) : null}

      <Pressable
        testID="refresh-workspaces"
        style={({ pressed }) => [
          styles.refreshButton,
          pressed && styles.rowPressed,
        ]}
        onPress={() => void onRefresh()}
        disabled={refreshing}
      >
        {refreshing ? (
          <ActivityIndicator color={colors.background} />
        ) : (
          <Text style={styles.refreshLabel}>Refresh list</Text>
        )}
      </Pressable>

      {workspaces.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.muted}>
            No workspaces available. Pull to refresh when online.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {workspaces.map((ws, index) => {
            const active = ws.id === currentWorkspace?.id;
            const type = workspaceType(ws);
            return (
              <Pressable
                key={ws.id}
                testID={`workspace-item-${index}`}
                style={({ pressed }) => [
                  styles.row,
                  active && styles.rowActive,
                  pressed && styles.rowPressed,
                ]}
                onPress={() => void switchTo(ws.id)}
              >
                <View style={styles.rowTop}>
                  <Text style={styles.rowName}>
                    {ws.name}
                    {active ? '  ✓' : ''}
                  </Text>
                  <View style={styles.badges}>
                    <Text
                      style={[
                        styles.badge,
                        { color: roleColors[ws.role] ?? colors.textMuted },
                      ]}
                    >
                      {ws.role}
                    </Text>
                    <Text style={styles.badgeType}>{type}</Text>
                  </View>
                </View>
                {ws.description ? (
                  <Text style={styles.rowDescription} numberOfLines={2}>
                    {ws.description}
                  </Text>
                ) : null}
                {canManageWorkspace(ws.role) ? (
                  <Pressable
                    testID={`workspace-manage-${index}`}
                    onPress={(event) => {
                      event.stopPropagation();
                      navigation.navigate('WorkspaceMembers', {
                        workspaceId: ws.id,
                        workspaceName: ws.name,
                      });
                    }}
                    style={styles.manageLink}
                  >
                    <Text style={styles.manageText}>Members & invitations</Text>
                  </Pressable>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}

      <Pressable
        testID="create-workspace"
        style={({ pressed }) => [
          styles.createButton,
          pressed && styles.rowPressed,
        ]}
        onPress={() => navigation.navigate('CreateWorkspace')}
      >
        <Text style={styles.createLabel}>+ Create Workspace</Text>
      </Pressable>

      <View style={styles.refreshHint}>
        <Text style={styles.muted}>
          The workspace list stays available offline. Sync resumes
automatically when connectivity returns.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  rowActive: {
    borderColor: colors.primary,
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowName: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
    flexShrink: 1,
  },
  rowDescription: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  badges: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'center',
  },
  badge: {
    fontSize: typography.caption,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  badgeType: {
    fontSize: typography.caption,
    color: colors.textMuted,
    textTransform: 'capitalize',
  },
  manageLink: {
    marginTop: spacing.xs,
  },
  manageText: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  createButton: {
    marginTop: spacing.lg,
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
  refreshButton: {
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  refreshLabel: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
  error: {
    color: colors.danger,
    fontSize: typography.caption,
    marginBottom: spacing.sm,
  },
  center: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  muted: {
    color: colors.textMuted,
    fontSize: typography.caption,
    textAlign: 'center',
  },
  refreshHint: {
    marginTop: spacing.md,
  },
});