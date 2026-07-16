/**
 * Tests for org_proposal_appliers_wiring.ts's buildRealExternalAdoptionDeps()
 * — the REAL production implementation of ExternalAdoptionApplyDeps (#1114).
 *
 * Before #1114, `installCuratedMcp` called `opencodeClient.ensureCuratedMcps
 * ({register:true})` with NO `servers` override, meaning it only ever
 * ensured the STATIC curated catalog (CURATED_MCP_SERVERS) — a genuinely NEW
 * server discovered via external_discovery_search.ts's mcp-registry search
 * would silently install NOTHING. This also never wired the adopted server
 * to the requesting agent's OWN scope (secretary-MCP-scope lesson) — a
 * successful "install" left the server enabled for every agent, not just
 * the one whose capability-gap it filled.
 *
 * opencodeClient is mocked (mirrors issue_850_contract.test.ts's own
 * pattern for this same singleton) — these tests prove ROUTING (server
 * shape built + passed, allowedMcpsJson wired) without touching a real
 * opencode.json or engine.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';

const mockEnsureCuratedMcps = vi.fn();
vi.mock('../opencode_engine', () => ({
  opencodeClient: {
    ensureCuratedMcps: (...args: unknown[]) => mockEnsureCuratedMcps(...args),
  },
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
  mockEnsureCuratedMcps.mockReset();
});

describe('#1114 — buildRealExternalAdoptionDeps().installCuratedMcp', () => {
  it('builds a CuratedMcpServer from serverName + installCommand and ensures ONLY that one server (not the static catalog)', async () => {
    mockEnsureCuratedMcps.mockResolvedValue({
      changed: true,
      registered: true,
      servers: [{ id: 'weather-mcp', name: 'weather-mcp', type: 'local', command: ['npx', '-y', '@x/weather-mcp'], requiredEnv: [] }],
    });

    const { buildRealExternalAdoptionDeps } = await import('../org_proposal_appliers_wiring');
    const deps = buildRealExternalAdoptionDeps();
    const result = await deps.installCuratedMcp({
      serverName: 'weather-mcp',
      installCommand: 'npx -y @x/weather-mcp',
    });

    expect(mockEnsureCuratedMcps).toHaveBeenCalledTimes(1);
    const call = mockEnsureCuratedMcps.mock.calls[0][0] as { servers?: unknown[]; register?: boolean };
    expect(call.register).toBe(true);
    expect(call.servers).toHaveLength(1); // ONLY the discovered server, not CURATED_MCP_SERVERS
    expect(call.servers?.[0]).toMatchObject({
      id: 'weather-mcp',
      name: 'weather-mcp',
      type: 'local',
      command: ['npx', '-y', '@x/weather-mcp'],
      requiredEnv: [],
    });
    expect(result.changed).toBe(true);
    expect(result.registered).toBe(true);
  });

  it('throws when installCommand is missing — no ambiguous silent no-op install', async () => {
    const { buildRealExternalAdoptionDeps } = await import('../org_proposal_appliers_wiring');
    const deps = buildRealExternalAdoptionDeps();
    await expect(deps.installCuratedMcp({ serverName: 'no-install-cmd' })).rejects.toThrow(
      /installCommand/,
    );
    expect(mockEnsureCuratedMcps).not.toHaveBeenCalled();
  });

  it('wires the adopted server into JUST the needing agent\'s allowedMcpsJson (scoped, not global)', async () => {
    mockEnsureCuratedMcps.mockResolvedValue({
      changed: true,
      registered: true,
      servers: [{ id: 'weather-mcp', name: 'weather-mcp', type: 'local', command: ['npx', '-y', '@x/weather-mcp'], requiredEnv: [] }],
    });

    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['rhythm']),
    });

    const { buildRealExternalAdoptionDeps } = await import('../org_proposal_appliers_wiring');
    const deps = buildRealExternalAdoptionDeps();
    const result = await deps.installCuratedMcp({
      serverName: 'weather-mcp',
      installCommand: 'npx -y @x/weather-mcp',
      agentConfigId: config.id,
    });

    const updated = configsRepo.getById(config.id);
    const allowed = JSON.parse(updated!.allowedMcpsJson!) as string[];
    expect(allowed).toContain('rhythm'); // prior scope preserved
    expect(allowed).toContain('weather-mcp'); // newly adopted server appended

    // Reversibly wired: the prior allowlist is captured for a future revert.
    expect(result.beforeSnapshotJson).toBeTruthy();
    const snapshot = JSON.parse(result.beforeSnapshotJson!) as {
      agentConfigId: string;
      priorAllowedMcpsJson: string | null;
    };
    expect(snapshot.agentConfigId).toBe(config.id);
    expect(JSON.parse(snapshot.priorAllowedMcpsJson!)).toEqual(['rhythm']);
  });

  it('does not duplicate the server id in allowedMcpsJson on a repeat wire', async () => {
    mockEnsureCuratedMcps.mockResolvedValue({
      changed: false,
      registered: false,
      servers: [],
    });

    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['weather-mcp']),
    });

    const { buildRealExternalAdoptionDeps } = await import('../org_proposal_appliers_wiring');
    const deps = buildRealExternalAdoptionDeps();
    await deps.installCuratedMcp({
      serverName: 'weather-mcp',
      installCommand: 'npx -y @x/weather-mcp',
      agentConfigId: config.id,
    });

    const updated = configsRepo.getById(config.id);
    const allowed = JSON.parse(updated!.allowedMcpsJson!) as string[];
    expect(allowed.filter((s) => s === 'weather-mcp')).toHaveLength(1);
  });

  it('installs without wiring or throwing when no agentConfigId is given (gap had no known requester)', async () => {
    mockEnsureCuratedMcps.mockResolvedValue({
      changed: true,
      registered: true,
      servers: [{ id: 'weather-mcp', name: 'weather-mcp', type: 'local', command: ['npx', '-y', '@x/weather-mcp'], requiredEnv: [] }],
    });

    const { buildRealExternalAdoptionDeps } = await import('../org_proposal_appliers_wiring');
    const deps = buildRealExternalAdoptionDeps();
    const result = await deps.installCuratedMcp({
      serverName: 'weather-mcp',
      installCommand: 'npx -y @x/weather-mcp',
    });

    expect(result.changed).toBe(true);
    expect(result.beforeSnapshotJson).toBeUndefined();
  });

  it('installs without wiring when agentConfigId does not resolve to a live agent_configs row', async () => {
    mockEnsureCuratedMcps.mockResolvedValue({
      changed: true,
      registered: true,
      servers: [{ id: 'weather-mcp', name: 'weather-mcp', type: 'local', command: ['npx', '-y', '@x/weather-mcp'], requiredEnv: [] }],
    });

    const { buildRealExternalAdoptionDeps } = await import('../org_proposal_appliers_wiring');
    const deps = buildRealExternalAdoptionDeps();
    const result = await deps.installCuratedMcp({
      serverName: 'weather-mcp',
      installCommand: 'npx -y @x/weather-mcp',
      agentConfigId: 'does-not-exist',
    });

    expect(result.changed).toBe(true);
    expect(result.beforeSnapshotJson).toBeUndefined();
  });
});
