import 'package:flutter/material.dart';

import 'tokens/rhythm_theme.dart';

class RhythmSegment<T> {
  const RhythmSegment({
    required this.value,
    required this.label,
    this.icon,
    this.count,
  });

  final T value;
  final String label;
  final IconData? icon;
  final int? count;
}

class RhythmSegmentedControl<T> extends StatelessWidget {
  const RhythmSegmentedControl({
    super.key,
    required this.segments,
    required this.value,
    required this.onChanged,
    this.compact = false,
  });

  final List<RhythmSegment<T>> segments;
  final T value;
  final ValueChanged<T> onChanged;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: colors.borderSubtle),
      ),
      child: Padding(
        padding: const EdgeInsets.all(3),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final segment in segments)
              _RhythmSegmentButton<T>(
                segment: segment,
                selected: segment.value == value,
                compact: compact,
                onPressed: () => onChanged(segment.value),
              ),
          ],
        ),
      ),
    );
  }
}

class _RhythmSegmentButton<T> extends StatelessWidget {
  const _RhythmSegmentButton({
    required this.segment,
    required this.selected,
    required this.compact,
    required this.onPressed,
  });

  final RhythmSegment<T> segment;
  final bool selected;
  final bool compact;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final foreground = selected ? colors.textPrimary : colors.textSecondary;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 1),
      child: TextButton(
        onPressed: onPressed,
        style: TextButton.styleFrom(
          minimumSize: Size(0, compact ? 28 : 34),
          padding: EdgeInsets.symmetric(
            horizontal: compact ? RhythmSpacing.xs : RhythmSpacing.sm,
          ),
          foregroundColor: foreground,
          backgroundColor: selected ? colors.surfaceRaised : Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(RhythmRadius.sm),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (segment.icon != null) ...[
              Icon(segment.icon, size: compact ? 14 : 16),
              const SizedBox(width: RhythmSpacing.xxs),
            ],
            Text(
              segment.label,
              style: TextStyle(
                fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
                letterSpacing: 0,
              ),
            ),
            if (segment.count != null) ...[
              const SizedBox(width: RhythmSpacing.xxs),
              Text(
                segment.count.toString(),
                style: TextStyle(color: colors.textMuted, letterSpacing: 0),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
