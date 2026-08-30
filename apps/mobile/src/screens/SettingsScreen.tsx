import { useCallback, useEffect, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../features/auth/auth-provider';
import { getApiUrl } from '../features/auth/api-url';
import { storage } from '../storage';
import { Card } from '../components/Card';
import { Screen } from '../components/Screen';
import { colors, spacing, typography } from '../theme';

export function SettingsScreen() {
  const { authState, isAuthenticated, user, logout } = useAuth();
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    setCleared(false);
  }, []);

  const clearLocalData = useCallback(async () => {
    await storage.clearAll();
    setCleared(true);
  }, []);

  return (
    <Screen title="Settings" subtitle="App configuration">
      <Card title="Authentication">
        <Text style={styles.row}>State: {authState}</Text>
        <Text style={styles.row}>Authenticated: {String(isAuthenticated)}</Text>
        {user ? (
          <Text style={styles.row}>User: {user.email}</Text>
        ) : (
          <Text style={styles.row}>User: not signed in</Text>
        )}
        <View style={styles.buttonRow}>
          <Button title="Log out" onPress={logout} color={colors.danger} />
        </View>
      </Card>

      <Card title="API">
        <Text style={styles.row}>{getApiUrl()}</Text>
        <Text style={styles.muted}>
          Set EXPO_PUBLIC_API_URL in the mobile environment to override.
        </Text>
      </Card>

      <Card title="Local data">
        <Text style={styles.row}>
          Storage engine: @bigmind/storage (in-memory placeholder)
        </Text>
        <Text style={styles.row}>
          Cleared {cleared ? '✓' : '—'} (logout/login will wipe local data, like
          the web app)
        </Text>
        <View style={styles.buttonRow}>
          <Button title="Clear local data" onPress={clearLocalData} />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    color: colors.text,
    fontSize: typography.body,
    marginTop: spacing.xs,
  },
  muted: {
    color: colors.textMuted,
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
  buttonRow: {
    marginTop: spacing.md,
  },
});
