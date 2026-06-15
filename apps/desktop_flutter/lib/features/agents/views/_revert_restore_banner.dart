/// OPC-M3-2 — "Restore reverted changes" banner.
///
/// Shown at the top of the transcript when a session has an active revert
/// applied (some messages are dimmed). Tapping "Restore" dispatches unrevert
/// via [AgentsController.unrevertSession] and clears the reverted state.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agents_controller.dart';

class RevertRestoreBanner extends StatelessWidget {
  const RevertRestoreBanner({super.key, required this.sessionId});

  final String sessionId;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    if (!controller.sessionIsReverted(sessionId))
      return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: context.rhythm.border),
      ),
      child: Row(
        children: [
          Icon(Icons.undo, size: 16, color: context.rhythm.textSecondary),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Restore reverted changes',
              style: TextStyle(
                fontSize: 12,
                color: context.rhythm.textSecondary,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          TextButton(
            onPressed: () =>
                context.read<AgentsController>().unrevertSession(sessionId),
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Text(
              'Restore',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: context.rhythm.accent,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
