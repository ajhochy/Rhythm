import 'package:flutter/material.dart';

import 'tokens/rhythm_theme.dart';

class RhythmDisclosure extends StatelessWidget {
  const RhythmDisclosure({
    super.key,
    required this.title,
    required this.child,
    this.subtitle,
    this.initiallyExpanded = false,
    this.leading,
  });

  final String title;
  final String? subtitle;
  final Widget child;
  final bool initiallyExpanded;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: colors.borderSubtle),
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: initiallyExpanded,
          leading: leading,
          tilePadding: const EdgeInsets.symmetric(
            horizontal: RhythmSpacing.md,
            vertical: RhythmSpacing.xs,
          ),
          childrenPadding: const EdgeInsets.fromLTRB(
            RhythmSpacing.md,
            0,
            RhythmSpacing.md,
            RhythmSpacing.md,
          ),
          iconColor: colors.textSecondary,
          collapsedIconColor: colors.textMuted,
          title: Text(
            title,
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  color: colors.textPrimary,
                  fontWeight: FontWeight.w700,
                ),
          ),
          subtitle: subtitle == null
              ? null
              : Text(
                  subtitle!,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: colors.textSecondary),
                ),
          children: [child],
        ),
      ),
    );
  }
}
