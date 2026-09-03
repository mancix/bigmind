// The storage provider defaults to the SQLite engine in production. In tests
// the shared `MemoryStorageAdapter` is the default implementation (fast,
// deterministic, no native module); `babel-preset-expo` inlines this value at
// transform time, and it is set before any test module loads.
process.env.EXPO_PUBLIC_STORAGE_ENGINE = 'memory';

// expo-sqlite is a native module: the memory engine never calls it, but the
// storage provider imports the driver factory, so the import must resolve.
// The mock throws if a test somehow opts into the SQLite engine, surfacing
// the misconfiguration instead of silently passing.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    throw new Error(
      'expo-sqlite is unavailable in tests; EXPO_PUBLIC_STORAGE_ENGINE must stay "memory" (SqliteStorageAdapter is covered by libs/storage via the node:sqlite driver).',
    );
  },
}));

export {};

jest.mock('expo/src/winter/ImportMetaRegistry', () => ({
  ImportMetaRegistry: {
    get url() {
      return null;
    },
  },
}));

// AsyncStorage must be mocked in unit tests (still used for non-token data
// like the selected workspace id).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Expo SecureStore is a native module: use an in-memory table in tests.
// Specs can seed/read it through `globalThis.__secureStoreTable`.
const mockSecureStoreTable: Record<string, string> = {};
(globalThis as Record<string, unknown>).__secureStoreTable =
  mockSecureStoreTable;

jest.mock('expo-secure-store', () => ({
  getItem: (key: string) => mockSecureStoreTable[key] ?? null,
  setItem: (key: string, value: string) => {
    mockSecureStoreTable[key] = value;
  },
  deleteItemAsync: async (key: string) => {
    delete mockSecureStoreTable[key];
  },
  getItemAsync: async (key: string) => mockSecureStoreTable[key] ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockSecureStoreTable[key] = value;
  },
}));

// NetInfo is used by the mobile sync connectivity adapter (no native module
// in the test environment).
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn().mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  }),
}));

// DateTimePicker is a native module (bundled in Expo Go SDK 55). In tests it
// renders a pressable stub that emits `onChange` with a `Date` — either the
// current `value` prop or, when a test needs a specific date, the value set on
// `globalThis.__datetimepickerNextValue` before opening the dialog (keys on the
// picker's `testID`).
(globalThis as Record<string, unknown>).__datetimepickerNextValue = null;

// expo-notifications is a native module (no OS scheduler in the test
// environment). The mock keeps an in-memory registry so `schedule`/`cancel`/
// `listScheduled` behave like the real API. Unit tests that need deterministic
// assertions inject the `MemoryNotificationScheduler` directly instead.
jest.mock('expo-notifications', () => {
  const registry = new Map();
  return {
    SchedulableTriggerInputTypes: { DATE: 'date' },
    AndroidImportance: { HIGH: 4, DEFAULT: 3 },
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
    getPermissionsAsync: jest
      .fn()
      .mockResolvedValue({ status: 'granted', granted: true, canAskAgain: false }),
    requestPermissionsAsync: jest
      .fn()
      .mockResolvedValue({ status: 'granted', granted: true }),
    scheduleNotificationAsync: jest.fn().mockImplementation(async (request) => {
      const { identifier, content, trigger } = request;
      const id = identifier ?? `id-${registry.size}`;
      registry.set(id, { content, trigger });
      return id;
    }),
    cancelScheduledNotificationAsync: jest.fn().mockImplementation(async (id) => {
      registry.delete(id);
    }),
    cancelAllScheduledNotificationsAsync: jest.fn().mockImplementation(async () => {
      registry.clear();
    }),
    getAllScheduledNotificationsAsync: jest.fn().mockImplementation(async () =>
      [...registry.entries()].map(([identifier, { content, trigger }]) => ({
        identifier,
        content,
        trigger,
      })),
    ),
    getDevicePushTokenAsync: jest.fn(),
    getExpoPushTokenAsync: jest.fn(),
  };
});

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  const stub = ({
    value,
    mode,
    onChange,
    testID,
  }: {
    value: Date;
    mode: 'date' | 'time' | 'datetime';
    onChange?: (event: { type: string }, date?: Date) => void;
    testID?: string;
  }) => {
    const next =
      (globalThis as Record<string, unknown>).__datetimepickerNextValue ?? value;
    return React.createElement(
      Pressable,
      {
        testID: testID ?? `datetimepicker-${mode}`,
        onPress: () => onChange?.({ type: 'set' }, next as Date),
      },
      React.createElement(Text, null, `DateTimePicker:${mode}`),
    );
  };
  return {
    __esModule: true,
    default: stub,
    DateTimePickerAndroid: { open: jest.fn() },
  };
});

// React Navigation uses native screens; in tests they render as plain views.
jest.mock('react-native-screens', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    ...jest.requireActual('react-native-screens'),
    enableScreens: jest.fn(),
    enableFreeze: jest.fn(),
    Screen: ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(View, props, children),
    ScreenContainer: ({ children }: React.PropsWithChildren) =>
      React.createElement(View, null, children),
    ScreenStack: ({ children }: React.PropsWithChildren) =>
      React.createElement(View, null, children),
  };
});

// Safe area insets are a no-op in unit tests.
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const insets = { top: 47, left: 0, right: 0, bottom: 34 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    SafeAreaProvider: ({ children }: React.PropsWithChildren) =>
      React.createElement(View, null, children),
    SafeAreaView: ({
      children,
      ...props
    }: React.PropsWithChildren & Record<string, unknown>) =>
      React.createElement(View, props, children),
    SafeAreaProviderCompat: ({ children }: React.PropsWithChildren) =>
      React.createElement(View, null, children),
    SafeAreaInsetsContext: React.createContext(insets),
    SafeAreaFrameContext: React.createContext(frame),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { frame, insets },
  };
});

if (typeof global.structuredClone === 'undefined') {
  global.structuredClone = (object) => JSON.parse(JSON.stringify(object));
}
