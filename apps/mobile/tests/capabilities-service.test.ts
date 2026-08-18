import { discoverChatCapabilities } from '@/providers/services/capabilities-service';

describe('paired mobile capability discovery', () => {
  it('issue-1387-c6: paired hydration never calls the blocking provider auth endpoint', async () => {
    const providerAuth = jest.fn(async () => {
      throw new Error('provider.auth blocks the paired Mac engine');
    });
    const client = {
      config: {
        async get() {
          return { data: {} };
        },
      },
      provider: {
        async list() {
          return {
            data: {
              all: [],
              connected: [],
              default: {},
            },
          };
        },
        auth: providerAuth,
      },
      app: {
        async agents() {
          throw new Error('paired hydration uses the gateway profile catalog');
        },
      },
    };

    const result = await discoverChatCapabilities(
      client as never,
      '/registered/project',
      {
        includeEngineAgents: false,
        includeProviderAuth: false,
      },
    );

    expect(providerAuth).not.toHaveBeenCalled();
    expect(result.providerAuthMethodsById).toEqual({});
    expect(result.providers).toEqual([]);
    expect(result.models).toEqual([]);
  });
});
