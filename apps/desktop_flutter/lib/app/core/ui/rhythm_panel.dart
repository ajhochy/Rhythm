import 'package:flutter/material.dart';

import 'tokens/rhythm_theme.dart';

class RhythmPanel extends StatelessWidget {
  const RhythmPanel({
    super.key,
    required this.child,
    this.header,
    this.footer,
    this.padding = const EdgeInsets.all(RhythmSpacing.md),
    this.margin,
    this.backgroundColor,
    this.borderColor,
    this.elevated = false,
    this.clipBehavior = Clip.antiAlias,
  });

  final Widget child;
  final Widget? header;
  final Widget? footer;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final Color? backgroundColor;
  final Color? borderColor;
  final bool elevated;
  final Clip clipBehavior;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final children = <Widget>[
      if (header != null) ...[
        Padding(
          padding: const EdgeInsets.fromLTRB(
            RhythmSpacing.md,
            RhythmSpacing.sm,
            RhythmSpacing.md,
            RhythmSpacing.sm,
          ),
          child: header,
        ),
        Divider(height: 1, color: colors.borderSubtle),
      ],
      Padding(padding: padding, child: child),
      if (footer != null) ...[
        Divider(height: 1, color: colors.borderSubtle),
        Padding(
          padding: const EdgeInsets.all(RhythmSpacing.md),
          child: footer,
        ),
      ],
    ];

    return Container(
      margin: margin,
      clipBehavior: clipBehavior,
      decoration: BoxDecoration(
        color: backgroundColor ?? colors.surface,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: borderColor ?? colors.borderSubtle),
        boxShadow: elevated ? RhythmElevation.panel : null,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: children,
      ),
    );
  }
}
