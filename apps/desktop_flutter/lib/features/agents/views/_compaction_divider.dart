import 'package:flutter/material.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../models/chat_models.dart';

/// OPC-M3-3 — Renders a `compaction` part as a horizontal divider labeled
/// "Conversation compacted", with the summary text (if any) hidden until
/// the user expands it.
///
/// Identical render path for streamed and rehydrated compaction parts.
class CompactionDivider extends StatefulWidget {
  const CompactionDivider({super.key, required this.part});

  final ChatPart part;

  @override
  State<CompactionDivider> createState() => _CompactionDividerState();
}

class _CompactionDividerState extends State<CompactionDivider> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final hasSummary = widget.part.text.isNotEmpty;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Divider(
                  color: context.rhythm.borderSubtle,
                  thickness: 1,
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: context.rhythm.accentMuted,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: context.rhythm.accent.withValues(alpha: 0.25),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.compress,
                      size: 12,
                      color: context.rhythm.accent,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      'Conversation compacted',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: context.rhythm.accent,
                      ),
                    ),
                    if (hasSummary) ...[
                      const SizedBox(width: 4),
                      GestureDetector(
                        onTap: () => setState(() => _expanded = !_expanded),
                        child: Icon(
                          _expanded ? Icons.expand_less : Icons.expand_more,
                          size: 14,
                          color: context.rhythm.accent,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Divider(
                  color: context.rhythm.borderSubtle,
                  thickness: 1,
                ),
              ),
            ],
          ),
          if (_expanded && hasSummary) ...[
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: context.rhythm.surfaceMuted,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: context.rhythm.borderSubtle),
              ),
              child: Text(
                widget.part.text,
                style: TextStyle(
                  fontSize: 12,
                  color: context.rhythm.textSecondary,
                  height: 1.4,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
