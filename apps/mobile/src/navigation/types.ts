import type { NavigatorScreenParams } from '@react-navigation/native';

/**
 * Root navigation structure of the mobile app.
 *
 * React Navigation bottom tabs, Android-first. Notes, Categories, and
 * Workspaces tabs host their own native stacks; Home, Reminders, and
 * Settings are single screens.
 */
export type RootTabParamList = {
  Home: undefined;
  Notes: NavigatorScreenParams<NotesStackParamList> | undefined;
  Categories: NavigatorScreenParams<CategoriesStackParamList> | undefined;
  Workspaces: NavigatorScreenParams<WorkspacesStackParamList> | undefined;
  Reminders: undefined;
  Settings: undefined;
};

/** Notes tab stack: list ⇄ detail. */
export type NotesStackParamList = {
  NotesList: undefined;
  NoteDetail: { noteId: string };
};

/** Categories tab stack: tree ⇄ detail. */
export type CategoriesStackParamList = {
  CategoriesList: undefined;
  CategoryDetail: { categoryId: string };
};

/**
 * Workspaces tab stack: list, create, members, and invitations. Implements
 * the same workspace experience as the web sidebar switcher + settings.
 */
export type WorkspacesStackParamList = {
  WorkspacesList: undefined;
  CreateWorkspace: undefined;
  WorkspaceMembers: { workspaceId: string; workspaceName: string };
  InviteUser: { workspaceId: string; workspaceName: string };
};

/** Stack shown while signed out: login ⇄ register. */
export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<RootTabParamList> | undefined;
};
