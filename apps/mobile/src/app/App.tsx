import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider, useAuth } from '../features/auth/auth-provider';
import { AuthNavigator } from '../navigation/AuthNavigator';
import { RootNavigator } from '../navigation/RootNavigator';
import { SyncActivator } from './SyncActivator';
import { colors } from '../theme';

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.primary,
  },
};

/**
 * BigMind mobile bootstrap.
 *
 * Providers are ordered intentionally:
 * 1. SafeAreaProvider   — react-navigation + safe-area support
 * 2. AuthProvider       — shared @bigmind/auth state machine (SecureStore tokens)
 * 3. NavigationContainer — switches between the auth stack and the main tabs
 *                          based on the shared auth state
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SyncActivator />
        <RootGate />
        {/* eslint-disable-next-line react/style-prop-object */}
        <StatusBar style="auto" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RootGate() {
  const { isAuthenticated } = useAuth();

  return (
    <NavigationContainer theme={navigationTheme}>
      {isAuthenticated ? <RootNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
