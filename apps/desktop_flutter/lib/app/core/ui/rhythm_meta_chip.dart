import 'package:flutter/material.dart';

import 'tokens/rhythm_theme.dart';

enum RhythmMetaChipTone { neutral, accent, success, warning, danger, info }

/// Compact, low-chrome chip for task metadata: due dates, priorities,
/// project tags, assignees, etc. Reads as a label rather than as a button.
class RhythmMetaChip extends StatelessWidget {
  const RhythmMetaChip({
    super.key,
    required this.label,
    this.icon,
    this.tone = RhythmMetaChipTone.neutral,
    this.tooltip,
  });

  final String label;
  final IconData? icon;
  final RhythmMetaChipTone tone;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final foreground = switch (tone) {
      RhythmMetaChipTone.neutral => colors.textSecondary,
      RhythmMetaChipTone.accent => colors.accent,
      RhythmMetaChipTone.success => colors.success,
      RhythmMetaChipTone.warning => colors.warning,
      RhythmMetaChipTone.danger => colors.danger,
      RhythmMetaChipTone.info => colors.info,
    };
    final background = tone == RhythmMetaChipTone.neutral
        ? colors.surfaceMuted
        : foreground.withValues(alpha: 0.10);

    final theme = Theme.of(context);
    final chip = DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: RhythmSpacing.xs,
          vertical: 2,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 12, color: foreground),
              const SizedBox(width: 4),
            ],
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.labelSmall?.copyWith(
                color: foreground,
                fontWeight: FontWeight.w600,
                letterSpacing: 0,
              ),
            ),
          ],
        ),
      ),
    );

    if (tooltip == null) return chip;
    return Tooltip(message: tooltip!, child: chip);
  }
}
