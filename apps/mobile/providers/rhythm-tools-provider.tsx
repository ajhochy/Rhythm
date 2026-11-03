import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import type { ToolScreenStateKind } from '@/components/tools/tool-screen-state';
import {
  canCancelResearchRun,
  canFinishResearchRun,
  canResumeResearchRun,
  classifyToolFailure,
  deriveToolsCacheScope,
  getToolCacheStorageKey,
  researchPolicyRef,
  researchReportReady,
  researchRunActive,
  ResearchContractError,
  ResearchWorkflowUnavailableError,
  RESEARCH_BUDGET_KEYS,
  RhythmToolsService,
  sanitizeToolCache,
  TOOL_SCREEN_MANIFEST,
  validateResearchBudgetField,
  type GalleryArtifactSource,
  type ResearchBudget,
  type ResearchModelRef,
  type ResearchProject,
  type ResearchProjectRun,
  type ToolRecord,
  type ToolScreenId,
  type ToolTransport,
} from '@/providers/services/rhythm-tools-service';
import { useOpencode } from '@/providers/opencode-provider';
import { usePairedHost } from '@/providers/paired-host-provider';
import { useRhythmAccount } from '@/providers/rhythm-account-provider';
import { mobileRuntimeVariant } from '@rhythm/mobile-runtime';

export type ToolsAvailability =
  | 'connected'
  | 'restoring'
  | 'offline'
  | 'expired-auth'
  | 'forbidden'
  | 'missing-scope'
  | 'unauthorized-pairing'
  | 'version-mismatch'
  | 'network-failure';

export interface ToolResourceState {
  items: ToolRecord[];
  loading: boolean;
  refreshing: boolean;
  offline: boolean;
  error: string | null;
  errorState: Extract<
    ToolScreenStateKind,
    | 'missing-scope'
    | 'stale-project'
    | 'unauthorized-pairing'
    | 'version-mismatch'
    | 'network-failure'
    | 'expired-auth'
    | 'forbidden'
    | 'error'
  > | null;
}

export type ToolAction =
  | 'brain:create'
  | 'brain:update'
  | 'brain:delete'
  | 'research:create'
  | 'research:retry'
  | 'research:delete'
  | 'schedules:create'
  | 'schedules:update'
  | 'schedules:delete'
  | 'schedules:trigger'
  | 'webhooks:create'
  | 'webhooks:rotate-secret'
  | 'webhooks:revoke'
  | 'profiles:create'
  | 'profiles:update'
  | 'profiles:delete'
  | 'cookbook:create'
  | 'cookbook:update'
  | 'cookbook:delete'
  | 'cookbook:run'
  | 'review:approve'
  | 'review:reject'
  | 'skills:create'
  | 'skills:update'
  | 'skills:delete'
  | 'playbooks:create'
  | 'playbooks:update'
  | 'playbooks:delete'
  | 'mcp:add'
  | 'mcp:connect'
  | 'mcp:disconnect'
  | 'mcp:oauth';

interface ToolsContextValue {
  getState: (tool: ToolScreenId) => ToolResourceState;
  getGalleryArtifactSource: (
    item: ToolRecord,
  ) => Promise<GalleryArtifactSource | null>;
  refresh: (tool: ToolScreenId) => Promise<void>;
  /** Active tools service, or null while unavailable (router settings use it). */
  getService: () => RhythmToolsService | null;
  perform: (
    tool: ToolScreenId,
    action: ToolAction,
    input?: Record<string, unknown>,
  ) => Promise<unknown>;
  /** Research project/run workspace (provider owns state, requests and fences; the screen only presents it). */
  research: ResearchWorkspace;
}

// ---- Research project/run workspace ------------------------------------------------------------------------------------

export type ResearchErrorKind =
  | 'unavailable'
  | 'not-found'
  | 'auth'
  | 'forbidden'
  | 'network'
  | 'error';

export interface ResearchWorkspaceState {
  /** A read (or cached display) has completed for the current scope. */
  initialised: boolean;
  loading: boolean;
  /** Mutations are disabled and cached data is shown read-only. */
  offline: boolean;
  /** This paired Mac does not expose the project/run workflow (legacy jobs remain available). */
  unavailable: boolean;
  error: { kind: ResearchErrorKind; message: string } | null;
  actionError: { key: string; message: string } | null;
  projects: ResearchProject[];
  selectedProjectId: string | null;
  runs: ResearchProjectRun[];
  selectedRunId: string | null;
  runDetail: ResearchProjectRun | null;
  /** An explicit missing selection: the exact selected identity disappeared; nothing else is silently substituted. */
  missing: 'project' | 'run' | null;
  report: { projectId: string; runId: string; markdown: string } | null;
  reportError: string | null;
  /** key -> request token; a stale response can only clear its own token. */
  pending: Record<string, number>;
}

export interface ResearchCreateDraft {
  name: string;
  question: string;
  goals: string[];
  domain: string;
  budget: ResearchBudget;
  /** null keeps the inherited Research-profile model policy ({}); an object is an explicit split. */
  modelPolicy: { lead: ResearchModelRef | null; researcher: ResearchModelRef | null } | null;
}

export interface ResearchSettingsEdit {
  /** Only explicitly edited budget fields. */
  budget?: Partial<ResearchBudget>;
  /** Only explicitly edited sides; the other side is merged from the fenced pre-save canonical read. */
  modelPolicy?: Partial<{ lead: ResearchModelRef | null; researcher: ResearchModelRef | null }>;
}

export interface ResearchWorkspace extends ResearchWorkspaceState {
  /** Cache scope this state belongs to (account, paired host/device, Mac project). */
  scope: string;
  /** Connected, current service and a workflow the Mac exposes. Offline/cached data never enables mutations. */
  canMutate: boolean;
  refresh: () => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  selectRun: (runId: string) => Promise<void>;
  closeReport: () => void;
  createProject: (draft: ResearchCreateDraft) => Promise<void>;
  saveSettings: (projectId: string, edit: ResearchSettingsEdit) => Promise<void>;
  startRun: (projectId: string) => Promise<void>;
  runAction: (
    projectId: string,
    runId: string,
    kind: 'cancel' | 'resume' | 'finish',
  ) => Promise<void>;
  loadReport: (projectId: string, runId: string) => Promise<void>;
  /** Thin route visibility; the provider polls only while visible. */
  setVisible: (visible: boolean) => void;
}

const POLL_INTERVAL_MS = 5_000;
const BUDGET_FIELD_NAMES: Record<keyof ResearchBudget, string> = {
  maxPasses: 'passes',
  maxTokens: 'token',
  maxCostUsd: 'spending',
  maxWallClockMs: 'time',
};

const emptyResearch = (): ResearchWorkspaceState => ({
  initialised: false,
  loading: false,
  offline: false,
  unavailable: false,
  error: null,
  actionError: null,
  projects: [],
  selectedProjectId: null,
  runs: [],
  selectedRunId: null,
  runDetail: null,
  missing: null,
  report: null,
  reportError: null,
  pending: {},
});

function researchErrorInfo(reason: unknown): { kind: ResearchErrorKind; message: string } {
  if (reason instanceof ResearchWorkflowUnavailableError) {
    return { kind: 'unavailable', message: reason.message };
  }
  const record = (reason && typeof reason === 'object' ? reason : {}) as {
    status?: unknown;
    retryable?: unknown;
  };
  const raw = reason instanceof Error ? reason.message : '';
  const message = raw && raw.length <= 200 && !raw.startsWith('<') ? raw : 'The Research request failed.';
  if (reason instanceof ResearchContractError) return { kind: 'error', message };
  const status = Number(record.status) || 0;
  const kind: ResearchErrorKind = status === 404
    ? 'not-found'
    : status === 401
      ? 'auth'
      : status === 403
        ? 'forbidden'
        : record.retryable === true
          ? 'network'
          : 'error';
  return { kind, message };
}

/** A returned run must belong to the requested project (and run) and to the project's canonical owner. */
function assertBinding(
  projectId: string,
  runId: string | null,
  run: ResearchProjectRun,
  projects: ResearchProject[],
): void {
  const owner = projects.find((project) => project.id === projectId)?.ownerUserId;
  if (
    run.projectId !== projectId ||
    (runId !== null && run.id !== runId) ||
    (owner !== undefined && run.ownerUserId !== owner)
  ) {
    throw new ResearchContractError();
  }
}

type ResearchSnapshot = {
  service: RhythmToolsService | null;
  scope: string;
  gen: number;
};

type ResearchCache = {
  scope: string;
  projects: ResearchProject[] | null;
  runs: Map<string, ResearchProjectRun[]>;
  details: Map<string, ResearchProjectRun>;
  reports: Map<string, string>;
};
const freshResearchCache = (scope: string): ResearchCache => ({
  scope,
  projects: null,
  runs: new Map(),
  details: new Map(),
  reports: new Map(),
});

/**
 * Owns the Research project/run workspace. Every request captures {service, cache scope, generation} before its first await;
 * the snapshot is rechecked before each follow-up dispatch, after every await, and again immediately before any state write.
 * Selection changes, scope changes and service replacement advance the generation, so an old response can never fill, clear
 * or select anything in a replacement context. Nothing here retries, polls in the background, or persists to disk.
 */
function useResearchWorkspaceController({
  cacheScope,
  cacheScopeRef,
  connected,
  service,
  serviceRef,
}: {
  cacheScope: string;
  cacheScopeRef: MutableRefObject<string>;
  connected: boolean;
  service: RhythmToolsService | null;
  serviceRef: MutableRefObject<RhythmToolsService | null>;
}): ResearchWorkspace {
  const storeRef = useRef<ResearchWorkspaceState>(emptyResearch());
  const [version, setVersion] = useState(0);
  const genRef = useRef(0);
  const refreshTokenRef = useRef(0);
  const tokenRef = useRef(0);
  // Pending-read ownership. A revoked frame or a connection/service change hides a read's RESULT but cannot settle its
  // transport I/O, so ownership is released only by the owning completion (token compare), never by invalidation.
  const pollInFlightRef = useRef<{ service: RhythmToolsService | null; token: number } | null>(null);
  const pollTokenRef = useRef(0);
  const pollDeferredRef = useRef(false); // a tick was skipped behind an owned read; resume progression when it settles
  const [pollKick, setPollKick] = useState(0);
  // Outstanding run-list reads per service transport, shared by the poll and every refresh/selection read.
  const runsReadsRef = useRef(new WeakMap<RhythmToolsService, Promise<void>>());
  const cacheRef = useRef<ResearchCache>(freshResearchCache(cacheScope));
  const connectedRef = useRef(connected);
  connectedRef.current = connected;
  const [visible, setVisibleState] = useState(false);
  // Active unless the OS reports background/inactive (an unknown initial value must not silently disable updates).
  const [appActive, setAppActive] = useState(
    () => !['background', 'inactive'].includes(String(AppState.currentState)),
  );
  // READ-FRAME lifetime (route focus + app state), kept separate from the mutation connection/intent checks: a background
  // read is valid only while its frame epoch is unchanged and the route is still visible and the app active.
  const visibleRef = useRef(false);
  const appActiveRef = useRef(appActive);
  const frameEpochRef = useRef(0);

  const snapshot = useCallback((): ResearchSnapshot => ({
    service: serviceRef.current,
    scope: cacheScopeRef.current,
    gen: genRef.current,
  }), [cacheScopeRef, serviceRef]);
  const isCurrent = useCallback((snap: ResearchSnapshot) => (
    serviceRef.current === snap.service &&
    cacheScopeRef.current === snap.scope &&
    genRef.current === snap.gen
  ), [cacheScopeRef, serviceRef]);
  const publish = useCallback(() => setVersion((value) => value + 1), []);
  /** The state-update boundary: the snapshot is re-proved here, synchronously, immediately before the write. */
  const commit = useCallback((
    snap: ResearchSnapshot,
    update: (state: ResearchWorkspaceState) => ResearchWorkspaceState,
  ): boolean => {
    if (!isCurrent(snap)) return false;
    storeRef.current = update(storeRef.current);
    publish();
    return true;
  }, [isCurrent, publish]);
  // Stable accessor for the scope-keyed in-memory cache (cleared whenever the scope differs; never persisted to disk).
  const cacheFor = useRef((scope: string): ResearchCache => {
    if (cacheRef.current.scope !== scope) cacheRef.current = freshResearchCache(scope);
    return cacheRef.current;
  }).current;

  // Scope change clears all Research state immediately. A service replacement under the same scope only invalidates
  // in-flight work (generation bump) and releases pending flags; selections survive.
  const previousScope = useRef(cacheScope);
  const previousService = useRef(service);
  useEffect(() => {
    if (previousScope.current !== cacheScope) {
      previousScope.current = cacheScope;
      previousService.current = service;
      genRef.current += 1;
      refreshTokenRef.current += 1;
      storeRef.current = emptyResearch();
      cacheRef.current = freshResearchCache(cacheScope);
      publish();
      return;
    }
    if (previousService.current !== service) {
      previousService.current = service;
      genRef.current += 1;
      refreshTokenRef.current += 1;
      storeRef.current = { ...storeRef.current, loading: false, pending: {} };
      publish();
    }
  }, [cacheScope, publish, service]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      appActiveRef.current = next === 'active';
      frameEpochRef.current += 1; // revokes any read frame already in flight
      setAppActive(next === 'active');
    });
    return () => subscription.remove();
  }, []);
  // A connection change (loss, auth loss or regain) revokes every in-flight read and follow-up for the old connection.
  // Already dispatched backend actions are never cancelled; their responses are simply not applied here.
  const previousConnected = useRef(connected);
  useEffect(() => {
    if (previousConnected.current === connected) return;
    previousConnected.current = connected;
    genRef.current += 1;
    refreshTokenRef.current += 1;
    frameEpochRef.current += 1;
  }, [connected]);
  useEffect(() => () => {
    genRef.current += 1;
    refreshTokenRef.current += 1;
  }, []);

  /**
   * One outstanding run-list read per service transport, shared by the poll and every refresh/selection read. A caller whose
   * intent is revoked can no longer release the read it left in flight, so later callers wait for that read to SETTLE and then
   * re-prove their own current intent before issuing a single replacement read. Revoked data is never reused, nothing is
   * aborted, and there is no queue beyond waiting on the one outstanding promise.
   */
  const readRunsExclusive = useCallback(async (
    svc: RhythmToolsService,
    projectId: string,
    stillWanted: () => boolean,
  ): Promise<ResearchProjectRun[] | null> => {
    for (;;) {
      const outstanding = runsReadsRef.current.get(svc);
      if (!outstanding) break;
      await outstanding;
      if (!stillWanted()) return null; // re-proved after the old read settled
    }
    if (!stillWanted()) return null;
    const read = svc.listResearchProjectRuns(projectId);
    const settled: Promise<void> = read.then(() => undefined, () => undefined).then(() => {
      if (runsReadsRef.current.get(svc) === settled) runsReadsRef.current.delete(svc);
    });
    runsReadsRef.current.set(svc, settled);
    return read;
  }, []);

  /** Read one project's runs and its exact selected-run detail; apply each step only while the snapshot stays current. */
  const readProject = useCallback(async (
    snap: ResearchSnapshot,
    live: () => boolean,
    projectId: string,
  ): Promise<void> => {
    const svc = snap.service!;
    const runs = await readRunsExclusive(svc, projectId, live);
    if (!runs || !live()) return;
    for (const run of runs) assertBinding(projectId, null, run, storeRef.current.projects);
    const cache = cacheFor(snap.scope);
    cache.runs.set(projectId, runs);
    const state = storeRef.current;
    if (state.selectedProjectId !== projectId) return;
    let selectedRunId = state.selectedRunId;
    let missing: ResearchWorkspaceState['missing'] = null;
    if (selectedRunId === null) selectedRunId = runs[0]?.id ?? null; // first selection only, deterministic
    else if (!runs.some((run) => run.id === selectedRunId)) missing = 'run'; // never fall to another run
    const row = runs.find((run) => run.id === selectedRunId) ?? null;
    if (!commit(snap, (current) => ({
      ...current,
      runs,
      selectedRunId,
      missing,
      runDetail: row ?? (missing ? null : current.runDetail),
      report: missing ? null : current.report,
      error: null,
    }))) return;
    if (!row || !selectedRunId) return;
    const detail = await svc.getResearchProjectRun(projectId, selectedRunId);
    if (!live()) return;
    assertBinding(projectId, selectedRunId, detail, storeRef.current.projects);
    cache.details.set(`${projectId}|${selectedRunId}`, detail);
    commit(snap, (current) => (current.selectedRunId !== selectedRunId ? current : {
      ...current,
      runs: current.runs.map((run) => (run.id === detail.id ? detail : run)),
      runDetail: detail,
    }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyReadFailure = useCallback((snap: ResearchSnapshot, reason: unknown) => {
    const info = researchErrorInfo(reason);
    commit(snap, (current) => ({
      ...current,
      loading: false,
      initialised: true,
      unavailable: info.kind === 'unavailable' ? true : current.unavailable,
      offline: info.kind === 'network' ? true : current.offline,
      error: info.kind === 'unavailable' ? null : info,
    }));
  }, [commit]);

  const refresh = useCallback(async (): Promise<void> => {
    const snap = snapshot();
    const token = ++refreshTokenRef.current;
    const live = () => isCurrent(snap) && refreshTokenRef.current === token;
    const cache = cacheFor(snap.scope);
    if (!snap.service || !connectedRef.current) {
      // Offline/unavailable service: show only cached data for this verified scope, read-only.
      commit(snap, (current) => ({
        ...current,
        initialised: true,
        loading: false,
        offline: true,
        projects: current.projects.length > 0 ? current.projects : cache.projects ?? [],
      }));
      return;
    }
    commit(snap, (current) => ({
      ...current,
      loading: !current.initialised,
      offline: false,
      unavailable: false,
      error: null,
    }));
    try {
      const projects = await snap.service.listResearchProjects();
      if (!live()) return;
      cache.projects = projects;
      const selected = storeRef.current.selectedProjectId;
      const exists = selected !== null && projects.some((project) => project.id === selected);
      const nextSelected = selected === null ? projects[0]?.id ?? null : selected; // first selection only
      if (!commit(snap, (current) => ({
        ...current,
        projects,
        selectedProjectId: nextSelected,
        missing: selected !== null && !exists ? 'project' : current.missing === 'project' ? null : current.missing,
        runs: selected !== null && !exists ? [] : current.runs,
        runDetail: selected !== null && !exists ? null : current.runDetail,
        initialised: true,
        loading: false,
        error: null,
      }))) return;
      if (nextSelected !== null && (selected === null || exists)) {
        await readProject(snap, live, nextSelected);
      }
    } catch (reason) {
      if (live()) applyReadFailure(snap, reason);
    }
  }, [applyReadFailure, commit, isCurrent, readProject, snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectProject = useCallback(async (projectId: string): Promise<void> => {
    genRef.current += 1; // a selection change invalidates every in-flight request for the previous selection
    refreshTokenRef.current += 1;
    const snap = snapshot();
    const token = ++refreshTokenRef.current;
    const live = () => isCurrent(snap) && refreshTokenRef.current === token;
    const cache = cacheFor(snap.scope);
    storeRef.current = {
      ...storeRef.current,
      selectedProjectId: projectId,
      runs: cache.runs.get(projectId) ?? [],
      selectedRunId: null,
      runDetail: null,
      missing: null,
      report: null,
      reportError: null,
      actionError: null,
    };
    publish();
    if (!snap.service || !connectedRef.current) return;
    try {
      await readProject(snap, live, projectId);
    } catch (reason) {
      if (live()) applyReadFailure(snap, reason);
    }
  }, [applyReadFailure, isCurrent, publish, readProject, snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectRun = useCallback(async (runId: string): Promise<void> => {
    genRef.current += 1;
    const snap = snapshot();
    const token = ++refreshTokenRef.current;
    const live = () => isCurrent(snap) && refreshTokenRef.current === token;
    const projectId = storeRef.current.selectedProjectId;
    const row = storeRef.current.runs.find((run) => run.id === runId) ?? null;
    storeRef.current = {
      ...storeRef.current,
      selectedRunId: runId,
      runDetail: row,
      missing: null,
      report: null,
      reportError: null,
      actionError: null,
    };
    publish();
    if (!snap.service || !connectedRef.current || !projectId) return;
    try {
      const detail = await snap.service.getResearchProjectRun(projectId, runId);
      if (!live()) return;
      assertBinding(projectId, runId, detail, storeRef.current.projects);
      cacheFor(snap.scope).details.set(`${projectId}|${runId}`, detail);
      commit(snap, (current) => ({
        ...current,
        runs: current.runs.map((run) => (run.id === detail.id ? detail : run)),
        runDetail: detail,
      }));
    } catch (reason) {
      if (live()) applyReadFailure(snap, reason);
    }
  }, [applyReadFailure, commit, isCurrent, publish, snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeReport = useCallback(() => {
    storeRef.current = { ...storeRef.current, report: null, reportError: null };
    publish();
  }, [publish]);

  // ---- explicit mutations ---------------------------------------------------------------------------------------------
  const requireWritable = (snap: ResearchSnapshot): RhythmToolsService => {
    if (!snap.service || !connectedRef.current || storeRef.current.unavailable) {
      throw new Error('Research is read-only while the paired Mac is offline or unavailable.');
    }
    return snap.service;
  };
  const begin = (key: string): number | null => {
    if (storeRef.current.pending[key]) return null; // no overlapping action for the same target
    const token = ++tokenRef.current;
    storeRef.current = {
      ...storeRef.current,
      pending: { ...storeRef.current.pending, [key]: token },
      actionError: null,
    };
    publish();
    return token;
  };
  const end = (key: string, token: number) => {
    // An old response clears only its OWN pending token, never a newer one.
    if (storeRef.current.pending[key] !== token) return;
    const rest = { ...storeRef.current.pending };
    delete rest[key];
    storeRef.current = { ...storeRef.current, pending: rest };
    publish();
  };
  const fail = (snap: ResearchSnapshot, key: string, reason: unknown): never => {
    const info = researchErrorInfo(reason);
    commit(snap, (current) => ({ ...current, actionError: { key, message: info.message } }));
    throw reason;
  };
  const validationFail = (snap: ResearchSnapshot, key: string, message: string): never =>
    fail(snap, key, new Error(message));

  const createProject = useCallback(async (draft: ResearchCreateDraft): Promise<void> => {
    const snap = snapshot();
    const key = 'create';
    const name = draft.name.trim();
    const question = draft.question.trim();
    if (!name || !question) validationFail(snap, key, 'Enter a project name and a research question.');
    for (const field of RESEARCH_BUDGET_KEYS) {
      const problem = validateResearchBudgetField(field, draft.budget[field]);
      if (problem) validationFail(snap, key, problem);
    }
    const svc = requireWritable(snap);
    const token = begin(key);
    if (token === null) return;
    try {
      const created = await svc.createResearchProject({
        name,
        question,
        goals: draft.goals.map((goal) => goal.trim()).filter(Boolean),
        domain: draft.domain.trim() || null,
        profileId: 'research',
        passConfig: [{ role: 'evidence', profileId: 'research' }],
        modelPolicy: draft.modelPolicy
          ? { lead: draft.modelPolicy.lead, researcher: draft.modelPolicy.researcher }
          : {},
        criticConfig: { enabled: true },
        synthesisConfig: { enabled: true },
        scheduleRef: null,
        budget: { ...draft.budget },
      });
      if (!isCurrent(snap)) return;
      // The new server ID is selected only for this still-current explicit intent; creation never starts a run.
      genRef.current += 1;
      const next = snapshot();
      commit(next, (current) => ({
        ...current,
        projects: current.projects.some((project) => project.id === created.id)
          ? current.projects.map((project) => (project.id === created.id ? created : project))
          : [...current.projects, created],
        selectedProjectId: created.id,
        runs: [],
        selectedRunId: null,
        runDetail: null,
        missing: null,
        report: null,
        reportError: null,
      }));
      cacheFor(next.scope).projects = storeRef.current.projects;
    } catch (reason) {
      fail(snap, key, reason);
    } finally {
      end(key, token);
    }
  }, [commit, isCurrent, snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveSettings = useCallback(async (
    projectId: string,
    edit: ResearchSettingsEdit,
  ): Promise<void> => {
    const snap = snapshot();
    const key = `save:${projectId}`;
    const budgetEdit = edit.budget ?? {};
    for (const field of RESEARCH_BUDGET_KEYS) {
      if (field in budgetEdit) {
        const problem = validateResearchBudgetField(field, budgetEdit[field]);
        if (problem) validationFail(snap, key, problem);
      }
    }
    const svc = requireWritable(snap);
    const token = begin(key);
    if (token === null) return;
    try {
      // Fresh canonical read of the exact project first: merge ONLY the dirty fields over it, never over a stale card.
      const canonical = await svc.getResearchProject(projectId);
      if (!isCurrent(snap)) return;
      if (canonical.id !== projectId) throw new ResearchContractError();
      if (canonical.archivedAt) throw new Error('Archived projects cannot be edited.');
      const patch: { budget?: Record<string, unknown>; modelPolicy?: Record<string, unknown> } = {};
      if (RESEARCH_BUDGET_KEYS.some((field) => field in budgetEdit)) {
        // The API defaults any omitted/null budget field, so a missing or malformed UNTOUCHED limit would silently become a
        // new-project default. All four resulting known limits must be valid before the PATCH, unless explicitly repaired.
        const merged: Record<string, unknown> = {};
        for (const field of RESEARCH_BUDGET_KEYS) {
          const value = field in budgetEdit ? budgetEdit[field] : canonical.budget[field];
          const problem = validateResearchBudgetField(field, value);
          if (problem) {
            throw new Error(
              field in budgetEdit
                ? problem
                : `This project’s ${BUDGET_FIELD_NAMES[field]} limit is missing or invalid on the Mac. Set it explicitly to save.`,
            );
          }
          merged[field] = value;
        }
        patch.budget = merged;
      }
      const policyEdit = edit.modelPolicy ?? {};
      if ('lead' in policyEdit || 'researcher' in policyEdit) {
        patch.modelPolicy = {
          lead: 'lead' in policyEdit ? policyEdit.lead ?? null : researchPolicyRef(canonical.modelPolicy, 'lead'),
          researcher: 'researcher' in policyEdit
            ? policyEdit.researcher ?? null
            : researchPolicyRef(canonical.modelPolicy, 'researcher'),
        };
      }
      if (!patch.budget && !patch.modelPolicy) return;
      requireWritable(snap); // reprove the connection immediately before the PATCH is dispatched
      const updated = await svc.updateResearchProject(projectId, patch);
      if (!isCurrent(snap)) return;
      if (updated.id !== projectId) throw new ResearchContractError();
      const apply = (project: ResearchProject) => commit(snap, (current) => ({
        ...current,
        projects: current.projects.map((entry) => (entry.id === project.id ? project : entry)),
      }));
      apply(updated);
      try {
        const reread = await svc.getResearchProject(projectId);
        if (reread.id === projectId) apply(reread);
      } catch {
        // The PATCH response already holds the saved canonical project.
      }
    } catch (reason) {
      fail(snap, key, reason);
    } finally {
      end(key, token);
    }
  }, [commit, isCurrent, snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const startRun = useCallback(async (projectId: string): Promise<void> => {
    const snap = snapshot();
    const key = `start:${projectId}`;
    const svc = requireWritable(snap);
    const token = begin(key);
    if (token === null) return;
    try {
      // Reread the exact project first (never reuse defaults/archive state from a stale card).
      const project = await svc.getResearchProject(projectId);
      if (!isCurrent(snap)) return;
      if (project.id !== projectId) throw new ResearchContractError();
      if (project.archivedAt) throw new Error('Archived projects cannot start a run.');
      commit(snap, (current) => ({
        ...current,
        projects: current.projects.map((entry) => (entry.id === project.id ? project : entry)),
      }));
      requireWritable(snap); // a connection lost while the preflight read was pending rejects the follow-up mutation
      const run = await svc.startResearchProjectRun(projectId);
      if (!isCurrent(snap)) return;
      assertBinding(projectId, null, run, [project]);
      genRef.current += 1; // selecting the new run is itself a selection change
      const next = snapshot();
      commit(next, (current) => ({
        ...current,
        runs: [run, ...current.runs.filter((entry) => entry.id !== run.id)],
        selectedRunId: run.id,
        runDetail: run,
        missing: null,
        report: null,
        reportError: null,
      }));
    } catch (reason) {
      fail(snap, key, reason);
    } finally {
      end(key, token);
    }
  }, [commit, isCurrent, snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const runAction = useCallback(async (
    projectId: string,
    runId: string,
    kind: 'cancel' | 'resume' | 'finish',
  ): Promise<void> => {
    const snap = snapshot();
    const key = `run:${runId}`;
    const svc = requireWritable(snap);
    const token = begin(key);
    if (token === null) return;
    const applyRun = (run: ResearchProjectRun) => commit(snap, (current) => ({
      ...current,
      runs: current.runs.map((entry) => (entry.id === run.id ? run : entry)),
      runDetail: current.selectedRunId === run.id ? run : current.runDetail,
    }));
    let dispatched = false;
    try {
      // Reread the exact run, re-evaluate its predicate, and recheck currency BEFORE the mutation is dispatched.
      const fresh = await svc.getResearchProjectRun(projectId, runId);
      if (!isCurrent(snap)) return;
      assertBinding(projectId, runId, fresh, storeRef.current.projects);
      applyRun(fresh);
      const allowed = kind === 'cancel'
        ? canCancelResearchRun(fresh)
        : kind === 'resume'
          ? canResumeResearchRun(fresh)
          : canFinishResearchRun(fresh);
      if (!allowed) throw new Error(`This run can no longer be ${kind === 'finish' ? 'finished' : `${kind}ed`}.`);
      if (!isCurrent(snap)) return;
      requireWritable(snap); // reprove the connection immediately before the mutation is dispatched
      dispatched = true;
      const run = kind === 'cancel'
        ? await svc.cancelResearchProjectRun(projectId, runId)
        : kind === 'resume'
          ? await svc.resumeResearchProjectRun(projectId, runId)
          : await svc.finishResearchProjectRun(projectId, runId);
      if (!isCurrent(snap)) return;
      assertBinding(projectId, runId, run, storeRef.current.projects);
      applyRun(run);
    } catch (reason) {
      if (dispatched && isCurrent(snap)) {
        // One read of ONLY the submitted exact identity while its original currency holds; never a retry or replacement.
        try {
          const reread = await svc.getResearchProjectRun(projectId, runId);
          if (isCurrent(snap) && reread.id === runId && reread.projectId === projectId) applyRun(reread);
        } catch {
          // The original action error is what the caller sees.
        }
      }
      fail(snap, key, reason);
    } finally {
      end(key, token);
    }
  }, [commit, isCurrent, snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadReport = useCallback(async (projectId: string, runId: string): Promise<void> => {
    const snap = snapshot();
    const key = `report:${runId}`;
    const svc = requireWritable(snap);
    const token = begin(key);
    if (token === null) return;
    try {
      const run = storeRef.current.runDetail;
      if (!run || run.id !== runId || run.projectId !== projectId || !researchReportReady(run)) {
        throw new Error('This run has no final report yet.');
      }
      const markdown = await svc.exportResearchProjectRunMarkdown(projectId, runId);
      if (!isCurrent(snap)) return;
      cacheFor(snap.scope).reports.set(`${projectId}|${runId}`, markdown);
      commit(snap, (current) => ({
        ...current,
        report: { projectId, runId, markdown },
        reportError: null,
      }));
    } catch (reason) {
      const info = researchErrorInfo(reason);
      commit(snap, (current) => ({ ...current, report: null, reportError: info.message }));
      fail(snap, key, reason);
    } finally {
      end(key, token);
    }
  }, [commit, isCurrent, snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const setVisible = useCallback((next: boolean) => {
    visibleRef.current = next;
    frameEpochRef.current += 1; // blur/focus revokes any read frame already in flight
    setVisibleState(next);
  }, []);

  // Explicit one-shot read when the Research route becomes visible/connected, and when the scope or service changes.
  useEffect(() => {
    if (!visible) return;
    void refresh();
  }, [cacheScope, connected, refresh, service, visible]);

  // Desktop-matched active-run updates: one pending 5000ms read at a time, only while the Research route is visible, the app
  // is active, the connection is current and the selected project has an active run. Terminal/no-active state stops it.
  const state = storeRef.current;
  const anyActive = state.runs.some((run) => researchRunActive(run)) || researchRunActive(state.runDetail);
  const pollProjectId = state.selectedProjectId;
  useEffect(() => {
    if (
      !visible || !appActive || !connected || !service || state.unavailable || state.offline ||
      !pollProjectId || state.missing === 'project' || !anyActive
    ) return undefined;
    const snap = snapshot();
    const frame = frameEpochRef.current;
    // The read frame: valid only while the route is still visible, the app active, the connection current and the same
    // project selected, with no blur/focus/AppState/connection change since it was scheduled.
    const frameLive = () => (
      isCurrent(snap) &&
      frameEpochRef.current === frame &&
      visibleRef.current &&
      appActiveRef.current &&
      connectedRef.current &&
      storeRef.current.selectedProjectId === pollProjectId
    );
    const timer = setTimeout(() => {
      if (!frameLive()) return;
      const owned = pollInFlightRef.current;
      if (owned && owned.service === service) {
        // A read this transport still owns is outstanding (possibly revoked, but its I/O has not settled): skip this tick and
        // let the owning completion resume one current read when it settles.
        pollDeferredRef.current = true;
        return;
      }
      const token = ++pollTokenRef.current;
      pollInFlightRef.current = { service, token };
      void (async () => {
        try {
          // Serialized with every refresh/selection run-list read on this service; re-proves the frame after any wait.
          const runs = await readRunsExclusive(service, pollProjectId, frameLive);
          if (!runs || !frameLive()) return; // a revoked frame's result is discarded: no state and no cache write
          for (const run of runs) assertBinding(pollProjectId, null, run, storeRef.current.projects);
          cacheFor(snap.scope).runs.set(pollProjectId, runs);
          commit(snap, (current) => {
            if (current.selectedProjectId !== pollProjectId) return current;
            const selectedId = current.selectedRunId;
            const shown = selectedId ? runs.find((run) => run.id === selectedId) ?? null : null;
            if (selectedId && !shown) {
              // The exact selected run is gone: keep its id as an explicit missing selection (never another run) and drop
              // its obsolete detail/report so nothing stale stays active.
              return {
                ...current,
                runs,
                missing: 'run',
                runDetail: null,
                report: current.report?.runId === selectedId ? null : current.report,
                reportError: null,
              };
            }
            return { ...current, runs, runDetail: shown ?? current.runDetail };
          });
        } catch {
          // Mirrors the desktop: a failed poll just stops; explicit Refresh resumes.
        } finally {
          // Only the owning completion releases its token (success, failure, discard or unmount alike).
          if (pollInFlightRef.current?.token === token) pollInFlightRef.current = null;
          if (pollDeferredRef.current) {
            pollDeferredRef.current = false;
            setPollKick((value) => value + 1); // re-evaluate the gates and schedule one bounded current read
          }
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [anyActive, appActive, commit, connected, isCurrent, pollKick, pollProjectId, readRunsExclusive, service, snapshot, state.missing, state.offline, state.runs, state.runDetail, state.unavailable, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo<ResearchWorkspace>(() => ({
    ...storeRef.current,
    scope: cacheScopeRef.current,
    canMutate: connected && Boolean(service) && !storeRef.current.unavailable,
    refresh,
    selectProject,
    selectRun,
    closeReport,
    createProject,
    saveSettings,
    startRun,
    runAction,
    loadReport,
    setVisible,
  }), [
    cacheScopeRef, closeReport, connected, createProject, loadReport, refresh, runAction, saveSettings,
    selectProject, selectRun, service, setVisible, startRun,
    version, // eslint-disable-line react-hooks/exhaustive-deps
  ]);
}

const INITIAL_STATE: ToolResourceState = {
  items: [],
  loading: true,
  refreshing: false,
  offline: false,
  error: null,
  errorState: null,
};

const TOOL_SCREEN_LOAD_TIMEOUT_MS = 12_000;

class ToolScreenLoadTimeoutError extends Error {
  readonly status = 408;

  constructor() {
    super('The paired Mac did not respond within 12 seconds. Try again.');
    this.name = 'ToolScreenLoadTimeoutError';
  }
}

const ToolsContext = createContext<ToolsContextValue | null>(null);

function originFor(tool: ToolScreenId): 'cloud' | 'paired' {
  return TOOL_SCREEN_MANIFEST.find((entry) => entry.id === tool)!.origin;
}

function safeError(reason: unknown): string {
  if (
    reason &&
    typeof reason === 'object' &&
    typeof (reason as { message?: unknown }).message === 'string'
  ) {
    return (reason as { message: string }).message;
  }
  return 'Could not load this tool.';
}

async function runAction(
  service: RhythmToolsService,
  action: ToolAction,
  input: Record<string, unknown>,
): Promise<unknown> {
  const id = String(input.id ?? '');
  const name = String(input.name ?? '');
  switch (action) {
    case 'brain:create':
      return service.createBrain(input);
    case 'brain:update':
      return service.updateBrain(id, input);
    case 'brain:delete':
      return service.deleteBrain(id);
    case 'research:create':
      return service.createResearch(String(input.query ?? ''));
    case 'research:retry':
      return service.retryResearch(id);
    case 'research:delete':
      return service.deleteResearch(id);
    case 'schedules:create':
      return service.createSchedule(input);
    case 'schedules:update':
      return service.updateSchedule(id, input);
    case 'schedules:delete':
      return service.deleteSchedule(id);
    case 'schedules:trigger':
      return service.triggerSchedule(id);
    case 'webhooks:create':
      return service.createWebhook(input);
    case 'webhooks:rotate-secret':
      return service.rotateWebhookSecret(id);
    case 'webhooks:revoke':
      return service.revokeWebhook(id);
    case 'profiles:create':
      return service.createProfile(input);
    case 'profiles:update':
      return service.updateProfile(id, input);
    case 'profiles:delete':
      return service.deleteProfile(id);
    case 'cookbook:create':
      return service.createRecipe(input);
    case 'cookbook:update':
      return service.updateRecipe(id, input);
    case 'cookbook:delete':
      return service.deleteRecipe(id);
    case 'cookbook:run':
      return service.runRecipe(id);
    case 'review:approve':
      return service.approveProposal(id);
    case 'review:reject':
      return service.rejectProposal(id, String(input.reason ?? ''));
    case 'skills:create':
      return service.createSkill(input);
    case 'skills:update':
      return service.updateSkill(name, input);
    case 'skills:delete':
      return service.deleteSkill(name);
    case 'playbooks:create':
      return service.createPlaybook(input);
    case 'playbooks:update':
      return service.updatePlaybook(name, input);
    case 'playbooks:delete':
      return service.deletePlaybook(name);
    case 'mcp:add':
      return service.addMcp(input);
    case 'mcp:connect':
      return service.connectMcp(name);
    case 'mcp:disconnect':
      return service.disconnectMcp(name);
    case 'mcp:oauth':
      return service.startMcpOAuth(name);
  }
}

export function RhythmToolsProvider({
  cacheScope,
  children,
  cloudAvailability,
  pairedAvailability,
  service,
}: PropsWithChildren<{
  cacheScope: string;
  cloudAvailability: ToolsAvailability;
  pairedAvailability: ToolsAvailability;
  service: RhythmToolsService | null;
}>) {
  const [states, setStates] = useState<
    Partial<Record<ToolScreenId, ToolResourceState>>
  >({});
  const generation = useRef<Partial<Record<ToolScreenId, number>>>({});
  const previousCacheScope = useRef(cacheScope);
  const cacheScopeRef = useRef(cacheScope);
  cacheScopeRef.current = cacheScope;
  const serviceRef = useRef(service);
  serviceRef.current = service;
  const research = useResearchWorkspaceController({
    cacheScope,
    cacheScopeRef,
    connected: pairedAvailability === 'connected',
    service,
    serviceRef,
  });

  useEffect(() => {
    if (previousCacheScope.current === cacheScope) return;
    previousCacheScope.current = cacheScope;
    setStates({});
  }, [cacheScope]);

  const availabilityFor = useCallback(
    (tool: ToolScreenId): ToolsAvailability =>
      originFor(tool) === 'cloud'
        ? cloudAvailability
        : pairedAvailability,
    [cloudAvailability, pairedAvailability],
  );

  const setToolState = useCallback(
    (
      tool: ToolScreenId,
      update:
        | Partial<ToolResourceState>
        | ((current: ToolResourceState) => Partial<ToolResourceState>),
    ) => {
      setStates((current) => {
        const previous = current[tool] ?? INITIAL_STATE;
        const patch =
          typeof update === 'function' ? update(previous) : update;
        return { ...current, [tool]: { ...previous, ...patch } };
      });
    },
    [],
  );

  const readCache = useCallback(
    async (tool: ToolScreenId): Promise<ToolRecord[]> => {
      const raw = await AsyncStorage.getItem(
        getToolCacheStorageKey(cacheScope, tool),
      );
      if (!raw) return [];
      try {
        return sanitizeToolCache(tool, JSON.parse(raw));
      } catch {
        return [];
      }
    },
    [cacheScope],
  );

  const refresh = useCallback(
    async (tool: ToolScreenId): Promise<void> => {
      const requestGeneration = (generation.current[tool] ?? 0) + 1;
      generation.current[tool] = requestGeneration;
      const requestCacheScope = cacheScopeRef.current;
      const availability = availabilityFor(tool);
      const activeService = serviceRef.current;
      setToolState(tool, (current) => ({
        loading: current.items.length === 0,
        refreshing: current.items.length > 0,
        error: null,
        errorState: null,
      }));
      if (availability === 'restoring') return;
      if (!activeService || availability !== 'connected') {
        const cached = await readCache(tool);
        if (
          generation.current[tool] !== requestGeneration ||
          cacheScopeRef.current !== requestCacheScope
        ) return;
        const failure = classifyToolFailure(
          undefined,
          activeService ? availability : 'network-failure',
          originFor(tool),
        );
        const canUseCache = failure === 'network-failure';
        setToolState(tool, {
          items: canUseCache ? cached : [],
          loading: false,
          refreshing: false,
          offline: canUseCache,
          errorState: canUseCache && cached.length > 0 ? null : failure,
        });
        return;
      }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const screenRequest = activeService.loadScreen(tool);
        const response = originFor(tool) === 'paired'
          ? await Promise.race([
              screenRequest,
              new Promise<never>((_, reject) => {
                timeout = setTimeout(() => {
                  const reason = new ToolScreenLoadTimeoutError();
                  if (
                    generation.current[tool] === requestGeneration &&
                    cacheScopeRef.current === requestCacheScope
                  ) {
                    setToolState(tool, {
                      loading: false,
                      refreshing: false,
                      offline: false,
                      error: reason.message,
                      errorState: 'error',
                    });
                  }
                  reject(reason);
                }, TOOL_SCREEN_LOAD_TIMEOUT_MS);
              }),
            ])
          : await screenRequest;
        if (
          generation.current[tool] !== requestGeneration ||
          cacheScopeRef.current !== requestCacheScope
        ) return;
        const items = sanitizeToolCache(tool, response);
        await AsyncStorage.setItem(
          getToolCacheStorageKey(cacheScope, tool),
          JSON.stringify(items),
        );
        setToolState(tool, {
          items,
          loading: false,
          refreshing: false,
          offline: false,
        });
      } catch (reason) {
        if (
          generation.current[tool] !== requestGeneration ||
          cacheScopeRef.current !== requestCacheScope
        ) return;
        const cached = await readCache(tool);
        const failure = classifyToolFailure(
          reason,
          'connected',
          originFor(tool),
        );
        const canUseCache =
          failure === 'network-failure' || failure === 'error';
        setToolState(tool, {
          items: canUseCache ? cached : [],
          loading: false,
          refreshing: false,
          offline: canUseCache && cached.length > 0,
          error: failure === 'error' || failure === 'forbidden'
            ? safeError(reason)
            : null,
          errorState: canUseCache && cached.length > 0 ? null : failure,
        });
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    },
    [
      availabilityFor,
      cacheScope,
      readCache,
      setToolState,
    ],
  );

  // After a REJECTED explicit research:retry only: re-read that exact submitted job once and update only its row. No
  // redispatch, no broad refresh, no replacement job or latest-row guess. Every failure here is swallowed so the caller
  // rethrows the original action error. The service/cache scope/generation snapshot is the ORIGINAL request's, taken in
  // `perform` before the action was awaited; it is never recaptured here. It must be current before the read, after the
  // read, and again when the functional state update actually executes.
  const rereadRejectedResearchRetry = useCallback(
    async (
      tool: ToolScreenId,
      snapshot: { service: RhythmToolsService; cacheScope: string; generation: number },
      id: string,
    ): Promise<void> => {
      if (tool !== 'research' || !id) return;
      const current = () =>
        serviceRef.current === snapshot.service &&
        cacheScopeRef.current === snapshot.cacheScope &&
        (generation.current[tool] ?? 0) === snapshot.generation;
      if (!current()) return;
      try {
        const record = await snapshot.service.getResearch(id);
        if (!current()) return;
        // Cache sanitization stays authoritative (strict-boolean canRetry, no sensitive keys).
        const [safe] = sanitizeToolCache('research', [record]);
        if (!safe || safe.id !== id) return;
        setToolState(tool, (state) => (
          current()
            ? { items: state.items.map((item) => (item.id === id ? safe : item)) }
            : {}
        ));
      } catch {
        // Reread failure never replaces the original error.
      }
    },
    [setToolState],
  );

  const perform = useCallback(
    async (
      tool: ToolScreenId,
      action: ToolAction,
      input: Record<string, unknown> = {},
    ): Promise<unknown> => {
      if (!service || availabilityFor(tool) !== 'connected') {
        throw new Error('This tool is read-only while its service is offline.');
      }
      // Original-request snapshot, captured before the action is awaited and never rebased after a rejection.
      const snapshot = {
        service,
        cacheScope: cacheScopeRef.current,
        generation: generation.current[tool] ?? 0,
      };
      let result: unknown;
      try {
        result = await runAction(service, action, input);
      } catch (error) {
        if (action === 'research:retry') {
          await rereadRejectedResearchRetry(tool, snapshot, String(input.id ?? ''));
        }
        // The ORIGINAL action error is always surfaced, whether or not the reread succeeded.
        throw error;
      }
      await refresh(tool);
      return result;
    },
    [availabilityFor, refresh, rereadRejectedResearchRetry, service],
  );

  const getState = useCallback(
    (tool: ToolScreenId): ToolResourceState =>
      states[tool] ?? INITIAL_STATE,
    [states],
  );

  const getGalleryArtifactSource = useCallback(
    async (item: ToolRecord): Promise<GalleryArtifactSource | null> => {
      if (!service || availabilityFor('gallery') !== 'connected') {
        throw new Error('Artifact unavailable');
      }
      return service.getGalleryArtifactSource(item);
    },
    [availabilityFor, service],
  );

  const value = useMemo<ToolsContextValue>(
    () => ({
      getGalleryArtifactSource,
      getService: () => serviceRef.current,
      getState,
      perform,
      refresh,
      research,
    }),
    [getGalleryArtifactSource, getState, perform, refresh, research],
  );
  return (
    <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>
  );
}

export function AppRhythmToolsProvider({ children }: PropsWithChildren) {
  const account = useRhythmAccount();
  const pairedHost = usePairedHost();
  const { activeProjectPath, isHydrated } = useOpencode();
  const e2eMode = mobileRuntimeVariant.enabled;
  const service = useMemo(() => {
    const e2eService = mobileRuntimeVariant.createRhythmToolsService();
    if (e2eService) {
      return activeProjectPath
        ? e2eService
        : e2eService.forProject(activeProjectPath);
    }
    const unavailable: ToolTransport = {
      async request(): Promise<never> {
        throw new Error('This service is unavailable.');
      },
    };
    return new RhythmToolsService({
      cloud: account.client,
      paired: pairedHost.client ?? unavailable,
      projectId: activeProjectPath,
    });
  }, [
    account.client,
    activeProjectPath,
    pairedHost.client,
  ]);
  useEffect(() => () => service.cancel(), [service]);
  const cacheScope = deriveToolsCacheScope({
    accountUserId: account.user?.id ?? null,
    activeProjectId: activeProjectPath ?? null,
    pairedHost: pairedHost.host
      ? {
          hostId: pairedHost.host.hostId,
          deviceId: pairedHost.host.deviceId,
        }
      : null,
    runtimeCacheScope: e2eMode
      ? mobileRuntimeVariant.cacheScope
      : null,
  });
  const cloudAvailability: ToolsAvailability =
    e2eMode || account.state === 'signedIn' || account.state === 'refreshing'
      ? 'connected'
      : account.state === 'offline'
        ? 'offline'
        : 'expired-auth';
  const pairedAvailability: ToolsAvailability = !isHydrated
    ? 'restoring'
    : !activeProjectPath
      ? 'missing-scope'
      : e2eMode
      ? 'connected'
      : pairedHost.state === 'incompatible'
        ? 'version-mismatch'
        : pairedHost.state === 'accountMismatch' ||
            pairedHost.state === 'revoked' ||
            pairedHost.state === 'unpaired'
          ? 'unauthorized-pairing'
          : pairedHost.state === 'offline' ||
              pairedHost.state === 'tailscaleUnavailable' ||
              pairedHost.state === 'unhealthy'
            ? 'network-failure'
            : pairedHost.state === 'connected'
              ? 'connected'
              : 'unauthorized-pairing';
  return (
    <RhythmToolsProvider
      cacheScope={cacheScope}
      cloudAvailability={cloudAvailability}
      pairedAvailability={pairedAvailability}
      service={service}>
      {children}
    </RhythmToolsProvider>
  );
}

export function useRhythmTools(): ToolsContextValue {
  const value = useContext(ToolsContext);
  if (!value) {
    throw new Error('useRhythmTools must be used within RhythmToolsProvider');
  }
  return value;
}
