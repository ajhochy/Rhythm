import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
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

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<TasksController>().load();
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
                  child: CustomScrollView(
                    slivers: [
                      SliverPersistentHeader(
                        pinned: true,
                        delegate: _StickyBarDelegate(
                          height: 176,
                          child: _buildCreateBar(context),
                        ),
                      ),
                      _buildTaskListSliver(controller, visibleTasks),
                    ],
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
      return SliverFillRemaining(
        hasScrollBody: false,
        child: _buildEmptyState(
          title: controller.tasks.isEmpty ? 'No tasks yet' : 'Nothing to show',
          message: controller.tasks.isEmpty
              ? 'Create a task above and it will settle into this workspace.'
              : _showCompleted
                  ? 'All tasks are already hidden by the current filter.'
                  : 'Completed tasks are hidden right now. Turn them back on to review finished work.',
          icon: controller.tasks.isEmpty
              ? Icons.task_alt_outlined
              : Icons.checklist_outlined,
        ),
      );
    }
    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(
        RhythmSpacing.md,
        RhythmSpacing.sm,
        RhythmSpacing.md,
        RhythmSpacing.md,
      ),
      sliver: SliverList.separated(
        itemCount: visibleTasks.length,
        separatorBuilder: (_, __) => const SizedBox(height: RhythmSpacing.xs),
        itemBuilder: (context, i) =>
            _buildTaskCard(visibleTasks[i], controller),
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

  Widget _buildTaskCard(Task task, TasksController controller) {
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

    return RhythmPanel(
      padding: const EdgeInsets.all(RhythmSpacing.md),
      backgroundColor: visualStyle.background,
      borderColor: visualStyle.border,
      elevated: !isDone,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
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
                if (_projectTitle(task) case final projectTitle?) ...[
                  Text(
                    projectTitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: Colors.transparent,
                      letterSpacing: 0.2,
                    ).copyWith(color: visualStyle.accent),
                  ),
                  const SizedBox(height: RhythmSpacing.xxs),
                ],
                Text(
                  task.title,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    height: 1.25,
                    decoration: isDone
                        ? TextDecoration.lineThrough
                        : TextDecoration.none,
                    color: visualStyle.text,
                  ),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: RhythmSpacing.xs,
                  runSpacing: RhythmSpacing.xs,
                  children: [
                    if (isPastDue)
                      const RhythmBadge(
                        icon: Icons.warning_amber_rounded,
                        label: 'Past due',
                        tone: RhythmBadgeTone.danger,
                        compact: true,
                      ),
                    if (dueLabel != null)
                      RhythmBadge(
                        icon: Icons.event_outlined,
                        label: dueLabel,
                        tone: isPastDue
                            ? RhythmBadgeTone.warning
                            : RhythmBadgeTone.neutral,
                        compact: true,
                      ),
                    if (task.sourceType != null)
                      RhythmBadge(
                        icon: _sourceIcon(task.sourceType!),
                        label: _sourceLabel(task),
                        tone: RhythmBadgeTone.accent,
                        compact: true,
                      ),
                    if (isDone)
                      const RhythmBadge(
                        icon: Icons.check_circle_outline,
                        label: 'Completed',
                        tone: RhythmBadgeTone.success,
                        compact: true,
                      ),
                  ],
                ),
                if (hasNotes) ...[
                  const SizedBox(height: 10),
                  Text(
                    task.notes!.trim(),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.transparent,
                      fontSize: 13,
                      height: 1.45,
                    ).copyWith(color: visualStyle.mutedText),
                  ),
                ],
                if (task.ownerId != null) ...[
                  const SizedBox(height: RhythmSpacing.xs),
                  CollaboratorsRow(
                    collaborators: task.collaborators,
                    ownerId: task.ownerId!,
                    workspaceMembers:
                        context.read<WorkspaceController>().members,
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
              ],
            ),
          ),
          const SizedBox(width: RhythmSpacing.xs),
          RhythmMenuButton<_TaskAction>(
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
          ),
        ],
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

  Widget _buildCreateBar(BuildContext context) {
    return RhythmPanel(
      padding: const EdgeInsets.all(RhythmSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _titleController,
            decoration: _fieldDecoration(
              context,
              hintText: 'New task title',
              icon: Icons.edit_note_outlined,
            ),
            textInputAction: TextInputAction.next,
            onSubmitted: (_) => _submitCreate(),
          ),
          const SizedBox(height: RhythmSpacing.xs),
          TextField(
            controller: _notesController,
            decoration: _fieldDecoration(
              context,
              hintText: 'Add a note, context, or next step',
              icon: Icons.subject_outlined,
            ),
            minLines: 1,
            maxLines: 1,
          ),
          const SizedBox(height: RhythmSpacing.xs),
          Wrap(
            spacing: RhythmSpacing.xs,
            runSpacing: RhythmSpacing.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              RhythmButton.outlined(
                onPressed: _pickDate,
                icon: Icons.calendar_today,
                compact: true,
                label: _selectedDueDate == null
                    ? 'Due date'
                    : DateFormatters.fullDate(_selectedDueDate),
              ),
              RhythmButton.filled(
                onPressed: _submitCreate,
                icon: Icons.add,
                label: 'Add task',
                compact: true,
              ),
            ],
          ),
        ],
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
