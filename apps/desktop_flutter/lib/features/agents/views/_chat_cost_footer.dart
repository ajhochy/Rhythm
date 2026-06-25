/// OPC-M2-4 — Per-message usage footer for assistant chat bubbles.
///
/// Collapsed (default): shows the TOKEN context (input / output / reasoning /
/// cache). Tap to expand and reveal the message PRICE underneath. This keeps
/// the at-a-glance signal on tokens, with cost one tap away.
///
/// User messages and messages without cost or tokens render nothing
/// (SizedBox.shrink).
library;

import 'package:flutter/material.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';

class ChatCostFooter extends StatefulWidget {
  const ChatCostFooter({
    super.key,
    required this.cost,
    required this.tokens,
  });

  /// Cost in USD. Revealed (on the bottom) when expanded.
  final double? cost;

  /// Token usage map. Expected keys: 'input', 'output', 'reasoning', 'cache'.
  /// Shown collapsed as the always-visible token context.
  final Map<String, dynamic>? tokens;

  @override
  State<ChatCostFooter> createState() => _ChatCostFooterState();
}

class _ChatCostFooterState extends State<ChatCostFooter> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final tokens = widget.tokens;
    final cost = widget.cost;
    final hasTokens = tokens != null && tokens.isNotEmpty;
    // Always 4 decimals — meaningful for sub-cent per-message costs.
    final costText = cost != null ? '\$${cost.toStringAsFixed(4)}' : null;

    // Nothing to show.
    if (!hasTokens && costText == null) return const SizedBox.shrink();

    // The price is the expandable detail. The chevron only appears when there
    // is both a collapsed token summary AND a price to reveal beneath it.
    final canExpand = hasTokens && costText != null;

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: canExpand ? () => setState(() => _expanded = !_expanded) : null,
      child: Padding(
        padding: const EdgeInsets.only(top: 4, left: 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // Collapsed / header: token context (falls back to price when a
            // message has a cost but no token breakdown).
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (hasTokens)
                  Flexible(child: _TokenBreakdown(tokens: tokens))
                else
                  _CostLabel(costText: costText!),
                if (canExpand) ...[
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
            // Expanded: price on the bottom.
            if (_expanded && costText != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: _CostLabel(costText: costText),
              ),
          ],
        ),
      ),
    );
  }
}

/// The "$0.0142" price label — money icon + tabular figures. Unchanged look
/// from the previous footer header; only its position moved (now revealed on
/// expand).
class _CostLabel extends StatelessWidget {
  const _CostLabel({required this.costText});

  final String costText;

  @override
  Widget build(BuildContext context) {
    return Row(
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
      ],
    );
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

    return Wrap(
      spacing: 10,
      runSpacing: 2,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (input != null) _TokenCell(label: 'input', value: '$input'),
        if (output != null) _TokenCell(label: 'output', value: '$output'),
        if (reasoning != null)
          _TokenCell(label: 'reasoning', value: '$reasoning'),
        if (cacheInt != null) _TokenCell(label: 'cache', value: '$cacheInt'),
      ],
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
