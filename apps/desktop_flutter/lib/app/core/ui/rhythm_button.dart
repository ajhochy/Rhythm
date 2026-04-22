import 'package:flutter/material.dart';

import 'tokens/rhythm_theme.dart';

enum RhythmButtonVariant { filled, outlined, quiet, icon }

class RhythmButton extends StatelessWidget {
  const RhythmButton({
    super.key,
    required this.onPressed,
    this.label,
    this.icon,
    this.tooltip,
    this.variant = RhythmButtonVariant.filled,
    this.compact = false,
  });

  final VoidCallback? onPressed;
  final String? label;
  final IconData? icon;
  final String? tooltip;
  final RhythmButtonVariant variant;
  final bool compact;

  const RhythmButton.filled({
    super.key,
    required this.onPressed,
    required this.label,
    this.icon,
    this.tooltip,
    this.compact = false,
  }) : variant = RhythmButtonVariant.filled;

  const RhythmButton.outlined({
    super.key,
    required this.onPressed,
    required this.label,
    this.icon,
    this.tooltip,
    this.compact = false,
  }) : variant = RhythmButtonVariant.outlined;

  const RhythmButton.quiet({
    super.key,
    required this.onPressed,
    required this.label,
    this.icon,
    this.tooltip,
    this.compact = false,
  }) : variant = RhythmButtonVariant.quiet;

  const RhythmButton.icon({
    super.key,
    required this.onPressed,
    required this.icon,
    required this.tooltip,
    this.compact = false,
  })  : label = null,
        variant = RhythmButtonVariant.icon;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final radius = BorderRadius.circular(RhythmRadius.md);
    final minimumSize = Size(compact ? 34 : 40, compact ? 34 : 40);

    if (variant == RhythmButtonVariant.icon) {
      final button = IconButton(
        onPressed: onPressed,
        tooltip: tooltip,
        icon: Icon(icon, size: compact ? 16 : 18),
        style: IconButton.styleFrom(
          minimumSize: minimumSize,
          foregroundColor: colors.textSecondary,
          backgroundColor: colors.surfaceMuted,
          disabledForegroundColor: colors.textMuted.withValues(
            alpha: RhythmStateLayer.disabledOpacity,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: radius,
            side: BorderSide(color: colors.borderSubtle),
          ),
        ),
      );
      return button;
    }

    final child = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) ...[
          Icon(icon, size: compact ? 15 : 17),
          const SizedBox(width: RhythmSpacing.xs),
        ],
        Text(label ?? ''),
      ],
    );

    final style = switch (variant) {
      RhythmButtonVariant.filled => FilledButton.styleFrom(
          minimumSize: minimumSize,
          backgroundColor: colors.accent,
          foregroundColor: Colors.white,
          disabledBackgroundColor: colors.surfaceMuted,
          disabledForegroundColor: colors.textMuted,
          shape: RoundedRectangleBorder(borderRadius: radius),
        ),
      RhythmButtonVariant.outlined => OutlinedButton.styleFrom(
          minimumSize: minimumSize,
          foregroundColor: colors.textPrimary,
          disabledForegroundColor: colors.textMuted,
          side: BorderSide(color: colors.border),
          shape: RoundedRectangleBorder(borderRadius: radius),
        ),
      RhythmButtonVariant.quiet => TextButton.styleFrom(
          minimumSize: minimumSize,
          foregroundColor: colors.textSecondary,
          disabledForegroundColor: colors.textMuted,
          backgroundColor: colors.surfaceMuted,
          shape: RoundedRectangleBorder(borderRadius: radius),
        ),
      RhythmButtonVariant.icon => const ButtonStyle(),
    };

    final button = switch (variant) {
      RhythmButtonVariant.filled =>
        FilledButton(onPressed: onPressed, style: style, child: child),
      RhythmButtonVariant.outlined =>
        OutlinedButton(onPressed: onPressed, style: style, child: child),
      RhythmButtonVariant.quiet =>
        TextButton(onPressed: onPressed, style: style, child: child),
      RhythmButtonVariant.icon =>
        TextButton(onPressed: onPressed, style: style, child: child),
    };

    if (tooltip == null) return button;
    return Tooltip(message: tooltip!, child: button);
  }
}
