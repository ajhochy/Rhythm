import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const harness = resolve(__dirname, '../__tests__/live_e2e_1480_1481_1483_1484.test.ts');

describe('S4 diagnosis provider harness contract', () => {
  it('registers an Anthropic fixture model and verifies the real diagnosis session selected it', async () => {
    const source = await readFile(harness, 'utf8');

    // Regression: the fixture can listen yet remain unreachable when the engine config never registers it.
    expect(source).toContain("npm: '@ai-sdk/anthropic'");
    expect(source).toContain('/global/config');
    expect(source).toContain('/system/refresh');
    expect(source).toContain('/session/');
    expect(source).toContain('providerID');
    expect(source).toContain('modelID');
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
