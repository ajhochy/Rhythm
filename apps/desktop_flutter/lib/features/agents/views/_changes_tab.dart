/// OPC-M3-1 — Changes tab: displays per-file diffs from GET /session/{id}/diff.
///
/// [ChangesTab] renders one expandable file row per FileDiff entry using the
/// shared [UnifiedDiffView] widget (M2-3). Shows an explicit "No file changes
/// yet" empty state when the diff list is empty and no error has occurred.
/// Shows an error state when [errorMessage] is non-null.
///
/// [ChangesTabBadge] renders the changed-file count for use in the tab header.
///
/// Usage:
///   ChangesTab(
///     sessionId: session.id,
///     diffEntries: controller.sessionDiffFor(session.id),
///     isLoading: controller.sessionDiffLoading(session.id),
///   )
///
///   ChangesTabBadge(sessionId: session.id)
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/ui/tokens/rhythm_theme.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import '_tool_renderers/_unified_diff_view.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';

// ---------------------------------------------------------------------------
// ChangesTab
// ---------------------------------------------------------------------------

/// Displays working-tree file diffs for a session.
///
/// [diffEntries] is a list of raw FileDiff JSON maps with keys:
///   file (String), before (String), after (String),
///   additions (int), deletions (int).
///
/// This widget is stateless — the parent (usually [AgentsController]) owns
/// the fetch lifecycle and passes results in here.
class ChangesTab extends StatelessWidget {
  const ChangesTab({
    super.key,
    required this.sessionId,
    required this.diffEntries,
    this.isLoading = false,
    this.errorMessage,
  });

  final String sessionId;
  final List<Map<String, dynamic>> diffEntries;
  final bool isLoading;
  final String? errorMessage;

  @override
  Widget build(BuildContext context) {
    // Loading state.
    if (isLoading && diffEntries.isEmpty) {
      return Center(
        child: CircularProgressIndicator(
          strokeWidth: 2,
          color: context.rhythm.accent,
        ),
      );
    }

    // Error state (distinct from empty state per c3).
    if (errorMessage != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            errorMessage!,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 13,
              color: context.rhythm.danger,
            ),
          ),
        ),
      );
    }

    // Empty state — "No file changes yet" (c3).
    if (diffEntries.isEmpty) {
      return Center(
        child: Text(
          'No file changes yet',
          style: TextStyle(
            fontSize: 13,
            color: context.rhythm.textMuted,
          ),
        ),
      );
    }

    // One file row per diff entry (c2).
    return ListView.builder(
      padding: const EdgeInsets.all(12),
      itemCount: diffEntries.length,
      itemBuilder: (context, index) {
        final entry = diffEntries[index];
        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: _FileDiffRow(entry: entry),
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// _FileDiffRow
// ---------------------------------------------------------------------------

/// A single expandable file row for a FileDiff entry.
///
/// Shows the file path + "+N −M" stat in the header. Tapping expands to show
/// the full [UnifiedDiffView]. Uses the existing [_UnifiedDiffView] widget by
/// constructing a synthetic [ChatPart] from the FileDiff fields.
class _FileDiffRow extends StatefulWidget {
  const _FileDiffRow({required this.entry});

  final Map<String, dynamic> entry;

  @override
  State<_FileDiffRow> createState() => _FileDiffRowState();
}

class _FileDiffRowState extends State<_FileDiffRow> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final entry = widget.entry;
    final file = (entry['file'] as String?) ?? '';
    final additions = (entry['additions'] as num?)?.toInt() ?? 0;
    final deletions = (entry['deletions'] as num?)?.toInt() ?? 0;
    final before = (entry['before'] as String?) ?? '';
    final after = (entry['after'] as String?) ?? '';

    // Extract filename for the compact header.
    final displayName = file.contains('/')
        ? file.split('/').last
        : file.isNotEmpty
            ? file
            : 'unknown';

    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: context.rhythm.borderSubtle),
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        color: context.rhythm.surfaceRaised,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row: file name + stat + expand toggle.
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            borderRadius: BorderRadius.only(
              topLeft: Radius.circular(RhythmRadius.md),
              topRight: Radius.circular(RhythmRadius.md),
              bottomLeft:
                  _expanded ? Radius.zero : Radius.circular(RhythmRadius.md),
              bottomRight:
                  _expanded ? Radius.zero : Radius.circular(RhythmRadius.md),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  // File path.
                  Expanded(
                    child: Text(
                      displayName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontFamily: 'JetBrainsMono',
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: context.rhythm.textPrimary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  // "+N" additions count.
                  if (additions > 0)
                    Text(
                      '+$additions',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: context.rhythm.success,
                        fontFamily: 'JetBrainsMono',
                      ),
                    ),
                  if (additions > 0 && deletions > 0) const SizedBox(width: 4),
                  // "−N" deletions count.
                  if (deletions > 0)
                    Text(
                      '-$deletions',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: context.rhythm.danger,
                        fontFamily: 'JetBrainsMono',
                      ),
                    ),
                  const SizedBox(width: 8),
                  Icon(
                    _expanded ? Icons.expand_less : Icons.expand_more,
                    size: 16,
                    color: context.rhythm.textMuted,
                  ),
                ],
              ),
            ),
          ),
          // Expanded: full diff view.
          if (_expanded) ...[
            Divider(height: 1, color: context.rhythm.borderSubtle),
            Padding(
              padding: const EdgeInsets.all(8),
              child: UnifiedDiffView(
                part: _buildSyntheticPart(
                  file: file,
                  before: before,
                  after: after,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// Build a synthetic [ChatPart] so [UnifiedDiffView] can render the diff.
  ///
  /// [UnifiedDiffView] reads `part.toolArgs['filePath']`,
  /// `part.toolArgs['oldContent']`, and `part.toolArgs['newContent']`.
  ChatPart _buildSyntheticPart({
    required String file,
    required String before,
    required String after,
  }) {
    final part = ChatPart(
      id: 'diff-$file',
      messageId: '',
      type: 'tool',
      text: '',
    );
    part.mergePart({
      'id': 'diff-$file',
      'type': 'tool',
      'tool': 'edit',
      'state': {
        'status': 'completed',
        'input': {
          'filePath': file,
          'oldContent': before,
          'newContent': after,
        },
      },
    });
    return part;
  }
}

// ---------------------------------------------------------------------------
// ChangesTabBadge
// ---------------------------------------------------------------------------

/// Badge widget that shows the number of changed files for [sessionId].
/// Renders nothing when the count is zero (hidden when no changes).
class ChangesTabBadge extends StatelessWidget {
  const ChangesTabBadge({super.key, required this.sessionId});

  final String sessionId;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final count = controller.sessionDiffFor(sessionId).length;

    if (count == 0) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
      decoration: BoxDecoration(
        color: context.rhythm.accent,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        '$count',
        style: const TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: Colors.white,
        ),
      ),
    );
  }
}
