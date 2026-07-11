/// Issue #606 — Per-message action row.
///
/// Renders a row below each chat bubble containing:
///   - Copy icon: copies the full text of the message to the clipboard with a
///     brief flash animation on success.
///   - Bell/notify icon: toggles notify-on-completion for this specific message.
///     When armed, a desktop notification fires when the session finishes working.
///   - Pacific timestamp (right-anchored), refreshed by [MessageTimeTicker].
///
/// Usage in _ChatBubble (after the bubble content):
///   MessageActionsRow(
///     sessionId: message.sessionId,
///     messageId: message.id,
///     createdAt: message.createdAt,
///     text: fullTextForCopy,
///   )
///
/// A single [MessageTimeTicker] widget high in the tree drives periodic
/// rebuilds of all action rows without per-bubble timers.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../../app/core/utils/time_format.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agents_controller.dart';

// ---------------------------------------------------------------------------
// Global time ticker — place once in the widget tree above the chat list.
// ---------------------------------------------------------------------------

/// A [ChangeNotifier] that ticks every minute so relative timestamps
/// update without each bubble running its own [Timer].
class _TimeTick extends ChangeNotifier {
  _TimeTick() {
    _timer = Timer.periodic(const Duration(minutes: 1), (_) {
      notifyListeners();
    });
  }

  late final Timer _timer;

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }
}

/// Wrap the chat list with this widget to keep all [MessageActionsRow]
/// timestamps in sync without per-bubble timers. It only needs to be
/// placed once per screen.
///
/// Each instance creates its own [_TimeTick] so the timer is scoped to the
/// widget subtree and is cancelled when the widget is disposed.
class MessageTimeTicker extends StatelessWidget {
  const MessageTimeTicker({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<_TimeTick>(
      create: (_) => _TimeTick(),
      child: child,
    );
  }
}

// ---------------------------------------------------------------------------
// Action row widget
// ---------------------------------------------------------------------------

class MessageActionsRow extends StatefulWidget {
  const MessageActionsRow({
    super.key,
    required this.sessionId,
    required this.messageId,
    required this.createdAt,
    required this.text,
    this.role = 'assistant',
    this.isReverted = false,
  });

  final String sessionId;
  final String messageId;
  final DateTime createdAt;

  /// Full text content of the associated bubble (text + stringified tool output).
  final String text;

  /// The role of the associated message ('user' | 'assistant' | 'system').
  /// Only assistant messages show the "Revert to here" action.
  final String role;

  /// Whether this message has already been reverted.
  final bool isReverted;

  @override
  State<MessageActionsRow> createState() => _MessageActionsRowState();
}

class _MessageActionsRowState extends State<MessageActionsRow>
    with SingleTickerProviderStateMixin {
  bool _copiedFlash = false;
  AnimationController? _flashController;

  String get _messageKey => '${widget.sessionId}:${widget.messageId}';

  bool get _isAssistant =>
      widget.role == 'assistant' || widget.role == 'output';

  @override
  void initState() {
    super.initState();
    _flashController =
        AnimationController(
          vsync: this,
          duration: const Duration(milliseconds: 600),
        )..addStatusListener((s) {
          if (s == AnimationStatus.completed) {
            setState(() => _copiedFlash = false);
          }
        });
  }

  @override
  void dispose() {
    _flashController?.dispose();
    super.dispose();
  }

  void _copy() async {
    await Clipboard.setData(ClipboardData(text: widget.text));
    if (!mounted) return;
    setState(() => _copiedFlash = true);
    _flashController?.forward(from: 0);
  }

  void _showForkDialog(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Fork from here?'),
        content: const Text(
          'Create a new session starting from this message — the original '
          'session is unchanged and both branches are independently promptable.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(dialogContext).pop();
              context.read<AgentsController>().forkSession(
                widget.sessionId,
                widget.messageId,
              );
            },
            child: const Text('Fork'),
          ),
        ],
      ),
    );
  }

  void _showRevertDialog(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Revert to here?'),
        content: const Text(
          'Undo file changes after this point — this will reset all files that '
          'were modified by messages after this one.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(dialogContext).pop();
              context.read<AgentsController>().revertSession(
                widget.sessionId,
                widget.messageId,
              );
            },
            child: const Text('Revert'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Subscribe to the global tick so the timestamp string refreshes each minute.
    context.watch<_TimeTick>();
    final controller = context.watch<AgentsController>();
    final notifyArmed = controller.isNotifyArmed(_messageKey);

    return Padding(
      padding: const EdgeInsets.only(top: 3, left: 2, right: 2),
      child: Row(
        children: [
          // Copy icon with flash.
          _ActionIconButton(
            icon: _copiedFlash ? Icons.check : Icons.copy_outlined,
            tooltip: _copiedFlash ? 'Copied!' : 'Copy',
            color: _copiedFlash
                ? context.rhythm.success
                : context.rhythm.textMuted,
            onTap: _copy,
          ),
          const SizedBox(width: 2),
          // Bell / notify-on-completion toggle.
          _ActionIconButton(
            icon: notifyArmed
                ? Icons.notifications_active_outlined
                : Icons.notifications_none_outlined,
            tooltip: notifyArmed
                ? 'Notification armed — tap to cancel'
                : 'Notify when session finishes',
            color: notifyArmed
                ? context.rhythm.accent
                : context.rhythm.textMuted,
            onTap: () => controller.toggleNotify(_messageKey),
          ),
          // OPC-M3-2: "Revert to here" — only for assistant messages.
          if (_isAssistant) ...[
            const SizedBox(width: 2),
            _ActionIconButton(
              icon: Icons.history,
              tooltip: 'Revert to here',
              color: context.rhythm.textMuted,
              onTap: () => _showRevertDialog(context),
            ),
          ],
          // OPC-M4-2: "Fork from here" — only for assistant messages.
          if (_isAssistant) ...[
            const SizedBox(width: 2),
            _ActionIconButton(
              icon: Icons.fork_right,
              tooltip: 'Fork from here',
              color: context.rhythm.textMuted,
              onTap: () => _showForkDialog(context),
            ),
          ],
          // OPC-M3-2: "reverted" badge — shown when this message is reverted.
          if (widget.isReverted) ...[
            const SizedBox(width: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
              decoration: BoxDecoration(
                color: context.rhythm.surfaceMuted,
                borderRadius: BorderRadius.circular(4),
                border: Border.all(color: context.rhythm.border),
              ),
              child: Text(
                'reverted',
                style: TextStyle(
                  fontSize: 9,
                  color: context.rhythm.textMuted,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
          const Spacer(),
          // Pacific timestamp.
          Text(
            formatLocalTimestamp(widget.createdAt),
            style: TextStyle(fontSize: 10, color: context.rhythm.textMuted),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class _ActionIconButton extends StatelessWidget {
  const _ActionIconButton({
    required this.icon,
    required this.tooltip,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(4),
        child: Padding(
          padding: const EdgeInsets.all(3),
          child: Icon(icon, size: 14, color: color),
        ),
      ),
    );
  }
}
