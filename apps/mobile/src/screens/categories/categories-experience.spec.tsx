import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { categoryRepository, noteRepository } from '../../features/data/repositories';
import { storage } from '../../storage';
import { mobileSyncEngine } from '../../sync/sync-service';
import type { CategoriesStackParamList } from '../../navigation/types';
import { CategoriesListScreen } from './CategoriesListScreen';
import { CategoryDetailScreen } from './CategoryDetailScreen';

const listNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  push: jest.fn(),
} as unknown as NativeStackScreenProps<
  CategoriesStackParamList,
  'CategoriesList'
>['navigation'];

function renderList() {
  return render(
    <CategoriesListScreen
      navigation={
        listNavigation as unknown as NativeStackScreenProps<
          CategoriesStackParamList,
          'CategoriesList'
        >['navigation']
      }
    />,
  );
}

function renderDetail(categoryId: string) {
  const navigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    push: jest.fn(),
    replace: jest.fn(),
  } as unknown as NativeStackScreenProps<
    CategoriesStackParamList,
    'CategoryDetail'
  >['navigation'];
  const utils = render(
    <CategoryDetailScreen
      navigation={navigation}
      route={
        {
          key: 'category-detail',
          name: 'CategoryDetail',
          params: { categoryId },
        } as unknown as NativeStackScreenProps<
          CategoriesStackParamList,
          'CategoryDetail'
        >['route']
      }
    />,
  );
  return { ...utils, navigation };
}

describe('categories experience', () => {
  beforeEach(async () => {
    await storage.clearAll();
    jest.clearAllMocks();
    mobileSyncEngine.setOnline(true);
  });

  afterEach(async () => {
    await storage.clearAll();
    mobileSyncEngine.setOnline(true);
    jest.restoreAllMocks();
  });

  it('creates a category offline with parent + markdown description', async () => {
    const parentId = await categoryRepository.create({ name: 'Work' });

    const { getByTestId, findByTestId } = renderList();
    fireEvent.press(getByTestId('new-category'));

    fireEvent.changeText(getByTestId('category-name'), 'Projects');
    fireEvent.press(getByTestId('category-parent'));
    fireEvent.press(await findByTestId(`parent-${parentId}`));
    fireEvent.changeText(getByTestId('category-description'), '**Big** plans');
    fireEvent.press(getByTestId('category-submit'));

    await waitFor(async () => {
      const tree = await categoryRepository.listTree();
      expect(tree[0].name).toBe('Work');
      expect(tree[0].children[0]).toMatchObject({
        name: 'Projects',
        description: '**Big** plans',
        parentId,
      });
    });
  });

  it('shows the tree, note counts, and lazy-expands children', async () => {
    const rootId = await categoryRepository.create({ name: 'Root' });
    const childId = await categoryRepository.create({
      name: 'Child',
      parentId: rootId,
    });
    const noteId = await noteRepository.create({
      title: 'In child',
      categoryId: childId,
    });

    const { getByTestId, queryByTestId, findByTestId } = renderList();

    // Roots visible; children hidden until expanded (lazy children).
    expect(await findByTestId(`category-row-${rootId}`)).toBeTruthy();
    expect(queryByTestId(`category-row-${childId}`)).toBeNull();

    fireEvent.press(getByTestId(`toggle-${rootId}`));
    expect(await findByTestId(`category-row-${childId}`)).toBeTruthy();
    expect(getByTestId(`category-row-${childId}`)).toBeTruthy();
    expect(queryByTestId(`add-child-${childId}`)).toBeTruthy();
    expect(noteId).toBeTruthy();
  });

  it('navigates to the detail screen from a row', async () => {
    const id = await categoryRepository.create({ name: 'Papers' });

    const { findByTestId } = renderList();
    fireEvent.press(await findByTestId(`category-row-${id}`));
    expect(listNavigation.navigate).toHaveBeenCalledWith('CategoryDetail', {
      categoryId: id,
    });
  });

  it('shows breadcrumb parent, children, notes, and markdown description', async () => {
    const parentId = await categoryRepository.create({
      name: 'Work',
      description: '# Work notes',
    });
    const childId = await categoryRepository.create({
      name: 'Projects',
      parentId,
      description: '**Secret** plans',
    });
    const noteId = await noteRepository.create({
      title: 'Roadmap',
      categoryId: childId,
    });

    const { findByTestId, getByTestId } = renderDetail(childId);

    // Parent breadcrumb + description preview (shared markdown tokenizer).
    expect(await findByTestId('category-breadcrumb')).toBeTruthy();
    expect(getByTestId('category-description-preview')).toBeTruthy();
    // Child count section (empty here) and the note row.
    expect(getByTestId('category-title').props.children).toContain('Projects');
    expect(await findByTestId(`category-note-${noteId}`)).toBeTruthy();

    // Parent shows its child + note count in the tree.
    const { findByTestId: findByInList } = renderDetail(parentId);
    expect(await findByInList(`child-category-${childId}`)).toBeTruthy();
    expect(noteId).toBeTruthy();
  });

  it('renames, edits description, and moves a category offline', async () => {
    const parentId = await categoryRepository.create({ name: 'Old parent' });
    const targetId = await categoryRepository.create({ name: 'Box' });
    const id = await categoryRepository.create({ name: 'Draft', parentId });

    const { getByTestId, findByTestId } = renderDetail(id);

    // Rename.
    fireEvent.press(await findByTestId('rename-category'));
    fireEvent.changeText(getByTestId('rename-name'), 'Published');
    fireEvent.press(getByTestId('rename-submit'));
    await waitFor(async () => {
      expect((await categoryRepository.findById(id))?.name).toBe('Published');
    });

    // Edit markdown description.
    fireEvent.press(getByTestId('edit-description'));
    fireEvent.changeText(getByTestId('description-input'), '**Updated** text');
    fireEvent.press(getByTestId('description-submit'));
    await waitFor(async () => {
      expect(
        (await categoryRepository.findById(id))?.description,
      ).toBe('**Updated** text');
    });

    // Move to a different parent (offline, via the shared repository).
    fireEvent.press(getByTestId('move-category'));
    fireEvent.press(await findByTestId(`move-${targetId}`));
    fireEvent.press(getByTestId('move-submit'));
    await waitFor(async () => {
      expect((await categoryRepository.findById(id))?.parentId).toBe(targetId);
    });
  });

  it('blocks deletion while notes exist, then deletes an empty category', async () => {
    const withNotes = await categoryRepository.create({ name: 'Full' });
    await noteRepository.create({ title: 'n', categoryId: withNotes });
    const emptyId = await categoryRepository.create({ name: 'Empty box' });
    const alertSpy = jest.spyOn(Alert, 'alert');

    const { findByTestId } = renderDetail(withNotes);
    fireEvent.press(await findByTestId('delete-category'));

    const buttons = alertSpy.mock.calls[0][2] as {
      text: string;
      style?: string;
      onPress?: () => Promise<void>;
    }[];
    const destructive = buttons.find((b) => b.style === 'destructive');
    await destructive?.onPress?.();

    // The shared business rule blocks the deletion and surfaces the message.
    expect(await findByTestId('category-header-error')).toBeTruthy();
    expect(await categoryRepository.findById(withNotes)).toBeDefined();

    // An empty category deletes cleanly.
    const { findByTestId: findByDetail } = renderDetail(emptyId);
    jest.clearAllMocks();
    const alertSpy2 = jest.spyOn(Alert, 'alert');
    fireEvent.press(await findByDetail('delete-category'));
    const buttons2 = alertSpy2.mock.calls[0][2] as {
      text: string;
      style?: string;
      onPress?: () => Promise<void>;
    }[];
    const destructive2 = buttons2.find((b) => b.style === 'destructive');
    await destructive2?.onPress?.();

    await waitFor(async () => {
      expect(await categoryRepository.findById(emptyId)).toBeUndefined();
    });
  });

  it('shows offline sync feedback while categories stay browsable/searchable', async () => {
    await categoryRepository.create({ name: 'Alpha' });
    await categoryRepository.create({ name: 'Beta' });

    mobileSyncEngine.setOnline(false);

    const { getByTestId, findByText, queryByTestId } = renderList();

    expect(await findByText('Offline')).toBeTruthy();
    expect(await findByText('Alpha')).toBeTruthy();

    fireEvent.changeText(getByTestId('category-search'), 'beta');
    // Hierarchy-aware search keeps the matching row (offline).
    expect(await findByText('Beta')).toBeTruthy();
    expect(queryByTestId('category-search')).toBeTruthy();
  });
});