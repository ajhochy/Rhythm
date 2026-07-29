import 'package:flutter/material.dart';

import 'rhythm_button.dart';
import 'tokens/rhythm_theme.dart';

class RhythmDialog extends StatelessWidget {
  const RhythmDialog({
    super.key,
    required this.title,
    required this.child,
    this.actions = const [],
    this.icon,
    this.iconColor,
    this.width = 460,
  });

  final String title;
  final Widget child;
  final List<Widget> actions;
  final IconData? icon;
  final Color? iconColor;
  final double width;

  static Future<bool?> confirm(
    BuildContext context, {
    required String title,
    required String message,
    String confirmLabel = 'Confirm',
    String cancelLabel = 'Cancel',
    bool destructive = false,
  }) {
    final colors = context.rhythm;
    return showDialog<bool>(
      context: context,
      builder: (context) => RhythmDialog(
        title: title,
        icon: destructive ? Icons.warning_amber : Icons.help_outline,
        iconColor: destructive ? colors.danger : null,
        actions: [
          RhythmButton.quiet(
            onPressed: () => Navigator.of(context).pop(false),
            label: cancelLabel,
            compact: true,
          ),
          RhythmButton.filled(
            onPressed: () => Navigator.of(context).pop(true),
            label: confirmLabel,
            compact: true,
            danger: destructive,
          ),
        ],
        child: Text(message),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return Dialog(
      backgroundColor: colors.surfaceRaised,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        side: BorderSide(color: colors.border),
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: width),
        child: Padding(
          padding: const EdgeInsets.all(RhythmSpacing.lg),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (icon != null) ...[
                    Icon(icon, size: 20, color: iconColor ?? colors.accent),
                    const SizedBox(width: RhythmSpacing.sm),
                  ],
                  Expanded(
                    child: Text(
                      title,
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                            color: colors.textPrimary,
                            fontWeight: FontWeight.w700,
                          ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: RhythmSpacing.md),
              DefaultTextStyle.merge(
                style: TextStyle(color: colors.textSecondary),
                child: child,
              ),
              if (actions.isNotEmpty) ...[
                const SizedBox(height: RhythmSpacing.lg),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    for (final action in actions) ...[
                      action,
                      if (action != actions.last)
                        const SizedBox(width: RhythmSpacing.xs),
                    ],
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
