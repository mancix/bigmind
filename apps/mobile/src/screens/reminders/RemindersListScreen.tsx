import { useCallback, useEffect, useMemo, useState } from 'react';
import { type CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ReminderRecord } from '@bigmind/storage';
import type { SyncStatus } from '@bigmind/sync';
import { requestBackgroundSync } from '@bigmind/sync';

import { SyncStatusPill } from '../../components/SyncStatusPill';
import {
  noteRepository,
  remindersRepository,
  subscribeToDataChanges,
} from '../../features/data/repositories';
import {
  AGENDA_SECTION_KEYS,
  AGENDA_SECTION_LABELS,
  buildAgendaReminders,
  formatDue,
  isOverdue,
  type AgendaSectionKey,
} from '../../features/reminders/reminder-list';
import type {
  RemindersStackParamList,
  RootTabParamList,
} from '../../navigation/types';
import { mobileSyncEngine } from '../../sync/sync-service';
import { colors, spacing, typography } from '../../theme';

type Props = CompositeScreenProps<
  NativeStackScreenProps<RemindersStackParamList, 'RemindersList'>,
  BottomTabScreenProps<RootTabParamList>
>;

interface AgendaSection {
  key: AgendaSectionKey;
  title: string;
  data: ReminderRecord[];
}

/**
 * Reminders tab root: the mobile counterpart of the web Agenda page.
 *
 * - Groups reminders into Today / Tomorrow / Upcoming / Completed (same rules
 *   as `apps/web/src/routes/agenda.tsx`, sorted by `dueAt` ascending) using
 *   the pure helpers in `features/reminders/reminder-list.ts`.
 * - Rendered with a `SectionList` (the FlatList virtualized primitive) so the
 *   tab stays smooth with thousands of reminders; rows are cheap and
 *   keyed by id.
 * - Local title + description search works offline.
 * - All mutations (toggle complete, delete) go through the SHARED
 *   `RemindersRepository`, which queues outbox operations for the sync engine.
 * - Loading / empty / offline states are handled explicitly.
 */
export function RemindersListScreen({ navigation }: Props) {
  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [noteTitles, setNoteTitles] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    mobileSyncEngine.getStatus(),
  );

  const refresh = useCallback(async () => {
    const [list, notes] = await Promise.all([
      remindersRepository.list(),
      noteRepository.list(),
    ]);
    setReminders(list);
    setNoteTitles(
      Object.fromEntries(
        notes
          .filter((note) => !note.deletedAt)
          .map((note) => [note.id, note.title]),
      ),
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeToDataChanges(() => void refresh());
  }, [refresh]);

  useEffect(() => mobileSyncEngine.subscribe(setSyncStatus), []);

  const pullToRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    requestBackgroundSync();
    setRefreshing(false);
  }, [refresh]);

  const sections = useMemo<AgendaSection[]>(() => {
    const grouped = buildAgendaReminders(reminders, { query });
    // Hide empty sections (web Agenda parity); search narrows the sections too.
    return AGENDA_SECTION_KEYS.filter((key) => grouped[key].length > 0).map(
      (key) => ({
        key,
        title: AGENDA_SECTION_LABELS[key],
        data: grouped[key],
      }),
    );
  }, [reminders, query]);

  const hasAnyReminders = reminders.length > 0;
  const isOffline = syncStatus === 'offline';

  const goToNote = (noteId: string) => {
    navigation.navigate('Notes', {
      screen: 'NoteDetail',
      params: { noteId },
    });
  };

  const toggle = (reminder: ReminderRecord) => {
    // Persist through the shared repository, then re-read so the row moves to
    // the Completed/Upcoming section immediately (no need to wait for a sync
    // pass or a manual refresh).
    void remindersRepository.toggle(reminder.id).then(() => refresh());
  };

  const openReminder = (reminder: ReminderRecord) => {
    navigation.navigate('ReminderDetail', { reminderId: reminder.id });
  };

  const renderRow = ({ item }: { item: ReminderRecord }) => {
    const linkedTitle = item.linkedNoteId
      ? noteTitles[item.linkedNoteId]
      : undefined;
    const overdue = isOverdue(item);
    return (
      <View style={styles.row}>
        <Pressable
          style={({ pressed }) => [
            styles.checkbox,
            item.completed && styles.checkboxChecked,
            pressed && styles.rowPressed,
          ]}
          onPress={() => toggle(item)}
          testID={`reminder-toggle-${item.id}`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.completed }}
          accessibilityLabel={
            item.completed ? 'Mark incomplete' : 'Mark complete'
          }
        >
          {item.completed ? <Text style={styles.checkmark}>✓</Text> : null}
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.rowBody, pressed && styles.rowPressed]}
          onPress={() => openReminder(item)}
          testID={`reminder-row-${item.id}`}
        >
          <Text
            style={[
              styles.rowTitle,
              item.completed && styles.rowTitleCompleted,
            ]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          <View style={styles.metaRow}>
            {overdue ? (
              <Text style={styles.overdue}>Overdue</Text>
            ) : null}
            <Text style={styles.rowMeta} numberOfLines={1}>
              ⏰ {formatDue(item.dueAt)}
            </Text>
          </View>
          {linkedTitle ? (
            <Pressable
              onPress={() => goToNote(item.linkedNoteId as string)}
              testID={`reminder-linked-${item.id}`}
              hitSlop={8}
            >
              <Text style={styles.linkNote} numberOfLines={1}>
                🔗 {linkedTitle}
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      </View>
    );
  };

  const renderSectionHeader = ({ section }: { section: AgendaSection }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      <Text style={styles.sectionCount}>{section.data.length}</Text>
    </View>
  );

  const emptyCopy = !hasAnyReminders
    ? 'No reminders yet — tap "＋ New reminder" to create one.'
    : `No reminders match "${query}".`;

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search reminders (title or description)"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          testID="reminder-search"
        />
        <View style={styles.statusRow}>
          <SyncStatusPill />
        </View>
      </View>

      {isOffline ? (
        <View style={styles.offlineBanner} testID="reminders-offline-banner">
          <Text style={styles.offlineText}>
            You're offline — reminders are saved locally and will sync when
            you're back online.
          </Text>
        </View>
      ) : null}

      {isLoading && hasAnyReminders === false ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>Loading reminders...</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          windowSize={7}
          maxToRenderPerBatch={20}
          updateCellsBatchingPeriod={40}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void pullToRefresh()}
            />
          }
          contentContainerStyle={[
            styles.list,
            !hasAnyReminders && styles.listEmpty,
          ]}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.empty} testID="reminders-empty">
                {emptyCopy}
              </Text>
            </View>
          }
        />
      )}

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={() => navigation.navigate('ReminderForm', {})}
        testID="new-reminder"
      >
        <Text style={styles.fabLabel}>＋ New reminder</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  toolbar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  searchInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: typography.body,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  offlineBanner: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  offlineText: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  list: {
    padding: spacing.md,
    gap: spacing.sm,
    paddingBottom: 96,
  },
  listEmpty: {
    flexGrow: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  muted: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: typography.body,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    paddingVertical: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: '700',
  },
  sectionCount: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  rowPressed: {
    opacity: 0.85,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: {
    color: colors.background,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: '600',
  },
  rowTitleCompleted: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  overdue: {
    color: colors.danger,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  rowMeta: {
    flexShrink: 1,
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  linkNote: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    elevation: 4,
  },
  fabPressed: {
    opacity: 0.85,
  },
  fabLabel: {
    color: colors.background,
    fontSize: typography.body,
    fontWeight: '700',
  },
});