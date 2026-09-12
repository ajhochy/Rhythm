export interface WorkspaceMember {
  userId: number;
  name: string;
  email: string;
  photoUrl: string | null;
  role: 'admin' | 'staff';
}

export function createLiveWorkspaceMembersGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch) {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit workspace token is required');
  return {
    async list(): Promise<WorkspaceMember[]> {
      const result = await fetcher(`${apiBase}/workspaces/me/members`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      if (!result.ok) throw new Error(result.status === 403 ? 'Workspace members are unavailable for this account.' : 'Workspace members could not be loaded.');
      return result.json();
    },
  };
}
