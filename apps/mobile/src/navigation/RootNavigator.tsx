import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, Text } from 'react-native';

import { colors } from '../theme';
import { HomeScreen } from '../screens/HomeScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { CategoriesNavigator } from './CategoriesNavigator';
import { NotesNavigator } from './NotesNavigator';
import { RemindersNavigator } from './RemindersNavigator';
import { WorkspacesNavigator } from './WorkspacesNavigator';
import type { RootTabParamList } from './types';

const Tab = createBottomTabNavigator<RootTabParamList>();

const tabIcons: Record<keyof RootTabParamList, string> = {
  Home: '🏠',
  Notes: '📝',
  Categories: '🗂️',
  Workspaces: '🗄️',
  Reminders: '⏰',
  Settings: '⚙️',
};

export function RootNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        tabBarStyle: { backgroundColor: colors.surface },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11 },
        // Emoji icons must live inside a <Text>: a bare string as a direct
        // child of the native tab-bar View throws
        // "Text strings must be rendered within a <Text> component".
        tabBarIcon: () => (
          <Text style={styles.tabIcon}>{tabIcons[route.name]}</Text>
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen
        name="Notes"
        component={NotesNavigator}
        options={{ headerShown: false }}
      />
      <Tab.Screen
        name="Categories"
        component={CategoriesNavigator}
        options={{ headerShown: false }}
      />
      <Tab.Screen
        name="Workspaces"
        component={WorkspacesNavigator}
        options={{ headerShown: false }}
      />
      <Tab.Screen
        name="Reminders"
        component={RemindersNavigator}
        options={{ headerShown: false }}
      />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabIcon: {
    fontSize: 18,
  },
});
