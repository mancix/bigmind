import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { type CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  mobileOutbox,
  noteRepository,
  remindersRepository,
} from '../../features/data/repositories';
import { storage } from '../../storage';
import { mobileSyncEngine } from '../../sync/sync-service';
import type {
  RemindersStackParamList,
  RootTabParamList,
} from '../../navigation/types';
import { RemindersListScreen } from './RemindersListScreen';
import { ReminderDetailScreen } from './ReminderDetailScreen';
import { ReminderFormScreen } from './ReminderFormScreen';

type ListScreenProps = CompositeScreenProps<
  NativeStackScreenProps<RemindersStackParamList, 'RemindersList'>,
  BottomTabScreenProps<RootTabParamList>
>;

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  push: jest.fn(),
} as unknown as ListScreenProps['navigation'];

function renderList() {
  return render(
    <RemindersListScreen
      navigation={
        navigation as unknown as ListScreenProps['navigation']
      }
    />,
  );
}

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

describe('reminders experience', () => {
  beforeEach(async () => {
    await storage.clearAll();
    jest.clearAllMocks();
    mobileSyncEngine.setOnline(true);
    (globalThis as Record<string, unknown>).__datetimepickerNextValue = null;
  });

  afterEach(async () => {
    await storage.clearAll();
    mobileSyncEngine.setOnline(true);
    jest.restoreAllMocks();
    (globalThis as Record<string, unknown>).__datetimepickerNextValue = null;
  });

  it('lists reminders grouped into the agenda sections (Today / Tomorrow / Upcoming / Completed)', async () => {
    const today = await remindersRepository.create({
      title: 'Today task',
      dueAt: hoursFromNow(2),
    });
    const tomorrow = await remindersRepository.create({
      title: 'Tomorrow task',
      dueAt: hoursFromNow(26),
    });
    const upcoming = await remindersRepository.create({
      title: 'Next week',
      dueAt: hoursFromNow(24 * 7),
    });
    const done = await remindersRepository.create({
      title: 'Done task',
      dueAt: hoursFromNow(-2),
    });
    await remindersRepository.toggle(done);

    const { findByText, getAllByTestId } = renderList();

    expect(await findByText('Today')).toBeTruthy();
    expect(await findByText('Tomorrow')).toBeTruthy();
    expect(await findByText('Upcoming')).toBeTruthy();
    expect(await findByText('Completed')).toBeTruthy();

    // Rows render in agenda section order: Today → Tomorrow → Upcoming →
    // Completed (each section sorted by dueAt ascending).
    await waitFor(() => {
      const rows = getAllByTestId(/^reminder-row-/);
      expect(rows.map((row) => row.props.testID)).toEqual([
        `reminder-row-${today}`,
        `reminder-row-${tomorrow}`,
        `reminder-row-${upcoming}`,
        `reminder-row-${done}`,
      ]);
    });
  });

  it('creates a reminder offline through the shared repository (outbox op queued)', async () => {
    const { getByTestId, findByTestId } = render(
      <ReminderFormScreen
        navigation={
          navigation as unknown as NativeStackScreenProps<
            RemindersStackParamList,
            'ReminderForm'
          >['navigation']
        }
        route={
          {
            key: 'reminder-form',
            name: 'ReminderForm',
            params: undefined,
          } as unknown as NativeStackScreenProps<
            RemindersStackParamList,
            'ReminderForm'
          >['route']
        }
      />,
    );

    fireEvent.changeText(await findByTestId('reminder-title-input'), 'Submit report');

    // Pick the due date through the (mocked) native date+time dialogs.
    const pickAt = new Date(2030, 0, 15, 9, 30);
    (globalThis as Record<string, unknown>).__datetimepickerNextValue = pickAt;
    fireEvent.press(getByTestId('reminder-due-field'));
    fireEvent.press(getByTestId('reminder-date-picker'));
    fireEvent.press(getByTestId('reminder-time-picker'));

    fireEvent.press(getByTestId('reminder-save'));

    await waitFor(async () => {
      const list = await remindersRepository.list();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        title: 'Submit report',
        completed: false,
      });
      expect(list[0].dueAt).toBe(pickAt.toISOString());
    });

    const created = (await remindersRepository.list())[0];
    const operations = await mobileOutbox.listForEntity(created.id, 'reminder');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      entityType: 'reminder',
      operation: 'create',
      status: 'pending',
    });
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('rejects an empty title using the shared domain rule', async () => {
    const { getByTestId, findByTestId } = render(
      <ReminderFormScreen
        navigation={
          navigation as unknown as NativeStackScreenProps<
            RemindersStackParamList,
            'ReminderForm'
          >['navigation']
        }
        route={
          {
            key: 'reminder-form',
            name: 'ReminderForm',
            params: undefined,
          } as unknown as NativeStackScreenProps<
            RemindersStackParamList,
            'ReminderForm'
          >['route']
        }
      />,
    );
    await findByTestId('reminder-title-input');
    fireEvent.press(getByTestId('reminder-save'));

    expect(await findByTestId('reminder-form-error')).toBeTruthy();
    expect(await remindersRepository.list()).toHaveLength(0);
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('edits title, description, due date, completion status, and linked note', async () => {
    const noteId = await noteRepository.create({ title: 'Linked note' });
    const reminderId = await remindersRepository.create({
      title: 'Before',
      description: 'old',
      dueAt: hoursFromNow(3),
    });

    const { getByTestId, findByTestId } = render(
      <ReminderFormScreen
        navigation={
          navigation as unknown as NativeStackScreenProps<
            RemindersStackParamList,
            'ReminderForm'
          >['navigation']
        }
        route={
          {
            key: 'reminder-form',
            name: 'ReminderForm',
            params: { reminderId },
          } as unknown as NativeStackScreenProps<
            RemindersStackParamList,
            'ReminderForm'
          >['route']
        }
      />,
    );

    const titleInput = await findByTestId('reminder-title-input');
    expect(titleInput.props.value).toBe('Before');

    fireEvent.changeText(titleInput, 'After');
    fireEvent.changeText(getByTestId('reminder-description-input'), 'new desc');

    // Link the note through the picker modal.
    fireEvent.press(getByTestId('reminder-pick-note'));
    fireEvent.press(getByTestId(`reminder-note-option-${noteId}`));

    // Mark completed.
    fireEvent.press(getByTestId('reminder-completed-toggle'));

    fireEvent.press(getByTestId('reminder-save'));

    await waitFor(async () => {
      const stored = await remindersRepository.findById(reminderId);
      expect(stored).toMatchObject({
        title: 'After',
        description: 'new desc',
        completed: true,
        linkedNoteId: noteId,
      });
    });

    const operations = await mobileOutbox.listForEntity(reminderId, 'reminder');
    // The edit coalesces into the still-pending create operation (shared
    // repository behavior): the payload carries every edited field.
    expect(operations[0].payload).toMatchObject({
      title: 'After',
      description: 'new desc',
      completed: true,
      linkedNoteId: noteId,
    });
    expect(operations).toHaveLength(1);
  });

  it('toggles completion from the agenda row and moves it to Completed', async () => {
    const id = await remindersRepository.create({
      title: 'Toggle me',
      dueAt: hoursFromNow(2),
    });

    const { getByTestId, findByText } = renderList();
    expect(await findByText('Toggle me')).toBeTruthy();

    fireEvent.press(getByTestId(`reminder-toggle-${id}`));

    // The agenda re-reads immediately: the checkbox reflects the completed
    // state without waiting for a sync pass.
    await waitFor(() => {
      expect(
        getByTestId(`reminder-toggle-${id}`).props.accessibilityState,
      ).toMatchObject({ checked: true });
    });

    await waitFor(async () => {
      const stored = await remindersRepository.findById(id);
      expect(stored?.completed).toBe(true);
    });

    // The toggle coalesces into the pending outbox operation (still a 'create'
    // right after creation) and carries the new completion flag.
    const operations = await mobileOutbox.listForEntity(id, 'reminder');
    expect(operations).toHaveLength(1);
    expect(operations[0].payload).toMatchObject({ completed: true });

    // Mark it incomplete again from the Completed section.
    fireEvent.press(getByTestId(`reminder-toggle-${id}`));
    await waitFor(() => {
      expect(
        getByTestId(`reminder-toggle-${id}`).props.accessibilityState,
      ).toMatchObject({ checked: false });
    });
    await waitFor(async () => {
      const stored = await remindersRepository.findById(id);
      expect(stored?.completed).toBe(false);
    });
  });

  it('deletes a reminder from the detail screen after confirmation', async () => {
    const reminderId = await remindersRepository.create({
      title: 'Disposable',
      dueAt: hoursFromNow(1),
    });
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { getByTestId, findByTestId } = render(
      <ReminderDetailScreen
        navigation={
          navigation as unknown as NativeStackScreenProps<
            RemindersStackParamList,
            'ReminderDetail'
          >['navigation']
        }
        route={
          {
            key: 'reminder-detail',
            name: 'ReminderDetail',
            params: { reminderId },
          } as unknown as NativeStackScreenProps<
            RemindersStackParamList,
            'ReminderDetail'
          >['route']
        }
      />,
    );
    await findByTestId('reminder-detail-title');

    fireEvent.press(getByTestId('reminder-detail-delete'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete reminder?',
      expect.any(String),
      expect.any(Array),
    );
    const buttons = alertSpy.mock.calls[0][2] as {
      text: string;
      style?: string;
      onPress?: () => Promise<void>;
    }[];
    const destructive = buttons.find((button) => button.style === 'destructive');
    expect(destructive?.text).toBe('Delete');

    await destructive?.onPress?.();

    await waitFor(async () => {
      expect(await remindersRepository.findById(reminderId)).toBeUndefined();
    });
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('searches reminders by title and description offline', async () => {
    const rust = await remindersRepository.create({
      title: 'Review PR',
      dueAt: hoursFromNow(2),
    });
    const recipes = await remindersRepository.create({
      title: 'Grocery run',
      description: 'buy milk and eggs',
      dueAt: hoursFromNow(24 * 7),
    });

    const { getByTestId, queryByTestId, findByTestId } = renderList();
    await findByTestId(`reminder-row-${rust}`);

    // Title match.
    fireEvent.changeText(getByTestId('reminder-search'), 'review');
    await waitFor(() => {
      expect(queryByTestId(`reminder-row-${recipes}`)).toBeNull();
    });
    expect(queryByTestId(`reminder-row-${rust}`)).toBeTruthy();

    // Description match.
    fireEvent.changeText(getByTestId('reminder-search'), 'eggs');
    await waitFor(() => {
      expect(queryByTestId(`reminder-row-${rust}`)).toBeNull();
    });
    expect(queryByTestId(`reminder-row-${recipes}`)).toBeTruthy();

    // Miss → everything filtered out.
    fireEvent.changeText(getByTestId('reminder-search'), 'zzz-no-match');
    await waitFor(() => {
      expect(queryByTestId(`reminder-row-${recipes}`)).toBeNull();
    });
    expect(await getByTestId('reminders-empty'));
  });

  it('shows the linked note on the row and navigates to the note detail', async () => {
    const noteId = await noteRepository.create({ title: 'Linked note' });
    const reminderId = await remindersRepository.create({
      title: 'Look at note',
      dueAt: hoursFromNow(2),
      linkedNoteId: noteId,
    });

    const { getByTestId, findByText } = renderList();
    expect(await findByText('🔗 Linked note')).toBeTruthy();

    fireEvent.press(getByTestId(`reminder-linked-${reminderId}`));
    expect(navigation.navigate).toHaveBeenCalledWith('Notes', {
      screen: 'NoteDetail',
      params: { noteId },
    });
  });

  it('opens the detail screen and navigates to the linked note from there', async () => {
    const noteId = await noteRepository.create({ title: 'Detail note' });
    const reminderId = await remindersRepository.create({
      title: 'With note',
      description: 'Some context',
      dueAt: hoursFromNow(1),
      linkedNoteId: noteId,
    });

    const { getByTestId, findByText } = render(
      <ReminderDetailScreen
        navigation={
          navigation as unknown as NativeStackScreenProps<
            RemindersStackParamList,
            'ReminderDetail'
          >['navigation']
        }
        route={
          {
            key: 'reminder-detail',
            name: 'ReminderDetail',
            params: { reminderId },
          } as unknown as NativeStackScreenProps<
            RemindersStackParamList,
            'ReminderDetail'
          >['route']
        }
      />,
    );

    expect(await findByText('With note')).toBeTruthy();
    expect(await findByText('Some context')).toBeTruthy();
    expect(await findByText('Pending')).toBeTruthy();

    fireEvent.press(getByTestId('reminder-detail-linked-note'));
    expect(navigation.navigate).toHaveBeenCalledWith('Notes', {
      screen: 'NoteDetail',
      params: { noteId },
    });
  });

  it('keeps reminders available and locally editable while offline', async () => {
    const id = await remindersRepository.create({
      title: 'Offline reminder',
      dueAt: hoursFromNow(2),
    });

    // Take the app offline at the shared sync level.
    mobileSyncEngine.setOnline(false);

    const { getByTestId, findByTestId, findByText } = renderList();

    // Offline banner + the pill show sync state…
    expect(await findByTestId('reminders-offline-banner')).toBeTruthy();
    expect(await findByText('Offline')).toBeTruthy();
    // …while local reminders remain visible.
    expect(await findByText('Offline reminder')).toBeTruthy();

    // Completion still writes locally (outbox queued), exactly like the web.
    fireEvent.press(getByTestId(`reminder-toggle-${id}`));
    await waitFor(async () => {
      const stored = await remindersRepository.findById(id);
      expect(stored?.completed).toBe(true);
    });
    const operations = await mobileOutbox.listForEntity(id, 'reminder');
    expect(operations[0].payload).toMatchObject({ completed: true });
  });

  it('supports create, edit, complete, and delete fully offline (web-parity outbox)', async () => {
    mobileSyncEngine.setOnline(false);

    // Create offline → pending create operation.
    const id = await remindersRepository.create({
      title: 'Offline first',
      dueAt: hoursFromNow(2),
    });
    expect(await mobileOutbox.listForEntity(id, 'reminder')).toHaveLength(1);

    // Edit offline → coalesces into the pending create payload.
    await remindersRepository.update(id, {
      title: 'Offline edited',
      description: 'written on the bus',
    });
    let operations = await mobileOutbox.listForEntity(id, 'reminder');
    expect(operations).toHaveLength(1);
    expect(operations[0].payload).toMatchObject({
      title: 'Offline edited',
      description: 'written on the bus',
    });

    // Complete offline → payload carries the flag.
    await remindersRepository.toggle(id);
    operations = await mobileOutbox.listForEntity(id, 'reminder');
    expect(operations[0].payload).toMatchObject({ completed: true });

    // Delete offline while the create is still pending → the record and its
    // operations are coalesced away (web behavior: nothing to push).
    await remindersRepository.remove(id);
    expect(await remindersRepository.findById(id)).toBeUndefined();
    expect(await mobileOutbox.listForEntity(id, 'reminder')).toHaveLength(0);
  });
});