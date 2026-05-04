import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../app/core/formatters/date_formatters.dart';
import '../../../app/core/tasks/task_visual_style.dart';
import '../../../app/core/ui/rhythm_ui.dart';
import '../../../app/core/widgets/error_banner.dart';
import '../../../app/core/workspace/workspace_controller.dart';
import '../controllers/tasks_controller.dart';
import '../data/collaborators_data_source.dart';
import '../models/task.dart';
// ignore_for_file: use_build_context_synchronously

class TasksView extends StatefulWidget {
  const TasksView({super.key});

  @override
  State<TasksView> createState() => _TasksViewState();
}

class _TasksViewState extends State<TasksView> {
  final _searchController = TextEditingController();
  bool _showCompleted = false;
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<TasksController>().load();
      context.read<WorkspaceController>().loadMembers();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RhythmSurface.page(
      padding: const EdgeInsets.all(RhythmSpacing.sm),
      child: Consumer<TasksController>(
        builder: (context, controller, _) {
          final visibleTasks = _visibleTasks(controller);
          return RhythmSurface.section(
            clipBehavior: Clip.antiAlias,
            padding: EdgeInsets.zero,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildHeader(context, controller, visibleTasks.length),
                if (controller.status == TasksStatus.error)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      RhythmSpacing.md,
                      RhythmSpacing.sm,
                      RhythmSpacing.md,
                      RhythmSpacing.sm,
                    ),
                    child: ErrorBanner(
                      message: controller.errorMessage ?? 'Unknown error',
                      onRetry: controller.load,
                    ),
                  ),
                Expanded(
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final createBarStacks = constraints.maxWidth < 900;
                      return CustomScrollView(
                        slivers: [
                          SliverPersistentHeader(
                            pinned: true,
                            delegate: _StickyBarDelegate(
                              height: createBarStacks ? 220 : 96,
                              child: RhythmTaskCreateBar(
                                addLabel: 'Add task',
                                onSubmit: (
                                  title, {
                                  notes,
                                  dueDate,
                                  collaboratorId,
                                }) {
                                  context.read<TasksController>().createTask(
                                        title,
                                        notes: notes,
                                        dueDate: dueDate,
                                        collaboratorId: collaboratorId,
                                      );
                                },
                              ),
                            ),
                          ),
                          _buildTaskListSliver(controller, visibleTasks),
                        ],
                      );
                    },
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  List<Task> _visibleTasks(TasksController controller) {
    final tasks = _showCompleted
        ? controller.tasks.toList()
        : controller.tasks.where((task) => task.status != 'done').toList();
    final query = _searchQuery.trim().toLowerCase();
    if (query.isNotEmpty) {
      return tasks.where((task) {
        final haystack = [
          task.title,
          task.notes ?? '',
          task.sourceName ?? '',
        ].join(' ').toLowerCase();
        return haystack.contains(query);
      }).toList();
    }
    return tasks;
  }

  Widget _buildHeader(
    BuildContext context,
    TasksController controller,
    int visibleCount,
  ) {
    return RhythmToolbar(
      leading: const RhythmBadge(
        label: 'Tasks',
        icon: Icons.checklist_outlined,
        tone: RhythmBadgeTone.accent,
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: RhythmSpacing.md,
        vertical: 4,
      ),
      search: RhythmSearchField(
        controller: _searchController,
        onChanged: (value) => setState(() => _searchQuery = value),
        hintText: 'Search tasks',
        width: 200,
      ),
      filters: [
        RhythmSegmentedControl<bool>(
          compact: true,
          value: _showCompleted,
          onChanged: (value) => setState(() => _showCompleted = value),
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
        RhythmColorLegend(
          items: const [
            (Color(0xFFDC5B58), 'Past due'),
            (Color(0xFFE29A3A), 'Today'),
            (Color(0xFF4E5FE0), 'Rhythm'),
            (Color(0xFF2E7FC4), 'Project'),
          ],
        ),
      ],
      actions: [
        RhythmBadge(
          label: '$visibleCount tasks',
          icon: Icons.format_list_bulleted,
          compact: true,
        ),
      ],
    );
  }

  Widget _buildTaskListSliver(
    TasksController controller,
    List<Task> visibleTasks,
  ) {
    if (controller.status == TasksStatus.loading && controller.tasks.isEmpty) {
      return const SliverFillRemaining(
        hasScrollBody: false,
        child: RhythmEmptyState(
          title: 'Loading tasks...',
          tone: RhythmEmptyStateTone.loading,
        ),
      );
    }
    if (visibleTasks.isEmpty) {
      final hasSearch = _searchQuery.trim().isNotEmpty;
      return SliverFillRemaining(
        hasScrollBody: false,
        child: _buildEmptyState(
          title: controller.tasks.isEmpty
              ? 'No tasks yet'
              : hasSearch
                  ? 'No matching tasks'
                  : 'Nothing to show',
          message: controller.tasks.isEmpty
              ? 'Create a task above and it will settle into this workspace.'
              : hasSearch
                  ? 'Try a different search, or clear the search field to return to the full queue.'
                  : _showCompleted
                      ? 'No tasks match the current view.'
                      : 'Completed tasks are hidden right now. Turn them back on to review finished work.',
          icon: controller.tasks.isEmpty
              ? Icons.task_alt_outlined
              : Icons.checklist_outlined,
        ),
      );
    }
    final groups = _groupTasksByTime(visibleTasks);
    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(
        RhythmSpacing.md,
        RhythmSpacing.sm,
        RhythmSpacing.md,
        RhythmSpacing.md,
      ),
      sliver: SliverList.separated(
        itemCount: groups.length,
        separatorBuilder: (_, __) => const SizedBox(height: RhythmSpacing.sm),
        itemBuilder: (context, i) => _buildTaskGroup(groups[i], controller),
      ),
    );
  }

  Widget _buildEmptyState({
    required String title,
    required String message,
    required IconData icon,
  }) {
    return Padding(
      padding: const EdgeInsets.all(RhythmSpacing.xl),
      child: RhythmEmptyState(
        title: title,
        message: message,
        icon: icon,
      ),
    );
  }

  List<_TaskGroup> _groupTasksByTime(List<Task> tasks) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final weekStart = today.subtract(Duration(days: today.weekday - 1));
    final weekEnd = weekStart.add(const Duration(days: 6));
    final monthEnd = DateTime(now.year, now.month + 1, 0);

    final pastDue = <Task>[];
    final todayTasks = <Task>[];
    final thisWeek = <Task>[];
    final thisMonth = <Task>[];
    final noDueDate = <Task>[];
    final completed = <Task>[];

    for (final task in tasks) {
      if (task.status == 'done') {
        completed.add(task);
        continue;
      }

      final dateStr = (task.scheduledDate?.isNotEmpty == true
              ? task.scheduledDate
              : task.dueDate?.isNotEmpty == true
                  ? task.dueDate
                  : null)
          ?.trim();

      if (dateStr == null) {
        noDueDate.add(task);
        continue;
      }

      final parsed = DateTime.tryParse(dateStr);
      if (parsed == null) {
        noDueDate.add(task);
        continue;
      }

      final taskDate = DateTime(parsed.year, parsed.month, parsed.day);

      if (taskDate.isBefore(today)) {
        pastDue.add(task);
      } else if (taskDate == today) {
        todayTasks.add(task);
      } else if (!taskDate.isAfter(weekEnd)) {
        thisWeek.add(task);
      } else if (!taskDate.isAfter(monthEnd)) {
        thisMonth.add(task);
      } else {
        noDueDate.add(task);
      }
    }

    return [
      _TaskGroup(
        title: 'Past Due',
        subtitle: 'Needs attention',
        icon: Icons.warning_amber_rounded,
        tone: RhythmBadgeTone.danger,
        tasks: pastDue,
      ),
      _TaskGroup(
        title: 'Today',
        subtitle: 'Due or scheduled today',
        icon: Icons.today_outlined,
        tone: RhythmBadgeTone.warning,
        tasks: todayTasks,
      ),
      _TaskGroup(
        title: 'This Week',
        subtitle: 'Due before the end of this week',
        icon: Icons.calendar_view_week_outlined,
        tone: RhythmBadgeTone.info,
        tasks: thisWeek,
      ),
      _TaskGroup(
        title: 'This Month',
        subtitle: 'Due before the end of this month',
        icon: Icons.calendar_month_outlined,
        tone: RhythmBadgeTone.neutral,
        tasks: thisMonth,
      ),
      _TaskGroup(
        title: 'No Due Date',
        subtitle: 'No scheduled date yet',
        icon: Icons.inbox_outlined,
        tone: RhythmBadgeTone.neutral,
        tasks: noDueDate,
      ),
      _TaskGroup(
        title: 'Completed',
        subtitle: 'Finished work',
        icon: Icons.check_circle_outline,
        tone: RhythmBadgeTone.success,
        tasks: completed,
      ),
    ].where((group) => group.tasks.isNotEmpty).toList();
  }

  Widget _buildTaskGroup(_TaskGroup group, TasksController controller) {
    final colors = context.rhythm;
    return RhythmPanel(
      padding: EdgeInsets.zero,
      header: Row(
        children: [
          RhythmBadge(
            icon: group.icon,
            label: '${group.title} · ${group.tasks.length}',
            tone: group.tone,
            compact: true,
          ),
          const SizedBox(width: RhythmSpacing.sm),
          Expanded(
            child: Text(
              group.subtitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colors.textMuted,
                    letterSpacing: 0,
                  ),
            ),
          ),
        ],
      ),
      child: Column(
        children: [
          for (var i = 0; i < group.tasks.length; i++) ...[
            if (i > 0) Divider(height: 1, color: colors.borderSubtle),
            _buildTaskRow(group.tasks[i], controller),
          ],
        ],
      ),
    );
  }

  Widget _buildTaskRow(Task task, TasksController controller) {
    final colors = context.rhythm;
    final isDone = task.status == 'done';
    final visualStyle = TaskVisualStyles.resolve(task);
    final isPastDue = DateFormatters.isPastDue(
      dueDate: task.dueDate,
      scheduledDate: task.scheduledDate,
      isDone: isDone,
    );
    final dueLabel = _compactDate(task.dueDate);
    final sourceName = task.sourceName?.trim();
    final hasSourceName = sourceName != null && sourceName.isNotEmpty;
    final accentColor = visualStyle.accent;

    return GestureDetector(
      onTap: () => _showEditDialog(task, controller),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: isDone
              ? colors.surfaceMuted.withValues(alpha: 0.45)
              : accentColor.withValues(alpha: 0.09),
          border: Border(
            left: BorderSide(color: accentColor, width: 3),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              SizedBox(
                width: 16,
                height: 16,
                child: Checkbox(
                  value: isDone,
                  onChanged: (_) => controller.toggleDone(task.id),
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  visualDensity:
                      const VisualDensity(horizontal: -4, vertical: -4),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      task.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            fontWeight: FontWeight.w600,
                            fontSize: 13,
                            decoration:
                                isDone ? TextDecoration.lineThrough : null,
                            color:
                                isDone ? colors.textMuted : colors.textPrimary,
                          ),
                    ),
                    if (hasSourceName)
                      Text(
                        sourceName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: colors.textMuted,
                              fontSize: 11,
                            ),
                      ),
                  ],
                ),
              ),
              if (dueLabel != null) ...[
                const SizedBox(width: 6),
                RhythmMetaChip(
                  label: dueLabel,
                  icon: Icons.flag_outlined,
                  tone: isPastDue
                      ? RhythmMetaChipTone.danger
                      : RhythmMetaChipTone.neutral,
                ),
              ],
              RhythmMenuButton<_TaskAction>(
                items: const [
                  RhythmMenuAction(
                    value: _TaskAction.edit,
                    label: 'Inspect',
                    icon: Icons.edit_outlined,
                  ),
                  RhythmMenuAction(
                    value: _TaskAction.delete,
                    label: 'Delete',
                    icon: Icons.delete_outline,
                    destructive: true,
                  ),
                ],
                onSelected: (action) {
                  switch (action) {
                    case _TaskAction.edit:
                      _showEditDialog(task, controller);
                    case _TaskAction.delete:
                      _confirmDelete(task, controller);
                  }
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _confirmDelete(Task task, TasksController controller) async {
    final confirmed = await RhythmDialog.confirm(
      context,
      title: 'Delete task?',
      message: 'Delete "${task.title}"? This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    );
    if (confirmed == true) controller.deleteTask(task.id);
  }

  Future<void> _showEditDialog(Task task, TasksController controller) async {
    final collaboratorsDataSource = CollaboratorsDataSource();
    await showRhythmTaskInspector(
      context,
      task: task,
      workspaceMembers: context.read<WorkspaceController>().members,
      onSaveDetails: (request) => controller.updateTask(
        task.id,
        title: request.title,
        notes: request.notes,
        dueDate: request.dueDate,
        scheduledDate: request.scheduledDate,
        includeNotes: true,
        includeDueDate: true,
        includeScheduledDate: true,
      ),
      onToggleStatus: () => controller.toggleDone(task.id),
      onAddCollaborator: (userId) async {
        final collaborators =
            await collaboratorsDataSource.addToTask(task.id, userId);
        return collaborators;
      },
      onRemoveCollaborator: (userId) async {
        await collaboratorsDataSource.removeFromTask(task.id, userId);
        final collaborators =
            await collaboratorsDataSource.fetchForTask(task.id);
        return collaborators;
      },
    );
  }
}

enum _TaskAction { edit, delete }

class _TaskGroup {
  const _TaskGroup({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.tone,
    required this.tasks,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final RhythmBadgeTone tone;
  final List<Task> tasks;
}

String? _compactDate(String? isoDate) {
  if (isoDate == null || isoDate.trim().isEmpty) return null;
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(isoDate.trim());
  if (match == null) return isoDate;
  final month = int.tryParse(match.group(2)!);
  final day = int.tryParse(match.group(3)!);
  if (month == null || day == null || month < 1 || month > 12) return isoDate;
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
  return '${months[month - 1]} $day';
}

class _StickyBarDelegate extends SliverPersistentHeaderDelegate {
  _StickyBarDelegate({required this.height, required this.child});

  final double height;
  final Widget child;

  @override
  double get minExtent => height;

  @override
  double get maxExtent => height;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    final colors = context.rhythm;
    return SizedBox.expand(
      child: Container(
        color: colors.surface,
        padding: const EdgeInsets.fromLTRB(
          RhythmSpacing.md,
          RhythmSpacing.sm,
          RhythmSpacing.md,
          RhythmSpacing.xs,
        ),
        child: child,
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _StickyBarDelegate oldDelegate) =>
      oldDelegate.height != height || oldDelegate.child != child;
}
