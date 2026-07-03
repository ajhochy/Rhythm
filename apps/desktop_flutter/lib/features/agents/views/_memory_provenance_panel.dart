/// Issue #862 — Collapsible "Memories used in this reply" panel for the
/// session side rail.
///
/// Renders the session's latest recorded memory provenance (hydrated from
/// `GET /agent-sessions/:id/memory-provenance`). Mirrors [TodoPanel]'s
/// collapsible-header-plus-rows structure.
///
/// Three states:
///   - `provenance == null` (not fetched yet) → renders nothing.
///   - `provenance['recorded'] == false` (no turn ever recorded) → renders
///     nothing (there is nothing to show yet; the panel does not need to
///     occupy space for a session that predates this feature or that has
///     memory injection disabled).
///   - `provenance['recorded'] == true` → always renders, even when
///     `memoryIds` is empty, so the "no memories used" state is stated
///     clearly rather than silently hidden.
///
/// [collapseKey] is used to persist per-session collapse state — callers
/// pass the session id so the collapsed/expanded state is remembered while
/// the user switches between sessions.
library;

import 'package:flutter/material.dart';
import 'package:rhythm_desktop/app/core/ui/tokens/rhythm_theme.dart';

class MemoryProvenancePanel extends StatefulWidget {
  const MemoryProvenancePanel({
    super.key,
    required this.provenance,
    required this.collapseKey,
  });

  /// The session's latest memory-provenance record, or null when not yet
  /// fetched. Shape: `{ recorded: bool, memoryIds: List, notePaths: List }`.
  final Map<String, dynamic>? provenance;

  /// Stable key used to remember collapse state per session.
  /// Pass the local session id.
  final String collapseKey;

  @override
  State<MemoryProvenancePanel> createState() => _MemoryProvenancePanelState();
}

/// Global per-session collapse registry, mirroring [TodoPanel]'s.
final Map<String, bool> _collapseRegistry = {};

class _MemoryProvenancePanelState extends State<MemoryProvenancePanel> {
  bool get _collapsed => _collapseRegistry[widget.collapseKey] ?? false;

  void _toggle() {
    setState(() {
      _collapseRegistry[widget.collapseKey] = !_collapsed;
    });
  }

  @override
  Widget build(BuildContext context) {
    final provenance = widget.provenance;
    if (provenance == null) return const SizedBox.shrink();
    final recorded = provenance['recorded'] == true;
    if (!recorded) return const SizedBox.shrink();

    final memoryIds =
        (provenance['memoryIds'] as List<dynamic>?)?.cast<String>() ??
            const <String>[];
    final notePaths =
        (provenance['notePaths'] as List<dynamic>?)?.cast<String?>() ??
            const <String?>[];

    return Container(
      decoration: BoxDecoration(
        color: context.rhythm.canvas,
        border: Border(
          top: BorderSide(color: context.rhythm.borderSubtle),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: _toggle,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  Text(
                    'Memories used',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.4,
                      color: context.rhythm.textMuted,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: context.rhythm.surfaceMuted,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: context.rhythm.borderSubtle),
                    ),
                    child: Text(
                      '${memoryIds.length}',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                        color: context.rhythm.textSecondary,
                      ),
                    ),
                  ),
                  const Spacer(),
                  Icon(
                    _collapsed ? Icons.expand_more : Icons.expand_less,
                    size: 16,
                    color: context.rhythm.textMuted,
                  ),
                ],
              ),
            ),
          ),
          if (!_collapsed)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: memoryIds.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Text(
                        'No memories were used in this reply.',
                        style: TextStyle(
                          fontSize: 12,
                          fontStyle: FontStyle.italic,
                          color: context.rhythm.textMuted,
                        ),
                      ),
                    )
                  : Column(
                      children: [
                        for (var i = 0; i < memoryIds.length; i++)
                          _MemoryProvenanceRow(
                            path: i < notePaths.length ? notePaths[i] : null,
                          ),
                      ],
                    ),
            ),
        ],
      ),
    );
  }
}

class _MemoryProvenanceRow extends StatelessWidget {
  const _MemoryProvenanceRow({required this.path});

  /// The originating vault note path, or null for a legacy row with no
  /// traceable source.
  final String? path;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Icon(Icons.psychology_alt_outlined,
              size: 14, color: context.rhythm.textMuted),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              path ?? '(untracked memory)',
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12,
                color: context.rhythm.textSecondary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
