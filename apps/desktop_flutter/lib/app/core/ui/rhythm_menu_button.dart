import 'package:flutter/material.dart';

import 'tokens/rhythm_theme.dart';

class RhythmMenuAction<T> {
  const RhythmMenuAction({
    required this.value,
    required this.label,
    this.icon,
    this.destructive = false,
  });

  final T value;
  final String label;
  final IconData? icon;
  final bool destructive;
}

class RhythmMenuButton<T> extends StatelessWidget {
  const RhythmMenuButton({
    super.key,
    required this.items,
    required this.onSelected,
    this.tooltip = 'More actions',
    this.icon = Icons.more_horiz,
  });

  final List<RhythmMenuAction<T>> items;
  final ValueChanged<T> onSelected;
  final String tooltip;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return PopupMenuButton<T>(
      tooltip: tooltip,
      onSelected: onSelected,
      itemBuilder: (context) => items
          .map(
            (item) => PopupMenuItem<T>(
              value: item.value,
              child: Row(
                children: [
                  if (item.icon != null) ...[
                    Icon(item.icon, size: 16),
                    const SizedBox(width: 8),
                  ],
                  Text(item.label),
                ],
              ),
            ),
          )
          .toList(),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surfaceMuted,
          borderRadius: BorderRadius.circular(RhythmRadius.md),
          border: Border.all(color: colors.borderSubtle),
        ),
        child: SizedBox.square(
          dimension: 34,
          child: Icon(icon, size: 16, color: colors.textSecondary),
        ),
      ),
    );
  }
}
