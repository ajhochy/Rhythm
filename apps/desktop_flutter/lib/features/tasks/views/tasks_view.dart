import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../app/core/formatters/date_formatters.dart';
import '../../../app/core/tasks/task_visual_style.dart';
import '../../../app/core/widgets/error_banner.dart';
import '../../../app/core/workspace/workspace_controller.dart';
import '../../../app/theme/rhythm_tokens.dart';
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
          () => _selectedDueDate = picked.toIso8601String().substring(0, 10));
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
    return Container(
      color: RhythmTokens.background,
      child: Consumer<TasksController>(
        builder: (context, controller, _) {
          final visibleTasks = _visibleTasks(controller);
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildHeader(context, controller, visibleTasks.length),
              if (controller.status == TasksStatus.error)
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 0, 24, 12),
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
                        height: 180,
                        child: _buildCreateBar(context),
                      ),
                    ),
                    _buildTaskListSliver(controller, visibleTasks),
                  ],
                ),
              ),
            ],
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
      BuildContext context, TasksController controller, int visibleCount) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 10, 24, 6),
      child: Container(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
        decoration: BoxDecoration(
          color: RhythmTokens.surfaceStrong,
          borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
          border: Border.all(color: RhythmTokens.borderSoft),
          boxShadow: RhythmTokens.shadow,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: Wrap(
                    spacing: 10,
                    runSpacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        'Tasks',
                        style:
                            Theme.of(context).textTheme.titleMedium?.copyWith(
                                  color: RhythmTokens.textPrimary,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: -0.3,
                                ),
                      ),
                      _CompactFilterChip(
                        label: 'Completed',
                        selected: _showCompleted,
                        icon: _showCompleted
                            ? Icons.visibility_off
                            : Icons.visibility,
                        onSelected: (_) =>
                            setState(() => _showCompleted = !_showCompleted),
                      ),
                      _CompactFilterChip(
                        label: 'Due date',
                        selected: _sortByDueDate,
                        icon: Icons.calendar_today,
                        onSelected: (_) =>
                            setState(() => _sortByDueDate = !_sortByDueDate),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                SizedBox(
                  width: 220,
                  child: TextField(
                    controller: _searchController,
                    onChanged: (value) => setState(() => _searchQuery = value),
                    decoration: InputDecoration(
                      hintText: 'Search',
                      prefixIcon: const Icon(Icons.search, size: 16),
                      isDense: true,
                      filled: true,
                      fillColor: RhythmTokens.surfaceMuted,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                      border: OutlineInputBorder(
                        borderRadius:
                            BorderRadius.circular(RhythmTokens.radiusM),
                        borderSide:
                            const BorderSide(color: RhythmTokens.borderSoft),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius:
                            BorderRadius.circular(RhythmTokens.radiusM),
                        borderSide:
                            const BorderSide(color: RhythmTokens.borderSoft),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius:
                            BorderRadius.circular(RhythmTokens.radiusM),
                        borderSide: const BorderSide(
                          color: RhythmTokens.accent,
                          width: 1.2,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                _StatPill(label: 'Visible', value: '$visibleCount'),
                const SizedBox(width: 8),
                _StatPill(label: 'Total', value: '${controller.tasks.length}'),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTaskListSliver(
      TasksController controller, List<Task> visibleTasks) {
    if (controller.status == TasksStatus.loading && controller.tasks.isEmpty) {
      return const SliverFillRemaining(
        hasScrollBody: false,
        child: Center(
          child: SizedBox(
            width: 28,
            height: 28,
            child: CircularProgressIndicator(strokeWidth: 2.5),
          ),
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
      padding: const EdgeInsets.fromLTRB(24, 8, 24, 16),
      sliver: SliverList.separated(
        itemCount: visibleTasks.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
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
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: RhythmTokens.surfaceStrong,
              borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
              border: Border.all(color: RhythmTokens.borderSoft),
              boxShadow: RhythmTokens.shadow,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: RhythmTokens.accentSoft,
                    borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
                  ),
                  child: Icon(icon, color: RhythmTokens.accent),
                ),
                const SizedBox(height: 16),
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: RhythmTokens.textPrimary,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 13,
                    height: 1.45,
                    color: RhythmTokens.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ),
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

    return Material(
      color: Colors.transparent,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: visualStyle.background,
          borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
          border: Border.all(color: visualStyle.border),
          boxShadow: isDone ? const [] : RhythmTokens.shadow,
        ),
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
            const SizedBox(width: 8),
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
                    const SizedBox(height: 4),
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
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      if (isPastDue)
                        const _TaskMetaPill(
                          icon: Icons.warning_amber_rounded,
                          label: 'Past due',
                          color: RhythmTokens.danger,
                        ),
                      if (dueLabel != null)
                        _TaskMetaPill(
                          icon: Icons.event_outlined,
                          label: dueLabel,
                        ),
                      if (task.sourceType != null)
                        _TaskMetaPill(
                          icon: _sourceIcon(task.sourceType!),
                          label: _sourceLabel(task),
                          color: visualStyle.accent,
                          backgroundColor: visualStyle.badgeBackground,
                        ),
                      if (isDone)
                        const _TaskMetaPill(
                          icon: Icons.check_circle_outline,
                          label: 'Completed',
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
                  if (task.isShared) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: const Color(0x144F6AF5),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: const Text('shared',
                          style: TextStyle(
                              fontSize: 11, color: Color(0xFF4F6AF5))),
                    ),
                  ],
                  if (task.ownerId != null) ...[
                    const SizedBox(height: 8),
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
            const SizedBox(width: 8),
            Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  icon: const Icon(Icons.edit_outlined, size: 18),
                  color: RhythmTokens.textSecondary,
                  tooltip: 'Edit',
                  onPressed: () => _showEditDialog(task, controller),
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline, size: 18),
                  color: RhythmTokens.textSecondary,
                  tooltip: 'Delete',
                  onPressed: () => _confirmDelete(task, controller),
                ),
              ],
            ),
          ],
        ),
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
                backgroundColor: Theme.of(context).colorScheme.error),
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
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      decoration: BoxDecoration(
        color: RhythmTokens.surfaceStrong,
        borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
        border: Border.all(color: RhythmTokens.borderSoft),
        boxShadow: RhythmTokens.shadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _titleController,
            decoration: _fieldDecoration(
              hintText: 'New task title',
              icon: Icons.edit_note_outlined,
            ),
            textInputAction: TextInputAction.next,
            onSubmitted: (_) => _submitCreate(),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _notesController,
            decoration: _fieldDecoration(
              hintText: 'Add a note, context, or next step',
              icon: Icons.subject_outlined,
            ),
            minLines: 1,
            maxLines: 1,
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 10,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              OutlinedButton.icon(
                onPressed: _pickDate,
                style: OutlinedButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  minimumSize: Size.zero,
                ),
                icon: const Icon(Icons.calendar_today, size: 16),
                label: Text(_selectedDueDate == null
                    ? 'Due date'
                    : DateFormatters.fullDate(_selectedDueDate)),
              ),
              FilledButton.icon(
                onPressed: _submitCreate,
                style: FilledButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  minimumSize: Size.zero,
                ),
                icon: const Icon(Icons.add, size: 16),
                label: const Text('Add task'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  InputDecoration _fieldDecoration({
    required String hintText,
    required IconData icon,
  }) {
    return InputDecoration(
      hintText: hintText,
      prefixIcon: Icon(icon, size: 18),
      isDense: true,
      filled: true,
      fillColor: RhythmTokens.surfaceMuted,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
        borderSide: const BorderSide(color: RhythmTokens.borderSoft),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
        borderSide: const BorderSide(color: RhythmTokens.borderSoft),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
        borderSide: const BorderSide(color: RhythmTokens.accent, width: 1.5),
      ),
    );
  }
}

class _StatPill extends StatelessWidget {
  const _StatPill({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: RhythmTokens.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
        border: Border.all(color: RhythmTokens.borderSoft),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: RhythmTokens.textSecondary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: RhythmTokens.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

class _CompactFilterChip extends StatelessWidget {
  const _CompactFilterChip({
    required this.label,
    required this.selected,
    required this.icon,
    required this.onSelected,
  });

  final String label;
  final bool selected;
  final IconData icon;
  final ValueChanged<bool> onSelected;

  @override
  Widget build(BuildContext context) {
    return FilterChip(
      label: Text(label),
      selected: selected,
      showCheckmark: false,
      avatar: Icon(
        icon,
        size: 14,
        color: selected ? RhythmTokens.accent : RhythmTokens.textSecondary,
      ),
      onSelected: onSelected,
      visualDensity: VisualDensity.compact,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      backgroundColor: RhythmTokens.surfaceMuted,
      selectedColor: RhythmTokens.accentSoft,
      side: BorderSide(
        color: selected
            ? RhythmTokens.accent.withValues(alpha: 0.35)
            : RhythmTokens.borderSoft,
      ),
      labelStyle: TextStyle(
        color: selected ? RhythmTokens.textPrimary : RhythmTokens.textSecondary,
        fontWeight: FontWeight.w600,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    );
  }
}

class _TaskMetaPill extends StatelessWidget {
  const _TaskMetaPill({
    required this.icon,
    required this.label,
    this.color,
    this.backgroundColor,
  });

  final IconData icon;
  final String label;
  final Color? color;
  final Color? backgroundColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: backgroundColor ??
            (color ?? RhythmTokens.textSecondary).withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
        border: Border.all(
          color: (color ?? RhythmTokens.borderSoft).withValues(alpha: 0.25),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color ?? RhythmTokens.textSecondary),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: color ?? RhythmTokens.textSecondary,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
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
      BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Container(
      color: RhythmTokens.background,
      padding: const EdgeInsets.fromLTRB(24, 0, 24, 4),
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
                  labelText: 'Title', border: OutlineInputBorder()),
              autofocus: true,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _notesController,
              decoration: const InputDecoration(
                  labelText: 'Notes (optional)', border: OutlineInputBorder()),
              minLines: 2,
              maxLines: 5,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                OutlinedButton.icon(
                  onPressed: _pickDate,
                  icon: const Icon(Icons.calendar_today, size: 16),
                  label: Text(_dueDate == null
                      ? 'Set due date'
                      : DateFormatters.fullDate(_dueDate)),
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
            child: const Text('Cancel')),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2))
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
