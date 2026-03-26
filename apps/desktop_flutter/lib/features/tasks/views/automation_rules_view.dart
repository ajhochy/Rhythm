import 'package:flutter/material.dart';
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
          backgroundColor: const Color(0xFFF8F9FA),
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

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('New Automation Rule'),
          content: SizedBox(
            width: 400,
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
                const Text('When…',
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
                  onChanged: (v) => setDialogState(
                      () => selectedTrigger = v ?? selectedTrigger),
                ),
                const SizedBox(height: 16),
                const Text('Then…',
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
                  onChanged: (v) => setDialogState(
                      () => selectedAction = v ?? selectedAction),
                ),
              ],
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
                Navigator.pop(dialogContext);
                await controller.createRule(
                  name: name,
                  triggerType: selectedTrigger,
                  actionType: selectedAction,
                );
              },
              child: const Text('Create'),
            ),
          ],
        ),
      ),
    );

    nameCtrl.dispose();
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
  });

  final AutomationRule rule;
  final VoidCallback onToggle;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: const BorderSide(color: Color(0xFFE5E7EB)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Switch(value: rule.enabled, onChanged: (_) => onToggle()),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(rule.name,
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: rule.enabled ? null : Colors.grey,
                      )),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      _Chip(
                        label: AutomationRule.triggerLabel(rule.triggerType),
                        color: const Color(0xFFEFF6FF),
                        textColor: const Color(0xFF1D4ED8),
                      ),
                      const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 6),
                        child: Icon(Icons.arrow_forward,
                            size: 14, color: Colors.grey),
                      ),
                      _Chip(
                        label: AutomationRule.actionLabel(rule.actionType),
                        color: const Color(0xFFF0FDF4),
                        textColor: const Color(0xFF15803D),
                      ),
                    ],
                  ),
                ],
              ),
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

class _Chip extends StatelessWidget {
  const _Chip(
      {required this.label, required this.color, required this.textColor});
  final String label;
  final Color color;
  final Color textColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(label, style: TextStyle(fontSize: 12, color: textColor)),
    );
  }
}
