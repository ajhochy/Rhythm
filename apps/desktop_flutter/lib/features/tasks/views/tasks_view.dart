import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/formatters/date_formatters.dart';
import '../../../app/core/tasks/task_visual_style.dart';
import '../../../app/core/ui/rhythm_ui.dart';
import '../../../app/core/widgets/error_banner.dart';
import '../../../app/core/workspace/workspace_controller.dart';
import '../../../shared/widgets/collaborators_row.dart';
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
  final _titleController = TextEditingController();
  final _notesController = TextEditingController();
  String? _selectedDueDate;
  bool _showCompleted = false;
  bool _sortByDueDate = false;
  String _searchQuery = '';
  _TaskGroupingMode _groupingMode = _TaskGroupingMode.queue;

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
    _titleController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2030),
    );
    if (picked != null) {
      setState(
        () => _selectedDueDate = picked.toIso8601String().substring(0, 10),
      );
    }
  }

  Future<void> _submitCreate() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;
    final notes = _notesController.text.trim();
    await context.read<TasksController>().createTask(
          title,
          notes: notes.isEmpty ? null : notes,
          dueDate: _selectedDueDate,
        );
    _titleController.clear();
    _notesController.clear();
    setState(() => _selectedDueDate = null);
  }

  @override
  Widget build(BuildContext context) {
    return RhythmSurface.page(
      padding: const EdgeInsets.all(RhythmSpacing.sm),
      child: Consumer<TasksController>(
        builder: (context, controller, _) {
          final currentUserId =
              context.watch<AuthSessionService>().currentUser?.id;
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
                      final createBarStacks = constraints.maxWidth < 1400;
                      return CustomScrollView(
                        slivers: [
                          SliverPersistentHeader(
                            pinned: true,
                            delegate: _StickyBarDelegate(
                              height: createBarStacks ? 176 : 82,
                              child: _buildCreateBar(
                                context,
                                stacked: createBarStacks,
                              ),
                            ),
                          ),
                          _buildTaskListSliver(
                            controller,
                            visibleTasks,
                            currentUserId,
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
      ),
    );
  }

  List<Task> _visibleTasks(TasksController controller) {
    final tasks = _showCompleted
        ? controller.tasks.toList()
        : controller.tasks.where((task) => task.status != 'done').toList();
    if (_sortByDueDate) {
      tasks.sort((a, b) {
        if (a.dueDate == null && b.dueDate == null) return 0;
        if (a.dueDate == null) return 1;
        if (b.dueDate == null) return -1;
        return a.dueDate!.compareTo(b.dueDate!);
      });
    }
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
    return Column(
      children: [
        RhythmToolbar(
          title: 'Tasks',
          subtitle: 'Triage the work queued for this workspace.',
          leading: const RhythmBadge(
            label: 'Workspace',
            icon: Icons.checklist_outlined,
            tone: RhythmBadgeTone.accent,
          ),
          padding: const EdgeInsets.fromLTRB(
            RhythmSpacing.md,
            RhythmSpacing.sm,
            RhythmSpacing.md,
            RhythmSpacing.sm,
          ),
          actions: [
            RhythmBadge(
              label: '$visibleCount visible',
              icon: Icons.visibility_outlined,
              compact: true,
            ),
            RhythmBadge(
              label: '${controller.tasks.length} total',
              icon: Icons.format_list_bulleted,
              compact: true,
            ),
          ],
        ),
        RhythmFilterBar<bool>(
          searchController: _searchController,
          onSearchChanged: (value) => setState(() => _searchQuery = value),
          searchHint: 'Search tasks',
          segmentValue: _showCompleted,
          onSegmentChanged: (value) => setState(() => _showCompleted = value),
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
          filters: [
            RhythmSegmentedControl<_TaskGroupingMode>(
              segments: const [
                RhythmSegment(
                  value: _TaskGroupingMode.queue,
                  label: 'Queue',
                  icon: Icons.view_agenda_outlined,
                ),
                RhythmSegment(
                  value: _TaskGroupingMode.project,
                  label: 'Project',
                  icon: Icons.folder_open_outlined,
                ),
                RhythmSegment(
                  value: _TaskGroupingMode.rhythm,
                  label: 'Rhythm',
                  icon: Icons.repeat,
                ),
                RhythmSegment(
                  value: _TaskGroupingMode.handoff,
                  label: 'Handoff',
                  icon: Icons.handshake_outlined,
                ),
              ],
              value: _groupingMode,
              onChanged: (value) => setState(() => _groupingMode = value),
              compact: true,
            ),
            RhythmButton.quiet(
              onPressed: () => setState(() => _sortByDueDate = !_sortByDueDate),
              label: _sortByDueDate ? 'Due date first' : 'Manual order',
              icon: Icons.calendar_today_outlined,
              compact: true,
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildTaskListSliver(
    TasksController controller,
    List<Task> visibleTasks,
    int? currentUserId,
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
    final groups = _groupTasks(visibleTasks, currentUserId: currentUserId);
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

  List<_TaskGroup> _groupTasks(List<Task> tasks, {int? currentUserId}) {
    return switch (_groupingMode) {
      _TaskGroupingMode.queue => _groupTasksByQueue(tasks),
      _TaskGroupingMode.project => _groupTasksBySource(
          tasks,
          sourceType: 'project_step',
          fallbackTitle: 'Project',
          otherTitle: 'Other tasks',
          otherSubtitle: 'Tasks not tied to a project',
          icon: Icons.folder_open_outlined,
          tone: RhythmBadgeTone.accent,
        ),
      _TaskGroupingMode.rhythm => _groupTasksBySource(
          tasks,
          sourceType: 'recurring_rule',
          fallbackTitle: 'Rhythm',
          otherTitle: 'Other tasks',
          otherSubtitle: 'Tasks not tied to a rhythm',
          icon: Icons.repeat,
          tone: RhythmBadgeTone.info,
        ),
      _TaskGroupingMode.handoff => _groupTasksByHandoff(
          tasks,
          currentUserId: currentUserId,
        ),
    };
  }

  List<_TaskGroup> _groupTasksByQueue(List<Task> tasks) {
    final buckets = <_TaskGroupKind, List<Task>>{
      for (final kind in _TaskGroupKind.values) kind: <Task>[],
    };

    for (final task in tasks) {
      buckets[_groupKindForTask(task)]!.add(task);
    }

    return [
      _TaskGroup(
        title: 'Past due',
        subtitle: 'Needs attention',
        icon: Icons.warning_amber_rounded,
        tone: RhythmBadgeTone.danger,
        tasks: buckets[_TaskGroupKind.pastDue]!,
      ),
      _TaskGroup(
        title: 'Today',
        subtitle: 'Due or scheduled today',
        icon: Icons.today_outlined,
        tone: RhythmBadgeTone.warning,
        tasks: buckets[_TaskGroupKind.today]!,
      ),
      _TaskGroup(
        title: 'Scheduled',
        subtitle: 'Placed on the work plan',
        icon: Icons.event_available_outlined,
        tone: RhythmBadgeTone.info,
        tasks: buckets[_TaskGroupKind.scheduled]!,
      ),
      _TaskGroup(
        title: 'Upcoming',
        subtitle: 'Due later',
        icon: Icons.calendar_month_outlined,
        tone: RhythmBadgeTone.neutral,
        tasks: buckets[_TaskGroupKind.upcoming]!,
      ),
      _TaskGroup(
        title: 'Backlog',
        subtitle: 'No date yet',
        icon: Icons.inbox_outlined,
        tone: RhythmBadgeTone.neutral,
        tasks: buckets[_TaskGroupKind.backlog]!,
      ),
      _TaskGroup(
        title: 'Completed',
        subtitle: 'Finished work',
        icon: Icons.check_circle_outline,
        tone: RhythmBadgeTone.success,
        tasks: buckets[_TaskGroupKind.completed]!,
      ),
    ].where((group) => group.tasks.isNotEmpty).toList();
  }

  List<_TaskGroup> _groupTasksBySource(
    List<Task> tasks, {
    required String sourceType,
    required String fallbackTitle,
    required String otherTitle,
    required String otherSubtitle,
    required IconData icon,
    required RhythmBadgeTone tone,
  }) {
    final groupsByName = <String, List<Task>>{};
    final other = <Task>[];

    for (final task in tasks) {
      if (task.sourceType == sourceType) {
        final title = _sourceGroupTitle(task, fallbackTitle);
        groupsByName.putIfAbsent(title, () => <Task>[]).add(task);
      } else {
        other.add(task);
      }
    }

    final groups = groupsByName.entries
        .map(
          (entry) => _TaskGroup(
            title: entry.key,
            subtitle: _sourceGroupSubtitle(entry.value),
            icon: icon,
            tone: tone,
            tasks: entry.value,
          ),
        )
        .toList()
      ..sort(
        (a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()),
      );

    if (other.isNotEmpty) {
      groups.add(
        _TaskGroup(
          title: otherTitle,
          subtitle: otherSubtitle,
          icon: Icons.inbox_outlined,
          tone: RhythmBadgeTone.neutral,
          tasks: other,
        ),
      );
    }

    return groups;
  }

  List<_TaskGroup> _groupTasksByHandoff(
    List<Task> tasks, {
    required int? currentUserId,
  }) {
    final waitingOnMe = <Task>[];
    final sharedWithMe = <Task>[];
    final teamShared = <Task>[];
    final solo = <Task>[];
    final completed = <Task>[];

    for (final task in tasks) {
      if (task.status == 'done') {
        completed.add(task);
        continue;
      }

      final collaboratorIds = task.collaborators.map((c) => c.userId).toSet();
      final hasSharedContext = task.isShared || collaboratorIds.isNotEmpty;
      final ownedByMe = currentUserId != null && task.ownerId == currentUserId;
      final includesMe =
          currentUserId != null && collaboratorIds.contains(currentUserId);

      if (ownedByMe && hasSharedContext) {
        waitingOnMe.add(task);
      } else if (includesMe) {
        sharedWithMe.add(task);
      } else if (hasSharedContext) {
        teamShared.add(task);
      } else {
        solo.add(task);
      }
    }

    return [
      _TaskGroup(
        title: 'Waiting on me',
        subtitle: currentUserId == null
            ? 'Shared tasks cannot be matched to you yet'
            : 'Shared work owned by you',
        icon: Icons.priority_high_rounded,
        tone: RhythmBadgeTone.warning,
        tasks: waitingOnMe,
      ),
      _TaskGroup(
        title: 'Shared with me',
        subtitle: 'Owned by someone else',
        icon: Icons.group_outlined,
        tone: RhythmBadgeTone.accent,
        tasks: sharedWithMe,
      ),
      _TaskGroup(
        title: 'Team shared',
        subtitle: 'Shared ownership context',
        icon: Icons.groups_2_outlined,
        tone: RhythmBadgeTone.info,
        tasks: teamShared,
      ),
      _TaskGroup(
        title: 'Solo tasks',
        subtitle: 'No collaborator handoff data',
        icon: Icons.person_outline,
        tone: RhythmBadgeTone.neutral,
        tasks: solo,
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

  _TaskGroupKind _groupKindForTask(Task task) {
    if (task.status == 'done') return _TaskGroupKind.completed;
    if (DateFormatters.isPastDue(
      dueDate: task.dueDate,
      scheduledDate: task.scheduledDate,
      isDone: false,
    )) {
      return _TaskGroupKind.pastDue;
    }
    if (DateFormatters.isDueToday(
      dueDate: task.dueDate,
      scheduledDate: task.scheduledDate,
      isDone: false,
    )) {
      return _TaskGroupKind.today;
    }
    if (task.scheduledDate != null && task.scheduledDate!.trim().isNotEmpty) {
      return _TaskGroupKind.scheduled;
    }
    if (task.dueDate != null && task.dueDate!.trim().isNotEmpty) {
      return _TaskGroupKind.upcoming;
    }
    return _TaskGroupKind.backlog;
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
    final isDone = task.status == 'done';
    final hasNotes = task.notes != null && task.notes!.trim().isNotEmpty;
    final visualStyle = TaskVisualStyles.resolve(task);
    final isPastDue = DateFormatters.isPastDue(
      dueDate: task.dueDate,
      scheduledDate: task.scheduledDate,
      isDone: isDone,
    );
    final dueLabel = task.dueDate == null
        ? null
        : DateFormatters.fullDate(task.dueDate, fallback: task.dueDate!);
    final scheduledLabel = task.scheduledDate == null
        ? null
        : DateFormatters.fullDate(
            task.scheduledDate,
            fallback: task.scheduledDate!,
          );

    return Container(
      constraints: const BoxConstraints(minHeight: 58),
      decoration: BoxDecoration(
        color: visualStyle.background.withValues(alpha: isDone ? 0.42 : 0.72),
        border: Border(left: BorderSide(color: visualStyle.accent, width: 3)),
      ),
      padding: const EdgeInsets.fromLTRB(
        RhythmSpacing.sm,
        RhythmSpacing.xs,
        RhythmSpacing.xs,
        RhythmSpacing.xs,
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final compact = constraints.maxWidth < 820;
          final titleColumn = _TaskTitleColumn(
            task: task,
            hasNotes: hasNotes,
            isDone: isDone,
            accent: visualStyle.accent,
            text: visualStyle.text,
            mutedText: visualStyle.mutedText,
          );
          final status = isDone
              ? const RhythmBadge(
                  icon: Icons.check_circle_outline,
                  label: 'Done',
                  tone: RhythmBadgeTone.success,
                  compact: true,
                )
              : isPastDue
                  ? const RhythmBadge(
                      icon: Icons.warning_amber_rounded,
                      label: 'Past due',
                      tone: RhythmBadgeTone.danger,
                      compact: true,
                    )
                  : const RhythmBadge(
                      icon: Icons.radio_button_unchecked,
                      label: 'Open',
                      compact: true,
                    );
          final date = Wrap(
            spacing: RhythmSpacing.xs,
            runSpacing: RhythmSpacing.xxs,
            children: [
              if (scheduledLabel != null)
                RhythmBadge(
                  icon: Icons.event_available_outlined,
                  label: scheduledLabel,
                  tone: RhythmBadgeTone.info,
                  compact: true,
                ),
              if (dueLabel != null)
                RhythmBadge(
                  icon: Icons.flag_outlined,
                  label: dueLabel,
                  tone: isPastDue
                      ? RhythmBadgeTone.warning
                      : RhythmBadgeTone.neutral,
                  compact: true,
                ),
              if (scheduledLabel == null && dueLabel == null)
                const RhythmBadge(
                  icon: Icons.inbox_outlined,
                  label: 'No date',
                  compact: true,
                ),
            ],
          );
          final contextBadges = _TaskContextBadges(
            task: task,
            controller: controller,
          );
          final menu = RhythmMenuButton<_TaskAction>(
            items: const [
              RhythmMenuAction(
                value: _TaskAction.edit,
                label: 'Edit',
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
          );

          if (compact) {
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 32,
                  child: Checkbox(
                    value: isDone,
                    onChanged: (_) => controller.toggleDone(task.id),
                  ),
                ),
                const SizedBox(width: RhythmSpacing.xs),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      titleColumn,
                      const SizedBox(height: RhythmSpacing.xs),
                      Wrap(
                        spacing: RhythmSpacing.xs,
                        runSpacing: RhythmSpacing.xs,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [status, date, contextBadges],
                      ),
                    ],
                  ),
                ),
                menu,
              ],
            );
          }

          return Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              SizedBox(
                width: 32,
                child: Checkbox(
                  value: isDone,
                  onChanged: (_) => controller.toggleDone(task.id),
                ),
              ),
              const SizedBox(width: RhythmSpacing.xs),
              Expanded(flex: 5, child: titleColumn),
              const SizedBox(width: RhythmSpacing.sm),
              SizedBox(width: 104, child: status),
              const SizedBox(width: RhythmSpacing.sm),
              SizedBox(width: 146, child: date),
              const SizedBox(width: RhythmSpacing.sm),
              SizedBox(width: 196, child: contextBadges),
              const SizedBox(width: RhythmSpacing.xs),
              menu,
            ],
          );
        },
      ),
    );
  }

  Future<void> _confirmDelete(Task task, TasksController controller) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete task?'),
        content: Text('Delete "${task.title}"?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed == true) controller.deleteTask(task.id);
  }

  Future<void> _showEditDialog(Task task, TasksController controller) async {
    await showDialog<void>(
      context: context,
      builder: (_) => _EditTaskDialog(task: task, controller: controller),
    );
  }

  Widget _buildCreateBar(BuildContext context, {required bool stacked}) {
    return RhythmPanel(
      padding: const EdgeInsets.all(RhythmSpacing.sm),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final titleField = TextField(
            controller: _titleController,
            decoration: _fieldDecoration(
              context,
              hintText: 'New task title',
              icon: Icons.edit_note_outlined,
            ),
            textInputAction: TextInputAction.next,
            onSubmitted: (_) => _submitCreate(),
          );
          final notesField = TextField(
            controller: _notesController,
            decoration: _fieldDecoration(
              context,
              hintText: 'Add a note, context, or next step',
              icon: Icons.subject_outlined,
            ),
            minLines: 1,
            maxLines: 1,
          );
          final dateButton = RhythmButton.outlined(
            onPressed: _pickDate,
            icon: Icons.calendar_today,
            compact: true,
            label: _selectedDueDate == null
                ? 'Due date'
                : DateFormatters.fullDate(_selectedDueDate),
          );
          final addButton = RhythmButton.filled(
            onPressed: _submitCreate,
            icon: Icons.add,
            label: 'Add task',
            compact: true,
          );

          if (!stacked && constraints.maxWidth >= 900) {
            return Row(
              children: [
                Expanded(flex: 3, child: titleField),
                const SizedBox(width: RhythmSpacing.xs),
                Expanded(flex: 4, child: notesField),
                const SizedBox(width: RhythmSpacing.xs),
                dateButton,
                const SizedBox(width: RhythmSpacing.xs),
                addButton,
              ],
            );
          }

          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              titleField,
              const SizedBox(height: RhythmSpacing.xs),
              notesField,
              const SizedBox(height: RhythmSpacing.xs),
              Wrap(
                spacing: RhythmSpacing.xs,
                runSpacing: RhythmSpacing.xs,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [dateButton, addButton],
              ),
            ],
          );
        },
      ),
    );
  }

  InputDecoration _fieldDecoration(
    BuildContext context, {
    required String hintText,
    required IconData icon,
  }) {
    final colors = context.rhythm;
    return InputDecoration(
      hintText: hintText,
      hintStyle: TextStyle(color: colors.textMuted),
      prefixIcon: Icon(icon, size: 18, color: colors.textMuted),
      isDense: true,
      filled: true,
      fillColor: colors.surfaceMuted,
      contentPadding: const EdgeInsets.symmetric(
        horizontal: RhythmSpacing.md,
        vertical: 10,
      ),
      border: _fieldBorder(colors.borderSubtle),
      enabledBorder: _fieldBorder(colors.borderSubtle),
      focusedBorder: _fieldBorder(colors.focusRing, width: 1.5),
    );
  }

  OutlineInputBorder _fieldBorder(Color color, {double width = 1}) {
    return OutlineInputBorder(
      borderRadius: BorderRadius.circular(RhythmRadius.md),
      borderSide: BorderSide(color: color, width: width),
    );
  }
}

enum _TaskAction { edit, delete }

enum _TaskGroupingMode { queue, project, rhythm, handoff }

enum _TaskGroupKind { pastDue, today, scheduled, upcoming, backlog, completed }

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

class _TaskTitleColumn extends StatelessWidget {
  const _TaskTitleColumn({
    required this.task,
    required this.hasNotes,
    required this.isDone,
    required this.accent,
    required this.text,
    required this.mutedText,
  });

  final Task task;
  final bool hasNotes;
  final bool isDone;
  final Color accent;
  final Color text;
  final Color mutedText;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (_projectTitle(task) case final projectTitle?) ...[
          Text(
            projectTitle,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: accent,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0,
                ),
          ),
          const SizedBox(height: 2),
        ],
        Text(
          task.title,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w700,
                height: 1.2,
                letterSpacing: 0,
                decoration:
                    isDone ? TextDecoration.lineThrough : TextDecoration.none,
                color: text,
              ),
        ),
        if (hasNotes) ...[
          const SizedBox(height: 3),
          Text(
            task.notes!.trim(),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: mutedText,
                  height: 1.25,
                  letterSpacing: 0,
                ),
          ),
        ],
      ],
    );
  }
}

class _TaskContextBadges extends StatelessWidget {
  const _TaskContextBadges({required this.task, required this.controller});

  final Task task;
  final TasksController controller;

  @override
  Widget build(BuildContext context) {
    final ownerId = task.ownerId;
    final members = context.read<WorkspaceController>().members;
    String? ownerName;
    if (ownerId != null) {
      for (final member in members) {
        if (member.userId == ownerId) {
          ownerName = member.name;
          break;
        }
      }
      ownerName ??= 'Owner #$ownerId';
    }

    return Wrap(
      spacing: RhythmSpacing.xs,
      runSpacing: RhythmSpacing.xxs,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (task.sourceType != null)
          RhythmBadge(
            icon: _sourceIcon(task.sourceType!),
            label: _sourceLabel(task),
            tone: RhythmBadgeTone.accent,
            compact: true,
          ),
        if (ownerName != null)
          RhythmBadge(
            icon: Icons.person_outline,
            label: ownerName,
            compact: true,
          ),
        if (ownerId != null)
          CollaboratorsRow(
            collaborators: task.collaborators,
            ownerId: ownerId,
            workspaceMembers: members,
            onAdd: (userId) async {
              final ds = CollaboratorsDataSource();
              await ds.addToTask(task.id, userId);
              await controller.load();
            },
            onRemove: (userId) async {
              final ds = CollaboratorsDataSource();
              await ds.removeFromTask(task.id, userId);
              await controller.load();
            },
          ),
      ],
    );
  }
}

String _sourceLabel(Task task) {
  if (task.sourceName != null && task.sourceName!.trim().isNotEmpty) {
    return task.sourceName!.trim();
  }
  return switch (task.sourceType) {
    'automation_rule' => 'Automation',
    'planning_center_signal' => 'Planning Center',
    'calendar_shadow_event' => 'Google Calendar',
    'project_step' => 'Project',
    'recurring_rule' => 'Rhythm',
    _ => 'External',
  };
}

String _sourceGroupTitle(Task task, String fallbackTitle) {
  final sourceName = task.sourceName?.trim();
  if (sourceName != null && sourceName.isNotEmpty) return sourceName;

  final sourceId = task.sourceId?.trim();
  if (sourceId != null && sourceId.isNotEmpty) {
    return '$fallbackTitle $sourceId';
  }

  return '$fallbackTitle source';
}

String _sourceGroupSubtitle(List<Task> tasks) {
  final openCount = tasks.where((task) => task.status != 'done').length;
  if (openCount == tasks.length) return '$openCount open';
  final completed = tasks.length - openCount;
  return '$openCount open · $completed complete';
}

IconData _sourceIcon(String sourceType) => switch (sourceType) {
      'automation_rule' => Icons.auto_awesome,
      'planning_center_signal' => Icons.groups_2_outlined,
      'calendar_shadow_event' => Icons.event_available_outlined,
      'project_step' => Icons.folder_open_outlined,
      'recurring_rule' => Icons.repeat,
      _ => Icons.link,
    };

String? _projectTitle(Task task) {
  final sourceName = task.sourceName?.trim();
  if (task.sourceType != 'project_step' ||
      sourceName == null ||
      sourceName.isEmpty) {
    return null;
  }
  return sourceName;
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
    return Container(
      color: colors.surface,
      padding: const EdgeInsets.fromLTRB(
        RhythmSpacing.md,
        RhythmSpacing.sm,
        RhythmSpacing.md,
        RhythmSpacing.xs,
      ),
      child: child,
    );
  }

  @override
  bool shouldRebuild(covariant _StickyBarDelegate oldDelegate) =>
      oldDelegate.height != height || oldDelegate.child != child;
}

class _EditTaskDialog extends StatefulWidget {
  const _EditTaskDialog({required this.task, required this.controller});
  final Task task;
  final TasksController controller;

  @override
  State<_EditTaskDialog> createState() => _EditTaskDialogState();
}

class _EditTaskDialogState extends State<_EditTaskDialog> {
  late final TextEditingController _titleController;
  late final TextEditingController _notesController;
  String? _dueDate;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.task.title);
    _notesController = TextEditingController(text: widget.task.notes ?? '');
    _dueDate = widget.task.dueDate;
  }

  @override
  void dispose() {
    _titleController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final initial = _dueDate != null
        ? DateTime.tryParse(_dueDate!) ?? DateTime.now()
        : DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2020),
      lastDate: DateTime(2030),
    );
    if (picked != null) {
      setState(() => _dueDate = picked.toIso8601String().substring(0, 10));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit Task'),
      content: SizedBox(
        width: 400,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _titleController,
              decoration: const InputDecoration(
                labelText: 'Title',
                border: OutlineInputBorder(),
              ),
              autofocus: true,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _notesController,
              decoration: const InputDecoration(
                labelText: 'Notes (optional)',
                border: OutlineInputBorder(),
              ),
              minLines: 2,
              maxLines: 5,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                OutlinedButton.icon(
                  onPressed: _pickDate,
                  icon: const Icon(Icons.calendar_today, size: 16),
                  label: Text(
                    _dueDate == null
                        ? 'Set due date'
                        : DateFormatters.fullDate(_dueDate),
                  ),
                ),
                if (_dueDate != null) ...[
                  const SizedBox(width: 8),
                  TextButton(
                    onPressed: () => setState(() => _dueDate = null),
                    child: const Text('Clear'),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Save'),
        ),
      ],
    );
  }

  Future<void> _save() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;
    setState(() => _saving = true);
    final notes = _notesController.text.trim();
    await widget.controller.updateTask(
      widget.task.id,
      title: title,
      notes: notes.isEmpty ? null : notes,
      dueDate: _dueDate,
    );
    if (mounted) Navigator.pop(context);
  }
}
