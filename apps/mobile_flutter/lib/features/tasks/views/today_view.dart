import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/tasks_controller.dart';
import '../models/task.dart';
import 'widgets/section_header.dart';
import 'widgets/task_list_item.dart';

/// The main Today tab — three sections (Overdue / Today / Completed today),
/// pull-to-refresh, loading, empty and error states.
///
/// When [highlightTaskId] is non-null the view scrolls to the matching task
/// and briefly highlights it with a 1.5s fade-out tint. Once handled,
/// [onHighlightHandled] is called so the shell can clear pending state.
class TodayView extends StatefulWidget {
  const TodayView({
    super.key,
    this.highlightTaskId,
    this.onHighlightHandled,
  });

  /// The task id to scroll-to and highlight, or `null` for no highlight.
  final String? highlightTaskId;

  /// Called once the highlight has finished (or immediately if the task is
  /// not found in the list).
  final VoidCallback? onHighlightHandled;

  @override
  State<TodayView> createState() => _TodayViewState();
}

class _TodayViewState extends State<TodayView> {
  /// One [GlobalKey] per rendered task id — rebuilt each time the list changes.
  final Map<String, GlobalKey> _itemKeys = {};

  /// The task id currently being highlighted (drives [_HighlightItem]).
  String? _activeHighlightId;

  /// Tracks which highlight request we last acted on to avoid double-firing.
  String? _lastHandledHighlightId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final controller = context.read<TasksController>();
      if (controller.tasks.isEmpty) {
        controller.load();
      }
    });
  }

  @override
  void didUpdateWidget(TodayView oldWidget) {
    super.didUpdateWidget(oldWidget);
    // A new highlight request has arrived.
    if (widget.highlightTaskId != null &&
        widget.highlightTaskId != _lastHandledHighlightId) {
      _scheduleHighlight(widget.highlightTaskId!);
    }
  }

  void _scheduleHighlight(String taskId) {
    _lastHandledHighlightId = taskId;
    // Wait one frame so the list has rendered with up-to-date keys.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final key = _itemKeys[taskId];
      if (key == null || key.currentContext == null) {
        // Task not visible — just clear pending state.
        widget.onHighlightHandled?.call();
        return;
      }
      // Scroll to the item.
      Scrollable.ensureVisible(
        key.currentContext!,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
        alignment: 0.3,
      );
      // Apply highlight.
      setState(() {
        _activeHighlightId = taskId;
      });
    });
  }

  void _onHighlightComplete() {
    setState(() {
      _activeHighlightId = null;
    });
    widget.onHighlightHandled?.call();
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

  GlobalKey _keyFor(String taskId) {
    return _itemKeys.putIfAbsent(taskId, GlobalKey.new);
  }

  Widget _buildItem(Task t, TasksController controller) {
    final isHighlighted = _activeHighlightId == t.id;
    final item = TaskListItem(
      task: t,
      onToggle: () => controller.toggleDone(t.id),
    );

    return _HighlightItem(
      key: _keyFor(t.id),
      highlighted: isHighlighted,
      onHighlightComplete: isHighlighted ? _onHighlightComplete : null,
      child: item,
    );
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

    // Rebuild key map in case tasks changed — keep existing keys for
    // continuity, just add new ones.
    for (final t in controller.tasks) {
      _itemKeys.putIfAbsent(t.id, GlobalKey.new);
    }

    // If we have a pending highlight and this is the first render with tasks,
    // schedule the scroll.
    if (widget.highlightTaskId != null &&
        widget.highlightTaskId != _lastHandledHighlightId &&
        controller.tasks.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        _scheduleHighlight(widget.highlightTaskId!);
      });
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
                    ...overdue.map((t) => _buildItem(t, controller)),
                  ],
                  if (today.isNotEmpty) ...[
                    const SectionHeader(label: 'Today'),
                    ...today.map((t) => _buildItem(t, controller)),
                  ],
                  if (completed.isNotEmpty) ...[
                    const SectionHeader(label: 'Completed today'),
                    ...completed.map((t) => _buildItem(t, controller)),
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

// ---------------------------------------------------------------------------
// _HighlightItem
// ---------------------------------------------------------------------------

/// Wraps a task row with a 1.5 s fade-out tinted background when [highlighted]
/// is true. Calls [onHighlightComplete] after the animation ends.
class _HighlightItem extends StatefulWidget {
  const _HighlightItem({
    super.key,
    required this.highlighted,
    required this.child,
    this.onHighlightComplete,
  });

  final bool highlighted;
  final Widget child;
  final VoidCallback? onHighlightComplete;

  @override
  State<_HighlightItem> createState() => _HighlightItemState();
}

class _HighlightItemState extends State<_HighlightItem> {
  bool _showTint = false;

  @override
  void didUpdateWidget(_HighlightItem oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.highlighted && !oldWidget.highlighted) {
      // Start fully tinted, then fade to transparent after a short pause.
      setState(() {
        _showTint = true;
      });
      // Fade out after one frame.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        setState(() {
          _showTint = false;
        });
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final accentMuted = context.rhythm.accentMuted;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 1500),
      curve: Curves.easeOut,
      color: _showTint ? accentMuted : Colors.transparent,
      onEnd: () {
        if (widget.highlighted) {
          widget.onHighlightComplete?.call();
        }
      },
      child: widget.child,
    );
  }
}
