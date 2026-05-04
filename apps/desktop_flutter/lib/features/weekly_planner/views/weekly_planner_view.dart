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
      onToggleStatus: task.sourceType == 'calendar_shadow_event'
          ? null
          : () => controller.toggleTaskDone(task, task.status == 'done'),
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
      leading: RhythmBadge(
        label: label,
        icon: Icons.calendar_today_outlined,
        tone: RhythmBadgeTone.accent,
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: RhythmSpacing.md,
        vertical: 4,
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
        const RhythmColorLegend(
          items: [
            (Color(0xFFDC5B58), 'Past due'),
            (Color(0xFFE29A3A), 'Today'),
            (Color(0xFF4E5FE0), 'Rhythm'),
            (Color(0xFF2E7FC4), 'Project'),
            (Color(0xFF0D9B87), 'Automation'),
            (Color(0xFFC1602A), 'Planning Center'),
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
            padding: const EdgeInsets.fromLTRB(10, 4, 10, 4),
            child: Row(
              children: [
                Icon(Icons.inbox_outlined, size: 14, color: colors.accent),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Backlog',
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: colors.textPrimary,
                          fontWeight: FontWeight.w700,
                        ),
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
    final result = await showRhythmTaskCreateDialog(
      context,
      title: 'Add unscheduled task',
      workspaceMembers: context.read<WorkspaceController>().members,
    );
    if (result != null && result.title.isNotEmpty) {
      await controller.createTask(result.title, ownerId: result.ownerId);
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
            padding: const EdgeInsets.fromLTRB(10, 4, 10, 4),
            child: Row(
              children: [
                Icon(
                  Icons.calendar_view_week_outlined,
                  size: 14,
                  color: colors.accent,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'This week',
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: colors.textPrimary,
                          fontWeight: FontWeight.w700,
                        ),
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
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
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
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      widget.dayName,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.3,
                            color: today ? colors.accent : colors.textPrimary,
                          ),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      _shortDate(),
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: today ? colors.accent : colors.textSecondary,
                          ),
                    ),
                    if (today) ...[
                      const SizedBox(width: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 5,
                          vertical: 1,
                        ),
                        decoration: BoxDecoration(
                          color: colors.accentMuted,
                          borderRadius: BorderRadius.circular(RhythmRadius.sm),
                        ),
                        child: Text(
                          'Today',
                          style:
                              Theme.of(context).textTheme.labelSmall?.copyWith(
                                    color: colors.accent,
                                    fontWeight: FontWeight.w600,
                                    fontSize: 9,
                                  ),
                        ),
                      ),
                    ],
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
                    final combinedEvents = [...allDayEvents, ...timedEvents];
                    final regularTasks = displayTasks
                        .where(
                          (t) => t.sourceType != 'calendar_shadow_event',
                        )
                        .toList()
                      ..sort((a, b) {
                        final aOrder = a.scheduledOrder ?? 10000000;
                        final bOrder = b.scheduledOrder ?? 10000000;
                        final cmp = aOrder.compareTo(bOrder);
                        if (cmp != 0) return cmp;
                        return a.title.toLowerCase().compareTo(
                              b.title.toLowerCase(),
                            );
                      });

                    final hasContent =
                        combinedEvents.isNotEmpty || regularTasks.isNotEmpty;

                    if (!hasContent) {
                      return Align(
                        alignment: Alignment.topCenter,
                        child: addButton,
                      );
                    }

                    return Column(
                      children: [
                        if (combinedEvents.isNotEmpty)
                          _EventsBar(
                            events: combinedEvents,
                            controller: widget.controller,
                            columnDate: widget.date,
                          ),
                        Expanded(
                          child: SingleChildScrollView(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                for (var i = 0; i < regularTasks.length; i++)
                                  _TaskReorderTarget(
                                    task: regularTasks[i],
                                    previousTask:
                                        i > 0 ? regularTasks[i - 1] : null,
                                    columnDate: widget.date,
                                    controller: widget.controller,
                                    child: Padding(
                                      padding: const EdgeInsets.only(top: 6),
                                      child: _TaskTile(
                                        task: regularTasks[i],
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
    final result = await showRhythmTaskCreateDialog(
      context,
      title: 'Add task for ${widget.dayName}',
      workspaceMembers: context.read<WorkspaceController>().members,
    );
    if (result != null && result.title.isNotEmpty) {
      await widget.controller.createTask(
        result.title,
        dueDate: widget.date,
        ownerId: result.ownerId,
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
    final colors = context.rhythm;
    return GestureDetector(
      onTap: () => controller.selectTask(task.id),
      onLongPress:
          isShadowEvent ? null : () => controller.toggleTaskSelection(task.id),
      child: LayoutBuilder(
        builder: (context, constraints) {
          return AnimatedContainer(
            duration: const Duration(milliseconds: 120),
            margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            padding: EdgeInsets.symmetric(
              horizontal: compact ? 8 : 10,
              vertical: compact ? 6 : 4,
            ),
            decoration: BoxDecoration(
              color: isSelected || isMultiSelected
                  ? colors.accentMuted
                  : _plannerSurfaceColor(context, task, visualStyle),
              borderRadius: BorderRadius.circular(RhythmRadius.sm),
              border: Border.all(
                color: isSelected || isMultiSelected
                    ? colors.accent
                    : _plannerBorderColor(context, task, visualStyle),
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
                              color: _plannerAccentColor(context, visualStyle),
                            ),
                          ),
                        ),
                      Text(
                        task.title,
                        style: (compact
                                ? Theme.of(context).textTheme.labelSmall
                                : Theme.of(context).textTheme.bodySmall)
                            ?.copyWith(
                          decoration:
                              isDone ? TextDecoration.lineThrough : null,
                          color: isDone
                              ? colors.textMuted
                              : _plannerTextColor(context, visualStyle),
                          fontSize: compact ? 11 : null,
                          fontWeight: FontWeight.w700,
                          height: compact ? 1.25 : 1.3,
                        ),
                      ),
                    ],
                  ),
                ),
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
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: RhythmAssigneeField(
        workspaceMembers: workspaceMembers,
        selectedUserId: _ownerId,
        onChanged: (value) {
          setState(() {
            _ownerId = value;
            _ownerDirty = _ownerId != widget.task.ownerId;
          });
        },
        label: 'Owner',
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

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Per-tile drop zone — shows an accent indicator on hover and re-positions
// the dragged task above this tile by computing a midpoint scheduledOrder
// between the previous task and this one.
// ---------------------------------------------------------------------------

class _TaskReorderTarget extends StatelessWidget {
  const _TaskReorderTarget({
    required this.task,
    required this.previousTask,
    required this.columnDate,
    required this.controller,
    required this.child,
  });

  final Task task;
  final Task? previousTask;
  final String columnDate;
  final WeeklyPlannerController controller;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return DragTarget<Task>(
      onWillAcceptWithDetails: (details) {
        final dragged = details.data;
        if (dragged.id == task.id) return false;
        if (dragged.id == previousTask?.id) return false;
        return true;
      },
      onAcceptWithDetails: (details) {
        final dragged = details.data;
        final targetOrder = task.scheduledOrder ?? 10000000;
        final previousOrder =
            previousTask?.scheduledOrder ?? (targetOrder - 10000);
        final newOrder = ((previousOrder + targetOrder) / 2).round();
        final isProjectStep = dragged.sourceType == 'project_step';
        if (isProjectStep) {
          controller.updateTask(
            dragged,
            dueDate: columnDate,
            scheduledOrder: newOrder,
          );
        } else if (dragged.dueDate == null && dragged.scheduledDate == null) {
          // Coming from backlog — set both dates so it lives on this day.
          controller.updateTask(
            dragged,
            dueDate: columnDate,
            scheduledDate: columnDate,
            scheduledOrder: newOrder,
          );
        } else {
          controller.updateTask(
            dragged,
            scheduledDate: columnDate,
            scheduledOrder: newOrder,
          );
        }
      },
      builder: (context, candidates, _) {
        final hovering = candidates.isNotEmpty;
        return Column(
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 100),
              height: hovering ? 2 : 0,
              margin: const EdgeInsets.symmetric(horizontal: 8),
              decoration: BoxDecoration(
                color: hovering ? colors.accent : Colors.transparent,
                borderRadius: BorderRadius.circular(RhythmRadius.pill),
              ),
            ),
            child,
          ],
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Events bar (all-day and timed calendar events as compact pills)
// ---------------------------------------------------------------------------

class _EventsBar extends StatelessWidget {
  const _EventsBar({
    required this.events,
    required this.controller,
    required this.columnDate,
  });
  final List<Task> events;
  final WeeklyPlannerController controller;
  final String columnDate;

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
          final isAllDay = event.isAllDay;
          final isContinuation =
              (event.scheduledDate ?? event.dueDate) != columnDate;
          final String pillText;
          final String tooltipText;
          if (isContinuation) {
            pillText = '→ ${event.title}';
            tooltipText = 'Continues · ${event.title}';
          } else if (isAllDay) {
            pillText = event.title;
            tooltipText = 'All day · ${event.title}';
          } else {
            final startDt = parsePlannerEventDateTime(event.startsAt);
            final startTime = startDt != null ? _formatClockTime(startDt) : '';
            pillText = startTime.isNotEmpty
                ? '$startTime · ${event.title}'
                : event.title;
            final rangeLabel = _shadowEventLabel(event) ?? '';
            tooltipText = rangeLabel.isNotEmpty
                ? '$rangeLabel · ${event.title}'
                : event.title;
          }
          return Tooltip(
            message: tooltipText,
            child: GestureDetector(
              onTap: () => controller.selectTask(event.id),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: _plannerSurfaceColor(context, event, visualStyle),
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                  border: Border.all(
                    color: _plannerBorderColor(context, event, visualStyle),
                  ),
                ),
                child: Text(
                  pillText,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 9.5,
                    fontWeight: FontWeight.w600,
                    color: _plannerTextColor(context, visualStyle),
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

Color _plannerSurfaceColor(
  BuildContext context,
  Task task,
  TaskVisualStyle visualStyle,
) {
  final colors = context.rhythm;
  if (Theme.of(context).brightness != Brightness.dark) {
    return visualStyle.background;
  }
  if (task.status == 'done') {
    return colors.surfaceMuted.withValues(alpha: 0.72);
  }
  return Color.lerp(colors.surfaceRaised, visualStyle.accent, 0.12)!;
}

Color _plannerBorderColor(
  BuildContext context,
  Task task,
  TaskVisualStyle visualStyle,
) {
  final colors = context.rhythm;
  if (Theme.of(context).brightness != Brightness.dark) {
    return visualStyle.border;
  }
  if (task.status == 'done') {
    return colors.border;
  }
  return Color.lerp(colors.border, visualStyle.accent, 0.38)!;
}

Color _plannerTextColor(BuildContext context, TaskVisualStyle visualStyle) {
  final colors = context.rhythm;
  if (Theme.of(context).brightness != Brightness.dark) {
    return visualStyle.text;
  }
  return colors.textPrimary;
}

Color _plannerAccentColor(BuildContext context, TaskVisualStyle visualStyle) {
  if (Theme.of(context).brightness != Brightness.dark) {
    return visualStyle.accent;
  }
  return Color.lerp(context.rhythm.textPrimary, visualStyle.accent, 0.72)!;
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
