/// OPC-M2-3 — Terminal output renderer for bash tool parts.
///
/// Renders a bash tool call as:
///   - Command header (monospace, shown as the "prompt" line)
///   - Output text with:
///       * ANSI escape sequences stripped (e.g. \x1b[31m removed)
///       * Whitespace preserved (SelectableText in monospace)
///   - Exit-code badge when status='error' and exitCode is present
///   - Status indicator driven by ToolState
///
/// Usage:
///   TerminalOutputView(part: part)
library;

import 'package:flutter/material.dart';
import 'package:rhythm_desktop/app/core/ui/tokens/rhythm_theme.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';

import '_tool_state_indicator.dart';

/// Strips ANSI escape sequences from [text].
///
/// Handles the most common forms: \x1b[...m (SGR), \x1b[...A/B/C/D (cursor),
/// and any 7-bit CSI sequences of the form ESC[...{final-byte}.
String stripAnsi(String text) {
  // Pattern: ESC (0x1B) followed by '[' and then any chars up to a letter.
  return text.replaceAll(
    RegExp(r'\x1B\[[0-9;]*[mABCDEFGHJKSTflnsu]'),
    '',
  );
}

/// Renders a bash tool part as a monospace terminal block.
class TerminalOutputView extends StatelessWidget {
  const TerminalOutputView({super.key, required this.part});

  final ChatPart part;

  String _command() {
    final args = part.toolArgs ?? {};
    return (args['command'] as String?) ?? (part.toolName ?? 'bash');
  }

  String _strippedOutput() {
    final raw = part.toolOutput ?? '';
    return stripAnsi(raw);
  }

  int? _exitCode() {
    // exitCode may be in state.input.exitCode (some tool shapes).
    final fromArgs = part.toolArgs?['exitCode'];
    if (fromArgs is int) return fromArgs;
    if (fromArgs is String) return int.tryParse(fromArgs);
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final toolStatus = part.toolStatus ?? 'pending';
    final command = _command();
    final output = _strippedOutput();
    final isError = toolStatus == 'error';
    final exitCode = _exitCode();

    return Container(
      decoration: BoxDecoration(
        color: context.rhythm.canvas,
        border: Border.all(color: context.rhythm.borderSubtle),
        borderRadius: BorderRadius.circular(RhythmRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header: status indicator + command.
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: context.rhythm.surfaceMuted,
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(RhythmRadius.md),
                topRight: Radius.circular(RhythmRadius.md),
              ),
              border: Border(
                bottom: BorderSide(color: context.rhythm.borderSubtle),
              ),
            ),
            child: Row(
              children: [
                ToolStateIndicator(toolStatus: toolStatus),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '\$ $command',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontFamily: 'JetBrainsMono',
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: context.rhythm.textPrimary,
                    ),
                  ),
                ),
                // Exit-code badge when there's an error with an exit code.
                if (isError) ...[
                  const SizedBox(width: 8),
                  _ExitCodeBadge(exitCode: exitCode ?? 1),
                ],
              ],
            ),
          ),
          // Output body.
          if (output.isNotEmpty)
            Padding(
              padding: const EdgeInsets.all(10),
              child: SelectableText(
                output,
                style: TextStyle(
                  fontFamily: 'JetBrainsMono',
                  fontSize: 11,
                  color: isError
                      ? context.rhythm.danger
                      : context.rhythm.textSecondary,
                  height: 1.4,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Small badge showing the exit code of a failed bash command.
class _ExitCodeBadge extends StatelessWidget {
  const _ExitCodeBadge({required this.exitCode});

  final int exitCode;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: context.rhythm.danger.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: context.rhythm.danger.withValues(alpha: 0.3),
        ),
      ),
      child: Text(
        'exit: $exitCode',
        style: TextStyle(
          fontFamily: 'JetBrainsMono',
          fontSize: 10,
          fontWeight: FontWeight.w600,
          color: context.rhythm.danger,
        ),
      ),
    );
  }
}
