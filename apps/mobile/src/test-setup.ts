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
