import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../../app/core/widgets/error_banner.dart';
import '../controllers/integrations_controller.dart';
import '../../imports/views/import_dialog.dart';
import '../models/gmail_signal.dart';
import '../models/google_calendar_settings.dart';
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
    return Container(
      color: context.rhythm.canvas,
      child: Stack(
        children: [
          Positioned(
            top: -96,
            right: -92,
            child: _AmbientOrb(color: context.rhythm.accentMuted, size: 220),
          ),
          Positioned(
            bottom: -120,
            left: -76,
            child: _AmbientOrb(color: context.rhythm.accentMuted, size: 180),
          ),
          Consumer<IntegrationsController>(
            builder: (context, controller, _) {
              final connectedCount = controller.accounts
                  .where((account) => account.connected)
                  .length;

              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _IntegrationsHeader(
                    connectedCount: connectedCount,
                    totalCount: controller.accounts.length,
                    syncing: controller.syncingAll ||
                        controller.status == IntegrationsStatus.loading,
                    onSyncAll: controller.syncAll,
                  ),
                  if (controller.status == IntegrationsStatus.error &&
                      controller.errorMessage != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(24, 0, 24, 12),
                      child: ErrorBanner(
                        message: controller.errorMessage!,
                        onRetry: controller.load,
                      ),
                    ),
                  Expanded(
                    child: controller.status == IntegrationsStatus.loading &&
                            controller.accounts.isEmpty
                        ? const _LoadingState()
                        : ListView(
                            padding: const EdgeInsets.fromLTRB(24, 4, 24, 24),
                            children: [
                              _IntegrationCard(
                                account: _accountFor(
                                  controller.accounts,
                                  'google_calendar',
                                ),
                                title: 'Google Calendar',
                                description:
                                    'Read-only calendar timing for shadow events in the planner.',
                                onConnect: () =>
                                    _openExternal(controller.googleBeginUri()),
                                onSync: controller.syncGoogleCalendar,
                                syncing: controller.syncingGoogleCalendar,
                                child: _GoogleCalendarSelectionSection(
                                  settings: controller.googleCalendarSettings,
                                  saving: controller
                                      .savingGoogleCalendarPreferences,
                                  onSave:
                                      controller.saveGoogleCalendarPreferences,
                                ),
                              ),
                              const SizedBox(height: 16),
                              _IntegrationCard(
                                account: _accountFor(
                                  controller.accounts,
                                  'gmail',
                                ),
                                title: 'Gmail',
                                description:
                                    'Read-only Gmail metadata for inbox-aware planning.',
                                onConnect: () =>
                                    _openExternal(controller.googleBeginUri()),
                                onSync: controller.syncGmail,
                                syncing: controller.syncingGmail,
                                child: _GmailSignalsList(
                                  signals: controller.gmailSignals,
                                ),
                              ),
                              const SizedBox(height: 16),
                              _IntegrationCard(
                                account: _accountFor(
                                  controller.accounts,
                                  'planning_center',
                                ),
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
                                  saving: controller
                                      .savingPlanningCenterTaskFilters,
                                  onEdit: () =>
                                      _editPlanningCenterFilters(controller),
                                ),
                              ),
                              const SizedBox(height: 20),
                              const _ImportSection(),
                              const SizedBox(height: 4),
                            ],
                          ),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  IntegrationAccount? _accountFor(
    List<IntegrationAccount> accounts,
    String provider,
  ) {
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
    if (controller.planningCenterTaskOptions.teams.isEmpty &&
        controller.planningCenterTaskOptions.positionsByTeamId.isEmpty) {
      await controller.loadPlanningCenterTaskOptions();
      if (!mounted || controller.errorMessage != null) return;
    }
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
    final hasError = account?.errorMessage != null;
    final statusColor = hasError
        ? context.rhythm.danger
        : connected
            ? context.rhythm.success
            : context.rhythm.textSecondary;
    final statusLabel = hasError
        ? 'Needs attention'
        : connected
            ? 'Connected'
            : 'Not connected';
    final statusBackground = hasError
        ? context.rhythm.danger.withValues(alpha: 0.12)
        : connected
            ? context.rhythm.success.withValues(alpha: 0.12)
            : context.rhythm.surfaceMuted;

    return Container(
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
        border: Border.all(color: context.rhythm.borderSubtle),
        boxShadow: RhythmElevation.panel,
      ),
      child: Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                              color: context.rhythm.textPrimary,
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        description,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: context.rhythm.textSecondary,
                              height: 1.45,
                            ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                _StatusChip(
                  label: statusLabel,
                  color: statusColor,
                  backgroundColor: statusBackground,
                ),
              ],
            ),
            if (account?.displayName != null || account?.email != null) ...[
              const SizedBox(height: 14),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (account?.displayName != null)
                    _MetaPill(
                      icon: Icons.person_outline,
                      label: account!.displayName!,
                    ),
                  if (account?.email != null)
                    _MetaPill(icon: Icons.mail_outline, label: account!.email!),
                ],
              ),
            ],
            if (hasError) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: context.rhythm.danger.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(RhythmRadius.lg),
                  border: Border.all(
                      color: context.rhythm.danger.withValues(alpha: 0.18)),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.error_outline,
                        size: 16, color: context.rhythm.danger),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        account!.errorMessage!,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: context.rhythm.danger,
                              height: 1.4,
                            ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 18),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                FilledButton.icon(
                  onPressed: onConnect,
                  icon: Icon(connected ? Icons.sync : Icons.link, size: 16),
                  label: Text(connected ? 'Reconnect' : 'Connect'),
                ),
                if (connected && onSync != null)
                  OutlinedButton.icon(
                    onPressed: syncing ? null : () => onSync!.call(),
                    icon: syncing
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Icon(Icons.download, size: 16),
                    label: Text(
                      title == 'Gmail'
                          ? 'Sync Gmail'
                          : title == 'Planning Center'
                              ? 'Sync Planning Center'
                              : 'Sync Calendar',
                    ),
                  ),
                if (!connected && onConnect == null)
                  Text(
                    'Coming next',
                    style: Theme.of(
                      context,
                    )
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: context.rhythm.textMuted),
                  ),
              ],
            ),
            if (child != null) ...[
              const SizedBox(height: 18),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: context.rhythm.surfaceMuted,
                  borderRadius: BorderRadius.circular(RhythmRadius.lg),
                  border: Border.all(color: context.rhythm.borderSubtle),
                ),
                child: child!,
              ),
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

  List<GmailSignal> _dedupedByThread() {
    final seen = <String>{};
    final result = <GmailSignal>[];
    for (final signal in signals) {
      final key = signal.threadId ?? signal.id;
      if (seen.add(key)) result.add(signal);
    }
    return result;
  }

  @override
  Widget build(BuildContext context) {
    if (signals.isEmpty) {
      return const _SubtleCallout(
        icon: Icons.inbox_outlined,
        title: 'No inbox signals yet',
        body:
            'Connect Gmail and sync once to surface recent inbox timing here.',
      );
    }

    final unreadCount = signals.where((s) => s.isUnread).length;
    final deduped = _dedupedByThread().take(5).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              'Recent inbox signals',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: context.rhythm.textPrimary,
                    fontWeight: FontWeight.w600,
                  ),
            ),
            if (unreadCount > 0) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: context.rhythm.accent,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '$unreadCount unread',
                  style: TextStyle(
                    fontSize: 11,
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 10),
        ...deduped.map(
          (signal) => Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: context.rhythm.surfaceRaised.withValues(alpha: 0.78),
                borderRadius: BorderRadius.circular(RhythmRadius.lg),
                border: Border.all(color: context.rhythm.borderSubtle),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    margin: const EdgeInsets.only(top: 6, right: 10),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: signal.isUnread
                          ? context.rhythm.accent
                          : context.rhythm.textMuted,
                    ),
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          signal.subject,
                          style:
                              Theme.of(context).textTheme.bodyMedium?.copyWith(
                                    color: context.rhythm.textPrimary,
                                    fontWeight: signal.isUnread
                                        ? FontWeight.w700
                                        : FontWeight.w500,
                                  ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          signal.fromLabel,
                          style: Theme.of(context)
                              .textTheme
                              .bodySmall
                              ?.copyWith(color: context.rhythm.textSecondary),
                        ),
                        if (signal.snippet != null &&
                            signal.snippet!.trim().isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            signal.snippet!,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context)
                                .textTheme
                                .bodySmall
                                ?.copyWith(color: context.rhythm.textSecondary),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _GoogleCalendarSelectionSection extends StatefulWidget {
  const _GoogleCalendarSelectionSection({
    required this.settings,
    required this.saving,
    required this.onSave,
  });

  final GoogleCalendarSettings settings;
  final bool saving;
  final Future<void> Function(List<String> selectedCalendarIds) onSave;

  @override
  State<_GoogleCalendarSelectionSection> createState() =>
      _GoogleCalendarSelectionSectionState();
}

class _GoogleCalendarSelectionSectionState
    extends State<_GoogleCalendarSelectionSection> {
  late Set<String> _selectedCalendarIds;

  @override
  void initState() {
    super.initState();
    _selectedCalendarIds = {...widget.settings.selectedCalendarIds};
  }

  @override
  void didUpdateWidget(covariant _GoogleCalendarSelectionSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.settings.selectedCalendarIds !=
            widget.settings.selectedCalendarIds ||
        oldWidget.settings.calendars.length !=
            widget.settings.calendars.length) {
      _selectedCalendarIds = {...widget.settings.selectedCalendarIds};
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.settings.calendars.isEmpty) {
      return const _SubtleCallout(
        icon: Icons.calendar_month_outlined,
        title: 'No calendars selected',
        body:
            'Connect Google Calendar, then choose which subscribed calendars feed shadow events.',
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Calendar sources',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          color: context.rhythm.textPrimary,
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${_selectedCalendarIds.length} of ${widget.settings.calendars.length} selected for shadow events',
                    style: Theme.of(
                      context,
                    )
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: context.rhythm.textSecondary),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            TextButton(
              onPressed: widget.saving
                  ? null
                  : () => setState(() {
                        _selectedCalendarIds = {
                          for (final calendar in widget.settings.calendars)
                            calendar.id,
                        };
                      }),
              child: Text('All'),
            ),
            TextButton(
              onPressed: widget.saving
                  ? null
                  : () => setState(() {
                        _selectedCalendarIds.clear();
                      }),
              child: Text('None'),
            ),
            const SizedBox(width: 8),
            OutlinedButton.icon(
              onPressed: widget.saving
                  ? null
                  : () => widget.onSave(_selectedCalendarIds.toList()..sort()),
              icon: widget.saving
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(Icons.save_outlined, size: 16),
              label: Text('Save'),
            ),
          ],
        ),
        const SizedBox(height: 10),
        ...widget.settings.calendars.map(
          (calendar) => CheckboxListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            value: _selectedCalendarIds.contains(calendar.id),
            onChanged: widget.saving
                ? null
                : (_) => setState(() {
                      if (!_selectedCalendarIds.remove(calendar.id)) {
                        _selectedCalendarIds.add(calendar.id);
                      }
                    }),
            title: Text(calendar.name),
            subtitle: calendar.isPrimary ? Text('Primary') : null,
            controlAffinity: ListTileControlAffinity.leading,
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
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Task triggers',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          color: context.rhythm.textPrimary,
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Teams: $teamSummary · Positions: $positionSummary',
                    style: Theme.of(
                      context,
                    )
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: context.rhythm.textSecondary),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            OutlinedButton.icon(
              onPressed: saving ? null : onEdit,
              icon: saving
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(Icons.tune, size: 16),
              label: Text('Choose'),
            ),
          ],
        ),
        if (options.teams.isEmpty && options.positionsByTeamId.isEmpty) ...[
          const SizedBox(height: 10),
          const _SubtleCallout(
            icon: Icons.tune_outlined,
            title: 'No task filters yet',
            body:
                'Sync Planning Center once to load selectable teams and positions.',
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
      title: Text('Planning Center task filters'),
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
          child: Text('Clear all'),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text('Cancel'),
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
          child: Text('Save'),
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
    return Container(
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
        border: Border.all(color: context.rhythm.borderSubtle),
        boxShadow: RhythmElevation.panel,
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: context.rhythm.accentMuted,
                borderRadius: BorderRadius.circular(RhythmRadius.lg),
              ),
              child: Icon(
                Icons.smart_toy_outlined,
                color: context.rhythm.accent,
                size: 22,
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'AI Import',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                      color: context.rhythm.textPrimary,
                    ),
                  ),
                  SizedBox(height: 4),
                  Text(
                    'Use an AI assistant to bulk-create tasks, rhythms, and project templates. Copy the schema prompt, paste the AI output, and import.',
                    style: TextStyle(
                      color: context.rhythm.textSecondary,
                      fontSize: 13,
                      height: 1.45,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 16),
            FilledButton.icon(
              onPressed: onImport,
              icon: Icon(Icons.open_in_new, size: 16),
              label: Text('Open Import'),
              style: FilledButton.styleFrom(
                  backgroundColor: context.rhythm.accent),
            ),
          ],
        ),
      ),
    );
  }
}

class _IntegrationsHeader extends StatelessWidget {
  const _IntegrationsHeader({
    required this.connectedCount,
    required this.totalCount,
    required this.syncing,
    required this.onSyncAll,
  });

  final int connectedCount;
  final int totalCount;
  final bool syncing;
  final Future<void> Function() onSyncAll;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 14),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(22),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceRaised.withValues(alpha: 0.92),
          borderRadius: BorderRadius.circular(RhythmRadius.xl),
          border: Border.all(color: context.rhythm.borderSubtle),
          boxShadow: RhythmElevation.panel,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Integrations',
                    style: TextStyle(
                      fontSize: 28,
                      height: 1.05,
                      fontWeight: FontWeight.w700,
                      color: context.rhythm.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Quietly keep external systems in sync with the rest of the workspace.',
                    style: TextStyle(
                      fontSize: 13,
                      height: 1.45,
                      color: context.rhythm.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      _HeaderPill(
                        icon: Icons.link_outlined,
                        label: '$connectedCount of $totalCount connected',
                      ),
                      const _HeaderPill(
                        icon: Icons.sync_outlined,
                        label: 'Auto sync every 30 min',
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Manual sync pulls Gmail, Google Calendar, and Planning Center right now.',
                    style: TextStyle(
                      fontSize: 12.5,
                      height: 1.45,
                      color: context.rhythm.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 16),
            FilledButton.icon(
              onPressed: syncing ? null : () => unawaited(onSyncAll()),
              icon: syncing
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(Icons.sync, size: 16),
              label: Text('Sync all'),
            ),
          ],
        ),
      ),
    );
  }
}

class _HeaderPill extends StatelessWidget {
  const _HeaderPill({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: context.rhythm.textSecondary),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(
              fontSize: 13,
              color: context.rhythm.textSecondary,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({
    required this.label,
    required this.color,
    required this.backgroundColor,
  });

  final String label;
  final Color color;
  final Color backgroundColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.16)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(shape: BoxShape.circle, color: color),
          ),
          const SizedBox(width: 8),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: color,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _MetaPill extends StatelessWidget {
  const _MetaPill({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: context.rhythm.textSecondary),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(fontSize: 12, color: context.rhythm.textSecondary),
          ),
        ],
      ),
    );
  }
}

class _LoadingState extends StatelessWidget {
  const _LoadingState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 340,
        margin: const EdgeInsets.symmetric(horizontal: 24),
        padding: const EdgeInsets.all(22),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceRaised.withValues(alpha: 0.96),
          borderRadius: BorderRadius.circular(RhythmRadius.xl),
          border: Border.all(color: context.rhythm.borderSubtle),
          boxShadow: RhythmElevation.panel,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2.4),
            ),
            const SizedBox(height: 14),
            Text(
              'Loading integrations',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: context.rhythm.textPrimary,
                    fontWeight: FontWeight.w600,
                  ),
            ),
            const SizedBox(height: 6),
            Text(
              'Checking connection status, sync settings, and import tools.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: context.rhythm.textSecondary,
                    height: 1.4,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SubtleCallout extends StatelessWidget {
  const _SubtleCallout({
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: context.rhythm.accentMuted,
              borderRadius: BorderRadius.circular(RhythmRadius.md),
            ),
            child: Icon(icon, size: 18, color: context.rhythm.accent),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        color: context.rhythm.textPrimary,
                        fontWeight: FontWeight.w600,
                      ),
                ),
                const SizedBox(height: 4),
                Text(
                  body,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: context.rhythm.textSecondary,
                        height: 1.45,
                      ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AmbientOrb extends StatelessWidget {
  const _AmbientOrb({required this.color, required this.size});

  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(
            colors: [
              color.withValues(alpha: 0.55),
              color.withValues(alpha: 0.18),
              color.withValues(alpha: 0.0),
            ],
            stops: const [0.0, 0.55, 1.0],
          ),
        ),
      ),
    );
  }
}

class _ImportSection extends StatelessWidget {
  const _ImportSection();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Import',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: context.rhythm.textSecondary,
            letterSpacing: 0.8,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'Bring structured work into Rhythm with the AI import flow.',
          style: Theme.of(
            context,
          )
              .textTheme
              .bodySmall
              ?.copyWith(color: context.rhythm.textSecondary, height: 1.4),
        ),
        const SizedBox(height: 12),
        _AiImportCard(
          onImport: () => showDialog<void>(
            context: context,
            builder: (_) => const ImportDialog(),
          ),
        ),
      ],
    );
  }
}
