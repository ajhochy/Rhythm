import 'package:flutter/material.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';

/// OPC-M3-3 — Context-usage hint chip shown near the composer when the last
/// assistant message's input-token count is approaching the model's context
/// limit, suggesting the user compact the session.
///
/// Threshold: 0.8 × [kDefaultContextLimit] (120 000 tokens by default).
/// Default context limit: 150 000 tokens with a code comment explaining
/// that no per-model limit catalog is exposed by the provider list yet.
///
/// Returns [SizedBox.shrink] (zero size) when [inputTokens] is null or
/// below the threshold — the widget is always present in the tree so the
/// caller can find it by type in tests.
class ContextUsageHint extends StatelessWidget {
  const ContextUsageHint({super.key, required this.inputTokens});

  final int? inputTokens;

  /// Default context-window size in tokens.
  ///
  /// NOTE: The provider-list API (GET /agents/capabilities) does not currently
  /// expose per-model context limits. A fixed 150 k default is used here until
  /// a model-catalog endpoint is available. The threshold fraction (0.8) is a
  /// constant; both values can be overridden via a future settings key without
  /// changing the widget contract.
  static const int kDefaultContextLimit = 150000;

  /// Fraction of [kDefaultContextLimit] at which the hint becomes visible.
  static const double kThresholdFraction = 0.8;

  @override
  Widget build(BuildContext context) {
    final tokens = inputTokens;
    if (tokens == null) return const SizedBox.shrink();

    final threshold = (kDefaultContextLimit * kThresholdFraction).round();
    if (tokens < threshold) return const SizedBox.shrink();

    final pct = (tokens / kDefaultContextLimit * 100).round();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: context.rhythm.warning.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: context.rhythm.warning.withValues(alpha: 0.35),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.info_outline,
            size: 13,
            color: context.rhythm.warning,
          ),
          const SizedBox(width: 5),
          Text(
            'Context $pct% full — consider compacting',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: context.rhythm.warning,
            ),
          ),
        ],
      ),
    );
  }
}
