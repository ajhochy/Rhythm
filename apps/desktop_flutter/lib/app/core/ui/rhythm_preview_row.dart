import 'package:flutter/material.dart';

import 'rhythm_badge.dart';
import 'tokens/rhythm_theme.dart';

/// A preview row primitive used by overview surfaces (Dashboard, etc.) to
/// render a tappable summary entry with a small leading icon tile, an
/// accent-colored eyebrow label, a multiline title, and a wrap of metadata
/// chips. Presentation only — domain formatting stays at the call site.
class RhythmPreviewRow extends StatelessWidget {
  const RhythmPreviewRow({
    super.key,
    required this.title,
    this.eyebrow,
    this.leadingIcon,
    this.metadata = const [],
    this.tone = RhythmBadgeTone.neutral,
    this.onTap,
    this.titleMaxLines = 2,
  });

  final String title;
  final String? eyebrow;
  final IconData? leadingIcon;
  final List<Widget> metadata;
  final RhythmBadgeTone tone;
  final VoidCallback? onTap;
  final int titleMaxLines;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final accent = _resolveTone(colors, tone);

    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (eyebrow != null) ...[
          Text(
            eyebrow!,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 11.5,
              color: accent,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 3),
        ],
        Text(
          title,
          maxLines: titleMaxLines,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            fontSize: 12.5,
            color: colors.textPrimary,
            fontWeight: FontWeight.w700,
            height: 1.25,
          ),
        ),
        if (metadata.isNotEmpty) ...[
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: metadata,
          ),
        ],
      ],
    );

    final body = Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (leadingIcon != null) ...[
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: accent.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(RhythmRadius.sm),
              border: Border.all(color: accent.withValues(alpha: 0.22)),
            ),
            child: Icon(leadingIcon, size: 15, color: accent),
          ),
          const SizedBox(width: 10),
        ],
        Expanded(child: content),
      ],
    );

    final container = Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      decoration: BoxDecoration(
        color: colors.surfaceMuted.withValues(alpha: 0.78),
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: accent.withValues(alpha: 0.2)),
      ),
      child: body,
    );

    if (onTap == null) return container;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(RhythmRadius.md),
      child: container,
    );
  }
}

Color _resolveTone(RhythmColorRoles colors, RhythmBadgeTone tone) {
  return switch (tone) {
    RhythmBadgeTone.neutral => colors.textSecondary,
    RhythmBadgeTone.accent => colors.accent,
    RhythmBadgeTone.success => colors.success,
    RhythmBadgeTone.warning => colors.warning,
    RhythmBadgeTone.danger => colors.danger,
    RhythmBadgeTone.info => colors.info,
  };
}
