type Row = Record<string, unknown>;
export type Snapshot = { schemaVersion: 1; sourceKind: string; sourceReadOnly: boolean;
  sourceOwnerUserId: number; sourcePath: string; windowDays: number; capturedAt: string;
  excludedControlProfiles: string[]; omissions: string[];
  managedSkillDependencies: Array<{ name: string; state: 'present' | 'absent';
    sha256?: string; bytesBase64?: string }>;
  provenance: Array<{ sessionId: string; profileId: string; selectionRole: 'failure' | 'counterexample';
    sourceStatus: string; sourceCreatedAt: string; sourceMessageCount: number; sourceRowsSha256: string }>;
  tables: Record<'agent_configs' | 'agent_sessions' | 'agent_session_messages' |
    'agent_scheduled_tasks' | 'agent_skills' | 'agent_cookbook', Row[]> };

export type PaidOrgSeedReceipt = {
  schemaVersion: 1; kind: 'web-paid-org-seed-v1'; sourceRevision: string;
  fixtureRoot: string; manifestPath: string; profileSeedPath: string; profileSeedSha256: string;
  sourceConfigRoot: string; managedSkillsSha256: string; snapshotSha256: string; profileIds: string[];
  projectedProfileIds: string[]; unprojectedDependencyIds: string[];
};
export const seedFields: Readonly<Record<string,string>>;
export function skillSlug(name: string): string;
export function readPaidOrgSnapshot(path: string, expectedSha: string, ownerUserId: number): Snapshot;
export function preparePaidOrgSnapshot(options: { manifestPath: string; sourceRevision: string; sourceConfigRoot: string;
  snapshotPath: string; snapshotSha256: string; profileIds: string[] }): PaidOrgSeedReceipt;
