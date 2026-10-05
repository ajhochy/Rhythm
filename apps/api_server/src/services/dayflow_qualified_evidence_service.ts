import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveMemoryDirPath } from '../config/env';
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
}

interface DayflowQualifiedEvidenceDependencies {
  reader: DayflowQualifiedReader;
  receiver: DayflowReceivingContextAuthority;
  canonical?: DayflowCanonicalEvidence;
  verify?: typeof verifyTrustedMcpCall;
}

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
    if (!raw || createHash('sha256').update(raw).digest('hex') !== input.candidate.canonicalContentHash) return null;
    let parsed;
    let document;
    try {
      document = parseMemoryNote(raw.toString('utf8'));
      parsed = parseNote(raw.toString('utf8'));
    }
    catch { return null; }
    if (
      document.frontmatter.id !== reference.canonicalId ||
      parsed.kind !== 'context' ||
      parsed.status === 'deprecated' ||
      (parsed.staleAfter !== undefined && parsed.staleAfter < new Date().toISOString().slice(0, 10)) ||
      createHash('sha256').update(parsed.content).digest('hex') !== input.candidate.contentHash ||
      !parsed.tags.includes('dayflow') ||
      !parsed.tags.includes('activity-observation') ||
      !hasMatchingDayflowSource(parsed.sources ?? [], reference)
    ) return null;
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
    return { content: parsed.content };
  }
}

export class DayflowQualifiedEvidenceService {
  private readonly canonical: DayflowCanonicalEvidence;
  private readonly verify: typeof verifyTrustedMcpCall;

  constructor(private readonly dependencies: DayflowQualifiedEvidenceDependencies) {
    this.canonical = dependencies.canonical ?? new DayflowCanonicalEvidenceResolver();
    this.verify = dependencies.verify ?? verifyTrustedMcpCall;
  }

  search(auth: AuthContext, body: unknown): Promise<DayflowActivityToolResponse> {
    return this.read(auth, body, 'search');
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
    for (const candidate of page.candidates) {
      if (mode === 'recent' && !this.dependencies.reader.isReferenceWithinAutomaticWindow(candidate.reference)) continue;
      const evidence = await this.canonical.resolve({ ownerUserId: context.ownerUserId, projectId: context.projectId, candidate });
      if (!(await this.candidateStillQualified(context, candidate))) return unavailable();
      if (!(await this.current(context, auth, request.verified, expectedToolName))) return this.markChanged(context);
      if (!(await this.candidateStillQualified(context, candidate))) return unavailable();
      if (!evidence) return unavailable();
      if (mode === 'search' && !matchesQuery(evidence.content, request.query!)) continue;
      selected.push({ ...candidate, content: evidence.content });
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
    const raw = formatEvidence(selected, mode === 'search' ? request.query : undefined);
    const scan = scanContextContent(raw, SOURCE_LABEL);
    if (scan.blocked) {
      return { schemaVersion: 1, status: 'available', text: 'Qualified activity was withheld by the content safety scanner.', blocked: true };
    }
    const text = untrustedContext(raw, SOURCE_LABEL);
    if (Buffer.byteLength(text, 'utf8') > MAX_FINAL_TEXT_BYTES) return unavailable();
    return { schemaVersion: 1, status: 'available', text, blocked: false };
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

function containedBy(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
