import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../background_activity/background_activity_controller.dart';
import '../background_activity/background_status_model.dart';
import '../ui/tokens/rhythm_theme.dart';

/// Compact pulsing indicator in the top header bar that surfaces what
/// background work is running. Idle = subtle dot. Active = pulsing accent dot
/// + active-loop count. Tap → overlay popover listing each loop with name,
/// state, last run, and next scheduled run.
class BackgroundActivityIndicator extends StatefulWidget {
  const BackgroundActivityIndicator({super.key});

  @override
  State<BackgroundActivityIndicator> createState() =>
      _BackgroundActivityIndicatorState();
}

class _BackgroundActivityIndicatorState
    extends State<BackgroundActivityIndicator>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;
  late final Animation<double> _opacity;
  OverlayEntry? _overlay;
  final LayerLink _layerLink = LayerLink();

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
    _opacity = Tween<double>(begin: 0.4, end: 1.0).animate(
      CurvedAnimation(parent: _pulse, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _closeOverlay();
    _pulse.dispose();
    super.dispose();
  }

  void _toggleOverlay(BuildContext context) {
    if (_overlay != null) {
      _closeOverlay();
    } else {
      _openOverlay(context);
    }
  }

  void _openOverlay(BuildContext context) {
    final controller = context.read<BackgroundActivityController>();
    _overlay = OverlayEntry(
      builder: (_) => GestureDetector(
        behavior: HitTestBehavior.translucent,
        onTap: _closeOverlay,
        child: Stack(
          children: [
            const SizedBox.expand(),
            CompositedTransformFollower(
              link: _layerLink,
              showWhenUnlinked: false,
              targetAnchor: Alignment.bottomCenter,
              followerAnchor: Alignment.topCenter,
              offset: const Offset(0, 6),
              child: GestureDetector(
                onTap: () {},
                child: _BackgroundStatusPopover(controller: controller),
              ),
            ),
          ],
        ),
      ),
    );
    Overlay.of(context).insert(_overlay!);
  }

  void _closeOverlay() {
    _overlay?.remove();
    _overlay = null;
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<BackgroundActivityController>();
    final isActive = controller.hasActivity;
    final count = controller.activeCount;

    // Idle state: show a subtle muted dot. No pulse, no count.
    if (!isActive) {
      return CompositedTransformTarget(
        link: _layerLink,
        child: Tooltip(
          message: 'Background loops — all idle',
          child: GestureDetector(
            onTap: () => _toggleOverlay(context),
            child: Container(
              width: 32,
              height: 32,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: context.rhythm.surfaceRaised,
                borderRadius: BorderRadius.circular(RhythmRadius.lg),
                border: Border.all(color: context.rhythm.borderSubtle),
              ),
              child: Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: context.rhythm.textMuted,
                ),
              ),
            ),
          ),
        ),
      );
    }

    // Active state: pulsing accent dot + count badge.
    return CompositedTransformTarget(
      link: _layerLink,
      child: Tooltip(
        message: '$count background loop${count == 1 ? '' : 's'} running',
        child: GestureDetector(
          onTap: () => _toggleOverlay(context),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            decoration: BoxDecoration(
              color: context.rhythm.surfaceRaised,
              borderRadius: BorderRadius.circular(RhythmRadius.lg),
              border: Border.all(color: context.rhythm.borderSubtle),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                AnimatedBuilder(
                  animation: _opacity,
                  builder: (_, __) => Opacity(
                    opacity: _opacity.value,
                    child: Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: context.rhythm.accent,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 5),
                Text(
                  '$count',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: context.rhythm.textPrimary,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Popover listing all background loops with their state, last run, and next
/// scheduled run.
class _BackgroundStatusPopover extends StatelessWidget {
  const _BackgroundStatusPopover({required this.controller});

  final BackgroundActivityController controller;

  @override
  Widget build(BuildContext context) {
    final loops = controller.loops;

    return Material(
      color: Colors.transparent,
      child: Container(
        width: 320,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceRaised,
          borderRadius: BorderRadius.circular(RhythmRadius.md),
          border: Border.all(color: context.rhythm.borderSubtle),
          boxShadow: RhythmElevation.panel,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                'Background loops',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: context.rhythm.textPrimary,
                ),
              ),
            ),
            if (loops.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  'No data yet.',
                  style: TextStyle(
                    fontSize: 12,
                    color: context.rhythm.textMuted,
                  ),
                ),
              )
            else
              ...loops.map((loop) => _LoopRow(loop: loop)),
          ],
        ),
      ),
    );
  }
}

class _LoopRow extends StatelessWidget {
  const _LoopRow({required this.loop});

  final BackgroundLoopStatus loop;

  String _formatTs(String? iso) {
    if (iso == null) return '—';
    try {
      final dt = DateTime.parse(iso).toLocal();
      final h = dt.hour.toString().padLeft(2, '0');
      final m = dt.minute.toString().padLeft(2, '0');
      final mon = dt.month.toString().padLeft(2, '0');
      final day = dt.day.toString().padLeft(2, '0');
      return '${dt.year}-$mon-$day $h:$m';
    } catch (_) {
      return iso;
    }
  }

  @override
  Widget build(BuildContext context) {
    final isRunning = loop.isRunning;
    final dotColor =
        isRunning ? context.rhythm.accent : context.rhythm.textMuted;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: dotColor,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      loop.displayName,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: context.rhythm.textPrimary,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 5,
                        vertical: 1,
                      ),
                      decoration: BoxDecoration(
                        color: isRunning
                            ? context.rhythm.accentMuted
                            : context.rhythm.surfaceMuted,
                        borderRadius: BorderRadius.circular(RhythmRadius.xs),
                      ),
                      child: Text(
                        isRunning ? 'running' : 'idle',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                          color: isRunning
                              ? context.rhythm.accent
                              : context.rhythm.textMuted,
                        ),
                      ),
                    ),
                  ],
                ),
                if (loop.currentItem != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    loop.currentItem!,
                    style: TextStyle(
                      fontSize: 11,
                      color: context.rhythm.textSecondary,
                    ),
                  ),
                ],
                const SizedBox(height: 2),
                Text(
                  'Last: ${_formatTs(loop.lastRunAt)}',
                  style: TextStyle(
                    fontSize: 11,
                    color: context.rhythm.textMuted,
                  ),
                ),
                if (loop.nextRunAt != null)
                  Text(
                    'Next: ${_formatTs(loop.nextRunAt)}',
                    style: TextStyle(
                      fontSize: 11,
                      color: context.rhythm.textMuted,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
