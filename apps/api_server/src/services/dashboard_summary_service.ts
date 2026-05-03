import { MessagesRepository } from '../repositories/messages_repository';
import { ProjectInstancesRepository } from '../repositories/project_instances_repository';
import { ProjectTemplatesRepository } from '../repositories/project_templates_repository';
import { RecurringTaskRulesRepository } from '../repositories/recurring_task_rules_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import type {
  DashboardSummary,
  DashboardRhythmItem,
  DashboardProjectItem,
  DashboardUnreadPreview,
} from '../models/dashboard_summary';
import type { Task } from '../models/task';
import type { RecurringTaskRule } from '../models/recurring_task_rule';
import type { ProjectInstance } from '../models/project_instance';
import type { ProjectTemplate } from '../models/project_template';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function patternDescription(rule: RecurringTaskRule): string {
  if (rule.frequency === 'weekly') {
    return `Every ${DAYS[(rule.dayOfWeek ?? 1) % 7]}`;
  }
  if (rule.frequency === 'monthly') {
    return `Monthly on the ${ordinal(rule.dayOfMonth ?? 1)}`;
  }
  if (rule.frequency === 'annual') {
    const month = rule.month ?? 1;
    return `Annually in ${MONTHS[month] ?? 'January'}`;
  }
  return rule.frequency;
}

function priorityDate(task: Task): Date | null {
  const raw = task.scheduledDate ?? task.dueDate;
  if (!raw) return null;
  return new Date(raw + 'T00:00:00');
}

function stripDate(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfIsoWeek(today: Date): Date {
  const daysUntilSunday = 7 - today.getDay();
  const end = new Date(today);
  end.setDate(today.getDate() + daysUntilSunday);
  return end;
}

function compareTasks(a: Task, b: Task): number {
  const aDate = priorityDate(a) ?? new Date(9999, 0, 1);
  const bDate = priorityDate(b) ?? new Date(9999, 0, 1);
  const dc = aDate.getTime() - bDate.getTime();
  if (dc !== 0) return dc;
  return a.id.localeCompare(b.id);
}

export class DashboardSummaryService {
  private tasksRepo = new TasksRepository();
  private rulesRepo = new RecurringTaskRulesRepository();
  private projectInstancesRepo = new ProjectInstancesRepository();
  private projectTemplatesRepo = new ProjectTemplatesRepository();
  private messagesRepo = new MessagesRepository();

  async getSummaryAsync(userId: number): Promise<DashboardSummary> {
    const [tasks, rules, instances, templates, threads] = await Promise.all([
      this.tasksRepo.findAllAsync(userId),
      this.rulesRepo.findAllAsync(userId),
      this.projectInstancesRepo.findAllAsync(userId),
      this.projectTemplatesRepo.findAllAsync(userId),
      this.messagesRepo.findAllThreadsForUserAsync(userId),
    ]);

    const now = new Date();
    const today = stripDate(now);
    const weekEnd = endOfIsoWeek(today);

    // ── Tasks ──────────────────────────────────────────────────────────────────
    const openTasks = tasks.filter((t) => t.status !== 'done');

    const pastDue = openTasks.filter((t) => {
      const d = priorityDate(t);
      return d != null && d < today;
    }).sort(compareTasks);

    const todayOpen = openTasks.filter((t) => {
      const d = priorityDate(t);
      return d != null && d.getTime() === today.getTime();
    }).sort(compareTasks);

    const todayAll = tasks.filter((t) => {
      const d = priorityDate(t);
      return d != null && d.getTime() === today.getTime();
    });

    const thisWeekOpen = openTasks.filter((t) => {
      const d = priorityDate(t);
      return d != null && d > today && d <= weekEnd;
    }).sort(compareTasks);

    const thisWeekAll = tasks.filter((t) => {
      const d = priorityDate(t);
      return d != null && d > today && d <= weekEnd;
    });

    const unscheduled = openTasks
      .filter((t) => t.dueDate == null && t.scheduledDate == null)
      .sort((a, b) => b.id.localeCompare(a.id));

    const recent = [...openTasks].sort(compareTasks).slice(0, 5);

    // ── Rhythms ────────────────────────────────────────────────────────────────
    const rhythmItems: DashboardRhythmItem[] = [];
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const ruleTasks = tasks.filter(
        (t) =>
          t.sourceType === 'recurring_rule' &&
          t.sourceId != null &&
          (t.sourceId === rule.id || t.sourceId.startsWith(`${rule.id}:`)),
      );
      const completed = ruleTasks.filter((t) => t.status === 'done').length;
      rhythmItems.push({
        id: rule.id,
        title: rule.title,
        subtitle: patternDescription(rule),
        completedCount: completed,
        totalCount: ruleTasks.length,
      });
    }
    rhythmItems.sort((a, b) => {
      const pa = a.totalCount > 0 ? a.completedCount / a.totalCount : 0;
      const pb = b.totalCount > 0 ? b.completedCount / b.totalCount : 0;
      const pc = pa - pb;
      if (pc !== 0) return pc;
      return a.title.localeCompare(b.title);
    });

    // ── Projects ───────────────────────────────────────────────────────────────
    const templatesById = new Map<string, ProjectTemplate>(
      templates.map((t) => [t.id, t]),
    );
    const projectItems: DashboardProjectItem[] = buildProjectItems(instances, templatesById);

    // ── Messages ───────────────────────────────────────────────────────────────
    const unreadThreads = threads
      .filter((th) => th.unreadCount > 0)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 3);

    const unreadPreviews: DashboardUnreadPreview[] = [];
    for (const thread of unreadThreads) {
      const messages = await this.messagesRepo.findMessagesByThreadAsync(thread.id, userId);
      if (messages.length === 0) continue;
      const latest = messages[messages.length - 1];
      unreadPreviews.push({
        threadId: thread.id,
        threadTitle: thread.title,
        senderName: latest.senderName,
        preview: latest.body,
        updatedAt: latest.createdAt,
        unreadCount: thread.unreadCount,
      });
    }

    return {
      tasks: {
        openCount: openTasks.length,
        pastDueCount: pastDue.length,
        todayRemainingCount: todayOpen.length,
        todayTotalCount: todayAll.length,
        thisWeekRemainingCount: thisWeekOpen.length,
        thisWeekTotalCount: thisWeekAll.length,
        unscheduledCount: unscheduled.length,
        recent,
        pastDue,
        today: todayOpen,
        thisWeek: thisWeekOpen,
        unscheduled,
      },
      rhythms: {
        activeCount: rhythmItems.length,
        items: rhythmItems,
      },
      projects: {
        activeCount: projectItems.length,
        items: projectItems,
      },
      messages: {
        threadCount: threads.length,
        unreadPreviews,
      },
    };
  }
}

function buildProjectItems(
  instances: ProjectInstance[],
  templatesById: Map<string, ProjectTemplate>,
): DashboardProjectItem[] {
  const items: DashboardProjectItem[] = [];
  for (const instance of instances) {
    if (instance.status === 'done') continue;
    const sortedSteps = [...instance.steps].sort((a, b) => {
      const aDate = a.dueDate ? new Date(a.dueDate).getTime() : 9e15;
      const bDate = b.dueDate ? new Date(b.dueDate).getTime() : 9e15;
      return aDate - bDate || a.title.localeCompare(b.title);
    });
    const completed = sortedSteps.filter((s) => s.status === 'done').length;
    const template = templatesById.get(instance.templateId);
    const title =
      instance.name?.trim() || template?.name || `Project ${instance.anchorDate}`;
    const nextDueDates = sortedSteps
      .filter((s) => s.status !== 'done')
      .map((s) => s.dueDate)
      .filter(Boolean) as string[];
    items.push({
      id: instance.id,
      title,
      subtitle: `${completed} of ${sortedSteps.length} step${sortedSteps.length === 1 ? '' : 's'} complete`,
      completedCount: completed,
      totalCount: sortedSteps.length,
      nextDueDate: nextDueDates[0] ?? null,
    });
  }
  items.sort((a, b) => {
    const aDate = a.nextDueDate ? new Date(a.nextDueDate).getTime() : 9e15;
    const bDate = b.nextDueDate ? new Date(b.nextDueDate).getTime() : 9e15;
    const dc = aDate - bDate;
    if (dc !== 0) return dc;
    const pa = a.totalCount > 0 ? a.completedCount / a.totalCount : 0;
    const pb = b.totalCount > 0 ? b.completedCount / b.totalCount : 0;
    const pc = pa - pb;
    if (pc !== 0) return pc;
    return a.title.localeCompare(b.title);
  });
  return items;
}
