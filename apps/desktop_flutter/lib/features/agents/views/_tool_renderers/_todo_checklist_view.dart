/// OPC-M2-3 — Checklist renderer for todowrite tool parts.
///
/// Renders each todo item as a checklist row with:
///   - Checkbox (checked if status == 'completed'; tri-state for 'in-progress')
///   - Todo content text
///   - Status indicator (leading ToolStateIndicator for the overall part)
///
/// Reusable: the M3-5 todo side panel will import this widget directly.
///
/// Usage:
///   TodoChecklistView(part: part)
library;

import 'package:flutter/material.dart';
import 'package:rhythm_desktop/app/core/ui/tokens/rhythm_theme.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';

import '_tool_state_indicator.dart';

/// Maps a todo status string to a checkbox checked state.
/// 'completed' → true (checked)
/// 'in-progress' → null (indeterminate — not started but active)
/// 'pending' / anything else → false (unchecked)
bool? _checkboxValue(String status) {
  switch (status) {
    case 'completed':
      return true;
    case 'in-progress':
      // Use tri-state: indeterminate (null) shows a dash in Checkbox.
      return null;
    default:
      return false;
  }
}

/// Renders a todowrite tool part as a vertical checklist.
class TodoChecklistView extends StatelessWidget {
  const TodoChecklistView({super.key, required this.part});

  final ChatPart part;

  List<Map<String, dynamic>> _todos() {
    final args = part.toolArgs ?? {};
    final raw = args['todos'];
    if (raw is List) {
      return raw.whereType<Map<String, dynamic>>().toList();
    }
    return [];
  }

  @override
  Widget build(BuildContext context) {
    final toolStatus = part.toolStatus ?? 'pending';
    final todos = _todos();

    return Container(
      decoration: BoxDecoration(
        color: context.rhythm.canvas,
        border: Border.all(color: context.rhythm.borderSubtle),
        borderRadius: BorderRadius.circular(RhythmRadius.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header: status indicator + label.
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
                Text(
                  'Todos',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: context.rhythm.textPrimary,
                  ),
                ),
                if (todos.isNotEmpty) ...[
                  const SizedBox(width: 8),
                  Text(
                    '(${todos.length})',
                    style: TextStyle(
                      fontSize: 11,
                      color: context.rhythm.textMuted,
                    ),
                  ),
                ],
              ],
            ),
          ),
          // Checklist rows.
          if (todos.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Column(
                children: [for (final todo in todos) _TodoRow(todo: todo)],
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.all(10),
              child: Text(
                'No todos',
                style: TextStyle(fontSize: 12, color: context.rhythm.textMuted),
              ),
            ),
        ],
      ),
    );
  }
}

class _TodoRow extends StatelessWidget {
  const _TodoRow({required this.todo});

  final Map<String, dynamic> todo;

  @override
  Widget build(BuildContext context) {
    final content = (todo['content'] as String?) ?? '';
    final status = (todo['status'] as String?) ?? 'pending';
    final isCompleted = status == 'completed';
    final checkValue = _checkboxValue(status);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // Checkbox (read-only; onChanged returns null to make it non-interactive).
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
