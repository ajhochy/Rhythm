import 'package:flutter/material.dart';

import '../../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../models/task.dart';

/// Reusable row widget for a single task.
///
/// Leading edge: circular checkbox whose tap triggers [onToggle].
/// Body: [task.title] (bold), optional single-line notes (muted), optional
/// source name (small, muted).
class TaskListItem extends StatelessWidget {
  const TaskListItem({
    super.key,
    required this.task,
    required this.onToggle,
  });

  final Task task;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final isDone = task.status == TaskStatus.done;

    return InkWell(
      onTap: onToggle,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: RhythmSpacing.md,
          vertical: RhythmSpacing.sm,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Circular checkbox.
            GestureDetector(
              onTap: onToggle,
              child: Padding(
                padding: const EdgeInsets.only(
                  top: 1,
                  right: RhythmSpacing.sm,
                ),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  width: 22,
                  height: 22,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isDone ? colors.accent : Colors.transparent,
                    border: isDone
                        ? null
                        : Border.all(color: colors.border, width: 1.5),
                  ),
                  child: isDone
                      ? const Icon(
                          Icons.check,
                          size: 13,
                          color: Colors.white,
                        )
                      : null,
                ),
              ),
            ),
            // Text content.
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    task.title,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: isDone ? colors.textMuted : colors.textPrimary,
                          decoration: isDone
                              ? TextDecoration.lineThrough
                              : TextDecoration.none,
                        ),
                  ),
                  if (task.notes != null && task.notes!.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      task.notes!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: colors.textMuted,
                          ),
                    ),
                  ],
                  if (task.sourceName != null &&
                      task.sourceName!.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      task.sourceName!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: colors.textMuted,
                            fontSize: 11,
                          ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
