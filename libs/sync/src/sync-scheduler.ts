/**
 * Platform-neutral sync scheduler.
 *
 * Owns the debounce + periodic timing that both platforms use to decide when
 * to run the {@link SyncEngine}: a short debounce after local changes, an
 * immediate run for connectivity/foreground/auth events, and a periodic
 * heartbeat. Platform adapters (web timers+visibility, mobile AppState+NetInfo)
 * only have to forward their events into `request()` / `start()` / `stop()`.
 */

export interface SyncSchedulerTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface SyncSchedulerOptions {
  /** Runs one synchronization pass (typically `() => void engine.sync()`). */
  run: () => void;
  isOnline: () => boolean;
  isAuthRequired: () => boolean;
  /** Debounce for local-change driven requests. Defaults to 1000ms. */
  changeDelayMs?: number;
  /** Periodic sync interval. Defaults to 30000ms. */
  periodicMs?: number;
  /** Injectable timers (tests). Defaults to the global timers. */
  timer?: SyncSchedulerTimers;
}

export interface SyncScheduler {
  /** Debounced sync request, gated on online + auth state. */
  request(delayMs?: number): void;
  /** Start the periodic heartbeat. */
  start(): void;
  /** Cancel pending work and the heartbeat. */
  stop(): void;
}

export function createSyncScheduler(
  options: SyncSchedulerOptions,
): SyncScheduler {
  const changeDelayMs = options.changeDelayMs ?? 1_000;
  const periodicMs = options.periodicMs ?? 30_000;
  const timer = options.timer ?? {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (handle) =>
      clearInterval(handle as ReturnType<typeof setInterval>),
  };

  let scheduled: unknown = undefined;
  let periodic: unknown = undefined;

  const canSync = (): boolean =>
    options.isOnline() && !options.isAuthRequired();

  return {
    request(delayMs = changeDelayMs) {
      if (!canSync()) {
        return;
      }
      if (scheduled !== undefined) {
        timer.clearTimeout(scheduled);
      }
      scheduled = timer.setTimeout(() => {
        scheduled = undefined;
        options.run();
      }, delayMs);
    },

    start() {
      if (periodic === undefined) {
        periodic = timer.setInterval(() => {
          this.request(0);
        }, periodicMs);
      }
    },

    stop() {
      if (scheduled !== undefined) {
        timer.clearTimeout(scheduled);
        scheduled = undefined;
      }
      if (periodic !== undefined) {
        timer.clearInterval(periodic);
        periodic = undefined;
      }
    },
  };
}
