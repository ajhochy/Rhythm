import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const harness = resolve(__dirname, '../__tests__/live_e2e_1480_1481_1483_1484.test.ts');

describe('S4 diagnosis provider harness contract', () => {
  it('pins both cheap-tier scoring and diagnosis to the exact Anthropic Haiku fixture route', async () => {
    const source = await readFile(harness, 'utf8');

    // Regression: scoring has no override and silently escapes the custom diagnosis-only fixture provider.
    expect(source).toContain("const providerId = 'anthropic'");
    expect(source).toContain("const modelId = 'claude-haiku-4-5'");
    expect(source).toContain("npm: '@ai-sdk/anthropic'");
    expect(source).toContain('/global/config');
    expect(source).toContain('/system/refresh');
    expect(source).toContain('/session/');
    expect(source).toContain('providerID');
    expect(source).toContain('modelID');
  });

  it('returns distinct draft and candidate scores and proves both scorer requests arrived', async () => {
    const source = await readFile(harness, 'utf8');

    // Regression: the fallback gives draft and candidate identical scores, so no unique proposal is emitted.
    expect(source).toContain("body.includes('Score (0-100)')");
    expect(source).toContain("body.includes('## Problem')");
    expect(source).toContain('20 skeletal intent stub without an actionable procedure');
    expect(source).toContain('95 precise, complete, reusable, and actionable');
    expect(source).toContain('candidateScoreReceived');
    expect(source).toContain('draftScoreReceived');
    expect(source).toMatch(/expect\(candidateScoreReceived\)\.toBe\(true\)/);
    expect(source).toMatch(/expect\(draftScoreReceived\)\.toBe\(true\)/);
  });

  it('atomically restores only sandbox provider.anthropic before fixture shutdown', async () => {
    const source = await readFile(harness, 'utf8');

    // Regression: PATCH deep-merge cannot remove the generated provider and can overwrite unrelated providers.
    expect(source).toContain("'.config', 'opencode', 'opencode.json'");
    expect(source).toContain('RHYTHM_SANDBOX_DIR');
    expect(source).toContain('originalAnthropicProvider');
    expect(source).toContain('originalOtherProviders');
    expect(source).toContain('writeFile');
    expect(source).toContain('rename');
    expect(source).toContain('/system/refresh');
    expect(source).toMatch(/delete .*provider\.anthropic/);
    expect(source.indexOf('rename')).toBeLessThan(source.lastIndexOf('fixture.close'));
  });

  it('serves Anthropic messages SSE and records positive evidence without receiving infra markers', async () => {
    const source = await readFile(harness, 'utf8');

    // Regression: OpenAI chat-completion chunks are not consumed by @ai-sdk/anthropic.
    expect(source).toContain("'/v1/messages'");
    expect(source).toContain("type: 'content_block_delta'");
    expect(source).toContain('positiveEvidenceReceived');
    expect(source).toContain('infraMarkerReceived');
  });
});
