/// OCU-20 (#1061) — Composer @-mention file attach.
///
/// Mirrors the interaction pattern of [SlashCommandPopover]
/// (`_slash_command_popover.dart`): renders a floating fuzzy-file-search list
/// anchored to the composer whenever the token currently being typed starts
/// with '@'. Unlike the slash popover (which only triggers at the START of
/// the message), the '@' trigger can appear anywhere — it matches the last
/// whitespace-delimited token before the cursor-adjacent end of the text.
///
/// Keyboard interaction mirrors the slash popover:
///   - Up/Down arrows navigate the list.
///   - Enter selects the highlighted item.
///   - Escape dismisses the popover.
///
/// The search is debounced 300ms after the query stops changing so a fast
/// typist doesn't fire a request per keystroke.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agents_controller.dart';

/// Matches an '@' token currently being typed at the end of the text: either
/// at the very start of the message or right after whitespace, with no
/// whitespace/'@' in the query itself (so a completed "@file.dart is done"
/// mention followed by more text is NOT re-triggered).
final RegExp _kAtTokenPattern = RegExp(r'(?:^|\s)@([^\s@]*)$');

class AtMentionPopover extends StatefulWidget {
  const AtMentionPopover({
    super.key,
    required this.inputController,
    required this.sessionId,
    required this.child,
    required this.onFileSelected,
  });

  final TextEditingController inputController;

  /// Null when no session is selected — the popover never opens.
  final String? sessionId;
  final Widget child;

  /// Called with the picked file's relative path. The caller is responsible
  /// for removing the '@query' token from the composer text and attaching
  /// the file.
  final ValueChanged<String> onFileSelected;

  @override
  State<AtMentionPopover> createState() => _AtMentionPopoverState();
}

class _AtMentionPopoverState extends State<AtMentionPopover> {
  int _highlightedIndex = 0;
  String? _lastQuery;
  List<String> _results = const [];
  Timer? _debounce;

  /// Set by Escape so the popover stays closed even though the '@query' token
  /// is still present in the text — cleared as soon as the query changes
  /// again (a fresh keystroke re-triggers the trigger).
  bool _dismissed = false;

  RegExpMatch? get _match =>
      _kAtTokenPattern.firstMatch(widget.inputController.text);

  bool get _isOpen => widget.sessionId != null && _match != null && !_dismissed;

  @override
  void initState() {
    super.initState();
    widget.inputController.addListener(_onInputChanged);
  }

  @override
  void dispose() {
    widget.inputController.removeListener(_onInputChanged);
    _debounce?.cancel();
    super.dispose();
  }

  void _onInputChanged() {
    final match = _match;
    final query = match?.group(1);
    if (query == null) {
      // Popover closed — nothing to debounce; just reset selection.
      setState(() {
        _highlightedIndex = 0;
        _lastQuery = null;
        _results = const [];
      });
      return;
    }
    setState(() {
      _highlightedIndex = 0;
      _dismissed = false;
    });
    if (query == _lastQuery) return;
    _lastQuery = query;
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () => _search(query));
  }

  Future<void> _search(String query) async {
    final sessionId = widget.sessionId;
    if (sessionId == null) return;
    try {
      final results = await context.read<AgentsController>().searchFiles(
            sessionId,
            query,
          );
      if (!mounted || _lastQuery != query) return;
      setState(() => _results = results);
    } catch (_) {
      if (!mounted) return;
      setState(() => _results = const []);
    }
  }

  void _select(String path) {
    // Remove the '@query' token being typed — the picked file becomes an
    // attachment chip, not inline text (mirrors a manual file pick).
    final match = _match;
    if (match != null) {
      final text = widget.inputController.text;
      final newText =
          text.substring(0, match.start) + text.substring(match.end);
      widget.inputController.value = TextEditingValue(
        text: newText,
        selection: TextSelection.collapsed(offset: match.start),
      );
    }
    widget.onFileSelected(path);
    setState(() {
      _lastQuery = null;
      _results = const [];
    });
  }

  KeyEventResult _handleKeyEvent(FocusNode _, KeyEvent event) {
    if (!_isOpen) return KeyEventResult.ignored;
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    if (_results.isEmpty) return KeyEventResult.ignored;

    if (event.logicalKey == LogicalKeyboardKey.arrowDown) {
      setState(() {
        _highlightedIndex = (_highlightedIndex + 1) % _results.length;
      });
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowUp) {
      setState(() {
        _highlightedIndex =
            (_highlightedIndex - 1 + _results.length) % _results.length;
      });
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.enter) {
      final idx = _highlightedIndex.clamp(0, _results.length - 1);
      _select(_results[idx]);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.escape) {
      setState(() {
        _lastQuery = null;
        _results = const [];
        _highlightedIndex = 0;
        _dismissed = true;
      });
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    // Focus wraps the text field directly (an ancestor of its own internal
    // focus node, unlike a sibling Focus around the list only) so
    // arrow/enter/escape key events reach this handler while the field is
    // focused.
    final wrappedChild =
        Focus(onKeyEvent: _handleKeyEvent, child: widget.child);
    if (!_isOpen) return wrappedChild;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _AtMentionList(
          results: _results,
          highlightedIndex: _highlightedIndex,
          onSelect: _select,
        ),
        wrappedChild,
      ],
    );
  }
}

class _AtMentionList extends StatelessWidget {
  const _AtMentionList({
    required this.results,
    required this.highlightedIndex,
    required this.onSelect,
  });

  final List<String> results;
  final int highlightedIndex;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    if (results.isEmpty) {
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
          'No matching files',
          key: const ValueKey('at-mention-empty'),
          style: TextStyle(
            fontSize: 12,
            color: context.rhythm.textMuted,
            fontStyle: FontStyle.italic,
          ),
        ),
      );
    }

    return Container(
      key: const ValueKey('at-mention-list'),
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
          itemCount: results.length,
          itemBuilder: (context, index) {
            final path = results[index];
            final isHighlighted = index == highlightedIndex;
            return InkWell(
              key: ValueKey('at-mention-item-$index'),
              onTap: () => onSelect(path),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 80),
                color: isHighlighted
                    ? context.rhythm.accentMuted
                    : Colors.transparent,
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                child: Text(
                  path,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    fontFamily: 'Menlo',
                    color: isHighlighted
                        ? context.rhythm.accent
                        : context.rhythm.textPrimary,
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
