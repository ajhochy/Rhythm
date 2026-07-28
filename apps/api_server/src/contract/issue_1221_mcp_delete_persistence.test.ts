import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { OpencodeClientService } from '../services/opencode_client_service';

describe('issue #1221 durable MCP deletion contract', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('issue-1221-c1: a curated MCP deletion survives a new service instance and ensure pass', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'rhythm-issue-1221-'));
    const configPath = join(tempDir, 'opencode.json');
    const deletionPath = join(tempDir, 'mcp-deletions.json');
    writeFileSync(configPath, '{}\n');
    writeFileSync(
      deletionPath,
      JSON.stringify({ deleted: ['obsidian'] }, null, 2) + '\n',
    );

    const restartedService = new OpencodeClientService();
    const ensured = await restartedService.ensureCuratedMcps({
      configPath,
      register: false,
      servers: [
        {
          id: 'obsidian',
          name: 'Obsidian',
          type: 'local',
          command: ['/tmp/mcp-obsidian'],
          requiredEnv: [],
        },
      ],
      deletionPath,
    } as Parameters<OpencodeClientService['ensureCuratedMcps']>[0] & {
      deletionPath: string;
    });

    const persisted = JSON.parse(readFileSync(configPath, 'utf8')) as {
      mcp?: Record<string, unknown>;
    };
    expect(ensured.servers).toEqual([]);
    expect(persisted.mcp ?? {}).not.toHaveProperty('obsidian');
  });
});
