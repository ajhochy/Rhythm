// ignore_for_file: use_build_context_synchronously
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../tasks/models/task.dart';
import '../controllers/weekly_planner_controller.dart';
import '../models/weekly_plan.dart';

class WeeklyPlannerView extends StatefulWidget {
  const WeeklyPlannerView({super.key});

  @override
  State<WeeklyPlannerView> createState() => _WeeklyPlannerViewState();
}

class _WeeklyPlannerViewState extends State<WeeklyPlannerView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<WeeklyPlannerController>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<WeeklyPlannerController>(
      builder: (context, controller, _) {
        return Column(
          children: [
            _WeekHeader(controller: controller),
            if (controller.status == WeeklyPlannerStatus.error &&
                controller.errorMessage != null)
              _ErrorBanner(
                  message: controller.errorMessage!, onRetry: controller.load),
            Expanded(child: _PlannerBody(controller: controller)),
          ],
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Header with week navigation
// ---------------------------------------------------------------------------

class _WeekHeader extends StatelessWidget {
  const _WeekHeader({required this.controller});
  final WeeklyPlannerController controller;

  @override
  Widget build(BuildContext context) {
    final label = _formatWeekLabel(controller.currentWeekLabel);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerLow,
        border:
            Border(bottom: BorderSide(color: Theme.of(context).dividerColor)),
      ),
      child: Row(
        children: [
          Text('Weekly Planner',
              style: Theme.of(context).textTheme.headlineSmall),
          const Spacer(),
          IconButton(
            icon: const Icon(Icons.chevron_left),
            tooltip: 'Previous week',
            onPressed: controller.goToPrevWeek,
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Text(label, style: Theme.of(context).textTheme.titleMedium),
          ),
          IconButton(
            icon: const Icon(Icons.chevron_right),
            tooltip: 'Next week',
            onPressed: controller.goToNextWeek,
          ),
          const SizedBox(width: 8),
          OutlinedButton(
            onPressed: controller.isCurrentWeek ? null : controller.goToToday,
            child: const Text('Today'),
          ),
        ],
      ),
    );
  }

  String _formatWeekLabel(String label) {
    // Parse YYYY-WNN → "Week of Mon DD, YYYY"
    final m = RegExp(r'^(\d{4})-W(\d{1,2})$').firstMatch(label);
    if (m == null) return label;
    final year = int.parse(m.group(1)!);
    final week = int.parse(m.group(2)!);
    final jan4 = DateTime.utc(year, 1, 4);
    final mondayWeek1 =
        jan4.subtract(Duration(days: (jan4.weekday - 1 + 7) % 7));
    final monday = mondayWeek1.add(Duration(days: (week - 1) * 7));
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ];
    return 'Week of ${months[monday.month - 1]} ${monday.day}, ${monday.year}';
  }
}

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return MaterialBanner(
      content: Text(message),
      actions: [
        TextButton(onPressed: onRetry, child: const Text('Retry')),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Three-pane body
// ---------------------------------------------------------------------------

class _PlannerBody extends StatelessWidget {
  const _PlannerBody({required this.controller});
  final WeeklyPlannerController controller;

  @override
  Widget build(BuildContext context) {
    if (controller.status == WeeklyPlannerStatus.loading &&
        controller.plan == null) {
      return const Center(child: CircularProgressIndicator());
    }
    final plan = controller.plan;
    if (plan == null) {
      return const Center(child: Text('No plan loaded.'));
    }

    final selectedTask = controller.selectedTaskId != null
        ? plan.days.expand((d) => d.tasks).cast<Task?>().firstWhere(
            (t) => t?.id == controller.selectedTaskId,
            orElse: () => null)
        : null;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Left: Backlog
        SizedBox(
          width: 240,
          child: _BacklogPane(plan: plan, controller: controller),
        ),
        VerticalDivider(width: 1, color: Theme.of(context).dividerColor),
        // Center: Day columns
        Expanded(
          child: _DayColumnsPane(plan: plan, controller: controller),
        ),
        // Right: Detail panel (only when a task is selected)
        if (selectedTask != null) ...[
          VerticalDivider(width: 1, color: Theme.of(context).dividerColor),
          SizedBox(
            width: 280,
            child: _DetailPane(task: selectedTask, controller: controller),
          ),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Backlog pane
// ---------------------------------------------------------------------------

class _BacklogPane extends StatelessWidget {
  const _BacklogPane({required this.plan, required this.controller});
  final WeeklyPlan plan;
  final WeeklyPlannerController controller;

  @override
  Widget build(BuildContext context) {
    final backlog = plan.backlog;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Row(
            children: [
              Text('Backlog',
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(width: 6),
              if (backlog.isNotEmpty)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text('${backlog.length}',
                      style: Theme.of(context).textTheme.labelSmall),
                ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: backlog.isEmpty
              ? const Center(
                  child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Text('All tasks scheduled',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.grey)),
                ))
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: backlog.length,
                  itemBuilder: (context, i) => _BacklogTaskTile(
                      task: backlog[i], controller: controller),
                ),
        ),
      ],
    );
  }
}

class _BacklogTaskTile extends StatelessWidget {
  const _BacklogTaskTile({required this.task, required this.controller});
  final Task task;
  final WeeklyPlannerController controller;

  @override
  Widget build(BuildContext context) {
    return Draggable<Task>(
      data: task,
      feedback: Material(
        elevation: 4,
        borderRadius: BorderRadius.circular(6),
        child: Container(
          width: 200,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.primaryContainer,
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(task.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall),
        ),
      ),
      childWhenDragging: Opacity(
        opacity: 0.4,
        child: _taskCard(context),
      ),
      child: GestureDetector(
        onTap: () => controller.selectTask(task.id),
        child: _taskCard(context),
      ),
    );
  }

  Widget _taskCard(BuildContext context) {
    final isSelected = controller.selectedTaskId == task.id;
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: isSelected
            ? Theme.of(context).colorScheme.primaryContainer
            : Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(
          color: isSelected
              ? Theme.of(context).colorScheme.primary
              : Colors.transparent,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(task.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall),
          if (task.dueDate != null) ...[
            const SizedBox(height: 4),
            Text('Due ${task.dueDate}',
                style: Theme.of(context)
                    .textTheme
                    .labelSmall
                    ?.copyWith(color: Colors.grey)),
          ],
          if (task.sourceType != null) ...[
            const SizedBox(height: 2),
            _SourceChip(sourceType: task.sourceType!),
          ],
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Day columns pane
// ---------------------------------------------------------------------------

class _DayColumnsPane extends StatelessWidget {
  const _DayColumnsPane({required this.plan, required this.controller});
  final WeeklyPlan plan;
  final WeeklyPlannerController controller;

  static const _dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: List.generate(plan.days.length, (i) {
        final day = plan.days[i];
        final scheduled = plan.tasksForDate(day.date);
        return Expanded(
          child: _DayColumn(
            dayName: _dayNames[i],
            date: day.date,
            tasks: scheduled,
            controller: controller,
          ),
        );
      }),
    );
  }
}

class _DayColumn extends StatefulWidget {
  const _DayColumn({
    required this.dayName,
    required this.date,
    required this.tasks,
    required this.controller,
  });
  final String dayName;
  final String date;
  final List<Task> tasks;
  final WeeklyPlannerController controller;

  @override
  State<_DayColumn> createState() => _DayColumnState();
}

class _DayColumnState extends State<_DayColumn> {
  bool _hovering = false;

  @override
  Widget build(BuildContext context) {
    final today = _isToday(widget.date);
    return DragTarget<Task>(
      onWillAcceptWithDetails: (_) {
        setState(() => _hovering = true);
        return true;
      },
      onLeave: (_) => setState(() => _hovering = false),
      onAcceptWithDetails: (details) {
        setState(() => _hovering = false);
        widget.controller.scheduleTask(details.data.id, widget.date);
      },
      builder: (context, candidateData, _) {
        return AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          decoration: BoxDecoration(
            color: _hovering
                ? Theme.of(context)
                    .colorScheme
                    .primaryContainer
                    .withValues(alpha: 0.3)
                : null,
            border: Border(
              right: BorderSide(color: Theme.of(context).dividerColor),
            ),
          ),
          child: Column(
            children: [
              // Day header
              Container(
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: today
                      ? Theme.of(context).colorScheme.primaryContainer
                      : Theme.of(context).colorScheme.surfaceContainerLow,
                  border: Border(
                      bottom:
                          BorderSide(color: Theme.of(context).dividerColor)),
                ),
                child: Column(
                  children: [
                    Text(widget.dayName,
                        style: Theme.of(context)
                            .textTheme
                            .labelSmall
                            ?.copyWith(fontWeight: FontWeight.bold)),
                    Text(_shortDate(widget.date),
                        style: Theme.of(context).textTheme.labelSmall),
                  ],
                ),
              ),
              // Tasks
              Expanded(
                child: widget.tasks.isEmpty
                    ? Center(
                        child: Text('—',
                            style: TextStyle(color: Colors.grey[400])))
                    : ListView.builder(
                        padding: const EdgeInsets.all(6),
                        itemCount: widget.tasks.length,
                        itemBuilder: (context, i) => _ScheduledTaskTile(
                          task: widget.tasks[i],
                          controller: widget.controller,
                        ),
                      ),
              ),
            ],
          ),
        );
      },
    );
  }

  bool _isToday(String date) {
    final now = DateTime.now();
    final today =
        '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    return date == today;
  }

  String _shortDate(String date) {
    // YYYY-MM-DD → M/D
    final parts = date.split('-');
    if (parts.length != 3) return date;
    return '${int.parse(parts[1])}/${int.parse(parts[2])}';
  }
}

class _ScheduledTaskTile extends StatelessWidget {
  const _ScheduledTaskTile({required this.task, required this.controller});
  final Task task;
  final WeeklyPlannerController controller;

  @override
  Widget build(BuildContext context) {
    final isSelected = controller.selectedTaskId == task.id;
    return GestureDetector(
      onTap: () => controller.selectTask(task.id),
      child: Container(
        margin: const EdgeInsets.only(bottom: 4),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected
              ? Theme.of(context).colorScheme.primaryContainer
              : Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(4),
          border: Border.all(
            color: isSelected
                ? Theme.of(context).colorScheme.primary
                : Colors.transparent,
          ),
        ),
        child: Row(
          children: [
            if (task.locked)
              Padding(
                padding: const EdgeInsets.only(right: 4),
                child: Icon(Icons.lock,
                    size: 12, color: Theme.of(context).colorScheme.primary),
              ),
            Expanded(
              child: Text(
                task.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
            if (task.sourceType != null)
              _SourceChip(sourceType: task.sourceType!),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Detail pane
// ---------------------------------------------------------------------------

class _DetailPane extends StatelessWidget {
  const _DetailPane({required this.task, required this.controller});
  final Task task;
  final WeeklyPlannerController controller;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 8, 8),
          child: Row(
            children: [
              Expanded(
                child: Text('Task Details',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.bold)),
              ),
              IconButton(
                icon: const Icon(Icons.close, size: 18),
                onPressed: () => controller.selectTask(null),
              ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(task.title,
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 12),
                _detailRow(context, 'Status', task.status.toUpperCase()),
                if (task.dueDate != null)
                  _detailRow(context, 'Due', task.dueDate!),
                if (task.scheduledDate != null)
                  _detailRow(context, 'Scheduled', task.scheduledDate!),
                _detailRow(context, 'Locked', task.locked ? 'Yes' : 'No'),
                if (task.sourceType != null)
                  _detailRow(context, 'Source', task.sourceType!),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _detailRow(BuildContext context, String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 80,
            child: Text(label,
                style: Theme.of(context)
                    .textTheme
                    .labelSmall
                    ?.copyWith(color: Colors.grey)),
          ),
          Expanded(
            child: Text(value, style: Theme.of(context).textTheme.bodySmall),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Shared widgets
// ---------------------------------------------------------------------------

class _SourceChip extends StatelessWidget {
  const _SourceChip({required this.sourceType});
  final String sourceType;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (sourceType) {
      'recurring_rule' => ('R', Colors.blue),
      'project_step' => ('P', Colors.green),
      _ => ('T', Colors.grey),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(3),
      ),
      child: Text(label,
          style: TextStyle(
              fontSize: 10, fontWeight: FontWeight.bold, color: color)),
    );
  }
}
