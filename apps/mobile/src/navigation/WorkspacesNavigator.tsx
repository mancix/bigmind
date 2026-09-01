import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CreateWorkspaceScreen } from '../screens/workspaces/CreateWorkspaceScreen';
import { InviteUserScreen } from '../screens/workspaces/InviteUserScreen';
import { WorkspaceMembersScreen } from '../screens/workspaces/WorkspaceMembersScreen';
import { WorkspacesListScreen } from '../screens/workspaces/WorkspacesListScreen';
import { colors } from '../theme';
import type { WorkspacesStackParamList } from './types';

const Stack = createNativeStackNavigator<WorkspacesStackParamList>();

/**
 * Workspaces tab: the mobile counterpart of the web sidebar workspace
 * switcher + workspace settings (members, invitations, permissions).
 */
export function WorkspacesNavigator() {
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
        name="WorkspacesList"
        component={WorkspacesListScreen}
        options={{ title: 'Workspaces' }}
      />
      <Stack.Screen
        name="CreateWorkspace"
        component={CreateWorkspaceScreen}
        options={{ title: 'Create Workspace' }}
      />
      <Stack.Screen
        name="WorkspaceMembers"
        component={WorkspaceMembersScreen}
        options={{ title: 'Members' }}
      />
      <Stack.Screen
        name="InviteUser"
        component={InviteUserScreen}
        options={{ title: 'Invitations' }}
      />
    </Stack.Navigator>
  );
}