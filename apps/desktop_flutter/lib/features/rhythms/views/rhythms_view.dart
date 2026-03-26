import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../controllers/rhythms_controller.dart';
import '../../../features/tasks/models/recurring_task_rule.dart';
import '../../../features/tasks/services/recurrence_service.dart';

class RhythmsView extends StatefulWidget {
  const RhythmsView({super.key});

  @override
  State<RhythmsView> createState() => _RhythmsViewState();
}

class _RhythmsViewState extends State<RhythmsView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<RhythmsController>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<RhythmsController>(
      builder: (context, controller, _) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _Header(onAdd: () => _showCreateDialog(context, controller)),
            if (controller.status == RhythmsStatus.error && controller.errorMessage != null)
              _ErrorBanner(
                message: controller.errorMessage!,
                onRetry: controller.load,
              ),
            Expanded(child: _RulesList(controller: controller)),
          ],
        );
      },
    );
  }

  Future<void> _showCreateDialog(BuildContext context, RhythmsController controller) async {
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
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
      child: Row(
        children: [
          Text('Rhythms', style: Theme.of(context).textTheme.headlineSmall),
          const Spacer(),
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

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(24, 12, 24, 0),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.errorContainer,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, color: Theme.of(context).colorScheme.onErrorContainer),
          const SizedBox(width: 8),
          Expanded(
            child: Text(message, style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer)),
          ),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

class _RulesList extends StatelessWidget {
  const _RulesList({required this.controller});
  final RhythmsController controller;

  @override
  Widget build(BuildContext context) {
    if (controller.status == RhythmsStatus.loading && controller.rules.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (controller.rules.isEmpty) {
      return const Center(
        child: Text('No recurring rules yet. Create one to get started.'),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(24),
      itemCount: controller.rules.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (context, i) => _RuleTile(
        rule: controller.rules[i],
        controller: controller,
        onDelete: () => controller.deleteRule(controller.rules[i].id),
      ),
    );
  }
}

class _RuleTile extends StatefulWidget {
  const _RuleTile({required this.rule, required this.onDelete, required this.controller});
  final RecurringTaskRule rule;
  final VoidCallback onDelete;
  final RhythmsController controller;

  @override
  State<_RuleTile> createState() => _RuleTileState();
}

class _RuleTileState extends State<_RuleTile> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final preview = RecurrenceService()
        .previewNextDates(widget.rule, DateTime.now(), count: 3)
        .map((d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}')
        .join('  ·  ');

    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Column(
        children: [
          ListTile(
            leading: const Icon(Icons.repeat),
            title: Text(widget.rule.title),
            subtitle: Text(widget.rule.patternDescription),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  icon: Icon(_expanded ? Icons.expand_less : Icons.expand_more),
                  onPressed: () => setState(() => _expanded = !_expanded),
                  tooltip: 'Preview dates',
                ),
                IconButton(
                  icon: const Icon(Icons.edit_outlined),
                  onPressed: () => _showEditDialog(context),
                  tooltip: 'Edit rule',
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => _confirmDelete(context),
                  tooltip: 'Delete rule',
                ),
              ],
            ),
          ),
          if (_expanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Row(
                children: [
                  const Icon(Icons.calendar_today, size: 14, color: Colors.grey),
                  const SizedBox(width: 6),
                  Text('Next: $preview', style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _showEditDialog(BuildContext context) async {
    await showDialog<void>(
      context: context,
      builder: (_) => _EditRuleDialog(rule: widget.rule, controller: widget.controller),
    );
  }

  Future<void> _confirmDelete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Rule'),
        content: Text('Delete "${widget.rule.title}"? This will not remove already-generated tasks.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed == true) widget.onDelete();
  }
}

// ---------------------------------------------------------------------------
// Create Rule Dialog
// ---------------------------------------------------------------------------

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
  bool _saving = false;

  static const _weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  static const _months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

  @override
  void dispose() {
    _titleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('New Recurring Rule'),
      content: SizedBox(
        width: 400,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _titleController,
              decoration: const InputDecoration(labelText: 'Title', border: OutlineInputBorder()),
              autofocus: true,
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              value: _frequency,
              decoration: const InputDecoration(labelText: 'Frequency', border: OutlineInputBorder()),
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
                decoration: const InputDecoration(labelText: 'Day of Week', border: OutlineInputBorder()),
                items: List.generate(7, (i) => DropdownMenuItem(value: i, child: Text(_weekdays[i]))),
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
                decoration: const InputDecoration(labelText: 'Month', border: OutlineInputBorder()),
                items: List.generate(12, (i) => DropdownMenuItem(value: i + 1, child: Text(_months[i]))),
                onChanged: (v) => setState(() => _month = v!),
              ),
              const SizedBox(height: 12),
              _DayOfMonthField(
                value: _dayOfMonth,
                onChanged: (v) => setState(() => _dayOfMonth = v),
              ),
            ],
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
          child: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Create'),
        ),
      ],
    );
  }

  Future<void> _save() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;

    setState(() => _saving = true);
    await widget.controller.createRule(
      title: title,
      frequency: _frequency,
      dayOfWeek: _frequency == 'weekly' ? _dayOfWeek : null,
      dayOfMonth: (_frequency == 'monthly' || _frequency == 'annual') ? _dayOfMonth : null,
      month: _frequency == 'annual' ? _month : null,
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
  bool _saving = false;

  static const _weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  static const _months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.rule.title);
    _frequency = widget.rule.frequency;
    _dayOfWeek = widget.rule.dayOfWeek ?? 1;
    _dayOfMonth = widget.rule.dayOfMonth ?? 1;
    _month = widget.rule.month ?? 1;
  }

  @override
  void dispose() {
    _titleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit Rule'),
      content: SizedBox(
        width: 400,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _titleController,
              decoration: const InputDecoration(labelText: 'Title', border: OutlineInputBorder()),
              autofocus: true,
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              value: _frequency,
              decoration: const InputDecoration(labelText: 'Frequency', border: OutlineInputBorder()),
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
                decoration: const InputDecoration(labelText: 'Day of Week', border: OutlineInputBorder()),
                items: List.generate(7, (i) => DropdownMenuItem(value: i, child: Text(_weekdays[i]))),
                onChanged: (v) => setState(() => _dayOfWeek = v!),
              ),
            if (_frequency == 'monthly')
              _DayOfMonthField(value: _dayOfMonth, onChanged: (v) => setState(() => _dayOfMonth = v)),
            if (_frequency == 'annual') ...[
              DropdownButtonFormField<int>(
                value: _month,
                decoration: const InputDecoration(labelText: 'Month', border: OutlineInputBorder()),
                items: List.generate(12, (i) => DropdownMenuItem(value: i + 1, child: Text(_months[i]))),
                onChanged: (v) => setState(() => _month = v!),
              ),
              const SizedBox(height: 12),
              _DayOfMonthField(value: _dayOfMonth, onChanged: (v) => setState(() => _dayOfMonth = v)),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: _saving ? null : () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Save'),
        ),
      ],
    );
  }

  Future<void> _save() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;
    setState(() => _saving = true);
    await widget.controller.updateRule(
      widget.rule.id,
      title: title,
      frequency: _frequency,
      dayOfWeek: _frequency == 'weekly' ? _dayOfWeek : null,
      dayOfMonth: (_frequency == 'monthly' || _frequency == 'annual') ? _dayOfMonth : null,
      month: _frequency == 'annual' ? _month : null,
    );
    if (mounted) Navigator.pop(context);
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
      decoration: const InputDecoration(labelText: 'Day of Month (1–31)', border: OutlineInputBorder()),
      keyboardType: TextInputType.number,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      onChanged: (v) {
        final n = int.tryParse(v);
        if (n != null && n >= 1 && n <= 31) onChanged(n);
      },
    );
  }
}
