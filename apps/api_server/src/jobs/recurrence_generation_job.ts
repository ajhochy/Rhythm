import cron from 'node-cron';
import { RecurrenceService } from '../services/recurrence_service';
import { RecurringTaskRulesRepository } from '../repositories/recurring_task_rules_repository';
import { logger } from '../utils/logger';

const DEFAULT_LOOKAHEAD_WEEKS = 8;
const DEFAULT_CRON_SCHEDULE = '0 0 * * 0'; // Every Sunday at midnight

function getLookaheadWeeks(): number {
  const val = parseInt(process.env.RECURRENCE_LOOKAHEAD_WEEKS ?? '', 10);
  return isNaN(val) ? DEFAULT_LOOKAHEAD_WEEKS : val;
}

function getCronSchedule(): string {
  return process.env.RECURRENCE_CRON_SCHEDULE ?? DEFAULT_CRON_SCHEDULE;
}

export async function runRecurrenceGenerationOnce(
  from: Date = new Date(),
  to?: Date,
): Promise<{ ruleCount: number; createdCount: number }> {
  const rules =
    await new RecurringTaskRulesRepository().findEnabledForGenerationAsync();
  if (rules.length === 0) return { ruleCount: 0, createdCount: 0 };

  const service = new RecurrenceService();
  const end = to ?? new Date(from);
  if (to == null) {
    end.setUTCDate(end.getUTCDate() + getLookaheadWeeks() * 7);
  }

  let total = 0;
  for (const rule of rules) {
    const created = await service.generateInstances(rule, from, end);
    total += created.length;
  }

  return { ruleCount: rules.length, createdCount: total };
}

async function runGeneration(): Promise<void> {
  try {
    const result = await runRecurrenceGenerationOnce();
    if (result.ruleCount === 0) return;

    logger.info(
      `RecurrenceGenerationJob: created ${result.createdCount} task(s) for ${result.ruleCount} rule(s)`,
    );
  } catch (err) {
    logger.error(`RecurrenceGenerationJob error: ${String(err)}`);
  }
}

export function startRecurrenceGenerationJob(): void {
  // Run immediately on startup
  void runGeneration();

  // Schedule recurring runs
  const schedule = getCronSchedule();
  cron.schedule(schedule, () => {
    logger.info('RecurrenceGenerationJob: running scheduled generation');
    void runGeneration();
  });

  logger.info(`RecurrenceGenerationJob: scheduled with cron "${schedule}", lookahead ${getLookaheadWeeks()} weeks`);
}
