import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/widgets/error_banner.dart';
import '../../../app/theme/rhythm_tokens.dart';
import '../../integrations/models/integration_account.dart';
import '../../integrations/models/planning_center_task_options.dart';
import '../controllers/automation_rules_controller.dart';
import '../data/automation_rules_data_source.dart';
import '../models/automation_catalog.dart';
import '../models/automation_rule.dart';

class AutomationRulesView extends StatefulWidget {
  const AutomationRulesView({super.key});

  @override
  State<AutomationRulesView> createState() => _AutomationRulesViewState();
}

class _AutomationRulesViewState extends State<AutomationRulesView> {
  static const List<String> _sourceOrder = [
    'rhythm',
    'planning_center',
    'google_calendar',
    'gmail',
  ];

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
        final grouped = <String, List<AutomationRule>>{};
        for (final rule in controller.rules) {
          grouped.putIfAbsent(rule.source, () => []).add(rule);
        }
        final orderedEntries = grouped.entries.toList()
          ..sort((a, b) {
            final left = _sourceOrder.indexOf(a.key);
            final right = _sourceOrder.indexOf(b.key);
            final leftIndex = left == -1 ? _sourceOrder.length : left;
            final rightIndex = right == -1 ? _sourceOrder.length : right;
            return leftIndex.compareTo(rightIndex);
          });

        return Scaffold(
          backgroundColor: RhythmTokens.background,
          body: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _OverviewHeader(
                ruleCount: controller.rules.length,
                providerCount: controller.accounts
                    .where((account) => account.connected)
                    .length,
                enabledCount: controller.rules
                    .where((rule) => rule.enabled)
                    .length,
                latestSync: _latestSync(controller.accounts),
                onCreate: () => _openBuilder(context, controller),
              ),
              if (controller.status == AutomationRulesStatus.error &&
                  controller.errorMessage != null)
                ErrorBanner(
                  message: controller.errorMessage!,
                  onRetry: controller.load,
                ),
              Expanded(
                child:
                    controller.status == AutomationRulesStatus.loading &&
                        controller.rules.isEmpty
                    ? const Center(child: CircularProgressIndicator())
                    : controller.rules.isEmpty
                    ? _EmptyState(
                        onCreate: () => _openBuilder(context, controller),
                      )
                    : ListView(
                        padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
                        children: orderedEntries
                            .map(
                              (entry) => _RuleGroup(
                                source: entry.key,
                                rules: entry.value,
                                controller: controller,
                              ),
                            )
                            .toList(),
                      ),
              ),
            ],
          ),
        );
      },
    );
  }

  String? _latestSync(List<IntegrationAccount> accounts) {
    final values =
        accounts
            .map((account) => account.lastSyncedAt)
            .whereType<String>()
            .toList()
          ..sort();
    return values.isEmpty ? null : values.last;
  }

  Future<void> _openBuilder(
    BuildContext context,
    AutomationRulesController controller, {
    AutomationRule? existing,
  }) async {
    final result = await showDialog<_AutomationDraft>(
      context: context,
      builder: (context) =>
          _AutomationBuilderDialog(controller: controller, existing: existing),
    );
    if (result == null) return;
    if (existing == null) {
      await controller.createRule(
        name: result.name,
        source: result.source,
        triggerKey: result.triggerKey,
        actionType: result.actionType,
        triggerConfig: result.triggerConfig,
        actionConfig: result.actionConfig,
        sourceAccountId: result.sourceAccountId,
        conditions: result.conditions,
      );
      return;
    }
    await controller.updateRule(
      existing.id,
      name: result.name,
      source: result.source,
      triggerKey: result.triggerKey,
      actionType: result.actionType,
      triggerConfig: result.triggerConfig,
      actionConfig: result.actionConfig,
      sourceAccountId: result.sourceAccountId,
      conditions: result.conditions,
    );
  }

  Future<void> _openPreview(
    BuildContext context,
    AutomationRulesController controller,
    AutomationRule rule,
  ) async {
    await controller.loadPreview(rule.id);
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (context) => _AutomationPreviewDialog(
        rule: rule,
        preview: controller.selectedPreview,
      ),
    );
  }
}

class _OverviewHeader extends StatelessWidget {
  const _OverviewHeader({
    required this.ruleCount,
    required this.providerCount,
    required this.enabledCount,
    required this.latestSync,
    required this.onCreate,
  });

  final int ruleCount;
  final int providerCount;
  final int enabledCount;
  final String? latestSync;
  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
      decoration: const BoxDecoration(
        color: RhythmTokens.surfaceStrong,
        border: Border(bottom: BorderSide(color: RhythmTokens.borderSoft)),
        boxShadow: RhythmTokens.shadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Automations',
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w700,
                        color: RhythmTokens.textPrimary,
                      ),
                    ),
                    SizedBox(height: 4),
                    Text(
                      'Create sync-driven automations from Planning Center, Calendar, Gmail, and Rhythm.',
                      style: TextStyle(color: RhythmTokens.textSecondary),
                    ),
                  ],
                ),
              ),
              FilledButton.icon(
                onPressed: onCreate,
                icon: const Icon(Icons.add, size: 18),
                label: const Text('New automation'),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              _StatCard(label: 'Rules', value: '$ruleCount'),
              _StatCard(label: 'Enabled', value: '$enabledCount'),
              _StatCard(label: 'Connected providers', value: '$providerCount'),
              _StatCard(
                label: 'Latest sync',
                value: latestSync == null
                    ? 'Never'
                    : latestSync!.replaceFirst('T', ' '),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 180,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: RhythmTokens.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
        border: Border.all(color: RhythmTokens.borderSoft),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(color: RhythmTokens.textSecondary),
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: RhythmTokens.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onCreate});

  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        constraints: const BoxConstraints(maxWidth: 520),
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 18),
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
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: RhythmTokens.accentSoft,
                borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
              ),
              child: const Icon(
                Icons.bolt_outlined,
                size: 20,
                color: RhythmTokens.accent,
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              'No automations yet',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: RhythmTokens.textPrimary,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Connect providers, sync data, and create rules from external metadata.',
              maxLines: 2,
              style: TextStyle(color: RhythmTokens.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: onCreate,
              icon: const Icon(Icons.add),
              label: const Text('Create automation'),
            ),
          ],
        ),
      ),
    );
  }
}

class _RuleGroup extends StatelessWidget {
  const _RuleGroup({
    required this.source,
    required this.rules,
    required this.controller,
  });

  final String source;
  final List<AutomationRule> rules;
  final AutomationRulesController controller;

  @override
  Widget build(BuildContext context) {
    final account = controller.accounts
        .where((item) => item.provider == source)
        .cast<IntegrationAccount?>()
        .firstOrNull;
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _labelForSource(source),
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: RhythmTokens.textPrimary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            account == null
                ? 'Internal Rhythm rules'
                : '${account.accountLabel ?? account.providerDisplayName ?? account.provider} · ${account.syncSupportMode ?? 'manual'} sync',
            style: const TextStyle(color: RhythmTokens.textSecondary),
          ),
          const SizedBox(height: 12),
          ...rules.map(
            (rule) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _RuleCard(
                rule: rule,
                account: account,
                trigger: controller.triggers
                    .where((item) => item.key == rule.triggerKey)
                    .firstOrNull,
                action: controller.actions
                    .where((item) => item.key == rule.actionType)
                    .firstOrNull,
                onEdit: () => context
                    .findAncestorStateOfType<_AutomationRulesViewState>()
                    ?._openBuilder(context, controller, existing: rule),
                onInspect: () => context
                    .findAncestorStateOfType<_AutomationRulesViewState>()
                    ?._openPreview(context, controller, rule),
                onResync: () {
                  unawaited(controller.resyncRule(rule.id));
                },
                resyncing: controller.isResyncing(rule.id),
                onDelete: () => controller.deleteRule(rule.id),
                onToggle: () => controller.toggleEnabled(rule.id),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _RuleCard extends StatelessWidget {
  const _RuleCard({
    required this.rule,
    required this.account,
    required this.trigger,
    required this.action,
    required this.onEdit,
    required this.onInspect,
    required this.onResync,
    required this.resyncing,
    required this.onDelete,
    required this.onToggle,
  });

  final AutomationRule rule;
  final IntegrationAccount? account;
  final AutomationTriggerCatalogItem? trigger;
  final AutomationActionCatalogItem? action;
  final VoidCallback onEdit;
  final VoidCallback onInspect;
  final VoidCallback onResync;
  final bool resyncing;
  final VoidCallback onDelete;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final accountLabel =
        account?.accountLabel ??
        account?.providerDisplayName ??
        _labelForSource(rule.source);
    return Card(
      elevation: 0,
      color: RhythmTokens.surfaceStrong,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
        side: const BorderSide(color: RhythmTokens.borderSoft),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
        onTap: onInspect,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Switch(value: rule.enabled, onChanged: (_) => onToggle()),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      rule.name,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: RhythmTokens.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      '${trigger?.label ?? rule.triggerKey} -> ${action?.label ?? rule.actionType}',
                      style: const TextStyle(color: RhythmTokens.accent),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 10,
                      runSpacing: 8,
                      children: [
                        _MetaChip(
                          icon: Icons.account_circle_outlined,
                          label: accountLabel,
                        ),
                        _MetaChip(
                          icon: Icons.sync,
                          label: account?.connected == true
                              ? 'Connected'
                              : rule.source == 'rhythm'
                              ? 'Internal'
                              : 'Disconnected',
                        ),
                        _MetaChip(
                          icon: Icons.bolt_outlined,
                          label: rule.lastMatchedAt == null
                              ? 'No recent matches'
                              : '${rule.matchCountLastRun} match(es)',
                        ),
                        _MetaChip(
                          icon: Icons.schedule_outlined,
                          label: rule.lastEvaluatedAt == null
                              ? 'Not evaluated yet'
                              : 'Evaluated ${_formatStamp(rule.lastEvaluatedAt!)}',
                        ),
                      ],
                    ),
                    if (rule.previewSample != null) ...[
                      const SizedBox(height: 10),
                      Text(
                        _previewLabel(rule.previewSample!),
                        style: const TextStyle(
                          color: RhythmTokens.textSecondary,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(right: 4),
                child: OutlinedButton.icon(
                  onPressed: resyncing ? null : onResync,
                  icon: resyncing
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.sync_outlined, size: 16),
                  label: Text(rule.source == 'rhythm' ? 'Trigger' : 'Resync'),
                  style: OutlinedButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                  ),
                ),
              ),
              IconButton(
                onPressed: onInspect,
                icon: const Icon(Icons.visibility_outlined),
              ),
              IconButton(
                onPressed: onEdit,
                icon: const Icon(Icons.edit_outlined),
              ),
              IconButton(
                onPressed: onDelete,
                icon: const Icon(Icons.delete_outline),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _previewLabel(Map<String, dynamic> preview) {
    return [
      preview['title'],
      preview['subject'],
      preview['serviceTypeName'],
      preview['positionName'],
    ].whereType<Object>().join(' · ');
  }
}

class _AutomationPreviewDialog extends StatelessWidget {
  const _AutomationPreviewDialog({required this.rule, required this.preview});

  final AutomationRule rule;
  final AutomationRulePreview? preview;

  @override
  Widget build(BuildContext context) {
    final summary =
        preview?.summary ??
        'No preview summary is available yet for this automation.';
    final sample = preview?.previewSample ?? rule.previewSample;
    return AlertDialog(
      title: Text(rule.name),
      content: SizedBox(
        width: 520,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(summary),
            const SizedBox(height: 16),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                _MetaChip(
                  icon: Icons.bolt_outlined,
                  label: preview?.matchCountLastRun == null
                      ? 'No recent run'
                      : '${preview!.matchCountLastRun} match(es) last run',
                ),
                _MetaChip(
                  icon: Icons.schedule_outlined,
                  label: preview?.lastEvaluatedAt == null
                      ? 'Never evaluated'
                      : 'Evaluated ${_formatStamp(preview!.lastEvaluatedAt!)}',
                ),
                _MetaChip(
                  icon: Icons.history_toggle_off,
                  label: preview?.lastMatchedAt == null
                      ? 'No recent match'
                      : 'Matched ${_formatStamp(preview!.lastMatchedAt!)}',
                ),
              ],
            ),
            if (sample != null) ...[
              const SizedBox(height: 16),
              const Text(
                'Latest sample',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: RhythmTokens.surfaceMuted,
                  borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
                  border: Border.all(color: RhythmTokens.borderSoft),
                ),
                child: Text(
                  sample.entries
                      .where((entry) => entry.value != null)
                      .map((entry) => '${entry.key}: ${entry.value}')
                      .join('\n'),
                ),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Close'),
        ),
      ],
    );
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: RhythmTokens.surfaceMuted,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: RhythmTokens.borderSoft),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: RhythmTokens.textSecondary),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              color: RhythmTokens.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

class _AutomationDraft {
  const _AutomationDraft({
    required this.name,
    required this.source,
    required this.triggerKey,
    required this.actionType,
    required this.triggerConfig,
    required this.actionConfig,
    this.sourceAccountId,
    this.conditions,
  });

  final String name;
  final String source;
  final String triggerKey;
  final String actionType;
  final Map<String, dynamic>? triggerConfig;
  final Map<String, dynamic>? actionConfig;
  final String? sourceAccountId;
  final List<AutomationCondition>? conditions;
}

class _AutomationBuilderDialog extends StatefulWidget {
  const _AutomationBuilderDialog({required this.controller, this.existing});

  final AutomationRulesController controller;
  final AutomationRule? existing;

  @override
  State<_AutomationBuilderDialog> createState() =>
      _AutomationBuilderDialogState();
}

class _AutomationBuilderDialogState extends State<_AutomationBuilderDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _textQueryController;
  late final TextEditingController _senderController;
  late final TextEditingController _subjectController;
  late final TextEditingController _titleTemplateController;
  late final TextEditingController _notesTemplateController;
  late final TextEditingController _messageTemplateController;
  late final TextEditingController _templateNameController;
  late final TextEditingController _tagController;
  String? _selectedSource;
  String? _selectedTriggerKey;
  String? _selectedActionType;
  String? _selectedAccountId;
  String? _selectedTeamId;
  String? _selectedPositionName;
  String? _selectedEventType;
  String? _selectedLabel;
  int? _leadDays;
  int? _dateWindowDays;
  int? _hoursSinceReceived;
  int? _targetDay;
  int? _daysBeforeDue;
  bool _allDayOnly = false;
  String? _validationError;
  late List<_ConditionDraft> _conditions;

  @override
  void initState() {
    super.initState();
    final existing = widget.existing;
    _nameController = TextEditingController(text: existing?.name ?? '');
    _textQueryController = TextEditingController(
      text: existing?.triggerConfig?['textQuery']?.toString() ?? '',
    );
    _senderController = TextEditingController(
      text: existing?.triggerConfig?['sender']?.toString() ?? '',
    );
    _subjectController = TextEditingController(
      text: existing?.triggerConfig?['subjectContains']?.toString() ?? '',
    );
    _titleTemplateController = TextEditingController(
      text: existing?.actionConfig?['titleTemplate']?.toString() ?? '',
    );
    _notesTemplateController = TextEditingController(
      text: existing?.actionConfig?['notesTemplate']?.toString() ?? '',
    );
    _messageTemplateController = TextEditingController(
      text: existing?.actionConfig?['messageTemplate']?.toString() ?? '',
    );
    _templateNameController = TextEditingController(
      text: existing?.actionConfig?['templateName']?.toString() ?? '',
    );
    _tagController = TextEditingController(
      text: existing?.actionConfig?['tag']?.toString() ?? '',
    );
    for (final controller in [
      _titleTemplateController,
      _notesTemplateController,
      _messageTemplateController,
    ]) {
      controller.addListener(() {
        if (mounted) setState(() {});
      });
    }
    _selectedSource =
        existing?.source ?? widget.controller.providers.firstOrNull?.source;
    _selectedTriggerKey = existing?.triggerKey;
    _selectedActionType =
        existing?.actionType ?? widget.controller.actions.firstOrNull?.key;
    _selectedAccountId = existing?.sourceAccountId;
    _selectedTeamId = existing?.triggerConfig?['teamId']?.toString();
    _selectedPositionName = existing?.triggerConfig?['positionName']
        ?.toString();
    _selectedEventType = existing?.triggerConfig?['eventType']?.toString();
    _selectedLabel = existing?.triggerConfig?['label']?.toString();
    _leadDays = (existing?.triggerConfig?['leadDays'] as num?)?.toInt();
    _dateWindowDays = (existing?.triggerConfig?['dateWindowDays'] as num?)
        ?.toInt();
    _hoursSinceReceived =
        (existing?.triggerConfig?['hoursSinceReceived'] as num?)?.toInt();
    _targetDay = (existing?.actionConfig?['targetDay'] as num?)?.toInt();
    _daysBeforeDue = (existing?.triggerConfig?['daysBeforeDue'] as num?)
        ?.toInt();
    _allDayOnly = existing?.triggerConfig?['allDayOnly'] == true;
    _conditions = (existing?.conditions ?? const [])
        .map(
          (c) => _ConditionDraft(
            field: c.field,
            operator: c.operator,
            value: TextEditingController(text: c.value),
          ),
        )
        .toList();
    _syncAccountSelectionWithSource();
    if (existing == null && _nameController.text.trim().isEmpty) {
      _nameController.text = _suggestedName();
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _textQueryController.dispose();
    _senderController.dispose();
    _subjectController.dispose();
    _titleTemplateController.dispose();
    _notesTemplateController.dispose();
    _messageTemplateController.dispose();
    _templateNameController.dispose();
    _tagController.dispose();
    for (final c in _conditions) {
      c.value.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final triggers = widget.controller.triggers
        .where((item) => item.source == _selectedSource)
        .toList();
    _selectedTriggerKey ??= triggers.firstOrNull?.key;
    _selectedActionType ??= widget.controller.actions.firstOrNull?.key;
    final trigger = triggers
        .where((item) => item.key == _selectedTriggerKey)
        .firstOrNull;

    return AlertDialog(
      title: Text(
        widget.existing == null ? 'New automation' : 'Edit automation',
      ),
      content: SizedBox(
        width: 620,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _stepTitle('1. Source'),
              TextField(
                controller: _nameController,
                decoration: const InputDecoration(
                  labelText: 'Automation name',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: _selectedSource,
                decoration: const InputDecoration(
                  labelText: 'Source',
                  border: OutlineInputBorder(),
                ),
                items: _availableProviders()
                    .map(
                      (item) => DropdownMenuItem(
                        value: item.source,
                        child: Text(item.label),
                      ),
                    )
                    .toList(),
                onChanged: (value) => setState(() {
                  _selectedSource = value;
                  _selectedTriggerKey = widget.controller.triggers
                      .where((item) => item.source == value)
                      .firstOrNull
                      ?.key;
                  _syncAccountSelectionWithSource();
                  _populateSuggestedNameIfEmpty();
                }),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String?>(
                value: _selectedAccountId,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Connected account',
                  border: OutlineInputBorder(),
                ),
                items: [
                  const DropdownMenuItem<String?>(
                    value: null,
                    child: Text('Use default/internal source'),
                  ),
                  ...widget.controller.accounts
                      .where((item) => item.provider == _selectedSource)
                      .map(
                        (item) => DropdownMenuItem<String?>(
                          value: item.id,
                          child: Text(
                            item.accountLabel ??
                                item.providerDisplayName ??
                                item.provider,
                          ),
                        ),
                      ),
                ],
                onChanged: (value) =>
                    setState(() => _selectedAccountId = value),
              ),
              if (_selectedSource != null && _validationError != null) ...[
                const SizedBox(height: 10),
                Text(
                  _validationError!,
                  style: const TextStyle(color: Colors.redAccent),
                ),
              ],
              const SizedBox(height: 18),
              _stepTitle('2. Trigger'),
              DropdownButtonFormField<String>(
                value: _selectedTriggerKey,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Trigger',
                  border: OutlineInputBorder(),
                ),
                items: triggers
                    .map(
                      (item) => DropdownMenuItem(
                        value: item.key,
                        child: Text(item.label),
                      ),
                    )
                    .toList(),
                onChanged: (value) => setState(() {
                  _selectedTriggerKey = value;
                  _populateSuggestedNameIfEmpty();
                }),
              ),
              if (trigger != null) ...[
                const SizedBox(height: 8),
                Text(
                  trigger.description,
                  style: const TextStyle(color: RhythmTokens.textSecondary),
                ),
                const SizedBox(height: 12),
                ..._buildTriggerFields(trigger),
              ],
              const SizedBox(height: 18),
              _stepTitle('3. Conditions (optional)'),
              ..._buildConditionsStep(),
              const SizedBox(height: 18),
              _stepTitle('4. Action'),
              DropdownButtonFormField<String>(
                value: _selectedActionType,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Action',
                  border: OutlineInputBorder(),
                ),
                items: widget.controller.actions
                    .map(
                      (item) => DropdownMenuItem(
                        value: item.key,
                        child: Text(item.label),
                      ),
                    )
                    .toList(),
                onChanged: (value) => setState(() {
                  _selectedActionType = value;
                  _populateSuggestedNameIfEmpty();
                }),
              ),
              const SizedBox(height: 12),
              ..._buildActionFields(),
              const SizedBox(height: 18),
              _stepTitle('5. Review'),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: RhythmTokens.surfaceMuted,
                  borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
                  border: Border.all(color: RhythmTokens.borderSoft),
                ),
                child: Text(_reviewSummary(trigger)),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () {
            final name = _nameController.text.trim().isEmpty
                ? _suggestedName()
                : _nameController.text.trim();
            final validationError = _validateDraft();
            setState(() => _validationError = validationError);
            if (_selectedSource == null ||
                _selectedTriggerKey == null ||
                _selectedActionType == null ||
                validationError != null) {
              return;
            }
            Navigator.pop(
              context,
              _AutomationDraft(
                name: name,
                source: _selectedSource!,
                triggerKey: _selectedTriggerKey!,
                actionType: _selectedActionType!,
                triggerConfig: _buildTriggerConfig(),
                actionConfig: _buildActionConfig(),
                sourceAccountId: _selectedAccountId,
                conditions: _buildConditions(),
              ),
            );
          },
          child: Text(widget.existing == null ? 'Create' : 'Save'),
        ),
      ],
    );
  }

  Widget _stepTitle(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Text(
      text,
      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
    ),
  );

  static const List<String> _conditionOperators = [
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'greater_than',
    'less_than',
  ];

  static String _operatorLabel(String op) => switch (op) {
    'equals' => 'equals',
    'not_equals' => 'does not equal',
    'contains' => 'contains',
    'not_contains' => 'does not contain',
    'greater_than' => 'greater than',
    'less_than' => 'less than',
    _ => op,
  };

  List<String> _conditionFields() {
    switch (_selectedSource) {
      case 'gmail':
        return ['subject', 'fromEmail', 'fromName', 'snippet', 'labelIds'];
      case 'google_calendar':
        return ['title', 'description', 'location', 'eventType'];
      case 'planning_center':
        return [
          'title',
          'serviceTypeName',
          'teamName',
          'positionName',
          'planDate',
        ];
      default:
        return ['title', 'notes'];
    }
  }

  List<Widget> _buildConditionsStep() {
    final fields = _conditionFields();
    return [
      if (_conditions.isEmpty)
        const Text(
          'No conditions — automation runs for every matched signal.',
          style: TextStyle(color: RhythmTokens.textSecondary),
        ),
      for (int i = 0; i < _conditions.length; i++) ...[
        if (i > 0) const SizedBox(height: 8),
        _buildConditionRow(i, fields),
      ],
      const SizedBox(height: 8),
      TextButton.icon(
        onPressed: () => setState(() {
          _conditions.add(
            _ConditionDraft(
              field: fields.first,
              operator: 'contains',
              value: TextEditingController(),
            ),
          );
        }),
        icon: const Icon(Icons.add, size: 16),
        label: const Text('Add condition'),
      ),
    ];
  }

  Widget _buildConditionRow(int index, List<String> fields) {
    final condition = _conditions[index];
    return Row(
      children: [
        Expanded(
          child: DropdownButtonFormField<String>(
            value: fields.contains(condition.field)
                ? condition.field
                : fields.first,
            decoration: const InputDecoration(
              labelText: 'Field',
              border: OutlineInputBorder(),
              isDense: true,
            ),
            items: fields
                .map((f) => DropdownMenuItem(value: f, child: Text(f)))
                .toList(),
            onChanged: (value) =>
                setState(() => condition.field = value ?? fields.first),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: DropdownButtonFormField<String>(
            value: condition.operator,
            decoration: const InputDecoration(
              labelText: 'Operator',
              border: OutlineInputBorder(),
              isDense: true,
            ),
            items: _conditionOperators
                .map(
                  (op) => DropdownMenuItem(
                    value: op,
                    child: Text(_operatorLabel(op)),
                  ),
                )
                .toList(),
            onChanged: (value) =>
                setState(() => condition.operator = value ?? 'contains'),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: TextField(
            controller: condition.value,
            decoration: const InputDecoration(
              labelText: 'Value',
              border: OutlineInputBorder(),
              isDense: true,
            ),
          ),
        ),
        IconButton(
          icon: const Icon(Icons.remove_circle_outline, size: 18),
          color: RhythmTokens.textSecondary,
          onPressed: () => setState(() {
            _conditions[index].value.dispose();
            _conditions.removeAt(index);
          }),
        ),
      ],
    );
  }

  List<AutomationCondition>? _buildConditions() {
    final result = _conditions
        .where((c) => c.value.text.trim().isNotEmpty)
        .map(
          (c) => AutomationCondition(
            field: c.field,
            operator: c.operator,
            value: c.value.text.trim(),
          ),
        )
        .toList();
    return result.isEmpty ? null : result;
  }

  List<Widget> _buildTriggerFields(AutomationTriggerCatalogItem trigger) {
    if (trigger.source == 'rhythm' &&
        (trigger.key == 'rhythm.task_due' ||
            trigger.key == 'rhythm.project_step_due')) {
      return [
        _IntegerDropdown(
          label: 'Days before due',
          value: _daysBeforeDue,
          options: const [0, 1, 2, 3, 5, 7, 14],
          onChanged: (value) => setState(() => _daysBeforeDue = value),
        ),
      ];
    }
    if (trigger.source == 'planning_center') {
      final options = widget.controller.planningCenterTaskOptions;
      return [
        if (options != null) ...[
          DropdownButtonFormField<String>(
            value: _selectedTeamId,
            decoration: const InputDecoration(
              labelText: 'Team',
              border: OutlineInputBorder(),
            ),
            items: [
              const DropdownMenuItem<String>(
                value: null,
                child: Text('Any team'),
              ),
              ...options.teams.map(
                (team) => DropdownMenuItem(
                  value: team.id,
                  child: Text('${team.serviceTypeName} · ${team.name}'),
                ),
              ),
            ],
            onChanged: (value) => setState(() => _selectedTeamId = value),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: _selectedPositionName,
            decoration: const InputDecoration(
              labelText: 'Position',
              border: OutlineInputBorder(),
            ),
            items: [
              const DropdownMenuItem<String>(
                value: null,
                child: Text('Any position'),
              ),
              ..._positionsForTeam(options, _selectedTeamId).map(
                (position) =>
                    DropdownMenuItem(value: position, child: Text(position)),
              ),
            ],
            onChanged: (value) => setState(() => _selectedPositionName = value),
          ),
          const SizedBox(height: 12),
        ],
        _IntegerDropdown(
          label: 'Lead-time window',
          value: _leadDays,
          options: const [3, 7, 14, 21, 30],
          onChanged: (value) => setState(() => _leadDays = value),
        ),
      ];
    }
    if (trigger.source == 'google_calendar') {
      return [
        TextField(
          controller: _textQueryController,
          decoration: const InputDecoration(
            labelText: 'Title / location / description contains',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          value: _selectedEventType,
          decoration: const InputDecoration(
            labelText: 'Event type',
            border: OutlineInputBorder(),
          ),
          items: const [
            DropdownMenuItem<String>(
              value: null,
              child: Text('Any event type'),
            ),
            DropdownMenuItem<String>(value: 'default', child: Text('Default')),
            DropdownMenuItem<String>(
              value: 'focusTime',
              child: Text('Focus time'),
            ),
            DropdownMenuItem<String>(
              value: 'outOfOffice',
              child: Text('Out of office'),
            ),
          ],
          onChanged: (value) => setState(() => _selectedEventType = value),
        ),
        const SizedBox(height: 12),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('All-day only'),
          value: _allDayOnly,
          onChanged: (value) => setState(() => _allDayOnly = value),
        ),
        _IntegerDropdown(
          label: 'Date window',
          value: _dateWindowDays,
          options: const [0, 1, 3, 7, 14, 30],
          onChanged: (value) => setState(() => _dateWindowDays = value),
        ),
      ];
    }
    if (trigger.source == 'gmail') {
      return [
        TextField(
          controller: _senderController,
          decoration: const InputDecoration(
            labelText: 'Sender contains',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _subjectController,
          decoration: const InputDecoration(
            labelText: 'Subject contains',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          value: _selectedLabel,
          decoration: const InputDecoration(
            labelText: 'Label',
            border: OutlineInputBorder(),
          ),
          items: [
            const DropdownMenuItem<String>(
              value: null,
              child: Text('Any label'),
            ),
            const DropdownMenuItem<String>(
              value: 'UNREAD',
              child: Text('Unread'),
            ),
            const DropdownMenuItem<String>(
              value: 'INBOX',
              child: Text('Inbox'),
            ),
            if (_selectedLabel != null &&
                _selectedLabel != 'UNREAD' &&
                _selectedLabel != 'INBOX' &&
                !widget.controller.gmailLabels.contains(_selectedLabel))
              DropdownMenuItem<String>(
                value: _selectedLabel,
                child: Text(_selectedLabel!),
              ),
            ...widget.controller.gmailLabels.map(
              (label) =>
                  DropdownMenuItem<String>(value: label, child: Text(label)),
            ),
          ],
          onChanged: (value) => setState(() => _selectedLabel = value),
        ),
        const SizedBox(height: 12),
        _IntegerDropdown(
          label: 'Received within last hours',
          value: _hoursSinceReceived,
          options: const [1, 6, 12, 24, 48, 72],
          onChanged: (value) => setState(() => _hoursSinceReceived = value),
        ),
      ];
    }
    return const [];
  }

  void _populateSuggestedNameIfEmpty() {
    if (widget.existing != null) return;
    if (_nameController.text.trim().isNotEmpty) return;
    _nameController.text = _suggestedName();
  }

  String _suggestedName() {
    return widget.controller.triggers
            .where((item) => item.key == _selectedTriggerKey)
            .firstOrNull
            ?.label ??
        _labelForSource(_selectedSource);
  }

  Map<String, dynamic>? get _previewSample => widget.existing?.previewSample;

  String _renderTemplatePreview(String? template) {
    final sample = _previewSample;
    final fallback = (template ?? '').trim();
    if (sample == null || fallback.isEmpty) {
      return fallback;
    }
    final tokens = <String, String>{
      'provider': _asString(sample['provider']) ?? '',
      'signalType': _asString(sample['signalType']) ?? '',
      'title': _asString(sample['title']) ?? '',
      'subject': _asString(sample['subject']) ?? '',
      'sender':
          _asString(sample['fromEmail']) ?? _asString(sample['fromName']) ?? '',
      'serviceType': _asString(sample['serviceTypeName']) ?? '',
      'position': _asString(sample['positionName']) ?? '',
      'team': _asString(sample['teamName']) ?? '',
      'date':
          _asString(sample['planDate']) ?? _asString(sample['startDate']) ?? '',
      'snippet': _asString(sample['snippet']) ?? '',
    };
    return fallback.replaceAllMapped(
      RegExp(r'\{\{(\w+)\}\}'),
      (match) => tokens[match.group(1)] ?? '',
    );
  }

  String? _asString(Object? value) {
    if (value is String && value.trim().isNotEmpty) {
      return value.trim();
    }
    return null;
  }

  Widget _templatePreviewCard({
    required BuildContext context,
    required String label,
    required String template,
  }) {
    final sample = _previewSample;
    final rendered = _renderTemplatePreview(template);
    if (template.trim().isEmpty) {
      return const SizedBox.shrink();
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: RhythmTokens.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
        border: Border.all(color: RhythmTokens.borderSoft),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: Theme.of(
              context,
            ).textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          Text(
            rendered.isEmpty ? template : rendered,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          if (sample == null) ...[
            const SizedBox(height: 6),
            Text(
              'Live preview appears after this automation matches once.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ],
      ),
    );
  }

  List<_TemplateTokenHelp> _availableTemplateTokens() {
    switch (_selectedSource) {
      case 'gmail':
        return const [
          _TemplateTokenHelp('subject', 'email subject'),
          _TemplateTokenHelp('sender', 'from name or email'),
          _TemplateTokenHelp('snippet', 'email preview text'),
          _TemplateTokenHelp('date', 'received date'),
        ];
      case 'google_calendar':
        return const [
          _TemplateTokenHelp('title', 'event title'),
          _TemplateTokenHelp('date', 'event date'),
          _TemplateTokenHelp('snippet', 'event snippet if present'),
        ];
      case 'planning_center':
        return const [
          _TemplateTokenHelp('title', 'plan title'),
          _TemplateTokenHelp('serviceType', 'service type'),
          _TemplateTokenHelp('team', 'team name'),
          _TemplateTokenHelp('position', 'position name'),
          _TemplateTokenHelp('date', 'plan date'),
        ];
      default:
        return const [
          _TemplateTokenHelp('title', 'title'),
          _TemplateTokenHelp('subject', 'subject'),
          _TemplateTokenHelp('sender', 'sender'),
          _TemplateTokenHelp('date', 'date'),
        ];
    }
  }

  List<_TemplateExample> _messageTemplateExamples() {
    switch (_selectedSource) {
      case 'gmail':
        return const [
          _TemplateExample(
            'Subject + sender',
            'New email from {{sender}}: {{subject}}',
          ),
          _TemplateExample(
            'Follow-up prompt',
            'Follow up with {{sender}} about "{{subject}}". {{snippet}}',
          ),
        ];
      case 'google_calendar':
        return const [
          _TemplateExample(
            'Calendar reminder',
            '{{title}} is coming up on {{date}}.',
          ),
          _TemplateExample(
            'Event summary',
            'Calendar event matched: {{title}} on {{date}}.',
          ),
        ];
      case 'planning_center':
        return const [
          _TemplateExample(
            'Volunteer issue',
            '{{serviceType}}: {{position}} needs attention for {{title}} on {{date}}.',
          ),
          _TemplateExample(
            'Team reminder',
            '{{team}} has a Planning Center update for {{title}} on {{date}}.',
          ),
        ];
      default:
        return const [
          _TemplateExample(
            'Basic notice',
            'Automation matched {{title}} on {{date}}.',
          ),
        ];
    }
  }

  List<_TemplateExample> _taskTitleTemplateExamples() {
    switch (_selectedSource) {
      case 'gmail':
        return const [
          _TemplateExample(
            'Follow-up title',
            'Reply to {{sender}} about {{subject}}',
          ),
          _TemplateExample('Simple email task', 'Email: {{subject}}'),
        ];
      case 'google_calendar':
        return const [
          _TemplateExample('Event prep', 'Prepare for {{title}}'),
          _TemplateExample('Calendar follow-up', '{{title}} on {{date}}'),
        ];
      case 'planning_center':
        return const [
          _TemplateExample('Position follow-up', '{{position}} for {{title}}'),
          _TemplateExample('Service prep', '{{serviceType}} prep for {{date}}'),
        ];
      default:
        return const [_TemplateExample('Basic title', '{{title}}')];
    }
  }

  List<_TemplateExample> _taskNotesTemplateExamples() {
    switch (_selectedSource) {
      case 'gmail':
        return const [
          _TemplateExample(
            'Sender + snippet',
            'From {{sender}}\n\n{{snippet}}',
          ),
          _TemplateExample(
            'Subject summary',
            'Subject: {{subject}}\nReceived: {{date}}',
          ),
        ];
      case 'google_calendar':
        return const [
          _TemplateExample('Event summary', 'Event: {{title}}\nDate: {{date}}'),
          _TemplateExample(
            'Prep note',
            'Prepare for {{title}} happening on {{date}}.',
          ),
        ];
      case 'planning_center':
        return const [
          _TemplateExample(
            'Service context',
            'Service: {{serviceType}}\nTeam: {{team}}\nPosition: {{position}}\nDate: {{date}}',
          ),
          _TemplateExample(
            'Short context',
            '{{team}} · {{position}} · {{date}}',
          ),
        ];
      default:
        return const [_TemplateExample('Basic notes', '{{title}} on {{date}}')];
    }
  }

  List<Widget> _buildActionFields() {
    switch (_selectedActionType) {
      case 'create_project_from_template':
        return [
          TextField(
            controller: _templateNameController,
            decoration: const InputDecoration(
              labelText: 'Project template name',
              border: OutlineInputBorder(),
            ),
          ),
        ];
      case 'send_notification':
        return [
          TextField(
            controller: _messageTemplateController,
            decoration: InputDecoration(
              labelText: 'Message template',
              border: const OutlineInputBorder(),
              helperText:
                  'Use placeholders like ${_availableTemplateTokens().map((token) => '{{${token.token}}}').join(', ')}',
            ),
            maxLines: 3,
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final example in _messageTemplateExamples())
                ActionChip(
                  label: Text(example.label),
                  onPressed: () {
                    setState(() {
                      _messageTemplateController.text = example.template;
                    });
                  },
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Rhythm replaces placeholders with data from the matched source event or message before sending the notification.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          _templatePreviewCard(
            context: context,
            label: 'Rendered message preview',
            template: _messageTemplateController.text,
          ),
        ];
      default:
        return [
          TextField(
            controller: _titleTemplateController,
            decoration: InputDecoration(
              labelText: 'Task title template',
              border: const OutlineInputBorder(),
              helperText:
                  'Use placeholders like ${_availableTemplateTokens().map((token) => '{{${token.token}}}').join(', ')}',
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final example in _taskTitleTemplateExamples())
                ActionChip(
                  label: Text(example.label),
                  onPressed: () {
                    setState(() {
                      _titleTemplateController.text = example.template;
                    });
                  },
                ),
            ],
          ),
          const SizedBox(height: 8),
          _templatePreviewCard(
            context: context,
            label: 'Rendered title preview',
            template: _titleTemplateController.text,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _notesTemplateController,
            decoration: const InputDecoration(
              labelText: 'Task notes template',
              border: OutlineInputBorder(),
              helperText:
                  'Optional. Same placeholders work here too for richer context.',
            ),
            maxLines: 3,
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final example in _taskNotesTemplateExamples())
                ActionChip(
                  label: Text(example.label),
                  onPressed: () {
                    setState(() {
                      _notesTemplateController.text = example.template;
                    });
                  },
                ),
            ],
          ),
          const SizedBox(height: 8),
          _templatePreviewCard(
            context: context,
            label: 'Rendered notes preview',
            template: _notesTemplateController.text,
          ),
          if (_selectedActionType == 'tag_task') ...[
            const SizedBox(height: 12),
            TextField(
              controller: _tagController,
              decoration: const InputDecoration(
                labelText: 'Tag',
                border: OutlineInputBorder(),
              ),
            ),
          ],
          if (_selectedActionType == 'auto_schedule') ...[
            const SizedBox(height: 12),
            _IntegerDropdown(
              label: 'Target day',
              value: _targetDay,
              options: const [1, 2, 3, 4, 5],
              labels: const {
                1: 'Monday',
                2: 'Tuesday',
                3: 'Wednesday',
                4: 'Thursday',
                5: 'Friday',
              },
              onChanged: (value) => setState(() => _targetDay = value),
            ),
          ],
        ];
    }
  }

  Map<String, dynamic>? _buildTriggerConfig() {
    final config = <String, dynamic>{};
    if (_daysBeforeDue != null) config['daysBeforeDue'] = _daysBeforeDue;
    if (_leadDays != null) config['leadDays'] = _leadDays;
    if (_selectedTeamId != null) config['teamId'] = _selectedTeamId;
    if (_selectedPositionName != null) {
      config['positionName'] = _selectedPositionName;
    }
    if (_textQueryController.text.trim().isNotEmpty) {
      config['textQuery'] = _textQueryController.text.trim();
    }
    if (_selectedEventType != null) config['eventType'] = _selectedEventType;
    if (_allDayOnly) config['allDayOnly'] = true;
    if (_dateWindowDays != null) config['dateWindowDays'] = _dateWindowDays;
    if (_senderController.text.trim().isNotEmpty) {
      config['sender'] = _senderController.text.trim();
    }
    if (_subjectController.text.trim().isNotEmpty) {
      config['subjectContains'] = _subjectController.text.trim();
    }
    if (_selectedLabel != null) config['label'] = _selectedLabel;
    if (_hoursSinceReceived != null) {
      config['hoursSinceReceived'] = _hoursSinceReceived;
    }
    return config.isEmpty ? null : config;
  }

  Map<String, dynamic>? _buildActionConfig() {
    final config = <String, dynamic>{};
    if (_titleTemplateController.text.trim().isNotEmpty) {
      config['titleTemplate'] = _titleTemplateController.text.trim();
    }
    if (_notesTemplateController.text.trim().isNotEmpty) {
      config['notesTemplate'] = _notesTemplateController.text.trim();
    }
    if (_messageTemplateController.text.trim().isNotEmpty) {
      config['messageTemplate'] = _messageTemplateController.text.trim();
    }
    if (_templateNameController.text.trim().isNotEmpty) {
      config['templateName'] = _templateNameController.text.trim();
    }
    if (_tagController.text.trim().isNotEmpty) {
      config['tag'] = _tagController.text.trim();
    }
    if (_targetDay != null) config['targetDay'] = _targetDay;
    return config.isEmpty ? null : config;
  }

  String _reviewSummary(AutomationTriggerCatalogItem? trigger) {
    final triggerLabel = trigger?.label ?? _selectedTriggerKey ?? 'Trigger';
    final actionLabel =
        widget.controller.actions
            .where((item) => item.key == _selectedActionType)
            .firstOrNull
            ?.label ??
        (_selectedActionType ?? 'Action');
    final accountLabel = _selectedAccountId == null
        ? (_selectedSource == 'rhythm' ? 'Rhythm' : 'default connected account')
        : widget.controller.accounts
                  .where((item) => item.id == _selectedAccountId)
                  .firstOrNull
                  ?.accountLabel ??
              'selected account';
    final filters = _buildTriggerConfig();
    final filterSummary = filters == null || filters.isEmpty
        ? 'with no extra filters'
        : 'with ${filters.entries.map((entry) => '${entry.key}: ${entry.value}').join(', ')}';
    return 'When $triggerLabel from ${_labelForSource(_selectedSource)} on $accountLabel, $filterSummary, then $actionLabel.';
  }

  List<AutomationProviderCatalogItem> _availableProviders() {
    final connectedSources = widget.controller.accounts
        .where((account) => account.connected)
        .map((account) => account.provider)
        .toSet();
    final providers = widget.controller.providers.where((provider) {
      if (provider.source == 'rhythm') return true;
      if (provider.source == widget.existing?.source) return true;
      return connectedSources.contains(provider.source);
    }).toList();
    final existingSource = widget.existing?.source;
    if (existingSource != null &&
        providers.every((provider) => provider.source != existingSource)) {
      providers.add(
        AutomationProviderCatalogItem(
          source: existingSource,
          label: _labelForSource(existingSource),
          description: 'Previously configured provider',
          syncSupport: 'manual',
          triggerKeys: const [],
        ),
      );
    }
    return providers;
  }

  void _syncAccountSelectionWithSource() {
    if (_selectedSource == null || _selectedSource == 'rhythm') {
      _selectedAccountId = null;
      return;
    }
    final accounts = widget.controller.accounts
        .where(
          (account) => account.provider == _selectedSource && account.connected,
        )
        .toList();
    if (accounts.any((account) => account.id == _selectedAccountId)) return;
    _selectedAccountId = accounts.firstOrNull?.id;
  }

  String? _validateDraft() {
    if (_selectedSource != null && _selectedSource != 'rhythm') {
      final hasConnectedAccount = widget.controller.accounts.any(
        (account) =>
            account.provider == _selectedSource &&
            account.connected &&
            account.id == _selectedAccountId,
      );
      if (!hasConnectedAccount) {
        return 'Connect ${_labelForSource(_selectedSource)} before creating this automation.';
      }
    }
    if (_selectedActionType == 'create_project_from_template' &&
        _templateNameController.text.trim().isEmpty) {
      return 'Project automations need a template name.';
    }
    if (_selectedActionType == 'send_notification' &&
        _messageTemplateController.text.trim().isEmpty) {
      return 'Notification automations need a message template.';
    }
    return null;
  }

  List<String> _positionsForTeam(
    PlanningCenterTaskOptions options,
    String? teamId,
  ) {
    if (teamId == null) {
      return options.positionsByTeamId.values
          .expand((item) => item)
          .toSet()
          .toList()
        ..sort();
    }
    return options.positionsByTeamId[teamId] ?? const [];
  }
}

class _IntegerDropdown extends StatelessWidget {
  const _IntegerDropdown({
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
    this.labels = const {},
  });

  final String label;
  final int? value;
  final List<int> options;
  final Map<int, String> labels;
  final ValueChanged<int?> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<int>(
      value: value,
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
      ),
      items: options
          .map(
            (item) => DropdownMenuItem(
              value: item,
              child: Text(labels[item] ?? item.toString()),
            ),
          )
          .toList(),
      onChanged: onChanged,
    );
  }
}

class _ConditionDraft {
  _ConditionDraft({
    required this.field,
    required this.operator,
    required this.value,
  });

  String field;
  String operator;
  final TextEditingController value;
}

class _TemplateTokenHelp {
  const _TemplateTokenHelp(this.token, this.description);

  final String token;
  final String description;
}

class _TemplateExample {
  const _TemplateExample(this.label, this.template);

  final String label;
  final String template;
}

String _labelForSource(String? source) => switch (source) {
  'planning_center' => 'Planning Center',
  'google_calendar' => 'Google Calendar',
  'gmail' => 'Gmail',
  _ => 'Rhythm',
};

String _formatStamp(String value) {
  final parsed = DateTime.tryParse(value);
  if (parsed == null) return value;
  final local = parsed.toLocal();
  final month = local.month.toString().padLeft(2, '0');
  final day = local.day.toString().padLeft(2, '0');
  final hour = local.hour.toString().padLeft(2, '0');
  final minute = local.minute.toString().padLeft(2, '0');
  return '$month/$day ${local.year} $hour:$minute';
}
