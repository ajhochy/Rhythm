/// #602 — Unified cross-agent model picker for the composer area.
///
/// Pulls from GET /agents/models/catalog (cached in AgentsController).
/// Shows sections:
///   1. Authorized — Claude    (claude-code, direct, authorized)
///   2. Authorized — Codex     (codex, direct, authorized)
///   3. Authorized — Copilot   (github-copilot, authorized)
///   4. Authorized — Gemini    (google, authorized)
///   5. Other authorized direct providers
///   6. Free — OpenRouter      (aggregator, collapsible)
/// Unauthorized rows show a "Connect" button that opens the connectUrl.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agents_controller.dart';
import '../models/agent_model_route.dart';
import '../models/agent_session.dart';
import '../models/catalog_model_entry.dart';
import '_session_model_picker.dart' show ModelPickerApplyAs;

/// Pill button that shows the current model and opens the unified picker.
class UnifiedAgentModelPicker extends StatelessWidget {
  const UnifiedAgentModelPicker({
    super.key,
    required this.session,
  });

  final AgentSession session;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final catalog = controller.catalog;
    final loaded = controller.catalogLoaded;
    final turnOverride = controller.pendingTurnOverride;

    // Effective model display: turn override > session default > first available.
    final pillLabel = _pillLabel(
      loaded: loaded,
      session: session,
      catalog: catalog,
      turnOverride: turnOverride,
    );
    final hasTurnOverride = turnOverride != null;

    return _UnifiedPickerButton(
      label: pillLabel,
      hasTurnOverride: hasTurnOverride,
      catalog: catalog,
      loaded: loaded,
      session: session,
      onPick: (entry, applyAs) =>
          _applyPick(context, controller, entry, applyAs),
    );
  }

  String _pillLabel({
    required bool loaded,
    required AgentSession session,
    required List<CatalogModelEntry> catalog,
    required AgentModelRoute? turnOverride,
  }) {
    if (!loaded) return '…';
    if (turnOverride != null) return '(turn) ${turnOverride.modelId}';
    if (session.modelId != null) return session.modelId!;
    // Fallback: first authorized entry.
    final first = catalog.firstWhere(
      (e) => e.authorized,
      orElse: () => catalog.isNotEmpty
          ? catalog.first
          : const CatalogModelEntry(
              agent: '',
              provider: '',
              modelId: 'Pick model',
              displayName: 'Pick model',
              route: 'direct',
              authorized: false,
              authProvider: '',
            ),
    );
    return first.modelId.isEmpty ? 'Pick model' : first.modelId;
  }

  void _applyPick(
    BuildContext context,
    AgentsController controller,
    CatalogModelEntry entry,
    ModelPickerApplyAs applyAs,
  ) {
    final route = AgentModelRoute(
      providerId: entry.provider,
      modelId: entry.modelId,
      routeKind: entry.route,
      aggregatorVia: entry.isAggregator ? 'OpenRouter' : null,
      label: entry.displayName,
      variantLabel: entry.variantLabel,
    );
    if (applyAs == ModelPickerApplyAs.session) {
      controller.setSessionModel(session.id, route);
    } else {
      controller.setTurnOverride(route);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal: button + popup
// ---------------------------------------------------------------------------

typedef _OnEntryPicked = void Function(
    CatalogModelEntry entry, ModelPickerApplyAs applyAs);

class _UnifiedPickerButton extends StatefulWidget {
  const _UnifiedPickerButton({
    required this.label,
    required this.hasTurnOverride,
    required this.catalog,
    required this.loaded,
    required this.session,
    required this.onPick,
  });

  final String label;
  final bool hasTurnOverride;
  final List<CatalogModelEntry> catalog;
  final bool loaded;
  final AgentSession session;
  final _OnEntryPicked onPick;

  @override
  State<_UnifiedPickerButton> createState() => _UnifiedPickerButtonState();
}

class _UnifiedPickerButtonState extends State<_UnifiedPickerButton> {
  @override
  Widget build(BuildContext context) {
    final accent = context.rhythm.accent;
    final pillColor = widget.hasTurnOverride
        ? accent.withValues(alpha: 0.18)
        : context.rhythm.surfaceMuted;
    final pillBorderColor = widget.hasTurnOverride
        ? accent.withValues(alpha: 0.4)
        : context.rhythm.border;
    final labelColor =
        widget.hasTurnOverride ? accent : context.rhythm.textSecondary;

    return PopupMenuButton<_PickerValue>(
      tooltip: 'Pick model',
      offset: const Offset(0, 36),
      constraints: const BoxConstraints(minWidth: 320, maxWidth: 420),
      onSelected: (value) {
        if (!value.entry.authorized) return; // "Connect" button handled inline
        _promptApplyAs(context, value.entry);
      },
      itemBuilder: (_) => _buildItems(context),
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
            Icon(Icons.model_training_outlined, size: 12, color: labelColor),
            const SizedBox(width: 5),
            Text(
              widget.label,
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

  void _promptApplyAs(BuildContext context, CatalogModelEntry entry) {
    showDialog<ModelPickerApplyAs>(
      context: context,
      builder: (_) => const _ApplyAsDialog(),
    ).then((applyAs) {
      if (applyAs != null) widget.onPick(entry, applyAs);
    });
  }

  List<PopupMenuEntry<_PickerValue>> _buildItems(BuildContext context) {
    final catalog = widget.catalog;
    if (!widget.loaded || catalog.isEmpty) {
      return [
        PopupMenuItem<_PickerValue>(
          enabled: false,
          child: Text(
            widget.loaded ? 'No models available' : 'Loading…',
            style: TextStyle(color: context.rhythm.textMuted, fontSize: 12),
          ),
        ),
      ];
    }

    // Partition: authorized direct, authorized aggregator, unauthorized direct,
    // unauthorized aggregator.
    final authedDirect =
        catalog.where((e) => e.authorized && e.isDirect).toList();
    final authedAggregator =
        catalog.where((e) => e.authorized && e.isAggregator).toList();
    final unauthedDirect =
        catalog.where((e) => !e.authorized && e.isDirect).toList();
    final unauthedAggregator =
        catalog.where((e) => !e.authorized && e.isAggregator).toList();

    final items = <PopupMenuEntry<_PickerValue>>[];

    // ---- Authorized direct, grouped by agent/provider section ----
    if (authedDirect.isNotEmpty) {
      items.add(_sectionHeader(context, 'CONNECTED — DIRECT'));
      final grouped = _groupBySection(authedDirect);
      for (final section in grouped.entries) {
        if (items.length > 1) items.add(const PopupMenuDivider());
        items.add(_providerHeader(context, section.key));
        for (final entry in section.value) {
          items.add(_entryItem(context, entry, isActive: _isActive(entry)));
        }
      }
    }

    // ---- Authorized aggregator (OpenRouter etc.) ----
    if (authedAggregator.isNotEmpty) {
      if (items.isNotEmpty) items.add(const PopupMenuDivider());
      items.add(_sectionHeader(context, 'FREE — OPENROUTER'));
      for (final entry in authedAggregator) {
        items.add(_entryItem(context, entry, isActive: _isActive(entry)));
      }
    }

    // ---- Unauthorized direct — show "Connect" prompt ----
    if (unauthedDirect.isNotEmpty) {
      if (items.isNotEmpty) items.add(const PopupMenuDivider());
      items.add(_sectionHeader(context, 'NOT CONNECTED'));
      // Dedupe by provider to avoid repeating per-model connect rows.
      final seenProviders = <String>{};
      for (final entry in unauthedDirect) {
        if (!seenProviders.add(entry.provider)) continue;
        items.add(_connectItem(context, entry));
      }
    }

    // ---- Unauthorized aggregator ----
    if (unauthedAggregator.isNotEmpty) {
      if (items.isNotEmpty) items.add(const PopupMenuDivider());
      items.add(_sectionHeader(context, 'OPENROUTER — NOT CONNECTED'));
      final seenProviders = <String>{};
      for (final entry in unauthedAggregator) {
        if (!seenProviders.add(entry.provider)) continue;
        items.add(_connectItem(context, entry));
      }
    }

    return items;
  }

  bool _isActive(CatalogModelEntry entry) {
    final session = widget.session;
    final override = context.read<AgentsController>().pendingTurnOverride;
    if (override != null) {
      return override.providerId == entry.provider &&
          override.modelId == entry.modelId;
    }
    return session.providerId == entry.provider &&
        session.modelId == entry.modelId;
  }

  /// Groups direct entries by a section label (Claude, Codex, Copilot, etc.)
  Map<String, List<CatalogModelEntry>> _groupBySection(
      List<CatalogModelEntry> direct) {
    final map = <String, List<CatalogModelEntry>>{};
    final order = <String>[];
    for (final e in direct) {
      final label = _sectionLabelFor(e);
      if (!map.containsKey(label)) {
        order.add(label);
        map[label] = [];
      }
      map[label]!.add(e);
    }
    return {for (final k in order) k: map[k]!};
  }

  String _sectionLabelFor(CatalogModelEntry e) {
    switch (e.provider) {
      case 'anthropic':
        return 'Anthropic (claude-code)';
      case 'openai':
        return 'OpenAI (codex)';
      case 'google':
        return 'Google (gemini-cli)';
      case 'github-copilot':
        return 'GitHub Copilot';
      default:
        return e.provider;
    }
  }

  PopupMenuItem<_PickerValue> _sectionHeader(
      BuildContext context, String label) {
    return PopupMenuItem<_PickerValue>(
      enabled: false,
      height: 28,
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: context.rhythm.textMuted,
          letterSpacing: 0.7,
        ),
      ),
    );
  }

  PopupMenuItem<_PickerValue> _providerHeader(
      BuildContext context, String label) {
    return PopupMenuItem<_PickerValue>(
      enabled: false,
      height: 24,
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: context.rhythm.textSecondary,
        ),
      ),
    );
  }

  PopupMenuItem<_PickerValue> _entryItem(
    BuildContext context,
    CatalogModelEntry entry, {
    required bool isActive,
  }) {
    final accent = context.rhythm.accent;
    final routeColor =
        entry.isDirect ? context.rhythm.success : context.rhythm.warning;
    final tagLabel = entry.isDirect ? 'direct' : 'via OpenRouter';

    return PopupMenuItem<_PickerValue>(
      value: _PickerValue(entry: entry),
      height: entry.variantLabel != null ? 52 : 40,
      child: Row(
        children: [
          SizedBox(
            width: 18,
            child: isActive
                ? Icon(Icons.check, size: 14, color: accent)
                : const SizedBox.shrink(),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  entry.displayName,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: isActive ? FontWeight.w700 : FontWeight.w400,
                    color: isActive ? accent : context.rhythm.textPrimary,
                  ),
                ),
                if (entry.variantLabel != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    entry.variantLabel!,
                    style: TextStyle(
                      fontSize: 10,
                      color: context.rhythm.textMuted,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: routeColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(RhythmRadius.pill),
              border: Border.all(color: routeColor.withValues(alpha: 0.3)),
            ),
            child: Text(
              tagLabel,
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: routeColor,
              ),
            ),
          ),
        ],
      ),
    );
  }

  PopupMenuItem<_PickerValue> _connectItem(
    BuildContext context,
    CatalogModelEntry entry,
  ) {
    final providerLabel = _displayNameForProvider(entry.provider);
    return PopupMenuItem<_PickerValue>(
      value: _PickerValue(entry: entry),
      enabled: false,
      height: 44,
      child: Row(
        children: [
          const SizedBox(width: 18),
          Expanded(
            child: Text(
              providerLabel,
              style: TextStyle(
                fontSize: 13,
                color: context.rhythm.textMuted,
              ),
            ),
          ),
          const SizedBox(width: 8),
          OutlinedButton(
            onPressed: entry.connectUrl != null
                ? () => _openConnectUrl(entry.connectUrl!)
                : null,
            style: OutlinedButton.styleFrom(
              foregroundColor: context.rhythm.accent,
              side: BorderSide(color: context.rhythm.border),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.md),
              ),
            ),
            child: const Text('Connect', style: TextStyle(fontSize: 11)),
          ),
        ],
      ),
    );
  }

  void _openConnectUrl(String connectUrl) {
    // connectUrl is relative — prepend the agent local base URL.
    const base = 'http://localhost:4001';
    final full = Uri.parse('$base$connectUrl');
    launchUrl(full, mode: LaunchMode.externalApplication);
  }

  String _displayNameForProvider(String provider) {
    switch (provider) {
      case 'anthropic':
        return 'Anthropic (Claude)';
      case 'openai':
        return 'OpenAI (Codex)';
      case 'google':
        return 'Google (Gemini)';
      case 'github-copilot':
        return 'GitHub Copilot';
      case 'openrouter':
        return 'OpenRouter';
      default:
        return provider;
    }
  }
}

class _PickerValue {
  const _PickerValue({required this.entry});
  final CatalogModelEntry entry;
}

// ---------------------------------------------------------------------------
// Reuse ApplyAs dialog (same as _session_model_picker.dart)
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
