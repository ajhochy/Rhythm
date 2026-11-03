import { mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getDecisionBaseUrl,
  getDecisionFeatureMode,
  getDecisionModel,
  getDecisionScoreScale,
  getDecisionTimeoutMs,
  getEffectiveDecisionMode,
} from '../../config/env';
import {
  decisionLockedByEnv,
  defaultDecisionSettings,
  loadDecisionSettings,
  resetDecisionSettingsCacheForTests,
  saveDecisionSettings,
} from './decision_settings';
import { buildConfigView, updateConfig } from './decision_config_service';

const ENV = [
  'RHYTHM_DECISION_ROUTER_FILE', 'AGENT_DECISION_BASE_URL', 'AGENT_DECISION_MODEL',
  'AGENT_DECISION_TIMEOUT_MS', 'AGENT_DECISION_SCORE_SCALE', 'AGENT_DECISION_MODEL_ROUTING',
  'AGENT_DECISION_TOOL_RANKING', 'AGENT_DECISION_MEMORY_RANKING', 'AGENT_DECISION_CAPACITY_ROUTING',
];
let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'decision-settings-'));
  file = join(dir, 'decision-router.json');
  for (const k of ENV) delete process.env[k];
  process.env.RHYTHM_DECISION_ROUTER_FILE = file;
  resetDecisionSettingsCacheForTests();
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
  resetDecisionSettingsCacheForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe('decision settings store', () => {
  it('returns defaults when there is no file', () => {
    expect(loadDecisionSettings()).toEqual(defaultDecisionSettings());
    expect(getDecisionBaseUrl()).toBe('http://127.0.0.1:8012');
    expect(getDecisionModel()).toBe('qwen3-reranker-4b');
    expect(getDecisionTimeoutMs()).toBe(400);
    expect(getDecisionScoreScale()).toBe('auto');
    expect(getDecisionFeatureMode('model_routing')).toBe('off');
    expect(getEffectiveDecisionMode('model_routing', { sessionAuto: true })).toBe('shadow');
  });

  it('saves atomically with mode 0600 and reloads on change', () => {
    const s = defaultDecisionSettings();
    s.custom.apiKey = 'sk-secret';
    saveDecisionSettings(s);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(loadDecisionSettings().custom.apiKey).toBe('sk-secret');
    s.custom.apiKey = 'sk-other';
    saveDecisionSettings(s);
    expect(loadDecisionSettings().custom.apiKey).toBe('sk-other');
  });

  it('falls back to defaults on a corrupt file', () => {
    writeFileSync(file, '{not json');
    expect(loadDecisionSettings()).toEqual(defaultDecisionSettings());
  });

  it('GET view redacts keys', () => {
    updateConfig({
      remoteDataConsent: true,
      jev: { apiKey: 'jev-key' },
      custom: { baseUrl: 'http://192.168.1.20:8012', apiKey: 'custom-key' },
    });
    const view = buildConfigView();
    expect(view.jev.hasApiKey).toBe(true);
    expect(view.custom.hasApiKey).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/jev-key|custom-key/);
    updateConfig({ jev: { apiKey: '' } });
    expect(buildConfigView().jev.hasApiKey).toBe(false);
  });

  it('applies saved backend values through the env getters', () => {
    updateConfig({
      backend: 'custom',
      remoteDataConsent: true,
      custom: { baseUrl: 'http://192.168.1.20:8012', model: 'my-reranker', scoreScale: 'logit' },
      features: { model_routing: 'shadow', tool_ranking: 'on' },
    });
    expect(getDecisionBaseUrl()).toBe('http://192.168.1.20:8012');
    expect(getDecisionModel()).toBe('my-reranker');
    expect(getDecisionScoreScale()).toBe('logit');
    expect(getDecisionTimeoutMs()).toBe(1500);
    expect(getDecisionFeatureMode('model_routing')).toBe('shadow');
    expect(getEffectiveDecisionMode('tool_ranking')).toBe('on');
    expect(getEffectiveDecisionMode('memory_ranking', { sessionAuto: true })).toBe('shadow');
    updateConfig({ timeoutMs: 900 });
    expect(getDecisionTimeoutMs()).toBe(900);
  });

  it('explicit env beats the saved file and is reported as locked', () => {
    updateConfig({
      backend: 'custom',
      remoteDataConsent: true,
      custom: { baseUrl: 'http://192.168.1.20:8012', model: 'saved-model' },
      timeoutMs: 900,
      features: { model_routing: 'on' },
    });
    process.env.AGENT_DECISION_BASE_URL = 'http://127.0.0.1:9999';
    process.env.AGENT_DECISION_MODEL = 'env-model';
    process.env.AGENT_DECISION_TIMEOUT_MS = '250';
    process.env.AGENT_DECISION_SCORE_SCALE = 'probability';
    process.env.AGENT_DECISION_MODEL_ROUTING = 'off';
    expect(getDecisionBaseUrl()).toBe('http://127.0.0.1:9999');
    expect(getDecisionModel()).toBe('env-model');
    expect(getDecisionTimeoutMs()).toBe(250);
    expect(getDecisionScoreScale()).toBe('probability');
    expect(getDecisionFeatureMode('model_routing')).toBe('off');
    expect(getEffectiveDecisionMode('model_routing', { sessionAuto: true })).toBe('off');
    expect(decisionLockedByEnv().sort()).toEqual(
      ['baseUrl', 'features.model_routing', 'model', 'scoreScale', 'timeoutMs'].sort(),
    );
    const view = buildConfigView();
    expect(view.effective.baseUrl).toBe('http://127.0.0.1:9999');
    expect(view.effective.features.model_routing).toBe('off');
    expect(view.custom.model).toBe('saved-model');
  });
});
