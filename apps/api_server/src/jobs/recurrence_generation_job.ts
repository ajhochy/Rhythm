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

async function runGeneration(): Promise<void> {
  try {
    const rules = (await new RecurringTaskRulesRepository().findAllAsync()).filter(
      (r) => r.enabled,
    );
    if (rules.length === 0) return;

    const service = new RecurrenceService();
    const from = new Date();
    const to = new Date();
    to.setUTCDate(to.getUTCDate() + getLookaheadWeeks() * 7);

    let total = 0;
    for (const rule of rules) {
      const created = await service.generateInstances(rule, from, to);
      total += created.length;
    }

    logger.info(`RecurrenceGenerationJob: created ${total} task(s) for ${rules.length} rule(s)`);
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
