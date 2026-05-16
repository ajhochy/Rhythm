import 'dart:io';

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
import '../models/agent_session_message.dart';
import '../models/chat_models.dart';
import '_agent_settings_sheet.dart';
import '_project_vcs_chip.dart';
import '_projects_rail.dart';
import '_session_model_picker.dart';
import '_tool_call_part.dart';

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
            onNewSession:
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
                        ],
                      ),
          ),
        ],
      ),
    );
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
  const _SessionListHeader({required this.onNewSession});

  final VoidCallback? onNewSession;

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
                _AgentKindBadge(agentId: session.agentId),
                const Spacer(),
                _StatusDot(status: session.status, isWorking: isWorking),
                const SizedBox(width: 4),
                _SessionRowMenu(session: session),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              session.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w700,
                color: context.rhythm.textPrimary,
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
          _AgentKindBadge(agentId: session.agentId),
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

class _AgentKindBadge extends StatelessWidget {
  const _AgentKindBadge({required this.agentId});

  final String agentId;

  @override
  Widget build(BuildContext context) {
    final config = context.read<AgentConfigsController>().byId(agentId);
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

  @override
  void dispose() {
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _sendInput(BuildContext context) {
    final controller = context.read<AgentsController>();
    final id = controller.selectedSessionId;
    if (id == null) return;
    final text = _inputController.text;
    if (text.isEmpty) return;
    controller.sendInput(id, '$text\n');
    _inputController.clear();
    _scrollToBottom();
  }

  void _scrollToBottom() {
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

    // Auto-scroll when transcript changes.
    if (selected != null) {
      _scrollToBottom();
    }

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
                : Column(
                    children: [
                      _TranscriptHeader(session: selected),
                      Divider(height: 1, color: context.rhythm.borderSubtle),
                      Expanded(
                        child: Container(
                          color: context.rhythm.canvas.withValues(alpha: 0.45),
                          child: _buildTranscriptBody(
                            context,
                            controller,
                            selected,
                          ),
                        ),
                      ),
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
    // Parts-based chat (Opencode Desktop port). Each ChatMessage holds an
    // ordered list of ChatParts; streaming deltas append to part.text in
    // place so the same bubble grows.
    final chatMessages = controller.chatMessagesFor(session.id);
    final legacyTranscript = controller.transcript;
    final liveOutput = controller.liveOutputFor(session.id);
    final hasChat = chatMessages.isNotEmpty;
    final hasLegacy = legacyTranscript.isNotEmpty || liveOutput.isNotEmpty;

    if (!hasChat && !hasLegacy) {
      return Center(
        child: Text(
          'Session started. Waiting for output…',
          style: TextStyle(color: context.rhythm.textMuted, fontSize: 13),
        ),
      );
    }

    // Prefer the parts-based chat when the server emits the new events.
    if (hasChat) {
      return ListView.builder(
        controller: _scrollController,
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
        itemCount: chatMessages.length,
        itemBuilder: (context, index) {
          final m = chatMessages[index];
          final parts = controller.chatPartsFor(m.id);
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _ChatBubble(message: m, parts: parts),
          );
        },
      );
    }

    // Legacy fallback (older servers / replay path).
    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
      itemCount: legacyTranscript.length + (liveOutput.isNotEmpty ? 1 : 0),
      itemBuilder: (context, index) {
        if (index < legacyTranscript.length) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _MessageBlock(message: legacyTranscript[index]),
          );
        }
        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: _LiveOutputBlock(text: liveOutput),
        );
      },
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
    final showReconnect =
        agentServerController.status != AgentServerStatus.ready ||
            controller.connectivity.isWsDisconnected;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
      child: Row(
        children: [
          _AgentKindBadge(agentId: session.agentId),
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
          _StatusChip(status: session.status, isWorking: isWorking),
          const SizedBox(width: 8),
          SessionModelPicker(session: session),
          const SizedBox(width: 8),
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

class _MessageBlock extends StatelessWidget {
  const _MessageBlock({required this.message});

  final AgentSessionMessage message;

  @override
  Widget build(BuildContext context) {
    final isInput = message.role == 'input';
    final isSystem = message.role == 'system';

    if (isInput) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: context.rhythm.accentMuted,
          borderRadius: BorderRadius.circular(RhythmRadius.md),
          border: Border.all(
            color: context.rhythm.accent.withValues(alpha: 0.2),
          ),
        ),
        child: SelectableText(
          message.strippedText,
          style: TextStyle(
            fontSize: 12,
            fontStyle: FontStyle.italic,
            color: context.rhythm.accent.withValues(alpha: 0.85),
            height: 1.4,
          ),
        ),
      );
    }

    if (isSystem) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: SelectableText(
          message.strippedText,
          style: TextStyle(
            fontSize: 11,
            color: context.rhythm.textMuted,
            fontStyle: FontStyle.italic,
          ),
        ),
      );
    }

    // output
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: SelectableText(
        message.strippedText,
        style: TextStyle(
          fontSize: 12,
          fontFamily: 'Menlo',
          color: context.rhythm.textPrimary,
          height: 1.5,
        ),
      ),
    );
  }
}

/// Renders one ChatMessage and its ordered Parts.
/// User parts are right-aligned with an accent bubble; assistant parts are
/// left-aligned in a muted surface. Streaming deltas mutate part.text in
/// place — the same bubble re-renders larger on each notifyListeners().
class _ChatBubble extends StatelessWidget {
  const _ChatBubble({required this.message, required this.parts});

  final ChatMessage message;
  final List<ChatPart> parts;

  @override
  Widget build(BuildContext context) {
    final isUser = message.role == 'user';

    if (isUser) {
      return _UserBubble(parts: parts);
    }

    // Assistant bubble: walk parts in order, rendering text spans as a
    // SelectableText block and tool parts as collapsible ToolCallPart cards.
    final children = <Widget>[];
    final textBuffer = StringBuffer();

    void flushText() {
      final text = textBuffer.toString().trim();
      textBuffer.clear();
      if (text.isEmpty) return;
      children.add(
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: context.rhythm.surfaceMuted,
            borderRadius: BorderRadius.circular(RhythmRadius.md),
            border: Border.all(color: context.rhythm.borderSubtle),
          ),
          child: SelectableText(
            text,
            style: TextStyle(
              fontSize: 13,
              color: context.rhythm.textPrimary,
              height: 1.5,
            ),
          ),
        ),
      );
    }

    for (final part in parts) {
      if (part.type == 'tool') {
        flushText();
        children.add(ToolCallPart(part: part));
      } else {
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
}

class _UserBubble extends StatelessWidget {
  const _UserBubble({required this.parts});

  final List<ChatPart> parts;

  @override
  Widget build(BuildContext context) {
    final text = parts.map((p) => p.text).join('').trim();
    if (text.isEmpty) return const SizedBox.shrink();
    return Align(
      alignment: Alignment.centerRight,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
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
      ),
    );
  }
}

class _LiveOutputBlock extends StatelessWidget {
  const _LiveOutputBlock({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: context.rhythm.accent.withValues(alpha: 0.2)),
      ),
      child: SelectableText(
        text,
        style: TextStyle(
          fontSize: 12,
          fontFamily: 'Menlo',
          color: context.rhythm.textPrimary,
          height: 1.5,
        ),
      ),
    );
  }
}

class _InputArea extends StatelessWidget {
  const _InputArea({required this.inputController, required this.onSend});

  final TextEditingController inputController;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 18),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: context.rhythm.borderSubtle)),
        color: context.rhythm.surfaceRaised,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Text(
                'Send input',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: context.rhythm.textPrimary,
                ),
              ),
              const Spacer(),
              Text(
                'Enter to send',
                style: TextStyle(fontSize: 11, color: context.rhythm.textMuted),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Focus(
            onKeyEvent: (node, event) {
              // Enter sends; Shift+Enter inserts a newline.
              if (event is KeyDownEvent &&
                  event.logicalKey == LogicalKeyboardKey.enter &&
                  !HardwareKeyboard.instance.isShiftPressed) {
                onSend();
                return KeyEventResult.handled;
              }
              return KeyEventResult.ignored;
            },
            child: TextField(
              controller: inputController,
              style: TextStyle(
                fontSize: 13,
                fontFamily: 'Menlo',
                color: context.rhythm.textPrimary,
              ),
              maxLines: 3,
              minLines: 1,
              onSubmitted: (_) => onSend(),
              decoration: InputDecoration(
                hintText: 'Type a command or reply… (Shift+Enter for newline)',
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
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: onSend,
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
          ),
        ],
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
  String _agentId = '';
  Task? _selectedTask;
  bool _isSubmitting = false;
  String? _error;
  int? _errorStatus;

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

    // Compute the default agent: first enabled config whose CLI is installed,
    // falling back to the first enabled config if none are installed.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      final agentConfigs = context.read<AgentConfigsController>();
      final agentServerController = context.read<AgentServerController>();
      // Refresh capabilities on dialog open — the initial fetch happens
      // before the Opencode SDK finishes booting, so `opencode` is often
      // stale-false until we re-poll.
      await agentServerController.refreshCapabilities();
      if (!mounted) return;
      final enabledAgents = agentConfigs.enabledAgents;
      if (enabledAgents.isNotEmpty && _agentId.isEmpty) {
        final firstInstalled = enabledAgents.firstWhere(
          (c) => agentServerController.isAgentAvailable(c.id),
          orElse: () => enabledAgents.first,
        );
        setState(() => _agentId = firstInstalled.id);
      }

      // Load tasks if not already loaded.
      final tasksController = context.read<TasksController>();
      if (tasksController.tasks.isEmpty &&
          tasksController.status != TasksStatus.loading) {
        tasksController.load();
      }
    });
  }

  @override
  void dispose() {
    _nameController.dispose();
    _cwdController.dispose();
    super.dispose();
  }

  bool get _canSubmit =>
      _nameController.text.trim().isNotEmpty && !_isSubmitting;

  Future<void> _submit() async {
    if (!_canSubmit) return;
    setState(() {
      _isSubmitting = true;
      _error = null;
      _errorStatus = null;
    });

    final controller = context.read<AgentsController>();
    final session = await controller.createSession(
      agentId: _agentId,
      taskId: _selectedTask?.id,
      cwd: _cwdController.text.trim().isEmpty
          ? (Platform.environment['HOME'] ?? '/')
          : _cwdController.text.trim(),
      name: _nameController.text.trim(),
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
    final agentServerController = context.watch<AgentServerController>();
    final agentConfigs = context.watch<AgentConfigsController>();
    final enabledAgents = agentConfigs.enabledAgents;
    final tasks = tasksController.tasks
        .where((t) => t.status != TaskStatus.done)
        .toList();

    // If the currently selected agent is not in the enabled list, pick a
    // better default: first installed, otherwise first enabled.
    if (enabledAgents.isNotEmpty &&
        !enabledAgents.any((c) => c.id == _agentId)) {
      final firstInstalled = enabledAgents.firstWhere(
        (c) => agentServerController.isAgentAvailable(c.id),
        orElse: () => enabledAgents.first,
      );
      _agentId = firstInstalled.id;
    }

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

            // Agent kind — render one toggle per enabled config.
            if (enabledAgents.isNotEmpty) ...[
              Text(
                'Agent',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: context.rhythm.textSecondary,
                ),
              ),
              const SizedBox(height: 6),
              Container(
                decoration: BoxDecoration(
                  color: context.rhythm.surfaceMuted,
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                  border: Border.all(color: context.rhythm.borderSubtle),
                ),
                child: Row(
                  children: [
                    for (final config in enabledAgents)
                      Expanded(
                        child: _AgentToggleButton(
                          label: config.label,
                          selected: _agentId == config.id,
                          color: _colorForAgent(config.id),
                          enabled: agentServerController.isAgentAvailable(
                            config.id,
                          ),
                          disabledLabel: '(not installed)',
                          onTap:
                              agentServerController.isAgentAvailable(config.id)
                                  ? () => setState(() => _agentId = config.id)
                                  : null,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
            ],

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
                if (task != null && task.preferredAgent != null) {
                  _agentId = task.preferredAgent!;
                }
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

  Color _colorForAgent(String id) => switch (id) {
        'claude-code' => const Color(0xFF6B46C1),
        'codex' => const Color(0xFF059669),
        _ => context.rhythm.accent,
      };

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

class _AgentToggleButton extends StatelessWidget {
  const _AgentToggleButton({
    required this.label,
    required this.selected,
    required this.color,
    required this.onTap,
    this.enabled = true,
    this.disabledLabel,
  });

  final String label;
  final bool selected;
  final Color color;
  final VoidCallback? onTap;
  final bool enabled;
  final String? disabledLabel;

  @override
  Widget build(BuildContext context) {
    final effectiveColor = enabled ? color : context.rhythm.textMuted;
    final Widget content = AnimatedContainer(
      duration: const Duration(milliseconds: 140),
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: selected && enabled ? color : Colors.transparent,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
      ),
      alignment: Alignment.center,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: selected && enabled
                  ? Colors.white
                  : enabled
                      ? context.rhythm.textSecondary
                      : context.rhythm.textMuted,
            ),
          ),
          if (!enabled && disabledLabel != null) ...[
            const SizedBox(height: 2),
            Text(
              disabledLabel!,
              style: TextStyle(fontSize: 10, color: effectiveColor),
            ),
          ],
        ],
      ),
    );

    return IgnorePointer(
      ignoring: !enabled,
      child: GestureDetector(onTap: onTap, child: content),
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
          value: 'delete',
          child: Row(
            children: [
              Icon(
                Icons.delete_outline,
                size: 16,
                color: Theme.of(context).colorScheme.error,
              ),
              const SizedBox(width: 8),
              const Text('Delete session'),
            ],
          ),
        ),
      ],
      onSelected: (v) {
        if (v == 'delete') _confirmDelete(context);
      },
    );
  }
}
