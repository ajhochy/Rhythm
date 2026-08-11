import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { env, resolveMemoryVaultPath } from '../config/env';
import { getDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { containsReal } from '../utils/path_containment';

const PROFILE_TYPES = {
  'AI-Trend-Researcher': 'ai-trends',
  'Theological-Researcher': 'theological',
} as const;

type CompletionArtifact = {
  role: 'canonical' | 'supporting';
  kind: 'structured' | 'full-text';
  vaultPath: string;
  sha256: string | null;
};

type CompletionSource = {
  canonicalUrl: string;
  originalUrl: string;
  captureStatus: 'complete' | 'partial' | 'failed';
  structuredVaultPath: string | null;
  fullTextVaultPath: string | null;
  structuredSha256: string | null;
  fullTextSha256: string | null;
  failure: { code: string; message: string } | null;
};

type ResearchPassCompletion = {
  jobId: string;
  runId: string;
  passId: string;
  artifacts: CompletionArtifact[];
  sources: CompletionSource[];
};

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap(strings);
  }
  return [];
}

function legacyUrls(parts: unknown[]): string[] {
  return [...new Set(strings(parts).flatMap((value) => value.match(/https?:\/\/[^\s)'"\]]+/g) ?? []))];
}

function legacyVaultPath(parts: unknown[]): string | null {
  return strings(parts).find((value) => /(?:^|\/)(?:Areas|Research|Reports)\/.*\.md$/i.test(value)) ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`malformed completion: ${key} is required`);
  }
  return value.trim();
}

function optionalHash(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`malformed completion: ${key} must be a SHA-256 hash`);
  }
  return value.toLowerCase();
}

export function canonicalizeResearchSourceUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('source URL must use http or https');
  }
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || ['fbclid', 'gclid'].includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url.toString().replace(/\/$/, url.pathname === '/' && !url.search ? '' : '/');
}

function validateVaultFile(vaultPath: string, expectedHash: string | null): string {
  if (path.isAbsolute(vaultPath) || vaultPath.split(/[\\/]/).includes('..')) {
    throw new Error(`path traversal rejected: ${vaultPath}`);
  }
  if (path.extname(vaultPath).toLowerCase() !== '.md') {
    throw new Error(`invalid artifact extension: ${vaultPath}`);
  }
  const root = resolveMemoryVaultPath();
  const absolute = path.resolve(root, vaultPath);
  if (!containsReal(root, absolute)) {
    throw new Error(`symlink escape rejected: ${vaultPath}`);
  }
  let contents: Buffer;
  try {
    if (!statSync(absolute).isFile()) throw new Error('not a file');
    contents = readFileSync(absolute);
  } catch {
    throw new Error(`artifact missing or unreadable: ${vaultPath}`);
  }
  const actualHash = createHash('sha256').update(contents).digest('hex');
  if (expectedHash && actualHash !== expectedHash) {
    throw new Error(`artifact hash mismatch: ${vaultPath}`);
  }
  return actualHash;
}

function parseArtifact(value: unknown): CompletionArtifact {
  const record = asRecord(value);
  if (!record) throw new Error('malformed completion: artifact must be an object');
  const role = requiredString(record, 'role');
  const kind = requiredString(record, 'kind');
  if (role !== 'canonical' && role !== 'supporting') {
    throw new Error(`malformed completion: unsupported artifact role ${role}`);
  }
  if (kind !== 'structured' && kind !== 'full-text') {
    throw new Error(`malformed completion: unsupported artifact kind ${kind}`);
  }
  const vaultPath = requiredString(record, 'vault_path');
  const suppliedHash = optionalHash(record, 'sha256');
  const sha256 = validateVaultFile(vaultPath, suppliedHash);
  return { role, kind, vaultPath, sha256 };
}

function optionalVaultFile(record: Record<string, unknown>, pathKey: string, hashKey: string): {
  vaultPath: string | null;
  sha256: string | null;
} {
  const value = record[pathKey];
  if (value === undefined) return { vaultPath: null, sha256: null };
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`malformed completion: ${pathKey} must be a path`);
  }
  const suppliedHash = optionalHash(record, hashKey);
  return { vaultPath: value.trim(), sha256: validateVaultFile(value.trim(), suppliedHash) };
}

function parseSource(value: unknown): CompletionSource {
  const record = asRecord(value);
  if (!record) throw new Error('malformed completion: source must be an object');
  const originalUrl = requiredString(record, 'url');
  const canonicalUrl = canonicalizeResearchSourceUrl(originalUrl);
  if (canonicalizeResearchSourceUrl(requiredString(record, 'canonical_url')) !== canonicalUrl) {
    throw new Error(`canonical URL mismatch: ${originalUrl}`);
  }
  const captureStatus = requiredString(record, 'capture_status');
  if (!['complete', 'partial', 'failed'].includes(captureStatus)) {
    throw new Error(`malformed completion: unsupported capture status ${captureStatus}`);
  }
  const structured = optionalVaultFile(record, 'structured_vault_path', 'structured_sha256');
  const fullText = optionalVaultFile(record, 'full_text_vault_path', 'full_text_sha256');
  const failureRecord = record.failure === undefined ? null : asRecord(record.failure);
  if (record.failure !== undefined && !failureRecord) {
    throw new Error('malformed completion: failure must be an object');
  }
  const failure = failureRecord
    ? { code: requiredString(failureRecord, 'code'), message: requiredString(failureRecord, 'message') }
    : null;
  return {
    canonicalUrl,
    originalUrl,
    captureStatus: captureStatus as CompletionSource['captureStatus'],
    structuredVaultPath: structured.vaultPath,
    fullTextVaultPath: fullText.vaultPath,
    structuredSha256: structured.sha256,
    fullTextSha256: fullText.sha256,
    failure,
  };
}

export function parseResearchPassCompletion(value: unknown): ResearchPassCompletion {
  const input = asRecord(value);
  if (!input || input.version !== 1) {
    throw new Error('malformed completion: version must be 1');
  }
  if (!Array.isArray(input.artifacts) || !Array.isArray(input.sources)) {
    throw new Error('malformed completion: artifacts and sources must be arrays');
  }
  return {
    jobId: requiredString(input, 'job_id'),
    runId: requiredString(input, 'run_id'),
    passId: requiredString(input, 'pass_id'),
    artifacts: input.artifacts.map(parseArtifact),
    sources: input.sources.map(parseSource),
  };
}

function parseResearchPassCompletionPartially(value: unknown): {
  completion: ResearchPassCompletion;
  issues: string[];
} {
  const input = asRecord(value);
  if (!input || input.version !== 1) {
    throw new Error('malformed completion: version must be 1');
  }
  if (!Array.isArray(input.artifacts) || !Array.isArray(input.sources)) {
    throw new Error('malformed completion: artifacts and sources must be arrays');
  }
  const issues: string[] = [];
  const artifacts = input.artifacts.flatMap((artifact) => {
    try {
      return [parseArtifact(artifact)];
    } catch (error) {
      issues.push(String(error));
      return [];
    }
  });
  const sources = input.sources.flatMap((source) => {
    try {
      return [parseSource(source)];
    } catch (error) {
      issues.push(String(error));
      return [];
    }
  });
  return {
    completion: {
      jobId: requiredString(input, 'job_id'),
      runId: requiredString(input, 'run_id'),
      passId: requiredString(input, 'pass_id'),
      artifacts,
      sources,
    },
    issues,
  };
}

function completionInputs(parts: unknown[]): unknown[] {
  return parts.flatMap((part) => {
    const record = asRecord(part);
    const state = asRecord(record?.state);
    return record?.type === 'tool' && record.tool === 'rhythm_complete_research_pass' && state?.status === 'completed'
      ? [state.input]
      : [];
  });
}

function stableId(kind: string, ...values: string[]): string {
  return createHash('sha256').update([kind, ...values].join('\0')).digest('hex');
}

function persistCompletion(
  jobId: string,
  projectId: string | null,
  projectRunId: string | null,
  completion: ResearchPassCompletion,
  now: string,
): void {
  const db = getDb();
  for (const artifact of completion.artifacts) {
    db.prepare(`
      INSERT INTO agent_research_artifacts
        (id, project_id, project_run_id, job_id, artifact_role, vault_path,
         content_hash, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content_hash=excluded.content_hash, metadata_json=excluded.metadata_json
    `).run(
      stableId('artifact', jobId, artifact.role, artifact.kind, artifact.vaultPath),
      projectId,
      projectRunId,
      jobId,
      artifact.role,
      artifact.vaultPath,
      artifact.sha256,
      JSON.stringify({ kind: artifact.kind, runId: completion.runId, passId: completion.passId }),
      now,
    );
  }
  for (const source of completion.sources) {
    db.prepare(`
      INSERT INTO agent_research_curated_sources
        (id, project_id, project_run_id, job_id, canonical_url, capture_status,
         structured_vault_path, full_text_vault_path, content_hash,
         metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        capture_status=excluded.capture_status,
        structured_vault_path=excluded.structured_vault_path,
        full_text_vault_path=excluded.full_text_vault_path,
        content_hash=excluded.content_hash,
        metadata_json=excluded.metadata_json
    `).run(
      stableId('source', jobId, source.canonicalUrl),
      projectId,
      projectRunId,
      jobId,
      source.canonicalUrl,
      source.captureStatus,
      source.structuredVaultPath,
      source.fullTextVaultPath,
      source.fullTextSha256 ?? source.structuredSha256,
      JSON.stringify({
        originalUrl: source.originalUrl,
        structuredSha256: source.structuredSha256,
        fullTextSha256: source.fullTextSha256,
        failure: source.failure,
        runId: completion.runId,
        passId: completion.passId,
      }),
      now,
    );
  }
}

/** Index actual scheduled/project research runs; safe to replay after idle/error events. */
export async function indexResearchSession(sessionId: string): Promise<void> {
  const session = new AgentSessionsRepository().findById(sessionId);
  if (!session) return;

  const messages = new AgentSessionMessagesRepository().listBySessionStructured(sessionId);
  const outputs = messages.filter((message) => message.role === 'output');
  const final = [...outputs].reverse().map((message) => message.rawText.trim()).find(Boolean) ?? '';
  const parts = outputs.flatMap((message) => message.parts ?? []);
  const rawCompletions = completionInputs(parts);
  const specialistType = PROFILE_TYPES[session.agentKind as keyof typeof PROFILE_TYPES];
  const projectCompletion = env.researchProjectsEnabled
    && String(session.agentKind) === 'research'
    && rawCompletions.length > 0;
  if (!specialistType && !projectCompletion) return;
  const researchType = specialistType ?? 'general';
  const isScheduled = session.category === 'scheduled' || session.scheduledTaskId !== null;

  if (rawCompletions.length === 0 && !isScheduled && session.status !== 'error') return;
  if (!final && session.status !== 'error' && rawCompletions.length === 0) return;

  let completion: ResearchPassCompletion | null = null;
  let classification: Record<string, unknown>;
  try {
    const unique = [...new Map(rawCompletions.map((value) => [JSON.stringify(value), value])).values()];
    if (unique.length > 1) throw new Error('invalid completion: conflicting duplicate payloads');
    const parsed = unique.length === 1
      ? parseResearchPassCompletionPartially(unique[0])
      : null;
    completion = parsed?.completion ?? null;
    classification = completion
      ? parsed!.issues.length > 0
        ? { status: 'invalid-partial', contractVersion: 1, errors: parsed!.issues }
        : { status: 'verified', contractVersion: 1 }
      : { status: 'legacy-unverified', reason: 'no completion contract evidence' };
  } catch (error) {
    classification = { status: 'invalid', error: String(error) };
  }

  const db = getDb();
  const existingBySession = db.prepare(
    'SELECT * FROM agent_research_jobs WHERE agent_session_id = ?',
  ).get(sessionId) as Record<string, unknown> | undefined;
  const existingByCompletionId = completion
    ? db.prepare('SELECT * FROM agent_research_jobs WHERE id = ?').get(completion.jobId) as Record<string, unknown> | undefined
    : undefined;
  if (existingByCompletionId) {
    const existingOwner = existingByCompletionId.requested_by_user_id as number | null;
    if (existingOwner !== null && existingOwner !== session.ownerUserId) {
      completion = null;
      classification = { status: 'invalid-owner', error: 'completion job is owned by another user' };
    }
  }

  const jobId = String(existingBySession?.id ?? existingByCompletionId?.id ?? completion?.jobId ?? randomUUID());
  const projectId = (existingBySession?.project_id ?? existingByCompletionId?.project_id ?? null) as string | null;
  const projectRunId = (existingBySession?.project_run_id ?? existingByCompletionId?.project_run_id ?? null) as string | null;
  const canonical = completion?.artifacts.find((artifact) => artifact.role === 'canonical') ?? null;
  const title = session.name.trim() || final.split('\n').find(Boolean)?.replace(/^#+\s*/, '').slice(0, 160) || 'Research report';
  const now = new Date().toISOString();
  const status = session.status === 'error' ? 'error' : 'done';
  const sourceUrls = completion?.sources.map((source) => source.canonicalUrl) ?? legacyUrls(parts);
  const report = final || null;
  const vaultPath = canonical?.vaultPath ?? (completion ? null : legacyVaultPath(parts));

  if (existingBySession || existingByCompletionId) {
    db.prepare(`
      UPDATE agent_research_jobs SET
        query=?, status=?, sources_json=?, report=?, error=?, agent_session_id=?,
        research_type=?, title=?, agent_profile_id=?, origin='specialist-run',
        vault_path=?, requested_by_user_id=COALESCE(requested_by_user_id, ?),
        project_run_id=COALESCE(project_run_id, ?), classification_json=?, updated_at=?
      WHERE id=?
    `).run(
      title, status, JSON.stringify(sourceUrls), report,
      status === 'error' ? session.statusMessage : null, sessionId, researchType,
      title, session.agentKind, vaultPath, session.ownerUserId, projectRunId,
      JSON.stringify(classification), now, jobId,
    );
  } else {
    db.prepare(`
      INSERT INTO agent_research_jobs
        (id, query, status, sources_json, report, error, agent_session_id,
         research_type, title, agent_profile_id, origin, vault_path,
         requested_by_user_id, project_id, project_run_id, classification_json,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'specialist-run', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      jobId, title, status, JSON.stringify(sourceUrls), report,
      status === 'error' ? session.statusMessage : null, sessionId, researchType,
      title, session.agentKind, vaultPath, session.ownerUserId, projectId,
      projectRunId, JSON.stringify(classification), now, now,
    );
  }

  if (completion) persistCompletion(jobId, projectId, projectRunId, completion, now);
}
