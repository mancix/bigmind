import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { createWorkspaceRequestSchema } from '@bigmind/contracts';

import { Screen } from '../../components/Screen';
import { useWorkspaces } from '../../features/workspaces/workspace-context';
import type { WorkspacesStackParamList } from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<WorkspacesStackParamList, 'CreateWorkspace'>;

/**
 * Create Workspace: name (3–100 chars) + optional description, validated with
 * the shared contract schema. After creation the new workspace becomes the
 * active one (same behavior as the web switcher modal).
 */
export function CreateWorkspaceScreen({ navigation }: Props) {
  const { addWorkspace } = useWorkspaces();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    setError(null);

    // Client-side validation reuses the shared ts-rest contract schema
    // (trims the name, min 3 / max 100 characters).
    const parsed = createWorkspaceRequestSchema.safeParse({
      name,
      description: description.trim() || null,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? 'Check the highlighted fields.',
      );
      return;
    }

    setSubmitting(true);
    try {
      await addWorkspace(parsed.data.name, parsed.data.description ?? null);
      // The workspace switcher now points at the new workspace; go back to
      // the list so the user sees it selected.
      navigation.goBack();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Failed to create workspace. Try again.',
      );
      setSubmitting(false);
    }
  };

  return (
    <Screen
      title="Create Workspace"
      subtitle="You will be switched to the new workspace automatically"
    >
      <Text style={styles.label}>Name</Text>
      <TextInput
        testID="workspace-name"
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Research project"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="sentences"
      />

      <Text style={styles.label}>Description (optional)</Text>
      <TextInput
        testID="workspace-description"
        style={[styles.input, styles.multiline]}
        value={description}
        onChangeText={setDescription}
        placeholder="What is this workspace used for?"
        placeholderTextColor={colors.textMuted}
        multiline
      />

      {error ? (
        <Text style={styles.error} testID="workspace-error">
          {error}
        </Text>
      ) : null}

      <Pressable
        testID="create-workspace-submit"
        style={({ pressed }) => [
          styles.button,
          pressed && styles.buttonPressed,
        ]}
        onPress={() => void submit()}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color={colors.background} />
        ) : (
          <Text style={styles.buttonLabel}>Create Workspace</Text>
        )}
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  error: {
    color: colors.danger,
    fontSize: typography.caption,
    marginTop: spacing.sm,
  },
  button: {
    marginTop: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonLabel: {
    color: colors.background,
    fontSize: typography.body,
    fontWeight: '700',
  },
});