import type {
  AgentResearchRepository,
  ResearchProjectRun,
} from '../repositories/agent_research_repository';
import * as AgentRunner from './agent_runner';

type Runner = Pick<typeof AgentRunner, 'run'>;
type PassConfig = {
  role?: unknown;
  profileId?: unknown;
  model?: unknown;
  acceptanceBar?: unknown;
};

function modelOverride(value: unknown): { providerID: string; modelID: string } | undefined {
  if (typeof value !== 'string') return undefined;
  const separator = value.indexOf('/');
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) };
}

function passPrompt(run: ResearchProjectRun, pass: PassConfig, ordinal: number): string {
  const snapshot = run.configSnapshot;
  const question = String(snapshot.question ?? '');
  const goals = Array.isArray(snapshot.goals) ? snapshot.goals.map(String) : [];
  const role = typeof pass.role === 'string' ? pass.role : `pass-${ordinal + 1}`;
  const acceptance = typeof pass.acceptanceBar === 'string'
    ? pass.acceptanceBar
    : 'Use authoritative evidence, cite material claims, preserve uncertainty, and register canonical/supporting artifacts and curated sources.';
  return [
    `Research project pass ${ordinal + 1}: ${role}`,
    `Question: ${question}`,
    `Goals:\n${goals.map((goal) => `- ${goal}`).join('\n')}`,
    `Acceptance bar: ${acceptance}`,
    'Work independently. Do not assume or request prose from sibling passes. Use only this shared immutable run configuration and your own source investigation.',
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
    let jobs = await this.repository.listProjectPassJobs(runId, ownerUserId);
    if (
      jobs.length === passConfigs.length &&
      jobs.every((job) => job.status === 'done' || job.status === 'error')
    ) {
      return run;
    }

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
          prompt: passPrompt(run, pass, ordinal),
          cwd: process.cwd(),
          outputTarget: 'session',
          agentConfigId: profileId,
          agentKind: profileId,
          ownerUserId,
          sessionName: `Research ${run.id} · ${role}`,
          taskKind: 'research',
          ...(modelOverride(pass.model) ? { modelOverride: modelOverride(pass.model) } : {}),
        });
      } catch (error) {
        result = { sessionId: '', result: '', status: 'error', error: String(error) };
      }
      await this.repository.updateProjectPassJob(job.id, ownerUserId, {
        status: result.status === 'done' && result.result.trim() ? 'done' : 'error',
        agentSessionId: result.sessionId || null,
        report: result.status === 'done' && result.result.trim() ? result.result : null,
        error: result.status === 'done' && result.result.trim()
          ? null
          : result.error ?? 'Research pass returned no report',
      });
    }

    jobs = await this.repository.listProjectPassJobs(runId, ownerUserId);
    const failed = jobs.filter((job) => job.status === 'error').length;
    const completed = jobs.filter((job) => job.status === 'done').length;
    return (await this.repository.updateProjectRunState(runId, ownerUserId, {
      status: failed > 0 ? 'degraded' : 'passes_complete',
      progress: { totalPasses: passConfigs.length, completedPasses: completed, failedPasses: failed },
      diagnostics: failed > 0 ? { degraded: true, failedPassIds: jobs.filter((job) => job.status === 'error').map((job) => job.id) } : {},
    }))!;
  }

  async reconcileInterruptedStarts(ownerUserId: number): Promise<ResearchProjectRun[]> {
    const interrupted = await this.repository.listInterruptedProjectRuns(ownerUserId);
    return Promise.all(interrupted.map((run) => this.start(run.id, ownerUserId)));
  }
}
