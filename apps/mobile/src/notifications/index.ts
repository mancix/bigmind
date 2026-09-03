/**
 * Offline local notifications (`expo-notifications`).
 *
 * See docs/mobile-notifications.md for the architecture: platform scheduler
 * abstraction, reminder → notification policy, repository integration, and
 * sync-pull reconciliation.
 */
export * from './notification-scheduler';
export * from './reminder-notification-service';