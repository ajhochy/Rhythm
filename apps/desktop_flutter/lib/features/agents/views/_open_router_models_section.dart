/// Issue #609 — OpenRouter model curation section.
///
/// Renders as a collapsible expander within the AI Accounts section (next to
/// the existing OpenRouter API-key row). When expanded it shows a search box
/// and scrollable list of models from the OpenRouter catalog, with a checkbox
/// to control visibility in the in-session model picker.
///
/// Models with no visibility row are treated as visible by default.
library;

import 'package:flutter/material.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../data/agent_model_visibility_data_source.dart';
import '../models/agent_model_route.dart';

class OpenRouterModelsSection extends StatefulWidget {
  const OpenRouterModelsSection({super.key});

  @override
  State<OpenRouterModelsSection> createState() =>
      _OpenRouterModelsSectionState();
}

class _OpenRouterModelsSectionState extends State<OpenRouterModelsSection> {
  bool _expanded = false;
  bool _loading = false;

  final _ds = AgentModelVisibilityDataSource();
  final _searchController = TextEditingController();

  List<OpenRouterModelEntry> _catalog = [];
  Map<String, bool> _visibilityMap = {};

  String get _query => _searchController.text.toLowerCase();

  List<OpenRouterModelEntry> get _filtered {
    if (_query.isEmpty) return _catalog;
    return _catalog
        .where((m) =>
            m.id.toLowerCase().contains(_query) ||
            m.name.toLowerCase().contains(_query))
        .toList();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (_loading) return;
    setState(() => _loading = true);
    try {
      final results = await Future.wait([
        _ds.fetchOpenRouterModels(),
        _ds.fetchVisibility(),
      ]);
      final catalog = results[0] as List<OpenRouterModelEntry>;
      final visibility = results[1] as List<AgentModelVisibility>;
      final map = <String, bool>{};
      for (final v in visibility) {
        if (v.provider == 'openrouter') {
          map[v.modelId] = v.visible;
        }
      }
      if (mounted) {
        setState(() {
          _catalog = catalog;
          _visibilityMap = map;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool _isVisible(String modelId) => _visibilityMap[modelId] ?? true;

  Future<void> _setVisible(String modelId, {required bool visible}) async {
    setState(() {
      _visibilityMap = {..._visibilityMap, modelId: visible};
    });
    try {
      await _ds.patchVisibility([
        AgentModelVisibility(
          provider: 'openrouter',
          modelId: modelId,
          visible: visible,
        ),
      ]);
    } catch (_) {
      // Revert on failure.
      setState(() {
        _visibilityMap = {..._visibilityMap, modelId: !visible};
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Expander header.
        InkWell(
          onTap: () async {
            setState(() => _expanded = !_expanded);
            if (_expanded && _catalog.isEmpty) {
              await _load();
            }
          },
          borderRadius: BorderRadius.circular(RhythmRadius.sm),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: [
                Icon(
                  _expanded ? Icons.expand_less : Icons.expand_more,
                  size: 16,
                  color: context.rhythm.textSecondary,
                ),
                const SizedBox(width: 6),
                Text(
                  'Browse & curate OpenRouter models',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: context.rhythm.textSecondary,
                  ),
                ),
                if (_catalog.isNotEmpty) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: context.rhythm.surfaceMuted,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      '${_catalog.length}',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                        color: context.rhythm.textMuted,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        if (_expanded) ...[
          const SizedBox(height: 8),
          // Search box.
          TextField(
            controller: _searchController,
            onChanged: (_) => setState(() {}),
            style: TextStyle(
              fontSize: 13,
              color: context.rhythm.textPrimary,
            ),
            decoration: InputDecoration(
              hintText: 'Search models…',
              hintStyle: TextStyle(
                color: context.rhythm.textMuted,
                fontSize: 13,
              ),
              prefixIcon: Icon(
                Icons.search,
                size: 18,
                color: context.rhythm.textMuted,
              ),
              isDense: true,
              filled: true,
              fillColor: context.rhythm.canvas,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.md),
                borderSide: BorderSide(color: context.rhythm.border),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.md),
                borderSide: BorderSide(color: context.rhythm.border),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.md),
                borderSide: BorderSide(color: context.rhythm.accent),
              ),
            ),
          ),
          const SizedBox(height: 8),
          if (_loading)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: context.rhythm.accent,
                ),
              ),
            )
          else if (_filtered.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                _query.isEmpty
                    ? 'No models loaded. Check your connection.'
                    : 'No models match "$_query".',
                style: TextStyle(
                  fontSize: 12,
                  color: context.rhythm.textMuted,
                  fontStyle: FontStyle.italic,
                ),
              ),
            )
          else
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 320),
              child: ListView.builder(
                padding: EdgeInsets.zero,
                shrinkWrap: true,
                itemCount: _filtered.length,
                itemBuilder: (context, index) {
                  final model = _filtered[index];
                  final visible = _isVisible(model.id);
                  return _ModelRow(
                    model: model,
                    visible: visible,
                    onToggle: (v) => _setVisible(model.id, visible: v),
                  );
                },
              ),
            ),
        ],
      ],
    );
  }
}

class _ModelRow extends StatelessWidget {
  const _ModelRow({
    required this.model,
    required this.visible,
    required this.onToggle,
  });

  final OpenRouterModelEntry model;
  final bool visible;
  final ValueChanged<bool> onToggle;

  String get _pricingSummary {
    final p = model.pricingPrompt;
    final c = model.pricingCompletion;
    if (p == null && c == null) return '';
    // Convert string decimals to $/1M tokens.
    double? parseRate(String? s) {
      if (s == null) return null;
      final v = double.tryParse(s);
      if (v == null) return null;
      return v * 1000000;
    }

    final promptRate = parseRate(p);
    final compRate = parseRate(c);
    if (promptRate == null && compRate == null) return '';
    final parts = <String>[];
    if (promptRate != null) {
      parts.add('\$${promptRate.toStringAsFixed(2)}/1M in');
    }
    if (compRate != null) {
      parts.add('\$${compRate.toStringAsFixed(2)}/1M out');
    }
    return parts.join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final ctxLen = model.contextLength;
    final pricing = _pricingSummary;

    return InkWell(
      onTap: () => onToggle(!visible),
      borderRadius: BorderRadius.circular(RhythmRadius.sm),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
        child: Row(
          children: [
            Checkbox(
              value: visible,
              onChanged: (v) => onToggle(v ?? false),
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              visualDensity: VisualDensity.compact,
              activeColor: context.rhythm.accent,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    model.id,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: context.rhythm.textPrimary,
                      fontFamily: 'Menlo',
                    ),
                  ),
                  if (model.name != model.id && model.name.isNotEmpty) ...[
                    const SizedBox(height: 1),
                    Text(
                      model.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 11,
                        color: context.rhythm.textSecondary,
                      ),
                    ),
                  ],
                  if (ctxLen != null || pricing.isNotEmpty) ...[
                    const SizedBox(height: 1),
                    Row(
                      children: [
                        if (ctxLen != null)
                          Text(
                            '${_formatCtx(ctxLen)} ctx',
                            style: TextStyle(
                              fontSize: 10,
                              color: context.rhythm.textMuted,
                            ),
                          ),
                        if (ctxLen != null && pricing.isNotEmpty)
                          Text(
                            ' · ',
                            style: TextStyle(
                              fontSize: 10,
                              color: context.rhythm.textMuted,
                            ),
                          ),
                        if (pricing.isNotEmpty)
                          Text(
                            pricing,
                            style: TextStyle(
                              fontSize: 10,
                              color: context.rhythm.textMuted,
                            ),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _formatCtx(int len) {
    if (len >= 1000000) return '${(len / 1000000).toStringAsFixed(0)}M';
    if (len >= 1000) return '${(len / 1000).toStringAsFixed(0)}K';
    return '$len';
  }
}
