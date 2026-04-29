import 'package:flutter/material.dart';

import 'tokens/rhythm_theme.dart';

class RhythmSectionHeader extends StatelessWidget {
  const RhythmSectionHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.leading,
    this.trailing,
    this.padding = const EdgeInsets.symmetric(
      horizontal: RhythmSpacing.md,
      vertical: RhythmSpacing.sm,
    ),
    this.dense = false,
  });

  final String title;
  final String? subtitle;
  final Widget? leading;
  final Widget? trailing;
  final EdgeInsetsGeometry padding;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final theme = Theme.of(context);
    final titleStyle =
        (dense ? theme.textTheme.titleSmall : theme.textTheme.titleMedium)
            ?.copyWith(color: colors.textPrimary, fontWeight: FontWeight.w700);
    final subtitleStyle = theme.textTheme.bodySmall?.copyWith(
      color: colors.textSecondary,
    );

    return Padding(
      padding: padding,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          if (leading != null) ...[
            leading!,
            const SizedBox(width: RhythmSpacing.sm),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(title, style: titleStyle, overflow: TextOverflow.ellipsis),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: subtitleStyle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
          if (trailing != null) ...[
            const SizedBox(width: RhythmSpacing.sm),
            trailing!,
          ],
        ],
      ),
    );
  }
}
