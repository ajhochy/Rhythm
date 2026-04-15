// ignore_for_file: use_build_context_synchronously
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../app/core/formatters/date_formatters.dart';
import '../../../app/core/tasks/task_visual_style.dart';
import '../../../app/core/widgets/error_banner.dart';
import '../../../app/core/workspace/workspace_controller.dart';
import '../../../app/core/workspace/workspace_models.dart';
import '../../../app/theme/rhythm_tokens.dart';
import '../../../shared/widgets/collaborators_row.dart';
import '../../../shared/widgets/workspace_member_picker.dart';
import '../../tasks/models/task.dart';
import '../controllers/weekly_planner_controller.dart';
import '../models/weekly_plan.dart';
import '../../tasks/data/collaborators_data_source.dart';

const _kCanvas = RhythmTokens.background;
const _kCanvasAccent = RhythmTokens.backgroundAccent;
const _kSurface = RhythmTokens.surfaceStrong;
const _kSurfaceMuted = RhythmTokens.surfaceMuted;
const _kBorder = RhythmTokens.borderSoft;
const _kBorderStrong = RhythmTokens.border;
const _kTextPrimary = RhythmTokens.textPrimary;
const _kTextSecondary = RhythmTokens.textSecondary;
const _kTextMuted = RhythmTokens.textMuted;
const _kPrimary = RhythmTokens.accent;
const _kPrimarySoft = RhythmTokens.accentSoft;
const _kDanger = RhythmTokens.danger;

class WeeklyPlannerView extends StatefulWidget {
  const WeeklyPlannerView({super.key});

  @override
  State<WeeklyPlannerView> createState() => _WeeklyPlannerViewState();
}

class _WeeklyPlannerViewState extends State<WeeklyPlannerView> {
  bool _showCompleted = false;

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
        return Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [_kCanvas, Color(0xFFF7F4EF), _kCanvasAccent],
              stops: [0.0, 0.6, 1.0],
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: _kSurface,
                borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
                border: Border.all(color: _kBorder),
                boxShadow: RhythmTokens.shadow,
              ),
              child: Column(
                children: [
                  _WeekHeader(
                    controller: controller,
                    showCompleted: _showCompleted,
                    onToggleCompleted: () =>
                        setState(() => _showCompleted = !_showCompleted),
                  ),
                  if (controller.status == WeeklyPlannerStatus.error &&
                      controller.errorMessage != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
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
          ),
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

class _WeekHeader extends StatelessWidget {
  const _WeekHeader({
    required this.controller,
    required this.showCompleted,
    required this.onToggleCompleted,
  });
  final WeeklyPlannerController controller;
  final bool showCompleted;
  final VoidCallback onToggleCompleted;

  @override
  Widget build(BuildContext context) {
    final label = _formatWeekLabel(controller.currentWeekLabel);
    final hasSelection = controller.selectedTaskIds.isNotEmpty;
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
      decoration: const BoxDecoration(
        color: _kSurface,
        border: Border(bottom: BorderSide(color: _kBorder)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          'Weekly Planner',
                          style: Theme.of(context)
                              .textTheme
                              .headlineSmall
                              ?.copyWith(
                                color: _kTextPrimary,
                                fontWeight: FontWeight.w700,
                              ),
                        ),
                        const SizedBox(width: 10),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 5,
                          ),
                          decoration: BoxDecoration(
                            color: _kPrimarySoft,
                            borderRadius:
                                BorderRadius.circular(RhythmTokens.radiusS),
                          ),
                          child: Text(
                            label,
                            style: Theme.of(context)
                                .textTheme
                                .labelSmall
                                ?.copyWith(
                                  color: _kPrimary,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'A quieter workspace for the week ahead.',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: _kTextSecondary,
                          ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                alignment: WrapAlignment.end,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  _HeaderPillButton(
                    icon: Icons.chevron_left,
                    tooltip: 'Previous week',
                    onPressed: controller.goToPrevWeek,
                  ),
                  _HeaderPillButton(
                    icon: Icons.chevron_right,
                    tooltip: 'Next week',
                    onPressed: controller.goToNextWeek,
                  ),
                  OutlinedButton(
                    onPressed:
                        controller.isCurrentWeek ? null : controller.goToToday,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: _kTextPrimary,
                      side: const BorderSide(color: _kBorderStrong),
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(RhythmTokens.radiusS),
                      ),
                    ),
                    child: const Text('Today'),
                  ),
                  TextButton.icon(
                    onPressed: onToggleCompleted,
                    style: TextButton.styleFrom(
                      foregroundColor: _kTextPrimary,
                      backgroundColor: _kSurfaceMuted,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 12,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(RhythmTokens.radiusS),
                      ),
                    ),
                    icon: Icon(
                      showCompleted ? Icons.visibility_off : Icons.visibility,
                      size: 16,
                    ),
                    label: Text(showCompleted ? 'Hide done' : 'Show done'),
                  ),
                ],
              ),
            ],
          ),
          if (hasSelection) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: _kSurfaceMuted,
                    borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                    border: Border.all(color: _kBorder),
                  ),
                  child: Text(
                    '${controller.selectedTaskIds.length} selected',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: _kTextSecondary,
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton.tonalIcon(
                  onPressed: () => controller.bulkToggleSelectedTasks(
                    [
                      ...?controller.plan?.days.expand((d) => d.tasks),
                      ...?controller.plan?.backlog,
                    ],
                    'done',
                  ),
                  icon: const Icon(Icons.checklist, size: 16),
                  label: const Text('Mark complete'),
                ),
                const SizedBox(width: 8),
                TextButton(
                  onPressed: controller.clearTaskSelection,
                  child: const Text('Clear selection'),
                ),
              ],
            ),
          ],
        ],
      ),
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

class _HeaderPillButton extends StatelessWidget {
  const _HeaderPillButton({
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      style: IconButton.styleFrom(
        backgroundColor: _kSurfaceMuted,
        foregroundColor: _kTextPrimary,
        side: const BorderSide(color: _kBorder),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
        ),
      ),
      icon: Icon(icon, size: 18),
    );
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
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 240),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: _kSurface,
          borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
          border: Border.all(color: _kBorder),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: _kPrimarySoft,
                borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
              ),
              child: Icon(icon, size: 18, color: _kPrimary),
            ),
            const SizedBox(height: 10),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: _kTextPrimary,
                    fontWeight: FontWeight.w700,
                  ),
            ),
            const SizedBox(height: 6),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: _kTextSecondary,
                    height: 1.35,
                  ),
            ),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 12),
              FilledButton.tonal(
                onPressed: onAction,
                child: Text(actionLabel!),
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

  @override
  Widget build(BuildContext context) {
    if (controller.status == WeeklyPlannerStatus.loading &&
        controller.plan == null) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 12),
            Text('Loading this week...'),
          ],
        ),
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

    final allTasks = [
      ...plan.days.expand((d) => d.tasks),
      ...plan.backlog,
    ];
    final visibleBacklog = showCompleted
        ? plan.backlog
        : plan.backlog.where((t) => t.status != 'done').toList();
    final showBacklogPane = visibleBacklog.isNotEmpty;
    final selectedTask = controller.selectedTaskId != null
        ? allTasks.cast<Task?>().firstWhere(
            (t) => t?.id == controller.selectedTaskId,
            orElse: () => null)
        : null;

    return Padding(
      padding: const EdgeInsets.all(12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (showBacklogPane) ...[
            SizedBox(
              width: 260,
              child: _BacklogPane(
                plan: plan,
                controller: controller,
                showCompleted: showCompleted,
              ),
            ),
            const SizedBox(width: 12),
          ],
          Expanded(
            child: _DayColumnsPane(
              plan: plan,
              controller: controller,
              showCompleted: showCompleted,
            ),
          ),
          if (selectedTask != null) ...[
            const SizedBox(width: 12),
            SizedBox(
              width: 320,
              child: _DetailPane(
                key: ValueKey(selectedTask.id),
                task: selectedTask,
                controller: controller,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Backlog pane
// ---------------------------------------------------------------------------

class _BacklogPane extends StatelessWidget {
  const _BacklogPane(
      {required this.plan,
      required this.controller,
      required this.showCompleted});
  final WeeklyPlan plan;
  final WeeklyPlannerController controller;
  final bool showCompleted;

  @override
  Widget build(BuildContext context) {
    final backlog = showCompleted
        ? plan.backlog
        : plan.backlog.where((t) => t.status != 'done').toList();
    return Container(
      decoration: BoxDecoration(
        color: _kSurfaceMuted,
        borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
        border: Border.all(color: _kBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
            child: Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: _kPrimarySoft,
                    borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                  ),
                  child: const Icon(
                    Icons.inbox_outlined,
                    size: 16,
                    color: _kPrimary,
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
                              color: _kTextPrimary,
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Tasks waiting to be scheduled',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: _kTextSecondary,
                            ),
                      ),
                    ],
                  ),
                ),
                if (backlog.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: _kSurface,
                      borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                      border: Border.all(color: _kBorder),
                    ),
                    child: Text(
                      '${backlog.length}',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: _kTextSecondary,
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                  ),
              ],
            ),
          ),
          const Divider(height: 1, color: _kBorder),
          Expanded(
            child: Column(
              children: [
                Expanded(
                  child: backlog.isEmpty
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: _EmptyWorkspaceState(
                              icon: Icons.inbox_outlined,
                              title: 'Nothing in backlog',
                              message:
                                  'Undated work lands here until you schedule it into the week.',
                              actionLabel: 'Add task',
                              onAction: () =>
                                  _showAddBacklogTaskDialog(context),
                            ),
                          ),
                        )
                      : ListView.separated(
                          padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
                          itemCount: backlog.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 6),
                          itemBuilder: (context, i) => _TaskTile(
                            task: backlog[i],
                            controller: controller,
                            draggable: true,
                          ),
                        ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                    onTap: () => _showAddBacklogTaskDialog(context),
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                      decoration: BoxDecoration(
                        color: _kSurface,
                        borderRadius:
                            BorderRadius.circular(RhythmTokens.radiusS),
                        border: Border.all(color: _kBorder),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.add,
                            size: 14,
                            color: _kTextSecondary,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            'Add unscheduled task',
                            style: Theme.of(context)
                                .textTheme
                                .labelSmall
                                ?.copyWith(
                                  color: _kTextSecondary,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _showAddBacklogTaskDialog(BuildContext context) async {
    final ctrl = TextEditingController();
    final workspaceMembers = context.read<WorkspaceController>().members;
    int? ownerId;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          backgroundColor: _kSurface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
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
                    fillColor: _kSurfaceMuted,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                      borderSide: const BorderSide(color: _kBorder),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                      borderSide: const BorderSide(color: _kBorder),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                      borderSide: const BorderSide(color: _kPrimary),
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
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Add')),
          ],
        ),
      ),
    );
    if (confirmed == true && ctrl.text.trim().isNotEmpty) {
      await controller.createTask(ctrl.text.trim(), ownerId: ownerId);
    }
  }
}

// ---------------------------------------------------------------------------
// Day columns pane
// ---------------------------------------------------------------------------

class _DayColumnsPane extends StatelessWidget {
  const _DayColumnsPane(
      {required this.plan,
      required this.controller,
      required this.showCompleted});
  final WeeklyPlan plan;
  final WeeklyPlannerController controller;
  final bool showCompleted;

  static const _dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: _kSurface,
        borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
        border: Border.all(color: _kBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
            child: Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: _kPrimarySoft,
                    borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                  ),
                  child: const Icon(
                    Icons.calendar_view_week_outlined,
                    size: 16,
                    color: _kPrimary,
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
                              color: _kTextPrimary,
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Scheduled work across the week',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: _kTextSecondary,
                            ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: _kBorder),
          Expanded(
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
    final displayTasks = widget.showCompleted
        ? widget.tasks
        : widget.tasks.where((t) => t.status != 'done').toList();
    final addButton = Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
        onTap: () => _showAddTaskDialog(context),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(
            horizontal: 10,
            vertical: 8,
          ),
          decoration: BoxDecoration(
            color: _kSurface,
            borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
            border: Border.all(color: _kBorder),
          ),
          child: Row(
            children: [
              const Icon(
                Icons.add,
                size: 13,
                color: _kTextSecondary,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'Add task to ${widget.dayName}',
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: _kTextSecondary,
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
            color: _hovering ? _kPrimarySoft : _kSurfaceMuted,
            border: Border(
              right: widget.isLast
                  ? BorderSide.none
                  : const BorderSide(color: _kBorder),
              top: BorderSide(
                color: today ? _kPrimary : _kBorder,
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
                  color: today ? _kSurface : _kSurfaceMuted,
                  border: Border(
                    bottom: BorderSide(
                      color:
                          today ? _kPrimary.withValues(alpha: 0.18) : _kBorder,
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
                          style:
                              Theme.of(context).textTheme.labelSmall?.copyWith(
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: 0.3,
                                    color: today ? _kPrimary : _kTextPrimary,
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
                              color: _kPrimarySoft,
                              borderRadius:
                                  BorderRadius.circular(RhythmTokens.radiusS),
                            ),
                            child: Text(
                              'Today',
                              style: Theme.of(context)
                                  .textTheme
                                  .labelSmall
                                  ?.copyWith(
                                    color: _kPrimary,
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
                            color: today ? _kPrimary : _kTextSecondary,
                          ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: displayTasks.isEmpty
                    ? Align(
                        alignment: Alignment.topCenter,
                        child: addButton,
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.fromLTRB(0, 0, 0, 0),
                        itemCount: displayTasks.length + 1,
                        itemBuilder: (context, index) {
                          if (index == displayTasks.length) {
                            return addButton;
                          }
                          return Padding(
                            padding: EdgeInsets.only(
                              top: index == 0 ? 8 : 6,
                            ),
                            child: _TaskTile(
                              task: displayTasks[index],
                              controller: widget.controller,
                              draggable: true,
                              compact: true,
                            ),
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
        builder: (ctx, setState) => AlertDialog(
          backgroundColor: _kSurface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
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
                    fillColor: _kSurfaceMuted,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                      borderSide: const BorderSide(color: _kBorder),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                      borderSide: const BorderSide(color: _kBorder),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                      borderSide: const BorderSide(color: _kPrimary),
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
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Add')),
          ],
        ),
      ),
    );
    if (confirmed == true && ctrl.text.trim().isNotEmpty) {
      await widget.controller
          .createTask(ctrl.text.trim(), dueDate: widget.date, ownerId: ownerId);
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
    return Draggable<Task>(
      data: task,
      feedback: Material(
        color: Colors.transparent,
        elevation: 0,
        borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
        child: Container(
          width: 160,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: _kSurface,
            borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
            border: Border.all(color: _kBorder),
            boxShadow: RhythmTokens.shadow,
          ),
          child: Text(task.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: _kTextPrimary,
                  )),
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
    return GestureDetector(
      onTap: () => controller.selectTask(task.id),
      onLongPress:
          isShadowEvent ? null : () => controller.toggleTaskSelection(task.id),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 120),
        margin: compact
            ? const EdgeInsets.symmetric(horizontal: 8, vertical: 1)
            : const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        padding: EdgeInsets.symmetric(
          horizontal: compact ? 8 : 10,
          vertical: compact ? 6 : 10,
        ),
        decoration: BoxDecoration(
          color: isSelected || isMultiSelected
              ? _kPrimarySoft
              : visualStyle.background,
          borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
          border: Border.all(
            color:
                isSelected || isMultiSelected ? _kPrimary : visualStyle.border,
          ),
          boxShadow:
              isSelected || isMultiSelected ? RhythmTokens.shadow : const [],
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
                  borderRadius: BorderRadius.circular(999),
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
                  if (task.sourceName != null && task.sourceName!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 2),
                      child: Text(
                        task.sourceName!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: (compact
                                ? Theme.of(context).textTheme.labelSmall
                                : Theme.of(context).textTheme.bodySmall)
                            ?.copyWith(
                          fontSize: compact ? 9.5 : 10,
                          fontWeight: FontWeight.w700,
                          color: visualStyle.accent,
                        ),
                      ),
                    ),
                  Text(
                    task.title,
                    maxLines: compact ? 3 : 2,
                    overflow: TextOverflow.ellipsis,
                    style: (compact
                            ? Theme.of(context).textTheme.labelSmall
                            : Theme.of(context).textTheme.bodySmall)
                        ?.copyWith(
                      decoration: isDone ? TextDecoration.lineThrough : null,
                      color: isDone ? _kTextMuted : visualStyle.text,
                      fontSize: compact ? 10.5 : null,
                      height: compact ? 1.15 : 1.2,
                    ),
                  ),
                  if (isPastDue || task.sourceType != null) ...[
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        if (isPastDue)
                          _TaskBadge(
                            label: 'Past due',
                            backgroundColor: _kDanger.withValues(alpha: 0.12),
                            foregroundColor: _kDanger,
                          ),
                        if (task.sourceType != null) _SourceChip(task: task),
                      ],
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
              const Icon(Icons.done_all, size: 14, color: _kPrimary),
            ],
            if (task.locked && !compact) ...[
              const SizedBox(width: 6),
              const Icon(Icons.lock, size: 11, color: _kTextSecondary),
            ],
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Detail pane — editable notes
// ---------------------------------------------------------------------------

class _DetailPane extends StatefulWidget {
  const _DetailPane({super.key, required this.task, required this.controller});
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
    _notesCtrl.addListener(() => setState(
        () => _notesDirty = _notesCtrl.text != (widget.task.notes ?? '')));
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
    return Container(
      decoration: BoxDecoration(
        color: _kSurfaceMuted,
        borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
        border: Border.all(color: _kBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(16, 16, 10, 14),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: _kBorder)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Task details',
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                              color: _kTextPrimary,
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        isShadowEvent
                            ? 'Read-only calendar context'
                            : 'Notes, dates, and completion',
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: _kTextSecondary,
                            ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, size: 18),
                  onPressed: () => widget.controller.selectTask(null),
                  style: IconButton.styleFrom(
                    backgroundColor: _kSurface,
                    foregroundColor: _kTextPrimary,
                    side: const BorderSide(color: _kBorder),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    task.title,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          decoration:
                              isDone ? TextDecoration.lineThrough : null,
                          color: isDone ? _kTextMuted : _kTextPrimary,
                        ),
                  ),
                  const SizedBox(height: 8),
                  if (!isShadowEvent)
                    TextButton.icon(
                      icon: Icon(
                        isDone
                            ? Icons.check_circle
                            : Icons.radio_button_unchecked,
                        size: 16,
                      ),
                      label: Text(isDone ? 'Mark open' : 'Mark done'),
                      style: TextButton.styleFrom(
                        foregroundColor: _kPrimary,
                        backgroundColor: _kPrimarySoft,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 10,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(RhythmTokens.radiusS),
                        ),
                      ),
                      onPressed: () =>
                          widget.controller.toggleTaskDone(task, isDone),
                    ),
                  const SizedBox(height: 14),
                  if (!isShadowEvent && task.sourceType != 'project_step') ...[
                    _editableOwnerRow(context, workspaceMembers),
                    if (task.ownerId != null) ...[
                      const SizedBox(height: 10),
                      _collaboratorsSection(context, task, workspaceMembers),
                    ],
                    const SizedBox(height: 14),
                  ],
                  if (!isShadowEvent)
                    _editableDateRow(
                      context,
                      label: 'Date',
                      value: _plannerDate == null
                          ? null
                          : DateFormatters.fullDate(_plannerDate!,
                              fallback: _plannerDate!),
                      onPick: _pickPlannerDate,
                      onClear: _clearPlannerDate,
                    ),
                  if (isShadowEvent && _plannerDate != null)
                    _row(
                      context,
                      'Date',
                      DateFormatters.fullDate(_plannerDate!,
                          fallback: _plannerDate!),
                    ),
                  if (isShadowEvent && timeLabel != null)
                    _row(context, 'Time', timeLabel),
                  if (task.sourceType != null)
                    _row(context, 'Source', _sourceLabel(task.sourceType!)),
                  if (task.sourceName != null && task.sourceName!.isNotEmpty)
                    _row(context, isShadowEvent ? 'Calendar' : 'Project',
                        task.sourceName!),
                  const SizedBox(height: 16),
                  Text(
                    isShadowEvent ? 'Details' : 'Notes',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: _kTextSecondary,
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
                        color: _kSurface,
                        border: Border.all(color: _kBorder),
                        borderRadius:
                            BorderRadius.circular(RhythmTokens.radiusS),
                      ),
                      child: Text(
                        task.notes?.isNotEmpty == true
                            ? task.notes!
                            : 'No additional details.',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: _kTextPrimary,
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
                        fillColor: _kSurface,
                        border: OutlineInputBorder(
                          borderRadius:
                              BorderRadius.circular(RhythmTokens.radiusS),
                          borderSide: const BorderSide(color: _kBorder),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius:
                              BorderRadius.circular(RhythmTokens.radiusS),
                          borderSide: const BorderSide(color: _kBorder),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius:
                              BorderRadius.circular(RhythmTokens.radiusS),
                          borderSide: const BorderSide(color: _kPrimary),
                        ),
                        isDense: true,
                      ),
                      minLines: 3,
                      maxLines: 8,
                    ),
                  const SizedBox(height: 10),
                  if (!isShadowEvent &&
                      (_notesDirty || _datesDirty || _ownerDirty))
                    Row(
                      children: [
                        FilledButton.tonal(
                          onPressed: _saving ? null : _saveDetailChanges,
                          child: _saving
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Text('Save changes'),
                        ),
                        const SizedBox(width: 8),
                        TextButton(
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
                          child: const Text('Discard'),
                        ),
                      ],
                    ),
                  if (!isShadowEvent) ...[
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        OutlinedButton.icon(
                          onPressed: () =>
                              widget.controller.moveTaskEarlier(task),
                          icon: const Icon(Icons.arrow_upward, size: 14),
                          label: const Text('Move earlier'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: _kTextPrimary,
                            side: const BorderSide(color: _kBorderStrong),
                            backgroundColor: _kSurface,
                          ),
                        ),
                        OutlinedButton.icon(
                          onPressed: () =>
                              widget.controller.moveTaskLater(task),
                          icon: const Icon(Icons.arrow_downward, size: 14),
                          label: const Text('Move later'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: _kTextPrimary,
                            side: const BorderSide(color: _kBorderStrong),
                            backgroundColor: _kSurface,
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _row(BuildContext context, String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 76,
            child: Text(label,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: _kTextSecondary,
                      fontWeight: FontWeight.w600,
                    )),
          ),
          Expanded(
            child: Text(
              value,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: _kTextPrimary,
                    height: 1.35,
                  ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _editableDateRow(BuildContext context,
      {required String label,
      required String? value,
      required VoidCallback onPick,
      required VoidCallback? onClear}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 76,
            child: Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(label,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: _kTextSecondary,
                        fontWeight: FontWeight.w600,
                      )),
            ),
          ),
          Expanded(
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: onPick,
                  icon: const Icon(Icons.calendar_today, size: 14),
                  label: Text(value ?? 'Set date'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: _kTextPrimary,
                    side: const BorderSide(color: _kBorderStrong),
                    backgroundColor: _kSurface,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                    ),
                  ),
                ),
                if (value != null && onClear != null)
                  TextButton(
                    onPressed: onClear,
                    style: TextButton.styleFrom(
                      foregroundColor: _kTextSecondary,
                    ),
                    child: const Text('Clear'),
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
                      color: _kTextSecondary,
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
                      color: _kTextSecondary,
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
                    color: _kTextSecondary,
                    fontWeight: FontWeight.w600,
                  ),
            ),
          ),
        ),
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: _kSurface,
              borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
              border: Border.all(color: _kBorder),
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
  const _MiniMoveButton({
    required this.icon,
    required this.onPressed,
  });

  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onPressed,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        width: 18,
        height: 18,
        decoration: BoxDecoration(
          color: _kSurfaceMuted,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: _kBorder),
        ),
        child: Icon(icon, size: 12, color: _kTextSecondary),
      ),
    );
  }
}

class _SourceChip extends StatelessWidget {
  const _SourceChip({required this.task});
  final Task task;

  @override
  Widget build(BuildContext context) {
    final sourceType = task.sourceType ?? '';
    final accent = TaskVisualStyles.resolve(task).accent;
    final (label, color) = switch (sourceType) {
      'recurring_rule' => ('R', accent),
      'project_step' => ('P', accent),
      'calendar_shadow_event' => ('C', accent),
      'planning_center_signal' => ('PC', accent),
      'automation_rule' => ('A', accent),
      _ => ('T', accent),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
      ),
      child: Text(label,
          style: TextStyle(
              fontSize: 9.5, fontWeight: FontWeight.bold, color: color)),
    );
  }
}

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

class _TaskBadge extends StatelessWidget {
  const _TaskBadge({
    required this.label,
    required this.backgroundColor,
    required this.foregroundColor,
  });

  final String label;
  final Color backgroundColor;
  final Color foregroundColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: foregroundColor,
        ),
      ),
    );
  }
}
