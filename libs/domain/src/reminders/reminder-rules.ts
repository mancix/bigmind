export const REMINDER_TITLE_MAX_LENGTH = 200;

export function validateReminderTitle(title: string): void {
  const trimmed = title.trim();
  if (!trimmed) throw new Error('Reminder title cannot be empty');
  if (trimmed.length > REMINDER_TITLE_MAX_LENGTH) throw new Error(`Title must be at most ${REMINDER_TITLE_MAX_LENGTH} characters`);
}
