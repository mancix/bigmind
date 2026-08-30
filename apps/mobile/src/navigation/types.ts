import type { NavigatorScreenParams } from '@react-navigation/native';

/**
 * Root navigation structure of the mobile app.
 *
 * React Navigation bottom tabs, Android-first. Notes and Categories tabs
 * host their own native stacks (list ⇄ detail); Home, Reminders, and
 * Settings are single screens.
 */
export type RootTabParamList = {
  Home: undefined;
  Notes: NavigatorScreenParams<NotesStackParamList> | undefined;
  Categories: NavigatorScreenParams<CategoriesStackParamList> | undefined;
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

/** Stack shown while signed out: login ⇄ register. */
export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<RootTabParamList> | undefined;
};
