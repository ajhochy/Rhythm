import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import '../../../app/core/formatters/date_formatters.dart';
import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/auth/auth_session_store.dart';
import '../controllers/project_template_controller.dart';
import '../models/project_instance.dart';
import '../models/project_template.dart';
import '../models/project_template_step.dart';
import '../services/project_generation_service.dart';
import '../../../app/core/services/server_config_service.dart';
import '../../../app/core/workspace/workspace_controller.dart';
import '../../../shared/widgets/collaborators_row.dart';
import '../../../shared/widgets/workspace_member_picker.dart';
import '../../tasks/data/collaborators_data_source.dart';

class ProjectsView extends StatefulWidget {
  const ProjectsView({super.key});

  @override
  State<ProjectsView> createState() => _ProjectsViewState();
}

class _ProjectsViewState extends State<ProjectsView> {
  ProjectTemplate? _selected;
  bool _showActiveProjects = false;
  List<ProjectInstance> _activeInstances = [];
  bool _activeInstancesLoaded = false;
  String? _activeInstancesError;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ProjectTemplateController>().load();
      context.read<WorkspaceController>().loadMembers();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFFF7F4EF),
            Color(0xFFFDFBF7),
            Color(0xFFF6F1EA),
          ],
          stops: [0.0, 0.5, 1.0],
        ),
      ),
      child: Consumer<ProjectTemplateController>(
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
              orElse: () => _selected!,
            );
          }

          final templateNames = {
            for (final template in controller.templates)
              template.id: template.name,
          };

          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 20, 24, 12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Projects',
                            style: Theme.of(context)
                                .textTheme
                                .headlineSmall
                                ?.copyWith(
                                  fontWeight: FontWeight.w600,
                                  letterSpacing: -0.5,
                                ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Templates on the left, live work on the right.',
                            style: Theme.of(context)
                                .textTheme
                                .bodyMedium
                                ?.copyWith(
                                  color: Theme.of(context)
                                      .colorScheme
                                      .onSurfaceVariant,
                                  height: 1.4,
                                ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 16),
                    Container(
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.surface,
                        borderRadius: BorderRadius.circular(22),
                        border: Border.all(
                          color: Theme.of(context).colorScheme.outlineVariant,
                        ),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0x12000000),
                            blurRadius: 18,
                            offset: Offset(0, 8),
                          ),
                        ],
                      ),
                      child: SegmentedButton<bool>(
                        segments: const [
                          ButtonSegment<bool>(
                            value: false,
                            label: Text('Templates'),
                            icon: Icon(Icons.dashboard_customize_outlined),
                          ),
                          ButtonSegment<bool>(
                            value: true,
                            label: Text('Active Projects'),
                            icon:
                                Icon(Icons.playlist_add_check_circle_outlined),
                          ),
                        ],
                        selected: {_showActiveProjects},
                        showSelectedIcon: false,
                        style: const ButtonStyle(
                          visualDensity: VisualDensity.compact,
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          padding: WidgetStatePropertyAll(
                            EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                          ),
                        ),
                        onSelectionChanged: (selection) {
                          final showActive = selection.first;
                          setState(() => _showActiveProjects = showActive);
                          if (showActive && !_activeInstancesLoaded) {
                            _loadActiveInstances();
                          }
                        },
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: _showActiveProjects
                    ? _InstancesPanel(
                        instances: _activeInstances,
                        loaded: _activeInstancesLoaded,
                        error: _activeInstancesError,
                        onRefresh: _loadActiveInstances,
                        onUpdateStep: _updateActiveProjectStep,
                        onDeleteInstance: _deleteActiveProjectInstance,
                        templateNames: templateNames,
                      )
                    : Padding(
                        padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
                        child: Row(
                          children: [
                            SizedBox(
                              width: 300,
                              child: _TemplateList(
                                controller: controller,
                                selected: _selected,
                                onSelect: (t) => setState(() => _selected = t),
                              ),
                            ),
                            const SizedBox(width: 16),
                            Expanded(
                              child: _selected == null
                                  ? const _EmptyDetailState(
                                      icon: Icons.folder_open_outlined,
                                      title: 'Choose a template',
                                      message:
                                          'Template details, steps, and generated project instances will appear here.',
                                    )
                                  : _TemplateDetail(
                                      template: _selected!,
                                      controller: controller,
                                    ),
                            ),
                          ],
                        ),
                      ),
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _loadActiveInstances() async {
    try {
      final response = await http.get(
        Uri.parse(
            '${context.read<ServerConfigService>().url}/project-instances'),
        headers: AuthSessionStore.headers(),
      );
      if (response.statusCode >= 400) {
        setState(() {
          _activeInstancesError = 'Failed to load active projects';
          _activeInstancesLoaded = true;
        });
        return;
      }
      final list = (jsonDecode(response.body) as List<dynamic>)
          .map((e) => ProjectInstance.fromJson(e as Map<String, dynamic>))
          .toList()
        ..sort((a, b) => a.anchorDate.compareTo(b.anchorDate));
      setState(() {
        _activeInstances = list;
        _activeInstancesLoaded = true;
        _activeInstancesError = null;
      });
    } catch (error) {
      setState(() {
        _activeInstancesError = error.toString();
        _activeInstancesLoaded = true;
      });
    }
  }

  Future<void> _updateActiveProjectStep(ProjectInstanceStep step,
      {String? title,
      String? dueDate,
      String? status,
      String? notes,
      int? assigneeId}) async {
    try {
      final body = <String, dynamic>{
        if (title != null) 'title': title,
        if (dueDate != null) 'dueDate': dueDate,
        if (status != null) 'status': status,
        if (notes != null) 'notes': notes.isEmpty ? null : notes,
        'assigneeId': assigneeId,
      };
      final response = await http.patch(
        Uri.parse(
            '${context.read<ServerConfigService>().url}/project-instances/steps/${step.id}'),
        headers: AuthSessionStore.headers(json: true),
        body: jsonEncode(body),
      );
      if (response.statusCode < 400) {
        await _loadActiveInstances();
      }
    } catch (_) {}
  }

  Future<void> _deleteActiveProjectInstance(String instanceId) async {
    try {
      final response = await http.delete(
        Uri.parse(
            '${context.read<ServerConfigService>().url}/project-instances/$instanceId'),
        headers: AuthSessionStore.headers(),
      );
      if (response.statusCode < 400) {
        await _loadActiveInstances();
      }
    } catch (_) {}
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
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: colorScheme.outlineVariant),
        boxShadow: const [
          BoxShadow(
            color: Color(0x10000000),
            blurRadius: 20,
            offset: Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 12, 12),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Project Templates',
                        style:
                            Theme.of(context).textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.w600,
                                ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Select one to inspect or edit its steps.',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: colorScheme.onSurfaceVariant,
                            ),
                      ),
                    ],
                  ),
                ),
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
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Text(
                controller.errorMessage!,
                style: TextStyle(
                  color: colorScheme.error,
                  fontSize: 12,
                ),
              ),
            ),
          if (controller.status == ProjectsStatus.loading &&
              controller.templates.isEmpty)
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: LinearProgressIndicator(minHeight: 2),
            ),
          SizedBox(
              height: 1, child: Container(color: colorScheme.outlineVariant)),
          const SizedBox(height: 12),
          Expanded(
            child: controller.templates.isEmpty
                ? _EmptyPanelState(
                    icon: Icons.folder_open_outlined,
                    title: 'No templates yet',
                    message:
                        'Create a template to start mapping out recurring project steps.',
                    actionLabel: 'New template',
                    onAction: () => _showCreateDialog(context, controller),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(12, 0, 12, 14),
                    itemCount: controller.templates.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (ctx, i) {
                      final t = controller.templates[i];
                      final isSelected = selected?.id == t.id;
                      return Card(
                        elevation: 0,
                        color: colorScheme.surface,
                        surfaceTintColor: Colors.transparent,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(18),
                          side: BorderSide(
                            color: isSelected
                                ? colorScheme.primary.withValues(alpha: 0.35)
                                : colorScheme.outlineVariant,
                          ),
                        ),
                        child: ListTile(
                          selected: isSelected,
                          selectedTileColor: colorScheme.primaryContainer
                              .withValues(alpha: 0.22),
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 8,
                          ),
                          leading: CircleAvatar(
                            radius: 16,
                            backgroundColor: colorScheme.primaryContainer,
                            child: Text(
                              '${t.steps.length}',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: colorScheme.onPrimaryContainer,
                              ),
                            ),
                          ),
                          title: Text(
                            t.name,
                            style: const TextStyle(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          subtitle: Text(
                            '${t.steps.length} step${t.steps.length == 1 ? '' : 's'}',
                            style:
                                TextStyle(color: colorScheme.onSurfaceVariant),
                          ),
                          onTap: () => onSelect(t),
                          trailing: IconButton(
                            icon: const Icon(Icons.delete_outline, size: 18),
                            tooltip: 'Delete',
                            onPressed: () => _confirmDelete(ctx, controller, t),
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
            '${context.read<ServerConfigService>().url}/project-instances?templateId=${widget.template.id}'),
        headers: AuthSessionStore.headers(),
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
      {String? title,
      String? dueDate,
      String? status,
      String? notes,
      int? assigneeId}) async {
    try {
      final body = <String, dynamic>{
        if (title != null) 'title': title,
        if (dueDate != null) 'dueDate': dueDate,
        if (status != null) 'status': status,
        if (notes != null) 'notes': notes.isEmpty ? null : notes,
        'assigneeId': assigneeId,
      };
      final response = await http.patch(
        Uri.parse(
            '${context.read<ServerConfigService>().url}/project-instances/steps/${step.id}'),
        headers: AuthSessionStore.headers(json: true),
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
        Uri.parse(
            '${context.read<ServerConfigService>().url}/project-instances/$instanceId'),
        headers: AuthSessionStore.headers(),
      );
      if (response.statusCode < 400) {
        await _loadInstances();
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final sortedSteps = [...widget.template.steps]
      ..sort((a, b) => a.offsetDays.compareTo(b.offsetDays));

    return Container(
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: colorScheme.outlineVariant),
        boxShadow: const [
          BoxShadow(
            color: Color(0x12000000),
            blurRadius: 28,
            offset: Offset(0, 14),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 20, 24, 14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.template.name,
                        style:
                            Theme.of(context).textTheme.headlineSmall?.copyWith(
                                  fontWeight: FontWeight.w600,
                                  letterSpacing: -0.4,
                                ),
                      ),
                      if (widget.template.description != null &&
                          widget.template.description!.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text(
                            widget.template.description!,
                            style: Theme.of(context)
                                .textTheme
                                .bodyMedium
                                ?.copyWith(
                                  color: colorScheme.onSurfaceVariant,
                                  height: 1.4,
                                ),
                          ),
                        ),
                      const SizedBox(height: 10),
                      Text(
                        'Anchor type: ${widget.template.anchorType}',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: colorScheme.onSurfaceVariant,
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
                  children: [
                    OutlinedButton.icon(
                      onPressed: () => _showEditTemplateDialog(context),
                      icon: const Icon(Icons.edit_outlined, size: 18),
                      label: const Text('Edit'),
                    ),
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
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Container(
              decoration: BoxDecoration(
                color: colorScheme.surface,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: colorScheme.outlineVariant),
              ),
              child: TabBar(
                controller: _tabController,
                tabs: const [
                  Tab(text: 'Template Steps'),
                  Tab(text: 'Active Projects'),
                ],
                labelPadding: const EdgeInsets.symmetric(horizontal: 20),
                indicatorSize: TabBarIndicatorSize.tab,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(24, 12, 24, 0),
                      child: Row(
                        children: [
                          Text(
                            'Steps',
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(fontWeight: FontWeight.w600),
                          ),
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
                          ? const _EmptyPanelState(
                              icon: Icons.task_alt_outlined,
                              title: 'No steps yet',
                              message:
                                  'Add a step to map the work that belongs in this template.',
                            )
                          : ListView.separated(
                              padding:
                                  const EdgeInsets.fromLTRB(24, 16, 24, 24),
                              itemCount: sortedSteps.length,
                              separatorBuilder: (_, __) =>
                                  const SizedBox(height: 10),
                              itemBuilder: (ctx, i) => _StepTile(
                                step: sortedSteps[i],
                                template: widget.template,
                                controller: widget.controller,
                              ),
                            ),
                    ),
                  ],
                ),
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
      ),
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

class _EmptyPanelState extends StatelessWidget {
  const _EmptyPanelState({
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
    final colorScheme = Theme.of(context).colorScheme;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 360),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: colorScheme.primaryContainer.withValues(alpha: 0.45),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: colorScheme.onPrimaryContainer),
              ),
              const SizedBox(height: 16),
              Text(
                title,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
              ),
              const SizedBox(height: 8),
              Text(
                message,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: colorScheme.onSurfaceVariant,
                      height: 1.4,
                    ),
              ),
              if (actionLabel != null && onAction != null) ...[
                const SizedBox(height: 16),
                OutlinedButton(
                  onPressed: onAction,
                  child: Text(actionLabel!),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _EmptyDetailState extends StatelessWidget {
  const _EmptyDetailState({
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: colorScheme.outlineVariant),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F000000),
            blurRadius: 24,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: SizedBox.expand(
        child: _EmptyPanelState(
          icon: icon,
          title: title,
          message: message,
        ),
      ),
    );
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
    this.templateNames = const {},
  });
  final List<ProjectInstance> instances;
  final bool loaded;
  final String? error;
  final VoidCallback onRefresh;
  final Future<void> Function(ProjectInstanceStep step,
      {String? title,
      String? dueDate,
      String? status,
      String? notes,
      int? assigneeId}) onUpdateStep;
  final Future<void> Function(String instanceId) onDeleteInstance;
  final Map<String, String> templateNames;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    if (error != null) {
      return _EmptyPanelState(
        icon: Icons.error_outline,
        title: 'Could not load active projects',
        message: error!,
        actionLabel: 'Retry',
        onAction: onRefresh,
      );
    }
    if (!loaded) {
      return _EmptyPanelState(
        icon: Icons.playlist_add_check_circle_outlined,
        title: 'Load active projects',
        message: 'Open the live project list to review work in progress.',
        actionLabel: 'Load',
        onAction: onRefresh,
      );
    }
    if (instances.isEmpty) {
      return const _EmptyPanelState(
        icon: Icons.inbox_outlined,
        title: 'No active projects yet',
        message:
            'When a template is started, its project instance will appear here.',
      );
    }
    return Container(
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: colorScheme.outlineVariant),
      ),
      child: _InstancesList(
        instances: instances,
        onRefresh: onRefresh,
        onUpdateStep: onUpdateStep,
        onDeleteInstance: onDeleteInstance,
        templateNames: templateNames,
      ),
    );
  }
}

class _InstancesList extends StatefulWidget {
  const _InstancesList({
    required this.instances,
    required this.onRefresh,
    required this.onUpdateStep,
    required this.onDeleteInstance,
    this.templateNames = const {},
  });
  final List<ProjectInstance> instances;
  final VoidCallback onRefresh;
  final Future<void> Function(ProjectInstanceStep step,
      {String? title,
      String? dueDate,
      String? status,
      String? notes,
      int? assigneeId}) onUpdateStep;
  final Future<void> Function(String instanceId) onDeleteInstance;
  final Map<String, String> templateNames;

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
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
          child: Row(
            children: [
              Text(
                'Active Projects',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
              ),
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
              ? _EmptyPanelState(
                  icon: Icons.inbox_outlined,
                  title: _showCompleted
                      ? 'No active projects yet'
                      : 'No incomplete active projects',
                  message: _showCompleted
                      ? 'All project instances are currently filtered out or finished.'
                      : 'Turn on completed items if you want to inspect finished work.',
                )
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                  itemCount: visibleInstances.length,
                  itemBuilder: (ctx, i) => _InstanceCard(
                    instance: visibleInstances[i],
                    onRefresh: widget.onRefresh,
                    onUpdateStep: widget.onUpdateStep,
                    onDeleteInstance: widget.onDeleteInstance,
                    showCompleted: _showCompleted,
                    templateName:
                        widget.templateNames[visibleInstances[i].templateId],
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
    required this.onRefresh,
    required this.onUpdateStep,
    required this.onDeleteInstance,
    required this.showCompleted,
    this.templateName,
  });
  final ProjectInstance instance;
  final VoidCallback onRefresh;
  final Future<void> Function(ProjectInstanceStep step,
      {String? title,
      String? dueDate,
      String? status,
      String? notes,
      int? assigneeId}) onUpdateStep;
  final Future<void> Function(String instanceId) onDeleteInstance;
  final bool showCompleted;
  final String? templateName;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final canReassign =
        AuthSessionService.instance.currentUser?.id == instance.ownerId;
    final visibleSteps = showCompleted
        ? instance.steps
        : instance.steps.where((step) => step.status != 'done').toList();
    final title = instance.name?.trim().isNotEmpty == true
        ? instance.name!
        : 'Anchor: ${DateFormatters.fullDate(instance.anchorDate, fallback: instance.anchorDate)}';
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 0,
      color: colorScheme.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: colorScheme.outlineVariant),
      ),
      child: ExpansionTile(
        tilePadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        childrenPadding: const EdgeInsets.fromLTRB(8, 0, 8, 10),
        title: Text(
          title,
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w600,
              ),
        ),
        subtitle: Text(
          '${templateName?.isNotEmpty == true ? '${templateName!} · ' : ''}Anchor ${DateFormatters.fullDate(instance.anchorDate, fallback: instance.anchorDate)} · ${visibleSteps.length} visible · ${instance.steps.length} total · ${instance.status}',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: colorScheme.onSurfaceVariant,
              ),
        ),
        trailing: IconButton(
          icon: const Icon(Icons.delete_outline, size: 18),
          tooltip: 'Delete active project',
          onPressed: () => onDeleteInstance(instance.id),
        ),
        children: [
          if (instance.ownerId != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 4),
              child: CollaboratorsRow(
                collaborators: instance.collaborators,
                ownerId: instance.ownerId!,
                workspaceMembers: context.read<WorkspaceController>().members,
                onAdd: (userId) async {
                  final ds = CollaboratorsDataSource();
                  await ds.addToProject(instance.id, userId);
                  onRefresh();
                },
                onRemove: (userId) async {
                  final ds = CollaboratorsDataSource();
                  await ds.removeFromProject(instance.id, userId);
                  onRefresh();
                },
              ),
            ),
          ...visibleSteps.map((step) => _InstanceStepTile(
                step: step,
                onUpdateStep: onUpdateStep,
                canReassign: canReassign,
              )),
        ],
      ),
    );
  }
}

class _InstanceStepTile extends StatelessWidget {
  const _InstanceStepTile({
    required this.step,
    required this.onUpdateStep,
    required this.canReassign,
  });
  final ProjectInstanceStep step;
  final Future<void> Function(ProjectInstanceStep step,
      {String? title,
      String? dueDate,
      String? status,
      String? notes,
      int? assigneeId}) onUpdateStep;
  final bool canReassign;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final isDone = step.status == 'done';
    return Container(
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colorScheme.outlineVariant),
      ),
      child: ListTile(
        leading: Checkbox(
          value: isDone,
          onChanged: (_) => onUpdateStep(
            step,
            status: isDone ? 'open' : 'done',
            assigneeId: step.assigneeId,
          ),
          visualDensity: VisualDensity.compact,
          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        ),
        title: Text(
          step.title,
          style: TextStyle(
            decoration: isDone ? TextDecoration.lineThrough : null,
            color: isDone ? colorScheme.onSurfaceVariant : null,
            fontWeight: FontWeight.w500,
          ),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Due: ${DateFormatters.fullDate(step.dueDate, fallback: step.dueDate)}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
            ),
            Text(
              'Assignee: ${step.assigneeName ?? 'Unassigned'}',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colorScheme.onSurfaceVariant,
                  ),
            ),
            if (step.notes != null && step.notes!.isNotEmpty)
              Text(
                step.notes!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: colorScheme.onSurfaceVariant,
                    ),
              ),
          ],
        ),
        trailing: IconButton(
          icon: const Icon(Icons.edit_outlined, size: 16),
          onPressed: () => showDialog<void>(
            context: context,
            builder: (_) => _EditInstanceStepDialog(
              step: step,
              onSave: onUpdateStep,
              canEditAssignee: canReassign,
            ),
          ),
        ),
      ),
    );
  }
}

class _EditInstanceStepDialog extends StatefulWidget {
  const _EditInstanceStepDialog({
    required this.step,
    required this.onSave,
    required this.canEditAssignee,
  });
  final ProjectInstanceStep step;
  final Future<void> Function(ProjectInstanceStep step,
      {String? title,
      String? dueDate,
      String? status,
      String? notes,
      int? assigneeId}) onSave;
  final bool canEditAssignee;

  @override
  State<_EditInstanceStepDialog> createState() =>
      _EditInstanceStepDialogState();
}

class _EditInstanceStepDialogState extends State<_EditInstanceStepDialog> {
  late final TextEditingController _titleCtrl;
  late final TextEditingController _dueDateCtrl;
  late final TextEditingController _notesCtrl;
  int? _assigneeId;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _titleCtrl = TextEditingController(text: widget.step.title);
    _dueDateCtrl = TextEditingController(text: widget.step.dueDate);
    _notesCtrl = TextEditingController(text: widget.step.notes ?? '');
    _assigneeId = widget.step.assigneeId;
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
            if (widget.canEditAssignee) ...[
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Assignee',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ),
              const SizedBox(height: 6),
              Container(
                width: double.infinity,
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  border: Border.all(
                    color: Theme.of(context).colorScheme.outlineVariant,
                  ),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Builder(
                  builder: (context) {
                    final members =
                        context.watch<WorkspaceController>().members;
                    final selectedId = _assigneeId != null &&
                            members.any((m) => m.userId == _assigneeId)
                        ? _assigneeId
                        : null;
                    return WorkspaceMemberPicker(
                      workspaceMembers: members,
                      selectedUserId: selectedId,
                      onChanged: (value) => setState(() => _assigneeId = value),
                    );
                  },
                ),
              ),
              const SizedBox(height: 12),
            ] else ...[
              Text(
                'Assignee: ${widget.step.assigneeName ?? 'Unassigned'}',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
              ),
              const SizedBox(height: 12),
            ],
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
      assigneeId: _assigneeId,
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
    final colorScheme = Theme.of(context).colorScheme;
    final offsetLabel = step.offsetDescription ??
        (step.offsetDays == 0
            ? 'On anchor date'
            : step.offsetDays > 0
                ? '+${step.offsetDays} days'
                : '${step.offsetDays} days');

    return Card(
      elevation: 0,
      color: colorScheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: colorScheme.outlineVariant),
      ),
      child: ListTile(
        leading: CircleAvatar(
          radius: 14,
          backgroundColor: colorScheme.primaryContainer,
          child: Text(
            step.sortOrder.toString(),
            style:
                TextStyle(fontSize: 12, color: colorScheme.onPrimaryContainer),
          ),
        ),
        title: Text(
          step.title,
          style: const TextStyle(fontWeight: FontWeight.w500),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              offsetLabel,
              style: TextStyle(color: colorScheme.onSurfaceVariant),
            ),
            if (step.assigneeName != null)
              Text(
                'Assignee: ${step.assigneeName}',
                style: TextStyle(color: colorScheme.onSurfaceVariant),
              ),
          ],
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Offset: ${step.offsetDays}d',
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colorScheme.onSurfaceVariant)),
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
  int? _assigneeId;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.step.title);
    _offsetController =
        TextEditingController(text: widget.step.offsetDays.toString());
    _descController =
        TextEditingController(text: widget.step.offsetDescription ?? '');
    _assigneeId = widget.step.assigneeId;
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
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'Assignee',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ),
            const SizedBox(height: 6),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                border: Border.all(
                  color: Theme.of(context).colorScheme.outlineVariant,
                ),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Builder(
                builder: (context) {
                  final members = context.watch<WorkspaceController>().members;
                  final selectedId = _assigneeId != null &&
                          members.any((m) => m.userId == _assigneeId)
                      ? _assigneeId
                      : null;
                  return WorkspaceMemberPicker(
                    workspaceMembers: members,
                    selectedUserId: selectedId,
                    onChanged: (value) => setState(() => _assigneeId = value),
                  );
                },
              ),
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
      assigneeId: _assigneeId,
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
  int? _assigneeId;
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
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'Assignee',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ),
            const SizedBox(height: 6),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                border: Border.all(
                  color: Theme.of(context).colorScheme.outlineVariant,
                ),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Builder(
                builder: (context) {
                  final members = context.watch<WorkspaceController>().members;
                  final selectedId = _assigneeId != null &&
                          members.any((m) => m.userId == _assigneeId)
                      ? _assigneeId
                      : null;
                  return WorkspaceMemberPicker(
                    workspaceMembers: members,
                    selectedUserId: selectedId,
                    onChanged: (value) => setState(() => _assigneeId = value),
                  );
                },
              ),
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
      assigneeId: _assigneeId,
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
            '${context.read<ServerConfigService>().url}/project-templates/${widget.template.id}/generate'),
        headers: AuthSessionStore.headers(json: true),
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
        : DateFormatters.fullDateFromDateTime(anchorDate!);

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Give this project run a unique name if you want to use the same template more than once.',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
                height: 1.4,
              ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: nameController,
          decoration: const InputDecoration(
            labelText: 'Instance name (optional)',
            hintText: 'Christmas Eve Service',
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
            final ds = DateFormatters.fullDateFromDateTime(d);
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
        Text(
            'Anchor: ${DateFormatters.fullDate(instance.anchorDate, fallback: instance.anchorDate)}',
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
                  Text(DateFormatters.fullDate(s.dueDate, fallback: s.dueDate),
                      style: const TextStyle(color: Colors.grey, fontSize: 11)),
                ],
              ),
            )),
      ],
    );
  }
}
