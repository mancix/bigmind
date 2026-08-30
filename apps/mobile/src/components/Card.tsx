import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme';

interface CardProps {
  title: string;
  children?: ReactNode;
}

/** Simple information card used by the placeholder screens. */
export function Card({ title, children }: CardProps) {
  return (
    <View style={styles.card} testID="card">
      <Text style={styles.title}>{title}</Text>
      {children ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  title: {
    color: colors.accent,
    fontSize: typography.heading,
    fontWeight: '600',
  },
  body: {
    marginTop: spacing.sm,
  },
});
