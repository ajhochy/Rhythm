import type { GatewayMode } from '.';

export interface UserPreferencesGateway {
  readonly mode: GatewayMode;
  updateArtifactTabIds(ids: string[]): Promise<{ artifactTabIds: string[] }>;
}

// artifactTabIds is the ONLY persisted tab preference — never invent a client-side storage key.
// Mounted at /users in apps/api_server/src/app.ts; PATCH /me/preferences declared at
// apps/api_server/src/routes/users_routes.ts:10 and validated (<=50 unique UUID strings) at
// apps/api_server/src/controllers/users_controller.ts:91-98.
export function createLiveUserPreferencesGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): UserPreferencesGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit user-preferences token is required');
  return {
    mode: 'live',
    updateArtifactTabIds: async (ids) => {
      const result = await fetcher(`${apiBase}/users/me/preferences`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifactTabIds: ids }),
      });
      if (!result.ok) throw new Error(`Failed to persist artifact tabs (${result.status})`);
      return result.json();
    },
  };
}
