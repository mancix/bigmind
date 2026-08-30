import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { registerRequestSchema } from '@bigmind/contracts';

import { AuthField } from '../components/AuthField';
import { AuthLayout } from '../components/AuthLayout';
import { useAuth } from '../features/auth/auth-provider';
import type { AuthStackParamList } from '../navigation/types';
import { colors, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

export function RegisterScreen({ navigation }: Props) {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    // Client-side validation reuses the shared ts-rest contract schema.
    const parsed = registerRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? 'Check the highlighted fields.',
      );
      return;
    }

    setSubmitting(true);
    try {
      await register(email, password);
      // Registration returns a token pair, so the user is signed in directly.
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Registration failed. Try again.',
      );
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="A personal workspace is created automatically"
    >
      <AuthField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        textContentType="emailAddress"
        autoComplete="email"
        testID="register-email"
      />
      <AuthField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secureTextEntry
        textContentType="password"
        autoComplete="password"
        testID="register-password"
      />
      <AuthField
        label="Confirm password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        placeholder="••••••••"
        secureTextEntry
        textContentType="password"
        autoComplete="password"
        testID="register-confirm"
      />
      {error ? (
        <Text style={styles.error} testID="auth-error">
          {error}
        </Text>
      ) : null}
      <Pressable
        style={({ pressed }) => [
          styles.button,
          pressed && styles.buttonPressed,
        ]}
        onPress={() => void submit()}
        disabled={submitting}
        testID="register-submit"
      >
        {submitting ? (
          <ActivityIndicator color={colors.background} />
        ) : (
          <Text style={styles.buttonLabel}>Create account</Text>
        )}
      </Pressable>
      <View style={styles.switchRow}>
        <Text style={styles.switchText}>Already have an account?</Text>
        <Pressable
          onPress={() => navigation.navigate('Login')}
          testID="goto-login"
        >
          <Text style={styles.switchLink}>Sign in</Text>
        </Pressable>
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  button: {
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
  error: {
    color: colors.danger,
    fontSize: typography.caption,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  switchText: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  switchLink: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
