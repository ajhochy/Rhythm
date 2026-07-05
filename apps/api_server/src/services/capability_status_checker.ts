/**
 * Capability Status Checker — #894
 *
 * A short, synchronous sweep over every integration a Rhythm agent session
 * might depend on, so a caller can know what's healthy BEFORE starting a long
 * agent run rather than discovering a dead integration partway through (e.g.
 * PCO timing out after the agent already sent emails).
 *
 * Scope (safe subset of #894): this module answers "what's healthy right
 * now" via checkCapabilities() / writeCapabilityStatus(), and GET
 * /agent-capability-status exposes it over HTTP so a session can query it.
 * It does NOT (yet) block agent_runner.run() on a failing check, and it does
 * NOT (yet) gate AgentTriggerWatcher firing — wiring either of those in is a
 * behavior change with a much larger blast radius (every existing agent-run
 * test path) and is left as follow-up, noted in the issue.
 */

import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { logger } from '../utils/logger';

export type CapabilityState = 'ok' | 'degraded' | 'down';

export interface CapabilityEntry {
  state: CapabilityState;
  detail?: string;
}

export interface CapabilityStatus {
  checkedAt: string;
  capabilities: Record<string, CapabilityEntry>;
}

function capabilityStatusDir(): string {
  return join(homedir(), '.rhythm-agent');
}

/** Path to the written status file — exported so callers (and tests) don't hardcode it. */
export function capabilityStatusPath(): string {
  return join(capabilityStatusDir(), 'capability_status.json');
}

async function checkDatabase(): Promise<CapabilityEntry> {
  try {
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query('SELECT 1');
    } else {
      getDb().prepare('SELECT 1').get();
    }
    return { state: 'ok' };
  } catch (err) {
    return { state: 'down', detail: String(err) };
  }
}

/** Shared shape for the three OAuth-backed integrations tracked in integration_accounts. */
async function checkIntegrationProvider(
  provider: 'planning_center' | 'gmail' | 'google_calendar',
): Promise<CapabilityEntry> {
  try {
    const accounts = await new IntegrationAccountsRepository().findAllAsync();
    const matches = accounts.filter((a) => a.provider === provider);
    if (matches.length === 0) {
      return { state: 'down', detail: 'not connected' };
    }
    if (matches.some((a) => a.status === 'connected')) {
      return { state: 'ok' };
    }
    return { state: 'down', detail: matches[0].errorMessage ?? 'connection error' };
  } catch (err) {
    return { state: 'down', detail: String(err) };
  }
}

/**
 * Runs every check and returns the aggregate status. Never throws — an
 * individual check failure is captured as that capability's 'down' state,
 * not a thrown error, so a caller can always render something.
 */
export async function checkCapabilities(): Promise<CapabilityStatus> {
  const [database, planningCenter, gmail, googleCalendar] = await Promise.all([
    checkDatabase(),
    checkIntegrationProvider('planning_center'),
    checkIntegrationProvider('gmail'),
    checkIntegrationProvider('google_calendar'),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    capabilities: {
      database,
      planning_center: planningCenter,
      gmail,
      google_calendar: googleCalendar,
      // The Rhythm MCP server's tools run in-process inside this api_server —
      // if this code is executing, the MCP backend it depends on is up.
      rhythm_mcp: { state: 'ok', detail: 'in-process' },
    },
  };
}

/** Runs checkCapabilities() and persists the result to ~/.rhythm-agent/capability_status.json. */
export async function writeCapabilityStatus(): Promise<CapabilityStatus> {
  const status = await checkCapabilities();
  try {
    mkdirSync(capabilityStatusDir(), { recursive: true });
    writeFileSync(capabilityStatusPath(), JSON.stringify(status, null, 2), 'utf8');
  } catch (err) {
    logger.warn(`[CapabilityStatusChecker] failed to write status file (non-fatal): ${String(err)}`);
  }
  return status;
}
