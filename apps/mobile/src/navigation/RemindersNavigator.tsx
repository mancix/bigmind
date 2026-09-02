import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ReminderDetailScreen } from '../screens/reminders/ReminderDetailScreen';
import { ReminderFormScreen } from '../screens/reminders/ReminderFormScreen';
import { RemindersListScreen } from '../screens/reminders/RemindersListScreen';
import { colors } from '../theme';
import type { RemindersStackParamList } from './types';

const Stack = createNativeStackNavigator<RemindersStackParamList>();

/**
 * Reminders tab: agenda (list) ⇄ detail ⇄ create/edit form, pushed with
 * native transitions. Mirrors the web Agenda page: same shared
 * `RemindersRepository`, same grouping rules.
 */
export function RemindersNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerBackTitle: 'Back',
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="RemindersList"
        component={RemindersListScreen}
        options={{ title: 'Reminders' }}
      />
      <Stack.Screen
        name="ReminderDetail"
        component={ReminderDetailScreen}
        options={{ title: 'Reminder' }}
      />
      <Stack.Screen
        name="ReminderForm"
        component={ReminderFormScreen}
        options={({ route }) => ({
          title: route.params?.reminderId ? 'Edit Reminder' : 'New Reminder',
        })}
      />
    </Stack.Navigator>
  );
}