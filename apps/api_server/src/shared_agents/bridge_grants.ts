import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { AgentBridgeJobsRepository } from './delegation_jobs_repository';
import { logger } from '../utils/logger';

export const BRIDGE_SCOPES = ['catalog.read','agent.write','projection.issue','runtime.report','delegation.dispatch','delegation.execute','memory.search'] as const;
export type BridgeScope = typeof BRIDGE_SCOPES[number];
export interface RuntimeReport {
  hermesVersion: string; pluginVersion: string;
  providers: Array<{ id: string; ready: boolean }>;
  reasoningEfforts: string[];
  terminalBackend: 'local'|'container'|'remote'|'unknown';
}
export interface BridgeGrant {
  grantId: string; capabilitySha256: string; localUserId: number; hermesProfile: 'default';
  runtimeGeneration: string; serverOrigin: string; authGeneration: string;
  scopes: Set<BridgeScope>; memoryVaultId: string | null; refKey: Buffer;
  report: RuntimeReport | null; lastClaimAt: number | null;
}
const byGrant = new Map<string, BridgeGrant>();
const byCapability = new Map<string, BridgeGrant>();

export class BridgeGrantConflictError extends Error {}

function retireGenerationJobs(grant: BridgeGrant): void {
  try {
    new AgentBridgeJobsRepository().markRuntimeRetired(grant.runtimeGeneration);
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('Database not initialized')
      || error.message.includes('no such table: agent_bridge_jobs')
    )) return;
    logger.error('[SharedAgents] failed to retire bridge generation jobs', {
      grantId: grant.grantId,
      runtimeGeneration: grant.runtimeGeneration,
      error: String(error),
    });
  }
}

export function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function secureDigestMatch(presented: string, expectedHex: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedHex)) return false;
  const actual = Buffer.from(sha256(presented), 'hex');
  return timingSafeEqual(actual, Buffer.from(expectedHex, 'hex'));
}
export function registerGrant(input: Omit<BridgeGrant,'scopes'|'refKey'|'report'|'lastClaimAt'> & { scopes: BridgeScope[] }): { grant: BridgeGrant; replacedGrantId: string | null } {
  const existingId = byGrant.get(input.grantId);
  if (existingId) {
    const sameScopes = existingId.scopes.size === new Set(input.scopes).size
      && input.scopes.every((scope) => existingId.scopes.has(scope));
    if (
      existingId.capabilitySha256 === input.capabilitySha256
      && existingId.localUserId === input.localUserId
      && existingId.hermesProfile === input.hermesProfile
      && existingId.runtimeGeneration === input.runtimeGeneration
      && existingId.serverOrigin === input.serverOrigin
      && existingId.authGeneration === input.authGeneration
      && existingId.memoryVaultId === input.memoryVaultId
      && sameScopes
    ) return { grant: existingId, replacedGrantId: null };
    throw new BridgeGrantConflictError('grant_id_conflict');
  }
  if (byCapability.has(input.capabilitySha256)) {
    throw new BridgeGrantConflictError('grant_id_conflict');
  }
  const replaced = [...byGrant.values()].find((grant) => grant.localUserId === input.localUserId && grant.hermesProfile === input.hermesProfile);
  if (replaced) revokeGrant(replaced.grantId);
  const grant: BridgeGrant = { ...input, scopes: new Set(input.scopes), refKey: randomBytes(32), report: null, lastClaimAt: null };
  byGrant.set(grant.grantId, grant); byCapability.set(grant.capabilitySha256, grant);
  return { grant, replacedGrantId: replaced?.grantId ?? null };
}
export function revokeGrant(id: string): BridgeGrant | null {
  const grant = byGrant.get(id) ?? null;
  if (grant) {
    byGrant.delete(id);
    byCapability.delete(grant.capabilitySha256);
    retireGenerationJobs(grant);
  }
  return grant;
}
export function revokeAllGrants(): BridgeGrant[] {
  const grants = [...byGrant.values()];
  for (const grant of grants) revokeGrant(grant.grantId);
  return grants;
}
export function grantForId(id: string): BridgeGrant | null { return byGrant.get(id) ?? null; }
export function grantForCapability(token: string): BridgeGrant | null { return byCapability.get(sha256(token)) ?? null; }
export function grantForUser(localUserId: number): BridgeGrant | null { return [...byGrant.values()].find((grant) => grant.localUserId === localUserId && grant.hermesProfile === 'default') ?? null; }
export function resetBridgeGrantsForTest(): void { byGrant.clear(); byCapability.clear(); }
