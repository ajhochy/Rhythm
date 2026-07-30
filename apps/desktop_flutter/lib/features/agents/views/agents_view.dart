import 'dart:async';
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
import '../../settings/views/settings_view.dart';
import '../../settings/data/anthropic_accounts_data_source.dart';
import '../../tasks/controllers/tasks_controller.dart';
import '../../tasks/models/task.dart';
import '../../agent_projects/controllers/agent_projects_controller.dart';
import '../../agent_projects/views/edit_project_dialog.dart';
import '../controllers/agents_controller.dart';
import '../models/agent_session.dart';
import '../models/agent_session_message.dart';
import '../models/chat_models.dart';
import '../../settings/services/destructive_modal_service.dart';
import '_at_mention_popover.dart';
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
import '_agents_nav_column.dart';
import '_session_list_body.dart';
import '_slash_command_popover.dart';
import '_question_tool_card.dart';
import '_tool_call_part.dart';
import '_tool_renderers/_unified_diff_view.dart';
import '_tool_renderers/_terminal_output_view.dart';
import '_tool_renderers/_todo_checklist_view.dart';
import '_tool_renderers/_task_chip.dart';
import '_unified_agent_model_picker.dart';

/// OCU-24 (#1065) — result of parsing a composer message for the "!cmd" shell
/// prefix. Exactly one of [command] / [text] is non-null:
///   - [command] set → the message should run as `session.shell` instead of a
///     chat turn (leading "!" stripped, remainder trimmed).
///   - [text] set → the message should send as a normal chat turn. A leading
///     "\!" is unescaped to a literal "!" here.
class ComposerShellParse {
  const ComposerShellParse.shell(this.command) : text = null;
  const ComposerShellParse.text(this.text) : command = null;

  final String? command;
  final String? text;
}

/// Parses [trimmed] (already-trimmed composer text) for the "!"/"\!" prefix
/// convention. Pure function — no BuildContext/controller dependency — so it
/// is directly unit-testable.
ComposerShellParse parseComposerShellPrefix(String trimmed) {
  if (trimmed.startsWith(r'\!')) {
    return ComposerShellParse.text(trimmed.substring(1));
  }
  if (trimmed.startsWith('!')) {
    return ComposerShellParse.shell(trimmed.substring(1).trim());
  }
  return ComposerShellParse.text(trimmed);
}

class AgentsView extends StatefulWidget {
  const AgentsView({super.key});

  @override
  State<AgentsView> createState() => _AgentsViewState();
}

class _AgentsViewState extends State<AgentsView> {
  bool _resumableSectionExpanded = false;
  bool _navCollapsed = false;

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
          child: _buildWorkspace(context),
        ),
      ),
    );
  }

  /// Builds the three-pane workspace (rail · sessions · transcript) plus the
  /// optional right-rail inspector.
  ///
  /// The inspector (SessionSidePanel) is shown for the active session unless
  /// the user has collapsed it via [AgentsController.panelCollapsed]. When
  /// collapsed, a small floating expand button overlays the top-right of the
  /// content area so the panel can be brought back. Both affordances are gated
  /// on having a selected session.
  Widget _buildWorkspace(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final selectedSession = controller.selectedSession;
    final panelCollapsed = controller.panelCollapsed;
    final showCollapsedAffordance = selectedSession != null && panelCollapsed;

    final agentServerController = context.watch<AgentServerController>();
    final canStartSession =
        agentServerController.isReady && agentServerController.hasAnyAgent;

    final row = Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AgentsNavColumn(
          resumableSectionExpanded: _resumableSectionExpanded,
          onToggleResumable: () => setState(
            () => _resumableSectionExpanded = !_resumableSectionExpanded,
          ),
          onNewSession:
              canStartSession ? () => _instantCreateSession(context) : null,
          onShowNewProjectDialog: () => _showNewProjectDialog(context),
          isCollapsed: _navCollapsed,
          onToggleCollapse: () =>
              setState(() => _navCollapsed = !_navCollapsed),
          onShowSessionOptions:
              canStartSession ? () => _showNewSessionDialog(context) : null,
        ),
        const SizedBox(width: 12),
        Expanded(child: _TranscriptPanel()),
        // Right-rail inspector (Context / Changes / Terminal) for the active
        // session. Mounted here so the M3 session-feature panels (Changes
        // diff, todo list) actually render. Hidden when the user collapses it.
        // A thin draggable handle on the panel's LEFT edge resizes it; because
        // the panel is on the right, dragging the handle LEFT widens it.
        if (selectedSession != null && !panelCollapsed) ...[
          const SizedBox(width: 6),
          const _InspectorResizeHandle(),
          const SizedBox(width: 6),
          SessionSidePanel(session: selectedSession),
        ],
      ],
    );

    if (!showCollapsedAffordance) return row;

    // Collapsed: overlay a floating expand button at the top-right edge where
    // the inspector panel used to sit.
    return Stack(
      children: [
        row,
        Positioned(
          top: 0,
          right: 0,
          child: Material(
            color: context.rhythm.surfaceRaised,
            elevation: 2,
            borderRadius: BorderRadius.circular(RhythmRadius.md),
            child: IconButton(
              key: const ValueKey('inspector-expand-button'),
              icon: const Icon(Icons.chevron_left, size: 18),
              tooltip: 'Show inspector',
              onPressed: () =>
                  context.read<AgentsController>().setPanelCollapsed(false),
              style: IconButton.styleFrom(
                minimumSize: const Size(32, 32),
                padding: EdgeInsets.zero,
                foregroundColor: context.rhythm.textMuted,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  void _showNewProjectDialog(BuildContext context) {
    showEditProjectDialog(context);
  }

  /// OPC-#710 — Instant create from the nav column header.
  Future<void> _instantCreateSession(BuildContext context) async {
    final projectsController = context.read<AgentProjectsController>();
    final ctrl = context.read<AgentsController>();
    final cwd = projectsController.selectedProject?.cwd ??
        Platform.environment['HOME'] ??
        '/tmp';
    final session = await ctrl.createSession(cwd: cwd);
    if (session != null) {
      ctrl.selectSession(session.id);
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

/// Thin (6px) vertical drag handle sitting at the LEFT edge of the inspector
/// side panel. Dragging it resizes the panel via [AgentsController.setPanelWidth].
///
/// Because the panel is anchored on the RIGHT, dragging the handle LEFT
/// (negative dx) must INCREASE the width — hence `panelWidth - delta.dx`.
/// The controller clamps the result to its [min, max] range, so the handle
/// itself does no bounds checking.
class _InspectorResizeHandle extends StatelessWidget {
  const _InspectorResizeHandle();

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.resizeLeftRight,
      child: GestureDetector(
        key: const Key('inspector-resize-handle'),
        behavior: HitTestBehavior.opaque,
        onHorizontalDragUpdate: (details) {
          final controller = context.read<AgentsController>();
          controller.setPanelWidth(controller.panelWidth - details.delta.dx);
        },
        child: SizedBox(
          width: 6,
          child: Center(
            child: Container(width: 1, color: context.rhythm.border),
          ),
        ),
      ),
    );
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
// Right panel — transcript + input
// ---------------------------------------------------------------------------

class _TranscriptPanel extends StatefulWidget {
  const _TranscriptPanel();

  @override
  State<_TranscriptPanel> createState() => _TranscriptPanelState();
}

class _TranscriptPanelState extends State<_TranscriptPanel> {
  static const _headlessPollInterval = Duration(seconds: 4);

  final _inputController = TextEditingController();
  final _scrollController = ScrollController();
  Timer? _headlessPollTimer;
  String? _headlessPollSessionId;
  bool _headlessPollInFlight = false;

  /// Whether the transcript is currently scrolled to (or near) the bottom.
  /// Auto-scroll-on-new-content only fires while this is true, so manually
  /// scrolling up to read a long message is no longer interrupted by the
  /// window snapping back to the bottom on every streaming delta.
  bool _pinnedToBottom = true;

  /// Distance (px) from the bottom within which we still consider the user
  /// "pinned" — small jitter / the tail of an animation shouldn't unpin.
  static const double _pinThreshold = 120;

  /// Whether the previous build was showing the subagent (child) transcript.
  /// Used to detect the return-to-parent transition so we can land the main
  /// chat at the most recent message (the child list remounts the parent
  /// ListView at offset 0). One-shot — does NOT re-enable always-follow.
  bool _wasShowingChild = false;

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
    _headlessPollTimer?.cancel();
    _scrollController.removeListener(_onScroll);
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _syncHeadlessPolling(
    AgentsController controller,
    AgentSession? selected,
  ) {
    final shouldPoll = selected != null &&
        (selected.status == AgentSessionStatus.starting ||
            selected.status == AgentSessionStatus.working) &&
        !controller.isWorking(selected.id);
    final sessionId = shouldPoll ? selected.id : null;
    if (_headlessPollSessionId == sessionId) return;

    _headlessPollTimer?.cancel();
    _headlessPollTimer = null;
    _headlessPollSessionId = sessionId;
    _headlessPollInFlight = false;
    if (sessionId == null) return;

    _headlessPollTimer = Timer.periodic(_headlessPollInterval, (_) {
      unawaited(_pollHeadlessSession(controller, sessionId));
    });
  }

  Future<void> _pollHeadlessSession(
    AgentsController controller,
    String sessionId,
  ) async {
    if (!mounted ||
        _headlessPollInFlight ||
        _headlessPollSessionId != sessionId ||
        controller.selectedSessionId != sessionId ||
        controller.isWorking(sessionId)) {
      return;
    }
    _headlessPollInFlight = true;
    try {
      await controller.refreshSelectedSessionDetail(sessionId);
    } finally {
      _headlessPollInFlight = false;
    }
  }

  /// Issue #653: on (re)build, if the selected session has a staged composer
  /// draft (set by the trigger bubble after createSession), consume it once
  /// into the input controller and surface it to the user as editable text.
  /// The user hits Enter to send the (possibly edited) draft as the normal
  /// first user turn — no server-seeded system message, no auto-prompt.
  void _maybeConsumeComposerDraft(
    BuildContext context,
    AgentSession? selected,
  ) {
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
    _syncHeadlessPolling(controller, selected);

    // Returning from the subagent transcript: the parent ListView remounts at
    // the top, so jump once to the most recent message (re-pins). This is a
    // one-shot on the child→parent transition — it does NOT reinstate the old
    // "always snap to bottom" behavior; normal scrolling still un-pins below.
    final showingChild = controller.activeChildSessionId != null;
    if (_wasShowingChild && !showingChild && selected != null) {
      _scrollToBottom();
    }
    _wasShowingChild = showingChild;

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
                // #746 — while a new session is being created (engine cold-start
                // may take ~30s), show the composer immediately with a lightweight
                // "Connecting…" banner instead of the blank empty-state.  The text
                // field is visible but disabled so the user sees it is coming and
                // does not click "New session" again by mistake.
                ? (controller.isCreating
                    ? const _EngineConnectingState()
                    : const _EmptyTranscriptState())
                // OPC-M3-6: when a child session is active, swap the main
                // transcript area to the child transcript view. The parent
                // transcript, composer, and tool bars are hidden; a breadcrumb
                // in ChildTranscriptView lets the user navigate back.
                : controller.activeChildSessionId != null
                    ? ChildTranscriptView(
                        childSdkId: controller.activeChildSessionId!,
                        parentSessionName:
                            controller.activeChildParentName ?? selected.name,
                        // #861 — this child's own display name, used as the
                        // breadcrumb target for any NESTED (grandchild+) chip
                        // tapped inside this child's own transcript.
                        ownDisplayName:
                            controller.activeChildDisplayName ?? selected.name,
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
                                color: context.rhythm.canvas.withValues(
                                  alpha: 0.45,
                                ),
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
    final chatMessages = controller.chatMessagesFor(session.id);

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
                      isQueued: controller.isMessageQueued(m.id),
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
          AgentKindBadge(
            agentId: session.agentId,
            providerId: session.providerId,
            modelId: session.modelId,
          ),
          // Dual-account: which Anthropic account this session is routed to.
          if (session.anthropicAccountId != null) ...[
            const SizedBox(width: 6),
            _AnthropicAccountBadge(session: session),
          ],
          // OCU-22 (#1063): branch badge + dirty count. Hidden for non-git
          // sessions (vcsInfoFor returns null once the fetch resolves).
          if (controller.vcsInfoFor(session.id) != null) ...[
            const SizedBox(width: 6),
            _VcsBranchBadge(session: session),
          ],
          // OCU-18 (#1059): isolation badge for sessions running in a git
          // worktree.
          if (session.isIsolatedWorktree) ...[
            const SizedBox(width: 6),
            WorktreeBadge(session: session),
          ],
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
          // OCU-25 (#1066): also shown while "Prepare project for agents" is
          // in-flight (both are short-lived header-triggered engine calls).
          if (controller.isCompacting(session.id) ||
              controller.isInitializingProject(session.id)) ...[
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
              PopupMenuItem<String>(
                value: 'init',
                child: Row(
                  children: [
                    Icon(
                      Icons.auto_awesome_outlined,
                      size: 16,
                      color: context.rhythm.textSecondary,
                    ),
                    const SizedBox(width: 8),
                    const Flexible(
                      child: Text(
                        'Prepare project for agents',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
            ],
            onSelected: (v) {
              if (v == 'compact') {
                context.read<AgentsController>().summarizeSession(session.id);
              } else if (v == 'init') {
                context.read<AgentsController>().initializeProject(session.id);
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

/// OCU-22 (#1063) — branch name + dirty-file count badge for the transcript
/// header. Only rendered by the caller when [AgentsController.vcsInfoFor]
/// is non-null (i.e. the session directory is a git repo). The tooltip lists
/// the changed files (or "Clean" when there are none).
class _VcsBranchBadge extends StatelessWidget {
  const _VcsBranchBadge({required this.session});

  final AgentSession session;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final info = controller.vcsInfoFor(session.id);
    final branch = info?['branch'] as String?;
    if (branch == null || branch.isEmpty) return const SizedBox.shrink();

    final status = controller.vcsStatusFor(session.id);
    final dirtyCount = status.length;
    final tooltip = dirtyCount == 0
        ? 'Clean working tree'
        : status
            .map((e) => (e['file'] as String?) ?? '')
            .where((f) => f.isNotEmpty)
            .join('\n');

    return Tooltip(
      message: tooltip,
      child: Container(
        key: const ValueKey('vcs-branch-badge'),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceMuted,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: context.rhythm.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.call_split,
              size: 12,
              color: context.rhythm.textSecondary,
            ),
            const SizedBox(width: 4),
            Text(
              branch,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                fontFamily: 'JetBrainsMono',
                color: context.rhythm.textSecondary,
              ),
            ),
            if (dirtyCount > 0) ...[
              const SizedBox(width: 4),
              Text(
                '($dirtyCount)',
                key: const ValueKey('vcs-dirty-count'),
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: context.rhythm.warning,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Dual-account: session header badge showing the routed Claude account.
/// With ≥2 connected accounts it becomes a menu that switches the session's
/// account in place; with one account it stays a plain badge.
class _AnthropicAccountBadge extends StatelessWidget {
  const _AnthropicAccountBadge({required this.session});

  final AgentSession session;

  @override
  Widget build(BuildContext context) {
    final badge = Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.pill),
        border: Border.all(color: context.rhythm.border),
      ),
      child: Text(
        AnthropicAccountsLabelCache.labelFor(session.anthropicAccountId!),
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: context.rhythm.textSecondary,
        ),
      ),
    );
    final accounts = AnthropicAccountsLabelCache.accounts;
    if (accounts.length < 2) return badge;
    return PopupMenuButton<String>(
      key: const Key('anthropic-account-badge-menu'),
      tooltip: 'Switch Claude account for this session',
      padding: EdgeInsets.zero,
      onSelected: (accountId) {
        if (accountId == session.anthropicAccountId) return;
        context.read<AgentsController>().setSessionAnthropicAccount(
              session.id,
              accountId,
            );
      },
      itemBuilder: (context) => [
        for (final account in accounts)
          PopupMenuItem<String>(
            value: account.id,
            child: Row(
              children: [
                SizedBox(
                  width: 20,
                  child: account.id == session.anthropicAccountId
                      ? Icon(
                          Icons.check,
                          size: 16,
                          color: context.rhythm.accent,
                        )
                      : null,
                ),
                const SizedBox(width: 4),
                Text(account.label),
              ],
            ),
          ),
      ],
      child: badge,
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

/// #746 — Shown in the transcript panel while a new session is being created
/// and the engine is cold-starting (~30s on first launch). Renders the composer
/// area immediately so the chat window looks alive, with a non-blocking
/// "Connecting to agent engine…" banner above the (disabled) text field.
///
/// This replaces the blank [_EmptyTranscriptState] during [AgentsController.isCreating]
/// so the user sees progress rather than a frozen UI.
class _EngineConnectingState extends StatelessWidget {
  const _EngineConnectingState();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Connecting banner
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
          decoration: BoxDecoration(
            color: context.rhythm.accentMuted,
            border: Border(
              bottom: BorderSide(color: context.rhythm.borderSubtle),
            ),
          ),
          child: Row(
            children: [
              SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: context.rhythm.accent,
                ),
              ),
              const SizedBox(width: 10),
              Text(
                'Connecting to agent engine…',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                  color: context.rhythm.accent,
                ),
              ),
            ],
          ),
        ),
        // Spacer taking up the transcript area
        const Expanded(child: SizedBox()),
        // Disabled composer (visible immediately so the window feels responsive)
        Container(
          padding: const EdgeInsets.fromLTRB(18, 14, 18, 18),
          decoration: BoxDecoration(
            border: Border(top: BorderSide(color: context.rhythm.borderSubtle)),
            color: context.rhythm.surfaceRaised,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                enabled: false,
                maxLines: 3,
                minLines: 1,
                decoration: InputDecoration(
                  hintText: 'Connecting to engine — ready shortly…',
                  hintStyle: TextStyle(
                    color: context.rhythm.textMuted,
                    fontSize: 13,
                    fontFamily: 'Menlo',
                  ),
                  isDense: true,
                  filled: true,
                  fillColor: context.rhythm.canvas.withValues(alpha: 0.4),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(RhythmRadius.lg),
                    borderSide: BorderSide(color: context.rhythm.border),
                  ),
                  disabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(RhythmRadius.lg),
                    borderSide: BorderSide(color: context.rhythm.borderSubtle),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  FilledButton(
                    onPressed: null, // disabled while connecting
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
        ),
      ],
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
    this.isQueued = false,
  });

  final ChatMessage message;
  final List<ChatPart> parts;
  final String sessionId;

  /// Display name of the owning session — passed to TaskChip for breadcrumb.
  final String sessionName;

  /// OCU-05 (#1046): the user message was sent while the agent was busy and is
  /// queued behind the active turn.
  final bool isQueued;

  @override
  Widget build(BuildContext context) {
    final isUser = message.role == 'user';

    if (isUser) {
      return _UserBubble(parts: parts, isQueued: isQueued);
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
        if (const {
          'question',
          'askuserquestion',
        }.contains(part.toolName?.toLowerCase())) {
          children.add(QuestionToolCard(part: part, sessionId: sessionId));
        } else {
          // OPC-M2-3: dispatch to a tool-specific renderer by name.
          children.add(_buildToolRenderer(part));
        }
      } else if (part.type == 'reasoning') {
        // OPC-M2-2: flush any accumulated text before the reasoning block,
        // then render it as a collapsible ReasoningBlock.
        flushText();
        children.add(
          ReasoningBlock(key: ValueKey('reasoning-${part.id}'), part: part),
        );
      } else if (part.type == 'step-start' || part.type == 'step-finish') {
        // Step boundary markers — hidden from the UI per spec (M2 scope).
        // Kept in the parts list for future inspector use.
      } else if (part.type == 'compaction') {
        // OPC-M3-3: flush any accumulated text, then render a full-width
        // compaction divider ("Conversation compacted" with expandable summary).
        flushText();
        children.add(
          CompactionDivider(key: ValueKey('compaction-${part.id}'), part: part),
        );
      } else if (part.type == 'agent') {
        // OPC-M4-4: agent-switch marker — flush text then show "Switched to X".
        flushText();
        final name = part.agentName;
        if (name != null && name.isNotEmpty) {
          children.add(
            AgentPartMarker(key: ValueKey('agent-${part.id}'), agentName: name),
          );
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
  const _UserBubble({required this.parts, this.isQueued = false});

  final List<ChatPart> parts;

  /// OCU-05 (#1046): show a subtle "queued" chip when this message was sent
  /// while the agent was busy and is waiting for the engine to pick it up.
  final bool isQueued;

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
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
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
            // OCU-05 (#1046): queued indicator — clears when the engine's
            // message.updated reconciles the optimistic insert.
            if (isQueued) ...[
              const SizedBox(height: 4),
              Container(
                key: const ValueKey('queued-chip'),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: context.rhythm.surface,
                  borderRadius: BorderRadius.circular(RhythmRadius.pill),
                  border: Border.all(color: context.rhythm.borderSubtle),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.schedule,
                      size: 11,
                      color: context.rhythm.textMuted,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      'Queued',
                      style: TextStyle(
                        fontSize: 10,
                        color: context.rhythm.textMuted,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
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
            Icon(Icons.attach_file, size: 12, color: context.rhythm.accent),
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
              initialError: p.error,
            ),
        ],
      ),
    );
  }
}

/// USO smoke follow-up — a session can accept new input only when it has an
/// engine session to (re)attach to. A freshly-created chat always carries an
/// `sdkSessionId` (set at create time, controller line ~698), and completed
/// scheduled / background runs carry the `sdkSessionId` of their run — the WS
/// input path auto-resumes them via that id (OPC-M1-5). A row with NO
/// `sdkSessionId` is a legacy / dead run that cannot be resumed; its composer
/// is disabled with an inline reason instead of silently dropping the user
/// into a dead input.
bool _canSendTo(AgentSession? session) {
  if (session == null) return false;
  // A resumable engine session id is always sendable (fresh chat, or a
  // completed run the WS path auto-resumes via OPC-M1-5).
  if (session.sdkSessionId?.trim().isNotEmpty ?? false) return true;
  // No engine session id YET — do NOT show "ended". A live/initializing run
  // (starting/working) or an active chat awaiting its first turn (idle/
  // resumable) keeps an enabled composer; its sdkSessionId is assigned once
  // the engine session spins up. Only a terminated run (closed/error) that
  // never got an engine session is genuinely unresumable.
  switch (session.status) {
    case AgentSessionStatus.closed:
    case AgentSessionStatus.error:
      return false;
    case AgentSessionStatus.starting:
    case AgentSessionStatus.working:
    case AgentSessionStatus.idle:
    case AgentSessionStatus.resumable:
      return true;
  }
}

const String _kUnresumableReason = "This run has ended and can't be resumed.";

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
  /// OPC-M4-1 / Issue #717: Pick files, classify by MIME, and add to the
  /// controller's pending-attachment list for the active session.
  ///
  /// Classification rules:
  ///   - image/*              → FilePart with data URI (thumbnail rendered in bubble).
  ///   - application/pdf      → FilePart with data URI (sent with correct MIME).
  ///   - text/* / json / xml  → TextPart: content decoded as UTF-8, capped at 100 KB.
  ///   - every other binary   → local file: reference for reader discovery.
  static const int _kTextSizeCap = 100 * 1024; // 100 KB
  static const int _kMimeSampleSize = 4096;

  Future<void> _pickFiles() async {
    final result = await FilePicker.pickFiles(allowMultiple: true);
    if (result == null || !mounted) return;
    final controller = context.read<AgentsController>();
    final id = controller.selectedSessionId;
    if (id == null) return;
    for (final f in result.files) {
      final path = f.path;
      if (path == null) continue;
      try {
        final file = File(path);
        final reader = await file.open();
        late final List<int> sample;
        try {
          sample = await reader.read(_kMimeSampleSize);
        } finally {
          await reader.close();
        }
        final mime = resolveAttachmentMime(sample, f.name, f.extension);

        if (shouldAttachByFileReference(mime)) {
          // Issue #1137: provider-unsupported binaries stay as local `file:`
          // references. The engine tries its Read tool, then gives the agent
          // an actionable skill/MCP discovery procedure if no reader exists.
          controller.addPendingAttachment(
            id,
            buildFileRefAttachment(
              mime: mime,
              filename: f.name,
              absolutePath: path,
            ),
          );
          continue;
        }

        final bytes = await file.readAsBytes();
        if (isTextLikeMime(mime)) {
          // Issue #717: inline text/code/log files as a text part so the
          // model can read their contents directly.
          final decoded = tryDecodeUtf8(bytes);
          if (decoded == null) {
            // Somehow resolved to a text MIME but bytes aren't valid UTF-8
            // (should be rare — resolveAttachmentMime uses the same probe).
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    '${f.name}: file could not be decoded as text.',
                  ),
                  duration: const Duration(seconds: 4),
                ),
              );
            }
            continue;
          }
          final String content;
          final bool truncated = bytes.length > _kTextSizeCap;
          if (truncated) {
            // Truncate at the byte boundary and re-decode to keep valid UTF-8.
            final truncBytes = bytes.sublist(0, _kTextSizeCap);
            final partial = tryDecodeUtf8(truncBytes) ??
                const Utf8Decoder(
                  allowMalformed: true,
                ).convert(truncBytes.toList());
            content =
                '$partial\n\n… [truncated — showing first 100 KB of ${f.name}]';
          } else {
            content = decoded;
          }
          controller.addPendingAttachment(id, {
            'type': 'text',
            'filename': f.name,
            'mime': mime,
            'text': content,
          });
        } else {
          // image/* and application/pdf → FilePart with data URI.
          final dataUri = 'data:$mime;base64,${base64Encode(bytes)}';
          controller.addPendingAttachment(id, {
            'type': 'file',
            'mime': mime,
            'filename': f.name,
            'url': dataUri,
          });
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Could not attach ${f.name}: $e'),
              duration: const Duration(seconds: 4),
            ),
          );
        }
      }
    }
  }

  /// OCU-20 (#1061) — attach [relPath] (picked from the @-mention popover) by
  /// fetching its content through the worktree-safe content proxy and running
  /// it through the same classification path as [_pickFiles]: text is inlined
  /// (capped at 100KB), image/PDF becomes a FilePart data URI, and all other
  /// binary formats become a local `file:` reference for reader discovery.
  Future<void> _attachFromMention(String relPath) async {
    final controller = context.read<AgentsController>();
    final id = controller.selectedSessionId;
    if (id == null) return;
    final filename = relPath.contains('/') ? relPath.split('/').last : relPath;

    void reject(String reason) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(reason), duration: const Duration(seconds: 4)),
        );
      }
    }

    try {
      final content = await controller.fetchFileContent(id, relPath);
      final isText = content['type'] == 'text';
      final ext = filename.contains('.') ? filename.split('.').last : '';
      final mime = (content['mimeType'] as String?) ?? mimeFromExtension(ext);

      if (isText) {
        final raw = (content['content'] as String?) ?? '';
        final bytes = utf8.encode(raw);
        final text = bytes.length > _kTextSizeCap
            ? '${utf8.decode(bytes.sublist(0, _kTextSizeCap), allowMalformed: true)}'
                '\n\n… [truncated — showing first 100 KB of $filename]'
            : raw;
        controller.addPendingAttachment(id, {
          'type': 'text',
          'filename': filename,
          'mime': isTextLikeMime(mime) ? mime : 'text/plain',
          'text': text,
        });
        return;
      }

      if (mime.startsWith('image/') || mime == 'application/pdf') {
        final raw = (content['content'] as String?) ?? '';
        final b64 = content['encoding'] == 'base64'
            ? raw
            : base64Encode(utf8.encode(raw));
        controller.addPendingAttachment(id, {
          'type': 'file',
          'mime': mime,
          'filename': filename,
          'url': 'data:$mime;base64,$b64',
        });
        return;
      }

      final resolvedPath = content['resolvedPath'] as String?;
      if (resolvedPath == null || resolvedPath.isEmpty) {
        reject('Could not attach $filename: safe file path unavailable.');
        return;
      }
      controller.addPendingAttachment(
        id,
        buildFileRefAttachment(
          mime: mime,
          filename: filename,
          absolutePath: resolvedPath,
        ),
      );
    } catch (e) {
      reject('Could not attach $filename: $e');
    }
  }

  void _send() {
    final controller = context.read<AgentsController>();
    final id = controller.selectedSessionId;
    if (id == null) return;
    // Graceful degradation: a session with no engine session to (re)attach to
    // cannot accept new input. Guard here so the Enter key and onSubmitted
    // paths are blocked too, not just the (disabled) Send button.
    if (!_canSendTo(controller.selectedSession)) return;
    final trimmed = widget.inputController.text.trim();

    // OCU-24 (#1065): a "!"-prefixed message runs as a shell command instead
    // of a chat turn; "\!" escapes to a literal leading "!" as plain text.
    final parsed = parseComposerShellPrefix(trimmed);
    if (parsed.command != null) {
      if (parsed.command!.isNotEmpty) {
        controller.runShellCommand(id, parsed.command!);
        widget.inputController.clear();
      }
      return;
    }

    final text = parsed.text!;
    final pending = controller.pendingAttachmentsFor(id);
    if (text.isEmpty && pending.isEmpty) return;

    if (pending.isNotEmpty) {
      // OPC-M4-1: send with parts array (text + file parts).
      // sendInput merges the controller-held pending attachments internally.
      controller.sendInput(id, '$text\n');
      widget.inputController.clear();
    } else {
      // The unescaped '\!' form must still reach the plain-text send path
      // (widget.onSend() re-reads inputController.text via _sendInput).
      if (text != trimmed) {
        widget.inputController.text = text;
      }
      widget.onSend();
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final session = controller.selectedSession;
    // USO smoke follow-up: whether this session can accept new input.
    final canSend = _canSendTo(session);
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
          // USO smoke follow-up: inline reason when the session can't be
          // resumed. The full transcript above stays visible; only input is
          // disabled so the user is never dropped into a dead input.
          if (!canSend) ...[
            Padding(
              key: const ValueKey('composer-disabled-reason'),
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  Icon(
                    Icons.lock_outline,
                    size: 14,
                    color: context.rhythm.textMuted,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      _kUnresumableReason,
                      style: TextStyle(
                        fontSize: 12,
                        color: context.rhythm.textMuted,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          // Text field
          // OCU-20 (#1061): @-mention popover wraps the slash popover so
          // typing '@' anywhere in the message can trigger a fuzzy file
          // search regardless of whether the message also starts with '/'.
          AtMentionPopover(
            inputController: widget.inputController,
            sessionId: session?.id,
            onFileSelected: _attachFromMention,
            child: SlashCommandPopover(
              inputController: widget.inputController,
              commands: controller.slashCommands,
              // OCU-11 (#1052): refetch the command catalog whenever the
              // popover opens so a playbook created since session-select
              // appears immediately.
              onOpen: session == null
                  ? null
                  : () => controller.refreshSlashCommands(session.id),
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
                  key: const ValueKey('agent-composer-input'),
                  controller: widget.inputController,
                  enabled: canSend,
                  style: TextStyle(
                    fontSize: 13,
                    fontFamily: 'Menlo',
                    color: context.rhythm.textPrimary,
                  ),
                  maxLines: 3,
                  minLines: 1,
                  onSubmitted: (_) => _send(),
                  decoration: InputDecoration(
                    hintText: canSend
                        ? 'Type a command or reply… (Shift+Enter for newline)'
                        : _kUnresumableReason,
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
                            borderRadius: BorderRadius.circular(
                              RhythmRadius.md,
                            ),
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
                onPressed: canSend ? _send : null,
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
        border: Border.all(color: context.rhythm.accent.withValues(alpha: 0.3)),
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
              label: 'Start Secretary',
              color: const Color(0xFF6B46C1),
              onPressed: () => _startAgent(context, 'secretary', trigger),
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

  // Anthropic account override (dual-account feature). null = profile
  // default. The dropdown is hidden unless 2+ accounts are connected.
  List<AnthropicAccount> _anthropicAccounts = [];
  String? _selectedAnthropicAccountId;

  // OCU-18 (#1059): isolated-worktree toggle (default off) + optional name.
  bool _isolateWorktree = false;
  final _worktreeNameController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadAnthropicAccounts();
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

  Future<void> _loadAnthropicAccounts() async {
    try {
      final result = await AnthropicAccountsDataSource().list();
      if (!mounted) return;
      setState(() => _anthropicAccounts = result.accounts);
    } catch (_) {
      // Fetch failure → dropdown stays hidden (legacy/single-account setups).
    }
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

  /// OPC-#713: Open a native directory picker and populate [_cwdController]
  /// with the chosen path. Text entry remains editable for manual overrides.
  Future<void> _browseCwd() async {
    final path = await FilePicker.getDirectoryPath(
      dialogTitle: 'Choose working directory',
      initialDirectory: _cwdController.text.trim().isNotEmpty
          ? _cwdController.text.trim()
          : null,
    );
    if (path != null && mounted) {
      setState(() => _cwdController.text = path);
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _cwdController.dispose();
    _newBranchController.dispose();
    _worktreeNameController.dispose();
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
      anthropicAccountId: _selectedAnthropicAccountId,
      isolateWorktree: _isolateWorktree,
      worktreeName: _worktreeNameController.text.trim().isEmpty
          ? null
          : _worktreeNameController.text.trim(),
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
            // OPC-#713: cwd row = editable text field + Browse… button.
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextField(
                    controller: _cwdController,
                    style: TextStyle(
                      fontSize: 13,
                      fontFamily: 'Menlo',
                      color: context.rhythm.textPrimary,
                    ),
                    decoration: _inputDecoration(context, hint: '~/'),
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  height: 38,
                  child: OutlinedButton(
                    onPressed: _browseCwd,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: context.rhythm.accent,
                      side: BorderSide(color: context.rhythm.border),
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(RhythmRadius.md),
                      ),
                    ),
                    child: const Text(
                      'Browse…',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ),
              ],
            ),

            // OCU-18 (#1059) — isolated worktree toggle. Default off. When
            // enabled, the session's edits land in a fresh git worktree
            // instead of the working directory above.
            const SizedBox(height: 14),
            SwitchListTile(
              key: const ValueKey('isolate-worktree-toggle'),
              contentPadding: EdgeInsets.zero,
              value: _isolateWorktree,
              activeThumbColor: context.rhythm.accent,
              title: Text(
                'Run in isolated worktree',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: context.rhythm.textPrimary,
                ),
              ),
              subtitle: Text(
                'Creates a separate git worktree so edits never touch the '
                'working directory above.',
                style: TextStyle(fontSize: 11, color: context.rhythm.textMuted),
              ),
              onChanged: (v) => setState(() => _isolateWorktree = v),
            ),
            if (_isolateWorktree) ...[
              const SizedBox(height: 6),
              TextField(
                key: const ValueKey('worktree-name-field'),
                controller: _worktreeNameController,
                style: TextStyle(
                  fontSize: 13,
                  fontFamily: 'Menlo',
                  color: context.rhythm.textPrimary,
                ),
                decoration: _inputDecoration(
                  context,
                  hint: 'Worktree name (optional)',
                ),
              ),
            ],

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
                        DropdownMenuItem<String>(value: b, child: Text(b)),
                    // Remaining local branches not already shown.
                    for (final b in _localBranches)
                      if (b != _currentBranch && !_recentBranches.contains(b))
                        DropdownMenuItem<String>(value: b, child: Text(b)),
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

            // Anthropic account override — only shown when 2+ accounts are
            // connected (with one account there is nothing to choose).
            if (_anthropicAccounts.length >= 2) ...[
              const SizedBox(height: 14),
              Text(
                'Account',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: context.rhythm.textSecondary,
                ),
              ),
              const SizedBox(height: 6),
              DropdownButtonFormField<String?>(
                initialValue: _selectedAnthropicAccountId,
                isExpanded: true,
                dropdownColor: context.rhythm.surfaceRaised,
                decoration: _inputDecoration(context, hint: 'Profile default'),
                style: TextStyle(
                  fontSize: 13,
                  color: context.rhythm.textPrimary,
                ),
                items: [
                  DropdownMenuItem<String?>(
                    value: null,
                    child: Text(
                      'Profile default',
                      style: TextStyle(color: context.rhythm.textMuted),
                    ),
                  ),
                  ..._anthropicAccounts.map(
                    (a) => DropdownMenuItem<String?>(
                      value: a.id,
                      child: Text(
                        a.label,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: context.rhythm.textPrimary),
                      ),
                    ),
                  ),
                ],
                onChanged: (v) =>
                    setState(() => _selectedAnthropicAccountId = v),
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
// Test harnesses — expose private badge widgets for widget tests.
// Issue #645: all four badge render sites must be exercised individually.
// ---------------------------------------------------------------------------

/// A thin public wrapper around [AgentKindBadge] for use in widget tests.
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
    this.modelId,
  });

  final String agentId;
  final String? providerId;
  final String? modelId;

  @override
  Widget build(BuildContext context) {
    return AgentKindBadge(
      agentId: agentId,
      providerId: providerId,
      modelId: modelId,
    );
  }
}

/// Public wrapper around [ResumableSessionRow] for use in widget tests.
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
    return ResumableSessionRow(session: session, onResume: onResume ?? () {});
  }
}

// ---------------------------------------------------------------------------
// OPC-M3-6: ChildTranscriptView — read-only transcript for a child session.
// ---------------------------------------------------------------------------

/// Derive readable text for a child (subagent) message.
///
/// Subagent messages fetched from the bridge keep their content in `parts`
/// (e.g. `{type:'text', text:'…'}`) with `strippedText`/`rawText` empty, so a
/// naive `strippedText ?? rawText` renders blank bubbles. Resolve in order:
///   1. strippedText, then rawText (legacy/plain rows).
///   2. concatenated `text`/`reasoning` parts.
///   3. a compact tool summary (`⚙ tool1, tool2`) for tool-only messages, so a
///      message that did work but emitted no prose isn't an empty box.
String _childMessageDisplayText(AgentSessionMessage m) {
  if (m.strippedText.trim().isNotEmpty) return m.strippedText;
  if (m.rawText.trim().isNotEmpty) return m.rawText;

  final parts = m.parts;
  if (parts == null || parts.isEmpty) return '';

  final prose = <String>[];
  final tools = <String>[];
  for (final p in parts) {
    switch (p['type']) {
      case 'text':
      case 'reasoning':
        final t = p['text'];
        if (t is String && t.trim().isNotEmpty) prose.add(t.trim());
        break;
      case 'tool':
        final tool = (p['tool'] as String?) ?? 'tool';
        tools.add(tool);
        break;
    }
  }
  if (prose.isNotEmpty) return prose.join('\n\n');
  if (tools.isNotEmpty) return '⚙ ${tools.join(', ')}';
  return '';
}

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
    String? ownDisplayName,
    required this.onBack,
  }) : ownDisplayName = ownDisplayName ?? parentSessionName;

  final String childSdkId;
  final String parentSessionName;

  /// #861 — this child session's own display name. Used as the breadcrumb
  /// target on any NESTED (grandchild+) TaskChip rendered inside this child's
  /// transcript. Defaults to [parentSessionName] for pre-#861 callers that
  /// only ever expected a single hop.
  final String ownDisplayName;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final messages = controller.childMessagesFor(childSdkId);
    final loading = controller.isChildLoading(childSdkId);

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
          child: loading && messages.isEmpty
              ? Center(
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: context.rhythm.accent,
                    ),
                  ),
                )
              : messages.isEmpty
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
                        // Real subagent messages keep their text in `parts`, with
                        // strippedText/rawText empty — derive display text from the
                        // parts so the bubbles aren't blank.
                        final displayText = _childMessageDisplayText(m);
                        // #861 — nested delegation: any `task` tool parts on this
                        // (sub)message become their own navigable TaskChips, using
                        // THIS child session's own SDK id as the fetch-parent for
                        // the next hop, so tapping opens the grandchild transcript
                        // and the breadcrumb returns to THIS child, not the
                        // top-level parent.
                        final nestedTaskParts = _childTaskParts(m);
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: isUser
                              ? Align(
                                  alignment: Alignment.centerRight,
                                  child: Container(
                                    constraints: const BoxConstraints(
                                      maxWidth: 560,
                                    ),
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 12,
                                      vertical: 8,
                                    ),
                                    decoration: BoxDecoration(
                                      color: context.rhythm.accentMuted,
                                      borderRadius: BorderRadius.circular(
                                        RhythmRadius.md,
                                      ),
                                      border: Border.all(
                                        color: context.rhythm.accent.withValues(
                                          alpha: 0.2,
                                        ),
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
                              : Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    if (displayText.isNotEmpty ||
                                        nestedTaskParts.isEmpty)
                                      Container(
                                        width: double.infinity,
                                        padding: const EdgeInsets.all(12),
                                        decoration: BoxDecoration(
                                          color: context.rhythm.surfaceMuted,
                                          borderRadius: BorderRadius.circular(
                                            RhythmRadius.md,
                                          ),
                                          border: Border.all(
                                            color: context.rhythm.borderSubtle,
                                          ),
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
                                    for (final taskPart in nestedTaskParts) ...[
                                      const SizedBox(height: 6),
                                      TaskChip(
                                        part: taskPart,
                                        parentSessionId: childSdkId,
                                        // Breadcrumb for the grandchild must
                                        // return to THIS child, not the
                                        // top-level parent.
                                        parentSessionName: ownDisplayName,
                                      ),
                                    ],
                                  ],
                                ),
                        );
                      },
                    ),
        ),
      ],
    );
  }
}

/// #861 — extract `task` tool parts from a child (subagent) message as
/// [ChatPart]s so they can be rendered with the same [TaskChip] used in the
/// top-level transcript, enabling nested delegation (grandchild+) navigation.
List<ChatPart> _childTaskParts(AgentSessionMessage m) {
  final parts = m.parts;
  if (parts == null || parts.isEmpty) return const [];
  final messageId = m.sdkMessageId ?? 'child-msg-${m.id}';
  final result = <ChatPart>[];
  for (final p in parts) {
    if (p['type'] == 'tool' &&
        (p['tool'] as String?)?.toLowerCase() == 'task') {
      result.add(ChatPart.fromJson(messageId, p));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// OPC-M4-1: MIME inference helper
// ---------------------------------------------------------------------------

/// Infer a MIME type from a file extension.
/// Falls back to 'application/octet-stream' for unknown extensions.
// ---------------------------------------------------------------------------
// OPC-M4-4: Agent selector pill + agent-part marker
// ---------------------------------------------------------------------------

/// A single row in the agent picker — unifies the two possible sources (Agent
/// Profiles, or the raw opencode agent list as a fallback) into one shape.
class _AgentPickerItem {
  const _AgentPickerItem({
    required this.value,
    required this.label,
    this.description,
  });

  /// The opencode agent name sent to [AgentsController.setSelectedAgent].
  final String value;

  /// Display label (profile label, or the agent name in fallback mode).
  final String label;

  /// Optional one-line description shown under the label.
  final String? description;
}

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
    final cfgCtrl = context.watch<AgentConfigsController>();
    final selected = ctrl.selectedAgentFor(sid);

    // Source the picker from Agent Profiles (the consolidated concept). Each
    // session-selectable profile is backed by an opencode agent (ocAgent), so
    // selecting one drives the turn via that agent. Fall back to the raw
    // opencode agent list only when no profiles are available yet (engine still
    // syncing) so the picker never goes empty.
    final profiles = cfgCtrl.sessionSelectableAgents;
    final List<_AgentPickerItem> items = profiles.isNotEmpty
        ? [
            for (final p in profiles)
              _AgentPickerItem(
                value: p.ocAgent ?? p.id,
                label: p.displayLabel,
                description: null,
              ),
          ]
        : [
            for (final a in ctrl.availableAgentsFor(sid))
              _AgentPickerItem(
                value: a.name,
                label: a.name,
                description: a.description,
              ),
          ];

    // Display label: map the resolved agent value back to its profile label
    // when possible. Resolution order (#867, see selectedAgentFor doc):
    //   1. Explicit per-session selection  → resolve via items list.
    //   2. The session's OWN resolved agent (dispatched/subagent sessions
    //      show THEIR agent here, not the app-wide default) → items list.
    //   3. Manager default (from resolver) → resolve via items list.
    //   4. No manager configured          → fall back to 'build'.
    //
    // `selected` here is already the fully-resolved value from
    // selectedAgentFor() — this widget never re-derives the fallback chain.
    final managerLabel = cfgCtrl.managerAgent?.displayLabel ??
        cfgCtrl.managerAgent?.ocAgent ??
        'build';
    String label = managerLabel;
    if (selected != null) {
      label = selected;
      for (final i in items) {
        if (i.value == selected) {
          label = i.label;
          break;
        }
      }
    }

    return PopupMenuButton<String>(
      tooltip: 'Switch agent',
      // Constrain the popup width so it doesn't span the full screen.
      constraints: const BoxConstraints(maxWidth: 220),
      itemBuilder: (_) => [
        // "Default" option always shown so the user can reset back to the
        // manager profile default (#745). Label shows manager name or 'build'.
        PopupMenuItem<String>(
          value: '',
          child: Text(
            '$managerLabel (default)',
            style: TextStyle(fontSize: 12, color: context.rhythm.textSecondary),
          ),
        ),
        for (final a in items)
          PopupMenuItem<String>(
            value: a.value,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(a.label, style: const TextStyle(fontSize: 13)),
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
      child: Builder(
        builder: (context) {
          // #745: pill is "active/accent" only when the user has made an
          // explicit override away from the manager default — not merely
          // because a manager agent exists. This keeps the pill visually
          // neutral in the default state.
          final isOverridden = ctrl.hasExplicitAgentSelection(sid);
          return Container(
            height: 30,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            decoration: BoxDecoration(
              color: isOverridden
                  ? context.rhythm.accentMuted
                  : context.rhythm.surfaceMuted,
              borderRadius: BorderRadius.circular(RhythmRadius.md),
              border: Border.all(
                color: isOverridden
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
                  color: isOverridden
                      ? context.rhythm.accent
                      : context.rhythm.textSecondary,
                ),
                const SizedBox(width: 4),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: isOverridden
                        ? context.rhythm.accent
                        : context.rhythm.textSecondary,
                  ),
                ),
                const SizedBox(width: 2),
                Icon(
                  Icons.arrow_drop_down,
                  size: 14,
                  color: isOverridden
                      ? context.rhythm.accent
                      : context.rhythm.textSecondary,
                ),
              ],
            ),
          );
        },
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
        Icon(Icons.swap_horiz, size: 13, color: context.rhythm.textMuted),
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
    return _InputArea(inputController: _controller, onSend: () {});
  }
}

/// A harness that renders [_UserBubble] for a given list of [ChatPart]s.
/// Used by `opc_m4_1_attachments_test.dart` (c4, c5) to assert that file
/// parts render as thumbnails or filename chips.
@visibleForTesting
class UserBubbleTestHarness extends StatelessWidget {
  const UserBubbleTestHarness({
    super.key,
    required this.parts,
    this.isQueued = false,
  });

  final List<ChatPart> parts;

  /// OCU-05 (#1046): drive the "queued" chip in widget tests.
  final bool isQueued;

  @override
  Widget build(BuildContext context) {
    return _UserBubble(parts: parts, isQueued: isQueued);
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

/// A minimal stand-alone header for use in widget tests that exercise the
/// OPC-#710 instant-create / options button paths.
///
/// Renders a "New" [FilledButton.tonal] that calls [onNewSession], and
/// optionally an icon button with [Key('new-session-options-button')] that
/// calls [onOptionsPressed]. This is the minimal surface the test needs —
/// it no longer delegates to the dead [_SessionListHeader] class.
///
/// Requires [AgentsController] in the Provider tree for the refresh button.
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
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          const Expanded(child: SizedBox()),
          if (onNewSession != null)
            FilledButton.tonal(
              onPressed: onNewSession,
              child: const Text('New'),
            ),
          if (onOptionsPressed != null) ...[
            const SizedBox(width: 6),
            IconButton(
              key: const Key('new-session-options-button'),
              icon: const Icon(Icons.more_horiz, size: 18),
              tooltip: 'Session options',
              onPressed: onOptionsPressed,
            ),
          ],
        ],
      ),
    );
  }
}

/// Public wrapper around [SessionRow] for use in widget tests.
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
    return SessionRow(
      session: session,
      isSelected: false,
      isWorking: false,
      isStuck: false,
      onTap: () {},
    );
  }
}

// ---------------------------------------------------------------------------
// #746 test harness — connecting state
// ---------------------------------------------------------------------------

/// Wraps [_EngineConnectingState] for widget tests (issue #746).
///
/// Renders the connecting-state widget inside a minimal [MaterialApp] /
/// [Scaffold] so tests can assert:
///   - The "Connecting to agent engine…" banner is visible.
///   - The text field is disabled (not interactive).
///   - The Send button is disabled (onPressed == null).
@visibleForTesting
class EngineConnectingStateTestHarness extends StatelessWidget {
  const EngineConnectingStateTestHarness({super.key});

  @override
  Widget build(BuildContext context) {
    return const _EngineConnectingState();
  }
}
