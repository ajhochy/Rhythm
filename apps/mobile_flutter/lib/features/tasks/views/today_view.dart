import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/tasks_controller.dart';
import '../models/task.dart';
import 'widgets/section_header.dart';
import 'widgets/task_list_item.dart';

/// The main Today tab — three sections (Overdue / Today / Completed today),
/// pull-to-refresh, loading, empty and error states.
class TodayView extends StatefulWidget {
  const TodayView({super.key});

  @override
  State<TodayView> createState() => _TodayViewState();
}

class _TodayViewState extends State<TodayView> {
  @override
  void initState() {
    super.initState();
    // Trigger initial load if the cache is empty.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final controller = context.read<TasksController>();
      if (controller.tasks.isEmpty) {
        controller.load();
      }
    });
  }

  List<Task> _sorted(List<Task> tasks) {
    final copy = List<Task>.of(tasks);
    copy.sort((a, b) {
      // 1. dueDate ASC (nulls last).
      final aDue = DateTime.tryParse(a.dueDate ?? '');
      final bDue = DateTime.tryParse(b.dueDate ?? '');
      if (aDue != null && bDue != null) {
        final cmp = aDue.compareTo(bDue);
        if (cmp != 0) return cmp;
      } else if (aDue == null && bDue != null) {
        return 1;
      } else if (aDue != null && bDue == null) {
        return -1;
      }
      // 2. scheduledOrder ASC (nulls last).
      final aOrd = a.scheduledOrder;
      final bOrd = b.scheduledOrder;
      if (aOrd != null && bOrd != null) {
        final cmp = aOrd.compareTo(bOrd);
        if (cmp != 0) return cmp;
      } else if (aOrd == null && bOrd != null) {
        return 1;
      } else if (aOrd != null && bOrd == null) {
        return -1;
      }
      // 3. createdAt ASC.
      return a.createdAt.compareTo(b.createdAt);
    });
    return copy;
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<TasksController>();
    final colors = context.rhythm;

    // Loading state — only show spinner when list is truly empty.
    if (controller.status == TasksStatus.loading && controller.tasks.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    // Error state.
    if (controller.status == TasksStatus.error) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(RhythmSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline, color: colors.danger, size: 40),
              const SizedBox(height: RhythmSpacing.md),
              Text(
                controller.errorMessage ?? 'Something went wrong.',
                textAlign: TextAlign.center,
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: colors.danger),
              ),
              const SizedBox(height: RhythmSpacing.lg),
              FilledButton(
                onPressed: controller.load,
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }

    final overdue = _sorted(controller.overdueTasks);
    final today = _sorted(controller.todayTasks);
    final completed = _sorted(controller.completedTodayTasks);
    final hasAny =
        overdue.isNotEmpty || today.isNotEmpty || completed.isNotEmpty;

    return Scaffold(
      backgroundColor: colors.canvas,
      appBar: AppBar(
        title: Text(
          'Today',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
      ),
      body: RefreshIndicator(
        onRefresh: controller.load,
        color: colors.accent,
        child: hasAny
            ? ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  if (overdue.isNotEmpty) ...[
                    SectionHeader(
                      label: 'Overdue',
                      color: colors.danger,
                    ),
                    ...overdue.map(
                      (t) => TaskListItem(
                        task: t,
                        onToggle: () => controller.toggleDone(t.id),
                      ),
                    ),
                  ],
                  if (today.isNotEmpty) ...[
                    const SectionHeader(label: 'Today'),
                    ...today.map(
                      (t) => TaskListItem(
                        task: t,
                        onToggle: () => controller.toggleDone(t.id),
                      ),
                    ),
                  ],
                  if (completed.isNotEmpty) ...[
                    const SectionHeader(label: 'Completed today'),
                    ...completed.map(
                      (t) => TaskListItem(
                        task: t,
                        onToggle: () => controller.toggleDone(t.id),
                      ),
                    ),
                  ],
                  const SizedBox(height: RhythmSpacing.xl),
                ],
              )
            : ListView(
                // Wrapping in ListView keeps pull-to-refresh functional.
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  SizedBox(
                    height: MediaQuery.of(context).size.height * 0.5,
                    child: Center(
                      child: Text(
                        'Nothing due today — nice work.',
                        style: Theme.of(context)
                            .textTheme
                            .bodyMedium
                            ?.copyWith(color: colors.textMuted),
                      ),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}
