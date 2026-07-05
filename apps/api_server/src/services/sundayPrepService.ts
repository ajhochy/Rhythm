/**
 * Sunday Prep Service — #896
 *
 * Replaces "one long unbounded Sunday-morning-prep session" with 4 small,
 * bounded specialist scheduled tasks, staggered 10 minutes apart on Saturday
 * night so each one finishes well before the next starts. Each specialist
 * has a documented (prompt-level) turn budget and an explicit exit
 * condition; a failed exit condition tells the agent to notify immediately
 * rather than pass silently.
 *
 * Chaining mechanism: rather than inventing a new file/handoff format, each
 * specialist reads and writes a single shared Rhythm Task ("Sunday Prep —
 * <date>") via the existing rhythm_create_task / rhythm_get_task_thread /
 * rhythm_update_task tools — the PCO checker creates it, the later three
 * append their section to its notes. This reuses existing infra instead of
 * adding a new blackboard mechanism.
 *
 * Seeded once on startup (idempotent — checks existing task names first),
 * same pattern as agentMemoryService.seedConsolidationTask().
 */

import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { logger } from '../utils/logger';

const schedRepo = new AgentScheduledTasksRepository();

const SHARED_TASK_INSTRUCTIONS =
  'A shared Rhythm task titled "Sunday Prep — <the upcoming Sunday\'s date>" ' +
  'is this pipeline\'s handoff point. If it does not exist yet, create it ' +
  '(rhythm_create_task). Read its current notes (rhythm_get_task_thread) ' +
  'before you start, then append your own "## <your section>" heading with ' +
  'your findings (rhythm_update_task) — never overwrite another section.';

interface SundayPrepTaskSpec {
  name: string;
  description: string;
  scheduledTime: string;
  prompt: string;
  allowedMcpsJson: string[];
}

const TASKS: SundayPrepTaskSpec[] = [
  {
    name: 'Sunday Prep — PCO Checker',
    description: 'Bounded specialist (~10 turns): confirms Sunday staffing is complete.',
    scheduledTime: '22:00',
    allowedMcpsJson: ['rhythm', 'pco-services'],
    prompt: `You are the PCO Checker specialist in the Sunday Prep pipeline. Budget: ~10 turns.

Your job:
1. Find this Sunday's plan(s) via rhythm_pco_list_plans / rhythm_pco_list_service_types.
2. Call rhythm_pco_list_needed_positions for each relevant plan — any unfilled position is a staffing gap.
3. Check for declines in the last 24h via rhythm_pco_get_plan_items / team member status if available.
4. Write a "## PCO Staffing" section to the shared task with a pass/fail staffing status and any unfilled positions or recent declines.

${SHARED_TASK_INSTRUCTIONS}

Exit condition: if any position is unfilled or a decline is unresolved, call rhythm_notify immediately with a clear alert — do not wait for the briefing composer to surface it. Otherwise report "staffing complete" and stop.`,
  },
  {
    name: 'Sunday Prep — Email Triage',
    description: 'Bounded specialist (~8 turns): flags urgent Sunday-related emails for human review.',
    scheduledTime: '22:10',
    allowedMcpsJson: ['rhythm', 'gmail-work'],
    prompt: `You are the Email Triage specialist in the Sunday Prep pipeline. Budget: ~8 turns.

Your job:
1. Search recent email (rhythm_search_gmail) for anything about this Sunday — cancellations, last-minute changes, urgent requests.
2. Flag any thread that needs human attention before Sunday morning.
3. Write a "## Email Triage" section to the shared task listing flagged threads (subject + why it matters), or "no urgent emails" if none.

${SHARED_TASK_INSTRUCTIONS}

Exit condition: if you find anything time-sensitive (e.g. a same-day cancellation), call rhythm_notify immediately in addition to logging it. Otherwise just log and stop.`,
  },
  {
    name: 'Sunday Prep — ProPresenter Verifier',
    description: 'Bounded specialist (~6 turns): confirms songs are loaded and keys match PCO.',
    scheduledTime: '22:20',
    allowedMcpsJson: ['rhythm', 'propresenter'],
    prompt: `You are the ProPresenter Verifier specialist in the Sunday Prep pipeline. Budget: ~6 turns.

Your job:
1. Read the shared task's "## PCO Staffing" section (rhythm_get_task_thread) for this Sunday's song list. If not noted there, use rhythm_pco_get_plan_items for the plan's song titles.
2. Use the ProPresenter tools (library_get / playlists_get_all / presentation lookups) to confirm each song is loaded in the library.
3. Write a "## ProPresenter Verification" section to the shared task: pass/fail per song, with any missing songs called out.

${SHARED_TASK_INSTRUCTIONS}

Exit condition: if a song is missing from ProPresenter or a key mismatch is found, call rhythm_notify immediately. Otherwise report "all songs verified" and stop.`,
  },
  {
    name: 'Sunday Prep — Morning Briefing Composer',
    description: 'Bounded specialist (~5 turns): synthesizes the pipeline into one summary notification.',
    scheduledTime: '22:30',
    allowedMcpsJson: ['rhythm'],
    prompt: `You are the Morning Briefing Composer, the final specialist in the Sunday Prep pipeline. Budget: ~5 turns.

Your job:
1. Read the full shared "Sunday Prep — <date>" task (rhythm_get_task_thread) — it should now have PCO Staffing, Email Triage, and ProPresenter Verification sections.
2. Synthesize a single, short morning briefing: overall go/no-go, and any items that still need attention.
3. Call rhythm_notify with the briefing as the body, even if everything passed (a quiet "all clear" is still useful signal).

If any of the three prior sections is missing (that specialist didn't run or failed), say so explicitly in the briefing rather than silently omitting it — a gap in the pipeline is itself worth surfacing.`,
  },
];

export const sundayPrepService = {
  /**
   * Seed all 4 Sunday Prep scheduled tasks on first startup. Idempotent —
   * skips any task whose name already exists. Safe to call on every
   * startup, same convention as agentMemoryService's seed functions.
   */
  async seedSundayPrepTasks(): Promise<void> {
    const existing = await schedRepo.listAllAsync();
    const existingNames = new Set(existing.map((t) => t.name));

    for (const spec of TASKS) {
      if (existingNames.has(spec.name)) continue;
      await schedRepo.createAsync({
        name: spec.name,
        description: spec.description,
        scheduleType: 'weekly',
        scheduledDay: 6, // Saturday (JS Date: 0=Sunday .. 6=Saturday)
        scheduledTime: spec.scheduledTime,
        timezone: 'America/Los_Angeles',
        prompt: spec.prompt,
        agentKind: 'opencode',
        allowedMcpsJson: JSON.stringify(spec.allowedMcpsJson),
      });
      logger.info(`[SundayPrep] seeded scheduled task "${spec.name}"`);
    }
  },
};
