import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import '../controllers/project_template_controller.dart';
import '../models/project_instance.dart';
import '../models/project_template.dart';
import '../models/project_template_step.dart';
import '../services/project_generation_service.dart';
import '../../../app/core/constants/app_constants.dart';

class ProjectsView extends StatefulWidget {
  const ProjectsView({super.key});

  @override
  State<ProjectsView> createState() => _ProjectsViewState();
}

class _ProjectsViewState extends State<ProjectsView> {
  ProjectTemplate? _selected;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ProjectTemplateController>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<ProjectTemplateController>(
      builder: (context, controller, _) {
        // If the selected template was deleted, deselect it.
        if (_selected != null &&
            !controller.templates.any((t) => t.id == _selected!.id)) {
          _selected = null;
        }
        // Refresh selected template reference to reflect updates
        if (_selected != null) {
          _selected = controller.templates.firstWhere(
              (t) => t.id == _selected!.id,
              orElse: () => _selected!);
        }

        return Row(
          children: [
            // Left panel: template list
            SizedBox(
              width: 280,
              child: _TemplateList(
                controller: controller,
                selected: _selected,
                onSelect: (t) => setState(() => _selected = t),
              ),
            ),
            const VerticalDivider(width: 1),
            // Right panel: detail
            Expanded(
              child: _selected == null
                  ? const Center(
                      child: Text('Select a template to view details'))
                  : _TemplateDetail(
                      template: _selected!,
                      controller: controller,
                    ),
            ),
          ],
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Template List (left panel)
// ---------------------------------------------------------------------------

class _TemplateList extends StatelessWidget {
  const _TemplateList(
      {required this.controller,
      required this.selected,
      required this.onSelect});
  final ProjectTemplateController controller;
  final ProjectTemplate? selected;
  final ValueChanged<ProjectTemplate> onSelect;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 24, 16, 0),
          child: Row(
            children: [
              Text('Project Templates',
                  style: Theme.of(context).textTheme.titleMedium),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.add),
                tooltip: 'New template',
                onPressed: () => _showCreateDialog(context, controller),
              ),
            ],
          ),
        ),
        if (controller.status == ProjectsStatus.error &&
            controller.errorMessage != null)
          Padding(
            padding: const EdgeInsets.all(8),
            child: Text(controller.errorMessage!,
                style: const TextStyle(color: Colors.red, fontSize: 12)),
          ),
        if (controller.status == ProjectsStatus.loading &&
            controller.templates.isEmpty)
          const Padding(
              padding: EdgeInsets.all(16), child: LinearProgressIndicator()),
        Expanded(
          child: controller.templates.isEmpty
              ? const Center(
                  child: Text('No templates yet',
                      style: TextStyle(color: Colors.grey)))
              : ListView.builder(
                  itemCount: controller.templates.length,
                  itemBuilder: (ctx, i) {
                    final t = controller.templates[i];
                    final isSelected = selected?.id == t.id;
                    return ListTile(
                      selected: isSelected,
                      title: Text(t.name),
                      subtitle: Text(
                          '${t.steps.length} step${t.steps.length == 1 ? '' : 's'}'),
                      onTap: () => onSelect(t),
                      trailing: IconButton(
                        icon: const Icon(Icons.delete_outline, size: 18),
                        tooltip: 'Delete',
                        onPressed: () => _confirmDelete(ctx, controller, t),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Future<void> _showCreateDialog(
      BuildContext context, ProjectTemplateController controller) async {
    await showDialog<void>(
      context: context,
      builder: (_) => _CreateTemplateDialog(controller: controller),
    );
  }

  Future<void> _confirmDelete(BuildContext context,
      ProjectTemplateController controller, ProjectTemplate t) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Template'),
        content: Text('Delete "${t.name}"?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed == true) await controller.deleteTemplate(t.id);
  }
}

// ---------------------------------------------------------------------------
// Template Detail (right panel)
// ---------------------------------------------------------------------------

class _TemplateDetail extends StatefulWidget {
  const _TemplateDetail({required this.template, required this.controller});
  final ProjectTemplate template;
  final ProjectTemplateController controller;

  @override
  State<_TemplateDetail> createState() => _TemplateDetailState();
}

class _TemplateDetailState extends State<_TemplateDetail>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  List<ProjectInstance> _instances = [];
  bool _instancesLoaded = false;
  String? _instancesError;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _tabController.addListener(() {
      if (_tabController.index == 1 && !_instancesLoaded) {
        _loadInstances();
      }
    });
  }

  @override
  void didUpdateWidget(_TemplateDetail old) {
    super.didUpdateWidget(old);
    if (old.template.id != widget.template.id) {
      setState(() {
        _instances = [];
        _instancesLoaded = false;
        _instancesError = null;
      });
      if (_tabController.index == 1) _loadInstances();
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadInstances() async {
    try {
      final response = await http.get(
        Uri.parse(
            '${AppConstants.apiBaseUrl}/project-instances?templateId=${widget.template.id}'),
      );
      if (response.statusCode >= 400) {
        setState(() => _instancesError = 'Failed to load instances');
        return;
      }
      final list = (jsonDecode(response.body) as List<dynamic>)
          .map((e) => ProjectInstance.fromJson(e as Map<String, dynamic>))
          .toList();
      setState(() {
        _instances = list;
        _instancesLoaded = true;
        _instancesError = null;
      });
    } catch (e) {
      setState(() => _instancesError = e.toString());
    }
  }

  Future<void> _updateStep(ProjectInstanceStep step,
      {String? title, String? dueDate, String? status, String? notes}) async {
    try {
      final body = <String, dynamic>{
        if (title != null) 'title': title,
        if (dueDate != null) 'dueDate': dueDate,
        if (status != null) 'status': status,
        if (notes != null) 'notes': notes.isEmpty ? null : notes,
      };
      final response = await http.patch(
        Uri.parse(
            '${AppConstants.apiBaseUrl}/project-instances/steps/${step.id}'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );
      if (response.statusCode < 400) {
        await _loadInstances();
      }
    } catch (_) {}
  }

  Future<void> _deleteInstance(String instanceId) async {
    try {
      final response = await http.delete(
        Uri.parse('${AppConstants.apiBaseUrl}/project-instances/$instanceId'),
      );
      if (response.statusCode < 400) {
        await _loadInstances();
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final sortedSteps = [...widget.template.steps]
      ..sort((a, b) => a.offsetDays.compareTo(b.offsetDays));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(widget.template.name,
                        style: Theme.of(context).textTheme.headlineSmall),
                    if (widget.template.description != null &&
                        widget.template.description!.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(widget.template.description!,
                            style: const TextStyle(color: Colors.grey)),
                      ),
                    const SizedBox(height: 4),
                    Text('Anchor type: ${widget.template.anchorType}',
                        style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  OutlinedButton.icon(
                    onPressed: () => _showEditTemplateDialog(context),
                    icon: const Icon(Icons.edit_outlined, size: 18),
                    label: const Text('Edit'),
                  ),
                  const SizedBox(width: 8),
                  FilledButton.icon(
                    onPressed: () => _showGenerateDialog(context),
                    icon: const Icon(Icons.play_arrow, size: 18),
                    label: const Text('Start Project'),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Template Steps'),
            Tab(text: 'Active Projects'),
          ],
          labelPadding: const EdgeInsets.symmetric(horizontal: 24),
        ),
        Expanded(
          child: TabBarView(
            controller: _tabController,
            children: [
              // Tab 1: Template steps
              Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(24, 12, 24, 0),
                    child: Row(
                      children: [
                        Text('Steps',
                            style: Theme.of(context).textTheme.titleMedium),
                        const Spacer(),
                        TextButton.icon(
                          onPressed: () => _showAddStepDialog(context),
                          icon: const Icon(Icons.add, size: 16),
                          label: const Text('Add Step'),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: sortedSteps.isEmpty
                        ? const Center(
                            child: Text(
                                'No steps yet. Add a step to get started.'))
                        : ListView.separated(
                            padding: const EdgeInsets.all(24),
                            itemCount: sortedSteps.length,
                            separatorBuilder: (_, __) =>
                                const SizedBox(height: 8),
                            itemBuilder: (ctx, i) => _StepTile(
                              step: sortedSteps[i],
                              template: widget.template,
                              controller: widget.controller,
                            ),
                          ),
                  ),
                ],
              ),
              // Tab 2: Instances
              _InstancesPanel(
                instances: _instances,
                loaded: _instancesLoaded,
                error: _instancesError,
                onRefresh: _loadInstances,
                onUpdateStep: _updateStep,
                onDeleteInstance: _deleteInstance,
              ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _showAddStepDialog(BuildContext context) async {
    await showDialog<void>(
      context: context,
      builder: (_) => _AddStepDialog(
          template: widget.template, controller: widget.controller),
    );
  }

  Future<void> _showEditTemplateDialog(BuildContext context) async {
    await showDialog<void>(
      context: context,
      builder: (_) => _EditTemplateDialog(
          template: widget.template, controller: widget.controller),
    );
  }

  Future<void> _showGenerateDialog(BuildContext context) async {
    await showDialog<void>(
      context: context,
      builder: (_) => _GenerateInstanceDialog(template: widget.template),
    ).then((_) {
      if (_tabController.index == 1) _loadInstances();
    });
  }
}

class _InstancesPanel extends StatelessWidget {
  const _InstancesPanel({
    required this.instances,
    required this.loaded,
    required this.error,
    required this.onRefresh,
    required this.onUpdateStep,
    required this.onDeleteInstance,
  });
  final List<ProjectInstance> instances;
  final bool loaded;
  final String? error;
  final VoidCallback onRefresh;
  final Future<void> Function(ProjectInstanceStep step,
      {String? title,
      String? dueDate,
      String? status,
      String? notes}) onUpdateStep;
  final Future<void> Function(String instanceId) onDeleteInstance;

  @override
  Widget build(BuildContext context) {
    if (error != null) {
      return Center(
          child: Text(error!, style: const TextStyle(color: Colors.red)));
    }
    if (!loaded) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Click to load active projects',
                style: TextStyle(color: Colors.grey)),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: onRefresh, child: const Text('Load')),
          ],
        ),
      );
    }
    if (instances.isEmpty) {
      return const Center(
          child: Text('No active projects yet.',
              style: TextStyle(color: Colors.grey)));
    }
    return _InstancesList(
      instances: instances,
      onUpdateStep: onUpdateStep,
      onDeleteInstance: onDeleteInstance,
    );
  }
}

class _InstancesList extends StatefulWidget {
  const _InstancesList({
    required this.instances,
    required this.onUpdateStep,
    required this.onDeleteInstance,
  });
  final List<ProjectInstance> instances;
  final Future<void> Function(ProjectInstanceStep step,
      {String? title,
      String? dueDate,
      String? status,
      String? notes}) onUpdateStep;
  final Future<void> Function(String instanceId) onDeleteInstance;

  @override
  State<_InstancesList> createState() => _InstancesListState();
}

class _InstancesListState extends State<_InstancesList> {
  bool _showCompleted = false;

  @override
  Widget build(BuildContext context) {
    final visibleInstances = _showCompleted
        ? widget.instances
        : widget.instances
            .where((instance) =>
                instance.status != 'done' &&
                instance.steps.any((step) => step.status != 'done'))
            .toList();

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Row(
            children: [
              Text('Active Projects',
                  style: Theme.of(context).textTheme.titleMedium),
              const Spacer(),
              TextButton.icon(
                onPressed: () =>
                    setState(() => _showCompleted = !_showCompleted),
                icon: Icon(
                  _showCompleted ? Icons.visibility_off : Icons.visibility,
                  size: 16,
                ),
                label:
                    Text(_showCompleted ? 'Hide completed' : 'Show completed'),
              ),
            ],
          ),
        ),
        Expanded(
          child: visibleInstances.isEmpty
              ? Center(
                  child: Text(
                    _showCompleted
                        ? 'No active projects yet.'
                        : 'No incomplete active projects.',
                    style: const TextStyle(color: Colors.grey),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: visibleInstances.length,
                  itemBuilder: (ctx, i) => _InstanceCard(
                    instance: visibleInstances[i],
                    onUpdateStep: widget.onUpdateStep,
                    onDeleteInstance: widget.onDeleteInstance,
                    showCompleted: _showCompleted,
                  ),
                ),
        ),
      ],
    );
  }
}

class _InstanceCard extends StatelessWidget {
  const _InstanceCard({
    required this.instance,
    required this.onUpdateStep,
    required this.onDeleteInstance,
    required this.showCompleted,
  });
  final ProjectInstance instance;
  final Future<void> Function(ProjectInstanceStep step,
      {String? title,
      String? dueDate,
      String? status,
      String? notes}) onUpdateStep;
  final Future<void> Function(String instanceId) onDeleteInstance;
  final bool showCompleted;

  @override
  Widget build(BuildContext context) {
    final visibleSteps = showCompleted
        ? instance.steps
        : instance.steps.where((step) => step.status != 'done').toList();
    final title = instance.name?.trim().isNotEmpty == true
        ? instance.name!
        : 'Anchor: ${instance.anchorDate}';
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ExpansionTile(
        title: Text(title, style: Theme.of(context).textTheme.titleSmall),
        subtitle: Text(
            'Anchor ${instance.anchorDate} · ${visibleSteps.length} visible · ${instance.steps.length} total · ${instance.status}',
            style: const TextStyle(fontSize: 12, color: Colors.grey)),
        trailing: IconButton(
          icon: const Icon(Icons.delete_outline, size: 18),
          tooltip: 'Delete active project',
          onPressed: () => onDeleteInstance(instance.id),
        ),
        children: visibleSteps
            .map((step) => _InstanceStepTile(
                  step: step,
                  onUpdateStep: onUpdateStep,
                ))
            .toList(),
      ),
    );
  }
}

class _InstanceStepTile extends StatelessWidget {
  const _InstanceStepTile({required this.step, required this.onUpdateStep});
  final ProjectInstanceStep step;
  final Future<void> Function(ProjectInstanceStep step,
      {String? title,
      String? dueDate,
      String? status,
      String? notes}) onUpdateStep;

  @override
  Widget build(BuildContext context) {
    final isDone = step.status == 'done';
    return ListTile(
      leading: Checkbox(
        value: isDone,
        onChanged: (_) => onUpdateStep(step, status: isDone ? 'open' : 'done'),
        visualDensity: VisualDensity.compact,
        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
      title: Text(
        step.title,
        style: TextStyle(
          decoration: isDone ? TextDecoration.lineThrough : null,
          color: isDone ? Colors.grey : null,
        ),
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Due: ${step.dueDate}',
              style: const TextStyle(fontSize: 12, color: Colors.grey)),
          if (step.notes != null && step.notes!.isNotEmpty)
            Text(step.notes!,
                style: const TextStyle(fontSize: 12, color: Colors.blueGrey)),
        ],
      ),
      trailing: IconButton(
        icon: const Icon(Icons.edit_outlined, size: 16),
        onPressed: () => showDialog<void>(
          context: context,
          builder: (_) =>
              _EditInstanceStepDialog(step: step, onSave: onUpdateStep),
        ),
      ),
    );
  }
}

class _EditInstanceStepDialog extends StatefulWidget {
  const _EditInstanceStepDialog({required this.step, required this.onSave});
  final ProjectInstanceStep step;
  final Future<void> Function(ProjectInstanceStep step,
      {String? title, String? dueDate, String? status, String? notes}) onSave;

  @override
  State<_EditInstanceStepDialog> createState() =>
      _EditInstanceStepDialogState();
}

class _EditInstanceStepDialogState extends State<_EditInstanceStepDialog> {
  late final TextEditingController _titleCtrl;
  late final TextEditingController _dueDateCtrl;
  late final TextEditingController _notesCtrl;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _titleCtrl = TextEditingController(text: widget.step.title);
    _dueDateCtrl = TextEditingController(text: widget.step.dueDate);
    _notesCtrl = TextEditingController(text: widget.step.notes ?? '');
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _dueDateCtrl.dispose();
    _notesCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit Step'),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _titleCtrl,
              decoration: const InputDecoration(
                  labelText: 'Title', border: OutlineInputBorder()),
              autofocus: true,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _dueDateCtrl,
              decoration: const InputDecoration(
                  labelText: 'Due date (YYYY-MM-DD)',
                  border: OutlineInputBorder()),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _notesCtrl,
              decoration: const InputDecoration(
                  labelText: 'Notes (optional)', border: OutlineInputBorder()),
              minLines: 2,
              maxLines: 4,
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
    final title = _titleCtrl.text.trim();
    if (title.isEmpty) return;
    setState(() => _saving = true);
    await widget.onSave(
      widget.step,
      title: title,
      dueDate:
          _dueDateCtrl.text.trim().isEmpty ? null : _dueDateCtrl.text.trim(),
      notes: _notesCtrl.text.trim(),
    );
    if (mounted) Navigator.pop(context);
  }
}

class _StepTile extends StatelessWidget {
  const _StepTile(
      {required this.step, required this.template, required this.controller});
  final ProjectTemplateStep step;
  final ProjectTemplate template;
  final ProjectTemplateController controller;

  @override
  Widget build(BuildContext context) {
    final offsetLabel = step.offsetDescription ??
        (step.offsetDays == 0
            ? 'On anchor date'
            : step.offsetDays > 0
                ? '+${step.offsetDays} days'
                : '${step.offsetDays} days');

    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: ListTile(
        leading: CircleAvatar(
          radius: 14,
          backgroundColor: Theme.of(context).colorScheme.primaryContainer,
          child: Text(
            step.sortOrder.toString(),
            style: TextStyle(
                fontSize: 12,
                color: Theme.of(context).colorScheme.onPrimaryContainer),
          ),
        ),
        title: Text(step.title),
        subtitle: Text(offsetLabel),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Offset: ${step.offsetDays}d',
                style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(width: 4),
            IconButton(
              icon: const Icon(Icons.edit_outlined, size: 16),
              tooltip: 'Edit step',
              onPressed: () => showDialog<void>(
                context: context,
                builder: (_) => _EditStepDialog(
                    step: step, template: template, controller: controller),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 16),
              tooltip: 'Delete step',
              onPressed: () => _confirmDeleteStep(context),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmDeleteStep(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Step'),
        content: Text('Delete step "${step.title}"?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed == true) await controller.deleteStep(template.id, step.id);
  }
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

class _EditTemplateDialog extends StatefulWidget {
  const _EditTemplateDialog({required this.template, required this.controller});
  final ProjectTemplate template;
  final ProjectTemplateController controller;

  @override
  State<_EditTemplateDialog> createState() => _EditTemplateDialogState();
}

class _EditTemplateDialogState extends State<_EditTemplateDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _descController;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.template.name);
    _descController =
        TextEditingController(text: widget.template.description ?? '');
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit Template'),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _nameController,
              decoration: const InputDecoration(
                  labelText: 'Name', border: OutlineInputBorder()),
              autofocus: true,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _descController,
              decoration: const InputDecoration(
                  labelText: 'Description (optional)',
                  border: OutlineInputBorder()),
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
    final name = _nameController.text.trim();
    if (name.isEmpty) return;
    setState(() => _saving = true);
    await widget.controller.updateTemplate(
      widget.template.id,
      name: name,
      description: _descController.text.trim().isEmpty
          ? null
          : _descController.text.trim(),
    );
    if (mounted) Navigator.pop(context);
  }
}

class _EditStepDialog extends StatefulWidget {
  const _EditStepDialog(
      {required this.step, required this.template, required this.controller});
  final ProjectTemplateStep step;
  final ProjectTemplate template;
  final ProjectTemplateController controller;

  @override
  State<_EditStepDialog> createState() => _EditStepDialogState();
}

class _EditStepDialogState extends State<_EditStepDialog> {
  late final TextEditingController _titleController;
  late final TextEditingController _offsetController;
  late final TextEditingController _descController;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.step.title);
    _offsetController =
        TextEditingController(text: widget.step.offsetDays.toString());
    _descController =
        TextEditingController(text: widget.step.offsetDescription ?? '');
  }

  @override
  void dispose() {
    _titleController.dispose();
    _offsetController.dispose();
    _descController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit Step'),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _titleController,
              decoration: const InputDecoration(
                  labelText: 'Step title', border: OutlineInputBorder()),
              autofocus: true,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _offsetController,
              decoration: const InputDecoration(
                labelText: 'Offset days (negative = before anchor)',
                border: OutlineInputBorder(),
              ),
              keyboardType: const TextInputType.numberWithOptions(signed: true),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[-\d]'))
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _descController,
              decoration: const InputDecoration(
                labelText: 'Description (e.g. "8 weeks before")',
                border: OutlineInputBorder(),
              ),
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
    final offsetDays =
        int.tryParse(_offsetController.text) ?? widget.step.offsetDays;
    setState(() => _saving = true);
    await widget.controller.updateStep(
      widget.template.id,
      widget.step.id,
      title: title,
      offsetDays: offsetDays,
      offsetDescription: _descController.text.trim().isEmpty
          ? null
          : _descController.text.trim(),
    );
    if (mounted) Navigator.pop(context);
  }
}

class _CreateTemplateDialog extends StatefulWidget {
  const _CreateTemplateDialog({required this.controller});
  final ProjectTemplateController controller;

  @override
  State<_CreateTemplateDialog> createState() => _CreateTemplateDialogState();
}

class _CreateTemplateDialogState extends State<_CreateTemplateDialog> {
  final _nameController = TextEditingController();
  final _descController = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _nameController.dispose();
    _descController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('New Template'),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _nameController,
              decoration: const InputDecoration(
                  labelText: 'Name', border: OutlineInputBorder()),
              autofocus: true,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _descController,
              decoration: const InputDecoration(
                  labelText: 'Description (optional)',
                  border: OutlineInputBorder()),
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
              : const Text('Create'),
        ),
      ],
    );
  }

  Future<void> _save() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) return;
    setState(() => _saving = true);
    await widget.controller.createTemplate(name,
        description: _descController.text.trim().isEmpty
            ? null
            : _descController.text.trim());
    if (mounted) Navigator.pop(context);
  }
}

class _AddStepDialog extends StatefulWidget {
  const _AddStepDialog({required this.template, required this.controller});
  final ProjectTemplate template;
  final ProjectTemplateController controller;

  @override
  State<_AddStepDialog> createState() => _AddStepDialogState();
}

class _AddStepDialogState extends State<_AddStepDialog> {
  final _titleController = TextEditingController();
  final _descController = TextEditingController();
  final _offsetController = TextEditingController(text: '0');
  bool _saving = false;

  @override
  void dispose() {
    _titleController.dispose();
    _descController.dispose();
    _offsetController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add Step'),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _titleController,
              decoration: const InputDecoration(
                  labelText: 'Step title', border: OutlineInputBorder()),
              autofocus: true,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _offsetController,
              decoration: const InputDecoration(
                labelText: 'Offset days (negative = before anchor)',
                border: OutlineInputBorder(),
              ),
              keyboardType: const TextInputType.numberWithOptions(signed: true),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[-\d]'))
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _descController,
              decoration: const InputDecoration(
                labelText: 'Description (e.g. "8 weeks before")',
                border: OutlineInputBorder(),
              ),
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
              : const Text('Add'),
        ),
      ],
    );
  }

  Future<void> _save() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;
    final offsetDays = int.tryParse(_offsetController.text) ?? 0;
    setState(() => _saving = true);
    await widget.controller.addStep(
      widget.template.id,
      title: title,
      offsetDays: offsetDays,
      offsetDescription: _descController.text.trim().isEmpty
          ? null
          : _descController.text.trim(),
      sortOrder: widget.template.steps.length,
    );
    if (mounted) Navigator.pop(context);
  }
}

class _GenerateInstanceDialog extends StatefulWidget {
  const _GenerateInstanceDialog({required this.template});
  final ProjectTemplate template;

  @override
  State<_GenerateInstanceDialog> createState() =>
      _GenerateInstanceDialogState();
}

class _GenerateInstanceDialogState extends State<_GenerateInstanceDialog> {
  DateTime? _anchorDate;
  bool _generating = false;
  ProjectInstance? _result;
  String? _error;
  late final TextEditingController _nameController;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController();
  }

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  List<ResolvedStep> get _preview {
    if (_anchorDate == null) return [];
    return ProjectGenerationService()
        .previewSteps(widget.template, _anchorDate!);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('Start Project: ${widget.template.name}'),
      content: SizedBox(
        width: 480,
        child: _result != null
            ? _SuccessView(instance: _result!)
            : _FormView(
                nameController: _nameController,
                anchorDate: _anchorDate,
                preview: _preview,
                error: _error,
                onPickDate: _pickDate,
              ),
      ),
      actions: _result != null
          ? [
              FilledButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Close'))
            ]
          : [
              TextButton(
                  onPressed: _generating ? null : () => Navigator.pop(context),
                  child: const Text('Cancel')),
              FilledButton(
                onPressed:
                    _anchorDate == null || _generating ? null : _generate,
                child: _generating
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Start Project'),
              ),
            ],
    );
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null) setState(() => _anchorDate = picked);
  }

  Future<void> _generate() async {
    if (_anchorDate == null) return;
    setState(() {
      _generating = true;
      _error = null;
    });

    final dateStr =
        '${_anchorDate!.year}-${_anchorDate!.month.toString().padLeft(2, '0')}-${_anchorDate!.day.toString().padLeft(2, '0')}';

    try {
      final response = await http.post(
        Uri.parse(
            '${AppConstants.apiBaseUrl}/project-templates/${widget.template.id}/generate'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'anchorDate': dateStr,
          if (_nameController.text.trim().isNotEmpty)
            'name': _nameController.text.trim(),
        }),
      );
      if (response.statusCode >= 400) {
        final body = jsonDecode(response.body) as Map<String, dynamic>?;
        final msg =
            (body?['error'] as Map<String, dynamic>?)?['message'] as String? ??
                'Generation failed';
        setState(() {
          _error = msg;
          _generating = false;
        });
      } else {
        final instance = ProjectInstance.fromJson(
            jsonDecode(response.body) as Map<String, dynamic>);
        setState(() {
          _result = instance;
          _generating = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
        _generating = false;
      });
    }
  }
}

class _FormView extends StatelessWidget {
  const _FormView(
      {required this.nameController,
      required this.anchorDate,
      required this.preview,
      required this.error,
      required this.onPickDate});
  final TextEditingController nameController;
  final DateTime? anchorDate;
  final List<ResolvedStep> preview;
  final String? error;
  final VoidCallback onPickDate;

  @override
  Widget build(BuildContext context) {
    final dateLabel = anchorDate == null
        ? 'Pick anchor date'
        : '${anchorDate!.year}-${anchorDate!.month.toString().padLeft(2, '0')}-${anchorDate!.day.toString().padLeft(2, '0')}';

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: nameController,
          decoration: const InputDecoration(
            labelText: 'Project instance name (optional)',
            hintText: 'Easter',
            border: OutlineInputBorder(),
          ),
          autofocus: true,
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: onPickDate,
          icon: const Icon(Icons.calendar_today, size: 16),
          label: Text(dateLabel),
        ),
        if (error != null) ...[
          const SizedBox(height: 8),
          Text(error!, style: const TextStyle(color: Colors.red, fontSize: 12)),
        ],
        if (preview.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text('Preview of resolved dates:',
              style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 8),
          ...preview.map((rs) {
            final d = rs.dueDate;
            final ds =
                '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  const Icon(Icons.arrow_right, size: 16, color: Colors.grey),
                  const SizedBox(width: 4),
                  Expanded(child: Text(rs.step.title)),
                  Text(ds,
                      style: const TextStyle(color: Colors.grey, fontSize: 12)),
                ],
              ),
            );
          }),
        ],
      ],
    );
  }
}

class _SuccessView extends StatelessWidget {
  const _SuccessView({required this.instance});
  final ProjectInstance instance;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.check_circle,
                color: Theme.of(context).colorScheme.primary),
            const SizedBox(width: 8),
            const Text('Project started successfully!'),
          ],
        ),
        const SizedBox(height: 12),
        if (instance.name != null && instance.name!.isNotEmpty) ...[
          Text(instance.name!, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
        ],
        Text('Anchor: ${instance.anchorDate}',
            style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 8),
        ...instance.steps.map((s) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  const Icon(Icons.task_alt, size: 14, color: Colors.grey),
                  const SizedBox(width: 6),
                  Expanded(
                      child: Text(s.title,
                          style: Theme.of(context).textTheme.bodySmall)),
                  Text(s.dueDate,
                      style: const TextStyle(color: Colors.grey, fontSize: 11)),
                ],
              ),
            )),
      ],
    );
  }
}
