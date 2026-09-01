import { useCallback, useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { inviteRequestSchema } from '@bigmind/contracts';

import { Screen } from '../../components/Screen';
import { useWorkspaces } from '../../features/workspaces/workspace-context';
import { canManageWorkspace } from '../../features/workspaces/workspace-roles';
import {
  createInvitation,
  fetchInvitations,
  revokeInvitation,
  type InvitationInfo,
} from '../../features/workspaces/workspace-client';
import type { WorkspacesStackParamList } from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<WorkspacesStackParamList, 'InviteUser'>;

/**
 * Invitations: send email invitations with a role (EDITOR/VIEWER — the
 * shared contract forbids inviting as OWNER) and list pending + accepted
 * invitations. OWNER-only; the API enforces it with 403 for editors.
 */
export function InviteUserScreen({ route }: Props) {
  const { workspaceId, workspaceName } = route.params;
  const { workspaces } = useWorkspaces();
  const current = workspaces.find((ws) => ws.id === workspaceId);
  const isOwner = canManageWorkspace(current?.role ?? 'VIEWER');

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'EDITOR' | 'VIEWER'>('EDITOR');
  const [invitations, setInvitations] = useState<InvitationInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setInvitations(await fetchInvitations(workspaceId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Failed to load invitations. Try again.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendInvite = async () => {
    if (submitting) return;
    setError(null);

    // Validation reuses the shared contract schema (email format, role rule).
    const parsed = inviteRequestSchema.safeParse({ email, role });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the fields.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createInvitation(workspaceId, email, role);
      setInvitations((prev) => [...prev, created]);
      setEmail('');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to send invitation.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const revoke = async (invitationId: string) => {
    setError(null);
    try {
      await revokeInvitation(workspaceId, invitationId);
      setInvitations((prev) => prev.filter((i) => i.id !== invitationId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to revoke invitation.',
      );
    }
  };

  const pending = invitations.filter((inv) => !inv.acceptedAt);
  const accepted = invitations.filter((inv) => inv.acceptedAt);

  return (
    <Screen
      title={`${workspaceName} · Invitations`}
      subtitle="Invite by email with a role; OWNER invites only"
    >
      {error ? (
        <Text style={styles.error} testID="invite-error">
          {error}
        </Text>
      ) : null}

      {isOwner ? (
        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            testID="invite-email"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="teammate@example.com"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
          />

          <Text style={styles.label}>Role</Text>
          <View style={styles.roleRow}>
            {(['EDITOR', 'VIEWER'] as const).map((r) => (
              <Pressable
                key={r}
                testID={`invite-role-${r}`}
                onPress={() => setRole(r)}
                style={[styles.roleButton, role === r && styles.roleActive]}
              >
                <Text
                  style={[
                    styles.roleLabel,
                    role === r && styles.roleLabelActive,
                  ]}
                >
                  {r}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            testID="send-invite"
            style={({ pressed }) => [
              styles.sendButton,
              pressed && styles.pressed,
            ]}
            onPress={() => void sendInvite()}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={styles.sendLabel}>Send invitation</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <Text style={styles.permissionHint}>
          Only owners can invite users. You have {current?.role ?? 'VIEWER'}{' '}
          access to this workspace.
        </Text>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Pending invitations</Text>
        {isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : pending.length === 0 ? (
          <Text style={styles.muted}>No pending invitations.</Text>
        ) : (
          pending.map((inv) => (
            <View key={inv.id} style={styles.row}>
              <View style={styles.rowBody}>
                <Text style={styles.rowEmail}>{inv.email}</Text>
                <Text style={styles.rowMeta}>{inv.role}</Text>
              </View>
              {isOwner ? (
                <Pressable
                  testID={`revoke-${inv.id}`}
                  onPress={() => void revoke(inv.id)}
                  style={styles.revokeButton}
                >
                  <Text style={styles.revokeLabel}>Revoke</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Accepted invitations</Text>
        {isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : accepted.length === 0 ? (
          <Text style={styles.muted}>No accepted invitations yet.</Text>
        ) : (
          accepted.map((inv) => (
            <View key={inv.id} style={styles.row}>
              <View style={styles.rowBody}>
                <Text style={styles.rowEmail}>{inv.email}</Text>
                <Text style={styles.rowMeta}>{inv.role}</Text>
              </View>
            </View>
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  label: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.text,
    fontSize: typography.body,
    marginTop: spacing.xs,
  },
  roleRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  roleButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  roleActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceAlt,
  },
  roleLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  roleLabelActive: {
    color: colors.primary,
  },
  sendButton: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  sendLabel: {
    color: colors.background,
    fontSize: typography.body,
    fontWeight: '700',
  },
  section: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: '700',
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowBody: {
    flex: 1,
    gap: spacing.xs,
  },
  rowEmail: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
  rowMeta: {
    color: colors.textMuted,
    fontSize: typography.caption,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  revokeButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  revokeLabel: {
    color: colors.danger,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  permissionHint: {
    color: colors.textMuted,
    fontSize: typography.caption,
    marginBottom: spacing.md,
  },
  pressed: {
    opacity: 0.85,
  },
  error: {
    color: colors.danger,
    fontSize: typography.caption,
    marginBottom: spacing.sm,
  },
  muted: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
});