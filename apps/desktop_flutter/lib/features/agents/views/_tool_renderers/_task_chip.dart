/// OPC-M2-3 — Child-session chip for task tool parts.
///
/// Renders a task tool part as an inert chip showing:
///   - Status indicator (leading ToolStateIndicator)
///   - Subagent description text
///
/// Navigation to the child session is wired in M3-6; the chip is inert here.
/// The chip is reused by the M3-6 child-session navigation feature.
///
/// Usage:
///   TaskChip(part: part)
library;

import 'package:flutter/material.dart';
import 'package:rhythm_desktop/app/core/ui/tokens/rhythm_theme.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';

import '_tool_state_indicator.dart';

/// An inert chip representing a child agent task.
///
/// ToolState drives the leading indicator:
///   pending   → hourglass icon (textMuted)
///   running   → spinner (accent)
///   completed → check_circle (success)
///   error     → error icon (danger)
class TaskChip extends StatelessWidget {
  const TaskChip({super.key, required this.part});

  final ChatPart part;

  String _description() {
    final args = part.toolArgs ?? {};
    return (args['description'] as String?) ??
        (args['task'] as String?) ??
        (part.toolName ?? 'task');
  }

  @override
  Widget build(BuildContext context) {
    final toolStatus = part.toolStatus ?? 'pending';
    final description = _description();

    final bgColor = switch (toolStatus) {
      'completed' => context.rhythm.success.withValues(alpha: 0.08),
      'error' => context.rhythm.danger.withValues(alpha: 0.08),
      'running' => context.rhythm.accentMuted,
      _ => context.rhythm.surfaceMuted,
    };

    final borderColor = switch (toolStatus) {
      'completed' => context.rhythm.success.withValues(alpha: 0.25),
      'error' => context.rhythm.danger.withValues(alpha: 0.25),
      'running' => context.rhythm.accent.withValues(alpha: 0.3),
      _ => context.rhythm.borderSubtle,
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: borderColor),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: ToolStateIndicator(toolStatus: toolStatus),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Task',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: context.rhythm.textMuted,
                    letterSpacing: 0.6,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  description,
                  style: TextStyle(
                    fontSize: 12,
                    color: context.rhythm.textPrimary,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
          // Inert chevron placeholder for future M3-6 navigation.
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Icon(
              Icons.chevron_right,
              size: 16,
              color: context.rhythm.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}
