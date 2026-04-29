import 'package:flutter/material.dart';

import 'rhythm_button.dart';
import 'tokens/rhythm_theme.dart';

enum RhythmEmptyStateTone { empty, loading, error }

class RhythmEmptyState extends StatelessWidget {
  const RhythmEmptyState({
    super.key,
    required this.title,
    this.message,
    this.icon,
    this.actionLabel,
    this.onAction,
    this.tone = RhythmEmptyStateTone.empty,
  });

  /// Loading placeholder. Renders a subdued spinner with a short label.
  const RhythmEmptyState.loading({
    super.key,
    this.title = 'Loading…',
    this.message,
  }) : icon = null,
       actionLabel = null,
       onAction = null,
       tone = RhythmEmptyStateTone.loading;

  /// Error state with an optional retry action.
  const RhythmEmptyState.error({
    super.key,
    this.title = 'Something went wrong',
    this.message,
    this.icon = Icons.error_outline,
    this.actionLabel,
    this.onAction,
  }) : tone = RhythmEmptyStateTone.error;

  final String title;
  final String? message;
  final IconData? icon;
  final String? actionLabel;
  final VoidCallback? onAction;
  final RhythmEmptyStateTone tone;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final iconColor = switch (tone) {
      RhythmEmptyStateTone.empty => colors.textMuted,
      RhythmEmptyStateTone.loading => colors.info,
      RhythmEmptyStateTone.error => colors.danger,
    };

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 360),
        child: Padding(
          padding: const EdgeInsets.all(RhythmSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (tone == RhythmEmptyStateTone.loading)
                SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: iconColor,
                  ),
                )
              else if (icon != null)
                Icon(icon, size: 28, color: iconColor),
              const SizedBox(height: RhythmSpacing.md),
              Text(
                title,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color: colors.textPrimary,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (message != null) ...[
                const SizedBox(height: RhythmSpacing.xs),
                Text(
                  message!,
                  textAlign: TextAlign.center,
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(color: colors.textSecondary),
                ),
              ],
              if (actionLabel != null && onAction != null) ...[
                const SizedBox(height: RhythmSpacing.md),
                RhythmButton.outlined(
                  onPressed: onAction,
                  label: actionLabel,
                  compact: true,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
