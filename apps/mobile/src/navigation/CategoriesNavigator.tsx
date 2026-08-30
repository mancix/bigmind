import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CategoriesListScreen } from '../screens/categories/CategoriesListScreen';
import { CategoryDetailScreen } from '../screens/categories/CategoryDetailScreen';
import { colors } from '../theme';
import type { CategoriesStackParamList } from './types';

const Stack = createNativeStackNavigator<CategoriesStackParamList>();

/** Categories tab: tree ⇄ detail pushed with native transitions. */
export function CategoriesNavigator() {
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
        name="CategoriesList"
        component={CategoriesListScreen}
        options={{ title: 'Categories' }}
      />
      <Stack.Screen
        name="CategoryDetail"
        component={CategoryDetailScreen}
        options={{ title: 'Category' }}
      />
    </Stack.Navigator>
  );
}
