import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../controllers/automation_rules_controller.dart';
import '../models/automation_rule.dart';
import '../../../app/core/widgets/error_banner.dart';

class AutomationRulesView extends StatefulWidget {
  const AutomationRulesView({super.key});

  @override
  State<AutomationRulesView> createState() => _AutomationRulesViewState();
}

class _AutomationRulesViewState extends State<AutomationRulesView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AutomationRulesController>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AutomationRulesController>(
      builder: (context, controller, _) {
        return Scaffold(
          backgroundColor: Theme.of(context).scaffoldBackgroundColor,
          body: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Header(onAdd: () => _showCreateDialog(context, controller)),
              if (controller.status == AutomationRulesStatus.error &&
                  controller.errorMessage != null)
                ErrorBanner(
                  message: controller.errorMessage!,
                  onRetry: controller.load,
                ),
              Expanded(
                child: controller.status == AutomationRulesStatus.loading &&
                        controller.rules.isEmpty
                    ? const Center(child: CircularProgressIndicator())
                    : controller.rules.isEmpty
                        ? _EmptyState(
                            onAdd: () => _showCreateDialog(context, controller))
                        : ListView.builder(
                            padding: const EdgeInsets.all(24),
                            itemCount: controller.rules.length,
                            itemBuilder: (context, i) => _RuleCard(
                              rule: controller.rules[i],
                              onToggle: () => controller
                                  .toggleEnabled(controller.rules[i].id),
                              onDelete: () =>
                                  controller.deleteRule(controller.rules[i].id),
                              onEdit: () => _showEditDialog(
                                  context, controller, controller.rules[i]),
                            ),
                          ),
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _showCreateDialog(
      BuildContext context, AutomationRulesController controller) async {
    final nameCtrl = TextEditingController();
    String selectedTrigger = AutomationRule.triggerTypes.first;
    String selectedAction = AutomationRule.actionTypes.first;
    final triggerConfigCtrls = <String, TextEditingController>{};
    final actionConfigCtrls = <String, TextEditingController>{};
    int? daysBeforeDue;
    int? targetDay;

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('New Automation Rule'),
          content: SizedBox(
            width: 420,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    controller: nameCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Rule name',
                      border: OutlineInputBorder(),
                    ),
                    autofocus: true,
                  ),
                  const SizedBox(height: 16),
                  const Text('When\u2026',
                      style: TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    value: selectedTrigger,
                    decoration:
                        const InputDecoration(border: OutlineInputBorder()),
                    items: AutomationRule.triggerTypes
                        .map((t) => DropdownMenuItem(
                              value: t,
                              child: Text(AutomationRule.triggerLabel(t)),
                            ))
                        .toList(),
                    onChanged: (v) => setDialogState(() {
                      selectedTrigger = v ?? selectedTrigger;
                      daysBeforeDue = null;
                      triggerConfigCtrls.forEach((_, c) => c.dispose());
                      triggerConfigCtrls.clear();
                    }),
                  ),
                  ..._buildTriggerConfigFields(
                    selectedTrigger,
                    triggerConfigCtrls,
                    daysBeforeDue,
                    (v) => setDialogState(() => daysBeforeDue = v),
                    setDialogState,
                  ),
                  const SizedBox(height: 16),
                  const Text('Then\u2026',
                      style: TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    value: selectedAction,
                    decoration:
                        const InputDecoration(border: OutlineInputBorder()),
                    items: AutomationRule.actionTypes
                        .map((a) => DropdownMenuItem(
                              value: a,
                              child: Text(AutomationRule.actionLabel(a)),
                            ))
                        .toList(),
                    onChanged: (v) => setDialogState(() {
                      selectedAction = v ?? selectedAction;
                      targetDay = null;
                      actionConfigCtrls.forEach((_, c) => c.dispose());
                      actionConfigCtrls.clear();
                    }),
                  ),
                  ..._buildActionConfigFields(
                    selectedAction,
                    actionConfigCtrls,
                    targetDay,
                    (v) => setDialogState(() => targetDay = v),
                    setDialogState,
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () async {
                final name = nameCtrl.text.trim();
                if (name.isEmpty) return;
                final triggerConfig = _buildTriggerConfig(
                    selectedTrigger, triggerConfigCtrls, daysBeforeDue);
                final actionConfig = _buildActionConfig(
                    selectedAction, actionConfigCtrls, targetDay);
                Navigator.pop(dialogContext);
                await controller.createRule(
                  name: name,
                  triggerType: selectedTrigger,
                  actionType: selectedAction,
                  triggerConfig: triggerConfig.isEmpty ? null : triggerConfig,
                  actionConfig: actionConfig.isEmpty ? null : actionConfig,
                );
              },
              child: const Text('Create'),
            ),
          ],
        ),
      ),
    );

    nameCtrl.dispose();
    triggerConfigCtrls.forEach((_, c) => c.dispose());
    actionConfigCtrls.forEach((_, c) => c.dispose());
  }

  Future<void> _showEditDialog(BuildContext context,
      AutomationRulesController controller, AutomationRule rule) async {
    final nameCtrl = TextEditingController(text: rule.name);
    String selectedTrigger = rule.triggerType;
    String selectedAction = rule.actionType;
    final triggerConfigCtrls = <String, TextEditingController>{};
    final actionConfigCtrls = <String, TextEditingController>{};

    // Pre-populate config values from the existing rule
    int? daysBeforeDue =
        (rule.triggerConfig?['daysBeforeDue'] as num?)?.toInt();
    int? targetDay = (rule.actionConfig?['targetDay'] as num?)?.toInt();

    // Pre-populate text controllers for action config
    if (rule.actionConfig?['message'] != null) {
      actionConfigCtrls['message'] =
          TextEditingController(text: rule.actionConfig!['message'] as String);
    }
    if (rule.actionConfig?['tag'] != null) {
      actionConfigCtrls['tag'] =
          TextEditingController(text: rule.actionConfig!['tag'] as String);
    }

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Edit Automation Rule'),
          content: SizedBox(
            width: 420,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    controller: nameCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Rule name',
                      border: OutlineInputBorder(),
                    ),
                    autofocus: true,
                  ),
                  const SizedBox(height: 16),
                  const Text('When\u2026',
                      style: TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    value: selectedTrigger,
                    decoration:
                        const InputDecoration(border: OutlineInputBorder()),
                    items: AutomationRule.triggerTypes
                        .map((t) => DropdownMenuItem(
                              value: t,
                              child: Text(AutomationRule.triggerLabel(t)),
                            ))
                        .toList(),
                    onChanged: (v) => setDialogState(() {
                      selectedTrigger = v ?? selectedTrigger;
                      daysBeforeDue = null;
                      triggerConfigCtrls.forEach((_, c) => c.dispose());
                      triggerConfigCtrls.clear();
                    }),
                  ),
                  ..._buildTriggerConfigFields(
                    selectedTrigger,
                    triggerConfigCtrls,
                    daysBeforeDue,
                    (v) => setDialogState(() => daysBeforeDue = v),
                    setDialogState,
                  ),
                  const SizedBox(height: 16),
                  const Text('Then\u2026',
                      style: TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    value: selectedAction,
                    decoration:
                        const InputDecoration(border: OutlineInputBorder()),
                    items: AutomationRule.actionTypes
                        .map((a) => DropdownMenuItem(
                              value: a,
                              child: Text(AutomationRule.actionLabel(a)),
                            ))
                        .toList(),
                    onChanged: (v) => setDialogState(() {
                      selectedAction = v ?? selectedAction;
                      targetDay = null;
                      actionConfigCtrls.forEach((_, c) => c.dispose());
                      actionConfigCtrls.clear();
                    }),
                  ),
                  ..._buildActionConfigFields(
                    selectedAction,
                    actionConfigCtrls,
                    targetDay,
                    (v) => setDialogState(() => targetDay = v),
                    setDialogState,
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () async {
                final name = nameCtrl.text.trim();
                if (name.isEmpty) return;
                final triggerConfig = _buildTriggerConfig(
                    selectedTrigger, triggerConfigCtrls, daysBeforeDue);
                final actionConfig = _buildActionConfig(
                    selectedAction, actionConfigCtrls, targetDay);
                Navigator.pop(dialogContext);
                await controller.updateRule(
                  rule.id,
                  name: name,
                  triggerType: selectedTrigger,
                  actionType: selectedAction,
                  triggerConfig: triggerConfig.isEmpty ? null : triggerConfig,
                  actionConfig: actionConfig.isEmpty ? null : actionConfig,
                );
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );

    nameCtrl.dispose();
    triggerConfigCtrls.forEach((_, c) => c.dispose());
    actionConfigCtrls.forEach((_, c) => c.dispose());
  }

  /// Returns config fields widgets for the chosen trigger type.
  List<Widget> _buildTriggerConfigFields(
    String triggerType,
    Map<String, TextEditingController> ctrls,
    int? daysBeforeDue,
    ValueChanged<int?> onDaysChanged,
    StateSetter setDialogState,
  ) {
    switch (triggerType) {
      case 'task_due':
      case 'project_step_due':
        return [
          const SizedBox(height: 12),
          _IntegerField(
            label: 'Days before due date',
            value: daysBeforeDue,
            onChanged: onDaysChanged,
          ),
        ];
      default:
        return [];
    }
  }

  /// Returns config fields widgets for the chosen action type.
  List<Widget> _buildActionConfigFields(
    String actionType,
    Map<String, TextEditingController> ctrls,
    int? targetDay,
    ValueChanged<int?> onDayChanged,
    StateSetter setDialogState,
  ) {
    switch (actionType) {
      case 'auto_schedule':
        return [
          const SizedBox(height: 12),
          DropdownButtonFormField<int>(
            value: targetDay,
            decoration: const InputDecoration(
              labelText: 'Schedule to day',
              border: OutlineInputBorder(),
            ),
            items: const [
              DropdownMenuItem(value: 0, child: Text('Sunday')),
              DropdownMenuItem(value: 1, child: Text('Monday')),
              DropdownMenuItem(value: 2, child: Text('Tuesday')),
              DropdownMenuItem(value: 3, child: Text('Wednesday')),
              DropdownMenuItem(value: 4, child: Text('Thursday')),
              DropdownMenuItem(value: 5, child: Text('Friday')),
              DropdownMenuItem(value: 6, child: Text('Saturday')),
            ],
            onChanged: (v) => setDialogState(() => onDayChanged(v)),
          ),
        ];
      case 'send_notification':
        ctrls.putIfAbsent('message', () => TextEditingController());
        return [
          const SizedBox(height: 12),
          TextField(
            controller: ctrls['message'],
            decoration: const InputDecoration(
              labelText: 'Notification message (optional)',
              border: OutlineInputBorder(),
            ),
          ),
        ];
      case 'tag_task':
        ctrls.putIfAbsent('tag', () => TextEditingController());
        return [
          const SizedBox(height: 12),
          TextField(
            controller: ctrls['tag'],
            decoration: const InputDecoration(
              labelText: 'Tag name',
              border: OutlineInputBorder(),
            ),
          ),
        ];
      default:
        return [];
    }
  }

  Map<String, dynamic> _buildTriggerConfig(
    String triggerType,
    Map<String, TextEditingController> ctrls,
    int? daysBeforeDue,
  ) {
    switch (triggerType) {
      case 'task_due':
      case 'project_step_due':
        return {'daysBeforeDue': daysBeforeDue ?? 0};
      default:
        return {};
    }
  }

  Map<String, dynamic> _buildActionConfig(
    String actionType,
    Map<String, TextEditingController> ctrls,
    int? targetDay,
  ) {
    switch (actionType) {
      case 'auto_schedule':
        if (targetDay != null) return {'targetDay': targetDay};
        return {};
      case 'send_notification':
        final msg = ctrls['message']?.text.trim() ?? '';
        if (msg.isNotEmpty) return {'message': msg};
        return {};
      case 'tag_task':
        final tag = ctrls['tag']?.text.trim() ?? '';
        if (tag.isNotEmpty) return {'tag': tag};
        return {};
      default:
        return {};
    }
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.onAdd});
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: Color(0xFFE5E7EB))),
      ),
      child: Row(
        children: [
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Automations',
                    style:
                        TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                SizedBox(height: 2),
                Text('Rules that apply during weekly plan assembly',
                    style: TextStyle(color: Colors.black54, fontSize: 13)),
              ],
            ),
          ),
          FilledButton.icon(
            onPressed: onAdd,
            icon: const Icon(Icons.add, size: 18),
            label: const Text('New Rule'),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onAdd});
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.auto_awesome, size: 48, color: Colors.grey[400]),
          const SizedBox(height: 16),
          const Text('No automation rules yet',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
          const SizedBox(height: 8),
          Text('Rules run automatically during plan assembly',
              style: TextStyle(color: Colors.grey[600])),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: onAdd,
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Create your first rule'),
          ),
        ],
      ),
    );
  }
}

class _RuleCard extends StatelessWidget {
  const _RuleCard({
    required this.rule,
    required this.onToggle,
    required this.onDelete,
    required this.onEdit,
  });

  final AutomationRule rule;
  final VoidCallback onToggle;
  final VoidCallback onDelete;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final dimmed = !rule.enabled;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: const BorderSide(color: Color(0xFFE5E7EB)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Switch(value: rule.enabled, onChanged: (_) => onToggle()),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    rule.name,
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                      color: dimmed ? Colors.grey : null,
                    ),
                  ),
                  const SizedBox(height: 6),
                  _IfThenRow(rule: rule, dimmed: dimmed),
                ],
              ),
            ),
            const SizedBox(width: 8),
            IconButton(
              icon: const Icon(Icons.edit_outlined, size: 18),
              color: Colors.grey[600],
              onPressed: onEdit,
              tooltip: 'Edit rule',
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 18),
              color: Colors.grey,
              onPressed: onDelete,
              tooltip: 'Delete rule',
            ),
          ],
        ),
      ),
    );
  }
}

class _IfThenRow extends StatelessWidget {
  const _IfThenRow({required this.rule, required this.dimmed});

  final AutomationRule rule;
  final bool dimmed;

  @override
  Widget build(BuildContext context) {
    final baseTextStyle = TextStyle(
      fontSize: 13,
      color: dimmed ? Colors.grey[400] : Colors.black87,
    );
    final keywordStyle = baseTextStyle.copyWith(
      fontWeight: FontWeight.w600,
      color: dimmed ? Colors.grey[400] : Colors.black87,
    );
    final triggerStyle = baseTextStyle.copyWith(
      color: dimmed ? Colors.grey[400] : const Color(0xFF1D4ED8),
    );
    final actionStyle = baseTextStyle.copyWith(
      color: dimmed ? Colors.grey[400] : const Color(0xFF15803D),
    );

    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 4,
      children: [
        Text('When', style: keywordStyle),
        Text(AutomationRule.triggerLabel(rule.triggerType),
            style: triggerStyle),
        Icon(
          Icons.arrow_forward,
          size: 13,
          color: dimmed ? Colors.grey[400] : Colors.grey[600],
        ),
        Text(AutomationRule.actionLabel(rule.actionType), style: actionStyle),
      ],
    );
  }
}

/// A simple integer input field.
class _IntegerField extends StatefulWidget {
  const _IntegerField({
    required this.label,
    required this.value,
    required this.onChanged,
  });

  final String label;
  final int? value;
  final ValueChanged<int?> onChanged;

  @override
  State<_IntegerField> createState() => _IntegerFieldState();
}

class _IntegerFieldState extends State<_IntegerField> {
  late final TextEditingController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = TextEditingController(
        text: widget.value != null ? widget.value.toString() : '');
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _ctrl,
      keyboardType: TextInputType.number,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      decoration: InputDecoration(
        labelText: widget.label,
        border: const OutlineInputBorder(),
      ),
      onChanged: (v) {
        final parsed = int.tryParse(v);
        widget.onChanged(parsed);
      },
    );
  }
}
