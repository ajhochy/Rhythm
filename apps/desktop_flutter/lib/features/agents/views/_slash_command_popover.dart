/// Issue #610 — Composer slash-command popover.
///
/// Renders a floating list of available slash-commands anchored to the
/// composer's TextField when the input text starts with '/'.
///
/// Keyboard interaction:
///   - Up/Down arrows navigate the list.
///   - Enter selects the highlighted item.
///   - Escape dismisses the popover.
///
/// Selecting a command writes the canonical command text back into the
/// input (with a trailing space) and dismisses the popover.
///
/// Empty catalog → quiet "No commands" empty state; never crashes.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../data/commands_data_source.dart';

/// Wraps [child] and shows a slash-command popover whenever [inputController]
/// text starts with '/'. [commands] should be the live list from
/// [AgentsController.slashCommands].
///
/// [onCommandSelected] is called with the full command text (e.g. '/help').
/// The caller is responsible for writing it into [inputController].
class SlashCommandPopover extends StatefulWidget {
  const SlashCommandPopover({
    super.key,
    required this.inputController,
    required this.commands,
    required this.child,
    required this.onCommandSelected,
  });

  final TextEditingController inputController;
  final List<SlashCommand> commands;
  final Widget child;
  final ValueChanged<String> onCommandSelected;

  @override
  State<SlashCommandPopover> createState() => _SlashCommandPopoverState();
}

class _SlashCommandPopoverState extends State<SlashCommandPopover> {
  int _highlightedIndex = 0;

  List<SlashCommand> _filtered(String input) {
    final query = input.substring(1).toLowerCase(); // strip leading '/'
    if (query.isEmpty) return widget.commands;
    return widget.commands
        .where((c) => c.name.toLowerCase().contains(query))
        .toList();
  }

  bool get _isOpen {
    final text = widget.inputController.text;
    return text.startsWith('/') && widget.commands.isNotEmpty;
  }

  @override
  void initState() {
    super.initState();
    widget.inputController.addListener(_onInputChanged);
  }

  @override
  void dispose() {
    widget.inputController.removeListener(_onInputChanged);
    super.dispose();
  }

  void _onInputChanged() {
    setState(() {
      _highlightedIndex = 0;
    });
  }

  void _select(SlashCommand command, String query) {
    widget.onCommandSelected('/${command.name} ');
    setState(() {}); // will re-evaluate _isOpen → popover closes
  }

  KeyEventResult _handleKeyEvent(FocusNode _, KeyEvent event) {
    if (!_isOpen) return KeyEventResult.ignored;
    if (event is! KeyDownEvent) return KeyEventResult.ignored;

    final filtered = _filtered(widget.inputController.text);
    if (filtered.isEmpty) return KeyEventResult.ignored;

    if (event.logicalKey == LogicalKeyboardKey.arrowDown) {
      setState(() {
        _highlightedIndex = (_highlightedIndex + 1) % filtered.length;
      });
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowUp) {
      setState(() {
        _highlightedIndex =
            (_highlightedIndex - 1 + filtered.length) % filtered.length;
      });
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.enter) {
      final idx = _highlightedIndex.clamp(0, filtered.length - 1);
      _select(filtered[idx], widget.inputController.text);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.escape) {
      setState(() {
        // Clear the input's slash to dismiss — or just forcefully rebuild.
        // We don't own the controller's content, so we do a minimal dismiss:
        // clear the selection so the parent sees the popover close on rebuild.
        _highlightedIndex = 0;
      });
      // Tell the parent to clear the leading '/'.
      widget.onCommandSelected('');
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    if (!_isOpen) return widget.child;

    final filtered = _filtered(widget.inputController.text);

    return Stack(
      clipBehavior: Clip.none,
      children: [
        widget.child,
        Positioned(
          bottom: 0,
          left: 0,
          right: 0,
          child: Focus(
            onKeyEvent: _handleKeyEvent,
            child: _CommandList(
              commands: filtered,
              highlightedIndex: _highlightedIndex,
              onSelect: (cmd) => _select(cmd, widget.inputController.text),
            ),
          ),
        ),
      ],
    );
  }
}

class _CommandList extends StatelessWidget {
  const _CommandList({
    required this.commands,
    required this.highlightedIndex,
    required this.onSelect,
  });

  final List<SlashCommand> commands;
  final int highlightedIndex;
  final ValueChanged<SlashCommand> onSelect;

  @override
  Widget build(BuildContext context) {
    if (commands.isEmpty) {
      return Container(
        margin: const EdgeInsets.only(bottom: 4),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceRaised,
          borderRadius: BorderRadius.circular(RhythmRadius.lg),
          border: Border.all(color: context.rhythm.border),
          boxShadow: RhythmElevation.panel,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Text(
          'No commands',
          style: TextStyle(
            fontSize: 12,
            color: context.rhythm.textMuted,
            fontStyle: FontStyle.italic,
          ),
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 4),
      constraints: const BoxConstraints(maxHeight: 240),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: context.rhythm.border),
        boxShadow: RhythmElevation.panel,
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        child: ListView.builder(
          padding: const EdgeInsets.symmetric(vertical: 4),
          shrinkWrap: true,
          itemCount: commands.length,
          itemBuilder: (context, index) {
            final cmd = commands[index];
            final isHighlighted = index == highlightedIndex;
            return InkWell(
              onTap: () => onSelect(cmd),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 80),
                color: isHighlighted
                    ? context.rhythm.accentMuted
                    : Colors.transparent,
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                child: Row(
                  children: [
                    Text(
                      '/${cmd.name}',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        fontFamily: 'Menlo',
                        color: isHighlighted
                            ? context.rhythm.accent
                            : context.rhythm.textPrimary,
                      ),
                    ),
                    if (cmd.description != null &&
                        cmd.description!.isNotEmpty) ...[
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          cmd.description!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 11,
                            color: context.rhythm.textSecondary,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
