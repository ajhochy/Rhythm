import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../../app/core/agents/agent_server_controller.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../agent_configs/controllers/agent_configs_controller.dart';
import '../../agent_configs/models/agent_config.dart';
import '../../settings/views/settings_view.dart';
import '../../agent_configs/widgets/agent_icon.dart';
import '../../tasks/controllers/tasks_controller.dart';
import '../../tasks/models/task.dart';
import '../../agent_projects/controllers/agent_projects_controller.dart';
import '../../agent_projects/views/edit_project_dialog.dart';
import '../controllers/agents_controller.dart';
import '../models/agent_session.dart';
import '../models/chat_models.dart';
import '../../settings/services/destructive_modal_service.dart';
import '_agent_settings_sheet.dart';
import '_attachment_mime.dart';
import '_chat_cost_footer.dart';
import '_compaction_divider.dart';
import '_context_usage_hint.dart';
import '_markdown_message_body.dart';
import '_message_actions_row.dart';
import '_reasoning_block.dart';
import '_retrying_indicator.dart';
import '_revert_restore_banner.dart';
import '_session_side_panel.dart';
import '_permission_card.dart';
import '_permission_mode_picker.dart';
import '_project_vcs_chip.dart';
import '_projects_rail.dart';
import '_slash_command_popover.dart';
import '_question_tool_card.dart';
import '_tool_call_part.dart';
import '_tool_renderers/_unified_diff_view.dart';
import '_tool_renderers/_terminal_output_view.dart';
import '_tool_renderers/_todo_checklist_view.dart';
import '_tool_renderers/_task_chip.dart';
import '_unified_agent_model_picker.dart';

class AgentsView extends StatefulWidget {
  const AgentsView({super.key});

  @override
  State<AgentsView> createState() => _AgentsViewState();
}

class _AgentsViewState extends State<AgentsView> {
  bool _resumableSectionExpanded = false;

  @override
  Widget build(BuildContext context) {
    // Watch AgentsController so the view rebuilds when session state changes.
    context.watch<AgentsController>();
    final agentServerController = context.watch<AgentServerController>();

    // Capability guard — server failed.
    if (agentServerController.status == AgentServerStatus.failed) {
      return const AgentServerUnavailable();
    }

    // Capability guard — server ok but no providers connected yet.
    if (agentServerController.isReady && !agentServerController.hasAnyAgent) {
      return const _NoAgentsAvailable();
    }

    // Still starting — show the main view (sessions will be empty).
    return Scaffold(
      backgroundColor: context.rhythm.canvas,
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              context.rhythm.canvas,
              const Color(0xFFF7F4EF),
              context.rhythm.canvas,
            ],
            stops: const [0.0, 0.45, 1.0],
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              ProjectsRail(
                onAddProject: () => _showNewProjectDialog(context),
              ),
              const SizedBox(width: 12),
              _SessionListPanel(
                resumableSectionExpanded: _resumableSectionExpanded,
                onToggleResumable: () => setState(
                  () => _resumableSectionExpanded = !_resumableSectionExpanded,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(child: _TranscriptPanel()),
              // Right-rail inspector (Context / Changes / Terminal) for the
              // active session. Mounted here so the M3 session-feature panels
              // (Changes diff, todo list) actually render — the prior attempt
              // left SessionSidePanel import-clean but never placed it.
              if (context.watch<AgentsController>().selectedSession !=
                  null) ...[
                const SizedBox(width: 12),
                SessionSidePanel(
                  session: context.watch<AgentsController>().selectedSession!,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  void _showNewProjectDialog(BuildContext context) {
    showEditProjectDialog(context);
  }
}

// ---------------------------------------------------------------------------
// Capability guard cards
// ---------------------------------------------------------------------------

class AgentServerUnavailable extends StatelessWidget {
  const AgentServerUnavailable({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentServerController>();
    final isStarting = controller.status == AgentServerStatus.starting;

    return Scaffold(
      backgroundColor: context.rhythm.canvas,
      body: Center(
        child: Container(
          width: 440,
          padding: const EdgeInsets.all(32),
          decoration: BoxDecoration(
            color: context.rhythm.surfaceRaised,
            borderRadius: BorderRadius.circular(RhythmRadius.xl),
            border: Border.all(color: context.rhythm.border),
            boxShadow: RhythmElevation.panel,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline, size: 40, color: context.rhythm.danger),
              const SizedBox(height: 16),
              Text(
                'Agent server unavailable',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: context.rhythm.textPrimary,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                'The agent server failed to start. Check Settings → Agent Server '
                'to diagnose the issue.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 13,
                  color: context.rhythm.textSecondary,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 16),
              OutlinedButton(
                onPressed: isStarting
                    ? null
                    : () => context.read<AgentServerController>().retry(),
                style: OutlinedButton.styleFrom(
                  foregroundColor: context.rhythm.accent,
                  side: BorderSide(color: context.rhythm.border),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 18,
                    vertical: 10,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(RhythmRadius.md),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (isStarting) ...[
                      SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: context.rhythm.accent,
                        ),
                      ),
                      const SizedBox(width: 10),
                    ],
                    const Text(
                      'Retry',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NoAgentsAvailable extends StatelessWidget {
  const _NoAgentsAvailable();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.rhythm.canvas,
      body: Center(
        child: Container(
          width: 440,
          padding: const EdgeInsets.all(32),
          decoration: BoxDecoration(
            color: context.rhythm.surfaceRaised,
            borderRadius: BorderRadius.circular(RhythmRadius.xl),
            border: Border.all(color: context.rhythm.border),
            boxShadow: RhythmElevation.panel,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.smart_toy_outlined,
                size: 40,
                color: context.rhythm.textMuted,
              ),
              const SizedBox(height: 16),
              Text(
                'No agents connected',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: context.rhythm.textPrimary,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                'Connect a provider in Settings → AI Accounts to enable '
                'agent sessions. You can sign in with Claude, ChatGPT, '
                'GitHub Copilot, or paste an API key for Gemini or '
                'OpenRouter.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 13,
                  color: context.rhythm.textSecondary,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => const SettingsView(),
                    ),
                  );
                },
                icon: const Icon(Icons.settings_outlined, size: 16),
                label: const Text('Open Settings → AI Accounts'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Left panel — session list
// ---------------------------------------------------------------------------

class _SessionListPanel extends StatefulWidget {
  const _SessionListPanel({
    required this.resumableSectionExpanded,
    required this.onToggleResumable,
  });

  final bool resumableSectionExpanded;
  final VoidCallback onToggleResumable;

  @override
  State<_SessionListPanel> createState() => _SessionListPanelState();
}

class _SessionListPanelState extends State<_SessionListPanel> {
  /// Sessions selected via Shift-click for bulk actions.
  final Set<String> _multiSelected = {};

  bool _archivedSectionExpanded = false;

  bool get _hasMultiSelection => _multiSelected.isNotEmpty;

  void _onRowTap(String id) {
    final isShift = HardwareKeyboard.instance.isShiftPressed;
    if (isShift) {
      setState(() {
        if (_multiSelected.contains(id)) {
          _multiSelected.remove(id);
        } else {
          _multiSelected.add(id);
        }
      });
      return;
    }
    if (_hasMultiSelection) {
      setState(() => _multiSelected.clear());
    }
    context.read<AgentsController>().selectSession(id);
  }

  Future<void> _confirmBulkDelete() async {
    final ids = _multiSelected.toList();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Delete ${ids.length} sessions?'),
        content: const Text(
          'This permanently removes the selected sessions and all of their '
          'messages. This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text('Delete ${ids.length}'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (!mounted) return;
    await context.read<AgentsController>().deleteSessions(ids);
    if (!mounted) return;
    setState(() => _multiSelected.clear());
  }

  @override
  Widget build(BuildContext context) {
    final resumableSectionExpanded = widget.resumableSectionExpanded;
    final onToggleResumable = widget.onToggleResumable;
    final controller = context.watch<AgentsController>();
    final agentServerController = context.watch<AgentServerController>();
    final projectsController = context.watch<AgentProjectsController>();
    final canStartSession =
        agentServerController.isReady && agentServerController.hasAnyAgent;

    final selectedProject = projectsController.selectedProject;
    final selectedProjectId = projectsController.selectedProjectId;
    // selectedProjectId == null → All sessions (no filter). Otherwise filter.
    final filteredSessions = selectedProjectId == null
        ? controller.sessions
        : controller.sessions
            .where((s) => s.projectId == selectedProjectId)
            .toList();

    return Container(
      width: 320,
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
        border: Border.all(color: context.rhythm.border),
        boxShadow: RhythmElevation.panel,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _SessionListHeader(
            // OPC-#710: primary button → instant-create (no dialog).
            onNewSession:
                canStartSession ? () => _instantCreateSession(context) : null,
            // OPC-#710: secondary "⋯" → full options dialog.
            onOptionsPressed:
                canStartSession ? () => _showNewSessionDialog(context) : null,
          ),
          if (selectedProject != null && selectedProject.vcsRoot != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: ProjectVcsChip(
                  project: selectedProject,
                  onRefresh: () =>
                      projectsController.refreshVcs(selectedProject.id),
                ),
              ),
            ),
          Divider(height: 1, color: context.rhythm.borderSubtle),
          const _DisconnectedBanner(),
          if (_hasMultiSelection)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              color: context.rhythm.accentMuted,
              child: Row(
                children: [
                  Text(
                    '${_multiSelected.length} selected',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: context.rhythm.accent,
                    ),
                  ),
                  const Spacer(),
                  TextButton(
                    onPressed: () => setState(() => _multiSelected.clear()),
                    style: TextButton.styleFrom(
                      minimumSize: Size.zero,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: const Text('Cancel'),
                  ),
                  const SizedBox(width: 6),
                  FilledButton.tonal(
                    onPressed: _confirmBulkDelete,
                    style: FilledButton.styleFrom(
                      backgroundColor:
                          Theme.of(context).colorScheme.error.withValues(
                                alpha: 0.18,
                              ),
                      foregroundColor: Theme.of(context).colorScheme.error,
                      minimumSize: const Size(0, 30),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                    ),
                    child: const Text('Delete'),
                  ),
                ],
              ),
            ),
          Expanded(
            child: controller.status == AgentsLoadStatus.loading &&
                    filteredSessions.isEmpty
                ? Center(
                    child: CircularProgressIndicator(
                      color: context.rhythm.accent,
                    ),
                  )
                : filteredSessions.isEmpty && controller.resumable.isEmpty
                    ? const _EmptySessionsState()
                    : ListView(
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 14),
                        children: [
                          // Active sessions (filtered by selected project).
                          for (final session in filteredSessions) ...[
                            _SessionRow(
                              session: session,
                              isSelected:
                                  controller.selectedSessionId == session.id,
                              isMultiSelected:
                                  _multiSelected.contains(session.id),
                              isWorking: controller.isWorking(session.id),
                              isStuck:
                                  controller.connectivity.isStuck(session.id),
                              onTap: () => _onRowTap(session.id),
                            ),
                            const SizedBox(height: 8),
                          ],
                          // Resumable section
                          if (controller.resumable.isNotEmpty) ...[
                            GestureDetector(
                              onTap: onToggleResumable,
                              child: Padding(
                                padding:
                                    const EdgeInsets.symmetric(vertical: 6),
                                child: Row(
                                  children: [
                                    Icon(
                                      resumableSectionExpanded
                                          ? Icons.expand_less
                                          : Icons.expand_more,
                                      size: 16,
                                      color: context.rhythm.textMuted,
                                    ),
                                    const SizedBox(width: 6),
                                    Text(
                                      'Resumable '
                                      '(${controller.resumable.length})',
                                      style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w700,
                                        color: context.rhythm.textMuted,
                                        letterSpacing: 0.6,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            if (resumableSectionExpanded)
                              for (final session in controller.resumable) ...[
                                _ResumableSessionRow(
                                  session: session,
                                  onResume: () => context
                                      .read<AgentsController>()
                                      .resumeSession(session.id),
                                ),
                                const SizedBox(height: 8),
                              ],
                          ],
                          // Archived section — collapsible, fetched on expand.
                          GestureDetector(
                            onTap: () async {
                              setState(() => _archivedSectionExpanded =
                                  !_archivedSectionExpanded);
                              if (_archivedSectionExpanded) {
                                await context
                                    .read<AgentsController>()
                                    .loadArchivedSessions();
                              }
                            },
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 6),
                              child: Row(
                                children: [
                                  Icon(
                                    _archivedSectionExpanded
                                        ? Icons.expand_less
                                        : Icons.expand_more,
                                    size: 16,
                                    color: context.rhythm.textMuted,
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    'Archived'
                                    ' (${controller.archived.length})',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                      color: context.rhythm.textMuted,
                                      letterSpacing: 0.6,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          if (_archivedSectionExpanded)
                            for (final session in controller.archived) ...[
                              _ArchivedSessionRow(
                                session: session,
                                onUnarchive: () => context
                                    .read<AgentsController>()
                                    .unarchiveSession(session.id),
                              ),
                              const SizedBox(height: 8),
                            ],
                        ],
                      ),
          ),
        ],
      ),
    );
  }

  /// OPC-#710 — Instant create: one click, no dialog.
  ///
  /// Creates an agent-less session in the selected project's cwd ($HOME
  /// fallback), immediately selects it, and focuses the composer. The session
  /// name starts empty; OpenCode auto-titles it after the first exchange via a
  /// `session.updated` event which the bridge maps to a WS SessionUpdatedMessage.
  Future<void> _instantCreateSession(BuildContext context) async {
    final projectsController = context.read<AgentProjectsController>();
    final controller = context.read<AgentsController>();
    final cwd = projectsController.selectedProject?.cwd ??
        Platform.environment['HOME'] ??
        '/tmp';
    final session = await controller.createSession(cwd: cwd);
    if (session != null) {
      controller.selectSession(session.id);
    }
  }

  void _showNewSessionDialog(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => ChangeNotifierProvider.value(
        value: context.read<AgentsController>(),
        child: ChangeNotifierProvider.value(
          value: context.read<TasksController>(),
          child: ChangeNotifierProvider.value(
            value: context.read<AgentServerController>(),
            child: ChangeNotifierProvider.value(
              value: context.read<AgentConfigsController>(),
              child: ChangeNotifierProvider.value(
                value: context.read<AgentProjectsController>(),
                child: const _NewSessionDialog(),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SessionListHeader extends StatelessWidget {
  const _SessionListHeader({
    required this.onNewSession,
    this.onOptionsPressed,
  });

  final VoidCallback? onNewSession;

  /// OPC-#710 — callback for the secondary "⋯" options button that opens the
  /// full _NewSessionDialog (cwd / branch / task / name).
  final VoidCallback? onOptionsPressed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Agent Sessions',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: context.rhythm.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Claude Code and Codex terminal sessions',
                      style: TextStyle(
                        fontSize: 12,
                        color: context.rhythm.textMuted,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.refresh, size: 18),
                tooltip: 'Refresh session list',
                onPressed: () => context.read<AgentsController>().load(),
                style: IconButton.styleFrom(
                  minimumSize: const Size(34, 34),
                  padding: EdgeInsets.zero,
                ),
              ),
              IconButton(
                icon: const Icon(Icons.settings_outlined, size: 18),
                tooltip: 'Agent settings',
                onPressed: () => showAgentSettingsSheet(context),
                style: IconButton.styleFrom(
                  minimumSize: const Size(34, 34),
                  padding: EdgeInsets.zero,
                ),
              ),
              const SizedBox(width: 6),
              if (onNewSession != null)
                FilledButton.tonal(
                  onPressed: onNewSession,
                  style: FilledButton.styleFrom(
                    backgroundColor: context.rhythm.accentMuted,
                    foregroundColor: context.rhythm.accent,
                    elevation: 0,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 10,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(RhythmRadius.md),
                    ),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.add, size: 16),
                      SizedBox(width: 4),
                      Text(
                        'New',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              // OPC-#710 — secondary "⋯" options button opens the full
              // _NewSessionDialog (explicit cwd / branch / task / name).
              if (onOptionsPressed != null)
                IconButton(
                  key: const Key('new-session-options-button'),
                  icon: const Icon(Icons.more_horiz, size: 18),
                  tooltip: 'Session options',
                  onPressed: onOptionsPressed,
                  style: IconButton.styleFrom(
                    minimumSize: const Size(30, 34),
                    padding: EdgeInsets.zero,
                    foregroundColor: context.rhythm.textMuted,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              const _AgentServerStatusDot(),
            ],
          ),
        ],
      ),
    );
  }
}

class _EmptySessionsState extends StatelessWidget {
  const _EmptySessionsState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.smart_toy_outlined,
              size: 34,
              color: context.rhythm.textMuted,
            ),
            const SizedBox(height: 10),
            Text(
              'No active agent sessions',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textPrimary,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'Start a new session to run Claude Code or Codex.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 12,
                color: context.rhythm.textMuted,
                height: 1.35,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SessionRow extends StatelessWidget {
  const _SessionRow({
    required this.session,
    required this.isSelected,
    required this.isWorking,
    required this.isStuck,
    required this.onTap,
    this.isMultiSelected = false,
  });

  final AgentSession session;
  final bool isSelected;
  final bool isMultiSelected;
  final bool isWorking;
  final bool isStuck;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final highlighted = isSelected || isMultiSelected;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(RhythmRadius.lg),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        curve: Curves.easeOut,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: highlighted
              ? context.rhythm.accentMuted
              : context.rhythm.surfaceMuted,
          borderRadius: BorderRadius.circular(RhythmRadius.lg),
          border: Border.all(
            color: isMultiSelected
                ? context.rhythm.accent
                : isSelected
                    ? context.rhythm.accent.withValues(alpha: 0.28)
                    : context.rhythm.border,
            width: isMultiSelected ? 2 : 1,
          ),
          boxShadow: highlighted
              ? [
                  BoxShadow(
                    color: context.rhythm.accent.withValues(alpha: 0.08),
                    blurRadius: 18,
                    offset: const Offset(0, 6),
                  ),
                ]
              : const [],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _AgentKindBadge(
                    agentId: session.agentId, providerId: session.providerId),
                const Spacer(),
                _StatusDot(status: session.status, isWorking: isWorking),
                const SizedBox(width: 4),
                _SessionRowMenu(session: session),
              ],
            ),
            const SizedBox(height: 6),
            // OPC-#710: empty name renders as "New session" placeholder
            // until the auto-title arrives via SessionUpdatedMessage.
            Text(
              session.name.isNotEmpty ? session.name : 'New session',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w700,
                color: session.name.isNotEmpty
                    ? context.rhythm.textPrimary
                    : context.rhythm.textMuted,
              ),
            ),
            if (session.lastPreview != null &&
                session.lastPreview!.isNotEmpty) ...[
              const SizedBox(height: 3),
              Text(
                session.lastPreview!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11,
                  color: context.rhythm.textMuted,
                  fontFamily: 'Menlo',
                ),
              ),
            ],
            if (isStuck)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  'No output yet — the agent may be stuck',
                  style: TextStyle(
                    fontSize: 10,
                    color: context.rhythm.warning,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ResumableSessionRow extends StatelessWidget {
  const _ResumableSessionRow({required this.session, required this.onResume});

  final AgentSession session;
  final VoidCallback onResume;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Row(
        children: [
          _AgentKindBadge(
              agentId: session.agentId, providerId: session.providerId),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              session.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textSecondary,
              ),
            ),
          ),
          TextButton(
            onPressed: onResume,
            style: TextButton.styleFrom(
              foregroundColor: context.rhythm.accent,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('Resume', style: TextStyle(fontSize: 12)),
          ),
        ],
      ),
    );
  }
}

/// Row for an archived session. Has "Restore" and "Delete permanently" actions.
class _ArchivedSessionRow extends StatelessWidget {
  const _ArchivedSessionRow({
    required this.session,
    required this.onUnarchive,
  });

  final AgentSession session;
  final VoidCallback onUnarchive;

  Future<void> _confirmDelete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete session permanently?'),
        content: Text(
          'This permanently removes "${session.name}" and all of its messages. '
          'This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (!context.mounted) return;
    await context.read<AgentsController>().deleteSession(session.id);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Row(
        children: [
          Icon(
            Icons.archive_outlined,
            size: 14,
            color: context.rhythm.textMuted,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              session.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w500,
                color: context.rhythm.textMuted,
              ),
            ),
          ),
          TextButton(
            onPressed: onUnarchive,
            style: TextButton.styleFrom(
              foregroundColor: context.rhythm.accent,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('Restore', style: TextStyle(fontSize: 12)),
          ),
          PopupMenuButton<String>(
            tooltip: 'More actions',
            icon: Icon(
              Icons.more_horiz,
              size: 15,
              color: context.rhythm.textMuted,
            ),
            padding: EdgeInsets.zero,
            iconSize: 15,
            splashRadius: 14,
            itemBuilder: (_) => [
              PopupMenuItem<String>(
                value: 'delete',
                child: Row(
                  children: [
                    Icon(
                      Icons.delete_outline,
                      size: 16,
                      color: Theme.of(context).colorScheme.error,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'Delete permanently',
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ],
                ),
              ),
            ],
            onSelected: (v) {
              if (v == 'delete') _confirmDelete(context);
            },
          ),
        ],
      ),
    );
  }
}

/// Maps a session-level provider ID (as stored in [AgentSession.providerId])
/// to the canonical agent config ID (as used in [AgentConfig.id] and the
/// agent_configs table seed).
///
/// This mirrors the PROVIDER_TO_AGENT map in the server's ws_gateway.ts:
///   anthropic      → claude-code
///   github-copilot → claude-code
///   openai         → codex
///   google         → gemini-cli
///
/// When a user picks a model via the unified picker, [_applyPick] stores
/// [CatalogModelEntry.provider] (e.g. 'openai') as the session's providerId —
/// NOT the agent config id ('codex'). The badge must map provider → config id
/// before calling [AgentConfigsController.byId]. (Issue #645.)
///
/// OPC-M1-3: The mapping is now fetched from [AgentServerController.providerToAgentKind]
/// (which reads it from the GET /agents/capabilities response) instead of a
/// hard-coded local constant. The controller provides an offline fallback.

class _AgentKindBadge extends StatelessWidget {
  const _AgentKindBadge({
    required this.agentId,
    this.providerId,
  });

  final String agentId;

  /// Optional session-level provider ID (e.g. 'openai', 'google', 'anthropic').
  /// Stored by [setSessionModel] via [_applyPick] which passes
  /// [CatalogModelEntry.provider]. When set, the badge maps this to the
  /// canonical agent config id via [AgentServerController.providerToAgentKind]
  /// so the pill reflects the actual agent in use rather than the stale
  /// session-creation agentId. (Issue #645 / OPC-M1-3.)
  final String? providerId;

  @override
  Widget build(BuildContext context) {
    // Issue #645 fix: use context.watch so the badge subscribes to
    // AgentConfigsController changes and rebuilds when configs are refreshed.
    final configsCtrl = context.watch<AgentConfigsController>();

    // OPC-M1-3: get providerToAgentKind from AgentServerController (populated
    // from capabilities endpoint; has offline fallback defaults).
    final providerToAgentKind =
        context.watch<AgentServerController>().providerToAgentKind;

    // Resolver precedence (mirroring server-side ws_gateway.ts logic):
    //   1. providerId → mapped agent config — when the user picked a model via
    //      setSessionModel, session.providerId stores the provider name (e.g.
    //      'openai'). Map it to the agent config id ('codex') and look up the
    //      config. If the mapped agent differs from agentId, prefer it so the
    //      pill reflects the actual agent in use.
    //   2. agentId — the session-creation agent; fallback when providerId is
    //      absent, unmapped, or resolves to the same agent.
    AgentConfig? config;
    if (providerId != null && providerId!.isNotEmpty) {
      final mappedKind = providerToAgentKind[providerId!];
      if (mappedKind != null && mappedKind != agentId) {
        config = configsCtrl.byId(mappedKind);
      }
    }
    config ??= configsCtrl.byId(agentId);
    return _AgentConfigBadge(agentId: agentId, config: config);
  }
}

/// Renders an agent badge pill using [AgentConfig] when available, or falls
/// back to displaying the raw [agentId] with a neutral style when the config
/// has been deleted.
class _AgentConfigBadge extends StatelessWidget {
  const _AgentConfigBadge({required this.agentId, required this.config});

  final String agentId;
  final AgentConfig? config;

  @override
  Widget build(BuildContext context) {
    final label = config?.label ?? agentId;
    final badgeColor =
        config != null ? context.rhythm.accent : context.rhythm.textMuted;
    final bgColor = badgeColor.withValues(alpha: 0.12);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (config != null) ...[
            AgentIcon(config!.icon, size: 12, fallbackLabel: config!.label),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: badgeColor,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusDot extends StatelessWidget {
  const _StatusDot({required this.status, required this.isWorking});

  final AgentSessionStatus status;
  final bool isWorking;

  @override
  Widget build(BuildContext context) {
    if (isWorking) {
      return SizedBox(
        width: 10,
        height: 10,
        child: CircularProgressIndicator(
          strokeWidth: 2,
          color: context.rhythm.accent,
        ),
      );
    }
    final color = switch (status) {
      AgentSessionStatus.starting => context.rhythm.warning,
      AgentSessionStatus.working => context.rhythm.accent,
      AgentSessionStatus.idle => context.rhythm.success,
      AgentSessionStatus.resumable => context.rhythm.textMuted,
      AgentSessionStatus.closed => context.rhythm.borderSubtle,
      // OPC-M1-4: error state shown as a red dot.
      AgentSessionStatus.error => context.rhythm.danger,
    };
    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

// ---------------------------------------------------------------------------
// Right panel — transcript + input
// ---------------------------------------------------------------------------

class _TranscriptPanel extends StatefulWidget {
  const _TranscriptPanel();

  @override
  State<_TranscriptPanel> createState() => _TranscriptPanelState();
}

class _TranscriptPanelState extends State<_TranscriptPanel> {
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();

  /// Whether the transcript is currently scrolled to (or near) the bottom.
  /// Auto-scroll-on-new-content only fires while this is true, so manually
  /// scrolling up to read a long message is no longer interrupted by the
  /// window snapping back to the bottom on every streaming delta.
  bool _pinnedToBottom = true;

  /// Distance (px) from the bottom within which we still consider the user
  /// "pinned" — small jitter / the tail of an animation shouldn't unpin.
  static const double _pinThreshold = 120;

  /// Issue #653: track which session ids have already had their composer
  /// draft consumed in this widget instance. Drafts are stored in
  /// AgentsController and consumed once on session selection.
  final Set<String> _draftConsumedForSession = <String>{};

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final pos = _scrollController.position;
    _pinnedToBottom = pos.maxScrollExtent - pos.pixels <= _pinThreshold;
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  /// Issue #653: on (re)build, if the selected session has a staged composer
  /// draft (set by the trigger bubble after createSession), consume it once
  /// into the input controller and surface it to the user as editable text.
  /// The user hits Enter to send the (possibly edited) draft as the normal
  /// first user turn — no server-seeded system message, no auto-prompt.
  void _maybeConsumeComposerDraft(
      BuildContext context, AgentSession? selected) {
    if (selected == null) return;
    final sessionId = selected.id;
    if (_draftConsumedForSession.contains(sessionId)) return;
    final controller = context.read<AgentsController>();
    if (!controller.hasComposerDraft(sessionId)) return;
    // Issue #656: do NOT consume (mutate controller state) or touch the input
    // controller synchronously during build. Mark this session handled now
    // (local State set, no notify) and defer the actual consume + prefill to a
    // post-frame callback. This guarantees no controller mutation happens in
    // the build phase, keeping transcript reactivity intact.
    _draftConsumedForSession.add(sessionId);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final draft = controller.consumeComposerDraft(sessionId);
      if (draft == null || draft.isEmpty) return;
      if (_inputController.text.isNotEmpty) return; // user already typed
      _inputController.value = TextEditingValue(
        text: draft,
        selection: TextSelection.collapsed(offset: draft.length),
      );
    });
  }

  void _sendInput(BuildContext context) {
    final controller = context.read<AgentsController>();
    final id = controller.selectedSessionId;
    if (id == null) return;
    final text = _inputController.text.trim();
    if (text.isEmpty) return;

    // OPC-M3-4: if the text starts with '/' and the command name (the first
    // word after the slash) is in the cached slash-command list for this session,
    // dispatch via the structured session.command WS frame. Otherwise, fall back
    // to plain session.input so free-typed slash text is not misrouted.
    if (text.startsWith('/')) {
      final withoutSlash = text.substring(1);
      final spaceIdx = withoutSlash.indexOf(' ');
      final cmdName =
          spaceIdx >= 0 ? withoutSlash.substring(0, spaceIdx) : withoutSlash;
      final cmdArgs =
          spaceIdx >= 0 ? withoutSlash.substring(spaceIdx + 1).trim() : '';
      final knownCommands = controller.slashCommandsFor(id);
      if (cmdName.isNotEmpty && knownCommands.any((c) => c.name == cmdName)) {
        controller.sendCommand(id, cmdName, cmdArgs);
        _inputController.clear();
        _scrollToBottom();
        return;
      }
    }

    controller.sendInput(id, '$text\n');
    _inputController.clear();
    _scrollToBottom();
  }

  void _scrollToBottom() {
    // An explicit scroll-to-bottom (e.g. the user just sent a message) also
    // re-pins, so subsequent streamed deltas keep following the bottom.
    _pinnedToBottom = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final selected = controller.selectedSession;

    // Auto-scroll when transcript changes — but ONLY if the user is already
    // at the bottom. If they've scrolled up to read, leave their position
    // alone (otherwise every streaming delta yanks them back down).
    if (selected != null && _pinnedToBottom) {
      _scrollToBottom();
    }

    // Issue #653: prefill composer with any staged draft (from trigger bubble).
    _maybeConsumeComposerDraft(context, selected);

    return Column(
      children: [
        // Pending trigger banners
        if (controller.pendingTriggers.isNotEmpty)
          for (final trigger in controller.pendingTriggers)
            _PendingTriggerBanner(trigger: trigger),
        Expanded(
          child: Container(
            decoration: BoxDecoration(
              color: context.rhythm.surfaceRaised,
              borderRadius: BorderRadius.circular(RhythmRadius.xl),
              border: Border.all(color: context.rhythm.border),
              boxShadow: RhythmElevation.panel,
            ),
            child: selected == null
                ? const _EmptyTranscriptState()
                // OPC-M3-6: when a child session is active, swap the main
                // transcript area to the child transcript view. The parent
                // transcript, composer, and tool bars are hidden; a breadcrumb
                // in ChildTranscriptView lets the user navigate back.
                : controller.activeChildSessionId != null
                    ? ChildTranscriptView(
                        childSdkId: controller.activeChildSessionId!,
                        parentSessionName:
                            controller.activeChildParentName ?? selected.name,
                        onBack: controller.closeChildSession,
                      )
                    : Column(
                        children: [
                          _TranscriptHeader(session: selected),
                          Divider(
                              height: 1, color: context.rhythm.borderSubtle),
                          // #602: agent-less sessions show a centred "choose model" prompt
                          // until the first message is sent.
                          if (selected.agentId == '__pending__' &&
                              controller.chatMessagesFor(selected.id).isEmpty &&
                              controller.transcript.isEmpty)
                            Expanded(
                              child: _AgentLessSessionPrompt(session: selected),
                            )
                          else
                            Expanded(
                              child: Container(
                                color: context.rhythm.canvas
                                    .withValues(alpha: 0.45),
                                child: _buildTranscriptBody(
                                  context,
                                  controller,
                                  selected,
                                ),
                              ),
                            ),
                          _PendingPermissionArea(session: selected),
                          _InputArea(
                            inputController: _inputController,
                            onSend: () => _sendInput(context),
                          ),
                        ],
                      ),
          ),
        ),
      ],
    );
  }

  Widget _buildTranscriptBody(
    BuildContext context,
    AgentsController controller,
    AgentSession session,
  ) {
    // OPC-M1-3: Single render path — parts-based chat only. The legacy
    // plain-text live-output buffer and transcript render branch have been
    // deleted. All messages arrive via chatMessagesFor() / chatPartsFor()
    // (rehydrated from REST on selectSession, then updated by WS events).
    //
    // OPC-M1-6 / issue #709 c4: filter out terminal-tab messages so shell
    // command outputs don't appear in the chat transcript.
    final terminalIds = controller.terminalMessageIdsFor(session.id);
    final allChatMessages = controller.chatMessagesFor(session.id);
    final chatMessages = terminalIds.isEmpty
        ? allChatMessages
        : allChatMessages.where((m) => !terminalIds.contains(m.id)).toList();

    if (chatMessages.isEmpty) {
      return Center(
        child: Text(
          'Session started. Waiting for output…',
          style: TextStyle(color: context.rhythm.textMuted, fontSize: 13),
        ),
      );
    }

    // OPC-M3-2: track whether the session has an active revert so we can
    // dim messages after the revert point and show the restore banner.
    final isReverted = controller.sessionIsReverted(session.id);

    return MessageTimeTicker(
      child: Column(
        children: [
          // OPC-M3-2: banner above the message list when a revert is active.
          RevertRestoreBanner(sessionId: session.id),
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
              itemCount: chatMessages.length,
              itemBuilder: (context, index) {
                final m = chatMessages[index];
                final parts = controller.chatPartsFor(m.id);
                // Collect full text for copy action.
                final copyText = parts.map((p) => p.text).join('').trim();
                // OPC-M2-4: show cost footer for assistant messages with a cost.
                final showCostFooter = m.role != 'user' && m.cost != null;
                // OPC-M3-2: dim reverted messages.
                final messageIsReverted = isReverted && m.isReverted;
                Widget bubble = Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _ChatBubble(
                      message: m,
                      parts: parts,
                      sessionId: session.id,
                      sessionName: session.name,
                    ),
                    if (showCostFooter)
                      Padding(
                        padding: const EdgeInsets.only(left: 4, top: 2),
                        child: ChatCostFooter(cost: m.cost, tokens: m.tokens),
                      ),
                    MessageActionsRow(
                      sessionId: session.id,
                      messageId: m.id,
                      createdAt: m.createdAt,
                      text: copyText,
                      role: m.role,
                      isReverted: messageIsReverted,
                    ),
                  ],
                );
                // OPC-M3-2: wrap reverted messages in an Opacity widget.
                if (messageIsReverted) {
                  bubble = Opacity(opacity: 0.45, child: bubble);
                }
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: bubble,
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _TranscriptHeader extends StatelessWidget {
  const _TranscriptHeader({required this.session});

  final AgentSession session;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final agentServerController = context.watch<AgentServerController>();
    final isWorking = controller.isWorking(session.id);
    final retrying = controller.retryingFor(session.id);
    final sessionTotal = controller.sessionTotalCost(session.id);
    final showReconnect =
        agentServerController.status != AgentServerStatus.ready ||
            controller.connectivity.isWsDisconnected;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      child: Row(
        children: [
          _AgentKindBadge(
              agentId: session.agentId, providerId: session.providerId),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              session.name,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: context.rhythm.textPrimary,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 8),
          // OPC-M2-4: show retrying indicator when the bridge relayed a retry.
          if (retrying != null) ...[
            RetryingIndicator(
              attempt: retrying.attempt,
              reason: retrying.reason,
            ),
            const SizedBox(width: 8),
          ],
          _StatusChip(status: session.status, isWorking: isWorking),
          const SizedBox(width: 8),
          // Stop an in-flight turn (escape hatch for a hung/stuck session).
          // Icon-only to match the other header actions and fit the narrow
          // (≤350px) header without overflowing.
          if (isWorking)
            IconButton(
              key: const Key('stop-turn-button'),
              onPressed: () =>
                  context.read<AgentsController>().cancelSession(session.id),
              icon: const Icon(Icons.stop_circle_outlined, size: 18),
              color: context.rhythm.danger,
              tooltip: 'Stop',
              visualDensity: VisualDensity.compact,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints.tightFor(width: 32, height: 32),
            ),
          // OPC-M2-4: session total cost displayed as a subtle label.
          if (sessionTotal != null) ...[
            Text(
              'Total: \$${sessionTotal.toStringAsFixed(4)}',
              style: TextStyle(
                fontSize: 11,
                color: context.rhythm.textMuted,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(width: 8),
          ],
          if (showReconnect) ...[
            OutlinedButton(
              onPressed: () =>
                  context.read<AgentsController>().reconnectSession(session.id),
              style: OutlinedButton.styleFrom(
                foregroundColor: context.rhythm.accent,
                side: BorderSide(color: context.rhythm.border),
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                ),
              ),
              child: const Text(
                'Reconnect',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
              ),
            ),
            const SizedBox(width: 6),
          ],
          // OPC-M3-3: compacting spinner shown while summarize is in-flight.
          if (controller.isCompacting(session.id)) ...[
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: context.rhythm.accent,
              ),
            ),
            const SizedBox(width: 8),
          ],
          // Session overflow menu (archive, compact, etc.).
          PopupMenuButton<String>(
            tooltip: 'Session actions',
            icon: Icon(
              Icons.more_vert,
              size: 18,
              color: context.rhythm.textSecondary,
            ),
            padding: EdgeInsets.zero,
            iconSize: 18,
            splashRadius: 16,
            itemBuilder: (_) => [
              PopupMenuItem<String>(
                value: 'compact',
                child: Row(
                  children: [
                    Icon(
                      Icons.compress,
                      size: 16,
                      color: context.rhythm.textSecondary,
                    ),
                    const SizedBox(width: 8),
                    const Text('Compact session'),
                  ],
                ),
              ),
            ],
            onSelected: (v) {
              if (v == 'compact') {
                context.read<AgentsController>().summarizeSession(session.id);
              }
            },
          ),
          IconButton(
            onPressed: () =>
                context.read<AgentsController>().closeSession(session.id),
            tooltip:
                agentServerController.isReady ? 'Close session' : 'Force close',
            icon: Icon(
              Icons.close,
              size: 18,
              color: context.rhythm.textSecondary,
            ),
            style: IconButton.styleFrom(
              minimumSize: const Size(32, 32),
              padding: EdgeInsets.zero,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status, required this.isWorking});

  final AgentSessionStatus status;
  final bool isWorking;

  @override
  Widget build(BuildContext context) {
    if (isWorking) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: context.rhythm.accentMuted,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 10,
              height: 10,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: context.rhythm.accent,
              ),
            ),
            const SizedBox(width: 5),
            Text(
              'Working',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: context.rhythm.accent,
              ),
            ),
          ],
        ),
      );
    }

    final (label, bgColor, textColor) = switch (status) {
      AgentSessionStatus.starting => (
          'Starting',
          context.rhythm.warning.withValues(alpha: 0.15),
          context.rhythm.warning,
        ),
      AgentSessionStatus.working => (
          'Working',
          context.rhythm.accentMuted,
          context.rhythm.accent,
        ),
      AgentSessionStatus.idle => (
          'Idle',
          context.rhythm.success.withValues(alpha: 0.15),
          context.rhythm.success,
        ),
      AgentSessionStatus.resumable => (
          'Resumable',
          context.rhythm.borderSubtle,
          context.rhythm.textMuted,
        ),
      AgentSessionStatus.closed => (
          'Closed',
          context.rhythm.borderSubtle,
          context.rhythm.textMuted,
        ),
      // OPC-M1-4: error state shown as a red badge.
      AgentSessionStatus.error => (
          'Error',
          context.rhythm.danger.withValues(alpha: 0.15),
          context.rhythm.danger,
        ),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: textColor,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Reasoning effort picker (#604)
// ---------------------------------------------------------------------------

/// Compact dropdown for selecting the per-session thinking budget.
/// Maps user-facing effort labels to budget_tokens values.
class _ThinkingBudgetPicker extends StatelessWidget {
  const _ThinkingBudgetPicker({required this.session});

  final AgentSession session;

  static const _labels = ['Low', 'Med', 'High', 'X-High', 'Max'];
  static const _budgets = [1024, 4096, 12288, 32768, 64000];

  String get _currentLabel {
    final b = session.thinkingBudget;
    if (b == null) return 'Off';
    final idx = _budgets.indexOf(b);
    return idx >= 0 ? _labels[idx] : '${(b / 1024).round()}K';
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();

    return Tooltip(
      message: 'Reasoning effort (thinking budget)',
      child: Container(
        height: 30,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        decoration: BoxDecoration(
          color: session.thinkingBudget != null
              ? context.rhythm.accentMuted
              : context.rhythm.surfaceMuted,
          borderRadius: BorderRadius.circular(RhythmRadius.md),
          border: Border.all(
            color: session.thinkingBudget != null
                ? context.rhythm.accent.withValues(alpha: 0.3)
                : context.rhythm.border,
          ),
        ),
        child: DropdownButtonHideUnderline(
          child: DropdownButton<int?>(
            value: session.thinkingBudget,
            isDense: true,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: session.thinkingBudget != null
                  ? context.rhythm.accent
                  : context.rhythm.textSecondary,
            ),
            dropdownColor: context.rhythm.surfaceRaised,
            icon: Icon(
              Icons.expand_more,
              size: 14,
              color: context.rhythm.textMuted,
            ),
            items: [
              DropdownMenuItem<int?>(
                value: null,
                child: Text(
                  'Off',
                  style: TextStyle(
                    fontSize: 11,
                    color: context.rhythm.textSecondary,
                  ),
                ),
              ),
              for (var i = 0; i < _labels.length; i++)
                DropdownMenuItem<int?>(
                  value: _budgets[i],
                  child: Text(
                    _labels[i],
                    style: TextStyle(
                      fontSize: 11,
                      color: context.rhythm.textPrimary,
                    ),
                  ),
                ),
            ],
            onChanged: (v) => controller.setThinkingBudget(session.id, v),
            hint: Text(
              _currentLabel,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textSecondary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Compact toggle button for per-session fast mode.
class _FastModeToggle extends StatelessWidget {
  const _FastModeToggle({required this.session});

  final AgentSession session;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final active = session.fastMode;

    return Tooltip(
      message: active ? 'Fast mode on — tap to disable' : 'Enable fast mode',
      child: InkWell(
        onTap: () => controller.setFastMode(session.id, enabled: !active),
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          height: 30,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          decoration: BoxDecoration(
            color: active
                ? context.rhythm.accentMuted
                : context.rhythm.surfaceMuted,
            borderRadius: BorderRadius.circular(RhythmRadius.md),
            border: Border.all(
              color: active
                  ? context.rhythm.accent.withValues(alpha: 0.3)
                  : context.rhythm.border,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.bolt,
                size: 14,
                color:
                    active ? context.rhythm.accent : context.rhythm.textMuted,
              ),
              const SizedBox(width: 3),
              Text(
                'Fast',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: active
                      ? context.rhythm.accent
                      : context.rhythm.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------

class _EmptyTranscriptState extends StatelessWidget {
  const _EmptyTranscriptState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 340,
        padding: const EdgeInsets.all(28),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceRaised,
          borderRadius: BorderRadius.circular(RhythmRadius.xl),
          border: Border.all(color: context.rhythm.border),
          boxShadow: RhythmElevation.panel,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.smart_toy_outlined,
              size: 36,
              color: context.rhythm.textMuted,
            ),
            const SizedBox(height: 12),
            Text(
              'Select a session',
              style: TextStyle(
                color: context.rhythm.textPrimary,
                fontSize: 15,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Transcript output and interactive input appear here.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: context.rhythm.textMuted,
                fontSize: 12,
                height: 1.35,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// OPC-M1-3: _MessageBlock removed (legacy AgentSessionMessage render widget
// deleted with the legacy render path).

/// Renders one ChatMessage and its ordered Parts.
/// User parts are right-aligned with an accent bubble; assistant parts are
/// left-aligned in a muted surface. Streaming deltas mutate part.text in
/// place — the same bubble re-renders larger on each notifyListeners().
class _ChatBubble extends StatelessWidget {
  const _ChatBubble({
    required this.message,
    required this.parts,
    required this.sessionId,
    this.sessionName = '',
  });

  final ChatMessage message;
  final List<ChatPart> parts;
  final String sessionId;

  /// Display name of the owning session — passed to TaskChip for breadcrumb.
  final String sessionName;

  @override
  Widget build(BuildContext context) {
    final isUser = message.role == 'user';

    if (isUser) {
      return _UserBubble(parts: parts);
    }

    // OPC-M3-4: command invocation row — shown for messages with role='command'
    // which are created optimistically when the user selects a slash command
    // from the popover. Renders as a monospace '/name args' label aligned left.
    if (message.role == 'command') {
      final invocationText = parts.map((p) => p.text).join('').trim();
      return _CommandInvocationRow(text: invocationText);
    }

    // Assistant bubble: walk parts in order, rendering text spans as a
    // SelectableText block and tool parts as collapsible ToolCallPart cards.
    final children = <Widget>[];
    final textBuffer = StringBuffer();

    void flushText() {
      final text = textBuffer.toString().trim();
      textBuffer.clear();
      if (text.isEmpty) return;
      // OPC-M2-1: render assistant text as markdown.
      children.add(
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: context.rhythm.surfaceMuted,
            borderRadius: BorderRadius.circular(RhythmRadius.md),
            border: Border.all(color: context.rhythm.borderSubtle),
          ),
          child: MarkdownMessageBody(text: text),
        ),
      );
    }

    for (final part in parts) {
      if (part.type == 'tool') {
        flushText();
        // Route `question` / AskUserQuestion tool calls to the interactive
        // answer selector. All other tool calls use the generic card.
        if (const {'question', 'askuserquestion'}
            .contains(part.toolName?.toLowerCase())) {
          children.add(
            QuestionToolCard(part: part, sessionId: sessionId),
          );
        } else {
          // OPC-M2-3: dispatch to a tool-specific renderer by name.
          children.add(_buildToolRenderer(part));
        }
      } else if (part.type == 'reasoning') {
        // OPC-M2-2: flush any accumulated text before the reasoning block,
        // then render it as a collapsible ReasoningBlock.
        flushText();
        children.add(
          ReasoningBlock(
            key: ValueKey('reasoning-${part.id}'),
            part: part,
          ),
        );
      } else if (part.type == 'step-start' || part.type == 'step-finish') {
        // Step boundary markers — hidden from the UI per spec (M2 scope).
        // Kept in the parts list for future inspector use.
      } else if (part.type == 'compaction') {
        // OPC-M3-3: flush any accumulated text, then render a full-width
        // compaction divider ("Conversation compacted" with expandable summary).
        flushText();
        children.add(CompactionDivider(
          key: ValueKey('compaction-${part.id}'),
          part: part,
        ));
      } else if (part.type == 'agent') {
        // OPC-M4-4: agent-switch marker — flush text then show "Switched to X".
        flushText();
        final name = part.agentName;
        if (name != null && name.isNotEmpty) {
          children.add(AgentPartMarker(
            key: ValueKey('agent-${part.id}'),
            agentName: name,
          ));
        }
      } else {
        // text and any future unknown part types — accumulate as prose.
        textBuffer.write(part.text);
      }
    }
    flushText();

    if (children.isEmpty) {
      // Awaiting first delta — render the "thinking" pip.
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceMuted,
          borderRadius: BorderRadius.circular(RhythmRadius.md),
          border: Border.all(color: context.rhythm.borderSubtle),
        ),
        child: Text(
          '…',
          style: TextStyle(color: context.rhythm.textMuted, fontSize: 12),
        ),
      );
    }

    if (children.length == 1) return children.first;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < children.length; i++) ...[
          if (i > 0) const SizedBox(height: 6),
          children[i],
        ],
      ],
    );
  }

  /// OPC-M2-3: dispatch a tool part to the appropriate renderer based on tool name.
  /// OPC-M3-6: TaskChip now receives parentSessionId + parentSessionName for navigation.
  ///
  /// Dispatch table:
  ///   edit / write / apply_patch → UnifiedDiffView (per-line +/- coloring)
  ///   bash                       → TerminalOutputView (monospace, ANSI stripped)
  ///   todowrite                  → TodoChecklistView (per-item checklist)
  ///   task                       → TaskChip (navigable chip; tapping opens child transcript)
  ///   read / glob / grep / webfetch / websearch / skill / plan / lsp
  ///     and any unrecognized name → ToolCallPart (generic card fallback)
  Widget _buildToolRenderer(ChatPart part) {
    final name = part.toolName?.toLowerCase() ?? '';
    if (const {'edit', 'write', 'apply_patch'}.contains(name)) {
      return UnifiedDiffView(part: part);
    }
    if (name == 'bash') {
      return TerminalOutputView(part: part);
    }
    if (name == 'todowrite') {
      return TodoChecklistView(part: part);
    }
    if (name == 'task') {
      // OPC-M3-6: pass parent context so the chip can navigate to the child
      // session transcript when tapped.
      return TaskChip(
        part: part,
        parentSessionId: sessionId,
        parentSessionName: sessionName,
      );
    }
    // read / glob / grep / webfetch / websearch / skill / plan / lsp
    // and any unrecognized tool → generic card.
    return ToolCallPart(part: part);
  }
}

/// OPC-M4-1: User bubble renders text, image thumbnails, and file chips.
///
/// Parts are rendered in order:
///   - `text` parts: prose SelectableText (unchanged from before M4-1)
///   - `file` parts with image MIME: bounded Image.memory thumbnail (max 200px)
///   - `file` parts with non-image MIME: filename chip
///
/// All file parts are keyed by `part.id` for test assertions.
class _UserBubble extends StatelessWidget {
  const _UserBubble({required this.parts});

  final List<ChatPart> parts;

  @override
  Widget build(BuildContext context) {
    final text =
        parts.where((p) => p.type == 'text').map((p) => p.text).join('').trim();
    final fileParts = parts.where((p) => p.type == 'file').toList();

    if (text.isEmpty && fileParts.isEmpty) return const SizedBox.shrink();

    return Align(
      alignment: Alignment.centerRight,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          mainAxisSize: MainAxisSize.min,
          children: [
            // OPC-M4-1: render file attachments above the text bubble.
            for (final fp in fileParts) _buildFilePart(context, fp),
            if (text.isNotEmpty)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: context.rhythm.accentMuted,
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                  border: Border.all(
                    color: context.rhythm.accent.withValues(alpha: 0.2),
                  ),
                ),
                child: SelectableText(
                  text,
                  style: TextStyle(
                    fontSize: 13,
                    color: context.rhythm.accent,
                    height: 1.4,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// Render one file part: image → thumbnail; other → filename chip.
  Widget _buildFilePart(BuildContext context, ChatPart part) {
    final mime = part.fileMime ?? '';
    final url = part.fileUrl ?? '';

    if (mime.startsWith('image/') && url.contains(';base64,')) {
      // Decode the data URI payload.
      final b64 = url.substring(url.indexOf(';base64,') + 8);
      try {
        final bytes = base64Decode(b64);
        return Padding(
          padding: const EdgeInsets.only(bottom: 4),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(RhythmRadius.sm),
            child: Image.memory(
              bytes,
              key: Key('file-image-thumbnail-${part.id}'),
              width: 200,
              height: 200,
              fit: BoxFit.contain,
              // Fallback when bytes are invalid.
              errorBuilder: (_, __, ___) => _buildFileChip(context, part),
            ),
          ),
        );
      } catch (_) {
        // Base64 decode failed — fall through to chip.
      }
    }

    return _buildFileChip(context, part);
  }

  /// Non-image file → a compact filename chip.
  Widget _buildFileChip(BuildContext context, ChatPart part) {
    final filename = part.fileFilename ?? 'file';
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Container(
        key: Key('file-chip-${part.id}'),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: context.rhythm.accentMuted,
          borderRadius: BorderRadius.circular(RhythmRadius.pill),
          border: Border.all(
            color: context.rhythm.accent.withValues(alpha: 0.25),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.attach_file,
              size: 12,
              color: context.rhythm.accent,
            ),
            const SizedBox(width: 4),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 200),
              child: Text(
                filename,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11,
                  color: context.rhythm.accent,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// OPC-M3-4: Command invocation row — rendered for ChatMessage.role == 'command'.
///
/// Displays the slash command text (e.g. '/help' or '/init my-project') as a
/// distinct pill aligned to the right, styled like the user bubble but using
/// the `accentMuted` / `accent` palette so it is visually distinct from both
/// plain user prose (same alignment) and assistant output.
///
/// Uses `RhythmColorRoles` tokens — no hard-coded colours.
class _CommandInvocationRow extends StatelessWidget {
  const _CommandInvocationRow({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    if (text.isEmpty) return const SizedBox.shrink();
    return Align(
      alignment: Alignment.centerRight,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: context.rhythm.accentMuted,
            borderRadius: BorderRadius.circular(RhythmRadius.md),
            border: Border.all(
              color: context.rhythm.accent.withValues(alpha: 0.35),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.terminal_outlined,
                size: 13,
                color: context.rhythm.accent,
              ),
              const SizedBox(width: 6),
              Flexible(
                child: SelectableText(
                  text,
                  style: TextStyle(
                    fontSize: 13,
                    fontFamily: 'Menlo',
                    fontWeight: FontWeight.w600,
                    color: context.rhythm.accent,
                    height: 1.3,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// OPC-M1-3: _LiveOutputBlock removed (legacy PTY output render path deleted).

// ---------------------------------------------------------------------------
// Pending permissions area (#608)
// ---------------------------------------------------------------------------

/// Renders inline [PermissionCard] widgets for each pending permission in the
/// active session. When [DestructiveModalService.enabled] is true and the tool
/// is destructive, the PermissionCard itself elevates to a modal dialog.
class _PendingPermissionArea extends StatelessWidget {
  const _PendingPermissionArea({required this.session});

  final AgentSession session;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    // DestructiveModalService is watched here so the card can read it.
    context.watch<DestructiveModalService>();
    final pending = controller.pendingPermissionsFor(session.id);
    if (pending.isEmpty) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.fromLTRB(18, 8, 18, 0),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: context.rhythm.borderSubtle)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final p in pending)
            PermissionCard(
              key: ValueKey('perm-${session.id}-${p.permissionId}'),
              sessionId: session.id,
              permissionId: p.permissionId,
              title: 'Allow ${p.toolName}?',
              toolName: p.toolName,
              description: p.summary.isNotEmpty ? p.summary : null,
            ),
        ],
      ),
    );
  }
}

/// #602 — Redesigned input area.
///
/// Bottom-left cluster: model picker pill + permission mode pill + file-attach
/// button + reasoning/fast-mode "Tuning" pill (collapsed using Wrap).
/// Attached files are shown as chips above the text field.
class _InputArea extends StatefulWidget {
  const _InputArea({required this.inputController, required this.onSend});

  final TextEditingController inputController;
  final VoidCallback onSend;

  @override
  State<_InputArea> createState() => _InputAreaState();
}

class _InputAreaState extends State<_InputArea> {
  /// OPC-M4-1: Pick files, read bytes, build data URIs, and add to the
  /// controller's pending-attachment list for the active session.
  Future<void> _pickFiles() async {
    final result = await FilePicker.pickFiles(allowMultiple: true);
    if (result == null) return;
    final controller = context.read<AgentsController>();
    final id = controller.selectedSessionId;
    if (id == null) return;
    for (final f in result.files) {
      final path = f.path;
      if (path == null) continue;
      try {
        final bytes = await File(path).readAsBytes();
        final mime = resolveAttachmentMime(bytes, f.name, f.extension);
        final dataUri = 'data:$mime;base64,${base64Encode(bytes)}';
        controller.addPendingAttachment(id, {
          'type': 'file',
          'mime': mime,
          'filename': f.name,
          'url': dataUri,
        });
      } catch (_) {
        // File read error — skip this attachment silently.
      }
    }
  }

  void _send() {
    final controller = context.read<AgentsController>();
    final id = controller.selectedSessionId;
    if (id == null) return;
    final text = widget.inputController.text.trim();
    final pending = controller.pendingAttachmentsFor(id);
    if (text.isEmpty && pending.isEmpty) return;

    if (pending.isNotEmpty) {
      // OPC-M4-1: send with parts array (text + file parts).
      // sendInput merges the controller-held pending attachments internally.
      controller.sendInput(id, '${text}\n');
      widget.inputController.clear();
    } else {
      widget.onSend();
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final session = controller.selectedSession;
    // OPC-M4-1: pending attachments from the controller, keyed by session.
    final pendingAttachments = session != null
        ? controller.pendingAttachmentsFor(session.id)
        : const <Map<String, dynamic>>[];

    // OPC-M3-3: compute input token count for the context-usage hint.
    final lastInputTokens = session != null
        ? controller.lastAssistantInputTokens(session.id)
        : null;

    return Container(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 18),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: context.rhythm.borderSubtle)),
        color: context.rhythm.surfaceRaised,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // OPC-M4-1: Attachment chips driven by controller state.
          if (pendingAttachments.isNotEmpty) ...[
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (var i = 0; i < pendingAttachments.length; i++)
                  _AttachmentChipWidget(
                    key: Key('attachment-chip-$i'),
                    filename:
                        (pendingAttachments[i]['filename'] as String?) ?? '',
                    mime: (pendingAttachments[i]['mime'] as String?) ?? '',
                    onRemove: () {
                      if (session != null) {
                        controller.removePendingAttachment(session.id, i);
                      }
                    },
                    removeKey: Key('attachment-chip-$i-remove'),
                  ),
              ],
            ),
            const SizedBox(height: 8),
          ],
          // OPC-M3-3: context-usage hint chip — visible when input tokens are
          // approaching the context limit (default threshold: 80% of 150k).
          ContextUsageHint(inputTokens: lastInputTokens),
          if (lastInputTokens != null &&
              lastInputTokens >=
                  (ContextUsageHint.kDefaultContextLimit *
                          ContextUsageHint.kThresholdFraction)
                      .round()) ...[
            const SizedBox(height: 6),
          ],
          // Text field
          SlashCommandPopover(
            inputController: widget.inputController,
            commands: controller.slashCommands,
            onCommandSelected: (cmd) {
              widget.inputController.value = TextEditingValue(
                text: cmd,
                selection: TextSelection.collapsed(offset: cmd.length),
              );
            },
            child: Focus(
              onKeyEvent: (node, event) {
                if (event is KeyDownEvent &&
                    event.logicalKey == LogicalKeyboardKey.enter &&
                    !HardwareKeyboard.instance.isShiftPressed) {
                  _send();
                  return KeyEventResult.handled;
                }
                return KeyEventResult.ignored;
              },
              child: TextField(
                controller: widget.inputController,
                style: TextStyle(
                  fontSize: 13,
                  fontFamily: 'Menlo',
                  color: context.rhythm.textPrimary,
                ),
                maxLines: 3,
                minLines: 1,
                onSubmitted: (_) => _send(),
                decoration: InputDecoration(
                  hintText:
                      'Type a command or reply… (Shift+Enter for newline)',
                  hintStyle: TextStyle(
                    color: context.rhythm.textMuted,
                    fontSize: 13,
                    fontFamily: 'Menlo',
                  ),
                  isDense: true,
                  filled: true,
                  fillColor: context.rhythm.canvas.withValues(alpha: 0.6),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(RhythmRadius.lg),
                    borderSide: BorderSide(color: context.rhythm.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(RhythmRadius.lg),
                    borderSide: BorderSide(color: context.rhythm.border),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(RhythmRadius.lg),
                    borderSide: BorderSide(color: context.rhythm.accent),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          // Bottom row: left cluster (pickers) + right (Send)
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              // Left cluster: model picker + permission mode + file-attach +
              // reasoning/fast-mode (Wrap so narrow windows don't overflow)
              Expanded(
                child: Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (session != null)
                      UnifiedAgentModelPicker(session: session),
                    if (session != null) PermissionModePicker(session: session),
                    // OPC-M4-4: agent selector pill (after permission mode picker)
                    AgentSelectorPill(sessionId: session?.id),
                    if (session != null) ...[
                      _ThinkingBudgetPicker(session: session),
                      _FastModeToggle(session: session),
                    ],
                    // File-attach button
                    Tooltip(
                      message: 'Attach files',
                      child: InkWell(
                        onTap: _pickFiles,
                        borderRadius: BorderRadius.circular(RhythmRadius.md),
                        child: Container(
                          height: 30,
                          padding: const EdgeInsets.symmetric(horizontal: 8),
                          decoration: BoxDecoration(
                            color: context.rhythm.surfaceMuted,
                            borderRadius:
                                BorderRadius.circular(RhythmRadius.md),
                            border: Border.all(color: context.rhythm.border),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.attach_file,
                                size: 14,
                                color: context.rhythm.textSecondary,
                              ),
                              if (pendingAttachments.isNotEmpty) ...[
                                const SizedBox(width: 3),
                                Text(
                                  '${pendingAttachments.length}',
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                    color: context.rhythm.accent,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              // Send button
              FilledButton(
                onPressed: _send,
                style: FilledButton.styleFrom(
                  backgroundColor: context.rhythm.accent,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 22,
                    vertical: 12,
                  ),
                  minimumSize: const Size(88, 40),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
                child: const Text(
                  'Send',
                  style: TextStyle(
                    fontSize: 13,
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// OPC-M4-1: Attachment chip widget
// ---------------------------------------------------------------------------

/// Shows one pending attachment chip (filename + remove button).
/// Driven by the controller's pending attachments list.
class _AttachmentChipWidget extends StatelessWidget {
  const _AttachmentChipWidget({
    super.key,
    required this.filename,
    required this.mime,
    required this.onRemove,
    this.removeKey,
  });

  final String filename;
  final String mime;
  final VoidCallback onRemove;
  final Key? removeKey;

  @override
  Widget build(BuildContext context) {
    final isImage = mime.startsWith('image/');
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: context.rhythm.accentMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.pill),
        border: Border.all(
          color: context.rhythm.accent.withValues(alpha: 0.3),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            isImage ? Icons.image_outlined : Icons.attach_file,
            size: 11,
            color: context.rhythm.accent,
          ),
          const SizedBox(width: 4),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 180),
            child: Text(
              filename.isNotEmpty ? filename : 'file',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11,
                color: context.rhythm.accent,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          const SizedBox(width: 4),
          GestureDetector(
            key: removeKey,
            onTap: onRemove,
            child: Icon(
              Icons.close,
              size: 12,
              color: context.rhythm.accent.withValues(alpha: 0.7),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// #602 — Agent-less session prompt ("Choose a model to begin")
// ---------------------------------------------------------------------------

/// Shown in the transcript area when a session has agentId == '__pending__'
/// and no messages have been sent yet.
class _AgentLessSessionPrompt extends StatelessWidget {
  const _AgentLessSessionPrompt({required this.session});

  final AgentSession session;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 380,
        padding: const EdgeInsets.all(32),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceRaised,
          borderRadius: BorderRadius.circular(RhythmRadius.xl),
          border: Border.all(color: context.rhythm.border),
          boxShadow: RhythmElevation.panel,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.model_training_outlined,
              size: 40,
              color: context.rhythm.textMuted,
            ),
            const SizedBox(height: 16),
            Text(
              'Choose a model to begin',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: context.rhythm.textPrimary,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'Select a model from the picker in the composer below, '
              'then type your first message.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13,
                color: context.rhythm.textSecondary,
                height: 1.45,
              ),
            ),
            const SizedBox(height: 20),
            UnifiedAgentModelPicker(session: session),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Pending trigger banner
// ---------------------------------------------------------------------------

class _PendingTriggerBanner extends StatelessWidget {
  const _PendingTriggerBanner({required this.trigger});

  final PendingTrigger trigger;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          color: context.rhythm.warning.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(RhythmRadius.lg),
          border: Border.all(
            color: context.rhythm.warning.withValues(alpha: 0.3),
          ),
        ),
        child: Row(
          children: [
            Icon(Icons.auto_awesome, size: 16, color: context.rhythm.warning),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                "Task '${trigger.taskTitle}' is waiting for an agent.",
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: context.rhythm.textPrimary,
                ),
              ),
            ),
            const SizedBox(width: 8),
            _TriggerActionButton(
              label: 'Start Claude',
              color: const Color(0xFF6B46C1),
              onPressed: () => _startAgent(context, 'claude-code', trigger),
            ),
            const SizedBox(width: 6),
            _TriggerActionButton(
              label: 'Start Codex',
              color: const Color(0xFF059669),
              onPressed: () => _startAgent(context, 'codex', trigger),
            ),
            const SizedBox(width: 6),
            TextButton(
              onPressed: () => context.read<AgentsController>().dismissTrigger(
                    trigger.taskId,
                  ),
              style: TextButton.styleFrom(
                foregroundColor: context.rhythm.textSecondary,
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text('Dismiss', style: TextStyle(fontSize: 12)),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _startAgent(
    BuildContext context,
    String agentId,
    PendingTrigger trigger,
  ) async {
    final controller = context.read<AgentsController>();
    final session = await controller.createSession(
      agentId: agentId,
      taskId: trigger.taskId,
      cwd: Platform.environment['HOME'] ?? '/',
      name: trigger.taskTitle,
    );
    if (session != null) {
      controller.dismissTrigger(trigger.taskId);
      controller.selectSession(session.id);
    }
  }
}

class _TriggerActionButton extends StatelessWidget {
  const _TriggerActionButton({
    required this.label,
    required this.color,
    required this.onPressed,
  });

  final String label;
  final Color color;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onPressed,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: color,
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// New Session dialog
// ---------------------------------------------------------------------------

class _NewSessionDialog extends StatefulWidget {
  const _NewSessionDialog();

  @override
  State<_NewSessionDialog> createState() => _NewSessionDialogState();
}

class _NewSessionDialogState extends State<_NewSessionDialog> {
  final _nameController = TextEditingController();
  final _cwdController = TextEditingController();
  Task? _selectedTask;
  bool _isSubmitting = false;
  String? _error;
  int? _errorStatus;

  // Branch selection state (only shown when selected project has a vcsRoot).
  String? _selectedBranch; // null = keep current branch
  List<String> _localBranches = [];
  List<String> _recentBranches = [];
  String? _currentBranch;
  bool _loadingBranches = false;
  bool _newBranchMode = false;
  final _newBranchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    // Default the cwd to the selected project's folder when one is active;
    // otherwise fall back to $HOME. Read once in initState — the user can
    // still type a different path manually.
    final projectsCtrl = context.read<AgentProjectsController>();
    final selectedProject = projectsCtrl.selectedProject;
    if (selectedProject != null && selectedProject.cwd.isNotEmpty) {
      _cwdController.text = selectedProject.cwd;
    } else {
      _cwdController.text = Platform.environment['HOME'] ?? '~';
    }

    // #602: no default agent to compute — model is chosen in the composer.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      // Load tasks if not already loaded.
      final tasksController = context.read<TasksController>();
      if (tasksController.tasks.isEmpty &&
          tasksController.status != TasksStatus.loading) {
        tasksController.load();
      }

      // Load branches for the selected project if it has a vcsRoot.
      final project = context.read<AgentProjectsController>().selectedProject;
      if (project != null && project.vcsRoot != null) {
        await _loadBranches(project.id);
      }
    });
  }

  Future<void> _loadBranches(String projectId) async {
    if (!mounted) return;
    setState(() => _loadingBranches = true);
    try {
      final branches =
          await context.read<AgentProjectsController>().listBranches(projectId);
      if (!mounted) return;
      setState(() {
        _currentBranch = branches.current;
        _localBranches = branches.local;
        _recentBranches = branches.recent;
        _selectedBranch ??= branches.current; // default to current
        _loadingBranches = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loadingBranches = false);
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _cwdController.dispose();
    _newBranchController.dispose();
    super.dispose();
  }

  bool get _canSubmit =>
      _nameController.text.trim().isNotEmpty && !_isSubmitting;

  Future<void> _submit() async {
    if (!_canSubmit) return;

    // Resolve the target branch.
    final targetBranch =
        _newBranchMode ? _newBranchController.text.trim() : _selectedBranch;
    final createBranch =
        _newBranchMode && targetBranch != null && targetBranch.isNotEmpty;

    // If switching to a different branch on a dirty tree, ask what to do.
    final project = context.read<AgentProjectsController>().selectedProject;
    final isDirty = project?.vcsDirty ?? false;
    final isSwitchingBranch =
        targetBranch != null && targetBranch != _currentBranch;

    String? stashMode;
    if (isSwitchingBranch && isDirty && !createBranch) {
      final choice = await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Working tree has uncommitted changes'),
          content: const Text(
            'The working directory has unsaved changes. '
            'What should happen to them before switching branches?',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(null),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop('stash'),
              child: const Text('Stash'),
            ),
          ],
        ),
      );
      if (choice == null) return; // user cancelled
      stashMode = choice;
    }

    setState(() {
      _isSubmitting = true;
      _error = null;
      _errorStatus = null;
    });

    final controller = context.read<AgentsController>();
    // #602: always create agent-less sessions; model is chosen in the composer.
    final session = await controller.createSession(
      agentId: null,
      taskId: _selectedTask?.id,
      cwd: _cwdController.text.trim().isEmpty
          ? (Platform.environment['HOME'] ?? '/')
          : _cwdController.text.trim(),
      name: _nameController.text.trim(),
      branch: isSwitchingBranch || createBranch ? targetBranch : null,
      stash: stashMode,
      createBranch: createBranch,
    );

    if (!mounted) return;
    setState(() => _isSubmitting = false);

    if (session == null) {
      setState(() {
        _error = controller.error ?? 'Failed to create session.';
        _errorStatus = controller.lastErrorStatus;
      });
      return;
    }

    Navigator.of(context).pop();
    controller.selectSession(session.id);
  }

  @override
  Widget build(BuildContext context) {
    final tasksController = context.watch<TasksController>();
    // agentServerController and agentConfigs still watched so the view
    // rebuilds on capability changes (branch loading etc.).
    context.watch<AgentServerController>();
    context.watch<AgentConfigsController>();
    final tasks = tasksController.tasks
        .where((t) => t.status != TaskStatus.done)
        .toList();

    return AlertDialog(
      backgroundColor: context.rhythm.surfaceRaised,
      surfaceTintColor: context.rhythm.surfaceRaised,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
        side: BorderSide(color: context.rhythm.border),
      ),
      title: Text(
        'New agent session',
        style: TextStyle(
          fontSize: 17,
          fontWeight: FontWeight.w700,
          color: context.rhythm.textPrimary,
        ),
      ),
      content: SizedBox(
        width: 440,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Session name
            Text(
              'Session name',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textSecondary,
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: _nameController,
              autofocus: true,
              style: TextStyle(fontSize: 14, color: context.rhythm.textPrimary),
              decoration: _inputDecoration(
                context,
                hint: 'e.g. Fix auth bug',
                label: 'Session name (required)',
              ),
              onChanged: (_) => setState(() {}),
              onSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 14),

            // #602: agent selector removed — model is chosen in the composer after session starts.

            // Task selector (optional)
            Text(
              'Linked task (optional)',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textSecondary,
              ),
            ),
            const SizedBox(height: 6),
            DropdownButtonFormField<Task?>(
              value: _selectedTask,
              isExpanded: true,
              dropdownColor: context.rhythm.surfaceRaised,
              decoration: _inputDecoration(context, hint: 'No task linked'),
              style: TextStyle(fontSize: 13, color: context.rhythm.textPrimary),
              items: [
                DropdownMenuItem<Task?>(
                  value: null,
                  child: Text(
                    'No task linked',
                    style: TextStyle(color: context.rhythm.textMuted),
                  ),
                ),
                ...tasks.map(
                  (t) => DropdownMenuItem<Task?>(
                    value: t,
                    child: Text(
                      t.title,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: context.rhythm.textPrimary),
                    ),
                  ),
                ),
              ],
              onChanged: (task) => setState(() {
                _selectedTask = task;
              }),
            ),
            const SizedBox(height: 14),

            // Working directory
            Text(
              'Working directory',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textSecondary,
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: _cwdController,
              style: TextStyle(
                fontSize: 13,
                fontFamily: 'Menlo',
                color: context.rhythm.textPrimary,
              ),
              decoration: _inputDecoration(context, hint: '~/'),
            ),

            // Branch selector — only shown when the selected project has a
            // vcsRoot and branches have been (or are being) loaded.
            if (context
                    .read<AgentProjectsController>()
                    .selectedProject
                    ?.vcsRoot !=
                null) ...[
              const SizedBox(height: 14),
              Text(
                'Branch',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: context.rhythm.textSecondary,
                ),
              ),
              const SizedBox(height: 6),
              if (_loadingBranches)
                Row(
                  children: [
                    SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: context.rhythm.accent,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'Loading branches…',
                      style: TextStyle(
                        fontSize: 12,
                        color: context.rhythm.textMuted,
                      ),
                    ),
                  ],
                )
              else if (_newBranchMode)
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _newBranchController,
                        autofocus: true,
                        style: TextStyle(
                          fontSize: 13,
                          fontFamily: 'Menlo',
                          color: context.rhythm.textPrimary,
                        ),
                        decoration: _inputDecoration(
                          context,
                          hint: 'new-branch-name',
                        ),
                        onChanged: (_) => setState(() {}),
                        onSubmitted: (_) => _submit(),
                      ),
                    ),
                    const SizedBox(width: 8),
                    TextButton(
                      onPressed: () => setState(() {
                        _newBranchMode = false;
                        _newBranchController.clear();
                      }),
                      child: const Text('Cancel'),
                    ),
                  ],
                )
              else
                DropdownButtonFormField<String>(
                  value: _selectedBranch,
                  isExpanded: true,
                  dropdownColor: context.rhythm.surfaceRaised,
                  decoration: _inputDecoration(context, hint: 'Current branch'),
                  style: TextStyle(
                    fontSize: 13,
                    fontFamily: 'Menlo',
                    color: context.rhythm.textPrimary,
                  ),
                  items: [
                    // Current branch first (acts as the "keep" option).
                    if (_currentBranch != null)
                      DropdownMenuItem<String>(
                        value: _currentBranch,
                        child: Row(
                          children: [
                            Icon(
                              Icons.check,
                              size: 14,
                              color: context.rhythm.accent,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              _currentBranch!,
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                color: context.rhythm.textPrimary,
                              ),
                            ),
                          ],
                        ),
                      ),
                    // Recent branches (de-duplicated against current).
                    for (final b in _recentBranches)
                      if (b != _currentBranch)
                        DropdownMenuItem<String>(
                          value: b,
                          child: Text(b),
                        ),
                    // Remaining local branches not already shown.
                    for (final b in _localBranches)
                      if (b != _currentBranch && !_recentBranches.contains(b))
                        DropdownMenuItem<String>(
                          value: b,
                          child: Text(b),
                        ),
                    // Sentinel for "create new branch".
                    DropdownMenuItem<String>(
                      value: '__new__',
                      child: Row(
                        children: [
                          Icon(
                            Icons.add,
                            size: 14,
                            color: context.rhythm.accent,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            'New branch from current',
                            style: TextStyle(color: context.rhythm.accent),
                          ),
                        ],
                      ),
                    ),
                  ],
                  onChanged: (val) {
                    if (val == '__new__') {
                      setState(() {
                        _newBranchMode = true;
                        _selectedBranch = _currentBranch;
                      });
                    } else {
                      setState(() => _selectedBranch = val);
                    }
                  },
                ),
            ],

            if (_error != null) ...[
              const SizedBox(height: 12),
              if (_errorStatus != null && _errorStatus! >= 500)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Something went wrong on the server.',
                      style: TextStyle(
                        color: context.rhythm.danger,
                        fontSize: 12,
                      ),
                    ),
                    Theme(
                      data: Theme.of(
                        context,
                      ).copyWith(dividerColor: Colors.transparent),
                      child: ExpansionTile(
                        tilePadding: EdgeInsets.zero,
                        title: Text(
                          'Details',
                          style: TextStyle(
                            color: context.rhythm.textSecondary,
                            fontSize: 12,
                          ),
                        ),
                        children: [
                          Align(
                            alignment: Alignment.centerLeft,
                            child: Text(
                              _error!,
                              style: TextStyle(
                                color: context.rhythm.textSecondary,
                                fontSize: 12,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                )
              else
                Text(
                  _error!,
                  style: TextStyle(color: context.rhythm.danger, fontSize: 12),
                ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isSubmitting ? null : () => Navigator.of(context).pop(),
          child: Text(
            'Cancel',
            style: TextStyle(color: context.rhythm.textSecondary),
          ),
        ),
        FilledButton(
          onPressed: _canSubmit ? _submit : null,
          style: FilledButton.styleFrom(backgroundColor: context.rhythm.accent),
          child: _isSubmitting
              ? SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : const Text('Start', style: TextStyle(color: Colors.white)),
        ),
      ],
    );
  }

  InputDecoration _inputDecoration(
    BuildContext context, {
    String? hint,
    String? label,
  }) {
    return InputDecoration(
      hintText: hint,
      labelText: label,
      hintStyle: TextStyle(color: context.rhythm.textMuted, fontSize: 13),
      labelStyle: TextStyle(color: context.rhythm.textSecondary, fontSize: 13),
      filled: true,
      fillColor: context.rhythm.surfaceMuted,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        borderSide: BorderSide(color: context.rhythm.borderSubtle),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        borderSide: BorderSide(color: context.rhythm.borderSubtle),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        borderSide: BorderSide(color: context.rhythm.accent),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Disconnected banner (inline, inside session list panel)
// ---------------------------------------------------------------------------

class _DisconnectedBanner extends StatelessWidget {
  const _DisconnectedBanner();

  @override
  Widget build(BuildContext context) {
    final agentServerController = context.watch<AgentServerController>();
    final agentsController = context.watch<AgentsController>();

    final serverReady = agentServerController.status == AgentServerStatus.ready;
    final wsDisconnected = agentsController.connectivity.isWsDisconnected;

    if (serverReady && !wsDisconnected) {
      return const SizedBox.shrink();
    }

    final String message;
    if (agentServerController.status != AgentServerStatus.ready) {
      message =
          agentServerController.errorMessage ?? 'Agent server unavailable';
    } else {
      message = 'Connection lost — reconnecting…';
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: context.rhythm.danger.withValues(alpha: 0.10),
        border: Border(
          bottom: BorderSide(
            color: context.rhythm.danger.withValues(alpha: 0.25),
          ),
        ),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, size: 15, color: context.rhythm.danger),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w500,
                color: context.rhythm.danger,
                height: 1.35,
              ),
            ),
          ),
          const SizedBox(width: 8),
          TextButton(
            onPressed: () => context.read<AgentServerController>().retry(),
            style: TextButton.styleFrom(
              foregroundColor: context.rhythm.danger,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              textStyle: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
              ),
            ),
            child: const Text('Restart agent server'),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Agent server status dot
// ---------------------------------------------------------------------------

class _AgentServerStatusDot extends StatelessWidget {
  const _AgentServerStatusDot();

  @override
  Widget build(BuildContext context) {
    final status = context.watch<AgentServerController>().status;
    final (color, label) = switch (status) {
      AgentServerStatus.ready => (context.rhythm.success, 'Agent server ready'),
      AgentServerStatus.starting => (
          context.rhythm.warning,
          'Agent server starting',
        ),
      AgentServerStatus.failed => (
          context.rhythm.danger,
          'Agent server failed',
        ),
    };
    return Tooltip(
      message: label,
      child: Container(
        width: 8,
        height: 8,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
    );
  }
}

/// Three-dot trailing menu on each session row. For now the only action is
/// hard-delete (#598 follow-up); archive lives in #601.
class _SessionRowMenu extends StatelessWidget {
  const _SessionRowMenu({required this.session});

  final AgentSession session;

  Future<void> _confirmDelete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete session?'),
        content: Text(
          'This permanently removes "${session.name}" and all of its messages. '
          'This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (!context.mounted) return;
    await context.read<AgentsController>().deleteSession(session.id);
  }

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      tooltip: 'Session actions',
      icon: Icon(
        Icons.more_horiz,
        size: 16,
        color: context.rhythm.textMuted,
      ),
      padding: EdgeInsets.zero,
      iconSize: 16,
      splashRadius: 16,
      itemBuilder: (_) => [
        PopupMenuItem<String>(
          value: 'archive',
          child: Row(
            children: [
              Icon(
                Icons.archive_outlined,
                size: 16,
                color: context.rhythm.textSecondary,
              ),
              const SizedBox(width: 8),
              const Text('Archive'),
            ],
          ),
        ),
        PopupMenuItem<String>(
          value: 'delete',
          child: Row(
            children: [
              Icon(
                Icons.delete_outline,
                size: 16,
                color: Theme.of(context).colorScheme.error,
              ),
              const SizedBox(width: 8),
              Text(
                'Delete session',
                style: TextStyle(
                  color: Theme.of(context).colorScheme.error,
                ),
              ),
            ],
          ),
        ),
      ],
      onSelected: (v) {
        if (v == 'archive') {
          context.read<AgentsController>().archiveSession(session.id);
        } else if (v == 'delete') {
          _confirmDelete(context);
        }
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Test harnesses — expose private badge widgets for widget tests.
// Issue #645: all four badge render sites must be exercised individually.
// ---------------------------------------------------------------------------

/// A thin public wrapper around [_AgentKindBadge] for use in widget tests.
///
/// Allows tests to pump and assert on the agent pill without needing the full
/// [AgentsView] widget tree. Requires [AgentConfigsController] in the Provider
/// tree above it.
@visibleForTesting
class AgentKindBadgeTestHarness extends StatelessWidget {
  const AgentKindBadgeTestHarness({
    super.key,
    required this.agentId,
    this.providerId,
  });

  final String agentId;
  final String? providerId;

  @override
  Widget build(BuildContext context) {
    return _AgentKindBadge(agentId: agentId, providerId: providerId);
  }
}

/// Public wrapper around [_ResumableSessionRow] for use in widget tests.
///
/// Requires [AgentConfigsController] in the Provider tree above it.
/// Issue #645 site #2 — the resumable row must pass session.providerId to the
/// badge so a model switch is reflected correctly.
@visibleForTesting
class ResumableSessionRowTestHarness extends StatelessWidget {
  const ResumableSessionRowTestHarness({
    super.key,
    required this.session,
    this.onResume,
  });

  final AgentSession session;
  final VoidCallback? onResume;

  @override
  Widget build(BuildContext context) {
    return _ResumableSessionRow(
      session: session,
      onResume: onResume ?? () {},
    );
  }
}

// ---------------------------------------------------------------------------
// OPC-M3-6: ChildTranscriptView — read-only transcript for a child session.
// ---------------------------------------------------------------------------

/// A read-only transcript panel for a child (subagent) session.
///
/// Displays the messages fetched into [AgentsController] for [childSdkId],
/// with a breadcrumb row that lets the user navigate back to the parent
/// session via [onBack].
///
/// This widget does NOT have a composer or tool bars — child sessions are
/// observed, not interacted with from the parent view.
///
/// Exported (public) so tests can import it from agents_view.dart.
class ChildTranscriptView extends StatelessWidget {
  const ChildTranscriptView({
    super.key,
    required this.childSdkId,
    required this.parentSessionName,
    required this.onBack,
  });

  final String childSdkId;
  final String parentSessionName;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final messages = controller.childMessagesFor(childSdkId);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Breadcrumb row.
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: context.rhythm.surfaceMuted,
            border: Border(
              bottom: BorderSide(color: context.rhythm.borderSubtle),
            ),
          ),
          child: Row(
            children: [
              GestureDetector(
                onTap: onBack,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.chevron_left,
                      size: 18,
                      color: context.rhythm.accent,
                    ),
                    const SizedBox(width: 2),
                    Text(
                      parentSessionName,
                      style: TextStyle(
                        fontSize: 12,
                        color: context.rhythm.accent,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(
                Icons.chevron_right,
                size: 14,
                color: context.rhythm.textMuted,
              ),
              const SizedBox(width: 4),
              Text(
                'Subagent',
                style: TextStyle(
                  fontSize: 12,
                  color: context.rhythm.textSecondary,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
        // Message list.
        Expanded(
          child: messages.isEmpty
              ? Center(
                  child: Text(
                    'No messages in this subagent session.',
                    style: TextStyle(
                      color: context.rhythm.textMuted,
                      fontSize: 13,
                    ),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
                  itemCount: messages.length,
                  itemBuilder: (context, index) {
                    final m = messages[index];
                    final isUser = m.role == 'input' || m.role == 'user';
                    // Use strippedText for display (rawText may contain ANSI).
                    final displayText =
                        m.strippedText.isNotEmpty ? m.strippedText : m.rawText;
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: isUser
                          ? Align(
                              alignment: Alignment.centerRight,
                              child: Container(
                                constraints:
                                    const BoxConstraints(maxWidth: 560),
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 12, vertical: 8),
                                decoration: BoxDecoration(
                                  color: context.rhythm.accentMuted,
                                  borderRadius:
                                      BorderRadius.circular(RhythmRadius.md),
                                  border: Border.all(
                                    color: context.rhythm.accent
                                        .withValues(alpha: 0.2),
                                  ),
                                ),
                                child: Text(
                                  displayText,
                                  style: TextStyle(
                                    fontSize: 13,
                                    color: context.rhythm.accent,
                                    height: 1.4,
                                  ),
                                ),
                              ),
                            )
                          : Container(
                              width: double.infinity,
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: context.rhythm.surfaceMuted,
                                borderRadius:
                                    BorderRadius.circular(RhythmRadius.md),
                                border: Border.all(
                                    color: context.rhythm.borderSubtle),
                              ),
                              child: Text(
                                displayText,
                                style: TextStyle(
                                  fontSize: 13,
                                  color: context.rhythm.textPrimary,
                                  height: 1.4,
                                ),
                              ),
                            ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// OPC-M4-1: MIME inference helper
// ---------------------------------------------------------------------------

/// Infer a MIME type from a file extension.
/// Falls back to 'application/octet-stream' for unknown extensions.
// ---------------------------------------------------------------------------
// OPC-M4-4: Agent selector pill + agent-part marker
// ---------------------------------------------------------------------------

/// A pill-shaped button that shows the currently selected agent for the active
/// session and opens a dropdown to switch between available agents.
///
/// Rendered in [_InputArea]'s bottom row, after [PermissionModePicker].
/// Exported as a public class so `opc_m4_4_agent_selection_test.dart` can
/// find it in the widget tree by type.
///
/// When [sessionId] is null the widget renders nothing.
class AgentSelectorPill extends StatelessWidget {
  const AgentSelectorPill({super.key, required this.sessionId});

  final String? sessionId;

  @override
  Widget build(BuildContext context) {
    final sid = sessionId;
    if (sid == null) return const SizedBox.shrink();

    final ctrl = context.watch<AgentsController>();
    final agents = ctrl.availableAgentsFor(sid);
    final selected = ctrl.selectedAgentFor(sid);
    final label = selected ?? 'build';

    return PopupMenuButton<String>(
      tooltip: 'Switch agent',
      // Constrain the popup width so it doesn't span the full screen.
      constraints: const BoxConstraints(maxWidth: 220),
      itemBuilder: (_) => [
        // "Default" option always shown so the user can clear selection.
        PopupMenuItem<String>(
          value: '',
          child: Text(
            'build (default)',
            style: TextStyle(
              fontSize: 12,
              color: context.rhythm.textSecondary,
            ),
          ),
        ),
        for (final a in agents)
          PopupMenuItem<String>(
            value: a.name,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  a.name,
                  style: const TextStyle(fontSize: 13),
                ),
                if (a.description != null)
                  Text(
                    a.description!,
                    style: TextStyle(
                      fontSize: 11,
                      color: context.rhythm.textMuted,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ),
          ),
      ],
      onSelected: (value) {
        ctrl.setSelectedAgent(sid, value.isEmpty ? null : value);
      },
      child: Container(
        height: 30,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        decoration: BoxDecoration(
          color: selected != null
              ? context.rhythm.accentMuted
              : context.rhythm.surfaceMuted,
          borderRadius: BorderRadius.circular(RhythmRadius.md),
          border: Border.all(
            color: selected != null
                ? context.rhythm.accent
                : context.rhythm.border,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.smart_toy_outlined,
              size: 13,
              color: selected != null
                  ? context.rhythm.accent
                  : context.rhythm.textSecondary,
            ),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: selected != null
                    ? context.rhythm.accent
                    : context.rhythm.textSecondary,
              ),
            ),
            const SizedBox(width: 2),
            Icon(
              Icons.arrow_drop_down,
              size: 14,
              color: selected != null
                  ? context.rhythm.accent
                  : context.rhythm.textSecondary,
            ),
          ],
        ),
      ),
    );
  }
}

/// A labeled marker rendered inline in the transcript for `agent`-type parts.
///
/// Shown as a subtle chip: "Switched to plan" (using the agent name from the
/// part). Exported so tests can find it by type.
class AgentPartMarker extends StatelessWidget {
  const AgentPartMarker({super.key, required this.agentName});

  final String agentName;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(
          Icons.swap_horiz,
          size: 13,
          color: context.rhythm.textMuted,
        ),
        const SizedBox(width: 4),
        Text(
          'Switched to $agentName',
          style: TextStyle(
            fontSize: 11,
            fontStyle: FontStyle.italic,
            color: context.rhythm.textMuted,
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// OPC-M4-1: Test harnesses (@visibleForTesting)
// ---------------------------------------------------------------------------

/// A harness that renders the real [_InputArea] inside a minimal scaffold with
/// a live [AgentsController]. Used by `opc_m4_1_attachments_test.dart` (c3) to
/// assert that the composer chip UI and remove-button behavior match the real
/// widget tree wired in [AgentsView] → [_TranscriptPanel] → [_InputArea].
///
/// Exported (`@visibleForTesting`) rather than private so the test file can
/// reference it by name without depending on the internal widget hierarchy.
@visibleForTesting
class InputAreaTestHarness extends StatefulWidget {
  const InputAreaTestHarness({super.key});

  @override
  State<InputAreaTestHarness> createState() => _InputAreaTestHarnessState();
}

class _InputAreaTestHarnessState extends State<InputAreaTestHarness> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // The real _InputArea is private — we test via a minimal Scaffold that
    // mirrors how _TranscriptPanel embeds it.
    return _InputArea(
      inputController: _controller,
      onSend: () {},
    );
  }
}

/// A harness that renders [_UserBubble] for a given list of [ChatPart]s.
/// Used by `opc_m4_1_attachments_test.dart` (c4, c5) to assert that file
/// parts render as thumbnails or filename chips.
@visibleForTesting
class UserBubbleTestHarness extends StatelessWidget {
  const UserBubbleTestHarness({super.key, required this.parts});

  final List<ChatPart> parts;

  @override
  Widget build(BuildContext context) {
    return _UserBubble(parts: parts);
  }
}

/// Public wrapper around [_TranscriptHeader] for use in widget tests.
///
/// Requires [AgentConfigsController] and [AgentsController] in the Provider
/// tree above it.
/// Issue #645 site #3 — the transcript header must pass session.providerId to
/// the badge so a model switch is reflected correctly.
@visibleForTesting
class TranscriptHeaderTestHarness extends StatelessWidget {
  const TranscriptHeaderTestHarness({super.key, required this.session});

  final AgentSession session;

  @override
  Widget build(BuildContext context) {
    return _TranscriptHeader(session: session);
  }
}

// ---------------------------------------------------------------------------
// OPC-#710 test harnesses
// ---------------------------------------------------------------------------

/// Public wrapper around [_SessionListHeader] for use in widget tests.
///
/// Exposes both the [onNewSession] (instant-create) and [onOptionsPressed]
/// (advanced dialog) callbacks so tests can assert the correct path is taken
/// without having to mount the full [AgentsView] Provider tree.
///
/// Requires [AgentsController] in the Provider tree (the header's refresh
/// button and settings sheet use context.read<AgentsController>).
@visibleForTesting
class SessionListHeaderTestHarness extends StatelessWidget {
  const SessionListHeaderTestHarness({
    super.key,
    required this.onNewSession,
    this.onOptionsPressed,
  });

  final VoidCallback? onNewSession;
  final VoidCallback? onOptionsPressed;

  @override
  Widget build(BuildContext context) {
    return _SessionListHeader(
      onNewSession: onNewSession,
      onOptionsPressed: onOptionsPressed,
    );
  }
}

/// Public wrapper around [_SessionRow] for use in widget tests.
///
/// Renders a single session row without the full session-list scaffold.
/// Used by OPC-#710 tests to assert the "New session" placeholder renders
/// correctly when [session.name] is empty.
@visibleForTesting
class SessionRowTestHarness extends StatelessWidget {
  const SessionRowTestHarness({super.key, required this.session});

  final AgentSession session;

  @override
  Widget build(BuildContext context) {
    return _SessionRow(
      session: session,
      isSelected: false,
      isWorking: false,
      isStuck: false,
      onTap: () {},
    );
  }
}
