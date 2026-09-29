import { afterEach, describe, expect, it } from 'vitest';

import {
  getDecisionBaseUrl,
  getDecisionFeatureMode,
  getDecisionMemoryMinScore,
  getDecisionModel,
  getDecisionRoutingMinConfidence,
  getDecisionTimeoutMs,
  getDecisionToolEagerServers,
  getDecisionToolMinScore,
  getEffectiveDecisionMode,
} from '../../config/env';

const KEYS = [
  'AGENT_DECISION_BASE_URL', 'AGENT_DECISION_MODEL', 'AGENT_DECISION_TIMEOUT_MS',
  'AGENT_DECISION_MODEL_ROUTING', 'AGENT_DECISION_TOOL_RANKING', 'AGENT_DECISION_MEMORY_RANKING',
  'AGENT_DECISION_ROUTING_MIN_CONFIDENCE', 'AGENT_DECISION_TOOL_EAGER_SERVERS',
  'AGENT_DECISION_TOOL_MIN_SCORE', 'AGENT_DECISION_MEMORY_MIN_SCORE',
  'AGENT_DECISION_CAPACITY_ROUTING',
];
afterEach(() => { for (const k of KEYS) delete process.env[k]; });

describe('decision env getters', () => {
  it('has safe defaults', () => {
    expect(getDecisionBaseUrl()).toBe('http://127.0.0.1:8012');
    expect(getDecisionModel()).toBe('qwen3-reranker-4b');
    expect(getDecisionTimeoutMs()).toBe(400);
    expect(getDecisionFeatureMode('model_routing')).toBe('off');
    expect(getDecisionRoutingMinConfidence()).toBe(0.55);
    expect(getDecisionToolEagerServers()).toBe(4);
    expect(getDecisionToolMinScore()).toBe(0.3);
    expect(getDecisionMemoryMinScore()).toBe(0.5);
  });

  it('reads valid overrides live', () => {
    process.env.AGENT_DECISION_BASE_URL = 'http://127.0.0.1:9';
    process.env.AGENT_DECISION_MODEL = 'm';
    process.env.AGENT_DECISION_TIMEOUT_MS = '750';
    process.env.AGENT_DECISION_TOOL_RANKING = ' SHADOW ';
    process.env.AGENT_DECISION_MEMORY_RANKING = 'on';
    process.env.AGENT_DECISION_ROUTING_MIN_CONFIDENCE = '1';
    process.env.AGENT_DECISION_TOOL_EAGER_SERVERS = '2';
    process.env.AGENT_DECISION_TOOL_MIN_SCORE = '0';
    process.env.AGENT_DECISION_MEMORY_MIN_SCORE = '0.9';
    expect(getDecisionBaseUrl()).toBe('http://127.0.0.1:9');
    expect(getDecisionModel()).toBe('m');
    expect(getDecisionTimeoutMs()).toBe(750);
    expect(getDecisionFeatureMode('tool_ranking')).toBe('shadow');
    expect(getDecisionFeatureMode('memory_ranking')).toBe('on');
    expect(getDecisionRoutingMinConfidence()).toBe(1);
    expect(getDecisionToolEagerServers()).toBe(2);
    expect(getDecisionToolMinScore()).toBe(0);
    expect(getDecisionMemoryMinScore()).toBe(0.9);
  });

  it('falls back on invalid values', () => {
    process.env.AGENT_DECISION_TIMEOUT_MS = '-5';
    process.env.AGENT_DECISION_MODEL_ROUTING = 'yes';
    process.env.AGENT_DECISION_ROUTING_MIN_CONFIDENCE = '0';
    process.env.AGENT_DECISION_TOOL_EAGER_SERVERS = '1.5';
    process.env.AGENT_DECISION_TOOL_MIN_SCORE = '2';
    process.env.AGENT_DECISION_MEMORY_MIN_SCORE = 'abc';
    expect(getDecisionTimeoutMs()).toBe(400);
    expect(getDecisionFeatureMode('model_routing')).toBe('off');
    expect(getDecisionRoutingMinConfidence()).toBe(0.55);
    expect(getDecisionToolEagerServers()).toBe(4);
    expect(getDecisionToolMinScore()).toBe(0.3);
    expect(getDecisionMemoryMinScore()).toBe(0.5);
    process.env.AGENT_DECISION_ROUTING_MIN_CONFIDENCE = '1.2';
    expect(getDecisionRoutingMinConfidence()).toBe(0.55);
  });
});

describe('getEffectiveDecisionMode', () => {
  it('unset: auto sessions are on, everything else off', () => {
    expect(getEffectiveDecisionMode('model_routing', { sessionAuto: true })).toBe('on');
    expect(getEffectiveDecisionMode('capacity_routing', { sessionAuto: true })).toBe('on');
    expect(getEffectiveDecisionMode('model_routing', { sessionAuto: false })).toBe('off');
    expect(getEffectiveDecisionMode('model_routing')).toBe('off');
  });

  it('empty or unrecognised values count as unset', () => {
    process.env.AGENT_DECISION_MODEL_ROUTING = '  ';
    expect(getEffectiveDecisionMode('model_routing', { sessionAuto: true })).toBe('on');
    process.env.AGENT_DECISION_MODEL_ROUTING = 'yes';
    expect(getEffectiveDecisionMode('model_routing', { sessionAuto: true })).toBe('on');
    expect(getEffectiveDecisionMode('model_routing', { sessionAuto: false })).toBe('off');
  });

  it('an explicit recognised value always wins (off is a kill switch)', () => {
    process.env.AGENT_DECISION_MODEL_ROUTING = 'off';
    expect(getEffectiveDecisionMode('model_routing', { sessionAuto: true })).toBe('off');
    process.env.AGENT_DECISION_MODEL_ROUTING = 'shadow';
    expect(getEffectiveDecisionMode('model_routing', { sessionAuto: true })).toBe('shadow');
    process.env.AGENT_DECISION_MODEL_ROUTING = 'ON';
    expect(getEffectiveDecisionMode('model_routing', { sessionAuto: false })).toBe('on');
  });

  it('tool/memory ranking stay env-only via getDecisionFeatureMode', () => {
    expect(getDecisionFeatureMode('tool_ranking')).toBe('off');
  });
});
