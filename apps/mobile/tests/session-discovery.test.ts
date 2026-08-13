import { listSessionsAcrossProjects } from '@/providers/services/session-service';

describe('issue #1285 owner-scoped session discovery', () => {
  it('issue-1285-c8: projectless owner chats remain interactive with separate routing context', async () => {
    const discoveryCalls: {
      parameters: Record<string, unknown>;
      options: { headers?: Record<string, string> };
    }[] = [];
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

    expect(sessions.map(({ id, projectId, routingProjectId }) => ({
      id,
      projectId,
      routingProjectId,
    }))).toEqual([
      {
        id: 'ses-home-1',
        projectId: '/registered/project',
        routingProjectId: undefined,
      },
      {
        id: 'ses-home-2',
        projectId: null,
        routingProjectId: '/registered/project',
      },
    ]);
    expect(discoveryCalls).toHaveLength(3);
    expect(discoveryCalls.every(({ options }) =>
      options.headers?.['x-rhythm-session-discovery'] === 'owner-unscoped'))
      .toBe(true);
    expect(sessions.filter(({ id }) => id === 'ses-home-1')).toHaveLength(1);
  });

  it('issue-1285-c11: first ten chats publish before delayed catalog pages', async () => {
    let releaseSecondPage!: () => void;
    const secondPage = new Promise<void>((resolve) => {
      releaseSecondPage = resolve;
    });
    const published: string[][] = [];
    const discoveryCalls: Record<string, unknown>[] = [];
    const client = {
      session: {
        async list() {
          return { data: [] };
        },
        async status() {
          return { data: {} };
        },
      },
      experimental: {
        session: {
          async list(parameters: Record<string, unknown>) {
            discoveryCalls.push(parameters);
            if (parameters.archived === false && parameters.cursor === undefined) {
              return {
                data: Array.from({ length: 10 }, (_, index) => ({
                  id: `ses-initial-${index}`,
                  projectId: null,
                })),
                response: { headers: new Headers({ 'x-next-cursor': '10' }) },
              };
            }
            if (parameters.archived === false && parameters.cursor === 10) {
              await secondPage;
              return { data: [{ id: 'ses-later', projectId: null }] };
            }
            return { data: [] };
          },
        },
      },
    };
    const progressiveList = listSessionsAcrossProjects as unknown as (
      buildClient: () => never,
      projects: string[],
      options: { onProgress(items: { id: string }[]): void },
    ) => Promise<{ id: string }[]>;

    const loading = progressiveList(
      () => client as never,
      ['/registered/project'],
      { onProgress: (items) => published.push(items.map(({ id }) => id)) },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      expect(discoveryCalls[0]).toMatchObject({ limit: 10 });
      expect(published[0]).toHaveLength(10);
      expect(published[0][0]).toBe('ses-initial-0');
    } finally {
      releaseSecondPage();
      await loading;
    }
    expect(published.at(-1)).toContain('ses-later');
  });

  it('issue-1387-c4: paired discovery uses every owner page without project engine fan-out', async () => {
    let buildCalls = 0;
    const client = {
      session: {
        async list() {
          throw new Error('paired discovery must not initialize project engines');
        },
        async status() {
          throw new Error('paired discovery must not query project statuses');
        },
      },
      experimental: {
        session: {
          async list(parameters: Record<string, unknown>) {
            if (parameters.archived === false && parameters.cursor === undefined) {
              return {
                data: [{ id: 'ses-recent', projectId: '/project/one' }],
                response: {
                  headers: new Headers({ 'x-next-cursor': '10' }),
                },
              };
            }
            if (parameters.archived === false && parameters.cursor === 10) {
              return { data: [{ id: 'ses-older', projectId: '/project/two' }] };
            }
            return { data: [] };
          },
        },
      },
    };

    const sessions = await listSessionsAcrossProjects(
      () => {
        buildCalls += 1;
        return client as never;
      },
      ['/project/one', '/project/two'],
      { skipProjectScopedSweep: true },
    );

    expect(buildCalls).toBe(1);
    expect(sessions.map(({ id }) => id)).toEqual(['ses-recent', 'ses-older']);
  });

});
