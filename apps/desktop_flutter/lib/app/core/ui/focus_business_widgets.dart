import 'package:flutter/material.dart';
import 'package:step_progress_indicator/step_progress_indicator.dart';

import 'rhythm_badge.dart';
import 'tokens/rhythm_theme.dart';

// Source-derived from Focus Flutter UI Kit Business Widget 05 and 02.
// Upstream: https://github.com/maxlam79/focus_flutter_ui_kit
// License: apps/desktop_flutter/third_party/focus_flutter_ui_kit/LICENSE

class FocusBusinessPill {
  const FocusBusinessPill({
    required this.label,
    this.tone = RhythmBadgeTone.neutral,
    this.icon,
  });

  final String label;
  final RhythmBadgeTone tone;
  final IconData? icon;
}

class FocusBusinessAvatar {
  const FocusBusinessAvatar({
    required this.label,
    this.tone = RhythmBadgeTone.neutral,
  });

  final String label;
  final RhythmBadgeTone tone;
}

class FocusBusinessMetric {
  const FocusBusinessMetric({
    required this.label,
    required this.value,
    this.tone = RhythmBadgeTone.neutral,
  });

  final String label;
  final String value;
  final RhythmBadgeTone tone;
}

class FocusBusinessTaskListItem extends StatelessWidget {
  const FocusBusinessTaskListItem({
    super.key,
    required this.title,
    required this.description,
    required this.checked,
    required this.onChanged,
    this.pills = const [],
    this.avatars = const [],
    this.detailWidgets = const [],
    this.trailing,
    this.onTap,
    this.backgroundColor,
    this.borderColor,
    this.accentColor,
    this.margin = EdgeInsets.zero,
  });

  final String title;
  final String description;
  final bool checked;
  final ValueChanged<bool> onChanged;
  final List<FocusBusinessPill> pills;
  final List<FocusBusinessAvatar> avatars;
  final List<Widget> detailWidgets;
  final Widget? trailing;
  final VoidCallback? onTap;
  final Color? backgroundColor;
  final Color? borderColor;
  final Color? accentColor;
  final EdgeInsetsGeometry margin;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final accent = accentColor ?? colors.accent;
    final body = Container(
      margin: margin,
      padding: const EdgeInsets.fromLTRB(0, RhythmSpacing.md, 0, 0),
      decoration: BoxDecoration(
        color: backgroundColor ?? colors.surface,
        border: Border.all(color: borderColor ?? colors.borderSubtle),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final checkboxWidth =
              (constraints.maxWidth * 2 / 12).clamp(52.0, 92.0);
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: checkboxWidth,
                child: Padding(
                  padding: const EdgeInsets.only(top: 3),
                  child: Checkbox(
                    value: checked,
                    onChanged: (value) => onChanged(value ?? false),
                    side: BorderSide(
                      color: checked
                          ? accent.withValues(alpha: 0.5)
                          : colors.textMuted.withValues(alpha: 0.7),
                      width: 1.6,
                    ),
                    activeColor: accent,
                    checkColor: colors.canvas,
                    visualDensity: VisualDensity.compact,
                  ),
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(right: RhythmSpacing.md),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              title,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: _FocusType.preH(context).copyWith(
                                color: checked
                                    ? colors.textMuted
                                    : colors.textPrimary,
                                decoration: checked
                                    ? TextDecoration.lineThrough
                                    : TextDecoration.none,
                              ),
                            ),
                            const SizedBox(height: 5),
                            Text(
                              description,
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                              style: _FocusType.regular(context).copyWith(
                                color: checked
                                    ? colors.textMuted
                                    : colors.textSecondary,
                              ),
                            ),
                            if (pills.isNotEmpty ||
                                avatars.isNotEmpty ||
                                detailWidgets.isNotEmpty) ...[
                              const SizedBox(height: 10),
                              Wrap(
                                runSpacing: 5,
                                spacing: 10,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  for (final pill in pills)
                                    _FocusTextPill(pill: pill),
                                  if (avatars.isNotEmpty)
                                    _FocusAvatarStack(avatars: avatars),
                                  ...detailWidgets,
                                ],
                              ),
                            ],
                            const SizedBox(height: 20),
                          ],
                        ),
                      ),
                      if (trailing != null) ...[
                        const SizedBox(width: RhythmSpacing.sm),
                        trailing!,
                      ],
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );

    if (onTap == null) return body;
    return Material(
      color: Colors.transparent,
      child: InkWell(onTap: onTap, child: body),
    );
  }
}

class FocusBusinessProjectProgress extends StatelessWidget {
  const FocusBusinessProjectProgress({
    super.key,
    required this.panelTitle,
    required this.title,
    required this.description,
    required this.progress,
    required this.metrics,
    this.pills = const [],
    this.managers = const [],
    this.team = const [],
    this.onTap,
    this.icon = Icons.grid_view_rounded,
  });

  final String panelTitle;
  final String title;
  final String description;
  final double progress;
  final List<FocusBusinessMetric> metrics;
  final List<FocusBusinessPill> pills;
  final List<FocusBusinessAvatar> managers;
  final List<FocusBusinessAvatar> team;
  final VoidCallback? onTap;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final accent =
        pills.isEmpty ? colors.accent : _toneColor(colors, pills[0].tone);
    final content = _FocusPanel(
      header: panelTitle,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final stacked = constraints.maxWidth < 720;
          final left = _buildContent01(context, accent);
          final right = _buildContent02(context);
          if (stacked) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                left,
                const SizedBox(height: RhythmSpacing.lg),
                right,
              ],
            );
          }
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                  child: Padding(
                padding: const EdgeInsets.only(right: 30),
                child: left,
              )),
              Expanded(child: right),
            ],
          );
        },
      ),
    );

    if (onTap == null) return content;
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(RhythmRadius.md),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        child: content,
      ),
    );
  }

  Widget _buildContent01(BuildContext context, Color accent) {
    final metricRows = <Widget>[];
    for (var i = 0; i < metrics.length; i += 2) {
      metricRows.add(
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: _FocusMetricBlock(metric: metrics[i])),
            const SizedBox(width: RhythmSpacing.md),
            if (i + 1 < metrics.length)
              Expanded(child: _FocusMetricBlock(metric: metrics[i + 1]))
            else
              const Spacer(),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _FocusStepProgress(progress: progress, accent: accent),
        const SizedBox(height: 20),
        for (final row in metricRows) ...[
          row,
          const SizedBox(height: 20),
        ],
      ],
    );
  }

  Widget _buildContent02(BuildContext context) {
    final colors = context.rhythm;
    return Padding(
      padding: const EdgeInsets.all(10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          LayoutBuilder(
            builder: (context, constraints) {
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 7),
                    child: Icon(icon, size: 30, color: colors.textPrimary),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      title,
                      softWrap: true,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: constraints.maxWidth > 520
                          ? _FocusType.h2(context)
                          : _FocusType.h3(context),
                    ),
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: 10),
          Wrap(
            alignment: WrapAlignment.start,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 10,
            runSpacing: 5,
            children: [
              for (final pill in pills)
                _FocusTextPill(pill: pill, square: true),
            ],
          ),
          const SizedBox(height: 30),
          Text('Project Description', style: _FocusType.regularB(context)),
          const SizedBox(height: 5),
          Text(
            description,
            maxLines: 4,
            overflow: TextOverflow.ellipsis,
            style: _FocusType.regular(context),
          ),
          const SizedBox(height: 30),
          LayoutBuilder(
            builder: (context, constraints) {
              final stacked = constraints.maxWidth < 420;
              final managerBlock = _FocusAvatarBlock(
                label: 'Project Manager',
                avatars: managers,
              );
              final teamBlock = _FocusAvatarBlock(label: 'Team', avatars: team);
              if (stacked) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    managerBlock,
                    const SizedBox(height: RhythmSpacing.md),
                    teamBlock,
                  ],
                );
              }
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(flex: 4, child: managerBlock),
                  const SizedBox(width: RhythmSpacing.md),
                  Expanded(flex: 8, child: teamBlock),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _FocusPanel extends StatelessWidget {
  const _FocusPanel({required this.header, required this.child});

  final String header;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return Container(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: colors.borderSubtle),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              RhythmSpacing.md,
              RhythmSpacing.md,
              RhythmSpacing.md,
              RhythmSpacing.sm,
            ),
            child: Text(header, style: _FocusType.preH(context)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              RhythmSpacing.md,
              RhythmSpacing.sm,
              RhythmSpacing.md,
              RhythmSpacing.md,
            ),
            child: child,
          ),
        ],
      ),
    );
  }
}

class _FocusStepProgress extends StatelessWidget {
  const _FocusStepProgress({required this.progress, required this.accent});

  final double progress;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final percent = (progress.clamp(0, 1) * 100).round();
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Center(
        child: CircularStepProgressIndicator(
          totalSteps: 100,
          currentStep: percent,
          stepSize: 5,
          selectedColor: accent,
          unselectedColor: accent.withValues(alpha: 0.18),
          padding: 0,
          width: 150,
          height: 150,
          selectedStepSize: 5,
          roundedCap: (_, __) => true,
          child: Center(
            child: Text(
              '$percent%',
              style: _FocusType.h4(context).copyWith(
                color: colors.textPrimary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _FocusMetricBlock extends StatelessWidget {
  const _FocusMetricBlock({required this.metric});

  final FocusBusinessMetric metric;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final accent = _toneColor(colors, metric.tone);
    return Padding(
      padding: const EdgeInsets.only(bottom: 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(metric.label, style: _FocusType.regularB(context)),
          const SizedBox(height: 3),
          Text(
            metric.value,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: _FocusType.h3(context).copyWith(
              color: metric.tone == RhythmBadgeTone.neutral
                  ? colors.textPrimary
                  : accent,
            ),
          ),
        ],
      ),
    );
  }
}

class _FocusTextPill extends StatelessWidget {
  const _FocusTextPill({required this.pill, this.square = false});

  final FocusBusinessPill pill;
  final bool square;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final foreground = _toneColor(colors, pill.tone);
    final background = pill.tone == RhythmBadgeTone.neutral
        ? colors.surfaceMuted
        : foreground.withValues(alpha: 0.18);
    return Container(
      constraints: const BoxConstraints(maxWidth: 220),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius:
            BorderRadius.circular(square ? RhythmRadius.xs : RhythmRadius.pill),
        border: Border.all(color: foreground.withValues(alpha: 0.18)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (pill.icon != null) ...[
            Icon(pill.icon, size: 12, color: foreground),
            const SizedBox(width: 4),
          ],
          Flexible(
            child: Text(
              pill.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: _FocusType.small(context).copyWith(
                color: foreground,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _FocusAvatarBlock extends StatelessWidget {
  const _FocusAvatarBlock({required this.label, required this.avatars});

  final String label;
  final List<FocusBusinessAvatar> avatars;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: _FocusType.regularB(context)),
        const SizedBox(height: 5),
        if (avatars.isEmpty)
          Text('None', style: _FocusType.regular(context))
        else
          _FocusAvatarStack(avatars: avatars, size: 34),
      ],
    );
  }
}

class _FocusAvatarStack extends StatelessWidget {
  const _FocusAvatarStack({required this.avatars, this.size = 28});

  final List<FocusBusinessAvatar> avatars;
  final double size;

  @override
  Widget build(BuildContext context) {
    final visible = avatars.take(7).toList();
    return SizedBox(
      height: size,
      width: visible.isEmpty ? 0 : size + (visible.length - 1) * (size * 0.62),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          for (var i = 0; i < visible.length; i++)
            Positioned(
              left: i * size * 0.62,
              child: Tooltip(
                message: visible[i].label,
                child: _FocusAvatar(avatar: visible[i], size: size),
              ),
            ),
        ],
      ),
    );
  }
}

class _FocusAvatar extends StatelessWidget {
  const _FocusAvatar({required this.avatar, required this.size});

  final FocusBusinessAvatar avatar;
  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final foreground = _toneColor(colors, avatar.tone);
    final initials = avatar.label
        .trim()
        .split(RegExp(r'\s+'))
        .where((part) => part.isNotEmpty)
        .take(2)
        .map((part) => part[0].toUpperCase())
        .join();
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: foreground.withValues(alpha: 0.18),
        border: Border.all(color: colors.surface, width: 2),
      ),
      alignment: Alignment.center,
      child: Text(
        initials.isEmpty ? '?' : initials,
        style: _FocusType.small(context).copyWith(
          color: foreground,
          fontSize: size < 30 ? 10 : 11,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _FocusType {
  const _FocusType._();

  static TextStyle preH(BuildContext context) => _base(context).copyWith(
        fontSize: 12,
        height: 1.2,
        fontWeight: FontWeight.w800,
        letterSpacing: 0,
      );

  static TextStyle h2(BuildContext context) => _base(context).copyWith(
        fontSize: 30,
        height: 1.15,
        fontWeight: FontWeight.w800,
        letterSpacing: 0,
      );

  static TextStyle h3(BuildContext context) => _base(context).copyWith(
        fontSize: 27,
        height: 1.15,
        fontWeight: FontWeight.w800,
        letterSpacing: 0,
      );

  static TextStyle h4(BuildContext context) => _base(context).copyWith(
        fontSize: 22,
        height: 1.15,
        fontWeight: FontWeight.w700,
        letterSpacing: 0,
      );

  static TextStyle regular(BuildContext context) => _base(context).copyWith(
        fontSize: 13,
        height: 1.35,
        fontWeight: FontWeight.w400,
        letterSpacing: 0,
      );

  static TextStyle regularB(BuildContext context) => regular(context).copyWith(
        fontWeight: FontWeight.w800,
      );

  static TextStyle small(BuildContext context) => _base(context).copyWith(
        fontSize: 12,
        height: 1.15,
        fontWeight: FontWeight.w600,
        letterSpacing: 0,
      );

  static TextStyle _base(BuildContext context) => TextStyle(
        fontFamily: 'Inter',
        color: context.rhythm.textPrimary,
      );
}

Color _toneColor(RhythmColorRoles colors, RhythmBadgeTone tone) {
  return switch (tone) {
    RhythmBadgeTone.neutral => colors.textSecondary,
    RhythmBadgeTone.accent => colors.accent,
    RhythmBadgeTone.success => colors.success,
    RhythmBadgeTone.warning => colors.warning,
    RhythmBadgeTone.danger => colors.danger,
    RhythmBadgeTone.info => colors.info,
  };
}
