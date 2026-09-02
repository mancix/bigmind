import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  FlatList,
} from 'react-native';
import { validateReminderTitle } from '@bigmind/domain/reminders';
import type { NoteRecord } from '@bigmind/storage';

import {
  noteRepository,
  remindersRepository,
  notifyDataChanged,
} from '../../features/data/repositories';
import type { RemindersStackParamList } from '../../navigation/types';
import { colors, spacing, typography } from '../../theme';

type Props = NativeStackScreenProps<RemindersStackParamList, 'ReminderForm'>;

/** Default due time for new reminders: one hour from now (web parity). */
function defaultDueDate(): Date {
  return new Date(Date.now() + 3600_000);
}

/**
 * Create / edit a reminder. All fields map 1:1 onto the shared
 * `CreateReminderInput` / `UpdateReminderInput` of `RemindersRepository`
 * (`@bigmind/features`): title, description, due date, optional linked note,
 * and (in edit mode) completion status.
 *
 * Saving is fully offline — the repository writes locally and queues an outbox
 * operation that the shared sync engine pushes later, exactly like the web app.
 */
export function ReminderFormScreen({ navigation, route }: Props) {
  const reminderId = route.params?.reminderId;
  const isEditing = reminderId !== undefined;

  const [isLoading, setIsLoading] = useState(isEditing);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState<Date>(defaultDueDate);
  const [completed, setCompleted] = useState(false);
  const [linkedNoteId, setLinkedNoteId] = useState<string | null>(null);
  const [linkedTitle, setLinkedTitle] = useState<string | null>(null);

  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [notePickerVisible, setNotePickerVisible] = useState(false);
  const [noteQuery, setNoteQuery] = useState('');

  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [loadedNotes] = await Promise.all([noteRepository.list()]);
      const available = loadedNotes.filter((note) => !note.deletedAt);
      setNotes(available);

      if (!isEditing) {
        // Pre-link support: a note detail screen opens this form with
        // `defaultLinkedNoteId` so new reminders start linked to that note.
        const defaultLinked = route.params?.defaultLinkedNoteId;
        if (defaultLinked && available.some((note) => note.id === defaultLinked)) {
          setLinkedNoteId(defaultLinked);
          setLinkedTitle(
            available.find((note) => note.id === defaultLinked)?.title ?? null,
          );
        }
        return;
      }
      const reminder = await remindersRepository.findById(reminderId);
      if (!reminder) {
        navigation.goBack();
        return;
      }
      setTitle(reminder.title);
      setDescription(reminder.description);
      setDueDate(new Date(reminder.dueAt));
      setCompleted(reminder.completed);
      setLinkedNoteId(reminder.linkedNoteId);
      setLinkedTitle(
        reminder.linkedNoteId
          ? (available.find((note) => note.id === reminder.linkedNoteId)
              ?.title ?? null)
          : null,
      );
      setIsLoading(false);
    })();
  }, [isEditing, navigation, reminderId]);

  const filteredNotes = useMemo(
    () =>
      notes.filter((note) =>
        note.title.toLocaleLowerCase().includes(noteQuery.trim().toLocaleLowerCase()),
      ),
    [notes, noteQuery],
  );

  const selectNote = (note: NoteRecord) => {
    setLinkedNoteId(note.id);
    setLinkedTitle(note.title);
    setNotePickerVisible(false);
  };

  const clearNote = () => {
    setLinkedNoteId(null);
    setLinkedTitle(null);
  };

  const onDateChosen = (_event: unknown, selected?: Date) => {
    setShowDate(false);
    if (selected) {
      setDueDate(selected);
      // Android picks date and time in two dialogs; ask for the time next.
      setShowTime(true);
    }
  };

  const onTimeChosen = (_event: unknown, selected?: Date) => {
    setShowTime(false);
    if (selected) setDueDate(selected);
  };

  const save = useCallback(async () => {
    setError(null);
    // Reuse the SHARED domain rule before persisting anything.
    try {
      validateReminderTitle(title);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Title is not valid.',
      );
      return;
    }

    setSaving(true);
    try {
      if (isEditing) {
        await remindersRepository.update(reminderId, {
          title,
          description,
          dueAt: dueDate.toISOString(),
          completed,
          linkedNoteId,
        });
      } else {
        await remindersRepository.create({
          title,
          description,
          dueAt: dueDate.toISOString(),
          linkedNoteId,
        });
      }
      // The agenda (mounted behind this screen) refreshes on the change bus,
      // mirroring how SyncActivator notifies after a sync pass.
      notifyDataChanged();
      navigation.goBack();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }, [
    completed,
    description,
    dueDate,
    isEditing,
    linkedNoteId,
    navigation,
    reminderId,
    title,
  ]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.muted}>Loading reminder...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      testID="reminder-form-scroll"
    >
      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Reminder title"
        placeholderTextColor={colors.textMuted}
        testID="reminder-title-input"
      />

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={description}
        onChangeText={setDescription}
        placeholder="Optional description"
        placeholderTextColor={colors.textMuted}
        multiline
        testID="reminder-description-input"
      />

      <Text style={styles.label}>Due date</Text>
      <Pressable
        style={({ pressed }) => [styles.input, pressed && styles.pressed]}
        onPress={() => setShowDate(true)}
        testID="reminder-due-field"
      >
        <Text style={styles.dueValue} testID="reminder-due-value">
          ⏰ {dueDate.toLocaleDateString()} ·{' '}
          {dueDate.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </Pressable>
      {showDate ? (
        <DateTimePicker
          value={dueDate}
          mode="date"
          onChange={onDateChosen}
          testID="reminder-date-picker"
        />
      ) : null}
      {showTime ? (
        <DateTimePicker
          value={dueDate}
          mode="time"
          onChange={onTimeChosen}
          testID="reminder-time-picker"
        />
      ) : null}

      <Text style={styles.label}>Linked note</Text>
      <View style={styles.noteRow}>
        {linkedTitle ? (
          <View style={styles.linkedNoteChip}>
            <Text style={styles.linkedNoteChipText} numberOfLines={1}>
              🔗 {linkedTitle}
            </Text>
            <Pressable
              onPress={clearNote}
              testID="reminder-clear-note"
              hitSlop={8}
            >
              <Text style={styles.linkedNoteChipClear}>✕</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.pickNoteButton,
              pressed && styles.pressed,
            ]}
            onPress={() => setNotePickerVisible(true)}
            testID="reminder-pick-note"
          >
            <Text style={styles.pickNoteText}>Link a note…</Text>
          </Pressable>
        )}
      </View>

      {isEditing ? (
        <Pressable
          style={({ pressed }) => [styles.completedRow, pressed && styles.pressed]}
          onPress={() => setCompleted((value) => !value)}
          testID="reminder-completed-toggle"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: completed }}
        >
          <View
            style={[
              styles.checkbox,
              completed && styles.checkboxChecked,
            ]}
          >
            {completed ? <Text style={styles.checkmark}>✓</Text> : null}
          </View>
          <Text style={styles.completedLabel}>
            {completed ? 'Completed' : 'Not completed'}
          </Text>
        </Pressable>
      ) : null}

      {error ? (
        <Text style={styles.error} testID="reminder-form-error">
          {error}
        </Text>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.saveButton,
          pressed && styles.pressed,
        ]}
        onPress={() => void save()}
        testID="reminder-save"
      >
        <Text style={styles.saveButtonText}>
          {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create reminder'}
        </Text>
      </Pressable>

      <Modal
        visible={notePickerVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setNotePickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet} testID="reminder-note-picker">
            <Text style={styles.modalTitle}>Link a note</Text>
            <TextInput
              style={styles.searchInput}
              value={noteQuery}
              onChangeText={setNoteQuery}
              placeholder="Search notes…"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              testID="reminder-note-search"
            />
            <FlatList
              data={filteredNotes}
              keyExtractor={(note) => note.id}
              style={styles.noteList}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={styles.muted}>
                  {notes.length === 0
                    ? 'No notes yet — create a note first.'
                    : 'No notes match.'}
                </Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [
                    styles.noteOption,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => selectNote(item)}
                  testID={`reminder-note-option-${item.id}`}
                >
                  <Text style={styles.noteOptionTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                </Pressable>
              )}
            />
            <Pressable
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && styles.pressed,
              ]}
              onPress={() => setNotePickerVisible(false)}
              testID="reminder-note-picker-cancel"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
    gap: spacing.xs,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  muted: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  label: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: typography.body,
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  dueValue: {
    color: colors.text,
    fontSize: typography.body,
  },
  noteRow: {
    flexDirection: 'row',
  },
  linkedNoteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  linkedNoteChipText: {
    flexShrink: 1,
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '600',
  },
  linkedNoteChipClear: {
    color: colors.textMuted,
    fontSize: typography.body,
  },
  pickNoteButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignSelf: 'flex-start',
  },
  pickNoteText: {
    color: colors.textMuted,
    fontSize: typography.body,
  },
  completedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
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
  completedLabel: {
    color: colors.text,
    fontSize: typography.body,
  },
  error: {
    color: colors.danger,
    fontSize: typography.caption,
    marginTop: spacing.sm,
  },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  saveButtonText: {
    color: colors.background,
    fontSize: typography.body,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    maxHeight: '70%',
    gap: spacing.sm,
  },
  modalTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: '700',
  },
  searchInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: typography.body,
  },
  noteList: {
    flexGrow: 0,
  },
  noteOption: {
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  noteOptionTitle: {
    color: colors.text,
    fontSize: typography.body,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '600',
  },
});