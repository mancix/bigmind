import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { NotesListScreen } from '../screens/notes/NotesListScreen';
import { NoteDetailScreen } from '../screens/notes/NoteDetailScreen';
import { colors } from '../theme';
import type { NotesStackParamList } from './types';

const Stack = createNativeStackNavigator<NotesStackParamList>();

/** Notes tab: list ⇄ detail pushed with native transitions. */
export function NotesNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="NotesList"
        component={NotesListScreen}
        options={{ title: 'Notes' }}
      />
      <Stack.Screen
        name="NoteDetail"
        component={NoteDetailScreen}
        options={{ title: 'Note' }}
      />
    </Stack.Navigator>
  );
}
