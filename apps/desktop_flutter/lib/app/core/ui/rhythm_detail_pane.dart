import 'package:flutter/material.dart';

import 'tokens/rhythm_theme.dart';

class RhythmDetailPane extends StatelessWidget {
  const RhythmDetailPane({
    super.key,
    required this.child,
    this.title,
    this.subtitle,
    this.actions = const [],
    this.width = 360,
    this.footer,
  });

  final Widget child;
  final String? title;
  final String? subtitle;
  final List<Widget> actions;
  final double width;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return SizedBox(
      width: width,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surface,
          border: Border(left: BorderSide(color: colors.borderSubtle)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (title != null || subtitle != null || actions.isNotEmpty)
              Padding(
                padding: const EdgeInsets.all(RhythmSpacing.md),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (title != null)
                            Text(
                              title!,
                              style: Theme.of(context)
                                  .textTheme
                                  .titleMedium
                                  ?.copyWith(
                                    color: colors.textPrimary,
                                    fontWeight: FontWeight.w700,
                                  ),
                            ),
                          if (subtitle != null)
                            Text(
                              subtitle!,
                              style: Theme.of(context)
                                  .textTheme
                                  .bodySmall
                                  ?.copyWith(color: colors.textSecondary),
                            ),
                        ],
                      ),
                    ),
                    if (actions.isNotEmpty) ...[
                      const SizedBox(width: RhythmSpacing.sm),
                      Wrap(spacing: RhythmSpacing.xs, children: actions),
                    ],
                  ],
                ),
              ),
            Divider(height: 1, color: colors.borderSubtle),
            Expanded(child: child),
            if (footer != null) ...[
              Divider(height: 1, color: colors.borderSubtle),
              Padding(
                padding: const EdgeInsets.all(RhythmSpacing.md),
                child: footer,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
