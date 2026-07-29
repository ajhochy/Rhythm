import 'package:flutter/material.dart';

import '../../../app/core/ui/rhythm_ui.dart';
import '../../../app/core/widgets/error_banner.dart';
import '../controllers/tasks_controller.dart';
import '../models/task.dart';

class TasksKanbanView extends StatelessWidget {
  const TasksKanbanView({
    required this.controller,
    required this.tasks,
    super.key,
  });

  final TasksController controller;
  final List<Task> tasks;

  static const _columns = [
    (TaskStatus.open, 'Open', Icons.radio_button_unchecked),
    (TaskStatus.inProgress, 'In progress', Icons.autorenew),
    (
      TaskStatus.waitingForReply,
      'Waiting for reply',
      Icons.hourglass_top_outlined,
    ),
    (TaskStatus.done, 'Done', Icons.check_circle_outline),
  ];

  @override
  Widget build(BuildContext context) {
    if (controller.status == TasksStatus.loading && controller.tasks.isEmpty) {
      return const RhythmEmptyState(
        key: ValueKey('kanban-loading-state'),
        title: 'Loading tasks...',
        tone: RhythmEmptyStateTone.loading,
      );
    }
    if (controller.status == TasksStatus.error && controller.tasks.isEmpty) {
      return RhythmEmptyState.error(
        key: const ValueKey('kanban-error-state'),
        title: 'Unable to load tasks',
        message: controller.errorMessage ?? 'Unknown error',
        actionLabel: 'Retry',
        onAction: controller.load,
      );
    }

    final board = SingleChildScrollView(
      key: const ValueKey('tasks-kanban-board'),
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.all(RhythmSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var index = 0; index < _columns.length; index++) ...[
            SizedBox(
              width: 280,
              child: _KanbanColumn(
                status: _columns[index].$1,
                title: _columns[index].$2,
                icon: _columns[index].$3,
                tasks: _tasksForStatus(_columns[index].$1),
                onAccept: (task) =>
                    controller.updateStatus(task.id, _columns[index].$1),
              ),
            ),
            if (index != _columns.length - 1)
              const SizedBox(width: RhythmSpacing.md),
          ],
        ],
      ),
    );
    if (controller.status != TasksStatus.error) return board;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            RhythmSpacing.md,
            RhythmSpacing.sm,
            RhythmSpacing.md,
            0,
          ),
          child: ErrorBanner(
            message: controller.errorMessage ?? 'Unknown error',
            onRetry: controller.load,
          ),
        ),
        Expanded(child: board),
      ],
    );
  }

  List<Task> _tasksForStatus(TaskStatus status) {
    final columnTasks = tasks.where((task) => task.status == status).toList()
      ..sort(compareKanbanTasks);
    return columnTasks;
  }
}

int compareKanbanTasks(Task left, Task right) {
  final orderComparison = _nullableIntComparison(
    left.scheduledOrder,
    right.scheduledOrder,
  );
  if (orderComparison != 0) return orderComparison;

  final dueComparison = _nullableStringComparison(left.dueDate, right.dueDate);
  if (dueComparison != 0) return dueComparison;
  return left.title.toLowerCase().compareTo(right.title.toLowerCase());
}

int _nullableIntComparison(int? left, int? right) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left.compareTo(right);
}

int _nullableStringComparison(String? left, String? right) {
  final normalizedLeft =
      left == null || left.trim().isEmpty ? null : left.trim();
  final normalizedRight =
      right == null || right.trim().isEmpty ? null : right.trim();
  if (normalizedLeft == null && normalizedRight == null) return 0;
  if (normalizedLeft == null) return 1;
  if (normalizedRight == null) return -1;
  return normalizedLeft.compareTo(normalizedRight);
}

class _KanbanColumn extends StatelessWidget {
  const _KanbanColumn({
    required this.status,
    required this.title,
    required this.icon,
    required this.tasks,
    required this.onAccept,
  });

  final TaskStatus status;
  final String title;
  final IconData icon;
  final List<Task> tasks;
  final ValueChanged<Task> onAccept;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DragTarget<Task>(
      key: ValueKey('kanban-column-${status.toJson()}'),
      onWillAcceptWithDetails: (details) => details.data.status != status,
      onAcceptWithDetails: (details) => onAccept(details.data),
      builder: (context, candidates, rejected) {
        final highlighted = candidates.isNotEmpty;
        return AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          padding: const EdgeInsets.all(RhythmSpacing.sm),
          decoration: BoxDecoration(
            color: highlighted
                ? colors.primary.withValues(alpha: 0.08)
                : colors.surfaceContainerLowest,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: highlighted
                  ? colors.primary
                  : colors.outlineVariant.withValues(alpha: 0.8),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 2, 4, 10),
                child: Row(
                  children: [
                    Icon(icon, size: 17, color: colors.onSurfaceVariant),
                    const SizedBox(width: 7),
                    Expanded(
                      child: Text(
                        title,
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                              color: colors.onSurface,
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                    ),
                    Text(
                      '${tasks.length}',
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                            color: colors.onSurfaceVariant,
                          ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: tasks.isEmpty
                    ? _ColumnEmptyState(title: title)
                    : ListView.separated(
                        key: ValueKey(
                          'kanban-column-${status.toJson()}-cards',
                        ),
                        itemCount: tasks.length,
                        separatorBuilder: (_, __) =>
                            const SizedBox(height: RhythmSpacing.sm),
                        itemBuilder: (context, index) {
                          final task = tasks[index];
                          return LongPressDraggable<Task>(
                            key: ValueKey('kanban-draggable-${task.id}'),
                            data: task,
                            feedback: Material(
                              color: Colors.transparent,
                              child: SizedBox(
                                width: 264,
                                child: _KanbanCard(task: task, elevated: true),
                              ),
                            ),
                            childWhenDragging: Opacity(
                              opacity: 0.35,
                              child: _KanbanCard(task: task),
                            ),
                            child: _KanbanCard(task: task),
                          );
                        },
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _ColumnEmptyState extends StatelessWidget {
  const _ColumnEmptyState({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(RhythmSpacing.md),
        child: Text(
          'No tasks in $title',
          key: ValueKey('kanban-empty-${title.toLowerCase()}'),
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: colors.onSurfaceVariant,
              ),
        ),
      ),
    );
  }
}

class _KanbanCard extends StatelessWidget {
  const _KanbanCard({required this.task, this.elevated = false});

  final Task task;
  final bool elevated;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final preferredAgent = task.preferredAgent?.trim();
    return Container(
      key: ValueKey('kanban-card-${task.id}'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: colors.outlineVariant),
        boxShadow: elevated
            ? [
                BoxShadow(
                  color: colors.shadow.withValues(alpha: 0.14),
                  blurRadius: 12,
                  offset: const Offset(0, 5),
                ),
              ]
            : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            task.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: colors.onSurface,
                  fontWeight: FontWeight.w600,
                ),
          ),
          if (task.dueDate?.trim().isNotEmpty == true ||
              preferredAgent?.isNotEmpty == true) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                if (task.dueDate?.trim().isNotEmpty == true)
                  Chip(
                    avatar: const Icon(Icons.event_outlined, size: 14),
                    label: Text(_formatDueDate(task.dueDate!)),
                    visualDensity: VisualDensity.compact,
                  ),
                if (preferredAgent?.isNotEmpty == true)
                  Chip(
                    avatar: Icon(
                      Icons.smart_toy_outlined,
                      size: 14,
                      color: colors.primary,
                    ),
                    label: Text(preferredAgent!),
                    visualDensity: VisualDensity.compact,
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

String _formatDueDate(String value) {
  final trimmed = value.trim();
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(trimmed);
  if (match == null) return trimmed;
  return '${match.group(2)}/${match.group(3)}/${match.group(1)}';
}
