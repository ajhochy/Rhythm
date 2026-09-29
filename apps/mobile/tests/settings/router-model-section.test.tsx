import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import {
  buildRouterPayload,
  isRemoteUrl,
  RouterModelSection,
  type RouterSettingsApi,
} from '@/components/settings/router-model-section';
import { Colors } from '@/constants/theme';
import { RhythmToolsService, type RouterConfig } from '@/providers/services/rhythm-tools-service';

const baseConfig = (over: Partial<RouterConfig> = {}): RouterConfig => ({
  backend: 'local',
  local: { baseUrl: 'http://127.0.0.1:8012', model: 'reranker', scoreScale: 1 },
  jev: { baseUrl: 'https://api.typesafe.ai', model: 'jev-latest', hasApiKey: true },
  custom: { baseUrl: '', model: '', scoreScale: 1, hasApiKey: false },
  timeoutMs: 1500,
  remoteDataConsent: false,
  features: { model_routing: 'default', tool_ranking: 'default', memory_ranking: 'off', capacity_routing: 'default' },
  lockedByEnv: [],
  effective: { backend: 'local', baseUrl: 'http://127.0.0.1:8012', model: 'reranker', features: {} },
  ...over,
});

function setup(config = baseConfig(), overrides: Partial<RouterSettingsApi> = {}) {
  const api: RouterSettingsApi = {
    get: jest.fn().mockResolvedValue(config),
    save: jest.fn().mockImplementation(async () => config),
    test: jest.fn().mockResolvedValue({ ok: true, backend: 'local', model: 'reranker', latencyMs: 42, ranked: [{ text: 'alpha', score: 0.91 }] }),
    ...overrides,
  };
  const screen = render(
    <PaperProvider>
      <RouterModelSection api={api} palette={Colors.light} />
    </PaperProvider>,
  );
  return { api, screen };
}

async function openDialog(screen: ReturnType<typeof setup>['screen']) {
  await waitFor(() => expect(screen.getByTestId('router-summary').props.children).toMatch(/Local on the Mac/));
  fireEvent.press(screen.getByTestId('router-configure-button'));
  await screen.findByText('Test connection');
}

describe('RouterModelSection', () => {
  test('renders summary, local helper text and opens the dialog', async () => {
    const { screen } = setup();
    await openDialog(screen);
    expect(screen.getByText(/local to your paired Mac/)).toBeTruthy();
    expect(screen.getByLabelText('Model routing: Default')).toBeTruthy();
  });

  test('backend switch shows per-backend fields', async () => {
    const { screen } = setup();
    await openDialog(screen);
    fireEvent.press(screen.getByLabelText('Custom network server'));
    expect(screen.getByPlaceholderText('http://192.168.1.20:8012')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Jev API'));
    expect(screen.getAllByText('Key saved').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Clear saved API key')).toBeTruthy();
  });

  test('consent gates Save/Test for Jev and remote custom, not LAN custom', async () => {
    const { api, screen } = setup();
    await openDialog(screen);
    fireEvent.press(screen.getByLabelText('Jev API'));
    expect(screen.getByText('Prompts, tool names and memories will be sent to this server to rank them.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('router-save-button'));
    expect(api.save).not.toHaveBeenCalled();
    fireEvent(screen.getByTestId('router-consent-switch'), 'valueChange', true);
    fireEvent.press(screen.getByTestId('router-save-button'));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));

    fireEvent.press(screen.getByTestId('router-configure-button'));
  });

  test('save payload excludes apiKey unless typed', async () => {
    const { api, screen } = setup();
    await openDialog(screen);
    fireEvent.press(screen.getByLabelText('Jev API'));
    fireEvent(screen.getByTestId('router-consent-switch'), 'valueChange', true);
    fireEvent.press(screen.getByTestId('router-save-button'));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    const first = (api.save as jest.Mock).mock.calls[0][0];
    expect(first.backend).toBe('jev');
    expect(first.remoteDataConsent).toBe(true);
    expect(first.jev).not.toHaveProperty('apiKey');
    expect(JSON.stringify(first)).not.toMatch(/apiKey/);
  });

  test('routing scope round-trips in the save payload and honours env locks', async () => {
    const { api, screen } = setup(baseConfig({ routing: { scope: 'first_prompt', escalateMinConfidence: 0.75 } }));
    await openDialog(screen);
    expect(screen.getByText(/Pick a model once per chat/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Routing scope: Escalate only'));
    expect(screen.getByText(/only move up to a stronger model/)).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('router-escalateMinConfidence'), '0.9');
    fireEvent.press(screen.getByTestId('router-save-button'));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    expect((api.save as jest.Mock).mock.calls[0][0].routing).toEqual({ scope: 'escalate_only', escalateMinConfidence: 0.9 });

    const locked = baseConfig({
      routing: { scope: 'every_prompt', escalateMinConfidence: 0.75 },
      lockedByEnv: ['routing.scope', 'routing.escalateMinConfidence'],
    });
    const form = {
      backend: 'local', localBaseUrl: '', localModel: '', localScale: '', jevModel: '', jevApiKey: '', jevClearKey: false,
      customBaseUrl: '', customModel: '', customScale: '', customApiKey: '', customClearKey: false,
      timeout: '1500', consent: false, features: locked.features, scope: 'every_prompt', escalateMinConfidence: '0.8',
    } as never;
    expect(buildRouterPayload(form, locked)).not.toHaveProperty('routing');
    expect(buildRouterPayload(form, baseConfig()).routing).toEqual({ scope: 'every_prompt', escalateMinConfidence: 0.8 });
  });

  test('typed apiKey is sent and clear sends empty string', () => {
    const cfg = baseConfig();
    const form = (over: object) => ({
      backend: 'jev', localBaseUrl: '', localModel: '', localScale: '', jevModel: 'm', jevApiKey: '', jevClearKey: false,
      customBaseUrl: '', customModel: '', customScale: '', customApiKey: '', customClearKey: false,
      timeout: '1500', consent: true, features: cfg.features, ...over,
    }) as never;
    expect(buildRouterPayload(form({ jevApiKey: 'sk-1' }), cfg).jev?.apiKey).toBe('sk-1');
    expect(buildRouterPayload(form({ jevClearKey: true }), cfg).jev?.apiKey).toBe('');
  });

  test('locked fields are read-only and omitted from payload', async () => {
    const cfg = baseConfig({ lockedByEnv: ['features.model_routing', 'local.model'] });
    const { api, screen } = setup(cfg);
    await openDialog(screen);
    expect(screen.getByLabelText('Model routing: On').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('router-save-button'));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    const sent = (api.save as jest.Mock).mock.calls[0][0];
    expect(sent.features).not.toHaveProperty('model_routing');
    expect(sent.local).not.toHaveProperty('model');
  });

  test('test connection renders latency, model and ranked sample', async () => {
    const { api, screen } = setup();
    await openDialog(screen);
    fireEvent.press(screen.getByTestId('router-test-button'));
    await screen.findByTestId('router-test-result');
    expect(api.test).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Connection OK')).toBeTruthy();
    expect(screen.getByText('reranker · 42 ms')).toBeTruthy();
    expect(screen.getByText('1. alpha (0.91)')).toBeTruthy();
  });

  test('server 400 message is rendered on save', async () => {
    const err = Object.assign(new Error('Base URL must be a loopback address.'), { status: 400, code: 'invalid_url' });
    const { screen } = setup(baseConfig(), { save: jest.fn().mockRejectedValue(err) });
    await openDialog(screen);
    await act(async () => {
      fireEvent.press(screen.getByTestId('router-save-button'));
    });
    expect((await screen.findByTestId('router-error')).props.children).toBe('Base URL must be a loopback address.');
  });

  test('permission error is translated', async () => {
    const err = Object.assign(new Error('nope'), { status: 404 });
    const { screen } = setup(baseConfig(), { test: jest.fn().mockRejectedValue(err) });
    await openDialog(screen);
    fireEvent.press(screen.getByTestId('router-test-button'));
    expect((await screen.findByTestId('router-error')).props.children).toMatch(/does not support router settings/);
  });
});

describe('isRemoteUrl', () => {
  test.each([
    ['http://192.168.1.20:8012', false],
    ['http://127.0.0.1:8012', false],
    ['http://localhost:8012', false],
    ['http://10.0.0.5', false],
    ['http://172.20.1.1', false],
    ['https://models.example.com', true],
    ['http://8.8.8.8', true],
    ['', false],
  ])('%s -> %s', (url, expected) => expect(isRemoteUrl(url)).toBe(expected));
});

describe('RhythmToolsService router config', () => {
  function make(projectId: string | null = 'proj-1') {
    const calls: { path: string; init: any }[] = [];
    const paired = { request: jest.fn(async (path: string, init: any) => { calls.push({ path, init }); return {}; }) };
    const service = new RhythmToolsService({ cloud: { request: jest.fn() } as never, paired: paired as never, projectId });
    return { calls, service };
  }

  test('paths, methods and bodies', async () => {
    const { calls, service } = make();
    await service.getRouterConfig();
    await service.saveRouterConfig({ backend: 'jev', jev: { apiKey: 'k' } });
    await service.testRouterConfig({ backend: 'local' });
    await service.testRouterConfig();
    expect(calls.map((c) => [c.init.method, c.path])).toEqual([
      ['GET', '/mobile-gateway/tools/agent-decisions/config'],
      ['PUT', '/mobile-gateway/tools/agent-decisions/config'],
      ['POST', '/mobile-gateway/tools/agent-decisions/config/test'],
      ['POST', '/mobile-gateway/tools/agent-decisions/config/test'],
    ]);
    expect(JSON.parse(calls[1].init.body)).toEqual({ backend: 'jev', jev: { apiKey: 'k' } });
    expect(JSON.parse(calls[2].init.body)).toEqual({ backend: 'local' });
    expect(JSON.parse(calls[3].init.body)).toEqual({});
    expect(calls[0].init.headers['X-Rhythm-Project-ID']).toBe('proj-1');
  });

  test('works without an active project', async () => {
    const { calls, service } = make(null);
    await service.getRouterConfig();
    expect(calls[0].init.headers?.['X-Rhythm-Project-ID']).toBeUndefined();
  });

  test('transport errors propagate', async () => {
    const paired = { request: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { status: 403 })) };
    const service = new RhythmToolsService({ cloud: {} as never, paired: paired as never, projectId: 'p' });
    await expect(service.getRouterConfig()).rejects.toMatchObject({ status: 403 });
  });
});
