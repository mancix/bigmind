import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { subscribeToBackgroundSyncRequests } from '@bigmind/sync';

import { AuthProvider } from '../auth/auth-provider';
import { authStore } from '../auth/auth-store';
import { storage } from '../../storage';
import {
  WorkspaceProvider,
  useWorkspaces,
  type WorkspaceContextValue,
} from './workspace-context';
import {
  cacheWorkspaces,
  clearCachedWorkspaces,
  clearStoredWorkspaceId,
  setStoredWorkspaceId,
} from './workspace-store';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function ws(id: string, name: string, role: 'OWNER' | 'EDITOR' | 'VIEWER') {
  return { id, name, description: null, role };
}

const WS_A = ws('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice Personal Workspace', 'OWNER');
const WS_B = ws('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Acme Corp', 'EDITOR');
const WS_C = ws('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Brand New', 'OWNER');

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function jsonResponse(status: number, body: unknown): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/** Routes the auth-refresh and workspaces endpoints used by the providers. */
function mockApi(routes: {
  list?: unknown;
  create?: unknown;
  failNetwork?: boolean;
}) {
  const { list, create, failNetwork } = routes;
  globalThis.fetch = jest.fn(async (url: string, options?: RequestInit) => {
    if (failNetwork) {
      throw new TypeError('Network request failed');
    }
    if (String(url).includes('/auth/refresh')) {
      return jsonResponse(200, {
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        user: { id: USER_ID, email: 'a@b.com' },
      });
    }
    const method = options?.method ?? 'GET';
    if (String(url).endsWith('/workspaces') && method === 'POST') {
      return jsonResponse(201, create);
    }
    if (String(url).endsWith('/workspaces')) {
      return jsonResponse(200, list);
    }
    return jsonResponse(404, { message: 'not found' });
  });
}

function WorkspaceProbe({
  api,
}: {
  api: { current: WorkspaceContextValue | null };
}) {
  const ctx = useWorkspaces();
  api.current = ctx;
  const current = ctx.currentWorkspace
    ? `${ctx.currentWorkspace.id}:${ctx.currentWorkspace.name}`
    : 'none';
  return (
    <Text testID="ws-probe">{`${ctx.workspaces.length}|${current}|${String(ctx.isLoading)}`}</Text>
  );
}

function renderWithWorkspaces() {
  const api: { current: WorkspaceContextValue | null } = { current: null };
  const utils = render(
    <AuthProvider>
      <WorkspaceProvider>
        <WorkspaceProbe api={api} />
      </WorkspaceProvider>
    </AuthProvider>,
  );
  return { ...utils, api };
}

describe('mobile workspace context', () => {
  let backgroundSyncCalls = 0;
  let unsubscribeBackground: () => void;

  beforeEach(async () => {
    backgroundSyncCalls = 0;
    unsubscribeBackground = subscribeToBackgroundSyncRequests(() => {
      backgroundSyncCalls += 1;
    });
    await clearStoredWorkspaceId();
    await clearCachedWorkspaces();
    await storage.clearAll();
    authStore.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    unsubscribeBackground();
    jest.restoreAllMocks();
  });

  it('loads the workspace list and selects the first when none is stored', async () => {
    authStore.setTokens('access-1', 'refresh-1', {
      id: USER_ID,
      email: 'a@b.com',
    });
    mockApi({ list: [WS_A, WS_B] });

    const { getByTestId } = renderWithWorkspaces();

    await waitFor(() =>
      expect(getByTestId('ws-probe').props.children).toBe(
        `2|${WS_A.id}:${WS_A.name}|false`,
      ),
    );
    expect(backgroundSyncCalls).toBe(0);
  });

  it('keeps a stored workspace selected after loading', async () => {
    await setStoredWorkspaceId(WS_B.id);
    authStore.setTokens('access-1', 'refresh-1', {
      id: USER_ID,
      email: 'a@b.com',
    });
    mockApi({ list: [WS_A, WS_B] });

    const { getByTestId } = renderWithWorkspaces();

    await waitFor(() =>
      expect(getByTestId('ws-probe').props.children).toBe(
        `2|${WS_B.id}:${WS_B.name}|false`,
      ),
    );
  });

  it('switches the active workspace: clears local data and requests a sync', async () => {
    await setStoredWorkspaceId(WS_A.id);
    authStore.setTokens('access-1', 'refresh-1', {
      id: USER_ID,
      email: 'a@b.com',
    });
    mockApi({ list: [WS_A, WS_B] });
    const clearSpy = jest.spyOn(storage, 'clearAll');

    const { getByTestId, api } = renderWithWorkspaces();
    await waitFor(() =>
      expect(getByTestId('ws-probe').props.children).toContain(WS_A.id),
    );

    await api.current?.switchWorkspace(WS_B.id);

    expect(clearSpy).toHaveBeenCalled();
    expect(backgroundSyncCalls).toBeGreaterThan(0);
    await waitFor(() =>
      expect(getByTestId('ws-probe').props.children).toBe(
        `2|${WS_B.id}:${WS_B.name}|false`,
      ),
    );
  });

  it('creates a workspace and switches to it automatically', async () => {
    authStore.setTokens('access-1', 'refresh-1', {
      id: USER_ID,
      email: 'a@b.com',
    });
    mockApi({ list: [WS_A], create: WS_C });
    const clearSpy = jest.spyOn(storage, 'clearAll');

    const { getByTestId, api } = renderWithWorkspaces();
    await waitFor(() =>
      expect(getByTestId('ws-probe').props.children).toContain(WS_A.id),
    );

    const created = await api.current?.addWorkspace(WS_C.name, null);

    expect(created.id).toBe(WS_C.id);
    expect(clearSpy).toHaveBeenCalled();
    expect(backgroundSyncCalls).toBeGreaterThan(0);
    await waitFor(() =>
      expect(getByTestId('ws-probe').props.children).toBe(
        `2|${WS_C.id}:${WS_C.name}|false`,
      ),
    );
  });

  it('keeps the workspace list and current workspace usable offline', async () => {
    // A previous online session cached the list and selected WS_B.
    await cacheWorkspaces([WS_A, WS_B]);
    await setStoredWorkspaceId(WS_B.id);
    authStore.setTokens('access-1', 'refresh-1', {
      id: USER_ID,
      email: 'a@b.com',
    });
    // Completely offline: the auth refresh fails (→ offline_authenticated)
    // and the workspace fetch fails too.
    mockApi({ failNetwork: true });

    const { getByTestId } = renderWithWorkspaces();

    // The cached list is shown and the stored workspace stays current, so
    // the user can keep working offline until sync resumes.
    await waitFor(() =>
      expect(getByTestId('ws-probe').props.children).toBe(
        `2|${WS_B.id}:${WS_B.name}|false`,
      ),
    );
    expect(authStore.getState()).toBe('offline_authenticated');
  });
});