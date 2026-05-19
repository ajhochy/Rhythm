import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../features/agent_configs/controllers/agent_configs_controller.dart';
import '../../../features/agent_configs/models/agent_config.dart';
import '../../../features/agent_configs/widgets/agent_icon.dart';
import '../../../features/agents/controllers/agents_controller.dart';
import '../../../features/agents/models/agent_session.dart';
import '../../../features/agents/models/agent_session_message.dart';
import '../constants/app_constants.dart';
import '../ui/tokens/rhythm_theme.dart';
import 'agent_server_controller.dart';
import 'ansi_strip.dart';
import 'overlay_controller.dart';

// ---------------------------------------------------------------------------
// Top-level layer — inserted as last child of the AppShell Stack
// ---------------------------------------------------------------------------

class AgentBubbleOverlayLayer extends StatelessWidget {
  const AgentBubbleOverlayLayer({super.key});

  @override
  Widget build(BuildContext context) {
    final overlay = context.watch<OverlayController>();
    final agentServerController = context.watch<AgentServerController>();

    // Capability gate: only show when the agent server is ready and at least
    // one supported CLI is installed.
    if (!agentServerController.isReady || !agentServerController.hasAnyAgent) {
      return const SizedBox.shrink();
    }
    if (overlay.totalCount == 0) return const SizedBox.shrink();

    return Positioned(
      right: 16,
      bottom: 16,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (overlay.overflow > 0)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _OverflowChip(count: overlay.overflow),
            ),
          for (final b in overlay.visibleBubbles.reversed)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: b.isExpanded
                  ? _ExpandedBubble(entry: b)
                  : _CollapsedBubble(entry: b),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Overflow chip
// ---------------------------------------------------------------------------

class _OverflowChip extends StatelessWidget {
  const _OverflowChip({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final overlay = context.read<OverlayController>();
    return GestureDetector(
      onTap: () => overlay.requestNav(AppConstants.navAgents),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceRaised,
          borderRadius: BorderRadius.circular(RhythmRadius.pill),
          border: Border.all(color: context.rhythm.border),
          boxShadow: RhythmElevation.panel,
        ),
        child: Text(
          '+$count more',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: context.rhythm.accent,
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Collapsed bubble (56×56 circle)
// ---------------------------------------------------------------------------

class _CollapsedBubble extends StatelessWidget {
  const _CollapsedBubble({required this.entry});

  final AgentBubbleEntry entry;

  Color _ringColor(BuildContext context) {
    if (entry.kind == BubbleKind.trigger) return context.rhythm.warning;
    if (entry.working) return context.rhythm.accent;
    return switch (entry.status) {
      AgentSessionStatus.idle => context.rhythm.success,
      AgentSessionStatus.starting => context.rhythm.warning,
      AgentSessionStatus.working => context.rhythm.accent,
      AgentSessionStatus.resumable => context.rhythm.textMuted,
      AgentSessionStatus.closed => context.rhythm.borderSubtle,
      null => context.rhythm.borderSubtle,
    };
  }

  String _badgeLabel(AgentConfig? config) {
    if (entry.kind == BubbleKind.trigger) return '!';
    if (config != null && config.label.isNotEmpty) {
      return config.label[0].toUpperCase();
    }
    final id = entry.agentId;
    if (id == null || id.isEmpty) return '?';
    return id[0].toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final overlay = context.read<OverlayController>();
    final ringColor = _ringColor(context);
    final config = entry.agentId != null
        ? context.read<AgentConfigsController>().byId(entry.agentId!)
        : null;

    return Tooltip(
      message: entry.label,
      child: GestureDetector(
        onTap: () => overlay.toggleExpand(entry.key),
        child: Container(
          width: 56,
          height: 56,
          decoration: BoxDecoration(
            color: context.rhythm.surfaceRaised,
            shape: BoxShape.circle,
            border: Border.all(color: ringColor, width: 2.5),
            boxShadow: RhythmElevation.panel,
          ),
          child: Stack(
            children: [
              Center(
                child: entry.working
                    ? SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: context.rhythm.accent,
                        ),
                      )
                    : config != null
                        ? AgentIcon(
                            config.icon,
                            size: 24,
                            fallbackLabel: config.label,
                          )
                        : Icon(
                            Icons.terminal,
                            size: 24,
                            color: context.rhythm.textSecondary,
                          ),
              ),
              // Badge top-right
              Positioned(
                top: 4,
                right: 4,
                child: Container(
                  width: 16,
                  height: 16,
                  decoration: BoxDecoration(
                    color: ringColor,
                    shape: BoxShape.circle,
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    _badgeLabel(config),
                    style: const TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                      height: 1,
                    ),
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

// ---------------------------------------------------------------------------
// Expanded bubble — session kind (360×460)
// ---------------------------------------------------------------------------

class _ExpandedBubble extends StatelessWidget {
  const _ExpandedBubble({required this.entry});

  final AgentBubbleEntry entry;

  @override
  Widget build(BuildContext context) {
    if (entry.kind == BubbleKind.trigger) {
      return _ExpandedTriggerBubble(entry: entry);
    }
    return _ExpandedSessionBubble(entry: entry);
  }
}

// ---------------------------------------------------------------------------
// Expanded session bubble
// ---------------------------------------------------------------------------

class _ExpandedSessionBubble extends StatefulWidget {
  const _ExpandedSessionBubble({required this.entry});

  final AgentBubbleEntry entry;

  @override
  State<_ExpandedSessionBubble> createState() => _ExpandedSessionBubbleState();
}

class _ExpandedSessionBubbleState extends State<_ExpandedSessionBubble> {
  final _inputController = TextEditingController();
  final _scrollController = ScrollController();

  @override
  void dispose() {
    _inputController.dispose();
    _scrollController.dispose();
    super.dispose();
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

  void _sendInput(BuildContext context) {
    final agents = context.read<AgentsController>();
    final id = widget.entry.sessionId;
    if (id == null) return;
    final text = _inputController.text.trim();
    if (text.isEmpty) return;
    agents.sendInput(id, '$text\n');
    _inputController.clear();
    _scrollToBottom();
  }

  @override
  Widget build(BuildContext context) {
    final overlay = context.read<OverlayController>();
    final agents = context.watch<AgentsController>();
    final sessionId = widget.entry.sessionId!;

    final liveOutput = agents.liveOutputFor(sessionId);
    // Always read from the per-session store so the bubble shows its own
    // session's transcript regardless of which session is selected in the
    // main Agents tab (fix #625).
    final messages = agents.transcriptFor(sessionId).take(50).toList();

    _scrollToBottom();

    return Container(
      width: 360,
      height: 460,
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
        border: Border.all(color: context.rhythm.border),
        boxShadow: RhythmElevation.raised,
      ),
      child: Column(
        children: [
          // Header
          _BubbleHeader(
            entry: widget.entry,
            onMinimize: () => overlay.toggleExpand(widget.entry.key),
            onClose: () {
              overlay.toggleExpand(widget.entry.key);
              agents.closeSession(sessionId);
            },
            onOpenFullView: () {
              agents.selectSession(sessionId);
              overlay.requestNav(AppConstants.navAgents);
            },
          ),
          Divider(height: 1, color: context.rhythm.borderSubtle),

          // Transcript body
          Expanded(
            child: Container(
              color: context.rhythm.canvas.withValues(alpha: 0.45),
              child: _buildBody(context, messages, liveOutput),
            ),
          ),

          // Input footer
          _BubbleInputFooter(
            inputController: _inputController,
            onSend: () => _sendInput(context),
          ),
        ],
      ),
    );
  }

  Widget _buildBody(
    BuildContext context,
    List<AgentSessionMessage> messages,
    String liveOutput,
  ) {
    final hasContent = messages.isNotEmpty || liveOutput.isNotEmpty;

    if (!hasContent) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            'Session started. Tap "Open full view" to see output.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12,
              color: context.rhythm.textMuted,
              height: 1.4,
            ),
          ),
        ),
      );
    }

    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
      itemCount: messages.length + (liveOutput.isNotEmpty ? 1 : 0),
      itemBuilder: (context, index) {
        if (index < messages.length) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: _MiniMessageBlock(message: messages[index]),
          );
        }
        return Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: _MiniLiveBlock(text: liveOutput),
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Expanded trigger bubble (360×220)
// ---------------------------------------------------------------------------

class _ExpandedTriggerBubble extends StatefulWidget {
  const _ExpandedTriggerBubble({required this.entry});
  final AgentBubbleEntry entry;
  @override
  State<_ExpandedTriggerBubble> createState() => _ExpandedTriggerBubbleState();
}

class _ExpandedTriggerBubbleState extends State<_ExpandedTriggerBubble> {
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    // Refresh capabilities each time the trigger bubble is expanded so that
    // agents added after app launch (e.g. custom agents) appear immediately.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        context.read<AgentServerController>().refreshCapabilities();
      }
    });
  }

  /// Opens an agent-less chat session linked to the task.
  /// The user picks the agent + model via the composer picker inside the
  /// Agents view — the same flow as "+ New session" (issue #623).
  ///
  /// TODO(#623 follow-up): if the claude-trigger payload includes a
  /// preferred agent ID, plumb it as a *default* into the composer picker
  /// (requires adding `preferredAgentId` to `PendingTrigger` and propagating
  /// it through `AgentBubbleEntry` → composer without touching agents_view.dart).
  Future<void> _openChat() async {
    setState(() => _errorMessage = null);
    final overlay = context.read<OverlayController>();
    final agents = context.read<AgentsController>();
    // agentId: null → server creates a __pending__ session; the composer
    // picker in the Agents view allows the user to choose agent + model.
    final session = await agents.createSession(
      agentId: null,
      taskId: widget.entry.triggerTaskId,
      cwd: Platform.environment['HOME'] ?? '/',
      name: widget.entry.label,
    );
    if (session != null) {
      overlay.dismissTriggerBubble(widget.entry.triggerTaskId!);
      agents.selectSession(session.id);
      overlay.requestNav(AppConstants.navAgents);
    } else {
      if (!mounted) return;
      setState(() => _errorMessage = agents.error ?? 'Failed to open chat');
    }
  }

  double get _bubbleHeight => _errorMessage == null ? 220.0 : 260.0;

  @override
  Widget build(BuildContext context) {
    final overlay = context.read<OverlayController>();

    return Container(
      width: 360,
      height: _bubbleHeight,
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
        border: Border.all(
          color: context.rhythm.warning.withValues(alpha: 0.4),
          width: 1.5,
        ),
        boxShadow: RhythmElevation.raised,
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header row
            Row(
              children: [
                Icon(
                  Icons.auto_awesome,
                  size: 16,
                  color: context.rhythm.warning,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Task ready',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: context.rhythm.textPrimary,
                    ),
                  ),
                ),
                GestureDetector(
                  onTap: () => overlay.toggleExpand(widget.entry.key),
                  child: Icon(
                    Icons.remove,
                    size: 18,
                    color: context.rhythm.textMuted,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),

            // Task title
            Text(
              widget.entry.label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textPrimary,
                height: 1.3,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Open a chat to start this task. Choose your agent and model in the composer.',
              style: TextStyle(
                fontSize: 11.5,
                color: context.rhythm.textSecondary,
                height: 1.35,
              ),
            ),
            const Spacer(),

            // Single "Open chat" action — opens an agent-less session (#623)
            SizedBox(
              width: double.infinity,
              child: _TriggerButton(
                label: 'Open chat',
                icon: const Icon(Icons.chat_outlined, size: 14),
                onPressed: _openChat,
              ),
            ),
            if (_errorMessage != null) ...[
              const SizedBox(height: 8),
              Text(
                _errorMessage!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11.5,
                  color: context.rhythm.danger,
                  height: 1.3,
                ),
              ),
            ],
            const SizedBox(height: 8),

            // Dismiss link
            Center(
              child: GestureDetector(
                onTap: () {
                  if (widget.entry.triggerTaskId != null) {
                    overlay.dismissTriggerBubble(widget.entry.triggerTaskId!);
                  }
                },
                child: Text(
                  'Dismiss',
                  style: TextStyle(
                    fontSize: 11.5,
                    color: context.rhythm.textMuted,
                    decoration: TextDecoration.underline,
                    decorationColor: context.rhythm.textMuted,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Shared sub-widgets
// ---------------------------------------------------------------------------

class _BubbleHeader extends StatelessWidget {
  const _BubbleHeader({
    required this.entry,
    required this.onMinimize,
    required this.onClose,
    required this.onOpenFullView,
  });

  final AgentBubbleEntry entry;
  final VoidCallback onMinimize;
  final VoidCallback onClose;
  final VoidCallback onOpenFullView;

  @override
  Widget build(BuildContext context) {
    final config = entry.agentId != null
        ? context.read<AgentConfigsController>().byId(entry.agentId!)
        : null;
    final agentLabel = config?.label ?? entry.agentId ?? '?';
    final agentColor =
        config != null ? context.rhythm.accent : context.rhythm.textMuted;

    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 12, 10, 10),
      child: Row(
        children: [
          // Agent kind badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
            decoration: BoxDecoration(
              color: agentColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(RhythmRadius.pill),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (config != null) ...[
                  AgentIcon(config.icon, size: 12, fallbackLabel: config.label),
                  const SizedBox(width: 4),
                ],
                Text(
                  agentLabel,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: agentColor,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),

          // Session name + status dot
          Expanded(
            child: Row(
              children: [
                Flexible(
                  child: Text(
                    entry.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: context.rhythm.textPrimary,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                _StatusDot(entry: entry),
              ],
            ),
          ),

          // "Open full view" link
          GestureDetector(
            onTap: onOpenFullView,
            child: Text(
              'Full view',
              style: TextStyle(
                fontSize: 11,
                color: context.rhythm.accent,
                decoration: TextDecoration.underline,
                decorationColor: context.rhythm.accent,
              ),
            ),
          ),
          const SizedBox(width: 6),

          // Minimize
          _IconBtn(icon: Icons.remove, tooltip: 'Minimize', onTap: onMinimize),
          const SizedBox(width: 2),
          // Close
          _IconBtn(icon: Icons.close, tooltip: 'Close session', onTap: onClose),
        ],
      ),
    );
  }
}

class _StatusDot extends StatelessWidget {
  const _StatusDot({required this.entry});

  final AgentBubbleEntry entry;

  @override
  Widget build(BuildContext context) {
    if (entry.working) {
      return SizedBox(
        width: 8,
        height: 8,
        child: CircularProgressIndicator(
          strokeWidth: 2,
          color: context.rhythm.accent,
        ),
      );
    }
    final color = switch (entry.status) {
      AgentSessionStatus.idle => context.rhythm.success,
      AgentSessionStatus.starting => context.rhythm.warning,
      AgentSessionStatus.working => context.rhythm.accent,
      AgentSessionStatus.resumable => context.rhythm.textMuted,
      AgentSessionStatus.closed => context.rhythm.borderSubtle,
      null => context.rhythm.borderSubtle,
    };
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

class _IconBtn extends StatelessWidget {
  const _IconBtn({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: 24,
          height: 24,
          alignment: Alignment.center,
          child: Icon(icon, size: 16, color: context.rhythm.textMuted),
        ),
      ),
    );
  }
}

class _BubbleInputFooter extends StatelessWidget {
  const _BubbleInputFooter({
    required this.inputController,
    required this.onSend,
  });

  final TextEditingController inputController;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: context.rhythm.borderSubtle)),
        color: context.rhythm.surfaceRaised,
        borderRadius: const BorderRadius.vertical(
          bottom: Radius.circular(RhythmRadius.xl),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: inputController,
              style: TextStyle(
                fontSize: 12,
                fontFamily: 'Menlo',
                color: context.rhythm.textPrimary,
              ),
              maxLines: 1,
              onSubmitted: (_) => onSend(),
              decoration: InputDecoration(
                hintText: 'Send input…',
                hintStyle: TextStyle(
                  color: context.rhythm.textMuted,
                  fontSize: 12,
                  fontFamily: 'Menlo',
                ),
                isDense: true,
                filled: true,
                fillColor: context.rhythm.canvas.withValues(alpha: 0.6),
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
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
          const SizedBox(width: 8),
          SizedBox(
            height: 36,
            child: FilledButton(
              onPressed: onSend,
              style: FilledButton.styleFrom(
                backgroundColor: context.rhythm.accent,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.lg),
                ),
                minimumSize: Size.zero,
              ),
              child: const Text(
                'Send',
                style: TextStyle(
                  fontSize: 12,
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

class _TriggerButton extends StatelessWidget {
  const _TriggerButton({
    required this.label,
    required this.onPressed,
    this.icon,
  });

  final String label;
  final Widget? icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final color = context.rhythm.accent;
    return GestureDetector(
      onTap: onPressed,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 8),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(RhythmRadius.md),
          border: Border.all(color: color.withValues(alpha: 0.3)),
        ),
        alignment: Alignment.center,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[icon!, const SizedBox(width: 5)],
            Flexible(
              child: Text(
                label,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Mini transcript blocks (used inside the 360×460 session bubble)
// ---------------------------------------------------------------------------

class _MiniMessageBlock extends StatelessWidget {
  const _MiniMessageBlock({required this.message});

  final AgentSessionMessage message;

  @override
  Widget build(BuildContext context) {
    final isInput = message.role == 'input';
    if (isInput) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: context.rhythm.accentMuted,
          borderRadius: BorderRadius.circular(RhythmRadius.sm),
        ),
        child: Text(
          message.strippedText,
          maxLines: 3,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 11,
            fontStyle: FontStyle.italic,
            color: context.rhythm.accent.withValues(alpha: 0.85),
            height: 1.35,
          ),
        ),
      );
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Text(
        message.strippedText,
        maxLines: 5,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          fontSize: 11,
          fontFamily: 'Menlo',
          color: context.rhythm.textPrimary,
          height: 1.45,
        ),
      ),
    );
  }
}

class _MiniLiveBlock extends StatelessWidget {
  const _MiniLiveBlock({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    // Strip ANSI before truncating so the 500-char window is on visible text.
    final stripped = stripAnsi(text);
    final display = stripped.length > 500
        ? stripped.substring(stripped.length - 500)
        : stripped;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        border: Border.all(color: context.rhythm.accent.withValues(alpha: 0.2)),
      ),
      child: Text(
        display,
        maxLines: 10,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          fontSize: 11,
          fontFamily: 'Menlo',
          color: context.rhythm.textPrimary,
          height: 1.45,
        ),
      ),
    );
  }
}
