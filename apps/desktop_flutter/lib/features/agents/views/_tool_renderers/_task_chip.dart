/// OPC-M2-3 — Child-session chip for task tool parts.
/// OPC-M3-6 — Navigation wired: tapping pushes the child transcript view.
///
/// Renders a task tool part as a navigable chip showing:
///   - Status indicator (leading ToolStateIndicator)
///   - Subagent description text
///   - Chevron affordance (tappable when parentSessionId is provided)
///
/// Tapping calls [onTap] (or the provider-wired navigation when
/// [parentSessionId] is set) to open the child session transcript.
///
/// Usage in agents_view.dart:
///   TaskChip(
///     part: part,
///     parentSessionId: session.id,
///     parentSessionName: session.name,
///   )
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/ui/tokens/rhythm_theme.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';

import '_tool_state_indicator.dart';

/// A navigable chip representing a child agent task.
///
/// ToolState drives the leading indicator:
///   pending   → hourglass icon (textMuted)
///   running   → spinner (accent)
///   completed → check_circle (success)
///   error     → error icon (danger)
///
/// When [parentSessionId] is provided, tapping calls
/// [AgentsController.openChildSession] with the child SDK session id extracted
/// from [part.toolArgs]['sessionId']. If no child SDK id is present in the
/// part args, the chip is still rendered but is not navigable (chevron dims).
class TaskChip extends StatelessWidget {
  const TaskChip({
    super.key,
    required this.part,
    this.parentSessionId,
    this.parentSessionName,
  });

  final ChatPart part;

  /// Local session id of the owning parent session. When provided, tapping
  /// the chip calls [AgentsController.openChildSession]. When null (e.g. in
  /// isolated tests), the chip is inert (no navigation side-effect).
  final String? parentSessionId;

  /// Display name of the parent session — used by the breadcrumb on back.
  final String? parentSessionName;

  String _description() {
    final args = part.toolArgs ?? {};
    return (args['description'] as String?) ??
        (args['task'] as String?) ??
        (part.toolName ?? 'task');
  }

  /// The child SDK session id, if present in the tool args.
  /// Opencode embeds it as 'sessionId' in the task tool input.
  String? _childSdkId() {
    final args = part.toolArgs ?? {};
    return args['sessionId'] as String?;
  }

  @override
  Widget build(BuildContext context) {
    final toolStatus = part.toolStatus ?? 'pending';
    final description = _description();
    final childSdkId = _childSdkId();
    final isNavigable = parentSessionId != null &&
        parentSessionName != null &&
        childSdkId != null;

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

    Widget chip = Container(
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
          // Chevron — accent color when navigable, muted when inert.
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Icon(
              Icons.chevron_right,
              size: 16,
              color: isNavigable
                  ? context.rhythm.accent
                  : context.rhythm.textMuted,
            ),
          ),
        ],
      ),
    );

    if (!isNavigable) return chip;

    // Wrap in GestureDetector to handle taps when navigation context is available.
    return GestureDetector(
      onTap: () {
        try {
          final controller = context.read<AgentsController>();
          controller.openChildSession(
            parentSessionId: parentSessionId!,
            parentSessionName: parentSessionName!,
            childSdkId: childSdkId,
          );
        } catch (_) {
          // AgentsController not in tree (e.g. isolated tests); no-op.
        }
      },
      child: chip,
    );
  }
}
