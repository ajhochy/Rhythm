/// OPC-M2-2 — Collapsible reasoning block for assistant messages.
///
/// Renders a [ChatPart] with `type == 'reasoning'` as a collapsed
/// "Thinking…" block. The reasoning text is hidden until the user taps
/// to expand. Expand/collapse state is per-block and survives delta-append
/// rebuilds when the widget is keyed by part id.
///
/// Usage:
///   ReasoningBlock(
///     key: ValueKey(part.id),
///     part: part,
///   )
library;

import 'package:flutter/material.dart';
import 'package:rhythm_desktop/app/core/ui/tokens/rhythm_theme.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';

/// A collapsed/expandable reasoning block for an assistant reasoning part.
///
/// Label behavior:
///   - While streaming (no `durationMs`): "Thinking…"
///   - Once finished (`durationMs` ≥ 0): "Thought for Xs" (rounded to 1 dp)
///
/// The block is keyed by the caller with [ValueKey(part.id)] so Flutter's
/// element tree preserves state across rebuilds triggered by delta appends.
class ReasoningBlock extends StatefulWidget {
  const ReasoningBlock({super.key, required this.part});

  final ChatPart part;

  @override
  State<ReasoningBlock> createState() => _ReasoningBlockState();
}

class _ReasoningBlockState extends State<ReasoningBlock> {
  bool _expanded = false;

  String _label() {
    final ms = widget.part.durationMs;
    if (ms != null && ms >= 0) {
      final seconds = (ms / 1000).toStringAsFixed(ms < 1000 ? 1 : 0);
      return 'Thought for ${seconds}s';
    }
    return 'Thinking…';
  }

  @override
  Widget build(BuildContext context) {
    final textSecondary = context.rhythm.textSecondary;
    final borderSubtle = context.rhythm.borderSubtle;
    final surfaceMuted = context.rhythm.surfaceMuted;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Header row: label + chevron.
        GestureDetector(
          onTap: () => setState(() => _expanded = !_expanded),
          behavior: HitTestBehavior.opaque,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: surfaceMuted,
              borderRadius: BorderRadius.circular(RhythmRadius.md),
              border: Border.all(color: borderSubtle),
            ),
            child: Row(
              children: [
                Icon(
                  _expanded
                      ? Icons.keyboard_arrow_up_rounded
                      : Icons.keyboard_arrow_down_rounded,
                  size: 16,
                  color: textSecondary,
                ),
                const SizedBox(width: 6),
                Text(
                  _label(),
                  style: TextStyle(
                    fontSize: 12,
                    color: textSecondary,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ],
            ),
          ),
        ),
        // Expanded body: reasoning text.
        if (_expanded) ...[
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: surfaceMuted,
              borderRadius: BorderRadius.circular(RhythmRadius.md),
              border: Border.all(color: borderSubtle),
            ),
            child: SelectableText(
              widget.part.text,
              style: TextStyle(fontSize: 12, color: textSecondary, height: 1.5),
            ),
          ),
        ],
      ],
    );
  }
}
