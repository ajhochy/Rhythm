import { listSessionsAcrossProjects } from '@/providers/services/session-service';

describe('issue #1285 owner-scoped session discovery', () => {
  it('requests every owner-unscoped page and keeps those chats read-only', async () => {
    const discoveryCalls: Array<{
      parameters: Record<string, unknown>;
      options: { headers?: Record<string, string> };
    }> = [];
    const client = {
      session: {
        async list() {
          return {
            data: [{ id: 'ses-home-1', title: 'Project list duplicate' }],
          };
        },
        async status() {
          return { data: {} };
        },
      },
      experimental: {
        session: {
          async list(
            parameters: Record<string, unknown>,
            options: { headers?: Record<string, string> } = {},
          ) {
            if (!options.headers?.['x-rhythm-session-discovery']) {
              return { data: [] };
            }
            discoveryCalls.push({ parameters, options });
            const archived = parameters.archived === true;
            const cursor = parameters.cursor;
            if (!archived && cursor === undefined) {
              return {
                data: [{ id: 'ses-home-1', title: 'Desktop chat 1' }],
                response: {
                  headers: new Headers({ 'x-next-cursor': '100' }),
                },
              };
            }
            if (!archived && cursor === 100) {
              return {
                data: [{ id: 'ses-home-2', title: 'Desktop chat 2' }],
              };
            }
            return { data: [] };
          },
        },
      },
    };

    const sessions = await listSessionsAcrossProjects(
      () => client as never,
      ['/registered/project'],
    );

    expect(sessions.map(({ id, projectId, interaction }) => ({
      id,
      projectId,
      interaction,
    }))).toEqual([
      {
        id: 'ses-home-1',
        projectId: null,
        interaction: 'read-only',
      },
      {
        id: 'ses-home-2',
        projectId: null,
        interaction: 'read-only',
      },
    ]);
    expect(discoveryCalls).toHaveLength(3);
    expect(discoveryCalls.every(({ options }) =>
      options.headers?.['x-rhythm-session-discovery'] === 'owner-unscoped'))
      .toBe(true);
    expect(sessions.filter(({ id }) => id === 'ses-home-1')).toHaveLength(1);
  });
});
