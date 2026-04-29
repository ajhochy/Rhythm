import 'package:flutter/material.dart';

import 'tokens/rhythm_theme.dart';

enum RhythmMetaChipTone { neutral, accent, success, warning, danger, info }

/// Compact, low-chrome chip for task metadata: due dates, priorities,
/// project tags, owners, source labels, and similar one-glance attributes.
///
/// Reads as a label rather than as a button. Renders as a pill with a tinted
/// fill, a matching subtle border, an optional leading icon, and a single
/// truncating label.
class RhythmMetaChip extends StatelessWidget {
  const RhythmMetaChip({
    super.key,
    required this.label,
    this.icon,
    this.tone = RhythmMetaChipTone.neutral,
    this.color,
    this.maxWidth,
    this.tooltip,
  });

  final String label;
  final IconData? icon;
  final RhythmMetaChipTone tone;

  /// Explicit foreground color override. When provided, the chip ignores
  /// [tone] and derives its background tint and border from this color.
  /// Useful for context-driven palettes (e.g. the planner's per-task accent
  /// colors) that don't map cleanly onto a fixed tone enum.
  final Color? color;

  /// Optional maximum width. The label truncates with ellipsis to fit.
  final double? maxWidth;

  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final foreground = color ??
        switch (tone) {
          RhythmMetaChipTone.neutral => colors.textSecondary,
          RhythmMetaChipTone.accent => colors.accent,
          RhythmMetaChipTone.success => colors.success,
          RhythmMetaChipTone.warning => colors.warning,
          RhythmMetaChipTone.danger => colors.danger,
          RhythmMetaChipTone.info => colors.info,
        };

    final theme = Theme.of(context);
    Widget chip = DecoratedBox(
      decoration: BoxDecoration(
        color: foreground.withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(RhythmRadius.pill),
        border: Border.all(color: foreground.withValues(alpha: 0.22)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 11, color: foreground),
              const SizedBox(width: 4),
            ],
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: foreground,
                  fontWeight: FontWeight.w700,
                  height: 1,
                ),
              ),
            ),
          ],
        ),
      ),
    );

    if (maxWidth != null) {
      chip = ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth!),
        child: chip,
      );
    }

    if (tooltip != null) {
      chip = Tooltip(message: tooltip!, child: chip);
    }
    return chip;
  }
}
