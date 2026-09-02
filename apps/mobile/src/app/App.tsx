import { NavigationContainer, DefaultTheme, type LinkingOptions } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider, useAuth } from '../features/auth/auth-provider';
import { WorkspaceProvider } from '../features/workspaces/workspace-context';
import { AuthNavigator } from '../navigation/AuthNavigator';
import { RootNavigator } from '../navigation/RootNavigator';
import type { RootStackParamList } from '../navigation/types';
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
 * Deep linking — note URLs can open the app on the right screen, e.g.
 * `bigmind://notes/<noteId>`. State is preserved by React Navigation.
 */
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['bigmind://'],
  config: {
    screens: {
      Tabs: {
        screens: {
          Home: 'home',
          Notes: {
            screens: {
              NotesList: 'notes',
              NoteDetail: 'notes/:noteId',
            },
          },
          Categories: {
            screens: {
              CategoriesList: 'categories',
              CategoryDetail: 'categories/:categoryId',
            },
          },
          Reminders: {
            screens: {
              RemindersList: 'reminders',
              ReminderDetail: 'reminders/:reminderId',
              ReminderForm: 'reminders/new',
            },
          },
          Settings: 'settings',
        },
      },
    },
  },
};

/**
 * BigMind mobile bootstrap.
 *
 * Providers are ordered intentionally:
 * 1. SafeAreaProvider   — react-navigation + safe-area support
 * 2. AuthProvider       — shared @bigmind/auth state machine (SecureStore tokens)
 * 3. WorkspaceProvider  — workspace list/switch/create (offline-cached)
 * 4. NavigationContainer — switches between the auth stack and the main tabs
 *                          based on the shared auth state
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <WorkspaceProvider>
          <SyncActivator />
          <RootGate />
          {/* eslint-disable-next-line react/style-prop-object */}
          <StatusBar style="auto" />
        </WorkspaceProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RootGate() {
  const { isAuthenticated } = useAuth();

  return (
    <NavigationContainer theme={navigationTheme} linking={linking}>
      {isAuthenticated ? <RootNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}
