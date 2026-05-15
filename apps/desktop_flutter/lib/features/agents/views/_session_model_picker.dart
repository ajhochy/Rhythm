// INTEGRATION NOTE FOR agents_view.dart
// =========================================
// Insert `SessionModelPicker` inside `_TranscriptHeader.build()`, within
// the existing Row, after the `_StatusChip` and before the reconnect button
// (approximately line 960 in the original file, after the SizedBox(width: 8)
// that follows _StatusChip). The recommended insertion looks like:
//
//   _StatusChip(status: session.status, isWorking: isWorking),
//   const SizedBox(width: 8),
//   // ---- INSERT HERE ----
//   SessionModelPicker(session: session),
//   const SizedBox(width: 8),
//   // ---- END INSERT ----
//   if (showReconnect) ...[
//     OutlinedButton(...),
//
// Also add the import at the top of agents_view.dart:
//   import '_session_model_picker.dart';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agents_controller.dart';
import '../models/agent_model_route.dart';
import '../models/agent_session.dart';

/// The "apply as" choice the user makes in the picker.
enum ModelPickerApplyAs {
  /// Persist as the session default (PATCH /agent-sessions/:id).
  session,

  /// Override only the next turn (WS modelOverride).
  turn,
}

/// Callback fired when the user picks a (route, applyAs) combination.
typedef OnModelPicked = void Function(
  AgentModelRoute route,
  ModelPickerApplyAs applyAs,
);

/// A pill button that shows the current model + route kind for [session], and
/// opens a popover to let the user pick a different model or route.
///
/// When no authed providers have routes, the pill is disabled (greyed out).
/// When the catalogue is still loading, the pill shows '…'.
///
/// Pass this widget into `_TranscriptHeader` — see the integration note above.
class SessionModelPicker extends StatelessWidget {
  const SessionModelPicker({
    super.key,
    required this.session,
  });

  final AgentSession session;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final routes = controller.modelRoutes;
    final loaded = controller.modelRoutesLoaded;
    final turnOverride = controller.pendingTurnOverride;

    // Determine what to display on the pill.
    final effectiveRoute = turnOverride ?? _defaultRoute(routes);
    final pillLabel = _pillLabel(loaded, effectiveRoute, turnOverride != null);

    final hasRoutes = routes.isNotEmpty;

    return _ModelPickerButton(
      label: pillLabel,
      enabled: hasRoutes,
      hasTurnOverride: turnOverride != null,
      onPick: hasRoutes
          ? (route, applyAs) => _applyPick(context, controller, route, applyAs)
          : null,
      routes: routes,
    );
  }

  String _pillLabel(
    bool loaded,
    AgentModelRoute? route,
    bool isTurnOverride,
  ) {
    if (!loaded) return '…';
    if (route == null) return 'No routes';
    final prefix = isTurnOverride ? '(turn) ' : '';
    return '$prefix${route.modelId} · ${route.isDirect ? "direct" : "via ${route.aggregatorVia ?? route.providerId}"}';
  }

  AgentModelRoute? _defaultRoute(List<AgentModelRoute> routes) {
    if (routes.isEmpty) return null;
    // Prefer the first direct route; fall back to first aggregator.
    return routes.firstWhere(
      (r) => r.isDirect,
      orElse: () => routes.first,
    );
  }

  void _applyPick(
    BuildContext context,
    AgentsController controller,
    AgentModelRoute route,
    ModelPickerApplyAs applyAs,
  ) {
    if (applyAs == ModelPickerApplyAs.session) {
      controller.setSessionModel(session.id, route);
    } else {
      controller.setTurnOverride(route);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal: the popup button + popover
// ---------------------------------------------------------------------------

class _ModelPickerButton extends StatelessWidget {
  const _ModelPickerButton({
    required this.label,
    required this.enabled,
    required this.hasTurnOverride,
    required this.routes,
    required this.onPick,
  });

  final String label;
  final bool enabled;
  final bool hasTurnOverride;
  final List<AgentModelRoute> routes;
  final OnModelPicked? onPick;

  @override
  Widget build(BuildContext context) {
    final accent = context.rhythm.accent;
    final textMuted = context.rhythm.textMuted;
    final pillColor = hasTurnOverride
        ? accent.withValues(alpha: 0.18)
        : context.rhythm.surfaceMuted;
    final pillBorderColor =
        hasTurnOverride ? accent.withValues(alpha: 0.4) : context.rhythm.border;
    final labelColor = enabled
        ? (hasTurnOverride ? accent : context.rhythm.textSecondary)
        : textMuted;

    return PopupMenuButton<_ModelPickerEntry>(
      enabled: enabled,
      tooltip: enabled ? 'Pick model' : 'No authed providers',
      offset: const Offset(0, 36),
      constraints: const BoxConstraints(minWidth: 280, maxWidth: 360),
      onSelected: (entry) {
        if (onPick == null) return;
        showDialog<ModelPickerApplyAs>(
          context: context,
          builder: (_) => const _ApplyAsDialog(),
        ).then((applyAs) {
          if (applyAs != null) {
            onPick!(entry.route, applyAs);
          }
        });
      },
      itemBuilder: (context) => _buildMenuItems(context),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
        decoration: BoxDecoration(
          color: pillColor,
          borderRadius: BorderRadius.circular(RhythmRadius.pill),
          border: Border.all(color: pillBorderColor),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.model_training_outlined,
              size: 12,
              color: labelColor,
            ),
            const SizedBox(width: 5),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: labelColor,
              ),
            ),
            const SizedBox(width: 4),
            Icon(Icons.expand_more, size: 12, color: labelColor),
          ],
        ),
      ),
    );
  }

  List<PopupMenuEntry<_ModelPickerEntry>> _buildMenuItems(
      BuildContext context) {
    final items = <PopupMenuEntry<_ModelPickerEntry>>[];

    // Partition into direct vs aggregator rows.
    final directRoutes = routes.where((r) => r.isDirect).toList();
    final aggregatorRoutes = routes.where((r) => r.isAggregator).toList();

    if (directRoutes.isNotEmpty) {
      items.add(
        PopupMenuItem<_ModelPickerEntry>(
          enabled: false,
          height: 28,
          child: Text(
            'DIRECT ACCOUNTS',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: context.rhythm.textMuted,
              letterSpacing: 0.6,
            ),
          ),
        ),
      );
      for (final route in directRoutes) {
        items.add(_routeItem(context, route));
      }
    }

    // Group aggregator routes by aggregatorVia name.
    if (aggregatorRoutes.isNotEmpty) {
      // Collect unique aggregator names in the order they first appear,
      // preserving the server-defined ordering within each aggregator.
      final seen = <String>{};
      final grouped = <String, List<AgentModelRoute>>{};
      for (final route in aggregatorRoutes) {
        final key = route.aggregatorVia ?? route.providerId;
        if (seen.add(key)) grouped[key] = [];
        grouped[key]!.add(route);
      }

      for (final entry in grouped.entries) {
        if (items.isNotEmpty) {
          items.add(const PopupMenuDivider());
        }
        items.add(
          PopupMenuItem<_ModelPickerEntry>(
            enabled: false,
            height: 28,
            child: Text(
              'VIA ${entry.key.toUpperCase()}',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: context.rhythm.textMuted,
                letterSpacing: 0.6,
              ),
            ),
          ),
        );
        for (final route in entry.value) {
          items.add(_routeItem(context, route));
        }
      }
    }

    return items;
  }

  PopupMenuItem<_ModelPickerEntry> _routeItem(
    BuildContext context,
    AgentModelRoute route,
  ) {
    final isAgg = route.isAggregator;
    final tagLabel =
        isAgg ? 'via ${route.aggregatorVia ?? route.providerId}' : 'direct';
    final tagColor = isAgg
        ? context.rhythm.warning.withValues(alpha: 0.85)
        : context.rhythm.success;

    return PopupMenuItem<_ModelPickerEntry>(
      value: _ModelPickerEntry(route: route),
      height: 40,
      child: Row(
        children: [
          Expanded(
            child: Text(
              route.modelId,
              style: TextStyle(
                fontSize: 13,
                color: context.rhythm.textPrimary,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: tagColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(RhythmRadius.pill),
              border: Border.all(color: tagColor.withValues(alpha: 0.3)),
            ),
            child: Text(
              tagLabel,
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: tagColor,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Wraps a [AgentModelRoute] so it can be used as a popup menu value.
class _ModelPickerEntry {
  const _ModelPickerEntry({required this.route});
  final AgentModelRoute route;
}

// ---------------------------------------------------------------------------
// "Apply as" dialog — session default vs this turn only
// ---------------------------------------------------------------------------

class _ApplyAsDialog extends StatelessWidget {
  const _ApplyAsDialog();

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: context.rhythm.surfaceRaised,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
      ),
      title: Text(
        'Apply model change',
        style: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w700,
          color: context.rhythm.textPrimary,
        ),
      ),
      content: Text(
        'Apply this model as the default for the whole session, '
        'or only for the next message?',
        style: TextStyle(
          fontSize: 13,
          color: context.rhythm.textSecondary,
          height: 1.45,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(ModelPickerApplyAs.turn),
          style: TextButton.styleFrom(
            foregroundColor: context.rhythm.textSecondary,
          ),
          child: const Text('This turn only'),
        ),
        FilledButton(
          onPressed: () =>
              Navigator.of(context).pop(ModelPickerApplyAs.session),
          style: FilledButton.styleFrom(
            backgroundColor: context.rhythm.accent,
          ),
          child: const Text('Session default'),
        ),
      ],
    );
  }
}
