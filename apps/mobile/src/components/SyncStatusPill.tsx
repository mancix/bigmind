import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SyncStatus } from '@bigmind/sync';

import { mobileSyncEngine } from '../sync/sync-service';
import { colors, spacing, typography } from '../theme';

export interface SyncStatusPillCopy {
  idle: string;
  syncing: string;
  offline: string;
  auth_required: string;
  error: string;
}

export const SYNC_STATUS_COPY: SyncStatusPillCopy = {
  idle: 'Synced',
  syncing: 'Syncing…',
  offline: 'Offline',
  auth_required: 'Login required',
  error: 'Sync error',
};

const PILL_COLORS: Record<SyncStatus, string> = {
  idle: colors.accent,
  syncing: colors.primary,
  offline: colors.textMuted,
  auth_required: '#fbbf24',
  error: colors.danger,
};

/**
 * Global synchronization feedback: reflects the SHARED sync engine status
 * (`SyncStatus`: idle / syncing / offline / auth_required / error), so the
 * user always knows whether local changes were synced. Web mirrors the same
 * states in the sidebar.
 */
export function SyncStatusPill() {
  const [status, setStatus] = useState<SyncStatus>(
    mobileSyncEngine.getStatus(),
  );

  useEffect(() => mobileSyncEngine.subscribe(setStatus), []);

  return (
    <View
      style={[styles.pill, { borderColor: PILL_COLORS[status] }]}
      testID="sync-status-pill"
    >
      <View
        style={[styles.dot, { backgroundColor: PILL_COLORS[status] }]}
        testID="sync-status-dot"
      />
      <Text style={[styles.label, { color: PILL_COLORS[status] }]}>
        {SYNC_STATUS_COPY[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
});