import {
  sameDayflowQualifiedEvidenceCandidate,
  type DayflowQualifiedEvidenceCandidate,
} from '../contracts/dayflow_coordinator_reader_contract';
import {
  PROVIDER_ADMISSION_BOUNDS,
  canonicalJson,
  parseProviderAdmissionRequest,
  providerBasisDigest,
  sha256Hex,
  sameProviderRequest,
  validateProviderAdmissionResponse,
  type ProviderAdmissionRequest,
  type ProviderAdmissionResponse,
  type ProviderBasisMaterial,
  type ProviderPendingExport,
  type ProviderReason,
  type ProviderSourceProof,
} from '../contracts/dayflow_provider_admission_contract';
import { DayflowPersistedQualificationAuthority } from '../integrations/dayflow/persisted_qualification_authority';
import type { AuthContext } from '../middleware/auth_middleware';
import {
  DayflowReceivingContextRepository,
  type DayflowProviderDependency,
  type DayflowProviderReceiver,
  type DayflowProviderSessionScope,
} from '../repositories/dayflow_receiving_context_repository';
import type {
  DayflowGuardEnrollment,
  DayflowQualifiedEvidenceService,
  DayflowQualifiedReader,
} from './dayflow_qualified_evidence_service';
import type { OpencodeClientService } from './opencode_client_service';

export interface DayflowSdkHistoryGuard {
  shouldBindPrompt(sdkSessionId: string): Promise<boolean>;
  revalidateBeforeSdk(sdkSessionId: string): Promise<boolean>;
  /**
   * Internal, server-only "guarded load for projection": true only when the
   * history is fully readable AND the owned engine durably guards this SDK, so a
   * typed current-root foreground/callback may enqueue into it and let the native
   * per-attempt guard project. It never clears a marker, never edits history and
   * is never a raw-history permission.
   */
  revalidateForProjectedLoad?(sdkSessionId: string): Promise<boolean>;
}

function sameHistory(
  left: ReturnType<DayflowReceivingContextRepository['listSdkHistory']>,
  right: ReturnType<DayflowReceivingContextRepository['listSdkHistory']>,
): boolean {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return entry.binding.dispatchId === other.binding.dispatchId &&
      entry.binding.ownerUserId === other.binding.ownerUserId &&
      entry.binding.projectId === other.binding.projectId &&
      entry.binding.sdkSessionId === other.binding.sdkSessionId &&
      entry.binding.sdkTurnId === other.binding.sdkTurnId &&
      entry.candidates.length === other.candidates.length &&
      entry.candidates.every((candidate) =>
        other.candidates.some((next) => sameDayflowQualifiedEvidenceCandidate(candidate, next)));
  });
}

/**
 * Revalidates retained qualified evidence immediately before any later SDK
 * history operation. A missing guard is not permission to reuse Dayflow
 * history; opencode_client_service closes that case before native exposure.
 */
export class DayflowReceivingHistoryGuard implements DayflowSdkHistoryGuard {
  constructor(private readonly dependencies: {
    records: DayflowReceivingContextRepository;
    reader: DayflowQualifiedReader;
    authority: DayflowPersistedQualificationAuthority;
    enrollment?: DayflowGuardEnrollment;
  }) {}

  async shouldBindPrompt(sdkSessionId: string): Promise<boolean> {
    const session = this.dependencies.records.activeSessionScope(sdkSessionId);
    const active = this.dependencies.authority.activeScope();
    return !!session && !!active && session.ownerUserId === active.scope.ownerUserId &&
      session.projectId === active.scope.projectId;
  }

  async revalidateBeforeSdk(sdkSessionId: string): Promise<boolean> {
    const before = this.dependencies.records.listSdkHistory(sdkSessionId);
    if (before === null) return this.fail(sdkSessionId);
    if (before.length === 0) return true;
    for (const dependency of before) {
      let page;
      try {
        page = await this.dependencies.reader.readQualifiedEvidence({
          ownerUserId: dependency.binding.ownerUserId,
          projectId: dependency.binding.projectId,
          limit: 3000,
        });
      } catch {
        return this.fail(sdkSessionId);
      }
      if (page.status !== 'available' || !dependency.candidates.every((candidate) =>
        page.candidates.some((current) => sameDayflowQualifiedEvidenceCandidate(candidate, current)))) {
        return this.fail(sdkSessionId);
      }
    }
    // The reader awaits are not leases. Re-read durable dependencies after all
    // of them before native SDK exposure so concurrent unsafe marking/binding
    // changes cannot become reusable history.
    if (!sameHistory(before, this.dependencies.records.listSdkHistory(sdkSessionId))) {
      return this.fail(sdkSessionId);
    }
    return true;
  }

  async revalidateForProjectedLoad(sdkSessionId: string): Promise<boolean> {
    const { records, enrollment } = this.dependencies;
    const scope = records.providerSessionScope(sdkSessionId);
    if (!scope || !enrollment || !records.isCurrentPrimaryRoot(scope)) return false;
    // Unknown, corrupt or marker-without-exposure history keeps the old hold.
    if (records.providerHistory(scope).state !== 'ok') return false;
    return enrollment.ensure({ sdkSessionId });
  }

  private fail(sdkSessionId: string): boolean {
    this.dependencies.records.markSdkUnsafe(sdkSessionId, 'dayflow_dependency_revalidation_failed');
    return false;
  }
}

// ── Provider admission (C2): the per-attempt receiving decision ────────────────

export type ProviderAdmissionResult =
  | { ok: true; response: ProviderAdmissionResponse; finalize(): ProviderAdmissionResponse }
  | { ok: false };

interface FrameFacts {
  agentName: string;
  userKind: 'authored' | 'control';
  initiatingUserMessageId: string | null;
  inputGroupCount: number;
  originCoverage: 'complete' | 'ambiguous';
}

const factsOf = (frame: ProviderPendingExport): FrameFacts => ({
  agentName: frame.agentName,
  userKind: frame.userKind,
  initiatingUserMessageId: frame.initiatingUserMessageId,
  inputGroupCount: frame.inputGroupCount,
  originCoverage: frame.originCoverage,
});
const sameFacts = (left: FrameFacts, right: FrameFacts): boolean => canonicalJson(left) === canonicalJson(right);

/** One entry's removable anchors: the V1 assistant turn and/or the V2 native user message. */
function anchorsOf(entry: DayflowProviderDependency, scope: 'all' | 'invalid', invalid: (c: DayflowQualifiedEvidenceCandidate[]) => boolean): string[] {
  const anchors: string[] = [];
  if (entry.v1Candidates.length > 0 && entry.binding.sdkTurnId && (scope === 'all' || invalid(entry.v1Candidates))) {
    anchors.push(entry.binding.sdkTurnId);
  }
  if (entry.v2Candidates.length > 0 && entry.v2UserMessageId && (scope === 'all' || invalid(entry.v2Candidates))) {
    anchors.push(entry.v2UserMessageId);
  }
  return anchors;
}

function witnessKey(entries: readonly DayflowProviderDependency[]): string {
  return canonicalJson(entries.map((entry) => ({
    d: entry.binding.dispatchId, t: entry.binding.sdkTurnId, u: entry.v2UserMessageId,
    v1: entry.v1Candidates.map(canonicalJson).sort(), v2: entry.v2Candidates.map(canonicalJson).sort(),
  })));
}

/**
 * Decides, for ONE actual provider attempt, whether the dependent history and
 * a fresh automatic overlay may reach the model. It joins the owned engine's
 * pending frame to the durable typed receiver (real native-user foreground, or
 * the exact null-auth goal/delegation callback), the current owner / project /
 * primary-root / selected-agent / consent, and the persisted V1+V2 exposure
 * ledger. It reads canonical activity only through the existing qualified
 * reader/canonical resolver, persists the V2 exposure before returning text,
 * and never grants a tool, a permission or a worker authority.
 */
export class DayflowProviderAdmissionService {
  constructor(private readonly dependencies: {
    records: DayflowReceivingContextRepository;
    engine: Pick<OpencodeClientService, 'getDayflowProviderFrame'>;
    reader: DayflowQualifiedReader;
    evidence: Pick<DayflowQualifiedEvidenceService, 'readAutomaticOverlay' | 'enrollmentBeforeBody' | 'canonicalCandidateCurrent'>;
    authority: Pick<DayflowPersistedQualificationAuthority, 'activeScope'>;
    enrollment: DayflowGuardEnrollment;
  }) {}

  async admit(auth: AuthContext, body: unknown): Promise<ProviderAdmissionResult> {
    const parsed = parseProviderAdmissionRequest(body);
    if (!parsed.ok) return { ok: false };
    const request = parsed.value;
    let prepared: ProviderAdmissionResponse;
    try {
      prepared = await this.decide(auth, request);
    } catch {
      prepared = this.hold(request, 'proof_unavailable');
    }
    // Synchronous from here: re-prove current facts, then never emit a response
    // the strict native parser would refuse. The route calls this again after
    // ITS await, immediately before res.json.
    const finalize = (): ProviderAdmissionResponse => {
      let current = prepared;
      try { current = FINALIZERS.get(prepared)?.() ?? prepared; } catch { current = this.hold(request, 'proof_unavailable'); }
      const checked = validateProviderAdmissionResponse(current, request);
      return checked.ok ? checked.value : this.hold(request, 'proof_unavailable');
    };
    return { ok: true, response: finalize(), finalize };
  }

  /** Version 1 only because every known body producer (V1 search/recent and V2) enrolls first. */
  private registrationVersion(): null | 1 {
    return this.dependencies.evidence.enrollmentBeforeBody ? 1 : null;
  }

  private build(
    request: ProviderAdmissionRequest,
    partial: Pick<ProviderAdmissionResponse, 'decision' | 'rawHistoryReusable' | 'overlay' | 'projection' | 'reason'>,
    basis: ProviderBasisMaterial | null,
  ): ProviderAdmissionResponse {
    const basisDigest = basis
      ? providerBasisDigest(basis)
      : sha256Hex(canonicalJson({ v: 2, hold: partial.reason, sdk: request.sdkSessionId }));
    return {
      schemaVersion: 1,
      request,
      decision: partial.decision,
      rawHistoryReusable: partial.rawHistoryReusable,
      guardRegistrationVersion: this.registrationVersion(),
      basisDigest,
      overlay: partial.overlay,
      projection: partial.projection,
      reason: partial.reason,
    };
  }

  private hold(request: ProviderAdmissionRequest, reason: Exclude<ProviderReason, 'none'>): ProviderAdmissionResponse {
    return this.build(request, { decision: 'hold', rawHistoryReusable: false, overlay: null, projection: null, reason }, null);
  }

  private async decide(auth: AuthContext, request: ProviderAdmissionRequest): Promise<ProviderAdmissionResponse> {
    const { records, engine, reader, evidence, authority, enrollment } = this.dependencies;
    if (typeof auth?.sessionToken !== 'string' || !Number.isSafeInteger(auth.user?.id) || auth.user.id <= 0) {
      return this.hold(request, 'receiver_changed');
    }
    const lookup = records.lookupProviderSession(request.sdkSessionId);
    if (lookup.kind === 'ambiguous') return this.hold(request, 'history_ambiguous');
    if (lookup.kind === 'none') {
      // No Rhythm session row. Zero retained dependency = authoritative ordinary;
      // a retained dependency without its session is a lost receiver = hold.
      return records.hasSdkHistory(request.sdkSessionId)
        ? this.hold(request, 'receiver_changed')
        : this.build(request, { decision: 'ordinary', rawHistoryReusable: true, overlay: null, projection: null, reason: 'none' }, {
          version: 2,
          receiver: {
            ownerUserId: auth.user.id, projectId: '', sessionId: '', sdkSessionId: request.sdkSessionId, agent: '',
            receiverKind: 'none', consentGeneration: null, configurationGeneration: null, overlayEligible: false,
          },
          witnesses: [], decision: 'ordinary', reason: 'none', rawHistoryReusable: true, projection: null, overlaySha256: null,
        });
    }
    const scope = lookup.scope;
    if (scope.ownerUserId !== auth.user.id) return this.hold(request, 'receiver_changed');

    const history = records.providerHistory(scope);
    if (history.state === 'ambiguous') return this.hold(request, 'history_ambiguous');
    if (history.state === 'ok' && !scope.rootChat) return this.hold(request, 'receiver_changed');

    // Anchors the engine must prove: every retained exposure point, plus the
    // current user message (a V2 exposure of this very turn can become stale).
    const preAnchors = new Set<string>();
    if (history.state === 'ok') {
      for (const entry of history.entries) for (const anchor of anchorsOf(entry, 'all', () => true)) preAnchors.add(anchor);
    }
    const anchorsForProof = [...new Set([...preAnchors, request.userMessageId])];
    if (anchorsForProof.length > PROVIDER_ADMISSION_BOUNDS.sourceAnchors) return this.hold(request, 'bounds_exceeded');
    const frame0 = await engine.getDayflowProviderFrame(
      request.sdkSessionId, request.requestNonce, scope.directory, anchorsForProof,
    );
    if (!frame0 || frame0.status !== 'pending' || !sameProviderRequest(frame0.request, request)) {
      return this.hold(request, 'proof_unavailable');
    }
    const facts = factsOf(frame0);

    const receiverKey = facts.initiatingUserMessageId ?? request.userMessageId;
    const receiver = records.findProviderReceiver(scope, receiverKey);
    const profileAgent = records.selectedAgentName(scope.profileId);
    const consent = authority.activeScope();
    const consentCurrent = !!consent && consent.scope.ownerUserId === scope.ownerUserId &&
      consent.scope.projectId === scope.projectId;
    const agentOk = request.purpose !== 'answer' || (profileAgent !== null && facts.agentName === profileAgent);
    let overlayEligible = scope.rootChat && records.isCurrentPrimaryRoot(scope) && receiver !== null &&
      consentCurrent && agentOk && request.purpose === 'answer' && facts.userKind === 'authored' &&
      facts.initiatingUserMessageId === null && receiver.sdkUserMessageId === request.userMessageId;

    // A retained dependency or marker means the SDK must be natively guarded.
    if ((history.state === 'ok') && !(await enrollment.ensure({ sdkSessionId: request.sdkSessionId }))) {
      return this.hold(request, 'proof_unavailable');
    }

    // ── fresh overlay (V2): enrollment → persist → proofs → text ──
    let overlay: { text: string; sha256: string } | null = null;
    let overlayFinalizer: ((stillQualified: (candidate: DayflowQualifiedEvidenceCandidate) => boolean) =>
      { text: string; candidates: DayflowQualifiedEvidenceCandidate[] } | null) | null = null;
    let latest: ProviderPendingExport = frame0;
    let frameOk = true;
    if (overlayEligible && receiver) {
      const consentGeneration = consent!.scope.consentGeneration;
      const result = await evidence.readAutomaticOverlay({
        ownerUserId: scope.ownerUserId,
        projectId: scope.projectId,
        beforeBody: () => enrollment.ensure({ sdkSessionId: request.sdkSessionId }),
        persist: (candidates) => records.appendProviderExposure(scope, receiver, candidates),
        liveCurrent: async () => {
          const again = await engine.getDayflowProviderFrame(
            request.sdkSessionId, request.requestNonce, scope.directory, anchorsForProof,
          );
          frameOk = !!again && again.status === 'pending' && sameProviderRequest(again.request, request) &&
            sameFacts(factsOf(again), facts);
          if (frameOk && again && again.status === 'pending') latest = again;
          return frameOk;
        },
        finalCurrent: (candidates) => {
          const active = authority.activeScope();
          return frameOk &&
            !!active && active.scope.ownerUserId === scope.ownerUserId && active.scope.projectId === scope.projectId &&
            active.scope.consentGeneration === consentGeneration &&
            records.selectedAgentName(scope.profileId) === profileAgent &&
            records.providerFinalAdmissionCurrent(scope, receiver, candidates);
        },
      });
      if (result.state === 'hold') return this.hold(request, result.reason);
      if (result.state === 'overlay') {
        overlay = { text: result.text, sha256: sha256Hex(result.text) };
        overlayFinalizer = result.finalize;
      }
    }

    // ── history validity (after any new exposure) ──
    // Re-read the session first: a sticky marker written meanwhile must be seen here.
    const freshScope = records.providerSessionScope(request.sdkSessionId);
    if (!freshScope || freshScope.sessionId !== scope.sessionId || freshScope.ownerUserId !== scope.ownerUserId ||
        freshScope.projectId !== scope.projectId || freshScope.rootChat !== scope.rootChat) return this.hold(request, 'receiver_changed');
    const now = records.providerHistory(freshScope);
    if (now.state === 'ambiguous') return this.hold(request, 'history_ambiguous');
    // Root/primary is required only for retained dependencies or an overlay; an
    // authoritative zero-dependency session of any shape keeps ordinary admission.
    if ((now.state === 'ok' || overlay !== null) && !freshScope.rootChat) return this.hold(request, 'receiver_changed');
    const entries = now.state === 'ok' ? now.entries : [];
    const marker = now.state === 'ok' ? now.marker : null;
    // Prepared, server-only retained-history source material (never serialized):
    // the page and its producer admission token, re-proved synchronously below.
    const historyRequest = { ownerUserId: scope.ownerUserId, projectId: scope.projectId, limit: 3000 };
    let historyPrepared: Awaited<ReturnType<DayflowQualifiedReader['readQualifiedEvidenceWithAdmission']>> | null = null;
    if (entries.length > 0) {
      try {
        await reader.readQualifiedEvidence(historyRequest);
        historyPrepared = await reader.readQualifiedEvidenceWithAdmission(historyRequest);
      } catch {
        return this.hold(request, 'proof_unavailable');
      }
    }

    /**
     * The single synchronous finalizer. It runs after every await of decide(), is
     * run again by the public admit() and by the route immediately before
     * res.json, and recomputes the whole response from CURRENT facts: qualified
     * source admission, canonical note/index proofs, typed receiver, primary
     * root, selected agent, consent/configuration and the durable witnesses.
     * Stale optional text is omitted; retained-history policy (project/hold),
     * stored manifests, taint and transcript are never modified here.
     */
    const finalize = (): ProviderAdmissionResponse => {
    let historyCurrent = entries.length === 0;
    if (historyPrepared?.admission) {
      try {
        historyCurrent = reader.isQualifiedEvidenceAdmissionCurrent(historyRequest, historyPrepared.page, historyPrepared.admission);
      } catch { historyCurrent = false; }
    }
    const page = historyPrepared?.page ?? null;
    const stillQualified = (candidates: DayflowQualifiedEvidenceCandidate[]): boolean =>
      historyCurrent && !!page && page.status === 'available' &&
      candidates.every((candidate) =>
        page.candidates.some((current) => sameDayflowQualifiedEvidenceCandidate(candidate, current)) &&
        evidence.canonicalCandidateCurrent({ ownerUserId: scope.ownerUserId, projectId: scope.projectId, candidate }));
    const anyInvalid = entries.some((entry) =>
      (entry.v1Candidates.length > 0 && !stillQualified(entry.v1Candidates)) ||
      (entry.v2Candidates.length > 0 && !stillQualified(entry.v2Candidates)));

    // ── last await is behind us: re-prove the durable receiver synchronously ──
    const finalScope = records.providerSessionScope(request.sdkSessionId);
    const finalHistory = finalScope ? records.providerHistory(finalScope) : ({ state: 'ambiguous' } as const);
    const finalEntries = finalHistory.state === 'ok' ? finalHistory.entries : [];
    const finalConsent = authority.activeScope();
    if (
      !finalScope || finalScope.sessionId !== scope.sessionId || finalScope.ownerUserId !== scope.ownerUserId ||
      finalScope.projectId !== scope.projectId || finalScope.rootChat !== scope.rootChat ||
      finalScope.profileId !== scope.profileId || finalScope.unsafeCode !== freshScope.unsafeCode ||
      finalHistory.state === 'ambiguous' || witnessKey(finalEntries) !== witnessKey(entries) ||
      (!!finalConsent !== !!consent) ||
      (!!finalConsent && !!consent && finalConsent.scope.consentGeneration !== consent.scope.consentGeneration)
    ) return this.hold(request, 'receiver_changed');

    // ── final response construction: nothing below awaits ──
    // The overlay, the receiver facts and the basis are re-proved synchronously
    // here, after the retained-history await. Stale optional text is omitted and
    // the ordinary history hold/project policy decides everything else; stored
    // history, taint and the transcript are never touched by this step.
    const consentGeneration = consent?.scope.consentGeneration ?? null;
    const configurationGeneration = consent?.scope.configurationGeneration ?? null;
    const receiverNow = finalScope ? records.findProviderReceiver(finalScope, receiverKey) : null;
    const receiverHolds = !!receiver && !!receiverNow && receiverNow.kind === receiver.kind &&
      receiverNow.dispatchId === receiver.dispatchId;
    let overlay: { text: string; sha256: string } | null = null;
    let overlayEligible = false;
    if (overlayFinalizer !== null) {
      const owner = scope.ownerUserId;
      const kept = receiverHolds && !!finalScope && !!finalConsent && !!consent &&
        finalConsent.scope.ownerUserId === owner && finalConsent.scope.projectId === scope.projectId &&
        finalConsent.scope.consentGeneration === consentGeneration &&
        finalConsent.scope.configurationGeneration === configurationGeneration &&
        records.isCurrentPrimaryRoot(finalScope) &&
        profileAgent !== null && records.selectedAgentName(finalScope.profileId) === profileAgent &&
        facts.agentName === profileAgent
        ? overlayFinalizer((candidate) => stillQualified([candidate]))
        : null;
      // Durable exposure must hold for exactly the candidates that will be shown.
      if (kept && receiver && records.providerFinalAdmissionCurrent(finalScope!, receiver, kept.candidates)) {
        overlay = { text: kept.text, sha256: sha256Hex(kept.text) };
        overlayEligible = true;
      }
    }

    // ── decision ──
    const witnesses: ProviderBasisMaterial['witnesses'] = entries.flatMap((entry) => [
      ...(entry.v1Candidates.length > 0
        ? [{ dispatchId: entry.binding.dispatchId, kind: 'v1_tool_turn' as const, anchor: entry.binding.sdkTurnId, sources: entry.v1Candidates.map(canonicalJson) }]
        : []),
      ...(entry.v2Candidates.length > 0
        ? [{ dispatchId: entry.binding.dispatchId, kind: 'v2_native_user' as const, anchor: entry.v2UserMessageId ?? '', sources: entry.v2Candidates.map(canonicalJson) }]
        : []),
    ]);
    const receiverMaterial: ProviderBasisMaterial['receiver'] = {
      ownerUserId: scope.ownerUserId, projectId: scope.projectId, sessionId: scope.sessionId,
      sdkSessionId: scope.sdkSessionId, agent: facts.agentName, receiverKind: receiverHolds ? receiver!.kind : 'none',
      consentGeneration, configurationGeneration, overlayEligible,
    };
    const assemble = (
      decision: 'ordinary' | 'allow' | 'project',
      reason: 'none' | 'source_changed' | 'receiver_changed',
      projection: ProviderAdmissionResponse['projection'],
    ): ProviderAdmissionResponse => this.build(request, {
      decision, rawHistoryReusable: decision !== 'project', overlay, projection, reason,
    }, {
      version: 2, receiver: receiverMaterial, witnesses, decision, reason, rawHistoryReusable: decision !== 'project',
      projection, overlaySha256: overlay?.sha256 ?? null,
    });

    if (entries.length === 0) {
      return assemble(overlay ? 'allow' : 'ordinary', 'none', null);
    }
    const mustProject = marker !== null || anyInvalid;
    if (!mustProject) return assemble('allow', 'none', null);

    // Projection needs complete origin coverage and exact stored proofs for every affected anchor.
    if (latest.originCoverage !== 'complete') return this.hold(request, 'history_ambiguous');
    const invalid = (candidates: DayflowQualifiedEvidenceCandidate[]) => !stillQualified(candidates);
    const anchors = new Set<string>();
    for (const entry of entries) for (const anchor of anchorsOf(entry, marker !== null ? 'all' : 'invalid', invalid)) anchors.add(anchor);
    const ids = [...anchors].sort();
    if (ids.length === 0 || ids.length > PROVIDER_ADMISSION_BOUNDS.sourceAnchors) return this.hold(request, 'bounds_exceeded');
    const proofFor = (id: string): ProviderSourceProof | undefined => latest.sourceProofs.find((proof) => proof.sourceAnchorId === id);
    // Native orders anchors by their ascending message ids; anything not comparable cannot be ordered here.
    if (!ids.every((id) => id.startsWith('msg')) ||
        !ids.every((id) => { const proof = proofFor(id); return !!proof && proof.stored && proof.relation !== 'unknown'; })) {
      return this.hold(request, 'history_ambiguous');
    }
    const projection = { fromUserMessageId: ids[0], sourceAnchorIds: ids };
    return assemble('project', consentCurrent ? 'source_changed' : 'receiver_changed', projection);
    };

    const prepared = finalize();
    FINALIZERS.set(prepared, finalize);
    return prepared;
  }
}

/** Server-only: response -> its synchronous finalizer. Never serialized or accepted from a caller. */
const FINALIZERS = new WeakMap<ProviderAdmissionResponse, () => ProviderAdmissionResponse>();
