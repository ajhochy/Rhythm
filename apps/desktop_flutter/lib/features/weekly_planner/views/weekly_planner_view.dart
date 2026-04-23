// ignore_for_file: use_build_context_synchronously
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../app/core/formatters/date_formatters.dart';
import '../../../app/core/tasks/task_visual_style.dart';
import '../../../app/core/ui/rhythm_ui.dart';
import '../../../app/core/widgets/error_banner.dart';
import '../../../app/core/workspace/workspace_controller.dart';
import '../../../app/core/workspace/workspace_models.dart';
import '../../../shared/widgets/collaborators_row.dart';
import '../../../shared/widgets/workspace_member_picker.dart';
import '../../tasks/models/task.dart';
import '../controllers/weekly_planner_controller.dart';
import '../models/weekly_plan.dart';
import '../../tasks/data/collaborators_data_source.dart';

class WeeklyPlannerView extends StatefulWidget {
  const WeeklyPlannerView({super.key});

  @override
  State<WeeklyPlannerView> createState() => _WeeklyPlannerViewState();
}

class _WeeklyPlannerViewState extends State<WeeklyPlannerView> {
  bool _showCompleted = false;
  String? _presentedInspectorTaskId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<WeeklyPlannerController>().load();
      context.read<WorkspaceController>().loadMembers();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<WeeklyPlannerController>(
      builder: (context, controller, _) {
        final plan = controller.plan;
        if (plan != null && controller.selectedTaskId != null) {
          final allTasks = [
            ...plan.days.expand((d) => d.tasks),
            ...plan.backlog
          ];
          final selectedTask = allTasks.cast<Task?>().firstWhere(
                (task) => task?.id == controller.selectedTaskId,
                orElse: () => null,
              );
          if (selectedTask != null &&
              _presentedInspectorTaskId != selectedTask.id) {
            _presentedInspectorTaskId = selectedTask.id;
            WidgetsBinding.instance.addPostFrameCallback((_) async {
              await _openInspector(controller, selectedTask);
              if (!mounted) return;
              controller.selectTask(null);
              _presentedInspectorTaskId = null;
            });
          }
        }
        return RhythmSurface.page(
          padding: const EdgeInsets.all(RhythmSpacing.sm),
          child: RhythmSurface.section(
            clipBehavior: Clip.antiAlias,
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                _WeekHeader(
                  controller: controller,
                  showCompleted: _showCompleted,
                  onCompletedModeChanged: (value) =>
                      setState(() => _showCompleted = value),
                ),
                if (controller.status == WeeklyPlannerStatus.error &&
                    controller.errorMessage != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      RhythmSpacing.md,
                      RhythmSpacing.sm,
                      RhythmSpacing.md,
                      RhythmSpacing.sm,
                    ),
                    child: ErrorBanner(
                      message: controller.errorMessage!,
                      onRetry: controller.load,
                    ),
                  ),
                Expanded(
                  child: _PlannerBody(
                    controller: controller,
                    showCompleted: _showCompleted,
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _openInspector(
    WeeklyPlannerController controller,
    Task task,
  ) async {
    final collaboratorsDataSource = CollaboratorsDataSource();
    await showRhythmTaskInspector(
      context,
      task: task,
      workspaceMembers: context.read<WorkspaceController>().members,
      onSaveDetails: (request) => controller.updateTask(
        task,
        notes: request.notes,
        dueDate: request.dueDate,
        scheduledDate: request.scheduledDate,
      ),
      onAddCollaborator: task.sourceType == 'calendar_shadow_event'
          ? null
          : (userId) async {
              final collaborators =
                  await collaboratorsDataSource.addToTask(task.id, userId);
              return collaborators;
            },
      onRemoveCollaborator: task.sourceType == 'calendar_shadow_event'
          ? null
          : (userId) async {
              await collaboratorsDataSource.removeFromTask(task.id, userId);
              return collaboratorsDataSource.fetchForTask(task.id);
            },
    );
    if (!mounted) return;
    await controller.load();
  }
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

class _WeekHeader extends StatelessWidget {
  const _WeekHeader({
    required this.controller,
    required this.showCompleted,
    required this.onCompletedModeChanged,
  });
  final WeeklyPlannerController controller;
  final bool showCompleted;
  final ValueChanged<bool> onCompletedModeChanged;

  @override
  Widget build(BuildContext context) {
    final label = _formatWeekLabel(controller.currentWeekLabel);
    final hasSelection = controller.selectedTaskIds.isNotEmpty;
    return RhythmToolbar(
      title: 'Weekly Planner',
      subtitle: 'A quieter workspace for the week ahead.',
      leading: RhythmBadge(
        label: label,
        icon: Icons.calendar_today_outlined,
        tone: RhythmBadgeTone.accent,
      ),
      padding: const EdgeInsets.fromLTRB(
        RhythmSpacing.md,
        RhythmSpacing.sm,
        RhythmSpacing.md,
        RhythmSpacing.sm,
      ),
      filters: [
        RhythmSegmentedControl<bool>(
          compact: true,
          value: showCompleted,
          onChanged: onCompletedModeChanged,
          segments: const [
            RhythmSegment(
              value: false,
              label: 'Open',
              icon: Icons.radio_button_unchecked,
            ),
            RhythmSegment(
              value: true,
              label: 'All',
              icon: Icons.visibility,
            ),
          ],
        ),
      ],
      actions: [
        RhythmButton.icon(
          icon: Icons.chevron_left,
          tooltip: 'Previous week',
          compact: true,
          onPressed: controller.goToPrevWeek,
        ),
        RhythmButton.icon(
          icon: Icons.chevron_right,
          tooltip: 'Next week',
          compact: true,
          onPressed: controller.goToNextWeek,
        ),
        RhythmButton.outlined(
          label: 'Today',
          compact: true,
          onPressed: controller.isCurrentWeek ? null : controller.goToToday,
        ),
        if (hasSelection)
          RhythmBadge(
            label: '${controller.selectedTaskIds.length} selected',
            icon: Icons.done_all,
            compact: true,
          ),
        if (hasSelection)
          RhythmButton.quiet(
            label: 'Mark complete',
            icon: Icons.checklist,
            compact: true,
            onPressed: () => controller.bulkToggleSelectedTasks([
              ...?controller.plan?.days.expand((d) => d.tasks),
              ...?controller.plan?.backlog,
            ], 'done'),
          ),
        if (hasSelection)
          RhythmButton.quiet(
            label: 'Clear',
            compact: true,
            onPressed: controller.clearTaskSelection,
          ),
      ],
    );
  }

  String _formatWeekLabel(String label) {
    final m = RegExp(r'^(\d{4})-W(\d{1,2})$').firstMatch(label);
    if (m == null) return label;
    final year = int.parse(m.group(1)!);
    final week = int.parse(m.group(2)!);
    final jan4 = DateTime.utc(year, 1, 4);
    final mondayWeek1 = jan4.subtract(Duration(days: jan4.weekday - 1));
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
      'Dec',
    ];
    return 'Week of ${months[monday.month - 1]} ${monday.day}, ${monday.year}';
  }
}

class _EmptyWorkspaceState extends StatelessWidget {
  const _EmptyWorkspaceState({
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 240),
      child: RhythmPanel(
        padding: const EdgeInsets.all(RhythmSpacing.sm),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 36,
              height: 36,
              child: RhythmSurface(
                tone: RhythmSurfaceTone.muted,
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                child: Center(
                  child: Icon(icon, size: 18, color: colors.accent),
                ),
              ),
            ),
            const SizedBox(height: 10),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: colors.textPrimary,
                    fontWeight: FontWeight.w700,
                  ),
            ),
            const SizedBox(height: 6),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colors.textSecondary,
                    height: 1.35,
                  ),
            ),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 12),
              RhythmButton.quiet(
                onPressed: onAction,
                label: actionLabel!,
                compact: true,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Three-pane body
// ---------------------------------------------------------------------------

class _PlannerBody extends StatelessWidget {
  const _PlannerBody({required this.controller, required this.showCompleted});
  final WeeklyPlannerController controller;
  final bool showCompleted;

  static const _wideLayout = 1480.0;
  static const _sideBacklogLayout = 1080.0;
  static const _minimumWeekWidth = 980.0;

  @override
  Widget build(BuildContext context) {
    if (controller.status == WeeklyPlannerStatus.loading &&
        controller.plan == null) {
      return const RhythmEmptyState(
        title: 'Loading this week...',
        message: 'Backlog, day columns, and task details will appear here.',
        tone: RhythmEmptyStateTone.loading,
      );
    }
    final plan = controller.plan;
    if (plan == null) {
      return const Center(
        child: _EmptyWorkspaceState(
          icon: Icons.view_week_outlined,
          title: 'No weekly plan loaded',
          message:
              'Once a plan is available, backlog, day columns, and details will appear here.',
        ),
      );
    }

    final visibleBacklog = showCompleted
        ? plan.backlog
        : plan.backlog.where((t) => t.status != 'done').toList();
    final showBacklogPane = visibleBacklog.isNotEmpty;

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final useSideBacklog = showBacklogPane && width >= _sideBacklogLayout;
        final backlogWidth = width >= _wideLayout ? 292.0 : 232.0;
        final weekMinimumWidth =
            width >= _sideBacklogLayout ? 0.0 : _minimumWeekWidth;

        final weekPane = _DayColumnsPane(
          plan: plan,
          controller: controller,
          showCompleted: showCompleted,
          minimumWidth: weekMinimumWidth,
        );

        final mainRow = Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (useSideBacklog) ...[
              SizedBox(
                width: backlogWidth,
                child: _BacklogPane(
                  plan: plan,
                  controller: controller,
                  showCompleted: showCompleted,
                ),
              ),
              const SizedBox(width: RhythmSpacing.sm),
            ],
            Expanded(child: weekPane),
          ],
        );

        return Padding(
          padding: const EdgeInsets.all(RhythmSpacing.sm),
          child: Column(
            children: [
              if (showBacklogPane && !useSideBacklog) ...[
                SizedBox(
                  height: 216,
                  child: _BacklogPane(
                    plan: plan,
                    controller: controller,
                    showCompleted: showCompleted,
                    horizontal: true,
                  ),
                ),
                const SizedBox(height: RhythmSpacing.sm),
              ],
              Expanded(child: mainRow),
            ],
          ),
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Backlog pane
// ---------------------------------------------------------------------------

class _BacklogPane extends StatelessWidget {
  const _BacklogPane({
    required this.plan,
    required this.controller,
    required this.showCompleted,
    this.horizontal = false,
  });
  final WeeklyPlan plan;
  final WeeklyPlannerController controller;
  final bool showCompleted;
  final bool horizontal;

  @override
  Widget build(BuildContext context) {
    final backlog = showCompleted
        ? plan.backlog
        : plan.backlog.where((t) => t.status != 'done').toList();
    final colors = context.rhythm;
    return RhythmSurface(
      tone: RhythmSurfaceTone.muted,
      border: true,
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
            child: Row(
              children: [
                SizedBox(
                  width: 28,
                  height: 28,
                  child: RhythmSurface(
                    tone: RhythmSurfaceTone.raised,
                    borderRadius: BorderRadius.circular(RhythmRadius.sm),
                    child: Center(
                      child: Icon(
                        Icons.inbox_outlined,
                        size: 16,
                        color: colors.accent,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Backlog',
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                              color: colors.textPrimary,
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Tasks waiting to be scheduled',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: colors.textSecondary,
                            ),
                      ),
                    ],
                  ),
                ),
                if (backlog.isNotEmpty)
                  RhythmBadge(
                    label: '${backlog.length}',
                    compact: true,
                  ),
              ],
            ),
          ),
          Divider(height: 1, color: colors.borderSubtle),
          Expanded(child: _backlogContent(context, backlog)),
        ],
      ),
    );
  }

  Widget _backlogContent(BuildContext context, List<Task> backlog) {
    if (backlog.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(RhythmSpacing.md),
          child: _EmptyWorkspaceState(
            icon: Icons.inbox_outlined,
            title: 'Nothing in backlog',
            message:
                'Undated work lands here until you schedule it into the week.',
            actionLabel: 'Add task',
            onAction: () => _showAddBacklogTaskDialog(context),
          ),
        ),
      );
    }

    if (horizontal) {
      return ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(
          RhythmSpacing.sm,
          RhythmSpacing.xs,
          RhythmSpacing.sm,
          RhythmSpacing.sm,
        ),
        itemCount: backlog.length + 1,
        separatorBuilder: (_, __) => const SizedBox(width: RhythmSpacing.xs),
        itemBuilder: (context, i) {
          if (i == backlog.length) {
            return SizedBox(
              width: 210,
              child: _AddBacklogTaskButton(
                onTap: () => _showAddBacklogTaskDialog(context),
              ),
            );
          }
          return SizedBox(
            width: 240,
            child: _TaskTile(
              task: backlog[i],
              controller: controller,
              draggable: true,
            ),
          );
        },
      );
    }

    return Column(
      children: [
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(
              RhythmSpacing.sm,
              RhythmSpacing.xxs,
              RhythmSpacing.sm,
              RhythmSpacing.sm,
            ),
            itemCount: backlog.length,
            separatorBuilder: (_, __) => const SizedBox(height: 6),
            itemBuilder: (context, i) => _TaskTile(
              task: backlog[i],
              controller: controller,
              draggable: true,
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            RhythmSpacing.sm,
            0,
            RhythmSpacing.sm,
            RhythmSpacing.sm,
          ),
          child: _AddBacklogTaskButton(
            onTap: () => _showAddBacklogTaskDialog(context),
          ),
        ),
      ],
    );
  }

  Future<void> _showAddBacklogTaskDialog(BuildContext context) async {
    final ctrl = TextEditingController();
    final workspaceMembers = context.read<WorkspaceController>().members;
    int? ownerId;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) {
          final dlgColors = ctx.rhythm;
          return AlertDialog(
            backgroundColor: dlgColors.surfaceRaised,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(RhythmRadius.xl),
            ),
            title: const Text('Add unscheduled task'),
            content: SizedBox(
              width: 380,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: ctrl,
                    autofocus: true,
                    decoration: InputDecoration(
                      hintText: 'Task title',
                      filled: true,
                      fillColor: dlgColors.surfaceMuted,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(RhythmRadius.sm),
                        borderSide: BorderSide(color: dlgColors.borderSubtle),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(RhythmRadius.sm),
                        borderSide: BorderSide(color: dlgColors.borderSubtle),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(RhythmRadius.sm),
                        borderSide: BorderSide(color: dlgColors.accent),
                      ),
                    ),
                    onSubmitted: (_) => Navigator.pop(ctx, true),
                  ),
                  const SizedBox(height: 12),
                  _TaskOwnerPickerField(
                    workspaceMembers: workspaceMembers,
                    selectedUserId: ownerId,
                    onChanged: (value) => setState(() => ownerId = value),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Add'),
              ),
            ],
          );
        },
      ),
    );
    if (confirmed == true && ctrl.text.trim().isNotEmpty) {
      await controller.createTask(ctrl.text.trim(), ownerId: ownerId);
    }
  }
}

class _AddBacklogTaskButton extends StatelessWidget {
  const _AddBacklogTaskButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return InkWell(
      borderRadius: BorderRadius.circular(RhythmRadius.sm),
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(
          horizontal: RhythmSpacing.sm,
          vertical: 10,
        ),
        decoration: BoxDecoration(
          color: colors.surfaceRaised,
          borderRadius: BorderRadius.circular(RhythmRadius.sm),
          border: Border.all(color: colors.borderSubtle),
        ),
        child: Row(
          children: [
            Icon(Icons.add, size: 14, color: colors.textSecondary),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                'Add unscheduled task',
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: colors.textSecondary,
                      fontWeight: FontWeight.w600,
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
// Day columns pane
// ---------------------------------------------------------------------------

class _DayColumnsPane extends StatelessWidget {
  const _DayColumnsPane({
    required this.plan,
    required this.controller,
    required this.showCompleted,
    this.minimumWidth = 0,
  });
  final WeeklyPlan plan;
  final WeeklyPlannerController controller;
  final bool showCompleted;
  final double minimumWidth;

  static const _dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return RhythmSurface(
      tone: RhythmSurfaceTone.surface,
      border: true,
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
            child: Row(
              children: [
                SizedBox(
                  width: 28,
                  height: 28,
                  child: RhythmSurface(
                    tone: RhythmSurfaceTone.muted,
                    borderRadius: BorderRadius.circular(RhythmRadius.sm),
                    child: Center(
                      child: Icon(
                        Icons.calendar_view_week_outlined,
                        size: 16,
                        color: colors.accent,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'This week',
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                              color: colors.textPrimary,
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Scheduled work across the week',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: colors.textSecondary,
                            ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: colors.borderSubtle),
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final contentWidth = constraints.maxWidth < minimumWidth
                    ? minimumWidth
                    : constraints.maxWidth;
                return SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: SizedBox(
                    width: contentWidth,
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: List.generate(plan.days.length, (i) {
                        final day = plan.days[i];
                        return Expanded(
                          child: _DayColumn(
                            dayName: _dayNames[i],
                            date: day.date,
                            tasks: plan.tasksForDate(day.date),
                            controller: controller,
                            showCompleted: showCompleted,
                            isLast: i == plan.days.length - 1,
                          ),
                        );
                      }),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _DayColumn extends StatefulWidget {
  const _DayColumn({
    required this.dayName,
    required this.date,
    required this.tasks,
    required this.controller,
    required this.showCompleted,
    required this.isLast,
  });
  final String dayName;
  final String date;
  final List<Task> tasks;
  final WeeklyPlannerController controller;
  final bool showCompleted;
  final bool isLast;

  @override
  State<_DayColumn> createState() => _DayColumnState();
}

class _DayColumnState extends State<_DayColumn> {
  bool _hovering = false;

  bool _isToday() {
    final now = DateTime.now();
    final today =
        '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    return widget.date == today;
  }

  String _shortDate() {
    final parts = widget.date.split('-');
    if (parts.length != 3) return widget.date;
    return '${int.parse(parts[1])}/${int.parse(parts[2])}';
  }

  @override
  Widget build(BuildContext context) {
    final today = _isToday();
    final colors = context.rhythm;
    final displayTasks = widget.showCompleted
        ? widget.tasks
        : widget.tasks.where((t) => t.status != 'done').toList();
    final addButton = Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        onTap: () => _showAddTaskDialog(context),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: colors.surfaceRaised,
            borderRadius: BorderRadius.circular(RhythmRadius.sm),
            border: Border.all(color: colors.borderSubtle),
          ),
          child: Row(
            children: [
              Icon(Icons.add, size: 13, color: colors.textSecondary),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'Add task to ${widget.dayName}',
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: colors.textSecondary,
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ),
            ],
          ),
        ),
      ),
    );

    return DragTarget<Task>(
      onWillAcceptWithDetails: (_) {
        setState(() => _hovering = true);
        return true;
      },
      onLeave: (_) => setState(() => _hovering = false),
      onAcceptWithDetails: (details) {
        setState(() => _hovering = false);
        widget.controller.scheduleTask(details.data, widget.date);
      },
      builder: (context, _, __) {
        return AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          decoration: BoxDecoration(
            color: _hovering ? colors.accentMuted : colors.surfaceMuted,
            border: Border(
              right: widget.isLast
                  ? BorderSide.none
                  : BorderSide(color: colors.borderSubtle),
              top: BorderSide(
                color: today ? colors.accent : colors.borderSubtle,
                width: today ? 2 : 1,
              ),
            ),
          ),
          child: Column(
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(10, 12, 10, 10),
                decoration: BoxDecoration(
                  color: today ? colors.surfaceRaised : colors.surfaceMuted,
                  border: Border(
                    bottom: BorderSide(
                      color: today
                          ? colors.accent.withValues(alpha: 0.18)
                          : colors.borderSubtle,
                    ),
                  ),
                ),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          widget.dayName,
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(
                                fontWeight: FontWeight.w700,
                                letterSpacing: 0.3,
                                color:
                                    today ? colors.accent : colors.textPrimary,
                              ),
                        ),
                        if (today) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: colors.accentMuted,
                              borderRadius:
                                  BorderRadius.circular(RhythmRadius.sm),
                            ),
                            child: Text(
                              'Today',
                              style: Theme.of(context)
                                  .textTheme
                                  .labelSmall
                                  ?.copyWith(
                                    color: colors.accent,
                                    fontWeight: FontWeight.w600,
                                  ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      _shortDate(),
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: today ? colors.accent : colors.textSecondary,
                          ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: Builder(
                  builder: (context) {
                    final allDayEvents = displayTasks
                        .where(
                          (t) =>
                              t.sourceType == 'calendar_shadow_event' &&
                              t.isAllDay,
                        )
                        .toList();
                    final timedEvents = displayTasks
                        .where(
                          (t) =>
                              t.sourceType == 'calendar_shadow_event' &&
                              !t.isAllDay &&
                              t.startsAt != null,
                        )
                        .toList()
                      ..sort((a, b) {
                        final aT = parsePlannerEventDateTime(a.startsAt);
                        final bT = parsePlannerEventDateTime(b.startsAt);
                        if (aT == null) return 1;
                        if (bT == null) return -1;
                        return aT.compareTo(bT);
                      });
                    final regularTasks = displayTasks
                        .where(
                          (t) => t.sourceType != 'calendar_shadow_event',
                        )
                        .toList();

                    final hasContent = allDayEvents.isNotEmpty ||
                        timedEvents.isNotEmpty ||
                        regularTasks.isNotEmpty;

                    if (!hasContent) {
                      return Align(
                        alignment: Alignment.topCenter,
                        child: addButton,
                      );
                    }

                    return Column(
                      children: [
                        if (allDayEvents.isNotEmpty)
                          _AllDayEventsBar(
                            events: allDayEvents,
                            controller: widget.controller,
                          ),
                        Expanded(
                          child: SingleChildScrollView(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                if (timedEvents.isNotEmpty)
                                  _TimeGrid(
                                    events: timedEvents,
                                    controller: widget.controller,
                                  ),
                                ...regularTasks.map(
                                  (task) => Padding(
                                    padding: const EdgeInsets.only(top: 6),
                                    child: _TaskTile(
                                      task: task,
                                      controller: widget.controller,
                                      draggable: true,
                                      compact: true,
                                    ),
                                  ),
                                ),
                                addButton,
                              ],
                            ),
                          ),
                        ),
                      ],
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

  Future<void> _showAddTaskDialog(BuildContext context) async {
    final ctrl = TextEditingController();
    final workspaceMembers = context.read<WorkspaceController>().members;
    int? ownerId;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) {
          final dlgColors = ctx.rhythm;
          return AlertDialog(
            backgroundColor: dlgColors.surfaceRaised,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(RhythmRadius.xl),
            ),
            title: Text('Add task for ${widget.dayName}'),
            content: SizedBox(
              width: 380,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: ctrl,
                    autofocus: true,
                    decoration: InputDecoration(
                      hintText: 'Task title',
                      filled: true,
                      fillColor: dlgColors.surfaceMuted,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(RhythmRadius.sm),
                        borderSide: BorderSide(color: dlgColors.borderSubtle),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(RhythmRadius.sm),
                        borderSide: BorderSide(color: dlgColors.borderSubtle),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(RhythmRadius.sm),
                        borderSide: BorderSide(color: dlgColors.accent),
                      ),
                    ),
                    onSubmitted: (_) => Navigator.pop(ctx, true),
                  ),
                  const SizedBox(height: 12),
                  _TaskOwnerPickerField(
                    workspaceMembers: workspaceMembers,
                    selectedUserId: ownerId,
                    onChanged: (value) => setState(() => ownerId = value),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Add'),
              ),
            ],
          );
        },
      ),
    );
    if (confirmed == true && ctrl.text.trim().isNotEmpty) {
      await widget.controller.createTask(
        ctrl.text.trim(),
        dueDate: widget.date,
        ownerId: ownerId,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Unified task tile — used in both backlog and day columns
// ---------------------------------------------------------------------------

class _TaskTile extends StatelessWidget {
  const _TaskTile({
    required this.task,
    required this.controller,
    this.draggable = false,
    this.compact = false,
  });
  final Task task;
  final WeeklyPlannerController controller;
  final bool draggable;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final card = _card(context);
    if (!draggable || task.sourceType == 'calendar_shadow_event') return card;
    final colors = context.rhythm;
    return Draggable<Task>(
      data: task,
      feedback: Material(
        color: Colors.transparent,
        elevation: 0,
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        child: Container(
          width: 160,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: colors.surfaceRaised,
            borderRadius: BorderRadius.circular(RhythmRadius.sm),
            border: Border.all(color: colors.borderSubtle),
            boxShadow: RhythmElevation.panel,
          ),
          child: Text(
            task.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: colors.textPrimary),
          ),
        ),
      ),
      childWhenDragging: Opacity(opacity: 0.35, child: card),
      child: card,
    );
  }

  Widget _card(BuildContext context) {
    final isSelected = controller.selectedTaskId == task.id;
    final isMultiSelected = controller.selectedTaskIds.contains(task.id);
    final isDone = task.status == 'done';
    final isShadowEvent = task.sourceType == 'calendar_shadow_event';
    final visualStyle = TaskVisualStyles.resolve(task);
    final shadowTimeLabel = isShadowEvent ? _shadowEventLabel(task) : null;
    final isPastDue = DateFormatters.isPastDue(
      dueDate: task.dueDate,
      scheduledDate: task.scheduledDate,
      isDone: isDone,
    );
    final workspaceMembers = context.watch<WorkspaceController>().members;
    final ownerName = _ownerName(task.ownerId, workspaceMembers);
    final sourceName = task.sourceName?.trim();
    final hasSourceName = sourceName != null && sourceName.isNotEmpty;
    final notesPreview = task.notes?.trim();
    final hasNotes = notesPreview != null && notesPreview.isNotEmpty;
    final colors = context.rhythm;
    return GestureDetector(
      onTap: () => controller.selectTask(task.id),
      onLongPress:
          isShadowEvent ? null : () => controller.toggleTaskSelection(task.id),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final showContext = !compact || constraints.maxWidth >= 118;
          final showNotes =
              hasNotes && (!compact || constraints.maxWidth >= 142);
          return AnimatedContainer(
            duration: const Duration(milliseconds: 120),
            margin: compact
                ? const EdgeInsets.symmetric(horizontal: 8, vertical: 2)
                : const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            padding: EdgeInsets.symmetric(
              horizontal: compact ? 8 : 10,
              vertical: compact ? 8 : 11,
            ),
            decoration: BoxDecoration(
              color: isSelected || isMultiSelected
                  ? colors.accentMuted
                  : visualStyle.background,
              borderRadius: BorderRadius.circular(RhythmRadius.sm),
              border: Border.all(
                color: isSelected || isMultiSelected
                    ? colors.accent
                    : visualStyle.border,
              ),
              boxShadow: isSelected || isMultiSelected
                  ? RhythmElevation.panel
                  : const [],
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (isShadowEvent)
                  Container(
                    width: 3,
                    margin: const EdgeInsets.only(top: 2, right: 7),
                    decoration: BoxDecoration(
                      color: visualStyle.accent,
                      borderRadius: BorderRadius.circular(RhythmRadius.pill),
                    ),
                  )
                else ...[
                  SizedBox(
                    width: compact ? 14 : 16,
                    height: compact ? 14 : 16,
                    child: Checkbox(
                      value: isDone,
                      onChanged: (_) => controller.toggleTaskDone(task, isDone),
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      visualDensity: compact
                          ? const VisualDensity(horizontal: -4, vertical: -4)
                          : VisualDensity.compact,
                    ),
                  ),
                  SizedBox(width: compact ? 6 : 8),
                ],
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (shadowTimeLabel != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 3),
                          child: Text(
                            shadowTimeLabel,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: (compact
                                    ? Theme.of(context).textTheme.labelSmall
                                    : Theme.of(context).textTheme.bodySmall)
                                ?.copyWith(
                              fontSize: compact ? 9.5 : 10.5,
                              fontWeight: FontWeight.w700,
                              color: visualStyle.accent,
                            ),
                          ),
                        ),
                      Text(
                        task.title,
                        maxLines: compact ? 4 : 3,
                        overflow: TextOverflow.ellipsis,
                        softWrap: true,
                        style: (compact
                                ? Theme.of(context).textTheme.labelSmall
                                : Theme.of(context).textTheme.bodySmall)
                            ?.copyWith(
                          decoration:
                              isDone ? TextDecoration.lineThrough : null,
                          color: isDone ? colors.textMuted : visualStyle.text,
                          fontSize: compact ? 11 : null,
                          fontWeight: FontWeight.w700,
                          height: compact ? 1.18 : 1.25,
                        ),
                      ),
                      if (showContext &&
                          (isPastDue ||
                              isDone ||
                              ownerName != null ||
                              task.sourceType != null ||
                              hasSourceName)) ...[
                        const SizedBox(height: 6),
                        Wrap(
                          spacing: 5,
                          runSpacing: 5,
                          children: [
                            if (isPastDue)
                              const RhythmBadge(
                                label: 'Past due',
                                tone: RhythmBadgeTone.danger,
                                compact: true,
                              ),
                            if (isDone)
                              const RhythmBadge(
                                label: 'Done',
                                tone: RhythmBadgeTone.success,
                                compact: true,
                              ),
                            if (ownerName != null)
                              _TaskMetaPill(
                                icon: Icons.person_outline,
                                label: ownerName,
                                color: visualStyle.mutedText,
                              ),
                            if (task.sourceType != null || hasSourceName)
                              _TaskMetaPill(
                                icon: _sourceIcon(task.sourceType),
                                label: _sourceLabelForTask(task),
                                color: visualStyle.accent,
                              ),
                          ],
                        ),
                      ],
                      if (showNotes) ...[
                        const SizedBox(height: 6),
                        Text(
                          notesPreview,
                          maxLines: compact ? 2 : 3,
                          overflow: TextOverflow.ellipsis,
                          style:
                              Theme.of(context).textTheme.labelSmall?.copyWith(
                                    color: isDone
                                        ? colors.textMuted
                                        : visualStyle.mutedText,
                                    height: 1.25,
                                  ),
                        ),
                      ],
                    ],
                  ),
                ),
                if (!isShadowEvent && compact) ...[
                  const SizedBox(width: 6),
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _MiniMoveButton(
                        icon: Icons.keyboard_arrow_up,
                        onPressed: () => controller.moveTaskEarlier(task),
                      ),
                      const SizedBox(height: 4),
                      _MiniMoveButton(
                        icon: Icons.keyboard_arrow_down,
                        onPressed: () => controller.moveTaskLater(task),
                      ),
                    ],
                  ),
                ],
                if (isMultiSelected && !compact) ...[
                  const SizedBox(width: 6),
                  Icon(Icons.done_all, size: 14, color: colors.accent),
                ],
                if (task.locked && !compact) ...[
                  const SizedBox(width: 6),
                  Icon(Icons.lock, size: 11, color: colors.textSecondary),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  String? _ownerName(int? ownerId, List<WorkspaceMember> workspaceMembers) {
    if (ownerId == null) return null;
    for (final member in workspaceMembers) {
      if (member.userId == ownerId) {
        final name = member.name.trim();
        return name.isEmpty ? member.email.trim() : name;
      }
    }
    return 'User $ownerId';
  }
}

class _TaskMetaPill extends StatelessWidget {
  const _TaskMetaPill({
    required this.icon,
    required this.label,
    required this.color,
  });

  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 128),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.13),
          borderRadius: BorderRadius.circular(RhythmRadius.pill),
          border: Border.all(color: color.withValues(alpha: 0.22)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 11, color: color),
            const SizedBox(width: 4),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: color,
                      fontWeight: FontWeight.w700,
                      height: 1,
                    ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

IconData _sourceIcon(String? sourceType) => switch (sourceType) {
      'automation_rule' => Icons.auto_awesome,
      'planning_center_signal' => Icons.groups_2_outlined,
      'calendar_shadow_event' => Icons.event_available_outlined,
      'project_step' => Icons.folder_open_outlined,
      'recurring_rule' => Icons.repeat,
      _ => Icons.link,
    };

String _sourceLabelForTask(Task task) {
  final sourceName = task.sourceName?.trim();
  if (sourceName != null && sourceName.isNotEmpty) return sourceName;
  return switch (task.sourceType) {
    'automation_rule' => 'Automation',
    'planning_center_signal' => 'Planning Center',
    'calendar_shadow_event' => 'Calendar',
    'project_step' => 'Project',
    'recurring_rule' => 'Rhythm',
    _ => 'Source',
  };
}

// ---------------------------------------------------------------------------
// Detail pane — editable notes
// ---------------------------------------------------------------------------

class _DetailPane extends StatefulWidget {
  const _DetailPane({
    required this.task,
    required this.controller,
  });
  final Task task;
  final WeeklyPlannerController controller;

  @override
  State<_DetailPane> createState() => _DetailPaneState();
}

class _DetailPaneState extends State<_DetailPane> {
  late TextEditingController _notesCtrl;
  bool _notesDirty = false;
  bool _saving = false;
  String? _dueDate;
  String? _scheduledDate;
  int? _ownerId;
  bool _datesDirty = false;
  bool _ownerDirty = false;

  @override
  void initState() {
    super.initState();
    _notesCtrl = TextEditingController();
    _notesCtrl.addListener(
      () => setState(
        () => _notesDirty = _notesCtrl.text != (widget.task.notes ?? ''),
      ),
    );
    _syncFromTask();
  }

  @override
  void didUpdateWidget(covariant _DetailPane oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.task.id != widget.task.id ||
        oldWidget.task.notes != widget.task.notes ||
        oldWidget.task.dueDate != widget.task.dueDate ||
        oldWidget.task.scheduledDate != widget.task.scheduledDate ||
        oldWidget.task.ownerId != widget.task.ownerId ||
        oldWidget.task.status != widget.task.status) {
      _syncFromTask();
    }
  }

  @override
  void dispose() {
    _notesCtrl.dispose();
    super.dispose();
  }

  void _syncFromTask() {
    _notesCtrl.text = widget.task.notes ?? '';
    _dueDate = widget.task.dueDate;
    _scheduledDate = widget.task.scheduledDate;
    _ownerId = widget.task.ownerId;
    _notesDirty = false;
    _datesDirty = false;
    _ownerDirty = false;
  }

  Future<void> _saveDetailChanges() async {
    setState(() => _saving = true);
    await widget.controller.updateTask(
      widget.task,
      notes: _notesCtrl.text,
      dueDate: _datesDirty ? (_dueDate ?? '') : null,
      scheduledDate: widget.task.sourceType == 'project_step'
          ? null
          : _datesDirty
              ? (_scheduledDate ?? '')
              : null,
      ownerId: _ownerId,
      ownerChanged: _ownerDirty,
    );
    setState(() {
      _saving = false;
      _notesDirty = false;
      _datesDirty = false;
      _ownerDirty = false;
    });
  }

  String? get _plannerDate => _scheduledDate ?? _dueDate;

  Future<void> _pickPlannerDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate:
          _plannerDate != null ? DateTime.parse(_plannerDate!) : DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );
    if (picked == null) return;
    final value = picked.toIso8601String().substring(0, 10);
    setState(() {
      if (widget.task.sourceType == 'project_step') {
        _dueDate = value;
      } else if (widget.task.scheduledDate != null ||
          widget.task.dueDate == null) {
        _scheduledDate = value;
      } else {
        _dueDate = value;
      }
      _datesDirty = _dueDate != widget.task.dueDate ||
          _scheduledDate != widget.task.scheduledDate;
    });
  }

  void _clearPlannerDate() {
    setState(() {
      if (widget.task.sourceType == 'project_step') {
        _dueDate = null;
      } else if (widget.task.scheduledDate != null ||
          widget.task.dueDate == null) {
        _scheduledDate = null;
      } else {
        _dueDate = null;
      }
      _datesDirty = _dueDate != widget.task.dueDate ||
          _scheduledDate != widget.task.scheduledDate;
    });
  }

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final isDone = task.status == 'done';
    final isShadowEvent = task.sourceType == 'calendar_shadow_event';
    final timeLabel = _shadowEventLabel(task);
    final workspaceMembers = context.watch<WorkspaceController>().members;
    final colors = context.rhythm;
    return RhythmDetailPane(
      title: 'Task details',
      subtitle:
          isShadowEvent ? 'Read-only calendar context' : 'Notes and planning',
      actions: [
        RhythmButton.icon(
          icon: Icons.close,
          tooltip: 'Close details',
          compact: true,
          onPressed: () => widget.controller.selectTask(null),
        ),
      ],
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              task.title,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    decoration: isDone ? TextDecoration.lineThrough : null,
                    color: isDone ? colors.textMuted : colors.textPrimary,
                  ),
            ),
            const SizedBox(height: 8),
            if (!isShadowEvent)
              RhythmButton.quiet(
                icon:
                    isDone ? Icons.check_circle : Icons.radio_button_unchecked,
                label: isDone ? 'Mark open' : 'Mark done',
                onPressed: () => widget.controller.toggleTaskDone(task, isDone),
              ),
            const SizedBox(height: 14),
            RhythmDisclosure(
              title: 'Planning',
              subtitle: isShadowEvent
                  ? 'Calendar event metadata'
                  : 'Owner, date, and source',
              initiallyExpanded: true,
              child: Column(
                children: [
                  if (!isShadowEvent && task.sourceType != 'project_step') ...[
                    _editableOwnerRow(context, workspaceMembers),
                    if (task.ownerId != null) ...[
                      const SizedBox(height: 10),
                      _collaboratorsSection(
                        context,
                        task,
                        workspaceMembers,
                      ),
                    ],
                    const SizedBox(height: 14),
                  ],
                  if (!isShadowEvent)
                    _editableDateRow(
                      context,
                      label: 'Date',
                      value: _plannerDate == null
                          ? null
                          : DateFormatters.fullDate(
                              _plannerDate!,
                              fallback: _plannerDate!,
                            ),
                      onPick: _pickPlannerDate,
                      onClear: _clearPlannerDate,
                    ),
                  if (isShadowEvent && _plannerDate != null)
                    _row(
                      context,
                      'Date',
                      DateFormatters.fullDate(
                        _plannerDate!,
                        fallback: _plannerDate!,
                      ),
                    ),
                  if (isShadowEvent && timeLabel != null)
                    _row(context, 'Time', timeLabel),
                  if (task.sourceType != null)
                    _row(
                      context,
                      'Source',
                      _sourceLabel(task.sourceType!),
                    ),
                  if (task.sourceName != null && task.sourceName!.isNotEmpty)
                    _row(
                      context,
                      isShadowEvent ? 'Calendar' : 'Project',
                      task.sourceName!,
                    ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Text(
              isShadowEvent ? 'Details' : 'Notes',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: colors.textSecondary,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.4,
                  ),
            ),
            const SizedBox(height: 8),
            if (isShadowEvent)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: colors.surfaceRaised,
                  border: Border.all(color: colors.borderSubtle),
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                ),
                child: Text(
                  task.notes?.isNotEmpty == true
                      ? task.notes!
                      : 'No additional details.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colors.textPrimary,
                        height: 1.35,
                      ),
                ),
              )
            else
              TextField(
                controller: _notesCtrl,
                decoration: InputDecoration(
                  hintText: 'Add a note...',
                  filled: true,
                  fillColor: colors.surfaceRaised,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(RhythmRadius.sm),
                    borderSide: BorderSide(color: colors.borderSubtle),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(RhythmRadius.sm),
                    borderSide: BorderSide(color: colors.borderSubtle),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(RhythmRadius.sm),
                    borderSide: BorderSide(color: colors.accent),
                  ),
                  isDense: true,
                ),
                minLines: 3,
                maxLines: 8,
              ),
            const SizedBox(height: 10),
            if (!isShadowEvent && (_notesDirty || _datesDirty || _ownerDirty))
              Row(
                children: [
                  RhythmButton.filled(
                    onPressed: _saving ? null : _saveDetailChanges,
                    label: _saving ? 'Saving...' : 'Save changes',
                    compact: true,
                  ),
                  const SizedBox(width: 8),
                  RhythmButton.quiet(
                    onPressed: _saving
                        ? null
                        : () => setState(() {
                              _notesCtrl.text = widget.task.notes ?? '';
                              _dueDate = widget.task.dueDate;
                              _scheduledDate = widget.task.scheduledDate;
                              _ownerId = widget.task.ownerId;
                              _notesDirty = false;
                              _datesDirty = false;
                              _ownerDirty = false;
                            }),
                    label: 'Discard',
                    compact: true,
                  ),
                ],
              ),
            if (!isShadowEvent) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  RhythmButton.outlined(
                    onPressed: () => widget.controller.moveTaskEarlier(task),
                    icon: Icons.arrow_upward,
                    label: 'Move earlier',
                    compact: true,
                  ),
                  RhythmButton.outlined(
                    onPressed: () => widget.controller.moveTaskLater(task),
                    icon: Icons.arrow_downward,
                    label: 'Move later',
                    compact: true,
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _row(BuildContext context, String label, String value) {
    final colors = context.rhythm;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 76,
            child: Text(
              label,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: colors.textSecondary,
                    fontWeight: FontWeight.w600,
                  ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colors.textPrimary,
                    height: 1.35,
                  ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _editableDateRow(
    BuildContext context, {
    required String label,
    required String? value,
    required VoidCallback onPick,
    required VoidCallback? onClear,
  }) {
    final colors = context.rhythm;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 76,
            child: Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                label,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: colors.textSecondary,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ),
          ),
          Expanded(
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                RhythmButton.outlined(
                  onPressed: onPick,
                  icon: Icons.calendar_today,
                  label: value ?? 'Set date',
                  compact: true,
                ),
                if (value != null && onClear != null)
                  RhythmButton.quiet(
                    onPressed: onClear,
                    label: 'Clear',
                    compact: true,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _editableOwnerRow(
    BuildContext context,
    List<WorkspaceMember> workspaceMembers,
  ) {
    final colors = context.rhythm;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 76,
            child: Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Owner',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: colors.textSecondary,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ),
          ),
          Expanded(
            child: WorkspaceMemberPicker(
              workspaceMembers: workspaceMembers,
              selectedUserId: _ownerId,
              onChanged: (value) {
                setState(() {
                  _ownerId = value;
                  _ownerDirty = _ownerId != widget.task.ownerId;
                });
              },
              label: 'Select owner',
            ),
          ),
        ],
      ),
    );
  }

  Widget _collaboratorsSection(
    BuildContext context,
    Task task,
    List<WorkspaceMember> workspaceMembers,
  ) {
    final colors = context.rhythm;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 76,
            child: Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Collaborators',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: colors.textSecondary,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ),
          ),
          Expanded(
            child: CollaboratorsRow(
              collaborators: task.collaborators,
              ownerId: task.ownerId!,
              workspaceMembers: workspaceMembers,
              onAdd: (userId) async {
                final dataSource = CollaboratorsDataSource();
                await dataSource.addToTask(task.id, userId);
                await widget.controller.load();
              },
              onRemove: (userId) async {
                final dataSource = CollaboratorsDataSource();
                await dataSource.removeFromTask(task.id, userId);
                await widget.controller.load();
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _TaskOwnerPickerField extends StatelessWidget {
  const _TaskOwnerPickerField({
    required this.workspaceMembers,
    required this.selectedUserId,
    required this.onChanged,
  });

  final List<WorkspaceMember> workspaceMembers;
  final int? selectedUserId;
  final ValueChanged<int?> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 76,
          child: Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'Owner',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: colors.textSecondary,
                    fontWeight: FontWeight.w600,
                  ),
            ),
          ),
        ),
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: colors.surfaceRaised,
              borderRadius: BorderRadius.circular(RhythmRadius.sm),
              border: Border.all(color: colors.borderSubtle),
            ),
            child: WorkspaceMemberPicker(
              workspaceMembers: workspaceMembers,
              selectedUserId: selectedUserId,
              onChanged: onChanged,
              label: 'Select owner',
            ),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

class _MiniMoveButton extends StatelessWidget {
  const _MiniMoveButton({required this.icon, required this.onPressed});

  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return InkWell(
      onTap: onPressed,
      borderRadius: BorderRadius.circular(RhythmRadius.pill),
      child: Container(
        width: 18,
        height: 18,
        decoration: BoxDecoration(
          color: colors.surfaceMuted,
          borderRadius: BorderRadius.circular(RhythmRadius.pill),
          border: Border.all(color: colors.borderSubtle),
        ),
        child: Icon(icon, size: 12, color: colors.textSecondary),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// All-day events bar
// ---------------------------------------------------------------------------

class _AllDayEventsBar extends StatelessWidget {
  const _AllDayEventsBar({required this.events, required this.controller});
  final List<Task> events;
  final WeeklyPlannerController controller;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(6, 4, 6, 4),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: colors.borderSubtle)),
      ),
      child: Wrap(
        spacing: 4,
        runSpacing: 4,
        children: events.map((event) {
          final visualStyle = TaskVisualStyles.resolve(event);
          return GestureDetector(
            onTap: () => controller.selectTask(event.id),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: visualStyle.background,
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                border: Border.all(color: visualStyle.border),
              ),
              child: Text(
                event.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 9.5,
                  fontWeight: FontWeight.w600,
                  color: visualStyle.text,
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Time grid for timed calendar events
// ---------------------------------------------------------------------------

const double _kHourHeight = 52.0;
const double _kLabelWidth = 36.0;
const int _kStartHour = 6;
const int _kEndHour = 23;
const int _kTotalHours = _kEndHour - _kStartHour;

class _TimeGrid extends StatelessWidget {
  const _TimeGrid({required this.events, required this.controller});
  final List<Task> events;
  final WeeklyPlannerController controller;

  @override
  Widget build(BuildContext context) {
    const gridHeight = _kTotalHours * _kHourHeight;
    final colors = context.rhythm;

    return SizedBox(
      height: gridHeight,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: _kLabelWidth,
            child: Stack(
              children: [
                for (int h = _kStartHour; h < _kEndHour; h++)
                  Positioned(
                    top: (h - _kStartHour) * _kHourHeight - 6,
                    left: 0,
                    right: 2,
                    child: Text(
                      _hourLabel(h),
                      textAlign: TextAlign.right,
                      style: TextStyle(
                        fontSize: 9,
                        color: colors.textMuted,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: Stack(
              children: [
                ...List.generate(
                  _kTotalHours,
                  (i) => Positioned(
                    top: i * _kHourHeight,
                    left: 0,
                    right: 0,
                    child: Container(height: 1, color: colors.borderSubtle),
                  ),
                ),
                ...events.map((event) {
                  final top = _eventTop(event);
                  final height = _eventHeight(event);
                  return Positioned(
                    top: top,
                    left: 2,
                    right: 2,
                    child: SizedBox(
                      height: height.clamp(20.0, double.infinity),
                      child: _TimeGridEventTile(
                        event: event,
                        controller: controller,
                      ),
                    ),
                  );
                }),
              ],
            ),
          ),
        ],
      ),
    );
  }

  double _eventTop(Task event) {
    final start = parsePlannerEventDateTime(event.startsAt);
    if (start == null) return 0;
    final offsetHours = (start.hour - _kStartHour) + start.minute / 60.0;
    return offsetHours.clamp(0.0, _kTotalHours.toDouble()) * _kHourHeight;
  }

  double _eventHeight(Task event) {
    final start = parsePlannerEventDateTime(event.startsAt);
    final end = parsePlannerEventDateTime(event.endsAt);
    if (start == null) return _kHourHeight;
    final endTime = end ?? start.add(const Duration(hours: 1));
    final durationHours = endTime.difference(start).inMinutes / 60.0;
    return durationHours.clamp(0.5, _kTotalHours.toDouble()) * _kHourHeight;
  }

  static String _hourLabel(int h) {
    if (h == 12) return '12 PM';
    if (h == 0) return '12 AM';
    if (h > 12) return '${h - 12} PM';
    return '$h AM';
  }
}

// ---------------------------------------------------------------------------
// Compact event tile for use inside the time grid
// ---------------------------------------------------------------------------

class _TimeGridEventTile extends StatelessWidget {
  const _TimeGridEventTile({required this.event, required this.controller});
  final Task event;
  final WeeklyPlannerController controller;

  @override
  Widget build(BuildContext context) {
    final visualStyle = TaskVisualStyles.resolve(event);
    final timeLabel = _shadowEventLabel(event);
    return GestureDetector(
      onTap: () => controller.selectTask(event.id),
      child: Container(
        clipBehavior: Clip.hardEdge,
        decoration: BoxDecoration(
          color: visualStyle.background,
          borderRadius: BorderRadius.circular(RhythmRadius.sm),
          border: Border.all(color: visualStyle.border),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (timeLabel != null)
              Text(
                timeLabel,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.w700,
                  color: visualStyle.accent,
                ),
              ),
            Text(
              event.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: visualStyle.text,
                height: 1.2,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------

String? _shadowEventLabel(Task task) {
  if (task.isAllDay) return 'All day';
  final start = parsePlannerEventDateTime(task.startsAt);
  final end = parsePlannerEventDateTime(task.endsAt);
  if (start == null) return null;
  final startLabel = _formatClockTime(start);
  if (end == null) return startLabel;
  return '$startLabel - ${_formatClockTime(end)}';
}

DateTime? parsePlannerEventDateTime(String? value) {
  if (value == null || value.trim().isEmpty) return null;
  final parsed = DateTime.tryParse(value.trim());
  if (parsed == null) return null;
  return parsed.isUtc ? parsed.toLocal() : parsed;
}

String _formatClockTime(DateTime dateTime) {
  final hour = dateTime.hour == 0
      ? 12
      : dateTime.hour > 12
          ? dateTime.hour - 12
          : dateTime.hour;
  final minute = dateTime.minute.toString().padLeft(2, '0');
  final suffix = dateTime.hour >= 12 ? 'PM' : 'AM';
  return '$hour:$minute $suffix';
}

String _sourceLabel(String t) => switch (t) {
      'recurring_rule' => 'Rhythm',
      'project_step' => 'Project',
      'calendar_shadow_event' => 'Calendar',
      'planning_center_signal' => 'Planning Center',
      'automation_rule' => 'Automation',
      _ => t,
    };
