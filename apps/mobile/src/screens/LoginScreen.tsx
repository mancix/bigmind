import { useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { loginRequestSchema } from '@bigmind/contracts';

import { AuthField } from '../components/AuthField';
import { AuthLayout } from '../components/AuthLayout';
import { useAuth } from '../features/auth/auth-provider';
import type { AuthStackParamList } from '../navigation/types';
import { colors, spacing, typography } from '../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    setError(null);

    // Client-side validation reuses the shared ts-rest contract schema.
    const parsed = loginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? 'Check the highlighted fields.',
      );
      return;
    }

    setSubmitting(true);
    try {
      await login(email, password);
      // Once tokens are stored the RootGate switches to the main tabs.
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Login failed. Try again.',
      );
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Log in to your BigMind account">
      <AuthField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        textContentType="emailAddress"
        autoComplete="email"
        testID="login-email"
      />
      <AuthField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        secureTextEntry
        textContentType="password"
        autoComplete="password"
        testID="login-password"
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
        testID="login-submit"
      >
        {submitting ? (
          <ActivityIndicator color={colors.background} />
        ) : (
          <Text style={styles.buttonLabel}>Sign in</Text>
        )}
      </Pressable>
      <View style={styles.switchRow}>
        <Text style={styles.switchText}>New to BigMind?</Text>
        <Pressable
          onPress={() => navigation.navigate('Register')}
          testID="goto-register"
        >
          <Text style={styles.switchLink}>Create account</Text>
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
