import { useCallback, useEffect, useState } from 'react';
import { type CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { ReminderRecord } from '@bigmind/storage';

import {
  noteRepository,
  remindersRepository,
  subscribeToDataChanges,
  notifyDataChanged,
} from '../../features/data/repositories';
import { formatDue, isOverdue } from '../../features/reminders/reminder-list';
import type {
  RemindersStackParamList,
  RootTabParamList,
} from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';

type Props = CompositeScreenProps<
  NativeStackScreenProps<RemindersStackParamList, 'ReminderDetail'>,
  BottomTabScreenProps<RootTabParamList>
>;

/**
 * Reminder detail: title, description, due date, completion status, and the
 * linked note (navigates to the Notes tab). Edit and delete routes go through
 * the shared `RemindersRepository` — the same outbox-based path as the web
 * app — so changes synchronize identically and work fully offline.
 */
export function ReminderDetailScreen({ navigation, route }: Props) {
  const { reminderId } = route.params;
  const [reminder, setReminder] = useState<ReminderRecord | null>(null);
  const [linkedTitle, setLinkedTitle] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [loaded, notes] = await Promise.all([
      remindersRepository.findById(reminderId),
      noteRepository.list(),
    ]);
    if (!loaded) {
      Alert.alert('Reminder not found', 'It may have been deleted.');
      navigation.goBack();
      return;
    }
    setReminder(loaded);
    const linked = loaded.linkedNoteId
      ? notes.find((note) => note.id === loaded.linkedNoteId)
      : undefined;
    setLinkedTitle(linked && !linked.deletedAt ? linked.title : null);
  }, [navigation, reminderId]);

  useEffect(() => {
    void refresh();
    return subscribeToDataChanges(() => void refresh());
  }, [refresh]);

  const confirmDelete = () => {
    if (!reminder) return;
    Alert.alert('Delete reminder?', `"${reminder.title}" will be deleted.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await remindersRepository.remove(reminder.id);
          notifyDataChanged();
          navigation.goBack();
        },
      },
    ]);
  };

  if (!reminder) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.muted}>Loading reminder...</Text>
      </View>
    );
  }

  const overdue = isOverdue(reminder);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      testID="reminder-detail-scroll"
    >
      <View style={styles.headerRow}>
        <Text style={styles.title} testID="reminder-detail-title">
          {reminder.title}
        </Text>
        <View
          style={[
            styles.statusChip,
            reminder.completed ? styles.statusCompleted : styles.statusPending,
          ]}
          testID="reminder-detail-status"
        >
          <Text
            style={[
              styles.statusText,
              reminder.completed
                ? styles.statusCompletedText
                : styles.statusPendingText,
            ]}
          >
            {reminder.completed ? 'Completed' : 'Pending'}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Due date</Text>
        <View style={styles.dueRow}>
          <Text style={styles.dueText} testID="reminder-detail-due">
            ⏰ {formatDue(reminder.dueAt)}
          </Text>
          {overdue ? <Text style={styles.overdue}>Overdue</Text> : null}
        </View>
      </View>

      {reminder.description ? (
        <View style={styles.card}>
          <Text style={styles.label}>Description</Text>
          <Text style={styles.description} testID="reminder-detail-description">
            {reminder.description}
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.label}>Linked note</Text>
        {linkedTitle ? (
          <Pressable
            onPress={() =>
              navigation.navigate('Notes', {
                screen: 'NoteDetail',
                params: { noteId: reminder.linkedNoteId as string },
              })
            }
            testID="reminder-detail-linked-note"
          >
            <Text style={styles.linkNote}>🔗 {linkedTitle}</Text>
          </Pressable>
        ) : (
          <Text style={styles.muted}>No linked note.</Text>
        )}
      </View>

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.pressed,
          ]}
          onPress={() =>
            void remindersRepository.toggle(reminder.id).then(() => {
              void refresh();
              notifyDataChanged();
            })
          }
          testID="reminder-detail-toggle"
        >
          <Text style={styles.primaryButtonText}>
            {reminder.completed ? 'Mark incomplete' : 'Mark complete'}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed && styles.pressed,
          ]}
          onPress={() =>
            navigation.navigate('ReminderForm', { reminderId: reminder.id })
          }
          testID="reminder-detail-edit"
        >
          <Text style={styles.secondaryButtonText}>Edit</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.dangerButton,
            pressed && styles.pressed,
          ]}
          onPress={confirmDelete}
          testID="reminder-detail-delete"
        >
          <Text style={styles.dangerButtonText}>Delete</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  muted: {
    color: colors.textMuted,
    fontSize: typography.body,
  },
  headerRow: {
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '700',
  },
  statusChip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
  },
  statusCompleted: {
    borderColor: colors.accent,
  },
  statusPending: {
    borderColor: colors.primary,
  },
  statusText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  statusCompletedText: {
    color: colors.accent,
  },
  statusPendingText: {
    color: colors.primary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  label: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dueText: {
    color: colors.text,
    fontSize: typography.body,
  },
  overdue: {
    color: colors.danger,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  description: {
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 22,
  },
  linkNote: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '600',
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: typography.body,
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
  dangerButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  dangerButtonText: {
    color: colors.danger,
    fontSize: typography.body,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.85,
  },
});