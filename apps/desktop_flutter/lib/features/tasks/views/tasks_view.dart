import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../controllers/tasks_controller.dart';
import '../models/task.dart';

class TasksView extends StatefulWidget {
  const TasksView({super.key});

  @override
  State<TasksView> createState() => _TasksViewState();
}

class _TasksViewState extends State<TasksView> {
  final _titleController = TextEditingController();
  String? _selectedDueDate;

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
      setState(() => _selectedDueDate = picked.toIso8601String().substring(0, 10));
    }
  }

  Future<void> _submitCreate() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;
    await context.read<TasksController>().createTask(title, dueDate: _selectedDueDate);
    _titleController.clear();
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
              _buildErrorBanner(controller.errorMessage ?? 'Unknown error', controller),
            Expanded(child: _buildTaskList(controller)),
            _buildCreateBar(context),
          ],
        );
      },
    );
  }

  Widget _buildHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 8),
      child: Text('Tasks', style: Theme.of(context).textTheme.headlineSmall),
    );
  }

  Widget _buildErrorBanner(String message, TasksController controller) {
    return MaterialBanner(
      content: Text(message),
      actions: [
        TextButton(onPressed: controller.load, child: const Text('Retry')),
      ],
    );
  }

  Widget _buildTaskList(TasksController controller) {
    if (controller.status == TasksStatus.loading && controller.tasks.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (controller.tasks.isEmpty) {
      return const Center(child: Text('No tasks yet. Add one below.'));
    }
    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
      itemCount: controller.tasks.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, i) => _buildTaskTile(controller.tasks[i], controller),
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
      subtitle: task.dueDate != null ? Text('Due: ${task.dueDate}') : null,
      trailing: IconButton(
        icon: const Icon(Icons.delete_outline, size: 18),
        tooltip: 'Delete',
        onPressed: () => controller.deleteTask(task.id),
      ),
    );
  }

  Widget _buildCreateBar(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 12, 24, 20),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerLow,
        border: Border(top: BorderSide(color: Theme.of(context).dividerColor)),
      ),
      child: Row(
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
    );
  }
}
