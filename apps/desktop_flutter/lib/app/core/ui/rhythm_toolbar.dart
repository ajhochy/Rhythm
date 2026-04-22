import 'package:flutter/material.dart';

import 'tokens/rhythm_theme.dart';

class RhythmToolbar extends StatelessWidget {
  const RhythmToolbar({
    super.key,
    this.title,
    this.subtitle,
    this.leading,
    this.search,
    this.filters = const [],
    this.actions = const [],
    this.padding = const EdgeInsets.all(RhythmSpacing.sm),
  });

  final String? title;
  final String? subtitle;
  final Widget? leading;
  final Widget? search;
  final List<Widget> filters;
  final List<Widget> actions;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        border: Border(bottom: BorderSide(color: colors.borderSubtle)),
      ),
      child: Padding(
        padding: padding,
        child: Row(
          children: [
            if (leading != null) ...[
              leading!,
              const SizedBox(width: RhythmSpacing.sm),
            ],
            if (title != null || subtitle != null)
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (title != null)
                      Text(
                        title!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style:
                            Theme.of(context).textTheme.titleMedium?.copyWith(
                                  color: colors.textPrimary,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 0,
                                ),
                      ),
                    if (subtitle != null)
                      Text(
                        subtitle!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: colors.textSecondary),
                      ),
                  ],
                ),
              )
            else
              const Spacer(),
            if (filters.isNotEmpty) ...[
              const SizedBox(width: RhythmSpacing.md),
              Flexible(
                child: Wrap(
                  spacing: RhythmSpacing.xs,
                  runSpacing: RhythmSpacing.xs,
                  alignment: WrapAlignment.end,
                  children: filters,
                ),
              ),
            ],
            if (search != null) ...[
              const SizedBox(width: RhythmSpacing.md),
              search!,
            ],
            if (actions.isNotEmpty) ...[
              const SizedBox(width: RhythmSpacing.sm),
              Wrap(
                spacing: RhythmSpacing.xs,
                runSpacing: RhythmSpacing.xs,
                alignment: WrapAlignment.end,
                children: actions,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
