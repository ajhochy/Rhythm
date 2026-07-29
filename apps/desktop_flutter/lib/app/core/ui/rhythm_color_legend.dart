import 'package:flutter/material.dart';

import 'tokens/rhythm_theme.dart';

class RhythmColorLegend extends StatelessWidget {
  const RhythmColorLegend({super.key, required this.items});

  final List<(Color, String)> items;

  @override
  Widget build(BuildContext context) {
    // Wrap, not Row: legends with many items must flow to the next line at
    // narrow widths instead of overflowing (latent on Tasks/Weekly Planner).
    return Wrap(
      spacing: 10,
      runSpacing: 4,
      children: [
        for (final item in items) _LegendItem(color: item.$1, label: item.$2),
      ],
    );
  }
}

class _LegendItem extends StatelessWidget {
  const _LegendItem({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: colors.textMuted,
                fontSize: 10,
              ),
        ),
      ],
    );
  }
}
