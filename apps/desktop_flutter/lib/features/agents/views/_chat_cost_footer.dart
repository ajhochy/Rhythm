/// OPC-M2-4 — Per-message cost footer for assistant chat bubbles.
///
/// Renders "$0.0142" (2-4 significant decimal places) below the assistant
/// message. Tap the row to expand/collapse the token breakdown detail.
/// User messages and messages without cost render nothing (SizedBox.shrink).
///
/// Token fields displayed: input / output / reasoning / cache (all four,
/// even when zero, so the user can see the full breakdown).
library;

import 'package:flutter/material.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';

class ChatCostFooter extends StatefulWidget {
  const ChatCostFooter({
    super.key,
    required this.cost,
    required this.tokens,
  });

  /// Cost in USD. Null → renders nothing.
  final double? cost;

  /// Token usage map. Expected keys: 'input', 'output', 'reasoning', 'cache'.
  /// Null or empty → token detail row is suppressed.
  final Map<String, dynamic>? tokens;

  @override
  State<ChatCostFooter> createState() => _ChatCostFooterState();
}

class _ChatCostFooterState extends State<ChatCostFooter> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final cost = widget.cost;
    if (cost == null) return const SizedBox.shrink();

    // Format cost: always show $ prefix + enough decimals to be meaningful.
    // e.g. 0.0142 → "$0.0142", 0.12 → "$0.1200", 1.5 → "$1.5000"
    final costText = '\$${cost.toStringAsFixed(_sigDecimals(cost))}';

    return GestureDetector(
      onTap: () => setState(() => _expanded = !_expanded),
      child: Padding(
        padding: const EdgeInsets.only(top: 4, left: 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // Cost label row.
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.attach_money,
                  size: 12,
                  color: context.rhythm.textMuted,
                ),
                const SizedBox(width: 2),
                Text(
                  costText,
                  style: TextStyle(
                    fontSize: 11,
                    color: context.rhythm.textMuted,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
                if (widget.tokens != null) ...[
                  const SizedBox(width: 4),
                  Icon(
                    _expanded
                        ? Icons.keyboard_arrow_up
                        : Icons.keyboard_arrow_down,
                    size: 12,
                    color: context.rhythm.textMuted,
                  ),
                ],
              ],
            ),
            // Token breakdown (only when expanded).
            if (_expanded && widget.tokens != null)
              _TokenBreakdown(tokens: widget.tokens!),
          ],
        ),
      ),
    );
  }

  /// Returns the number of decimal places to show for [cost].
  /// We show between 2 and 4 decimal places:
  ///   ≥ 1.0 → 2 decimals
  ///   ≥ 0.01 → 2 decimals
  ///   ≥ 0.001 → 3 decimals
  ///   otherwise → 4 decimals
  int _sigDecimals(double cost) {
    final abs = cost.abs();
    if (abs >= 0.01) return 4;
    if (abs >= 0.001) return 4;
    return 4;
  }
}

class _TokenBreakdown extends StatelessWidget {
  const _TokenBreakdown({required this.tokens});

  final Map<String, dynamic> tokens;

  @override
  Widget build(BuildContext context) {
    final input = tokens['input'];
    final output = tokens['output'];
    final reasoning = tokens['reasoning'];
    // cache can be an int or a sub-map { read, write } — normalise to int.
    final cacheRaw = tokens['cache'];
    final cacheInt = cacheRaw is num
        ? cacheRaw.toInt()
        : (cacheRaw is Map
            ? ((cacheRaw['read'] as num? ?? 0) +
                    (cacheRaw['write'] as num? ?? 0))
                .toInt()
            : null);

    return Padding(
      padding: const EdgeInsets.only(top: 4, left: 4),
      child: Wrap(
        spacing: 10,
        runSpacing: 2,
        children: [
          if (input != null) _TokenCell(label: 'input', value: '$input'),
          if (output != null) _TokenCell(label: 'output', value: '$output'),
          if (reasoning != null)
            _TokenCell(label: 'reasoning', value: '$reasoning'),
          if (cacheInt != null) _TokenCell(label: 'cache', value: '$cacheInt'),
        ],
      ),
    );
  }
}

class _TokenCell extends StatelessWidget {
  const _TokenCell({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 10,
            color: context.rhythm.textMuted,
          ),
        ),
        const SizedBox(width: 3),
        Text(
          value,
          style: TextStyle(
            fontSize: 10,
            color: context.rhythm.textSecondary,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ],
    );
  }
}
