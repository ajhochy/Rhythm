import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Producer half of a two-sided contract test.
 *
 * The consumer half lives in the fork
 * (`apps/opencode_fork/packages/opencode/test/tool/task.test.ts`) and asserts
 * that `ConfigAgent.load` + `childMcpAllowlist`/`childSkillAllowlist` correctly
 * parse a committed fixture. This half asserts the real writer still produces
 * byte-identical bytes for that fixture.
 *
 * Split rather than coupled because importing api_server from the fork drags in
 * the DB layer (`better-sqlite3`), which fork CI does not install — a coupled
 * test could only pass locally, which is not protection. If the writer's output
 * format drifts, THIS test fails; if the reader stops understanding it, the fork
 * test fails. Together they cover the whole chain, and each runs in a job that
 * has the dependencies it needs.
 *
 * Regression context: `childMcpAllowlist` silently returned "unrestricted" for
 * any agent whose `options.mcpAllowlist` didn't parse, so a projection-format
 * break would have unscoped every delegated child with nothing going red.
 */

const FIXTURE = join(
  __dirname, '..', '..', '..', '..',
  'opencode_fork', 'packages', 'opencode',
  'test', 'fixtures', 'agent-writer', 'writer-contract-child.md',
);

describe('opencode_agent_writer <-> fork ConfigAgent contract', () => {
  let home: string;
  const prev = { HOME: process.env.HOME, VITEST: process.env.VITEST, NODE_ENV: process.env.NODE_ENV };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'writer-contract-'));
    process.env.HOME = home;
    // shouldWriteAgentFile() no-ops when VITEST === 'true' || NODE_ENV === 'test',
    // which is exactly the projection guard that keeps test runs from writing into
    // a developer's real ~/.config/opencode. Lift it so the real write path runs,
    // scoped to the scratch HOME above and restored in afterEach.
    process.env.VITEST = 'false';
    process.env.NODE_ENV = 'development';
    vi.resetModules();
  });

  afterEach(() => {
    process.env.HOME = prev.HOME;
    process.env.VITEST = prev.VITEST;
    process.env.NODE_ENV = prev.NODE_ENV;
    rmSync(home, { recursive: true, force: true });
  });

  it('writes the exact agent file the fork fixture pins', async () => {
    const { writeAgentProfileFile } = await import('../opencode_agent_writer');

    const now = '2026-01-01T00:00:00.000Z';
    writeAgentProfileFile({
      id: 'writer-contract-child',
      label: 'Writer Contract Child',
      icon: 'smart_toy',
      enabled: true,
      isAgent: true,
      isManager: false,
      systemPrompt: 'Do the thing.',
      allowedMcpsJson: JSON.stringify(['gitnexus']),
      allowedSkillsJson: JSON.stringify(['coding-agent']),
      corePermissionsJson: null,
      allowedDelegatesJson: null,
      presetId: null,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
      modelProvider: null,
      modelId: null,
      ocAgent: 'writer-contract-child',
      sessionSelectable: true,
      modelTierHint: null,
      defaultAnthropicAccountId: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const written = join(home, '.config', 'opencode', 'agents', 'writer-contract-child.md');
    expect(existsSync(written)).toBe(true);

    const actual = readFileSync(written, 'utf8');
    const pinned = readFileSync(FIXTURE, 'utf8');

    // Identical modulo trailing whitespace. If this fails, the writer's format
    // changed: regenerate the fork fixture and confirm the fork-side consumer
    // test still passes, so both halves move together deliberately rather than
    // silently diverging. Trailing newline is normalised because it carries no
    // contract meaning and differs by how the fixture is captured.
    expect(actual.trimEnd()).toBe(pinned.trimEnd());

    // Belt-and-braces on the two keys the child-scoping helpers actually read,
    // so a failure message names them even if the diff is large.
    expect(actual).toContain('"mcpAllowlist":{"servers":["gitnexus"],"tools":[]}');
    expect(actual).toContain('"skillAllowlist":{"skills":["coding-agent"]}');
  });
});
