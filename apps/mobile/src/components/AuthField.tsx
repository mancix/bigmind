import type { ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, spacing, typography } from '../theme';

interface AuthFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences';
  textContentType?: 'emailAddress' | 'password' | 'oneTimeCode';
  autoComplete?: 'email' | 'password' | 'off';
  testID?: string;
  children?: ReactNode;
}

/** Labeled input used by the auth screens. */
export function AuthField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  autoCapitalize = 'none',
  textContentType,
  autoComplete = 'off',
  testID,
  children,
}: AuthFieldProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        textContentType={textContentType}
        autoComplete={autoComplete}
        testID={testID}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '600',
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
});
