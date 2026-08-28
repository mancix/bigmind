export const NOTIFICATION_TITLE_MAX_LENGTH = 200;
export const NOTIFICATION_BODY_MAX_LENGTH = 1000;

export function validateNotificationTitle(title: string): void {
  const trimmed = title.trim();
  if (!trimmed) throw new Error('Notification title cannot be empty');
  if (trimmed.length > NOTIFICATION_TITLE_MAX_LENGTH) {
    throw new Error(`Title must be at most ${NOTIFICATION_TITLE_MAX_LENGTH} characters`);
  }
}
