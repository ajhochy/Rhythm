/// OPC-M1-6 / issue #709 — Terminal command-runner tab.
///
/// Renders inside the Terminal tab of [SessionSidePanel]. It is a one-shot
/// command-runner (no PTY, no interactive stdin): the user types a command,
/// presses Enter, and the output streams in via the existing SSE→WS bridge
/// (message.part.updated) once the SDK's session.shell call has created the
/// message. PTY / interactive terminals are issue #708.
///
/// Layout:
///   - Scrollable log of entries at the top (command echo + TerminalOutputView)
///   - Empty state text ("Run a command to get started.") when no entries.
///   - Error line when the last shell call failed (criterion c5).
///   - Fixed TextField at the bottom for command input.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agents_controller.dart';
import '../models/chat_models.dart';
import '_tool_renderers/_terminal_output_view.dart';

class TerminalTab extends StatefulWidget {
  const TerminalTab({super.key, required this.sessionId});

  final String sessionId;

  @override
  State<TerminalTab> createState() => _TerminalTabState();
}

class _TerminalTabState extends State<TerminalTab> {
  final _commandController = TextEditingController();
  final _scrollController = ScrollController();
  bool _submitting = false;

  @override
  void dispose() {
    _commandController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _submit(AgentsController controller) async {
    final command = _commandController.text.trim();
    if (command.isEmpty || _submitting) return;
    setState(() => _submitting = true);
    _commandController.clear();
    try {
      await controller.runShellCommand(widget.sessionId, command);
      // Scroll to bottom after new entry is rendered.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scrollController.hasClients) {
          _scrollController.animateTo(
            _scrollController.position.maxScrollExtent,
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
          );
        }
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final entries = controller.terminalEntriesFor(widget.sessionId);
    final error = controller.terminalErrorFor(widget.sessionId);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Scrollable output area.
        Expanded(
          child: entries.isEmpty && error == null
              ? Center(
                  child: Text(
                    'Run a command to get started.',
                    style: TextStyle(
                      color: context.rhythm.textMuted,
                      fontSize: 12,
                    ),
                    textAlign: TextAlign.center,
                  ),
                )
              : ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.all(10),
                  itemCount: entries.length + (error != null ? 1 : 0),
                  itemBuilder: (context, index) {
                    // Error line appended after the entries list.
                    if (error != null && index == entries.length) {
                      return _ErrorLine(
                        key: const Key('terminal-error-line'),
                        message: error,
                      );
                    }
                    final entry = entries[index];
                    final parts = controller.chatPartsFor(entry.messageId);
                    // Filter to bash/tool parts only.
                    final toolParts =
                        parts.where((p) => p.type == 'tool').toList();
                    return _CommandBlock(
                      command: entry.command,
                      toolParts: toolParts,
                    );
                  },
                ),
        ),
        // Command input field.
        _CommandInput(
          controller: _commandController,
          submitting: _submitting,
          onSubmit: () => _submit(context.read<AgentsController>()),
        ),
      ],
    );
  }
}

/// One entry in the terminal log: command echo header + output parts.
class _CommandBlock extends StatelessWidget {
  const _CommandBlock({
    required this.command,
    required this.toolParts,
  });

  final String command;
  final List<ChatPart> toolParts;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Command echo — monospace header mimicking a shell prompt.
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: context.rhythm.canvas,
              border: Border.all(color: context.rhythm.borderSubtle),
              borderRadius: BorderRadius.circular(RhythmRadius.md),
            ),
            child: Text(
              '\$ $command',
              style: TextStyle(
                fontFamily: 'JetBrainsMono',
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textPrimary,
              ),
            ),
          ),
          // Output parts (each tool part → TerminalOutputView).
          for (final part in toolParts)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: TerminalOutputView(part: part),
            ),
        ],
      ),
    );
  }
}

/// Inline error line shown when the last shell call failed (criterion c5).
class _ErrorLine extends StatelessWidget {
  const _ErrorLine({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: context.rhythm.danger.withValues(alpha: 0.08),
          border:
              Border.all(color: context.rhythm.danger.withValues(alpha: 0.3)),
          borderRadius: BorderRadius.circular(RhythmRadius.md),
        ),
        child: Row(
          children: [
            Icon(Icons.error_outline, size: 14, color: context.rhythm.danger),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                message,
                style: TextStyle(
                  fontFamily: 'JetBrainsMono',
                  fontSize: 11,
                  color: context.rhythm.danger,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Command input field at the bottom of the Terminal tab.
class _CommandInput extends StatelessWidget {
  const _CommandInput({
    required this.controller,
    required this.submitting,
    required this.onSubmit,
  });

  final TextEditingController controller;
  final bool submitting;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
      decoration: BoxDecoration(
        border: Border(
          top: BorderSide(color: context.rhythm.borderSubtle),
        ),
      ),
      child: TextField(
        key: const Key('terminal-command-input'),
        controller: controller,
        enabled: !submitting,
        style: TextStyle(
          fontFamily: 'JetBrainsMono',
          fontSize: 12,
          color: context.rhythm.textPrimary,
        ),
        decoration: InputDecoration(
          hintText: 'Enter a command…',
          hintStyle: TextStyle(
            fontFamily: 'JetBrainsMono',
            fontSize: 12,
            color: context.rhythm.textMuted,
          ),
          prefixText: '\$ ',
          prefixStyle: TextStyle(
            fontFamily: 'JetBrainsMono',
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: context.rhythm.textSecondary,
          ),
          isDense: true,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(RhythmRadius.sm),
            borderSide: BorderSide(color: context.rhythm.border),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(RhythmRadius.sm),
            borderSide: BorderSide(color: context.rhythm.border),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(RhythmRadius.sm),
            borderSide: BorderSide(color: context.rhythm.accent, width: 1.5),
          ),
        ),
        textInputAction: TextInputAction.done,
        onSubmitted: (_) => onSubmit(),
      ),
    );
  }
}
