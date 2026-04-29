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
        child: LayoutBuilder(
          builder: (context, constraints) {
            final titleBlock = _RhythmToolbarTitle(
              title: title,
              subtitle: subtitle,
            );
            final controlChildren = <Widget>[
              ...filters,
              if (search != null) search!,
              ...actions,
            ];
            final controls = Wrap(
              spacing: RhythmSpacing.xs,
              runSpacing: RhythmSpacing.xs,
              alignment: WrapAlignment.end,
              children: controlChildren,
            );

            if (constraints.maxWidth < 760 && controlChildren.isNotEmpty) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      if (leading != null) ...[
                        leading!,
                        const SizedBox(width: RhythmSpacing.sm),
                      ],
                      Expanded(child: titleBlock),
                    ],
                  ),
                  const SizedBox(height: RhythmSpacing.xs),
                  Align(alignment: Alignment.centerLeft, child: controls),
                ],
              );
            }

            return Row(
              children: [
                if (leading != null) ...[
                  leading!,
                  const SizedBox(width: RhythmSpacing.sm),
                ],
                if (title != null || subtitle != null)
                  Expanded(child: titleBlock)
                else
                  const Spacer(),
                if (controlChildren.isNotEmpty) ...[
                  const SizedBox(width: RhythmSpacing.md),
                  Flexible(child: controls),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}

class _RhythmToolbarTitle extends StatelessWidget {
  const _RhythmToolbarTitle({this.title, this.subtitle});

  final String? title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (title != null)
          Text(
            title!,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
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
    );
  }
}
