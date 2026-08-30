/* eslint-disable import/first */

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';

const mockFetch = vi.hoisted(() => vi.fn<() => Promise<any>>());
const mockCreateWorkspace = vi.hoisted(() =>
  vi.fn<(_data: any) => Promise<any>>(),
);
const mockGetStored = vi.hoisted(() => vi.fn<() => string | null>());
const mockSetStored = vi.hoisted(() => vi.fn<(_id: string) => void>());
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock('./workspace-client', () => ({
  fetchUserWorkspaces: mockFetch,
  createWorkspace: mockCreateWorkspace,
  getCurrentWorkspaceId: mockGetStored,
  setCurrentWorkspaceId: mockSetStored,
}));

vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({ authState: 'authenticated' }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

import { storage } from '../../storage';
import { WorkspaceProvider } from './workspace-context';
import { WorkspaceSwitcher } from './workspace-switcher';

function TestWrapper({ children }: { children: React.ReactNode }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}

beforeEach(async () => {
  mockFetch.mockResolvedValue([
    { id: 'ws-1', name: 'Personal', description: null, role: 'OWNER' },
    { id: 'ws-2', name: 'Team', description: 'Team notes', role: 'EDITOR' },
  ]);
  mockGetStored.mockReturnValue('ws-1');
  localStorage.clear();
  await storage.delete();
  await storage.open();
});

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  await storage.delete();
});

describe('WorkspaceSwitcher', () => {
  it('renders the current workspace name', async () => {
    render(
      <TestWrapper>
        <WorkspaceSwitcher />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Personal Workspace')).toBeDefined();
    });
  });

  it('opens a dropdown listing all workspaces', async () => {
    render(
      <TestWrapper>
        <WorkspaceSwitcher />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Personal Workspace')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Personal Workspace'));

    await waitFor(() => {
      expect(screen.getByText('Team Workspace')).toBeDefined();
    });
  });

  it('shows role badges for each workspace', async () => {
    render(
      <TestWrapper>
        <WorkspaceSwitcher />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Personal Workspace')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Personal Workspace'));

    await waitFor(() => {
      expect(screen.getByText('OWNER')).toBeDefined();
      expect(screen.getByText('EDITOR')).toBeDefined();
    });
  });

  it('switches workspace on click', async () => {
    render(
      <TestWrapper>
        <WorkspaceSwitcher />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Personal Workspace')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Personal Workspace'));
    await waitFor(() => {
      expect(screen.getByText('Team Workspace')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Team Workspace'));

    await waitFor(() => {
      expect(mockSetStored).toHaveBeenCalledWith('ws-2');
    });
  });

  it('opens create workspace modal, submits form, and selects the new workspace', async () => {
    mockCreateWorkspace.mockResolvedValue({
      id: 'ws-new',
      name: 'Project Alpha',
      description: 'Alpha workspace description',
      role: 'OWNER',
    });

    render(
      <TestWrapper>
        <WorkspaceSwitcher />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText('Personal Workspace')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Personal Workspace'));

    await waitFor(() => {
      expect(screen.getByText('Create Workspace')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Create Workspace'));

    await waitFor(() => {
      expect(screen.getByLabelText(/Workspace Name/i)).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText(/Workspace Name/i), {
      target: { value: 'Project Alpha' },
    });
    fireEvent.change(screen.getByLabelText(/Description/i), {
      target: { value: 'Alpha workspace description' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create Workspace' }));

    await waitFor(() => {
      expect(mockCreateWorkspace).toHaveBeenCalledWith({
        name: 'Project Alpha',
        description: 'Alpha workspace description',
      });
      expect(mockSetStored).toHaveBeenCalledWith('ws-new');
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/',
        search: { category: undefined },
      });
    });
  });
});
