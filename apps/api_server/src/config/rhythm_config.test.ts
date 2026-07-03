import { describe, expect, it } from 'vitest';

import {
  BLANK_SLATE_CORE_CAPABILITIES,
  BLANK_SLATE_DISABLED_CAPABILITIES,
  blankSlateConfig,
  capabilityStatus,
  mergeRhythmConfig,
} from './rhythm_config';

describe('blankSlateConfig', () => {
  it('enables only the core capabilities (AI provider, File Ops, Terminal)', () => {
    const config = blankSlateConfig();
    for (const key of BLANK_SLATE_CORE_CAPABILITIES) {
      expect(config.capabilities[key]).toBe(true);
    }
  });

  it('writes every non-core capability as explicit false, not absent', () => {
    const config = blankSlateConfig();
    for (const key of BLANK_SLATE_DISABLED_CAPABILITIES) {
      expect(config.capabilities[key]).toBe(false);
      expect(key in config.capabilities).toBe(true);
    }
  });

  it('starts with an empty (not null) enabled-skills allowlist', () => {
    const config = blankSlateConfig();
    expect(config.enabledSkills).toEqual([]);
  });
});

describe('capabilityStatus', () => {
  it('reports "disabled" for an explicit false, distinct from "unconfigured"', () => {
    const config = blankSlateConfig();
    expect(capabilityStatus(config, 'webSearch')).toBe('disabled');
  });

  it('reports "enabled" for an explicit true', () => {
    const config = blankSlateConfig();
    expect(capabilityStatus(config, 'fileOps')).toBe('enabled');
  });

  it('reports "unconfigured" when the key is absent entirely', () => {
    const config = { capabilities: {}, disabledMcpServers: [], enabledSkills: null };
    expect(capabilityStatus(config, 'webSearch')).toBe('unconfigured');
  });
});

describe('mergeRhythmConfig — explicit false survives an update merge', () => {
  it('keeps a capability disabled even when the incoming (updated) default is true', () => {
    const existing = blankSlateConfig(); // webSearch: false
    const incoming = { capabilities: { webSearch: true } }; // simulated new version defaulting it on

    const merged = mergeRhythmConfig(existing, incoming);
    expect(merged.capabilities.webSearch).toBe(false);
  });

  it('keeps an explicit true set by the user even when incoming omits the key', () => {
    const existing = blankSlateConfig(); // fileOps: true
    const incoming = { capabilities: {} };

    const merged = mergeRhythmConfig(existing, incoming);
    expect(merged.capabilities.fileOps).toBe(true);
  });

  it('adopts a brand-new capability from the incoming config when existing never touched it', () => {
    const existing: Parameters<typeof mergeRhythmConfig>[0] = {
      capabilities: {},
      disabledMcpServers: [],
      enabledSkills: null,
    };
    const incoming = { capabilities: { codeExecutionSandbox: true } };

    const merged = mergeRhythmConfig(existing, incoming);
    expect(merged.capabilities.codeExecutionSandbox).toBe(true);
  });

  it('unions disabledMcpServers from both configs without duplicates', () => {
    const existing = { capabilities: {}, disabledMcpServers: ['notion'], enabledSkills: null };
    const incoming = { disabledMcpServers: ['notion', 'canva'] };

    const merged = mergeRhythmConfig(existing, incoming);
    expect(merged.disabledMcpServers.sort()).toEqual(['canva', 'notion']);
  });

  it('preserves an existing non-null enabledSkills allowlist across the merge', () => {
    const existing = { capabilities: {}, disabledMcpServers: [], enabledSkills: ['coding-agent'] };
    const incoming = { enabledSkills: ['coding-agent', 'planning-agent'] };

    const merged = mergeRhythmConfig(existing, incoming);
    expect(merged.enabledSkills).toEqual(['coding-agent']);
  });

  it('simulated update round-trip: a full blank-slate config survives an incoming "enable everything" update', () => {
    const existing = blankSlateConfig();
    const incomingUpdate = {
      capabilities: Object.fromEntries(
        [...BLANK_SLATE_CORE_CAPABILITIES, ...BLANK_SLATE_DISABLED_CAPABILITIES].map((k) => [k, true]),
      ),
    };

    const merged = mergeRhythmConfig(existing, incomingUpdate);
    for (const key of BLANK_SLATE_DISABLED_CAPABILITIES) {
      expect(merged.capabilities[key]).toBe(false);
    }
  });
});
