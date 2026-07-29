/// OPC-M3-5 — Collapsible todo panel for the session side rail.
///
/// Renders the session's current todo list (hydrated from
/// `GET /agent-sessions/:id/todo` and updated live via `todo.updated` WS
/// events). Uses the M2-3 checklist row style ([_TodoRow]) so completed,
/// in-progress and pending items render with the same status-driven checkbox
/// states as the inline TodoChecklistView in the transcript.
///
/// Panel is hidden entirely when the todo list is empty. When nonempty:
///   - Header shows the panel label + "completed/total" count (e.g. "2/5").
///   - Collapse/expand toggle button (Icons.expand_less / Icons.expand_more).
///   - Body shows the checklist rows when expanded.
///
/// [collapseKey] is used to persist per-session collapse state — callers
/// pass the session id so the collapsed/expanded state is remembered while
/// the user switches between sessions.
library;

import 'package:flutter/material.dart';
import 'package:rhythm_desktop/app/core/ui/tokens/rhythm_theme.dart';

/// A collapsible panel that shows a session's todo list.
///
/// Returns [SizedBox.shrink] when [todos] is empty so the parent layout
/// does not allocate any space for it.
class TodoPanel extends StatefulWidget {
  const TodoPanel({super.key, required this.todos, required this.collapseKey});

  /// The current todo list for the session. Each map has:
  /// { id, content, status, priority }
  final List<Map<String, dynamic>> todos;

  /// Stable key used to remember collapse state per session.
  /// Pass the local session id.
  final String collapseKey;

  @override
  State<TodoPanel> createState() => _TodoPanelState();
}

/// Global per-session collapse registry so the collapsed state survives
/// widget rebuilds and session switches within the same app run.
///
/// Key = session id (collapseKey). Value = true when the panel is collapsed.
/// Collapsed entries are never removed (they are small strings) so the
/// state is preserved for the full app lifetime as required by c6.
final Map<String, bool> _collapseRegistry = {};

class _TodoPanelState extends State<TodoPanel> {
  bool get _collapsed => _collapseRegistry[widget.collapseKey] ?? false;

  void _toggle() {
    setState(() {
      _collapseRegistry[widget.collapseKey] = !_collapsed;
    });
  }

  @override
  Widget build(BuildContext context) {
    final todos = widget.todos;
    if (todos.isEmpty) return const SizedBox.shrink();

    final completed = todos.where((t) => t['status'] == 'completed').length;
    final total = todos.length;

    return Container(
      decoration: BoxDecoration(
        color: context.rhythm.canvas,
        border: Border(top: BorderSide(color: context.rhythm.borderSubtle)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header row: label + progress + collapse toggle.
          InkWell(
            onTap: _toggle,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  Text(
                    'Todos',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.4,
                      color: context.rhythm.textMuted,
                    ),
                  ),
                  const SizedBox(width: 6),
                  // Progress count: e.g. "1/3".
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: context.rhythm.surfaceMuted,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: context.rhythm.borderSubtle),
                    ),
                    child: Text(
                      '$completed/$total',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                        color: completed == total
                            ? context.rhythm.success
                            : context.rhythm.textSecondary,
                      ),
                    ),
                  ),
                  const Spacer(),
                  Icon(
                    _collapsed ? Icons.expand_more : Icons.expand_less,
                    size: 16,
                    color: context.rhythm.textMuted,
                  ),
                ],
              ),
            ),
          ),
          // Checklist rows (hidden when collapsed).
          if (!_collapsed)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Column(
                children: [for (final todo in todos) _TodoRow(todo: todo)],
              ),
            ),
        ],
      ),
    );
  }
}

/// A single read-only checklist row — mirrors [_TodoRow] from
/// `_todo_checklist_view.dart` but operates on raw [Map] entries rather than
/// a [ChatPart] so it can be driven by the controller's `_sessionTodosBySession`
/// map directly.
class _TodoRow extends StatelessWidget {
  const _TodoRow({required this.todo});

  final Map<String, dynamic> todo;

  bool? _checkboxValue(String status) {
    switch (status) {
      case 'completed':
        return true;
      case 'in-progress':
        return null; // tristate: dash
      default:
        return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final content = (todo['content'] as String?) ?? '';
    final status = (todo['status'] as String?) ?? 'pending';
    final isCompleted = status == 'completed';
    final checkValue = _checkboxValue(status);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          SizedBox(
            width: 28,
            height: 28,
            child: Checkbox(
              value: checkValue,
              tristate: checkValue == null,
              onChanged: null, // read-only
              activeColor: context.rhythm.success,
              checkColor: context.rhythm.surfaceRaised,
              side: BorderSide(color: context.rhythm.borderSubtle),
            ),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Text(
              content,
              style: TextStyle(
                fontSize: 12,
                color: isCompleted
                    ? context.rhythm.textMuted
                    : context.rhythm.textPrimary,
                decoration: isCompleted ? TextDecoration.lineThrough : null,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
