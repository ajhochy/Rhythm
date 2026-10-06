import { createHash } from 'node:crypto';
import { promises as fs, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { env, resolveMemoryDirPath } from '../config/env';
import { getDb } from '../database/db';
import type {
  DayflowActivityToolResponse,
  DayflowQualifiedEvidenceCandidate,
} from '../contracts/dayflow_coordinator_reader_contract';
import {
  dayflowCanonicalVersion,
  sameDayflowQualifiedEvidenceCandidate,
} from '../contracts/dayflow_coordinator_reader_contract';
import type {
  DayflowQualifiedEvidenceAdmission,
  DayflowQualifiedEvidenceAdmissionRead,
  DayflowQualifiedReadRequest,
} from '../integrations/dayflow/service';
import type { AuthContext } from '../middleware/auth_middleware';
import { AgentMemoryRepository, type AgentMemory } from '../repositories/agent_memory_repository';
import { scanContextContent } from '../security/context_scanner';
import {
  verifyTrustedMcpCall,
  type VerifiedTrustedMcpCall,
} from '../security/trusted_mcp_call';
import { untrustedContext } from '../security/untrusted_fence';
import { parseNote, vaultKeyToMemoryDirRelative } from './memoryVaultSyncService';
import { parseMemoryNote } from './memory_note_format';
import { resolveWithinMemoryDir } from './memoryVaultWriteService';

const MAX_FINAL_TEXT_BYTES = 3_800;
const SOURCE_LABEL = 'qualified Dayflow activity observations';
const SEARCH_TOOL = 'rhythm_search_dayflow_activity';
const RECENT_TOOL = 'rhythm_recent_dayflow_summaries';

export interface DayflowQualifiedReader {
  readQualifiedEvidence(input: DayflowQualifiedReadRequest): Promise<{
    schemaVersion: 1;
    status: 'available' | 'not_configured' | 'unavailable';
    candidates: DayflowQualifiedEvidenceCandidate[];
  }>;
  /** Server-only source admission; absence is closed, never a compatibility fallback. */
  readQualifiedEvidenceWithAdmission(input: DayflowQualifiedReadRequest): Promise<DayflowQualifiedEvidenceAdmissionRead>;
  /** Synchronous recomputation performed by the same producer that issued the token. */
  isQualifiedEvidenceAdmissionCurrent(
    input: DayflowQualifiedReadRequest,
    page: { schemaVersion: 1; status: 'available' | 'not_configured' | 'unavailable'; candidates: DayflowQualifiedEvidenceCandidate[]; references: DayflowQualifiedEvidenceCandidate['reference'][]; nextCursor: string | null },
    admission: DayflowQualifiedEvidenceAdmission,
  ): boolean;
  isReferenceWithinAutomaticWindow(reference: DayflowQualifiedEvidenceCandidate['reference']): boolean;
}

/**
 * An actual server composition must resolve this from a current authenticated
 * dispatch/session/turn and persist full V1 dependencies.  There is no local,
 * localhost, or tool-name-only fallback.
 */
export interface DayflowReceivingContextAuthority {
  resolve(auth: AuthContext, verified: VerifiedTrustedMcpCall, expectedToolName: string): Promise<DayflowReceivingContext | null>;
  isCurrent(context: DayflowReceivingContext, auth: AuthContext, verified: VerifiedTrustedMcpCall, expectedToolName: string): Promise<boolean>;
  /** The live engine check followed by the exact durable turn/manifest binding. */
  isCurrentWithDependencies(context: DayflowReceivingContext, auth: AuthContext, verified: VerifiedTrustedMcpCall, expectedToolName: string, expected: readonly DayflowQualifiedEvidenceCandidate[]): Promise<boolean>;
  /**
   * The synchronous durable half of final response admission. It must be
   * paired with a preceding live current-tool check; it is never a replacement
   * for that asynchronous engine proof.
   */
  finalAdmissionCurrent(context: DayflowReceivingContext, expected: readonly DayflowQualifiedEvidenceCandidate[]): boolean;
  appendDependencies(context: DayflowReceivingContext, references: DayflowQualifiedEvidenceCandidate[]): Promise<boolean>;
  markUnsafe(context: DayflowReceivingContext, reason: 'dayflow_dependency_persistence_failure' | 'dayflow_receiving_context_changed'): Promise<boolean>;
}

export interface DayflowReceivingContext {
  /** Durable dispatch identity supplied only by the real receiving authority. */
  dispatchId?: string;
  /** Private durable user-message binding supplied only by the receiving authority. */
  sdkUserMessageId?: string;
  ownerUserId: number;
  projectId: string;
  sdkSessionId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
}

export interface DayflowCanonicalEvidence {
  resolve(input: {
    ownerUserId: number;
    projectId: string;
    candidate: DayflowQualifiedEvidenceCandidate;
  }): Promise<{ content: string } | null>;
  /**
   * Optional synchronous re-proof that the exact canonical note/index row behind
   * a candidate is still current (no write, no repair). Absent = unknown
   * authority for retained history; the real resolver always provides it.
   */
  currentForCandidate?(input: { ownerUserId: number; projectId: string; candidate: DayflowQualifiedEvidenceCandidate }): boolean;
}

/**
 * Server-only canonical admission prepared by the real resolver for one resolved
 * result: the exact owner/source key/candidate, the matched owner index row and
 * the memory root. It never leaves the process and is not part of any DTO.
 */
interface CanonicalProof {
  ownerUserId: number;
  projectId: string;
  candidate: DayflowQualifiedEvidenceCandidate;
  indexId: string;
  memoryRoot: () => string;
}
const canonicalProofs = new WeakMap<object, CanonicalProof>();
/** Server-only V1 finalizers keyed by the exact response object; never serialized. */
const v1Finalizers = new WeakMap<object, () => DayflowActivityToolResponse>();

/**
 * 'unregistered' = the result did not come from the real resolver (legacy/injected
 * shape). With `strict` (the real resolver is composed) an unregistered result is stale.
 */
function canonicalProofState(result: object, strict = false): 'current' | 'stale' | 'unregistered' {
  const proof = canonicalProofs.get(result);
  if (!proof) return strict ? 'stale' : 'unregistered';
  return canonicalCurrentSync(proof.ownerUserId, proof.projectId, proof.candidate, proof.memoryRoot, proof.indexId) ? 'current' : 'stale';
}

/**
 * Synchronous, bounded, read-only canonical proof: the confined regular file is
 * still readable with the exact byte hash and passes every note rule, and the
 * owner index has exactly one current active row with that source key (and, when
 * given, that row id) whose content matches. Unknown backend/authority = false.
 */
function canonicalCurrentSync(
  ownerUserId: number,
  projectId: string,
  candidate: DayflowQualifiedEvidenceCandidate,
  memoryRoot: () => string,
  indexId?: string,
): boolean {
  try {
    if (env.dbClient !== 'sqlite') return false;
    const { reference, canonicalSourceKey } = candidate;
    if (
      reference.ownerUserId !== ownerUserId || reference.projectId !== projectId ||
      reference.eligibility !== 'active' || Date.parse(reference.expiresAt) <= Date.now() ||
      reference.canonicalVersion !== dayflowCanonicalVersion(candidate.canonicalContentHash)
    ) return false;
    const raw = readCanonicalMemoryBytesSync(memoryRoot, canonicalSourceKey);
    const accepted = raw ? acceptCanonicalNote(raw, candidate) : null;
    if (!accepted) return false;
    const rows = getDb().prepare(
      `SELECT id, content, source, source_id, status, stale_after, owner_user_id
       FROM agent_memory WHERE source = ? AND source_id = ? AND owner_user_id = ?`,
    ).all('obsidian-memory', canonicalSourceKey, ownerUserId) as Array<{
      id: string; content: string; source: string; source_id: string; status: string | null;
      stale_after: string | null; owner_user_id: number | null;
    }>;
    const today = new Date().toISOString().slice(0, 10);
    const owned = rows.filter((row) => row.status !== 'deprecated' && (row.stale_after === null || row.stale_after >= today));
    return owned.length === 1 && (indexId === undefined || owned[0].id === indexId) &&
      sameNormalizedContent(accepted.content, owned[0].content);
  } catch { return false; }
}

/** The immutable note rules shared by the async resolver and the sync final proof. */
function acceptCanonicalNote(raw: Buffer, candidate: DayflowQualifiedEvidenceCandidate): { content: string } | null {
  const { reference } = candidate;
  if (createHash('sha256').update(raw).digest('hex') !== candidate.canonicalContentHash) return null;
  let parsed;
  let document;
  try {
    document = parseMemoryNote(raw.toString('utf8'));
    parsed = parseNote(raw.toString('utf8'));
  } catch { return null; }
  if (
    document.frontmatter.id !== reference.canonicalId ||
    parsed.kind !== 'context' ||
    parsed.status === 'deprecated' ||
    (parsed.staleAfter !== undefined && parsed.staleAfter < new Date().toISOString().slice(0, 10)) ||
    createHash('sha256').update(parsed.content).digest('hex') !== candidate.contentHash ||
    !parsed.tags.includes('dayflow') ||
    !parsed.tags.includes('activity-observation') ||
    !hasMatchingDayflowSource(parsed.sources ?? [], reference)
  ) return null;
  return { content: parsed.content };
}

/**
 * Mandatory native enrollment, shared by EVERY Dayflow body producer (V1 signed
 * search/recent and the V2 automatic overlay). `ensure` resolves true only
 * after the owned engine durably recorded the SDK as guarded; any other
 * outcome means no dependent body may be released.
 */
export interface DayflowGuardEnrollment {
  ensure(input: { sdkSessionId: string }): Promise<boolean>;
}

interface DayflowQualifiedEvidenceDependencies {
  reader: DayflowQualifiedReader;
  receiver: DayflowReceivingContextAuthority;
  canonical?: DayflowCanonicalEvidence;
  verify?: typeof verifyTrustedMcpCall;
  /** Production composition always supplies it; absence is only a legacy/test shape that withholds registration coverage. */
  enrollment?: DayflowGuardEnrollment;
}

/** What the provider-admission caller supplies around one automatic overlay read. */
export interface DayflowAutomaticOverlayInput {
  ownerUserId: number;
  projectId: string;
  /** Awaited once, before anything is persisted or released (the native enrollment). */
  beforeBody(): Promise<boolean>;
  /** Durable V2 exposure write. Must succeed before text can return. */
  persist(candidates: DayflowQualifiedEvidenceCandidate[]): boolean;
  /** Awaited live proof of the exact pending frame and receiver. */
  liveCurrent(candidates: DayflowQualifiedEvidenceCandidate[]): Promise<boolean>;
  /** Synchronous durable proof, run after the last await. */
  finalCurrent(candidates: DayflowQualifiedEvidenceCandidate[]): boolean;
}

export type DayflowAutomaticOverlayResult =
  | {
    state: 'overlay'; text: string; candidates: DayflowQualifiedEvidenceCandidate[];
    /**
     * Server-only synchronous finalizer: re-proves the prepared source admission
     * and each selected note's canonical file/index, keeps only candidates that
     * `stillQualified` accepts, and rebuilds the fenced/scanned bounded body.
     * Null = nothing may be exposed. Call it after the last await before responding.
     */
    finalize(stillQualified: (candidate: DayflowQualifiedEvidenceCandidate) => boolean): { text: string; candidates: DayflowQualifiedEvidenceCandidate[] } | null;
  }
  | { state: 'none' }
  | { state: 'hold'; reason: 'proof_unavailable' | 'source_changed' | 'bounds_exceeded' };

/**
 * Dayflow-specific canonical reader.  It intentionally bypasses neither the
 * ledger receipt nor owner-scoped canonical index.  Generic memory search and
 * WorkstreamArtifactAuthorityResolver are not fallbacks: both have different
 * contracts and the latter expressly rejects Dayflow selectors.
 */
export class DayflowCanonicalEvidenceResolver implements DayflowCanonicalEvidence {
  private readonly memory: Pick<AgentMemoryRepository, 'findBySourceIdsAsync'> &
    Partial<Pick<AgentMemoryRepository, 'claimOwnerForSourceIfNull'>>;
  private readonly claimOwner?: (source: string, sourceId: string, ownerUserId: number) => Promise<boolean>;
  private readonly memoryRoot: () => string;

  constructor(options: {
    memory?: Pick<AgentMemoryRepository, 'findBySourceIdsAsync'> &
      Partial<Pick<AgentMemoryRepository, 'claimOwnerForSourceIfNull'>>;
    claimOwner?: (source: string, sourceId: string, ownerUserId: number) => Promise<boolean>;
    memoryRoot?: () => string;
  } = {}) {
    this.memory = options.memory ?? new AgentMemoryRepository();
    this.claimOwner = options.claimOwner ?? this.memory.claimOwnerForSourceIfNull?.bind(this.memory);
    this.memoryRoot = options.memoryRoot ?? resolveMemoryDirPath;
  }

  async resolve(input: {
    ownerUserId: number;
    projectId: string;
    candidate: DayflowQualifiedEvidenceCandidate;
  }): Promise<{ content: string } | null> {
    const { reference, canonicalSourceKey } = input.candidate;
    if (
      reference.ownerUserId !== input.ownerUserId ||
      reference.projectId !== input.projectId ||
      reference.eligibility !== 'active' ||
      Date.parse(reference.expiresAt) <= Date.now() ||
      reference.canonicalVersion !== dayflowCanonicalVersion(input.candidate.canonicalContentHash)
    ) return null;
    let sameSource: AgentMemory[];
    try {
      sameSource = await this.memory.findBySourceIdsAsync('obsidian-memory', [canonicalSourceKey], input.ownerUserId);
    } catch { return null; }
    let owned = sameSource.filter((memory) =>
      canonicalMemoryMatches(memory, input.ownerUserId, canonicalSourceKey),
    );
    const canRepairOwner = owned.length === 0 && sameSource.length === 1 &&
      sameSource[0].ownerUserId === null && !!this.claimOwner;
    if (owned.length !== 1 && !canRepairOwner) return null;

    const raw = await readCanonicalMemoryBytes(this.memoryRoot, canonicalSourceKey);
    const parsed = raw ? acceptCanonicalNote(raw, input.candidate) : null;
    if (!parsed) return null;
    if (canRepairOwner) {
      // A null owner is not authority. It may only be repaired after every
      // immutable receipt/content check above has bound this exact note to the
      // already-authorized candidate; a foreign owner is never overwritten.
      if (!(await this.claimOwner!('obsidian-memory', canonicalSourceKey, input.ownerUserId))) return null;
      try {
        sameSource = await this.memory.findBySourceIdsAsync('obsidian-memory', [canonicalSourceKey], input.ownerUserId);
      } catch { return null; }
      owned = sameSource.filter((memory) => canonicalMemoryMatches(memory, input.ownerUserId, canonicalSourceKey));
    }
    if (owned.length !== 1 || !sameNormalizedContent(parsed.content, owned[0].content)) return null;
    const result = { content: parsed.content };
    canonicalProofs.set(result, {
      ownerUserId: input.ownerUserId, projectId: input.projectId, candidate: input.candidate,
      indexId: owned[0].id, memoryRoot: this.memoryRoot,
    });
    return result;
  }

  currentForCandidate(input: { ownerUserId: number; projectId: string; candidate: DayflowQualifiedEvidenceCandidate }): boolean {
    return canonicalCurrentSync(input.ownerUserId, input.projectId, input.candidate, this.memoryRoot);
  }
}

export class DayflowQualifiedEvidenceService {
  private readonly canonical: DayflowCanonicalEvidence;
  private readonly verify: typeof verifyTrustedMcpCall;

  constructor(private readonly dependencies: DayflowQualifiedEvidenceDependencies) {
    this.canonical = dependencies.canonical ?? new DayflowCanonicalEvidenceResolver();
    this.verify = dependencies.verify ?? verifyTrustedMcpCall;
  }

  /** True only when native enrollment precedes every V1 body this service can release. */
  get enrollmentBeforeBody(): boolean {
    return this.dependencies.enrollment !== undefined;
  }

  search(auth: AuthContext, body: unknown): Promise<DayflowActivityToolResponse> {
    return this.read(auth, body, 'search');
  }

  /**
   * The V2 automatic recent-context overlay for one actual native user
   * message. It is the same qualified reader, canonical resolver, scanner and
   * fence as the V1 bodies (≤5 references, ≤3,800 bytes). Order is fixed:
   * enrollment → durable exposure persistence → source re-read → live receiver
   * proof → final synchronous source + receiver proofs → text construction.
   * An unresolvable (deleted/revoked) canonical note is excluded and the valid
   * remainder is kept; nothing is persisted unless something can be released.
   */
  /** Synchronous canonical re-proof of a retained candidate; true when the resolver cannot say (legacy shape). */
  canonicalCandidateCurrent(input: { ownerUserId: number; projectId: string; candidate: DayflowQualifiedEvidenceCandidate }): boolean {
    return this.canonical.currentForCandidate ? this.canonical.currentForCandidate(input) : true;
  }

  async readAutomaticOverlay(input: DayflowAutomaticOverlayInput): Promise<DayflowAutomaticOverlayResult> {
    const scope = { ownerUserId: input.ownerUserId, projectId: input.projectId } as DayflowReceivingContext;
    const initial = await this.prepareAdmission(scope, []);
    if (initial.state !== 'prepared') return { state: 'none' };
    let current = false;
    try { current = this.dependencies.reader.isQualifiedEvidenceAdmissionCurrent(initial.input, initial.page, initial.admission); }
    catch { /* none below */ }
    if (!current || initial.page.status !== 'available') return { state: 'none' };

    const selected: Array<DayflowQualifiedEvidenceCandidate & { content: string }> = [];
    const resolved: object[] = []; // the resolver results (carry the server-only canonical proof), index-aligned
    for (const candidate of initial.page.candidates) {
      if (!this.dependencies.reader.isReferenceWithinAutomaticWindow(candidate.reference)) continue;
      const evidence = await this.canonical.resolve({ ownerUserId: input.ownerUserId, projectId: input.projectId, candidate });
      if (!(await this.candidateStillQualified(scope, candidate))) return { state: 'none' };
      if (!evidence) continue; // deleted/revoked canonical evidence is excluded, not fatal
      selected.push({ ...candidate, content: evidence.content });
      resolved.push(evidence);
      if (selected.length === 5) break;
    }
    if (selected.length === 0) return { state: 'none' };

    const dependencies = selected.map(({ content: _content, ...candidate }) => candidate);
    // Enrollment is awaited BEFORE the exposure is written or any text exists.
    if (!(await input.beforeBody())) return { state: 'hold', reason: 'proof_unavailable' };
    if (!(await this.readerStillAvailable(scope, dependencies))) return { state: 'hold', reason: 'source_changed' };
    if (!input.persist(dependencies)) return { state: 'hold', reason: 'proof_unavailable' };

    const final = await this.prepareAdmission(scope, dependencies);
    if (final.state !== 'prepared') return { state: 'hold', reason: 'source_changed' };
    let preflight = false;
    try { preflight = this.dependencies.reader.isQualifiedEvidenceAdmissionCurrent(final.input, final.page, final.admission); }
    catch { /* hold below */ }
    if (!preflight) return { state: 'hold', reason: 'source_changed' };
    const live = await input.liveCurrent(dependencies);
    // No await from here to the text: source and durable receiver are re-proved synchronously.
    let sourceCurrent = false;
    try { sourceCurrent = this.dependencies.reader.isQualifiedEvidenceAdmissionCurrent(final.input, final.page, final.admission); }
    catch { /* hold below */ }
    let receiverCurrent = false;
    try { receiverCurrent = input.finalCurrent(dependencies); } catch { /* hold below */ }
    if (!live || !sourceCurrent) return { state: 'hold', reason: live ? 'source_changed' : 'proof_unavailable' };
    if (!receiverCurrent) return { state: 'hold', reason: 'proof_unavailable' };
    const raw = formatEvidence(selected);
    if (scanContextContent(raw, SOURCE_LABEL).blocked) return { state: 'none' };
    const text = untrustedContext(raw, SOURCE_LABEL);
    if (Buffer.byteLength(text, 'utf8') > MAX_FINAL_TEXT_BYTES) return { state: 'hold', reason: 'bounds_exceeded' };
    const reader = this.dependencies.reader;
    const strictProof = this.canonical instanceof DayflowCanonicalEvidenceResolver;
    return {
      state: 'overlay', text, candidates: dependencies,
      finalize: (stillQualified) => {
        let sourceCurrent = false;
        try { sourceCurrent = reader.isQualifiedEvidenceAdmissionCurrent(final.input, final.page, final.admission); } catch { /* closed */ }
        if (!sourceCurrent) return null;
        const live = selected.filter((item, index) =>
          canonicalProofState(resolved[index], strictProof) !== 'stale' && stillQualified(dependencies[index]));
        if (live.length === 0) return null;
        const rebuilt = formatEvidence(live);
        if (scanContextContent(rebuilt, SOURCE_LABEL).blocked) return null;
        const body = untrustedContext(rebuilt, SOURCE_LABEL);
        if (Buffer.byteLength(body, 'utf8') > MAX_FINAL_TEXT_BYTES) return null;
        return { text: body, candidates: live.map((item) => dependencies[selected.indexOf(item)]) };
      },
    };
  }

  recentSummaries(auth: AuthContext, body: unknown): Promise<DayflowActivityToolResponse> {
    return this.read(auth, body, 'recent');
  }

  private async read(
    auth: AuthContext,
    body: unknown,
    mode: 'search' | 'recent',
  ): Promise<DayflowActivityToolResponse> {
    const expectedToolName = mode === 'search' ? SEARCH_TOOL : RECENT_TOOL;
    const request = await this.authenticate(body, expectedToolName, mode);
    if (!request || !validAuth(auth)) return unavailable();
    const context = await this.resolveContext(auth, request.verified, expectedToolName);
    if (!context) return unavailable();
    if (!(await this.current(context, auth, request.verified, expectedToolName))) return this.markChanged(context);

    const initial = await this.prepareAdmission(context, []);
    if (initial.state !== 'prepared') return unavailable();
    let initialPreflightSourceCurrent = false;
    try {
      initialPreflightSourceCurrent = this.dependencies.reader.isQualifiedEvidenceAdmissionCurrent(
        initial.input, initial.page, initial.admission,
      );
    } catch { /* closed below */ }
    if (!initialPreflightSourceCurrent) return unavailable();
    const initialLiveReceiverCurrent = await this.currentWithDependencies(
      context, auth, request.verified, expectedToolName, [],
    );
    // This is response construction, not a cached helper result: both
    // authorities are recomputed synchronously after the last await.
    let initialSourceCurrent = false;
    try {
      initialSourceCurrent = this.dependencies.reader.isQualifiedEvidenceAdmissionCurrent(
        initial.input, initial.page, initial.admission,
      );
    } catch { /* closed below */ }
    let initialReceiverCurrent = false;
    try {
      initialReceiverCurrent = this.dependencies.receiver.finalAdmissionCurrent(context, []);
    } catch { /* closed below */ }
    if (!initialSourceCurrent) return unavailable();
    if (!initialLiveReceiverCurrent || !initialReceiverCurrent) return this.markChanged(context);
    const page = initial.page;
    if (page.status === 'not_configured') return notConfigured();
    if (page.status !== 'available') return unavailable();

    const selected: Array<DayflowQualifiedEvidenceCandidate & { content: string }> = [];
    const resolved: object[] = [];
    for (const candidate of page.candidates) {
      if (mode === 'recent' && !this.dependencies.reader.isReferenceWithinAutomaticWindow(candidate.reference)) continue;
      const evidence = await this.canonical.resolve({ ownerUserId: context.ownerUserId, projectId: context.projectId, candidate });
      if (!(await this.candidateStillQualified(context, candidate))) return unavailable();
      if (!(await this.current(context, auth, request.verified, expectedToolName))) return this.markChanged(context);
      if (!(await this.candidateStillQualified(context, candidate))) return unavailable();
      if (!evidence) return unavailable();
      if (mode === 'search' && !matchesQuery(evidence.content, request.query!)) continue;
      selected.push({ ...candidate, content: evidence.content });
      resolved.push(evidence);
      if (selected.length === request.limit) break;
    }
    if (selected.length === 0) {
      const final = await this.prepareAdmission(context, []);
      if (final.state !== 'prepared') return unavailable();
      let finalPreflightSourceCurrent = false;
      try {
        finalPreflightSourceCurrent = this.dependencies.reader.isQualifiedEvidenceAdmissionCurrent(
          final.input, final.page, final.admission,
        );
      } catch { /* closed below */ }
      if (!finalPreflightSourceCurrent) return unavailable();
      const finalLiveReceiverCurrent = await this.currentWithDependencies(
        context, auth, request.verified, expectedToolName, [],
      );
      let finalSourceCurrent = false;
      try {
        finalSourceCurrent = this.dependencies.reader.isQualifiedEvidenceAdmissionCurrent(
          final.input, final.page, final.admission,
        );
      } catch { /* closed below */ }
      let finalReceiverCurrent = false;
      try {
        finalReceiverCurrent = this.dependencies.receiver.finalAdmissionCurrent(context, []);
      } catch { /* closed below */ }
      if (!finalSourceCurrent) return unavailable();
      if (!finalLiveReceiverCurrent || !finalReceiverCurrent) return this.markChanged(context);
      return available(mode === 'search'
        ? 'No qualified activity matched this search.'
        : 'No qualified recent activity is available.');
    }

    const dependencies = selected.map(({ content: _content, ...candidate }) => candidate);
    // Even a scanner-blocked warning is a dependent tool exposure about this
    // exact selected evidence. Persist its complete private dependency set
    // first so a retained receiving context cannot later reuse it unchecked.
    // The owned engine must durably record this SDK as guarded BEFORE any
    // dependency is written or any body text is built; a failure releases
    // nothing. The rechecks below re-prove the receiver after this await.
    if (this.dependencies.enrollment &&
        !(await this.dependencies.enrollment.ensure({ sdkSessionId: context.sdkSessionId }))) return unavailable();
    if (!(await this.readerStillAvailable(context, dependencies))) return unavailable();
    if (!(await this.current(context, auth, request.verified, expectedToolName))) return this.markChanged(context);
    if (!(await this.readerStillAvailable(context, dependencies))) return unavailable();
    if ((await this.persistDependencies(context, dependencies)) !== 'persisted') return unavailable();
    // The source preflight happens before the final live receiver await. Both
    // current source/reference/consent and exact durable receiving state are
    // then recomputed in this response frame after that await. No await follows
    // the two final synchronous proofs before scanner or text construction.
    const final = await this.prepareAdmission(context, dependencies);
    if (final.state !== 'prepared') return this.markChanged(context);
    let finalPreflightSourceCurrent = false;
    try {
      finalPreflightSourceCurrent = this.dependencies.reader.isQualifiedEvidenceAdmissionCurrent(
        final.input, final.page, final.admission,
      );
    } catch { /* closed below */ }
    if (!finalPreflightSourceCurrent) return this.markChanged(context);
    const finalLiveReceiverCurrent = await this.currentWithDependencies(
      context, auth, request.verified, expectedToolName, dependencies,
    );
    let finalSourceCurrent = false;
    try {
      finalSourceCurrent = this.dependencies.reader.isQualifiedEvidenceAdmissionCurrent(
        final.input, final.page, final.admission,
      );
    } catch { /* closed below */ }
    let finalReceiverCurrent = false;
    try {
      finalReceiverCurrent = this.dependencies.receiver.finalAdmissionCurrent(context, dependencies);
    } catch { /* closed below */ }
    if (!finalLiveReceiverCurrent || !finalSourceCurrent || !finalReceiverCurrent) return this.markChanged(context);
    // Server-only synchronous finalizer for this result. It runs now (no await
    // since the final proofs) and AGAIN from the route after its own await,
    // immediately before serialization. It re-proves the prepared source
    // admission, the durable receiver/dependencies and each selected note's real
    // canonical file + owner-index row, then rebuilds the fenced/scanned bounded
    // body from the still-current partials. Stale/unknown proof = no body. The
    // actual asynchronous engine current-tool check stays above, paired with
    // these durable checks; nothing here widens any permission.
    const strict = this.canonical instanceof DayflowCanonicalEvidenceResolver;
    const reader = this.dependencies.reader;
    const receiver = this.dependencies.receiver;
    const query = mode === 'search' ? request.query : undefined;
    const build = (): DayflowActivityToolResponse => {
      const exposed = selected.filter((_item, index) => canonicalProofState(resolved[index], strict) !== 'stale');
      if (exposed.length === 0) return unavailable();
      const raw = formatEvidence(exposed, query);
      if (scanContextContent(raw, SOURCE_LABEL).blocked) {
        return { schemaVersion: 1, status: 'available', text: 'Qualified activity was withheld by the content safety scanner.', blocked: true };
      }
      const text = untrustedContext(raw, SOURCE_LABEL);
      if (Buffer.byteLength(text, 'utf8') > MAX_FINAL_TEXT_BYTES) return unavailable();
      return { schemaVersion: 1, status: 'available', text, blocked: false };
    };
    const finalize = (): DayflowActivityToolResponse => {
      let sourceCurrent = false;
      try { sourceCurrent = reader.isQualifiedEvidenceAdmissionCurrent(final.input, final.page, final.admission); } catch { /* closed */ }
      let receiverCurrent = false;
      try { receiverCurrent = receiver.finalAdmissionCurrent(context, dependencies); } catch { /* closed */ }
      // Known limit: source-page partials are all-or-nothing (the admission fingerprint has no per-candidate subset proof).
      return sourceCurrent && receiverCurrent ? build() : unavailable();
    };
    // The immediate response rests on the source/receiver proofs computed just
    // above (no await since); only the canonical proofs are recomputed by build().
    const response = build();
    v1Finalizers.set(response, finalize);
    return response;
  }

  /**
   * Server-only: re-run a V1 result's synchronous finalizer after the caller's
   * own await. A response that was not produced with a body carries no
   * finalizer and is returned unchanged; it is never caller-supplied authority.
   */
  finalizeResponse(response: DayflowActivityToolResponse): DayflowActivityToolResponse {
    const finalize = v1Finalizers.get(response);
    if (!finalize) return response;
    try { return finalize(); } catch { return unavailable(); }
  }

  private async authenticate(
    body: unknown,
    expectedToolName: string,
    mode: 'search' | 'recent',
  ): Promise<{ verified: VerifiedTrustedMcpCall; query?: string; limit: number } | null> {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body as Record<string, unknown>).length !== 1 || !Object.prototype.hasOwnProperty.call(body, 'trustedCall')) return null;
    let verified: VerifiedTrustedMcpCall;
    try { verified = await this.verify((body as Record<string, unknown>).trustedCall, expectedToolName); }
    catch { return null; }
    const args = verified.arguments;
    const allowed = mode === 'search' ? ['q', 'limit'] : ['limit'];
    if (Object.keys(args).some((key) => !allowed.includes(key))) return null;
    const limit = args.limit === undefined ? 5 : args.limit;
    if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 5) return null;
    if (mode === 'search') {
      if (typeof args.q !== 'string' || args.q.length === 0 || args.q.length > 500) return null;
      return { verified, query: args.q, limit: limit as number };
    }
    return { verified, limit: limit as number };
  }

  private async resolveContext(
    auth: AuthContext,
    verified: VerifiedTrustedMcpCall,
    expectedToolName: string,
  ): Promise<DayflowReceivingContext | null> {
    try {
      const context = await this.dependencies.receiver.resolve(auth, verified, expectedToolName);
      if (!context || !sameContext(context, auth, verified, expectedToolName)) return null;
      return context;
    } catch { return null; }
  }

  private async current(
    context: DayflowReceivingContext,
    auth: AuthContext,
    verified: VerifiedTrustedMcpCall,
    expectedToolName: string,
  ): Promise<boolean> {
    try {
      return sameContext(context, auth, verified, expectedToolName) &&
        await this.dependencies.receiver.isCurrent(context, auth, verified, expectedToolName);
    } catch { return false; }
  }

  private async currentWithDependencies(
    context: DayflowReceivingContext,
    auth: AuthContext,
    verified: VerifiedTrustedMcpCall,
    expectedToolName: string,
    expected: readonly DayflowQualifiedEvidenceCandidate[],
  ): Promise<boolean> {
    try {
      return sameContext(context, auth, verified, expectedToolName) &&
        await this.dependencies.receiver.isCurrentWithDependencies(
          context, auth, verified, expectedToolName, expected,
        );
    } catch { return false; }
  }

  /**
   * Read a server-only producer admission token without treating it as a
   * response lease. The consuming read() performs the source preflight, its
   * final live receiver await, and both final synchronous proofs itself so
   * there is no helper-to-caller admission handoff.
   */
  private async prepareAdmission(
    context: DayflowReceivingContext,
    expected: readonly DayflowQualifiedEvidenceCandidate[],
  ): Promise<
    | {
      state: 'prepared';
      input: DayflowQualifiedReadRequest;
      page: DayflowQualifiedEvidenceAdmissionRead['page'];
      admission: DayflowQualifiedEvidenceAdmission;
    }
    | { state: 'source_changed' }
  > {
    const input: DayflowQualifiedReadRequest = {
      ownerUserId: context.ownerUserId,
      projectId: context.projectId,
      limit: 3000,
    };
    let result: DayflowQualifiedEvidenceAdmissionRead;
    try { result = await this.dependencies.reader.readQualifiedEvidenceWithAdmission(input); }
    catch { return { state: 'source_changed' }; }
    if (!result.admission ||
        (result.page.status === 'available' && !expected.every((candidate) =>
          result.page.candidates.some((current) => sameDayflowQualifiedEvidenceCandidate(current, candidate))))) {
      return { state: 'source_changed' };
    }
    return { state: 'prepared', input, page: result.page, admission: result.admission };
  }

  private async persistDependencies(
    context: DayflowReceivingContext,
    references: DayflowQualifiedEvidenceCandidate[],
  ): Promise<'persisted' | 'unsafe' | 'unavailable'> {
    try {
      if (await this.dependencies.receiver.appendDependencies(context, references)) return 'persisted';
    } catch { /* sticky unsafe write below is the fail-closed recovery path */ }
    try {
      return await this.dependencies.receiver.markUnsafe(context, 'dayflow_dependency_persistence_failure')
        ? 'unsafe'
        : 'unavailable';
    } catch { return 'unavailable'; }
  }

  /** Re-read the authoritative producer rather than treating a fetched page
   * as a lease. This catches retraction, expiry, source replacement, consent,
   * and configuration changes while vault or dependency operations await. */
  private async readerStillAvailable(
    context: DayflowReceivingContext,
    expected: readonly DayflowQualifiedEvidenceCandidate[],
  ): Promise<boolean> {
    try {
      const page = await this.dependencies.reader.readQualifiedEvidence({
        ownerUserId: context.ownerUserId,
        projectId: context.projectId,
        limit: 3000,
      });
      return page.status === 'available' && expected.every((candidate) =>
        page.candidates.some((current) => sameDayflowQualifiedEvidenceCandidate(current, candidate)),
      );
    } catch { return false; }
  }

  private candidateStillQualified(
    context: DayflowReceivingContext,
    candidate: DayflowQualifiedEvidenceCandidate,
  ): Promise<boolean> {
    return this.readerStillAvailable(context, [candidate]);
  }

  private async markChanged(context: DayflowReceivingContext): Promise<DayflowActivityToolResponse> {
    try {
      if (await this.dependencies.receiver.markUnsafe(context, 'dayflow_receiving_context_changed')) return unavailable();
    } catch { /* both writes failing must refuse */ }
    return unavailable();
  }
}

function validAuth(auth: AuthContext): boolean {
  return typeof auth?.sessionToken === 'string' && auth.sessionToken.length > 0 &&
    Number.isSafeInteger(auth.user?.id) && auth.user.id > 0;
}

function sameContext(
  context: DayflowReceivingContext,
  auth: AuthContext,
  verified: VerifiedTrustedMcpCall,
  expectedToolName: string,
): boolean {
  return Number.isSafeInteger(context.ownerUserId) && context.ownerUserId === auth.user.id &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(context.projectId) &&
    context.sdkSessionId === verified.context.sdkSessionId &&
    context.turnId === verified.context.turnId &&
    context.toolCallId === verified.context.toolCallId &&
    context.toolName === expectedToolName;
}

function unavailable(): DayflowActivityToolResponse {
  return { schemaVersion: 1, status: 'unavailable', text: '', blocked: false };
}

function notConfigured(): DayflowActivityToolResponse {
  return { schemaVersion: 1, status: 'not_configured', text: '', blocked: false };
}

function available(text: string): DayflowActivityToolResponse {
  return { schemaVersion: 1, status: 'available', text, blocked: false };
}

function matchesQuery(content: string, query: string): boolean {
  return content.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function formatEvidence(
  selected: Array<DayflowQualifiedEvidenceCandidate & { content: string }>,
  query?: string,
): string {
  const header = 'Dayflow observation evidence only. It does not establish task completion.';
  const maxRawBytes = MAX_FINAL_TEXT_BYTES - Buffer.byteLength(untrustedContext('', SOURCE_LABEL), 'utf8');
  let result = header;
  for (const item of selected) {
    const section = `\n\nObservation (${item.reference.observedStart} to ${item.reference.observedEnd}):\n${excerpt(item.content, query)}`;
    if (Buffer.byteLength(result + section, 'utf8') <= maxRawBytes) {
      result += section;
      continue;
    }
    const remaining = maxRawBytes - Buffer.byteLength(result + '\n\nObservation:\n', 'utf8');
    if (remaining > 24) result += `\n\nObservation:\n${truncateUtf8(excerpt(item.content, query), remaining)}`;
    break;
  }
  return result;
}

function excerpt(content: string, query?: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!query) return truncateUtf8(normalized, 900);
  const index = normalized.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return truncateUtf8(normalized, 900);
  const start = Math.max(0, index - 280);
  const end = Math.min(normalized.length, index + query.length + 560);
  return `${start > 0 ? '…' : ''}${normalized.slice(start, end)}${end < normalized.length ? '…' : ''}`;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let output = '';
  for (const character of value) {
    if (Buffer.byteLength(output + character + '…', 'utf8') > maxBytes) break;
    output += character;
  }
  return `${output}…`;
}

function canonicalMemoryMatches(memory: AgentMemory, ownerUserId: number, canonicalSourceKey: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return memory.ownerUserId === ownerUserId &&
    memory.source === 'obsidian-memory' && memory.sourceId === canonicalSourceKey &&
    memory.status !== 'deprecated' && (memory.staleAfter === null || memory.staleAfter >= today);
}

function sameNormalizedContent(left: string, right: string): boolean {
  return left.replace(/\r\n/g, '\n').trim() === right.replace(/\r\n/g, '\n').trim();
}

function hasMatchingDayflowSource(
  sources: Array<Record<string, unknown>>,
  reference: Pick<DayflowQualifiedEvidenceCandidate['reference'], 'sourceHash' | 'exporterVersion' | 'normalizerVersion'>,
): boolean {
  // The existing create-only importer writes exportVersion into the immutable
  // normalizer_version field. A future independent normalizer needs an actual
  // canonical-import schema change; it must not be silently claimed here.
  if (reference.exporterVersion !== reference.normalizerVersion) return false;
  return sources.some((source) =>
    source.origin === 'dayflow' && source.revision === reference.sourceHash &&
    source.normalizer_version === reference.normalizerVersion,
  );
}

async function readCanonicalMemoryBytes(memoryRoot: () => string, sourceId: string): Promise<Buffer | null> {
  const rootPath = path.resolve(memoryRoot());
  try {
    const root = await fs.realpath(rootPath);
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory()) return null;
    const relative = vaultKeyToMemoryDirRelative(rootPath, sourceId);
    const candidate = resolveWithinMemoryDir(rootPath, relative);
    const before = await fs.lstat(candidate);
    if (!before.isFile() || (before.mode & 0o444) === 0) return null;
    const canonicalPath = await fs.realpath(candidate);
    if (!containedBy(root, canonicalPath)) return null;
    const raw = await fs.readFile(canonicalPath);
    const after = await fs.lstat(candidate);
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino) return null;
    return raw;
  } catch { return null; }
}

/** Same confinement as the async reader, synchronously; identity is re-checked after the read. */
function readCanonicalMemoryBytesSync(memoryRoot: () => string, sourceId: string): Buffer | null {
  const rootPath = path.resolve(memoryRoot());
  try {
    const root = realpathSync(rootPath);
    if (!lstatSync(root).isDirectory()) return null;
    const relative = vaultKeyToMemoryDirRelative(rootPath, sourceId);
    const candidate = resolveWithinMemoryDir(rootPath, relative);
    const before = lstatSync(candidate);
    if (!before.isFile() || (before.mode & 0o444) === 0) return null;
    const canonicalPath = realpathSync(candidate);
    if (!containedBy(root, canonicalPath)) return null;
    const raw = readFileSync(canonicalPath);
    const after = lstatSync(candidate);
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino) return null;
    return raw;
  } catch { return null; }
}

function containedBy(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
