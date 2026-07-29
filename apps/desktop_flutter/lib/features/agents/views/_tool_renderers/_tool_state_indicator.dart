/// OPC-M2-3 — Shared ToolState status indicator widget.
///
/// Renders a leading icon/spinner driven by the tool's state string:
///   pending   → clock/hourglass icon (textMuted)
///   running   → CircularProgressIndicator (accent)
///   completed → check_circle icon (success)
///   error     → error icon (danger)
///   (unknown) → help_outline icon (textMuted)
///
/// Used by UnifiedDiffView, TerminalOutputView, TodoChecklistView, and
/// TaskChip so each renderer has an assertable, distinct status indicator.
library;

import 'package:flutter/material.dart';
import 'package:rhythm_desktop/app/core/ui/tokens/rhythm_theme.dart';

/// Compact leading status indicator for a tool call.
///
/// [toolStatus] is the raw `state.status` string from the part:
/// `'pending'`, `'running'`, `'completed'`, `'error'`.
class ToolStateIndicator extends StatelessWidget {
  const ToolStateIndicator({
    super.key,
    required this.toolStatus,
    this.size = 14.0,
  });

  final String toolStatus;
  final double size;

  @override
  Widget build(BuildContext context) {
    if (toolStatus == 'running') {
      return SizedBox(
        width: size,
        height: size,
        child: CircularProgressIndicator(
          strokeWidth: 2,
          color: context.rhythm.accent,
          semanticsLabel: 'running',
        ),
      );
    }

    final (icon, color, semantics) = switch (toolStatus) {
      'completed' => (
        Icons.check_circle_outline,
        context.rhythm.success,
        'completed',
      ),
      'error' => (Icons.error_outline, context.rhythm.danger, 'error'),
      'pending' => (
        Icons.hourglass_empty_outlined,
        context.rhythm.textMuted,
        'pending',
      ),
      _ => (Icons.help_outline, context.rhythm.textMuted, 'unknown'),
    };

    return Semantics(
      label: semantics,
      child: Icon(icon, size: size, color: color),
    );
  }
}
