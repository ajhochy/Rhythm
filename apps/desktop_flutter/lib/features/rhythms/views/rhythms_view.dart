import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../../app/core/widgets/error_banner.dart';
import '../../../app/core/workspace/workspace_controller.dart';
import '../../../app/core/ui/rhythm_dialog.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/rhythms_controller.dart';
import '../data/rhythms_data_source.dart';
import '../../../features/tasks/models/recurring_task_rule.dart';
import '../../../shared/widgets/workspace_member_picker.dart';

class RhythmsView extends StatefulWidget {
  const RhythmsView({super.key});

  @override
  State<RhythmsView> createState() => _RhythmsViewState();
}

class _RhythmsViewState extends State<RhythmsView> {
  final RhythmsDataSource _dataSource = RhythmsDataSource();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<RhythmsController>().load();
      context.read<WorkspaceController>().loadMembers();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<RhythmsController>(
      builder: (context, controller, _) {
        return Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                context.rhythm.canvas,
                const Color(0xFFF7F4EF),
                context.rhythm.accentMuted,
              ],
              stops: const [0.0, 0.55, 1.0],
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: context.rhythm.surfaceRaised,
                borderRadius: BorderRadius.circular(RhythmRadius.xl),
                border: Border.all(color: context.rhythm.borderSubtle),
                boxShadow: RhythmElevation.panel,
              ),
              child: Column(
                children: [
                  _Header(onAdd: () => _showCreateDialog(context, controller)),
                  if (controller.status == RhythmsStatus.error &&
                      controller.errorMessage != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                      child: ErrorBanner(
                        message: controller.errorMessage!,
                        onRetry: controller.load,
                      ),
                    ),
                  Expanded(
                    child: _RulesList(
                      controller: controller,
                      dataSource: _dataSource,
                      onCreate: () => _showCreateDialog(context, controller),
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

  Future<void> _showCreateDialog(
    BuildContext context,
    RhythmsController controller,
  ) async {
    await showDialog<void>(
      context: context,
      builder: (_) => _CreateRuleDialog(controller: controller),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.onAdd});
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised,
        border: Border(
          bottom: BorderSide(color: context.rhythm.borderSubtle),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Rhythms',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: context.rhythm.textPrimary,
                    letterSpacing: -0.3,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Recurring rules that quietly keep the workspace moving.',
                  style: TextStyle(
                      fontSize: 12, color: context.rhythm.textSecondary),
                ),
              ],
            ),
          ),
          const SizedBox(width: 16),
          FilledButton.tonalIcon(
            onPressed: onAdd,
            style: FilledButton.styleFrom(
              backgroundColor: context.rhythm.accentMuted,
              foregroundColor: context.rhythm.accent,
              elevation: 0,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.md),
              ),
            ),
            icon: const Icon(Icons.add, size: 18),
            label: const Text(
              'New rule',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

class _RulesList extends StatelessWidget {
  const _RulesList({
    required this.controller,
    required this.dataSource,
    required this.onCreate,
  });
  final RhythmsController controller;
  final RhythmsDataSource dataSource;
  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    if (controller.status == RhythmsStatus.loading &&
        controller.rules.isEmpty) {
      return Center(
        child: CircularProgressIndicator(color: context.rhythm.accent),
      );
    }
    if (controller.rules.isEmpty) {
      return Center(child: _EmptyState(onCreate: onCreate));
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
      itemCount: controller.rules.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (context, i) => _RuleTile(
        rule: controller.rules[i],
        controller: controller,
        dataSource: dataSource,
        onDelete: () => controller.deleteRule(controller.rules[i].id),
      ),
    );
  }
}

class _RuleTile extends StatelessWidget {
  const _RuleTile({
    required this.rule,
    required this.onDelete,
    required this.controller,
    required this.dataSource,
  });
  final RecurringTaskRule rule;
  final VoidCallback onDelete;
  final RhythmsController controller;
  final RhythmsDataSource dataSource;

  @override
  Widget build(BuildContext context) {
    final dimmed = !rule.enabled;

    return Card(
      elevation: 0,
      color: context.rhythm.surfaceRaised,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        side: BorderSide(color: context.rhythm.borderSubtle),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: dimmed
                    ? context.rhythm.surfaceMuted
                    : context.rhythm.accentMuted,
                borderRadius: BorderRadius.circular(RhythmRadius.md),
                border: Border.all(color: context.rhythm.borderSubtle),
              ),
              child: Icon(
                Icons.repeat,
                size: 18,
                color:
                    dimmed ? context.rhythm.textMuted : context.rhythm.accent,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    rule.title,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          color: dimmed
                              ? context.rhythm.textMuted
                              : context.rhythm.textPrimary,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.2,
                        ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    rule.patternDescription,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: context.rhythm.textSecondary,
                        ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            Switch(
              value: rule.enabled,
              onChanged: (_) => controller.toggleEnabled(
                rule.id,
                enabled: !rule.enabled,
              ),
            ),
            IconButton(
              icon: const Icon(Icons.edit_outlined, size: 16),
              onPressed: () => _showEditDialog(context),
              tooltip: 'Edit rule',
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 16),
              onPressed: () => _confirmDelete(context),
              tooltip: 'Delete rule',
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showEditDialog(BuildContext context) async {
    await showDialog<void>(
      context: context,
      builder: (_) => _EditRuleDialog(rule: rule, controller: controller),
    );
  }

  Future<void> _confirmDelete(BuildContext context) async {
    final confirmed = await RhythmDialog.confirm(
      context,
      title: 'Delete Rule',
      message:
          'Delete "${rule.title}"? This will not remove already-generated tasks.',
      confirmLabel: 'Delete',
      destructive: true,
    );
    if (confirmed == true) onDelete();
  }
}

// ---------------------------------------------------------------------------
// Create Rule Dialog
// ---------------------------------------------------------------------------

class _StepEditorModel {
  _StepEditorModel({required this.id, String? title, this.assigneeId})
      : titleController = TextEditingController(text: title ?? '');

  final String id;
  final TextEditingController titleController;
  int? assigneeId;

  void dispose() => titleController.dispose();

  RecurringTaskRuleStep toStep() {
    return RecurringTaskRuleStep(
      id: id,
      title: titleController.text.trim(),
      assigneeId: assigneeId,
    );
  }
}

class _CreateRuleDialog extends StatefulWidget {
  const _CreateRuleDialog({required this.controller});
  final RhythmsController controller;

  @override
  State<_CreateRuleDialog> createState() => _CreateRuleDialogState();
}

class _CreateRuleDialogState extends State<_CreateRuleDialog> {
  final _titleController = TextEditingController();
  String _frequency = 'weekly';
  int _dayOfWeek = 1; // Monday
  int _dayOfMonth = 1;
  int _month = 1;
  bool _sequential = false;
  bool _saving = false;
  final List<_StepEditorModel> _steps = [];

  static const _weekdays = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  static const _months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  @override
  void dispose() {
    for (final step in _steps) {
      step.dispose();
    }
    _titleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('New Recurring Rule'),
      content: SizedBox(
        width: 620,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextField(
                controller: _titleController,
                decoration: const InputDecoration(
                  labelText: 'Title',
                  border: OutlineInputBorder(),
                ),
                autofocus: true,
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                value: _frequency,
                decoration: const InputDecoration(
                  labelText: 'Frequency',
                  border: OutlineInputBorder(),
                ),
                items: const [
                  DropdownMenuItem(value: 'weekly', child: Text('Weekly')),
                  DropdownMenuItem(value: 'monthly', child: Text('Monthly')),
                  DropdownMenuItem(value: 'annual', child: Text('Annual')),
                ],
                onChanged: (v) => setState(() => _frequency = v!),
              ),
              const SizedBox(height: 16),
              if (_frequency == 'weekly') ...[
                DropdownButtonFormField<int>(
                  value: _dayOfWeek,
                  decoration: const InputDecoration(
                    labelText: 'Day of Week',
                    border: OutlineInputBorder(),
                  ),
                  items: List.generate(
                    7,
                    (i) =>
                        DropdownMenuItem(value: i, child: Text(_weekdays[i])),
                  ),
                  onChanged: (v) => setState(() => _dayOfWeek = v!),
                ),
              ],
              if (_frequency == 'monthly') ...[
                _DayOfMonthField(
                  value: _dayOfMonth,
                  onChanged: (v) => setState(() => _dayOfMonth = v),
                ),
              ],
              if (_frequency == 'annual') ...[
                DropdownButtonFormField<int>(
                  value: _month,
                  decoration: const InputDecoration(
                    labelText: 'Month',
                    border: OutlineInputBorder(),
                  ),
                  items: List.generate(
                    12,
                    (i) =>
                        DropdownMenuItem(value: i + 1, child: Text(_months[i])),
                  ),
                  onChanged: (v) => setState(() => _month = v!),
                ),
                const SizedBox(height: 12),
                _DayOfMonthField(
                  value: _dayOfMonth,
                  onChanged: (v) => setState(() => _dayOfMonth = v),
                ),
              ],
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Workflow steps',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: context.rhythm.textPrimary,
                      ),
                    ),
                  ),
                  if (_steps.length > 1) ...[
                    Text(
                      'Sequential',
                      style: TextStyle(
                        fontSize: 12,
                        color: context.rhythm.textSecondary,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Switch(
                      value: _sequential,
                      onChanged: (v) => setState(() => _sequential = v),
                    ),
                    const SizedBox(width: 4),
                  ],
                  TextButton.icon(
                    onPressed: () {
                      setState(() {
                        _steps.add(
                          _StepEditorModel(id: _newStepId(_steps.length)),
                        );
                      });
                    },
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('Add step'),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                'Leave this empty to use the rhythm title as a single recurring task.',
                style: Theme.of(
                  context,
                )
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: context.rhythm.textMuted),
              ),
              const SizedBox(height: 12),
              if (_steps.isEmpty)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: context.rhythm.surfaceMuted,
                    borderRadius: BorderRadius.circular(RhythmRadius.md),
                    border: Border.all(color: context.rhythm.borderSubtle),
                  ),
                  child: Text(
                    'No steps yet. Add one if this rhythm needs multiple tasks or assignees.',
                    style: TextStyle(
                      color: context.rhythm.textMuted,
                      fontSize: 12,
                    ),
                  ),
                )
              else
                Column(
                  children: [
                    for (var i = 0; i < _steps.length; i++) ...[
                      _StepEditorRow(
                        step: _steps[i],
                        onAssigneeChanged: (value) =>
                            setState(() => _steps[i].assigneeId = value),
                        onRemove: () {
                          setState(() {
                            _steps[i].dispose();
                            _steps.removeAt(i);
                          });
                        },
                      ),
                      if (i != _steps.length - 1) const SizedBox(height: 10),
                    ],
                  ],
                ),
            ],
          ),
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
              : const Text('Create'),
        ),
      ],
    );
  }

  String _newStepId(int index) {
    return 'step-${DateTime.now().microsecondsSinceEpoch}-$index';
  }

  Future<void> _save() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;

    final steps = _steps
        .map((step) => step.toStep())
        .where((step) => step.title.trim().isNotEmpty)
        .toList();

    setState(() => _saving = true);
    await widget.controller.createRule(
      title: title,
      frequency: _frequency,
      dayOfWeek: _frequency == 'weekly' ? _dayOfWeek : null,
      dayOfMonth: (_frequency == 'monthly' || _frequency == 'annual')
          ? _dayOfMonth
          : null,
      month: _frequency == 'annual' ? _month : null,
      sequential: _sequential,
      steps: steps,
    );
    if (mounted) Navigator.pop(context);
  }
}

class _EditRuleDialog extends StatefulWidget {
  const _EditRuleDialog({required this.rule, required this.controller});
  final RecurringTaskRule rule;
  final RhythmsController controller;

  @override
  State<_EditRuleDialog> createState() => _EditRuleDialogState();
}

class _EditRuleDialogState extends State<_EditRuleDialog> {
  late final TextEditingController _titleController;
  late String _frequency;
  late int _dayOfWeek;
  late int _dayOfMonth;
  late int _month;
  late bool _sequential;
  bool _saving = false;
  final List<_StepEditorModel> _steps = [];

  static const _weekdays = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  static const _months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.rule.title);
    _frequency = widget.rule.frequency;
    _dayOfWeek = widget.rule.dayOfWeek ?? 1;
    _dayOfMonth = widget.rule.dayOfMonth ?? 1;
    _month = widget.rule.month ?? 1;
    _sequential = widget.rule.sequential;
    _steps.addAll(
      widget.rule.steps.map(
        (step) => _StepEditorModel(
          id: step.id,
          title: step.title,
          assigneeId: step.assigneeId,
        ),
      ),
    );
  }

  @override
  void dispose() {
    for (final step in _steps) {
      step.dispose();
    }
    _titleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit Rule'),
      content: SizedBox(
        width: 620,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextField(
                controller: _titleController,
                decoration: const InputDecoration(
                  labelText: 'Title',
                  border: OutlineInputBorder(),
                ),
                autofocus: true,
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                value: _frequency,
                decoration: const InputDecoration(
                  labelText: 'Frequency',
                  border: OutlineInputBorder(),
                ),
                items: const [
                  DropdownMenuItem(value: 'weekly', child: Text('Weekly')),
                  DropdownMenuItem(value: 'monthly', child: Text('Monthly')),
                  DropdownMenuItem(value: 'annual', child: Text('Annual')),
                ],
                onChanged: (v) => setState(() => _frequency = v!),
              ),
              const SizedBox(height: 16),
              if (_frequency == 'weekly')
                DropdownButtonFormField<int>(
                  value: _dayOfWeek,
                  decoration: const InputDecoration(
                    labelText: 'Day of Week',
                    border: OutlineInputBorder(),
                  ),
                  items: List.generate(
                    7,
                    (i) =>
                        DropdownMenuItem(value: i, child: Text(_weekdays[i])),
                  ),
                  onChanged: (v) => setState(() => _dayOfWeek = v!),
                ),
              if (_frequency == 'monthly')
                _DayOfMonthField(
                  value: _dayOfMonth,
                  onChanged: (v) => setState(() => _dayOfMonth = v),
                ),
              if (_frequency == 'annual') ...[
                DropdownButtonFormField<int>(
                  value: _month,
                  decoration: const InputDecoration(
                    labelText: 'Month',
                    border: OutlineInputBorder(),
                  ),
                  items: List.generate(
                    12,
                    (i) =>
                        DropdownMenuItem(value: i + 1, child: Text(_months[i])),
                  ),
                  onChanged: (v) => setState(() => _month = v!),
                ),
                const SizedBox(height: 12),
                _DayOfMonthField(
                  value: _dayOfMonth,
                  onChanged: (v) => setState(() => _dayOfMonth = v),
                ),
              ],
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Workflow steps',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: context.rhythm.textPrimary,
                      ),
                    ),
                  ),
                  if (_steps.length > 1) ...[
                    Text(
                      'Sequential',
                      style: TextStyle(
                        fontSize: 12,
                        color: context.rhythm.textSecondary,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Switch(
                      value: _sequential,
                      onChanged: (v) => setState(() => _sequential = v),
                    ),
                    const SizedBox(width: 4),
                  ],
                  TextButton.icon(
                    onPressed: () {
                      setState(() {
                        _steps.add(
                          _StepEditorModel(id: _newStepId(_steps.length)),
                        );
                      });
                    },
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('Add step'),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                'Leave this empty to keep the rhythm as a single task.',
                style: Theme.of(
                  context,
                )
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: context.rhythm.textMuted),
              ),
              const SizedBox(height: 12),
              if (_steps.isEmpty)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: context.rhythm.surfaceMuted,
                    borderRadius: BorderRadius.circular(RhythmRadius.md),
                    border: Border.all(color: context.rhythm.borderSubtle),
                  ),
                  child: Text(
                    'No steps yet. Add one if this rhythm needs multiple tasks or assignees.',
                    style: TextStyle(
                      color: context.rhythm.textMuted,
                      fontSize: 12,
                    ),
                  ),
                )
              else
                Column(
                  children: [
                    for (var i = 0; i < _steps.length; i++) ...[
                      _StepEditorRow(
                        step: _steps[i],
                        onAssigneeChanged: (value) =>
                            setState(() => _steps[i].assigneeId = value),
                        onRemove: () {
                          setState(() {
                            _steps[i].dispose();
                            _steps.removeAt(i);
                          });
                        },
                      ),
                      if (i != _steps.length - 1) const SizedBox(height: 10),
                    ],
                  ],
                ),
            ],
          ),
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

  String _newStepId(int index) {
    return 'step-${DateTime.now().microsecondsSinceEpoch}-$index';
  }

  Future<void> _save() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;
    final steps = _steps
        .map((step) => step.toStep())
        .where((step) => step.title.trim().isNotEmpty)
        .toList();
    setState(() => _saving = true);
    await widget.controller.updateRule(
      widget.rule.id,
      title: title,
      frequency: _frequency,
      dayOfWeek: _frequency == 'weekly' ? _dayOfWeek : null,
      dayOfMonth: (_frequency == 'monthly' || _frequency == 'annual')
          ? _dayOfMonth
          : null,
      month: _frequency == 'annual' ? _month : null,
      sequential: _sequential,
      steps: steps,
    );
    if (mounted) Navigator.pop(context);
  }
}

class _StepEditorRow extends StatelessWidget {
  const _StepEditorRow({
    required this.step,
    required this.onAssigneeChanged,
    required this.onRemove,
  });

  final _StepEditorModel step;
  final ValueChanged<int?> onAssigneeChanged;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Step',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: context.rhythm.textSecondary,
                  ),
                ),
              ),
              IconButton(
                onPressed: onRemove,
                icon: const Icon(Icons.delete_outline, size: 18),
                tooltip: 'Remove step',
              ),
            ],
          ),
          TextField(
            controller: step.titleController,
            decoration: const InputDecoration(
              labelText: 'Task title',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          WorkspaceMemberPicker(
            workspaceMembers: context.watch<WorkspaceController>().members,
            selectedUserId: step.assigneeId,
            onChanged: onAssigneeChanged,
          ),
        ],
      ),
    );
  }
}

class _DayOfMonthField extends StatelessWidget {
  const _DayOfMonthField({required this.value, required this.onChanged});
  final int value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      initialValue: value.toString(),
      decoration: const InputDecoration(
        labelText: 'Day of Month (1–31)',
        border: OutlineInputBorder(),
      ),
      keyboardType: TextInputType.number,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      onChanged: (v) {
        final n = int.tryParse(v);
        if (n != null && n >= 1 && n <= 31) onChanged(n);
      },
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onCreate});

  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 420),
      child: Container(
        padding: const EdgeInsets.all(28),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceMuted,
          borderRadius: BorderRadius.circular(RhythmRadius.xl),
          border: Border.all(color: context.rhythm.borderSubtle),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: context.rhythm.accentMuted,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: context.rhythm.borderSubtle),
              ),
              child: Icon(Icons.repeat, size: 28, color: context.rhythm.accent),
            ),
            const SizedBox(height: 18),
            Text(
              'No recurring rules yet',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    color: context.rhythm.textPrimary,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.2,
                  ),
            ),
            const SizedBox(height: 8),
            Text(
              'Create a rhythm for weekly work, monthly check-ins, or annual reminders. The list will stay quiet until you add one.',
              textAlign: TextAlign.center,
              style: Theme.of(
                context,
              )
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: context.rhythm.textSecondary),
            ),
            const SizedBox(height: 18),
            FilledButton.tonalIcon(
              onPressed: onCreate,
              style: FilledButton.styleFrom(
                backgroundColor: context.rhythm.accentMuted,
                foregroundColor: context.rhythm.accent,
                elevation: 0,
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                ),
              ),
              icon: const Icon(Icons.add, size: 18),
              label: const Text('New rule'),
            ),
          ],
        ),
      ),
    );
  }
}
