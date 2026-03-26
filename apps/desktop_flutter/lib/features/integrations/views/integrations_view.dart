import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/widgets/error_banner.dart';
import '../controllers/integrations_controller.dart';
import '../../imports/views/import_dialog.dart';
import '../models/gmail_signal.dart';
import '../models/integration_account.dart';
import '../models/planning_center_task_options.dart';
import '../models/planning_center_task_preferences.dart';

class IntegrationsView extends StatefulWidget {
  const IntegrationsView({super.key});

  @override
  State<IntegrationsView> createState() => _IntegrationsViewState();
}

class _IntegrationsViewState extends State<IntegrationsView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<IntegrationsController>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<IntegrationsController>(
      builder: (context, controller, _) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 24, 24, 12),
              child: Row(
                children: [
                  Text('Integrations',
                      style: Theme.of(context).textTheme.headlineSmall),
                  const Spacer(),
                  OutlinedButton.icon(
                    onPressed: controller.load,
                    icon: const Icon(Icons.refresh, size: 16),
                    label: const Text('Refresh'),
                  ),
                ],
              ),
            ),
            if (controller.status == IntegrationsStatus.error &&
                controller.errorMessage != null)
              ErrorBanner(
                message: controller.errorMessage!,
                onRetry: controller.load,
              ),
            Expanded(
              child: controller.status == IntegrationsStatus.loading &&
                      controller.accounts.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
                      children: [
                        _IntegrationCard(
                          account: _accountFor(
                              controller.accounts, 'google_calendar'),
                          title: 'Google Calendar',
                          description:
                              'Read-only calendar timing for shadow events in the planner.',
                          onConnect: () =>
                              _openExternal(controller.googleBeginUri()),
                          onSync: controller.syncGoogleCalendar,
                          syncing: controller.syncingGoogleCalendar,
                        ),
                        const SizedBox(height: 12),
                        _IntegrationCard(
                          account: _accountFor(controller.accounts, 'gmail'),
                          title: 'Gmail',
                          description:
                              'Read-only Gmail metadata for inbox-aware planning.',
                          onConnect: () =>
                              _openExternal(controller.googleBeginUri()),
                          onSync: controller.syncGmail,
                          syncing: controller.syncingGmail,
                          child: _GmailSignalsList(
                              signals: controller.gmailSignals),
                        ),
                        const SizedBox(height: 12),
                        _IntegrationCard(
                          account: _accountFor(
                              controller.accounts, 'planning_center'),
                          title: 'Planning Center',
                          description:
                              'Declines and staffing gaps become tasks. Non-Sunday plans can start a named project.',
                          onConnect: () => _openExternal(
                            controller.planningCenterBeginUri(),
                          ),
                          onSync: controller.syncPlanningCenter,
                          syncing: controller.syncingPlanningCenter,
                          child: _PlanningCenterFiltersSection(
                            preferences:
                                controller.planningCenterTaskPreferences,
                            options: controller.planningCenterTaskOptions,
                            saving: controller.savingPlanningCenterTaskFilters,
                            onEdit: () =>
                                _editPlanningCenterFilters(controller),
                          ),
                        ),
                        const SizedBox(height: 24),
                        const Divider(),
                        const SizedBox(height: 16),
                        _AiImportCard(
                          onImport: () => showDialog<void>(
                            context: context,
                            builder: (_) => const ImportDialog(),
                          ),
                        ),
                      ],
                    ),
            ),
          ],
        );
      },
    );
  }

  IntegrationAccount? _accountFor(
      List<IntegrationAccount> accounts, String provider) {
    for (final account in accounts) {
      if (account.provider == provider) return account;
    }
    return null;
  }

  Future<void> _openExternal(Uri uri) async {
    final command = Platform.isMacOS ? 'open' : 'xdg-open';
    await Process.run(command, [uri.toString()]);
  }

  Future<void> _editPlanningCenterFilters(
    IntegrationsController controller,
  ) async {
    final next = await showDialog<PlanningCenterTaskPreferences>(
      context: context,
      builder: (context) => _PlanningCenterTaskFiltersDialog(
        options: controller.planningCenterTaskOptions,
        initial: controller.planningCenterTaskPreferences,
      ),
    );
    if (next == null) return;
    await controller.savePlanningCenterTaskPreferences(next);
  }
}

class _IntegrationCard extends StatelessWidget {
  const _IntegrationCard({
    required this.title,
    required this.description,
    required this.account,
    required this.onConnect,
    this.onSync,
    this.syncing = false,
    this.child,
  });

  final String title;
  final String description;
  final IntegrationAccount? account;
  final VoidCallback? onConnect;
  final Future<void> Function()? onSync;
  final bool syncing;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final connected = account?.connected ?? false;
    final color = connected ? Colors.green : Colors.orange;
    final statusLabel = connected ? 'Connected' : 'Not connected';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title,
                          style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 6),
                      Text(description,
                          style: Theme.of(context).textTheme.bodyMedium),
                    ],
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    statusLabel,
                    style: TextStyle(color: color, fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            if (account?.displayName != null || account?.email != null)
              Text(
                [
                  if (account?.displayName != null) account!.displayName!,
                  if (account?.email != null) account!.email!,
                ].join(' · '),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            if (account?.errorMessage != null) ...[
              const SizedBox(height: 8),
              Text(account!.errorMessage!,
                  style: const TextStyle(color: Colors.red)),
            ],
            const SizedBox(height: 16),
            Row(
              children: [
                FilledButton.icon(
                  onPressed: onConnect,
                  icon: Icon(connected ? Icons.sync : Icons.link, size: 16),
                  label: Text(connected ? 'Reconnect' : 'Connect'),
                ),
                if (connected && onSync != null) ...[
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: syncing ? null : () => onSync!.call(),
                    icon: syncing
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.download, size: 16),
                    label: Text(title == 'Gmail'
                        ? 'Sync Gmail'
                        : title == 'Planning Center'
                            ? 'Sync Planning Center'
                            : 'Sync Calendar'),
                  ),
                ],
                if (!connected && onConnect == null) ...[
                  const SizedBox(width: 12),
                  Text('Coming next',
                      style: Theme.of(context).textTheme.bodySmall),
                ],
              ],
            ),
            if (child != null) ...[
              const SizedBox(height: 16),
              child!,
            ],
          ],
        ),
      ),
    );
  }
}

class _GmailSignalsList extends StatelessWidget {
  const _GmailSignalsList({required this.signals});

  final List<GmailSignal> signals;

  @override
  Widget build(BuildContext context) {
    if (signals.isEmpty) {
      return Text(
        'No recent Gmail signals synced yet.',
        style: Theme.of(context).textTheme.bodySmall,
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Recent inbox signals',
            style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        ...signals.take(5).map(
              (signal) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      margin: const EdgeInsets.only(top: 6, right: 10),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: signal.isUnread ? Colors.blue : Colors.grey,
                      ),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            signal.subject,
                            style: Theme.of(context)
                                .textTheme
                                .bodyMedium
                                ?.copyWith(
                                  fontWeight: signal.isUnread
                                      ? FontWeight.w700
                                      : FontWeight.w500,
                                ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            signal.fromLabel,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                          if (signal.snippet != null &&
                              signal.snippet!.trim().isNotEmpty) ...[
                            const SizedBox(height: 2),
                            Text(
                              signal.snippet!,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
      ],
    );
  }
}

class _PlanningCenterFiltersSection extends StatelessWidget {
  const _PlanningCenterFiltersSection({
    required this.preferences,
    required this.options,
    required this.saving,
    required this.onEdit,
  });

  final PlanningCenterTaskPreferences preferences;
  final PlanningCenterTaskOptions options;
  final bool saving;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final teamSummary = preferences.teamIds.isEmpty
        ? 'All synced teams'
        : '${preferences.teamIds.length} selected';
    final positionSummary = preferences.positionNames.isEmpty
        ? 'All allowed positions'
        : '${preferences.positionNames.length} selected';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Task triggers',
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(
                    'Teams: $teamSummary · Positions: $positionSummary',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            OutlinedButton.icon(
              onPressed: saving ? null : onEdit,
              icon: saving
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.tune, size: 16),
              label: const Text('Choose'),
            ),
          ],
        ),
        if (options.teams.isEmpty && options.positionsByTeamId.isEmpty) ...[
          const SizedBox(height: 8),
          Text(
            'Sync Planning Center once to load selectable teams and positions.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ],
    );
  }
}

class _PlanningCenterTaskFiltersDialog extends StatefulWidget {
  const _PlanningCenterTaskFiltersDialog({
    required this.options,
    required this.initial,
  });

  final PlanningCenterTaskOptions options;
  final PlanningCenterTaskPreferences initial;

  @override
  State<_PlanningCenterTaskFiltersDialog> createState() =>
      _PlanningCenterTaskFiltersDialogState();
}

class _PlanningCenterTaskFiltersDialogState
    extends State<_PlanningCenterTaskFiltersDialog> {
  late Set<String> _teamIds;
  late Set<String> _positionNames;

  @override
  void initState() {
    super.initState();
    _teamIds = {...widget.initial.teamIds};
    _positionNames = {...widget.initial.positionNames};
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Planning Center task filters'),
      content: SizedBox(
        width: 640,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Select which teams and positions should create Rhythm tasks. Leaving a section empty means no extra restriction.',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 16),
              _multiSelectSection(
                context,
                title: 'Teams',
                values: widget.options.teams
                    .map((team) => '${team.serviceTypeName} · ${team.name}')
                    .toList(),
                selectedLabels: widget.options.teams
                    .where((team) => _teamIds.contains(team.id))
                    .map((team) => '${team.serviceTypeName} · ${team.name}')
                    .toSet(),
                onToggleLabel: (label) => setState(() {
                  final team = widget.options.teams.firstWhere(
                    (candidate) =>
                        '${candidate.serviceTypeName} · ${candidate.name}' ==
                        label,
                  );
                  if (!_teamIds.remove(team.id)) {
                    _teamIds.add(team.id);
                  }
                  _positionNames.removeWhere(
                    (position) => !_availablePositions().contains(position),
                  );
                }),
              ),
              const SizedBox(height: 20),
              _multiSelectSection(
                context,
                title: 'Positions',
                values: _availablePositions(),
                selectedLabels: _positionNames,
                onToggleLabel: (value) => setState(() {
                  if (!_positionNames.remove(value)) {
                    _positionNames.add(value);
                  }
                }),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => setState(() {
            _teamIds.clear();
            _positionNames.clear();
          }),
          child: const Text('Clear all'),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () {
            Navigator.of(context).pop(
              PlanningCenterTaskPreferences(
                teamIds: _teamIds.toList()..sort(),
                positionNames: _positionNames.toList()..sort(),
              ),
            );
          },
          child: const Text('Save'),
        ),
      ],
    );
  }

  List<String> _availablePositions() {
    if (_teamIds.isEmpty) {
      final values = widget.options.positionsByTeamId.values
          .expand<String>((items) => items)
          .toSet()
          .toList()
        ..sort();
      return values;
    }

    final values = _teamIds
        .expand<String>(
          (teamId) =>
              widget.options.positionsByTeamId[teamId] ?? const <String>[],
        )
        .toSet()
        .toList()
      ..sort();
    return values;
  }

  Widget _multiSelectSection(
    BuildContext context, {
    required String title,
    required List<String> values,
    required Set<String> selectedLabels,
    required ValueChanged<String> onToggleLabel,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const Spacer(),
            Text(
              selectedLabels.isEmpty
                  ? 'All'
                  : '${selectedLabels.length} selected',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: values
              .map(
                (value) => FilterChip(
                  label: Text(value),
                  selected: selectedLabels.contains(value),
                  onSelected: (_) => onToggleLabel(value),
                ),
              )
              .toList(),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// AI Import card
// ---------------------------------------------------------------------------

class _AiImportCard extends StatelessWidget {
  const _AiImportCard({required this.onImport});
  final VoidCallback onImport;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: const BorderSide(color: Color(0xFFE5E7EB)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFF5F3FF),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.smart_toy_outlined,
                  color: Color(0xFF7C3AED), size: 22),
            ),
            const SizedBox(width: 16),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('AI Import',
                      style:
                          TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                  SizedBox(height: 4),
                  Text(
                    'Use an AI assistant to bulk-create tasks, rhythms, and project templates. '
                    'Copy the schema prompt, paste the AI output, and import.',
                    style: TextStyle(color: Colors.black54, fontSize: 13),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 16),
            FilledButton.icon(
              onPressed: onImport,
              icon: const Icon(Icons.open_in_new, size: 16),
              label: const Text('Open Import'),
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF7C3AED),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
