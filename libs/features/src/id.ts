/**
 * Shared entity id generation.
 *
 * Uses the platform `crypto.randomUUID()` when available (web, modern
 * runtimes) and falls back to a UUID-v4 shaped id on runtimes that do not
 * expose it (Hermes/React Native). The fallback keeps the server-side
 * `z.string().uuid()` contract happy.
 */
export function generateId(): string {
  const context = globalThis as {
    crypto?: { randomUUID?: () => string };
  };
  if (typeof context.crypto?.randomUUID === 'function') {
    return context.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
