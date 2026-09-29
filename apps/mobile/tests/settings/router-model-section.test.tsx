import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import {
  buildRouterPayload,
  isRemoteUrl,
  RouterModelSection,
  type RouterSettingsApi,
} from '@/components/settings/router-model-section';
import { Colors } from '@/constants/theme';
import { RhythmToolsService, type RouterCatalog, type RouterConfig } from '@/providers/services/rhythm-tools-service';

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

const catalogModels = (): RouterCatalog['models'] => [
  { providerID: 'openai', modelID: 'gpt-6', name: 'GPT-6', tier: 'frontier', tierSource: 'cost', costOutputUsd: 40, costInputUsd: 10, releaseDate: '2026-08-01', contextLimit: 1000000, excluded: false },
  { providerID: 'anthropic', modelID: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tier: 'standard', tierSource: 'cost', costOutputUsd: 15, costInputUsd: 3, releaseDate: '2026-05-01', contextLimit: 200000, excluded: false },
  { providerID: 'openai', modelID: 'gpt-6-mini', name: 'GPT-6 Mini', tier: 'cheap', tierSource: 'cost', costOutputUsd: 2, costInputUsd: 0.4, releaseDate: '2026-08-01', contextLimit: 400000, excluded: false },
  { providerID: 'google', modelID: 'gemini-3-flash', name: 'Gemini 3 Flash', tier: 'cheap', tierSource: 'heuristic', costOutputUsd: null, costInputUsd: null, releaseDate: '2026-06-15', contextLimit: 1048576, excluded: false },
  { providerID: 'ollama', modelID: 'qwen3', name: 'Qwen3 (local)', tier: 'standard', tierSource: 'override', costOutputUsd: 0, costInputUsd: 0, releaseDate: null, contextLimit: 32768, excluded: false },
  { providerID: 'anthropic', modelID: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', tier: 'cheap', tierSource: 'cost', costOutputUsd: 5, costInputUsd: 1, releaseDate: '2025-10-01', contextLimit: 200000, excluded: true },
];
const withCatalog = (over: Partial<RouterCatalog> = {}) =>
  baseConfig({ catalog: { fetchedAt: '2026-09-29T12:00:00Z', tiers: { mode: 'auto', cheapMaxOutputUsd: 6, frontierMinOutputUsd: 25, derivedFromModels: 12 }, models: catalogModels(), ...over } });

describe('Models the router chooses among', () => {
  test('renders grouped by tier with source hints, prices, dates and exclusion', async () => {
    const { screen } = setup(withCatalog());
    await openDialog(screen);
    expect(screen.getByText('Models the router chooses among')).toBeTruthy();
    expect(screen.getByTestId('router-catalog-mode-auto').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('router-catalog-mode-hint').props.children).toBe('Derived from 12 catalog prices');
    expect(screen.getByTestId('router-catalog-cheap-max').props.value).toBe('6');
    expect(screen.getByTestId('router-catalog-cheap-max').props.editable).toBe(false);
    expect(screen.getByTestId('router-catalog-frontier-min').props.value).toBe('25');
    expect(screen.getByText('Frontier (1)')).toBeTruthy();
    expect(screen.getByText('Standard (2)')).toBeTruthy();
    expect(screen.getByText('Cheap (3)')).toBeTruthy();
    const gpt6 = within(screen.getByTestId('router-model-row-openai/gpt-6'));
    expect(gpt6.getByText('openai · gpt-6')).toBeTruthy();
    expect(gpt6.getByText(/Out \$40\/M · In \$10\/M · 2026-08-01 · 1M context/)).toBeTruthy();
    expect(screen.getByTestId('router-model-source-openai/gpt-6').props.children).toBe('cost');
    expect(screen.getByTestId('router-model-source-google/gemini-3-flash').props.children).toBe('heuristic');
    expect(screen.getByTestId('router-model-source-ollama/qwen3').props.children).toBe('override');
    expect(screen.getByTestId('router-model-reset-ollama/qwen3')).toBeTruthy();
    expect(screen.queryByTestId('router-model-reset-openai/gpt-6')).toBeNull();
    expect(screen.getByLabelText('Exclude Claude Haiku 4.5').props.value).toBe(true);
    expect(screen.getByLabelText('Exclude GPT-6 Mini').props.value).toBe(false);
    expect(screen.getByTestId('router-model-tier-openai/gpt-6-mini-cheap').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByTestId('router-model-tier-openai/gpt-6-mini-frontier').props.accessibilityState).toMatchObject({ selected: false });
  });

  test('tier change, exclude and reset produce the right save payload, then GET is re-read', async () => {
    const config = withCatalog();
    const { api, screen } = setup(config);
    await openDialog(screen);
    fireEvent.press(screen.getByLabelText('Tier for Gemini 3 Flash: frontier'));
    expect(screen.getByTestId('router-model-source-google/gemini-3-flash').props.children).toBe('override');
    fireEvent(screen.getByLabelText('Exclude GPT-6 Mini'), 'valueChange', true);
    fireEvent.press(screen.getByTestId('router-save-button'));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    const body = (api.save as jest.Mock).mock.calls[0][0];
    expect(body.tiers).toEqual({ mode: 'auto' });
    expect(body.tierOverrides).toEqual({ 'ollama/qwen3': 'standard', 'google/gemini-3-flash': 'frontier' });
    expect(body.excludedModels).toEqual(['openai/gpt-6-mini', 'anthropic/claude-haiku-4-5']);
    await waitFor(() => expect((api.get as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  test('reset to derived drops the override from the payload', async () => {
    const { api, screen } = setup(withCatalog());
    await openDialog(screen);
    fireEvent.press(screen.getByTestId('router-model-reset-ollama/qwen3'));
    expect(screen.getByTestId('router-model-source-ollama/qwen3').props.children).toBe('cost');
    expect(screen.queryByTestId('router-model-reset-ollama/qwen3')).toBeNull();
    fireEvent.press(screen.getByTestId('router-save-button'));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    expect((api.save as jest.Mock).mock.calls[0][0].tierOverrides).toEqual({});
  });

  test('auto sends only mode; manual is prefilled, validates (positive, cheap < frontier) and re-derives only cost-tiered models', async () => {
    const { api, screen } = setup(withCatalog());
    await openDialog(screen);
    // Auto: numbers are never sent.
    fireEvent.press(screen.getByTestId('router-save-button'));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect((api.save as jest.Mock).mock.calls[0][0].tiers).toEqual({ mode: 'auto' });
    (api.save as jest.Mock).mockClear();
    fireEvent.press(screen.getByTestId('router-configure-button'));
    await screen.findByText('Test connection');
    fireEvent.press(screen.getByTestId('router-catalog-mode-manual'));
    expect(screen.getByTestId('router-catalog-cheap-max').props.value).toBe('6');
    expect(screen.getByTestId('router-catalog-cheap-max').props.editable).toBe(true);
    fireEvent.changeText(screen.getByTestId('router-catalog-cheap-max'), '20');
    expect(within(screen.getByTestId('router-catalog-group-cheap')).getByText('Claude Sonnet 4.6')).toBeTruthy();
    expect(within(screen.getByTestId('router-catalog-group-standard')).getByText('Qwen3 (local)')).toBeTruthy();
    expect(within(screen.getByTestId('router-catalog-group-cheap')).getByText('Gemini 3 Flash')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('router-catalog-cheap-max'), '30');
    expect(screen.getByTestId('router-catalog-threshold-error').props.children).toMatch(/lower than/);
    fireEvent.press(screen.getByTestId('router-save-button'));
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByTestId('router-catalog-cheap-max'), '0');
    expect(screen.getByTestId('router-catalog-threshold-error').props.children).toMatch(/greater than 0/);
    fireEvent.changeText(screen.getByTestId('router-catalog-cheap-max'), '');
    fireEvent.press(screen.getByTestId('router-save-button'));
    expect(api.save).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('router-catalog-cheap-max'), '20');
    fireEvent.changeText(screen.getByTestId('router-catalog-frontier-min'), '50');
    expect(screen.queryByTestId('router-catalog-threshold-error')).toBeNull();
    fireEvent.press(screen.getByTestId('router-save-button'));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect((api.save as jest.Mock).mock.calls[0][0].tiers).toEqual({ mode: 'manual', cheapMaxOutputUsd: 20, frontierMinOutputUsd: 50 });
  });

  test.each([
    ['missing catalog', baseConfig(), false],
    ['empty models', withCatalog({ models: [] }), true],
  ])('%s shows the static fallback state and sends no overrides', async (_name, config, hasThresholds) => {
    const { api, screen } = setup(config);
    await openDialog(screen);
    expect(screen.getByTestId('router-catalog-empty').props.children).toBe(
      'Catalog unavailable — the engine is not running; the router will use the static fallback table',
    );
    expect(Boolean(screen.queryByTestId('router-catalog-cheap-max'))).toBe(hasThresholds);
    fireEvent.press(screen.getByTestId('router-save-button'));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    const body = (api.save as jest.Mock).mock.calls[0][0];
    expect(body).not.toHaveProperty('tierOverrides');
    expect(body).not.toHaveProperty('excludedModels');
  });
});
