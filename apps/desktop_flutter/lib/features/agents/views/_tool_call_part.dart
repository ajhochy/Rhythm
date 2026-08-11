import 'dart:io';

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
  // Default-COLLAPSED (maintainer smoke feedback, 2026-07-02): opening a
  // session with a tool-heavy transcript rendered every args/output body
  // expanded, drowning the conversation. The header (tool name + status)
  // stays visible; users expand the calls they care about.
  bool _expanded = false;

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
    if (part.toolName?.toLowerCase() == 'image_generation' &&
        part.toolStatus == 'completed') {
      return _GeneratedImageToolPart(part: part);
    }
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

class _GeneratedImageToolPart extends StatelessWidget {
  const _GeneratedImageToolPart({required this.part});

  final ChatPart part;

  @override
  Widget build(BuildContext context) {
    final rawPath = part.toolMetadata?['path'];
    final path = rawPath is String ? rawPath.trim() : '';
    final exists = path.isNotEmpty && File(path).existsSync();

    return Container(
      key: ValueKey('generated-image-${part.id}'),
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        border: Border.all(color: context.rhythm.borderSubtle),
        borderRadius: BorderRadius.circular(8),
        color: context.rhythm.canvas,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (exists)
            Semantics(
              label: 'Generated image',
              image: true,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: Image.file(
                  File(path),
                  fit: BoxFit.contain,
                  errorBuilder: (_, __, ___) =>
                      _UnavailableGeneratedImage(path: path),
                ),
              ),
            )
          else
            _UnavailableGeneratedImage(path: path),
        ],
      ),
    );
  }
}

class _UnavailableGeneratedImage extends StatelessWidget {
  const _UnavailableGeneratedImage({required this.path});

  final String path;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Generated image unavailable',
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceMuted,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Column(
          children: [
            Icon(Icons.broken_image_outlined, color: context.rhythm.textMuted),
            const SizedBox(height: 8),
            Text(
              'Image unavailable',
              style: TextStyle(color: context.rhythm.textPrimary),
            ),
            const SizedBox(height: 4),
            SelectableText(
              path.isEmpty ? 'No image path was provided.' : path,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: context.rhythm.textMuted,
                fontFamily: 'JetBrainsMono',
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
