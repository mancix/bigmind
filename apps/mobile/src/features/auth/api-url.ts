import { Platform } from 'react-native';

/**
 * API base URL for the mobile app.
 *
 * Expo inlines `EXPO_PUBLIC_*` environment variables at bundle time. Set
 * `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` (or the shell environment) to
 * point at a real deployment.
 *
 * Defaults target the local NestJS API:
 * - Android emulator reaches the host machine through `10.0.2.2`.
 * - iOS simulator / web can use `localhost` directly.
 */
export function getApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  const fallback =
    Platform.OS === 'android'
      ? 'http://10.0.2.2:3000'
      : 'http://localhost:3000';
  return fallback;
}
