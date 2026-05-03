import 'package:flutter/material.dart';

import 'tokens/rhythm_theme.dart';

class RhythmCompactRow extends StatefulWidget {
  const RhythmCompactRow({
    super.key,
    required this.title,
    this.subtitle,
    this.leading,
    this.trailing,
    this.metadata = const [],
    this.onTap,
    this.selected = false,
    this.dense = false,
    this.tone = RhythmCompactRowTone.neutral,
  });

  final String title;
  final String? subtitle;
  final Widget? leading;
  final Widget? trailing;
  final List<Widget> metadata;
  final VoidCallback? onTap;
  final bool selected;
  final bool dense;
  final RhythmCompactRowTone tone;

  @override
  State<RhythmCompactRow> createState() => _RhythmCompactRowState();
}

enum RhythmCompactRowTone { neutral, accent, danger, success, warning }

class _RhythmCompactRowState extends State<RhythmCompactRow> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final theme = Theme.of(context);

    final accent = switch (widget.tone) {
      RhythmCompactRowTone.neutral => colors.accent,
      RhythmCompactRowTone.accent => colors.accent,
      RhythmCompactRowTone.danger => colors.danger,
      RhythmCompactRowTone.success => colors.success,
      RhythmCompactRowTone.warning => colors.warning,
    };

    final background = widget.selected
        ? colors.accentMuted
        : _hovered
            ? colors.surfaceMuted
            : Colors.transparent;
    final borderColor =
        widget.selected ? accent.withValues(alpha: 0.4) : colors.borderSubtle;

    final titleStyle = theme.textTheme.bodyMedium?.copyWith(
      color: colors.textPrimary,
      fontWeight: widget.selected ? FontWeight.w600 : FontWeight.w500,
    );
    final subtitleStyle = theme.textTheme.bodySmall?.copyWith(
      color: colors.textSecondary,
    );

    final padding = EdgeInsets.symmetric(
      horizontal: RhythmSpacing.sm,
      vertical: widget.dense ? RhythmSpacing.xs : RhythmSpacing.sm,
    );

    final row = Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        if (widget.leading != null) ...[
          widget.leading!,
          const SizedBox(width: RhythmSpacing.sm),
        ],
        Expanded(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                widget.title,
                style: titleStyle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (widget.subtitle != null) ...[
                const SizedBox(height: 2),
                Text(
                  widget.subtitle!,
                  style: subtitleStyle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              if (widget.metadata.isNotEmpty) ...[
                const SizedBox(height: RhythmSpacing.xxs),
                Wrap(
                  spacing: RhythmSpacing.xs,
                  runSpacing: RhythmSpacing.xxs,
                  children: widget.metadata,
                ),
              ],
            ],
          ),
        ),
        if (widget.trailing != null) ...[
          const SizedBox(width: RhythmSpacing.sm),
          widget.trailing!,
        ],
      ],
    );

    final container = AnimatedContainer(
      duration: const Duration(milliseconds: 120),
      curve: Curves.easeOut,
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: borderColor),
      ),
      padding: padding,
      child: row,
    );

    if (widget.onTap == null) return container;

    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => _hovered = true),
      onExit: (_) => setState(() => _hovered = false),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: widget.onTap,
        child: container,
      ),
    );
  }
}
