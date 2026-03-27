import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../app/core/widgets/error_banner.dart';
import '../controllers/tasks_controller.dart';
import '../models/task.dart';
// ignore_for_file: use_build_context_synchronously

class TasksView extends StatefulWidget {
  const TasksView({super.key});

  @override
  State<TasksView> createState() => _TasksViewState();
}

class _TasksViewState extends State<TasksView> {
  final _titleController = TextEditingController();
  final _notesController = TextEditingController();
  String? _selectedDueDate;
  bool _showCompleted = false;
  bool _sortByDueDate = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<TasksController>().load();
    });
  }

  @override
  void dispose() {
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
    return Consumer<TasksController>(
      builder: (context, controller, _) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildHeader(context),
            if (controller.status == TasksStatus.error)
              ErrorBanner(
                message: controller.errorMessage ?? 'Unknown error',
                onRetry: controller.load,
              ),
            Expanded(child: _buildTaskList(controller)),
            _buildCreateBar(context),
          ],
        );
      },
    );
  }

  Widget _buildHeader(BuildContext context) {
    final primaryColor = Theme.of(context).colorScheme.primary;
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 8),
      child: Row(
        children: [
          Text('Tasks', style: Theme.of(context).textTheme.headlineSmall),
          const Spacer(),
          IconButton(
            icon: Icon(
              Icons.calendar_today,
              size: 18,
              color: _sortByDueDate ? primaryColor : null,
            ),
            tooltip: _sortByDueDate ? 'Sorted by due date' : 'Sort by due date',
            onPressed: () => setState(() => _sortByDueDate = !_sortByDueDate),
          ),
          TextButton.icon(
            onPressed: () => setState(() => _showCompleted = !_showCompleted),
            icon: Icon(
              _showCompleted ? Icons.visibility_off : Icons.visibility,
              size: 16,
            ),
            label: Text(_showCompleted ? 'Hide completed' : 'Show completed'),
          ),
        ],
      ),
    );
  }

  Widget _buildTaskList(TasksController controller) {
    var visibleTasks = _showCompleted
        ? controller.tasks.toList()
        : controller.tasks.where((task) => task.status != 'done').toList();
    if (_sortByDueDate) {
      visibleTasks.sort((a, b) {
        if (a.dueDate == null && b.dueDate == null) return 0;
        if (a.dueDate == null) return 1;
        if (b.dueDate == null) return -1;
        return a.dueDate!.compareTo(b.dueDate!);
      });
    }
    if (controller.status == TasksStatus.loading && controller.tasks.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (visibleTasks.isEmpty) {
      return Center(
        child: Text(
          controller.tasks.isEmpty
              ? 'No tasks yet. Add one below.'
              : 'No incomplete tasks.',
        ),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
      itemCount: visibleTasks.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, i) => _buildTaskTile(visibleTasks[i], controller),
    );
  }

  Widget _buildTaskTile(Task task, TasksController controller) {
    final isDone = task.status == 'done';
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 0, vertical: 2),
      leading: Checkbox(
        value: isDone,
        onChanged: (_) => controller.toggleDone(task.id),
      ),
      title: Text(
        task.title,
        style: TextStyle(
          decoration: isDone ? TextDecoration.lineThrough : null,
          color: isDone ? Colors.grey : null,
        ),
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (task.dueDate != null) Text('Due: ${task.dueDate}'),
          if (task.notes != null && task.notes!.isNotEmpty)
            Text(
              task.notes!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Colors.grey, fontSize: 12),
            ),
        ],
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            icon: const Icon(Icons.edit_outlined, size: 18),
            tooltip: 'Edit',
            onPressed: () => _showEditDialog(task, controller),
          ),
          IconButton(
            icon: const Icon(Icons.delete_outline, size: 18),
            tooltip: 'Delete',
            onPressed: () => _confirmDelete(task, controller),
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
      padding: const EdgeInsets.fromLTRB(24, 12, 24, 20),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerLow,
        border: Border(top: BorderSide(color: Theme.of(context).dividerColor)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _titleController,
                  decoration: const InputDecoration(
                    hintText: 'New task title...',
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                  onSubmitted: (_) => _submitCreate(),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: _pickDate,
                icon: const Icon(Icons.calendar_today, size: 16),
                label: Text(_selectedDueDate ?? 'Due date'),
              ),
              const SizedBox(width: 8),
              FilledButton(onPressed: _submitCreate, child: const Text('Add')),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _notesController,
            decoration: const InputDecoration(
              hintText: 'Add a note... (optional)',
              isDense: true,
              border: OutlineInputBorder(),
            ),
            minLines: 1,
            maxLines: 3,
          ),
        ],
      ),
    );
  }
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
                  label: Text(_dueDate ?? 'Set due date'),
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
