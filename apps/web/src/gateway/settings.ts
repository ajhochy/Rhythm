import type { WorkspaceMember } from './workspace-members';

export interface WorkspaceSettings { id: number; name: string; role: 'admin' | 'staff'; joinCode?: string }

export function createLiveSettingsGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch) {
  if (!token?.trim()) throw new Error('Live configuration error: a settings token is required');
  const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const result = await fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
    if (!result.ok) throw new Error(result.status === 403 ? 'This setting requires a workspace administrator.' : `Setting request failed (${result.status})`);
    return result.status === 204 ? undefined as T : result.json();
  };
  return {
    workspace: () => request<WorkspaceSettings>('/workspaces/me'), members: () => request<WorkspaceMember[]>('/workspaces/me/members'),
    regenerateJoinCode: () => request<{ joinCode: string }>('/workspaces/me/join-code/regenerate', { method: 'POST' }),
    updateRole: (userId: number, role: 'admin' | 'staff') => request<void>(`/workspaces/me/members/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
    removeMember: (userId: number) => request<void>(`/workspaces/me/members/${userId}`, { method: 'DELETE' }),
    updateUser: (userId: number, input: { isFacilitiesManager?: boolean }) => request<unknown>(`/users/${userId}`, { method: 'PATCH', body: JSON.stringify(input) }),
    updatePreferences: (input: { emailNotificationsEnabled?: boolean }) => request<unknown>('/users/me/preferences', { method: 'PATCH', body: JSON.stringify(input) }),
  };
}
