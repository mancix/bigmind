import { useCallback, useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/Screen';
import { useWorkspaces } from '../../features/workspaces/workspace-context';
import {
  canEditContent,
  canManageWorkspace,
  isRole,
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from '../../features/workspaces/workspace-roles';
import {
  changeMemberRole,
  fetchMembers,
  removeMember,
  type WorkspaceMember,
} from '../../features/workspaces/workspace-client';
import type { WorkspacesStackParamList } from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<
  WorkspacesStackParamList,
  'WorkspaceMembers'
>;

const roleColors: Record<string, string> = {
  OWNER: colors.primary,
  EDITOR: colors.accent,
  VIEWER: colors.textMuted,
};

/**
 * Workspace Members: lists every member with their role. OWNERs can change
 * roles and remove members; EDITORs/VIEWERs get read-only access (the API
 * enforces the same rules server-side with 403).
 */
export function WorkspaceMembersScreen({ route, navigation }: Props) {
  const { workspaceId, workspaceName } = route.params;
  const { workspaces } = useWorkspaces();
  const current = workspaces.find((ws) => ws.id === workspaceId);
  const role = current?.role ?? 'VIEWER';
  const isOwner = canManageWorkspace(role);

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setMembers(await fetchMembers(workspaceId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Failed to load members. Try again.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeRole = async (member: WorkspaceMember, newRole: WorkspaceRole) => {
    if (member.role === newRole) return;
    setError(null);
    try {
      await changeMemberRole(workspaceId, member.userId, newRole);
      setMembers((prev) =>
        prev.map((m) =>
          m.userId === member.userId ? { ...m, role: newRole } : m,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to change role.',
      );
    }
  };

  const remove = async (member: WorkspaceMember) => {
    setError(null);
    try {
      await removeMember(workspaceId, member.userId);
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to remove member.',
      );
    }
  };

  return (
    <Screen
      title={`${workspaceName} · Members`}
      subtitle={`Your role: ${role}${isRole(role, 'OWNER') ? ' (manage members)' : ' (read-only)'}`}
    >
      {error ? (
        <Text style={styles.error} testID="members-error">
          {error}
        </Text>
      ) : null}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>Loading members...</Text>
        </View>
      ) : members.length === 0 ? (
        <Text style={styles.muted}>No members found.</Text>
      ) : (
        <View style={styles.list}>
          {members.map((member, index) => (
            <View key={member.userId} style={styles.row}>
              <View style={styles.rowBody}>
                <Text style={styles.email} testID={`member-email-${index}`}>
                  {member.email}
                </Text>
                <Text style={styles.joined}>
                  Joined: {new Date(member.joinedAt).toLocaleDateString()}
                </Text>
                <Text
                  style={[
                    styles.roleBadge,
                    { color: roleColors[member.role] ?? colors.textMuted },
                  ]}
                >
                  {member.role}
                </Text>
              </View>

              {isOwner && !isRole(member.role, 'OWNER') ? (
                <View style={styles.actions}>
                  {WORKSPACE_ROLES.filter((r) => r !== 'OWNER').map((r) => (
                    <Pressable
                      key={r}
                      testID={`member-role-${r}-${index}`}
                      onPress={() => void changeRole(member, r)}
                      style={[
                        styles.actionButton,
                        member.role === r && styles.actionActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.actionLabel,
                          member.role === r && styles.actionLabelActive,
                        ]}
                      >
                        {r}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable
                    testID={`member-remove-${index}`}
                    onPress={() => void remove(member)}
                    style={[styles.actionButton, styles.removeButton]}
                  >
                    <Text style={styles.removeLabel}>Remove</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      )}

      {isOwner ? (
        <Pressable
          testID="open-invite"
          style={({ pressed }) => [
            styles.inviteButton,
            pressed && styles.pressed,
          ]}
          onPress={() =>
            navigation.navigate('InviteUser', { workspaceId, workspaceName })
          }
        >
          <Text style={styles.inviteLabel}>+ Invite user</Text>
        </Pressable>
      ) : (
        <Text style={styles.permissionHint}>
          {canEditContent(role)
            ? 'Editors can create and edit content but cannot manage members.'
            : 'Viewers have read-only access. Ask an owner to manage members and invitations.'}
        </Text>
      )}
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
    gap: spacing.sm,
  },
  rowBody: {
    gap: spacing.xs,
  },
  email: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
  joined: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  roleBadge: {
    fontSize: typography.caption,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignItems: 'center',
  },
  actionButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  actionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceAlt,
  },
  actionLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  actionLabelActive: {
    color: colors.primary,
  },
  removeButton: {
    borderColor: colors.danger,
  },
  removeLabel: {
    color: colors.danger,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  inviteButton: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  inviteLabel: {
    color: colors.background,
    fontSize: typography.body,
    fontWeight: '700',
  },
  permissionHint: {
    color: colors.textMuted,
    fontSize: typography.caption,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.85,
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
});