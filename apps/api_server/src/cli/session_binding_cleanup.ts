import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import Database from 'better-sqlite3';

const CORRUPTED_PROFILE_ID = 'Theological-Researcher';
const REPORT_VERSION = 1;

type ReviewDecision = 'pending' | 'approve' | 'preserve';

type SessionBindingSnapshot = {
  profileId: string | null;
  agentKind: string;
  updatedAt: string;
};

export type SessionBindingCleanupCandidate = {
  sessionId: string;
  sdkSessionId: string | null;
  name: string;
  projectId: string | null;
  reason: string;
  before: SessionBindingSnapshot & {
    providerId: string | null;
    modelId: string | null;
    permissionMode: string;
    thinkingBudget: number | null;
  };
  proposed: {
    profileId: string | null;
    agentKind: string;
    note: string;
  };
  reviewDecision: ReviewDecision;
  reviewNote: string;
};

export type SessionBindingCleanupReport = {
  version: number;
  mode: 'dry-run';
  generatedAt: string;
  reportId: string;
  candidateProfileId: string;
  candidateCount: number;
  instructions: string[];
  candidates: SessionBindingCleanupCandidate[];
};

export type SessionBindingCleanupAudit = {
  version: number;
  mode: 'apply';
  status: 'applied';
  appliedAt: string;
  reportId: string;
  appliedSessionIds: string[];
  preservedSessionIds: string[];
  changes: Array<{
    sessionId: string;
    before: SessionBindingSnapshot;
    after: SessionBindingSnapshot;
  }>;
};

type CandidateRow = {
  id: string;
  sdk_session_id: string | null;
  name: string;
  project_id: string | null;
  profile_id: string;
  agent_kind: string;
  provider_id: string | null;
  model_id: string | null;
  permission_mode: string;
  thinking_budget: number | null;
  updated_at: string;
};

function reportFingerprint(
  candidates: SessionBindingCleanupCandidate[],
): string {
  return createHash('sha256')
    .update(JSON.stringify(candidates.map((candidate) => ({
      sessionId: candidate.sessionId,
      before: candidate.before,
    }))))
    .digest('hex');
}

function requireCleanupColumns(db: Database.Database): void {
  const columns = new Set(
    (db.pragma('table_info(agent_sessions)') as { name: string }[])
      .map(({ name }) => name),
  );
  const required = [
    'id',
    'sdk_session_id',
    'name',
    'project_id',
    'profile_id',
    'agent_kind',
    'provider_id',
    'model_id',
    'permission_mode',
    'thinking_budget',
    'updated_at',
  ];
  const missing = required.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw new Error(
      `agent_sessions is missing required cleanup columns: ${missing.join(', ')}`,
    );
  }
}

export function buildSessionBindingCleanupReport(
  db: Database.Database,
  generatedAt = new Date().toISOString(),
): SessionBindingCleanupReport {
  requireCleanupColumns(db);
  const rows = db.prepare(`
    SELECT id, sdk_session_id, name, project_id, profile_id, agent_kind,
           provider_id, model_id, permission_mode, thinking_budget, updated_at
      FROM agent_sessions
     WHERE profile_id = ?
     ORDER BY updated_at, id
  `).all(CORRUPTED_PROFILE_ID) as CandidateRow[];
  const candidates: SessionBindingCleanupCandidate[] = rows.map((row) => ({
    sessionId: row.id,
    sdkSessionId: row.sdk_session_id,
    name: row.name,
    projectId: row.project_id,
    reason:
      `Persisted profile_id exactly matches ${CORRUPTED_PROFILE_ID}; ` +
      'this may be an intentional binding and must be reviewed individually.',
    before: {
      profileId: row.profile_id,
      agentKind: row.agent_kind,
      providerId: row.provider_id,
      modelId: row.model_id,
      permissionMode: row.permission_mode,
      thinkingBudget: row.thinking_budget,
      updatedAt: row.updated_at,
    },
    proposed: {
      profileId: null,
      agentKind: row.agent_kind,
      note:
        'Clear only the suspect Rhythm profile binding; preserve the existing ' +
        'OpenCode agent and all model/permission settings.',
    },
    reviewDecision: 'pending',
    reviewNote: '',
  }));
  return {
    version: REPORT_VERSION,
    mode: 'dry-run',
    generatedAt,
    reportId: reportFingerprint(candidates),
    candidateProfileId: CORRUPTED_PROFILE_ID,
    candidateCount: candidates.length,
    instructions: [
      'Review every candidate on desktop and mobile.',
      'Set reviewDecision to "approve" only for a confirmed corrupted binding.',
      'Set reviewDecision to "preserve" for legitimate Theological-Researcher chats.',
      'For an approved row, edit proposed.profileId and proposed.agentKind to the reviewed target; use profileId null only to leave the chat Unassigned.',
      'Apply only with --apply --approval-file <reviewed.json> --audit-output <audit.json>.',
    ],
    candidates,
  };
}

function currentSnapshot(
  db: Database.Database,
  sessionId: string,
): SessionBindingSnapshot | undefined {
  const row = db.prepare(`
    SELECT profile_id, agent_kind, updated_at
      FROM agent_sessions
     WHERE id = ?
  `).get(sessionId) as {
    profile_id: string | null;
    agent_kind: string;
    updated_at: string;
  } | undefined;
  if (!row || row.profile_id === null) return undefined;
  return {
    profileId: row.profile_id,
    agentKind: row.agent_kind,
    updatedAt: row.updated_at,
  };
}

export function applyApprovedSessionBindingCleanup(
  db: Database.Database,
  report: SessionBindingCleanupReport,
  appliedAt = new Date().toISOString(),
): SessionBindingCleanupAudit {
  requireCleanupColumns(db);
  if (
    report.version !== REPORT_VERSION ||
    report.mode !== 'dry-run' ||
    report.reportId !== reportFingerprint(report.candidates)
  ) {
    throw new Error('Approval file does not match an untampered cleanup report.');
  }
  if (report.candidates.some(({ reviewDecision }) => reviewDecision === 'pending')) {
    throw new Error('Every candidate must be reviewed as approve or preserve.');
  }
  const approved = report.candidates.filter(
    ({ reviewDecision }) => reviewDecision === 'approve',
  );
  if (approved.length === 0) {
    throw new Error('Approval file contains no approved cleanup candidates.');
  }

  for (const candidate of approved) {
    const proposedProfileId = candidate.proposed.profileId;
    if (
      proposedProfileId !== null &&
      (typeof proposedProfileId !== 'string' || proposedProfileId.trim() === '')
    ) {
      throw new Error(
        `Session ${candidate.sessionId} has an invalid approved profile id.`,
      );
    }
    if (proposedProfileId === null) {
      if (candidate.proposed.agentKind !== candidate.before.agentKind) {
        throw new Error(
          `Session ${candidate.sessionId} cannot change agentKind while clearing profileId.`,
        );
      }
      continue;
    }
    const profile = db.prepare(
      'SELECT oc_agent FROM agent_configs WHERE id = ?',
    ).get(proposedProfileId) as { oc_agent: string | null } | undefined;
    if (!profile?.oc_agent || profile.oc_agent !== candidate.proposed.agentKind) {
      throw new Error(
        `Session ${candidate.sessionId} approved profile/agent mapping is not present in agent_configs.`,
      );
    }
  }

  for (const candidate of report.candidates) {
    const current = currentSnapshot(db, candidate.sessionId);
    const expected = {
      profileId: candidate.before.profileId,
      agentKind: candidate.before.agentKind,
      updatedAt: candidate.before.updatedAt,
    };
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      throw new Error(
        `Session ${candidate.sessionId} changed after the report; generate and review a new dry-run.`,
      );
    }
  }

  const changes: SessionBindingCleanupAudit['changes'] = [];
  const transaction = db.transaction(() => {
    const update = db.prepare(`
      UPDATE agent_sessions
         SET profile_id = ?,
             agent_kind = ?,
             updated_at = ?
       WHERE id = ?
         AND profile_id = ?
         AND agent_kind = ?
         AND updated_at = ?
    `);
    for (const candidate of approved) {
      const result = update.run(
        candidate.proposed.profileId,
        candidate.proposed.agentKind,
        appliedAt,
        candidate.sessionId,
        candidate.before.profileId,
        candidate.before.agentKind,
        candidate.before.updatedAt,
      );
      if (result.changes !== 1) {
        throw new Error(
          `Session ${candidate.sessionId} changed during apply; no cleanup was committed.`,
        );
      }
      changes.push({
        sessionId: candidate.sessionId,
        before: {
          profileId: candidate.before.profileId,
          agentKind: candidate.before.agentKind,
          updatedAt: candidate.before.updatedAt,
        },
        after: {
          profileId: candidate.proposed.profileId,
          agentKind: candidate.proposed.agentKind,
          updatedAt: appliedAt,
        },
      });
    }
  });
  transaction();

  return {
    version: REPORT_VERSION,
    mode: 'apply',
    status: 'applied',
    appliedAt,
    reportId: report.reportId,
    appliedSessionIds: approved.map(({ sessionId }) => sessionId),
    preservedSessionIds: report.candidates
      .filter(({ reviewDecision }) => reviewDecision === 'preserve')
      .map(({ sessionId }) => sessionId),
    changes,
  };
}

export type SessionBindingCleanupCliOptions = {
  apply: boolean;
  dbPath: string;
  output?: string;
  approvalFile?: string;
  auditOutput?: string;
};

export function parseSessionBindingCleanupArgs(
  args: string[],
): SessionBindingCleanupCliOptions {
  const options: SessionBindingCleanupCliOptions = {
    apply: false,
    dbPath: process.env.DB_PATH ?? './rhythm.db',
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--apply') {
      options.apply = true;
      continue;
    }
    if (['--db', '--output', '--approval-file', '--audit-output'].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a path.`);
      }
      index += 1;
      if (argument === '--db') options.dbPath = value;
      if (argument === '--output') options.output = value;
      if (argument === '--approval-file') options.approvalFile = value;
      if (argument === '--audit-output') options.auditOutput = value;
      continue;
    }
    throw new Error(`Unknown session-binding-cleanup option: ${argument}`);
  }
  if (options.apply && (!options.approvalFile || !options.auditOutput)) {
    throw new Error(
      '--apply requires both --approval-file <reviewed.json> and --audit-output <audit.json>.',
    );
  }
  return options;
}

function writeJson(path: string, value: unknown, flag: 'wx' | 'w'): void {
  writeFileSync(resolve(path), `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag,
  });
}

export async function runSessionBindingCleanupCli(args: string[]): Promise<void> {
  const options = parseSessionBindingCleanupArgs(args);
  const db = new Database(resolve(options.dbPath), {
    readonly: !options.apply,
    fileMustExist: true,
  });
  try {
    if (!options.apply) {
      const report = buildSessionBindingCleanupReport(db);
      if (options.output) writeJson(options.output, report, 'wx');
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const report = JSON.parse(
      readFileSync(resolve(options.approvalFile!), 'utf8'),
    ) as SessionBindingCleanupReport;
    writeJson(options.auditOutput!, {
      version: REPORT_VERSION,
      mode: 'apply',
      status: 'pending',
      reportId: report.reportId,
      startedAt: new Date().toISOString(),
    }, 'wx');
    let audit: SessionBindingCleanupAudit;
    try {
      audit = applyApprovedSessionBindingCleanup(db, report);
      writeJson(options.auditOutput!, audit, 'w');
    } catch (error) {
      writeJson(options.auditOutput!, {
        version: REPORT_VERSION,
        mode: 'apply',
        status: 'failed',
        reportId: report.reportId,
        failedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      }, 'w');
      throw error;
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(audit, null, 2));
  } finally {
    db.close();
  }
}
