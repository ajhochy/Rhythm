/// OPC-M2-4 — Inline retrying indicator rendered in the transcript header
/// (or wherever the controller surfaces `retryingFor(sessionId)`).
///
/// Shows "Retrying (attempt N)…" with an optional reason string below.
/// Uses RhythmColorRoles tokens: warning color for the spinner + label,
/// textMuted for the reason.
library;

import 'package:flutter/material.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';

class RetryingIndicator extends StatelessWidget {
  const RetryingIndicator({
    super.key,
    required this.attempt,
    required this.reason,
  });

  final int attempt;
  final String reason;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: context.rhythm.warning.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(
          color: context.rhythm.warning.withValues(alpha: 0.3),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          SizedBox(
            width: 12,
            height: 12,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: context.rhythm.warning,
            ),
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Retrying (attempt $attempt)…',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: context.rhythm.warning,
                  ),
                ),
                if (reason.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    reason,
                    style: TextStyle(
                      fontSize: 11,
                      color: context.rhythm.textMuted,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
