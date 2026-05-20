/// Issue #606 — Per-message action row.
///
/// Renders a row below each chat bubble containing:
///   - Copy icon: copies the full text of the message to the clipboard with a
///     brief flash animation on success.
///   - Bell/notify icon: toggles notify-on-completion for this specific message.
///     When armed, a desktop notification fires when the session finishes working.
///   - Relative timestamp (right-anchored): "just now", "Xm ago", "Xh ago", or
///     full date for messages older than 24 h. Refreshed via a global ticker
///     provided by [MessageTimeTicker].
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

final _globalTimeTick = _TimeTick();

/// Wrap the chat list with this widget to keep all [MessageActionsRow]
/// timestamps in sync without per-bubble timers. It only needs to be
/// placed once per screen.
class MessageTimeTicker extends StatelessWidget {
  const MessageTimeTicker({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<_TimeTick>.value(
      value: _globalTimeTick,
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
  });

  final String sessionId;
  final String messageId;
  final DateTime createdAt;

  /// Full text content of the associated bubble (text + stringified tool output).
  final String text;

  @override
  State<MessageActionsRow> createState() => _MessageActionsRowState();
}

class _MessageActionsRowState extends State<MessageActionsRow>
    with SingleTickerProviderStateMixin {
  bool _copiedFlash = false;
  AnimationController? _flashController;

  String get _messageKey => '${widget.sessionId}:${widget.messageId}';

  @override
  void initState() {
    super.initState();
    _flashController = AnimationController(
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
            color:
                notifyArmed ? context.rhythm.accent : context.rhythm.textMuted,
            onTap: () => controller.toggleNotify(_messageKey),
          ),
          const Spacer(),
          // Relative timestamp.
          Text(
            _relativeTime(widget.createdAt),
            style: TextStyle(
              fontSize: 10,
              color: context.rhythm.textMuted,
            ),
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

/// Returns a human-readable relative time string for [dt].
String _relativeTime(DateTime dt) {
  final now = DateTime.now();
  final diff = now.difference(dt);

  if (diff.inSeconds < 60) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  // Older — show full date.
  final y = dt.year.toString().padLeft(4, '0');
  final mo = dt.month.toString().padLeft(2, '0');
  final d = dt.day.toString().padLeft(2, '0');
  final h = dt.hour.toString().padLeft(2, '0');
  final mi = dt.minute.toString().padLeft(2, '0');
  return '$y-$mo-$d $h:$mi';
}
