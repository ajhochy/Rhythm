/**
 * Shared source-test harness for the Dayflow provider-admission API (C2).
 *
 * REAL: the authenticated express router (`requireLocalOrCloudAuth`), the
 * provider admission service, the qualified-evidence service (scanner, fence,
 * persistence-before-body), the receiving-context repository and authority on a
 * fully migrated SQLite database, the coordinator conversation repository, the
 * model-provenance repository and the persisted source-consent authority
 * (config store + ledger on a temp dir).
 *
 * STAND-INS, disclosed (this is NOT live/cross-process proof):
 *  - `FrameEngine` plays the OWNED ENGINE's frozen C1 routes
 *    (`rhythm-provider-frame`, `rhythm-dayflow-guard`): pending / cancelled /
 *    replaced / not_pending frames and stored-order source proofs, with the
 *    same semantics as the frozen native registry. It reads no real engine.
 *  - `MutableReader` plays the qualified Dayflow reader (the existing tests'
 *    pattern: the admission token is a fingerprint of the current page).
 *  - the canonical note resolver returns synthetic text.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';

import {
  PROVIDER_ADMISSION_BOUNDS,
  canonicalJson,
  type ProviderAdmissionRequest,
  type ProviderPendingExport,
  type ProviderUnavailableExport,
} from '../../contracts/dayflow_provider_admission_contract';
import {
  dayflowCanonicalVersion,
  sameDayflowQualifiedEvidenceCandidate,
  type DayflowQualifiedEvidenceCandidate,
} from '../../contracts/dayflow_coordinator_reader_contract';
import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { DayflowConfigStore } from '../../integrations/dayflow/config_store';
import { freshDayflowConfig } from '../../integrations/dayflow/config_validation';
import { MemoryLedger } from '../../integrations/dayflow/ledger';
import { DayflowPersistedQualificationAuthority } from '../../integrations/dayflow/persisted_qualification_authority';
import { deriveDayflowQualificationBinding } from '../../integrations/dayflow/qualification_binding';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { CoordinatorConversationsRepository } from '../../repositories/coordinator_conversations_repository';
import { DayflowReceivingContextRepository } from '../../repositories/dayflow_receiving_context_repository';
import { ModelProvenanceRepository } from '../../repositories/model_provenance_repository';
import { SessionsRepository } from '../../repositories/sessions_repository';
import { createDayflowReferencesRouter } from '../../routes/dayflow_references_routes';
import {
  DayflowGuardEnrollmentService,
  DayflowReceivingContextAuthorityService,
} from '../../services/dayflow_receiving_context_authority';
import { DayflowProviderAdmissionService } from '../../services/dayflow_receiving_history_guard';
import {
  DayflowQualifiedEvidenceService,
  type DayflowQualifiedReader,
} from '../../services/dayflow_qualified_evidence_service';
import { startTestServer } from './real_server';

export const OWNER = 7;
export const PROJECT = 'project:1';
export const SDK = 'sdk:root';
export const ROOT = 'session:root';
export const AGENT = 'secretary';
export const USER_1 = 'msg_user_1';
export const OLD_USER = 'msg_old_user';
export const OLD_ASSISTANT = 'msg_old_assistant';
export const NOW = new Date('2026-10-06T12:00:00.000Z');
// C0 fixture request digests (answer / tool loop / compaction).
export const DIGEST_ANSWER = '11abea76bdb2c5a91f7dd77621034d01b5c7d40fc823755330fbb380aa12a1f6';
export const DIGEST_LOOP = '54717ff3ab0ad57939cf577f89c1dce2bfe69918afe8ab987458b02c475bda66';
export const DIGEST_COMPACTION = '76f67c601d13be2adbbd931bea6cac12704c57525b3f375ab1d58b7dcb370f11';

export function candidate(n = 1, over: Partial<DayflowQualifiedEvidenceCandidate['reference']> = {}): DayflowQualifiedEvidenceCandidate {
  const hash = String(n).repeat(64).slice(0, 64);
  return {
    reference: {
      schemaVersion: 1,
      namespace: 'namespace:1', sourceInstance: 'source:1', sourceId: `card:${n}`,
      exporterVersion: 'v2.6.0', normalizerVersion: 'v2.6.0', sourceRevision: `revision:${n}`,
      sourceHash: 'a'.repeat(64), canonicalId: `01H0000000000000000000000${n}`,
      canonicalVersion: dayflowCanonicalVersion(hash), ownerUserId: OWNER, projectId: PROJECT,
      consentGeneration: 'consent:1', configurationGeneration: 'config:1',
      observedStart: '2026-10-05T00:00:00.000Z', observedEnd: '2026-10-05T01:00:00.000Z',
      expiresAt: '2030-10-05T01:00:00.000Z', eligibility: 'active', ...over,
    },
    canonicalContentHash: hash,
    contentHash: String((n + 1) % 10).repeat(64).slice(0, 64),
    canonicalSourceKey: `memory/context/import-01h0000000000000000000000${n}.md`,
  };
}

let nonceCounter = 0;
export function nonce(): string {
  nonceCounter += 1;
  return `NONCE${String(nonceCounter).padStart(19, '0')}`;
}

export function request(over: Partial<ProviderAdmissionRequest> = {}): ProviderAdmissionRequest {
  return {
    schemaVersion: 1, sdkSessionId: SDK, userMessageId: USER_1, requestNonce: nonce(),
    engineGeneration: 'engine_fixture_1', runnerGeneration: 'runner_fixture_1', attempt: 0,
    purpose: 'answer', inputDigest: DIGEST_ANSWER, ...over,
  };
}

export class MutableReader implements DayflowQualifiedReader {
  candidates: DayflowQualifiedEvidenceCandidate[] = [candidate(1)];
  status: 'available' | 'not_configured' | 'unavailable' = 'available';
  window = true;
  reads = 0;
  onRead?: () => void;
  /**
   * Fires only inside the awaited retained-history read (the admission guard's last await).
   * An overlay admission reads the source three times: initial, post-persist, then this
   * retained-history read, so it is the 3rd `readQualifiedEvidence` call of one admit().
   */
  onHistoryRead?: () => void;
  static readonly HISTORY_READ_ORDINAL = 3;
  plainReads = 0;
  private fingerprint(): string {
    return canonicalJson({ status: this.status, candidates: this.candidates });
  }
  async readQualifiedEvidence() {
    this.reads += 1;
    this.onRead?.();
    this.plainReads += 1;
    if (this.plainReads === MutableReader.HISTORY_READ_ORDINAL) this.onHistoryRead?.();
    return { schemaVersion: 1 as const, status: this.status, candidates: [...this.candidates] };
  }
  async readQualifiedEvidenceWithAdmission() {
    this.reads += 1;
    this.onRead?.();
    return {
      page: {
        schemaVersion: 1 as const, status: this.status, candidates: [...this.candidates],
        references: this.status === 'available' ? this.candidates.map((item) => item.reference) : [], nextCursor: null,
      },
      admission: this.status === 'unavailable' ? null : { schemaVersion: 1 as const, fingerprint: this.fingerprint() },
    } as never;
  }
  isQualifiedEvidenceAdmissionCurrent(_input: unknown, _page: unknown, admission: { fingerprint?: string } | null): boolean {
    return !!admission && admission.fingerprint === this.fingerprint();
  }
  isReferenceWithinAutomaticWindow(): boolean { return this.window; }
}

export interface StoredFrame {
  request: ProviderAdmissionRequest;
  agentName: string;
  userKind: 'authored' | 'control';
  initiating: string | null;
  groupCount: number;
  coverage: 'complete' | 'ambiguous';
  status: 'pending' | 'cancelled' | 'replaced';
}

/** The owned engine's frozen C1 frame/enrollment routes, as a disclosed stand-in. */
export class FrameEngine {
  frames = new Map<string, StoredFrame>();
  /** Native stored message order; proofs are derived from it exactly like the frozen registry. */
  stored: string[] = [OLD_USER, OLD_ASSISTANT, USER_1];
  visible = new Set<string>([OLD_USER, OLD_ASSISTANT, USER_1]);
  events: string[] = [];
  frameFailure = false;
  enrollFailure = false;
  enrolled = new Set<string>();
  onFrame?: (nonce: string, anchors: readonly string[]) => void;
  onEnroll?: () => void;

  install(req: ProviderAdmissionRequest, over: Partial<Omit<StoredFrame, 'request'>> = {}): void {
    this.frames.set(req.requestNonce, {
      request: req, agentName: AGENT, userKind: 'authored', initiating: null, groupCount: 3,
      coverage: 'complete', status: 'pending', ...over,
    });
  }

  async getDayflowProviderFrame(
    sdkSessionId: string, requestNonce: string, _directory: string | undefined, anchors: readonly string[] = [],
  ): Promise<ProviderPendingExport | ProviderUnavailableExport | null> {
    this.events.push(`frame:${anchors.length}`);
    this.onFrame?.(requestNonce, anchors);
    if (this.frameFailure) return null;
    const frame = this.frames.get(requestNonce);
    if (!frame || frame.request.sdkSessionId !== sdkSessionId) return { schemaVersion: 1, status: 'not_pending' };
    if (frame.status !== 'pending') return { schemaVersion: 1, status: frame.status };
    const current = this.stored.indexOf(frame.request.userMessageId);
    return {
      schemaVersion: 1, status: 'pending', request: frame.request, agentName: frame.agentName,
      userKind: frame.userKind, initiatingUserMessageId: frame.initiating, inputGroupCount: frame.groupCount,
      originCoverage: frame.coverage,
      sourceProofs: anchors.map((anchor) => {
        const position = this.stored.indexOf(anchor);
        if (position < 0) return { sourceAnchorId: anchor, stored: false, visible: this.visible.has(anchor), relation: 'unknown' as const, derivedSummaryIds: [] };
        return {
          sourceAnchorId: anchor, stored: true, visible: this.visible.has(anchor),
          relation: current < 0 ? 'unknown' as const : position < current ? 'before_current' as const : position === current ? 'current' as const : 'after_current' as const,
          derivedSummaryIds: [],
        };
      }),
    };
  }

  async enrollDayflowGuard(sdkSessionId: string): Promise<{ engineGeneration: string } | null> {
    this.events.push('enroll');
    this.onEnroll?.();
    if (this.enrollFailure) return null;
    this.enrolled.add(sdkSessionId);
    return { engineGeneration: 'engine_fixture_1' };
  }
}

export function consentedAuthority(roots: string[]): {
  store: DayflowConfigStore; ledger: MemoryLedger; authority: DayflowPersistedQualificationAuthority;
  revoke(): void;
} {
  const root = mkdtempSync(join(tmpdir(), 'dayflow-provider-'));
  roots.push(root);
  const store = new DayflowConfigStore(join(root, 'config.json'));
  const ledger = new MemoryLedger(join(root, 'ownership-ledger.json'));
  const config = freshDayflowConfig();
  config.enabled = true;
  config.automaticImport = true;
  config.timezone = 'UTC';
  config.journalPath = '/private/tmp/dayflow.sqlite';
  config.journalBinding = { fileIdentity: '1:2', schemaFingerprint: 'd'.repeat(64) };
  const binding = deriveDayflowQualificationBinding(config)!;
  config.sourceConsent = {
    schemaVersion: 1, ownerUserId: OWNER, projectId: PROJECT, authorizingSessionId: ROOT,
    namespace: binding.namespace, sourceInstance: binding.sourceInstance,
    configurationGeneration: binding.configurationGeneration, consentGeneration: 'consent:1',
    grantedAt: '2026-10-05T00:00:00.000Z',
  };
  store.write(config);
  const authority = new DayflowPersistedQualificationAuthority(store, ledger, () => NOW.getTime());
  return {
    store, ledger, authority,
    revoke: () => {
      const changed = store.read();
      changed.sourceConsent = { ...changed.sourceConsent!, revokedAt: '2026-10-05T00:02:00.000Z' };
      store.write(changed);
    },
  };
}

export interface Harness {
  db: Database.Database;
  roots: string[];
  records: DayflowReceivingContextRepository;
  conversations: CoordinatorConversationsRepository;
  provenance: ModelProvenanceRepository;
  reader: MutableReader;
  engine: FrameEngine;
  consent: ReturnType<typeof consentedAuthority>;
  evidence: DayflowQualifiedEvidenceService;
  admission: DayflowProviderAdmissionService;
  resolved: string[];
  baseUrl: string;
  token: (userId?: number) => Promise<string>;
  post(body: unknown, token?: string): Promise<{ status: number; body: Record<string, any> }>;
  admit(over?: Partial<ProviderAdmissionRequest>, frame?: Partial<Omit<StoredFrame, 'request'>>, token?: string): Promise<{ status: number; body: Record<string, any>; req: ProviderAdmissionRequest }>;
  foregroundDispatch(userMessageId: string, outcome?: 'pending' | 'accepted'): string;
  makeSession(id: string, over?: Record<string, unknown>): void;
  designateRoot(): void;
  manifest(dispatchId?: string): Record<string, any> | null;
  close(): Promise<void>;
  previousDb: Database.Database | null;
}

export async function buildHarness(options: { enrollmentOnEvidence?: boolean } = {}): Promise<Harness> {
  const db = new Database(':memory:');
  runMigrations(db);
  db.pragma('foreign_keys = OFF');
  const previousDb = setDb(db);
  const roots: string[] = [];
  db.prepare(`INSERT INTO users (id, name, email) VALUES (?, 'Dayflow owner', 'owner@example.test')`).run(OWNER);
  db.prepare(`INSERT INTO users (id, name, email) VALUES (8, 'Other owner', 'other@example.test')`).run();
  db.prepare(`INSERT INTO projects (id, name, cwd, created_at) VALUES (?, 'Dayflow project', '/safe/project', ?)`).run(PROJECT, NOW.toISOString());
  db.prepare(`INSERT OR IGNORE INTO agent_configs (id, label, icon, command, enabled, is_agent)
    VALUES ('secretary', 'Secretary', 'x', 'synthetic', 1, 1)`).run();
  db.prepare(`UPDATE agent_configs SET oc_agent='secretary', model_provider='provider', model_id='model' WHERE id='secretary'`).run();

  const records = new DayflowReceivingContextRepository(db);
  const conversations = new CoordinatorConversationsRepository(db, () => NOW);
  const provenance = new ModelProvenanceRepository();
  const reader = new MutableReader();
  const engine = new FrameEngine();
  const consent = consentedAuthority(roots);
  const resolved: string[] = [];
  const enrollment = new DayflowGuardEnrollmentService({ engine: engine as never, records });
  const receiver = new DayflowReceivingContextAuthorityService({
    engine: {
      getCurrentTrustedMcpToolCall: async () => ({
        sdkSessionId: SDK, assistantId: 'msg_asst_1', userMessageId: USER_1, partId: 'part:1', toolCallId: 'call:1',
        toolKey: 'rhythm_search_dayflow_activity', agentName: AGENT, serverName: 'rhythm',
        toolName: 'rhythm_search_dayflow_activity',
      }),
    } as never,
    records,
  });
  const evidence = new DayflowQualifiedEvidenceService({
    reader,
    receiver,
    canonical: { resolve: async () => { resolved.push('resolve'); engine.events.push('resolve'); return { content: 'Synthetic useful handoff detail.' }; } },
    verify: async () => ({
      context: { sdkSessionId: SDK, turnId: 'msg_asst_1', agentName: AGENT, toolCallId: 'call:1' },
      arguments: { q: 'handoff', limit: 1 },
    }),
    ...(options.enrollmentOnEvidence === false ? {} : { enrollment }),
  });
  const admission = new DayflowProviderAdmissionService({
    records, engine: engine as never, reader, evidence, authority: consent.authority, enrollment,
  });

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/dayflow-agent', createDayflowReferencesRouter({ evidence, providerAdmission: admission }));
  const server = await startTestServer(app);
  const tokens = new Map<number, string>();
  const token = async (userId = OWNER) => {
    const existing = tokens.get(userId);
    if (existing) return existing;
    const session = await new SessionsRepository().createAsync(userId);
    tokens.set(userId, session.token);
    return session.token;
  };
  const harness: Harness = {
    db, roots, records, conversations, provenance, reader, engine, consent, evidence, admission, resolved,
    baseUrl: server.baseUrl, token, previousDb,
    async post(body, bearer) {
      const response = await fetch(`${server.baseUrl}/dayflow-agent/provider-admission`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer ?? await token()}` },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, any> };
    },
    async admit(over = {}, frame = {}, bearer) {
      const req = request(over);
      engine.install(req, frame);
      return { ...(await harness.post(req, bearer)), req };
    },
    foregroundDispatch(userMessageId, outcome = 'accepted') {
      const row = provenance.insert({
        sessionId: ROOT, sdkSessionId: SDK, sdkUserMessageId: userMessageId, origin: 'prompt_api',
        requestedSource: 'session', routeAuthed: true, reasonCode: 'c2_foreground',
        requestedProviderId: 'provider', requestedModelId: 'model', resolvedProviderId: 'provider',
        resolvedModelId: 'model', finalProviderId: 'provider', finalModelId: 'model',
      });
      provenance.setOutcome(row.id, outcome);
      return row.id;
    },
    makeSession(id, over = {}) {
      new AgentSessionsRepository().insert({ agentKind: 'secretary', taskId: null, cwd: '/safe/project', name: id, profileId: 'secretary' } as never);
      const created = db.prepare('SELECT id FROM agent_sessions ORDER BY rowid DESC LIMIT 1').get() as { id: string };
      db.prepare('UPDATE agent_sessions SET id=? WHERE id=?').run(id, created.id);
      const values: Record<string, unknown> = {
        owner_user_id: OWNER, project_id: PROJECT, status: 'idle', cwd: '/safe/project', ...over,
      };
      for (const [column, value] of Object.entries(values)) {
        db.prepare(`UPDATE agent_sessions SET ${column}=? WHERE id=?`).run(value, id);
      }
    },
    designateRoot() {
      const result = conversations.designatePrimaryOwnerRoot({ ownerUserId: OWNER, projectId: PROJECT, sessionId: ROOT });
      if (result.kind !== 'found') throw new Error(`root designation failed: ${result.kind}`);
    },
    manifest(dispatchId) {
      const row = db.prepare(`SELECT dayflow_context_manifest_json AS json, dayflow_context_sdk_turn_id AS turn,
        dayflow_context_schema_version AS version, dayflow_context_manifest_revision AS revision
        FROM agent_turn_dispatches WHERE ${dispatchId ? 'id=?' : 'sdk_user_message_id=?'}`).get(dispatchId ?? USER_1) as
        { json: string | null; turn: string | null; version: number | null; revision: number | null } | undefined;
      return row?.json ? { ...JSON.parse(row.json), _turn: row.turn, _version: row.version, _revision: row.revision } : null;
    },
    async close() {
      await server.close();
      for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
      setDb(previousDb as Database.Database);
      db.close();
    },
  };
  // The standard root: Secretary, owned, primary, bound to the engine SDK id.
  harness.makeSession(ROOT, { sdk_session_id: SDK, permission_mode: 'plan', model_mode: 'auto' });
  harness.designateRoot();
  harness.foregroundDispatch(USER_1);
  return harness;
}

export { PROVIDER_ADMISSION_BOUNDS, sameDayflowQualifiedEvidenceCandidate };
