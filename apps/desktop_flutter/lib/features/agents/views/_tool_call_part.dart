import 'package:flutter/material.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../models/chat_models.dart';

/// Renders a single `ChatPart(type:'tool')` as a collapsible card inside the
/// assistant bubble. Mirrors Opencode Desktop's `PART_MAPPING` for tool calls.
///
/// Header: tool name + status (pending/completed/error).
/// Body: input args + output, collapsed by default.
class ToolCallPart extends StatefulWidget {
  const ToolCallPart({super.key, required this.part});
  final ChatPart part;

  @override
  State<ToolCallPart> createState() => _ToolCallPartState();
}

class _ToolCallPartState extends State<ToolCallPart> {
  // Default-expanded so the tool output is visible inline. Users can
  // collapse manually for noisy ones.
  bool _expanded = true;

  Color _statusColor(BuildContext context) {
    switch (widget.part.toolStatus) {
      case 'completed':
        return const Color(0xFF10B981);
      case 'error':
        return const Color(0xFFEF4444);
      case 'pending':
      default:
        return context.rhythm.textMuted;
    }
  }

  @override
  Widget build(BuildContext context) {
    final part = widget.part;
    final name = part.toolName ?? '(unknown tool)';
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      decoration: BoxDecoration(
        border: Border.all(color: context.rhythm.borderSubtle),
        borderRadius: BorderRadius.circular(6),
        color: context.rhythm.canvas,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            borderRadius: BorderRadius.circular(6),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
              child: Row(
                children: [
                  Icon(
                    _expanded ? Icons.expand_more : Icons.chevron_right,
                    size: 16,
                    color: context.rhythm.textMuted,
                  ),
                  const SizedBox(width: 4),
                  Container(
                    width: 6,
                    height: 6,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: _statusColor(context),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    name,
                    style: TextStyle(
                      fontFamily: 'JetBrainsMono',
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: context.rhythm.textPrimary,
                    ),
                  ),
                  if (part.toolStatus != null) ...[
                    const SizedBox(width: 8),
                    Text(
                      part.toolStatus!,
                      style: TextStyle(
                        fontSize: 11,
                        color: context.rhythm.textMuted,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (_expanded) ...[
            Divider(height: 1, color: context.rhythm.borderSubtle),
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (part.toolArgs != null && part.toolArgs!.isNotEmpty) ...[
                    Text(
                      'args',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                        color: context.rhythm.textMuted,
                        letterSpacing: 0.6,
                      ),
                    ),
                    const SizedBox(height: 4),
                    SelectableText(
                      _prettyArgs(part.toolArgs!),
                      style: const TextStyle(
                        fontFamily: 'JetBrainsMono',
                        fontSize: 11,
                      ),
                    ),
                    const SizedBox(height: 8),
                  ],
                  if (part.toolOutput != null &&
                      part.toolOutput!.isNotEmpty) ...[
                    Text(
                      'output',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                        color: context.rhythm.textMuted,
                        letterSpacing: 0.6,
                      ),
                    ),
                    const SizedBox(height: 4),
                    SelectableText(
                      part.toolOutput!,
                      style: const TextStyle(
                        fontFamily: 'JetBrainsMono',
                        fontSize: 11,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  static String _prettyArgs(Map<String, dynamic> args) {
    return args.entries.map((e) => '${e.key}: ${e.value}').join('\n');
  }
}
