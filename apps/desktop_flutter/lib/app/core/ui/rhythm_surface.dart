import 'package:flutter/material.dart';

import 'tokens/rhythm_theme.dart';

enum RhythmSurfaceTone { canvas, surface, muted, raised }

class RhythmSurface extends StatelessWidget {
  const RhythmSurface({
    super.key,
    required this.child,
    this.tone = RhythmSurfaceTone.canvas,
    this.padding,
    this.margin,
    this.borderRadius,
    this.border = false,
    this.clipBehavior = Clip.none,
  });

  final Widget child;
  final RhythmSurfaceTone tone;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;
  final BorderRadiusGeometry? borderRadius;
  final bool border;
  final Clip clipBehavior;

  const RhythmSurface.page({
    super.key,
    required this.child,
    this.padding,
    this.margin,
    this.clipBehavior = Clip.none,
  })  : tone = RhythmSurfaceTone.canvas,
        borderRadius = null,
        border = false;

  const RhythmSurface.section({
    super.key,
    required this.child,
    this.padding,
    this.margin,
    this.borderRadius,
    this.clipBehavior = Clip.none,
  })  : tone = RhythmSurfaceTone.surface,
        border = true;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final radius = borderRadius ?? BorderRadius.circular(RhythmRadius.lg);
    final decoration = BoxDecoration(
      color: switch (tone) {
        RhythmSurfaceTone.canvas => colors.canvas,
        RhythmSurfaceTone.surface => colors.surface,
        RhythmSurfaceTone.muted => colors.surfaceMuted,
        RhythmSurfaceTone.raised => colors.surfaceRaised,
      },
      borderRadius: tone == RhythmSurfaceTone.canvas ? null : radius,
      border: border ? Border.all(color: colors.borderSubtle) : null,
    );

    return Container(
      margin: margin,
      decoration: decoration,
      clipBehavior: clipBehavior,
      child: Padding(
        padding: padding ?? EdgeInsets.zero,
        child: child,
      ),
    );
  }
}
