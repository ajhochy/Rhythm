import 'package:flutter/material.dart';

import '../../../../app/core/ui/tokens/rhythm_theme.dart';

/// A small section header used in the Today view (Overdue / Today / Completed).
///
/// Pass [color] to override the default [textSecondary] colour (e.g. use
/// [danger] for the Overdue section).
class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.label, this.color});

  final String label;

  /// Optional text colour override. Defaults to [RhythmColorRoles.textSecondary].
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        RhythmSpacing.md,
        RhythmSpacing.lg,
        RhythmSpacing.md,
        RhythmSpacing.xs,
      ),
      child: Text(
        label.toUpperCase(),
        style: Theme.of(context).textTheme.labelLarge?.copyWith(
              color: color ?? colors.textSecondary,
              fontSize: 11,
              letterSpacing: 0.8,
              fontWeight: FontWeight.w700,
            ),
      ),
    );
  }
}
