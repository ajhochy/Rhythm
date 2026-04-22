import 'package:flutter/material.dart';

import 'tokens/rhythm_theme.dart';

enum RhythmBadgeTone { neutral, accent, success, warning, danger, info }

class RhythmBadge extends StatelessWidget {
  const RhythmBadge({
    super.key,
    required this.label,
    this.icon,
    this.tone = RhythmBadgeTone.neutral,
    this.compact = false,
  });

  final String label;
  final IconData? icon;
  final RhythmBadgeTone tone;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final foreground = _foreground(colors);
    final background = _background(colors, foreground);
    final textStyle = Theme.of(context).textTheme.labelSmall?.copyWith(
          color: foreground,
          fontWeight: FontWeight.w700,
          letterSpacing: 0,
        );

    return DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(RhythmRadius.pill),
        border: Border.all(color: foreground.withValues(alpha: 0.22)),
      ),
      child: Padding(
        padding: EdgeInsets.symmetric(
          horizontal: compact ? RhythmSpacing.xs : RhythmSpacing.sm,
          vertical: compact ? 3 : 5,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: compact ? 12 : 14, color: foreground),
              const SizedBox(width: RhythmSpacing.xxs),
            ],
            Text(label, style: textStyle),
          ],
        ),
      ),
    );
  }

  Color _foreground(RhythmColorRoles colors) {
    return switch (tone) {
      RhythmBadgeTone.neutral => colors.textSecondary,
      RhythmBadgeTone.accent => colors.accent,
      RhythmBadgeTone.success => colors.success,
      RhythmBadgeTone.warning => colors.warning,
      RhythmBadgeTone.danger => colors.danger,
      RhythmBadgeTone.info => colors.info,
    };
  }

  Color _background(RhythmColorRoles colors, Color foreground) {
    if (tone == RhythmBadgeTone.neutral) return colors.surfaceMuted;
    return foreground.withValues(alpha: 0.13);
  }
}
