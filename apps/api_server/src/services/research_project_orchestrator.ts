import type {
  AgentResearchRepository,
  ResearchProjectRun,
} from '../repositories/agent_research_repository';
import * as AgentRunner from './agent_runner';
import { createHash } from 'node:crypto';

type Runner = Pick<typeof AgentRunner, 'run'>;
type PassConfig = {
  role?: unknown;
  profileId?: unknown;
  model?: unknown;
  acceptanceBar?: unknown;
};

const CRITIC_PROMPT_VERSION = 'research-critic-v1';
const SYNTHESIS_PROMPT_VERSION = 'research-synthesis-v1';

function exhausted(run: ResearchProjectRun, passCount: number): string[] {
  const budget = run.configSnapshot.budget && typeof run.configSnapshot.budget === 'object'
    ? run.configSnapshot.budget as Record<string, unknown> : {};
  const reasons: string[] = [];
  if (typeof budget.maxPasses === 'number' && passCount > budget.maxPasses) reasons.push('pass_count');
  if (typeof budget.maxTokens === 'number' && run.usage.tokens >= budget.maxTokens) reasons.push('tokens');
  if (typeof budget.maxCostUsd === 'number' && run.usage.costUsd >= budget.maxCostUsd) reasons.push('cost');
  if (typeof budget.maxWallClockMs === 'number' && run.startedAt && Date.now() - Date.parse(run.startedAt) >= budget.maxWallClockMs) reasons.push('wall_clock');
  return reasons;
}

function hashInput(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function modelOverride(value: unknown): { providerID: string; modelID: string } | undefined {
  if (typeof value !== 'string') return undefined;
  const separator = value.indexOf('/');
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) };
}

function passPrompt(run: ResearchProjectRun, pass: PassConfig, ordinal: number, jobId: string): string {
  const snapshot = run.configSnapshot;
  const question = String(snapshot.question ?? '');
  const goals = Array.isArray(snapshot.goals) ? snapshot.goals.map(String) : [];
  const role = typeof pass.role === 'string' ? pass.role : `pass-${ordinal + 1}`;
  const acceptance = typeof pass.acceptanceBar === 'string'
    ? pass.acceptanceBar
    : 'Use authoritative evidence, cite material claims, preserve uncertainty, and register canonical/supporting artifacts and curated sources.';
  return [
    `Research project pass ${ordinal + 1}: ${role}`,
    `Run ID: ${run.id}`,
    `Job ID: ${jobId}`,
    `Pass ID: ${jobId}`,
    `Question: ${question}`,
    `Goals:\n${goals.map((goal) => `- ${goal}`).join('\n')}`,
    `Acceptance bar: ${acceptance}`,
    'Work independently. Do not assume or request prose from sibling passes. Use only this shared immutable run configuration and your own source investigation.',
    `When the evidence artifacts and curated sources are actually written, call rhythm_complete_research_pass with version=1, job_id=${jobId}, run_id=${run.id}, and pass_id=${jobId}. Do not report completion before that tool succeeds.`,
  ].join('\n\n');
}

/** Thin project layer over the existing AgentRunner/session engine. */
export class ResearchProjectOrchestrator {
  private readonly inFlight = new Map<string, Promise<ResearchProjectRun>>();

  constructor(
    private readonly repository: AgentResearchRepository,
    private readonly runner: Runner = AgentRunner,
  ) {}

  start(runId: string, ownerUserId: number): Promise<ResearchProjectRun> {
    const key = `${ownerUserId}:${runId}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const started = this.startInternal(runId, ownerUserId).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, started);
    return started;
  }

  private async startInternal(runId: string, ownerUserId: number): Promise<ResearchProjectRun> {
    const run = await this.repository.getProjectRun(runId, ownerUserId);
    if (!run) throw new Error('Research project run not found');
    const passConfigs = Array.isArray(run.configSnapshot.passConfig)
      ? run.configSnapshot.passConfig as PassConfig[]
      : [];
    const initialBudgetReasons = exhausted(run, passConfigs.length);
    if (initialBudgetReasons.length > 0) {
      return (await this.repository.updateProjectRunState(runId, ownerUserId, {
        status: 'budget_exhausted', completedAt: new Date().toISOString(),
        diagnostics: { budgetExhausted: true, reasons: initialBudgetReasons },
      }))!;
    }
    let allJobs = await this.repository.listProjectPassJobs(runId, ownerUserId);
    let jobs = allJobs.filter((job) => job.passOrdinal < passConfigs.length);

    await this.repository.updateProjectRunState(runId, ownerUserId, {
      status: 'running',
      startedAt: run.startedAt ?? new Date().toISOString(),
      progress: { totalPasses: passConfigs.length, completedPasses: jobs.filter((job) => job.status === 'done').length },
    });

    for (let ordinal = 0; ordinal < passConfigs.length; ordinal += 1) {
      const pass = passConfigs[ordinal] ?? {};
      let job = jobs.find((candidate) => candidate.passOrdinal === ordinal);
      if (job?.status === 'done' || job?.status === 'error') continue;
      const role = typeof pass.role === 'string' ? pass.role : `pass-${ordinal + 1}`;
      const profileId = typeof pass.profileId === 'string'
        ? pass.profileId
        : String(run.configSnapshot.profileId ?? 'research');
      if (!job) {
        job = await this.repository.createProjectPassJob({
          projectId: run.projectId,
          projectRunId: run.id,
          ownerUserId,
          question: String(run.configSnapshot.question ?? ''),
          role,
          ordinal,
          profileId,
          config: { ...pass, question: run.configSnapshot.question, goals: run.configSnapshot.goals },
        });
        jobs = [...jobs, job];
      }
      await this.repository.updateProjectPassJob(job.id, ownerUserId, {
        status: 'gathering', error: null,
      });
      let result: Awaited<ReturnType<Runner['run']>>;
      try {
        result = await this.runner.run({
          prompt: passPrompt(run, pass, ordinal, job.id),
          cwd: process.cwd(),
          outputTarget: 'session',
          agentConfigId: profileId,
          agentKind: profileId,
          ownerUserId,
          sessionName: `Research ${run.id} · ${role}`,
          taskKind: 'research',
          onSessionCreated: async (sessionId) => {
            await this.repository.updateProjectPassJob(job!.id, ownerUserId, { agentSessionId: sessionId });
          },
          ...(modelOverride(pass.model) ? { modelOverride: modelOverride(pass.model) } : {}),
        });
      } catch (error) {
        result = { sessionId: '', result: '', status: 'error', error: String(error) };
      }
      const current = await this.repository.getProjectPassJob(job.id, ownerUserId);
      const currentRun = await this.repository.getProjectRun(runId, ownerUserId);
      if (current?.status === 'cancelled' || currentRun?.status === 'cancelled') continue;
      await this.repository.updateProjectPassJob(job.id, ownerUserId, {
        status: result.status === 'done' && result.result.trim() ? 'done' : 'error',
        agentSessionId: result.sessionId || null,
        report: result.status === 'done' && result.result.trim() ? result.result : null,
        error: result.status === 'done' && result.result.trim()
          ? null
          : result.error ?? 'Research pass returned no report',
      });
    }

    allJobs = await this.repository.listProjectPassJobs(runId, ownerUserId);
    jobs = allJobs.filter((job) => job.passOrdinal < passConfigs.length);
    const failed = jobs.filter((job) => job.status === 'error').length;
    const completed = jobs.filter((job) => job.status === 'done').length;
    const refreshedRun = (await this.repository.getProjectRun(runId, ownerUserId))!;
    const budgetReasons = exhausted(refreshedRun, passConfigs.length);
    if (budgetReasons.length > 0) {
      return (await this.repository.updateProjectRunState(runId, ownerUserId, {
        status: 'budget_exhausted', completedAt: new Date().toISOString(),
        diagnostics: { budgetExhausted: true, reasons: budgetReasons },
      }))!;
    }
    const criticConfig = refreshedRun.configSnapshot.criticConfig as Record<string, unknown> | undefined;
    const synthesisConfig = refreshedRun.configSnapshot.synthesisConfig as Record<string, unknown> | undefined;
    let critic = allJobs.find((job) => job.passRole === 'critic');
    if (criticConfig?.enabled === true && completed > 0 && critic?.status !== 'done') {
      critic = await this.runStage({
        run: refreshedRun,
        ownerUserId,
        role: 'critic',
        ordinal: 1000,
        profileId: typeof criticConfig.profileId === 'string' ? criticConfig.profileId : 'research',
        version: CRITIC_PROMPT_VERSION,
        existing: critic,
        prompt: this.criticPrompt(refreshedRun, jobs),
      });
    }
    allJobs = await this.repository.listProjectPassJobs(runId, ownerUserId);
    let synthesis = allJobs.find((job) => job.passRole === 'synthesis');
    if (synthesisConfig?.enabled === true && completed > 0 && synthesis?.status !== 'done') {
      const missingPasses = passConfigs.length - completed;
      const criticText = critic?.status === 'done' && critic.report
        ? critic.report
        : 'Critic evidence is absent or malformed; do not invent a review.';
      synthesis = await this.runStage({
        run: refreshedRun,
        ownerUserId,
        role: 'synthesis',
        ordinal: 1001,
        profileId: typeof synthesisConfig.profileId === 'string' ? synthesisConfig.profileId : 'research',
        version: SYNTHESIS_PROMPT_VERSION,
        existing: synthesis,
        prompt: this.synthesisPrompt(refreshedRun, missingPasses, criticText),
      });
    }
    const stageFailed =
      (criticConfig?.enabled === true && critic?.status !== 'done') ||
      (synthesisConfig?.enabled === true && synthesis?.status !== 'done');
    return (await this.repository.updateProjectRunState(runId, ownerUserId, {
      status: failed > 0 || stageFailed ? 'degraded' : synthesis?.status === 'done' ? 'complete' : 'passes_complete',
      progress: { totalPasses: passConfigs.length, completedPasses: completed, failedPasses: failed },
      diagnostics: failed > 0 || stageFailed
        ? { degraded: true, failedPassIds: jobs.filter((job) => job.status === 'error').map((job) => job.id), criticAvailable: critic?.status === 'done' }
        : {},
    }))!;
  }

  private stageEvidence(run: ResearchProjectRun) {
    return {
      question: run.configSnapshot.question,
      artifacts: run.artifacts,
      sources: run.sources,
    };
  }

  private criticPrompt(run: ResearchProjectRun, jobs: Array<{ status: string; passRole: string }>): string {
    const evidence = this.stageEvidence(run);
    const missing = jobs.filter((job) => job.status !== 'done').map((job) => job.passRole);
    return [
      `Code-owned critic stage (${CRITIC_PROMPT_VERSION}).`,
      `Question: ${String(run.configSnapshot.question ?? '')}`,
      `Owned-run artifact registry: ${JSON.stringify(evidence.artifacts)}`,
      `Owned-run curated source ledger: ${JSON.stringify(evidence.sources)}`,
      missing.length > 0 ? `DEGRADED INPUT: missing pass artifacts for ${missing.join(', ')}.` : 'All configured pass rows completed.',
      'Identify disagreement, correlated-source dependence, unsupported claims, missing stakeholders/evidence, counterarguments, and confidence changes. Do not fabricate evidence or consensus.',
    ].join('\n\n');
  }

  private synthesisPrompt(run: ResearchProjectRun, missingPasses: number, criticText: string): string {
    const evidence = this.stageEvidence(run);
    return [
      `Code-owned synthesis stage (${SYNTHESIS_PROMPT_VERSION}).`,
      `Question: ${String(run.configSnapshot.question ?? '')}`,
      `Owned-run pass artifacts: ${JSON.stringify(evidence.artifacts)}`,
      `Owned-run curated sources: ${JSON.stringify(evidence.sources)}`,
      `Contrarian review: ${criticText}`,
      missingPasses > 0
        ? `DEGRADED SYNTHESIS: ${missingPasses} missing pass result(s). State the gap explicitly and never fabricate consensus.`
        : 'All configured passes completed.',
      'Reconcile disagreements, preserve uncertainty, cite only curated sources, describe changes from a prior run when supplied, and produce the canonical vault report.',
    ].join('\n\n');
  }

  private async runStage(input: {
    run: ResearchProjectRun;
    ownerUserId: number;
    role: 'critic' | 'synthesis';
    ordinal: number;
    profileId: string;
    version: string;
    prompt: string;
    existing?: { id: string };
  }) {
    const evidence = this.stageEvidence(input.run);
    const job = input.existing ?? await this.repository.createProjectPassJob({
      projectId: input.run.projectId,
      projectRunId: input.run.id,
      ownerUserId: input.ownerUserId,
      question: String(input.run.configSnapshot.question ?? ''),
      role: input.role,
      ordinal: input.ordinal,
      profileId: input.profileId,
      config: { promptVersion: input.version, inputHash: hashInput(evidence), inputArtifactHashes: input.run.artifacts.map((artifact) => artifact.content_hash).filter(Boolean) },
    });
    await this.repository.updateProjectPassJob(job.id, input.ownerUserId, { status: 'synthesizing', error: null });
    let result: Awaited<ReturnType<Runner['run']>>;
    try {
      const prompt = input.role === 'synthesis'
        ? [
            input.prompt,
            `Run ID: ${input.run.id}`,
            `Job ID: ${job.id}`,
            `Pass ID: ${job.id}`,
            `After writing the one canonical synthesis artifact and registering its curated sources, call rhythm_complete_research_pass with version=1, job_id=${job.id}, run_id=${input.run.id}, and pass_id=${job.id}. Do not report completion before that tool succeeds.`,
          ].join('\n\n')
        : input.prompt;
      result = await this.runner.run({
        prompt,
        cwd: process.cwd(),
        outputTarget: 'session',
        agentConfigId: input.profileId,
        agentKind: input.profileId,
        ownerUserId: input.ownerUserId,
        sessionName: `Research ${input.run.id} · ${input.role}`,
        taskKind: 'research',
        onSessionCreated: async (sessionId) => {
          await this.repository.updateProjectPassJob(job.id, input.ownerUserId, { agentSessionId: sessionId });
        },
      });
    } catch (error) {
      result = { sessionId: '', result: '', status: 'error', error: String(error) };
    }
    const current = await this.repository.getProjectPassJob(job.id, input.ownerUserId);
    const currentRun = await this.repository.getProjectRun(input.run.id, input.ownerUserId);
    if (current?.status === 'cancelled' || currentRun?.status === 'cancelled') return current!;
    return (await this.repository.updateProjectPassJob(job.id, input.ownerUserId, {
      status: result.status === 'done' && result.result.trim() ? 'done' : 'error',
      agentSessionId: result.sessionId || null,
      report: result.status === 'done' && result.result.trim() ? result.result : null,
      error: result.status === 'done' && result.result.trim() ? null : result.error ?? `${input.role} returned malformed empty output`,
    }))!;
  }

  async reconcileInterruptedStarts(ownerUserId: number): Promise<ResearchProjectRun[]> {
    const interrupted = await this.repository.listInterruptedProjectRuns(ownerUserId);
    return Promise.all(interrupted.map((run) => this.start(run.id, ownerUserId)));
  }
}
