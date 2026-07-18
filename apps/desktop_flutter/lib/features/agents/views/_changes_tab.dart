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

import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/ui/tokens/rhythm_theme.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import '_tool_renderers/_unified_diff_view.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';

// ---------------------------------------------------------------------------
// ChangesTab
// ---------------------------------------------------------------------------

/// OCU-23 (#1064) — which diff [ChangesTab] is currently showing.
enum ChangesScope {
  /// This session only: GET /agent-sessions/:id/diff (existing M3-1 path).
  session('This session'),

  /// All uncommitted working-tree changes: GET /vcs/diff?mode=git.
  allUncommitted('All uncommitted'),

  /// Full diff vs the default branch: GET /vcs/diff?mode=branch.
  vsDefaultBranch('vs default branch');

  const ChangesScope(this.label);
  final String label;
}

/// Displays working-tree file diffs for a session, with a scope toggle
/// between the session-scoped diff and the two vcs/diff proxy modes.
///
/// [diffEntries]/[isLoading]/[errorMessage] are the [ChangesScope.session]
/// data (owned by [AgentsController.fetchSessionDiff], same as before M3-1).
/// The other two scopes are fetched lazily on first selection and read
/// directly from [AgentsController].
class ChangesTab extends StatefulWidget {
  const ChangesTab({
    super.key,
    required this.sessionId,
    required this.diffEntries,
    this.isLoading = false,
    this.errorMessage,
    this.session,
  });

  final String sessionId;
  final List<Map<String, dynamic>> diffEntries;
  final bool isLoading;
  final String? errorMessage;

  /// OCU-18 (#1059): when provided and [AgentSession.isIsolatedWorktree],
  /// the tab shows Reset/Remove worktree actions. Optional (defaults to
  /// hidden) so existing callers/tests that only pass a bare id are
  /// unaffected.
  final AgentSession? session;

  @override
  State<ChangesTab> createState() => _ChangesTabState();
}

class _ChangesTabState extends State<ChangesTab> {
  ChangesScope _scope = ChangesScope.session;

  void _selectScope(ChangesScope scope) {
    setState(() => _scope = scope);
    final controller = context.read<AgentsController>();
    switch (scope) {
      case ChangesScope.session:
        break;
      case ChangesScope.allUncommitted:
        controller.fetchVcsDiff(widget.sessionId, 'git');
      case ChangesScope.vsDefaultBranch:
        controller.fetchVcsDiff(widget.sessionId, 'branch');
    }
  }

  Future<void> _exportPatch(BuildContext context) async {
    final controller = context.read<AgentsController>();
    final messenger = ScaffoldMessenger.of(context);
    try {
      final patch = await controller.fetchVcsDiffRaw(widget.sessionId);
      final path = await FilePicker.saveFile(
        dialogTitle: 'Export patch',
        fileName: '${widget.sessionId}.patch',
        type: FileType.custom,
        allowedExtensions: const ['patch', 'diff'],
      );
      if (path == null) return; // user cancelled the save dialog
      await File(path).writeAsString(patch);
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text('Patch exported to $path')),
      );
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text('Export failed: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();

    final List<Map<String, dynamic>> entries;
    final bool isLoading;
    final String? errorMessage;
    final bool patchMode;
    switch (_scope) {
      case ChangesScope.session:
        entries = widget.diffEntries;
        isLoading = widget.isLoading;
        errorMessage = widget.errorMessage;
        patchMode = false;
      case ChangesScope.allUncommitted:
        entries = controller.vcsDiffFor(widget.sessionId, 'git');
        isLoading = controller.vcsDiffLoading(widget.sessionId, 'git');
        errorMessage = controller.vcsDiffErrorFor(widget.sessionId, 'git');
        patchMode = true;
      case ChangesScope.vsDefaultBranch:
        entries = controller.vcsDiffFor(widget.sessionId, 'branch');
        isLoading = controller.vcsDiffLoading(widget.sessionId, 'branch');
        errorMessage = controller.vcsDiffErrorFor(widget.sessionId, 'branch');
        patchMode = true;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.session != null && widget.session!.isIsolatedWorktree)
          _WorktreeActionsRow(session: widget.session!),
        _ScopeToggleRow(
          scope: _scope,
          onSelect: _selectScope,
          onExport: () => _exportPatch(context),
        ),
        Expanded(
          child: _buildBody(
            context,
            entries: entries,
            isLoading: isLoading,
            errorMessage: errorMessage,
            patchMode: patchMode,
          ),
        ),
      ],
    );
  }

  Widget _buildBody(
    BuildContext context, {
    required List<Map<String, dynamic>> entries,
    required bool isLoading,
    required String? errorMessage,
    required bool patchMode,
  }) {
    // Loading state.
    if (isLoading && entries.isEmpty) {
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
            errorMessage,
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
    if (entries.isEmpty) {
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

    // Summary header (files / +adds / −dels) + revert/restore controls for
    // the session scope only, then one file row per diff entry (c2).
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _scope == ChangesScope.session
            ? _ChangesSummaryHeader(
                sessionId: widget.sessionId,
                diffEntries: entries,
              )
            : _ScopeSummaryHeader(diffEntries: entries),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.all(12),
            itemCount: entries.length,
            itemBuilder: (context, index) {
              final entry = entries[index];
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _FileDiffRow(entry: entry, patchMode: patchMode),
              );
            },
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// _WorktreeActionsRow — OCU-18 (#1059)
// ---------------------------------------------------------------------------

/// Reset/Remove actions for a session running in an isolated git worktree.
/// Remove is only enabled for an ENDED session (status == closed) — an
/// active session still needs its worktree to keep running.
class _WorktreeActionsRow extends StatelessWidget {
  const _WorktreeActionsRow({required this.session});

  final AgentSession session;

  Future<void> _confirmReset(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reset worktree?'),
        content: const Text(
          'Resets the worktree branch back to the primary default branch, '
          'discarding any uncommitted changes in the worktree.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Reset'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    final controller = context.read<AgentsController>();
    final ok = await controller.resetWorktree(session.id);
    if (!context.mounted) return;
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          ok ? 'Worktree reset.' : (controller.error ?? 'Reset failed.'),
        ),
      ),
    );
  }

  Future<void> _confirmRemove(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove worktree?'),
        content: const Text(
          'Deletes the isolated git worktree for this session. The session '
          'itself and its history are kept. This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    final controller = context.read<AgentsController>();
    final ok = await controller.removeWorktree(session.id);
    if (!context.mounted) return;
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          ok ? 'Worktree removed.' : (controller.error ?? 'Remove failed.'),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final busy = controller.worktreeActionInFlight;
    // Remove is only available for an ENDED session — an active session
    // still needs its worktree to keep running.
    final canRemove = session.status == AgentSessionStatus.closed;

    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Row(
        children: [
          Icon(Icons.call_split_rounded,
              size: 13, color: context.rhythm.accent),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              session.worktreeBranch ?? 'isolated worktree',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11,
                fontFamily: 'Menlo',
                color: context.rhythm.textMuted,
              ),
            ),
          ),
          TextButton(
            key: const ValueKey('changes-worktree-reset-button'),
            onPressed: busy ? null : () => _confirmReset(context),
            child: const Text('Reset', style: TextStyle(fontSize: 12)),
          ),
          Tooltip(
            message: canRemove
                ? 'Remove the isolated worktree'
                : 'End the session before removing its worktree',
            child: TextButton(
              key: const ValueKey('changes-worktree-remove-button'),
              onPressed:
                  (busy || !canRemove) ? null : () => _confirmRemove(context),
              style:
                  TextButton.styleFrom(foregroundColor: context.rhythm.danger),
              child: const Text('Remove', style: TextStyle(fontSize: 12)),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _ScopeToggleRow
// ---------------------------------------------------------------------------

/// Segmented [ChangesScope] toggle + the "Export patch" action.
class _ScopeToggleRow extends StatelessWidget {
  const _ScopeToggleRow({
    required this.scope,
    required this.onSelect,
    required this.onExport,
  });

  final ChangesScope scope;
  final ValueChanged<ChangesScope> onSelect;
  final VoidCallback onExport;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Row(
        children: [
          Expanded(
            child: Wrap(
              spacing: 4,
              runSpacing: 4,
              children: [
                for (final s in ChangesScope.values)
                  _ScopeChip(
                    label: s.label,
                    selected: s == scope,
                    onTap: () => onSelect(s),
                    scopeKey: s.name,
                  ),
              ],
            ),
          ),
          Tooltip(
            message: 'Export patch',
            child: IconButton(
              key: const ValueKey('changes-export-patch-button'),
              onPressed: onExport,
              icon: const Icon(Icons.ios_share, size: 16),
              visualDensity: VisualDensity.compact,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints.tightFor(width: 28, height: 28),
            ),
          ),
        ],
      ),
    );
  }
}

class _ScopeChip extends StatelessWidget {
  const _ScopeChip({
    required this.label,
    required this.selected,
    required this.onTap,
    required this.scopeKey,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final String scopeKey;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      key: ValueKey('changes-scope-$scopeKey'),
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: selected ? context.rhythm.accentMuted : Colors.transparent,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: selected ? context.rhythm.accent : context.rhythm.border,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: selected ? context.rhythm.accent : context.rhythm.textMuted,
          ),
        ),
      ),
    );
  }
}

/// Lightweight file-count summary for the two vcs/diff scopes (no
/// revert/restore — those are session-transcript concepts only).
class _ScopeSummaryHeader extends StatelessWidget {
  const _ScopeSummaryHeader({required this.diffEntries});

  final List<Map<String, dynamic>> diffEntries;

  @override
  Widget build(BuildContext context) {
    var adds = 0;
    var dels = 0;
    for (final entry in diffEntries) {
      adds += (entry['additions'] as num?)?.toInt() ?? 0;
      dels += (entry['deletions'] as num?)?.toInt() ?? 0;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised,
        border: Border(
          bottom: BorderSide(color: context.rhythm.borderSubtle),
        ),
      ),
      child: Text(
        '${diffEntries.length} files · +$adds −$dels',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          fontFamily: 'JetBrainsMono',
          color: context.rhythm.textSecondary,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _ChangesSummaryHeader
// ---------------------------------------------------------------------------

/// Diff summary line (files / +adds / −dels) plus the panel-level revert and
/// restore controls. Shown only when there are diff entries.
///
/// Revert target: the EARLIEST message with role == 'user' in the session.
/// User prompts make no file edits, so reverting TO that message undoes all
/// assistant file changes that came after it. When no user message exists yet
/// (e.g. the session just started), the Revert button renders disabled with a
/// tooltip ("No revert point yet").
class _ChangesSummaryHeader extends StatelessWidget {
  const _ChangesSummaryHeader({
    required this.sessionId,
    required this.diffEntries,
  });

  final String sessionId;
  final List<Map<String, dynamic>> diffEntries;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final reverted = controller.isSessionReverted(sessionId);

    final files = diffEntries.length;
    var adds = 0;
    var dels = 0;
    for (final entry in diffEntries) {
      adds += (entry['additions'] as num?)?.toInt() ?? 0;
      dels += (entry['deletions'] as num?)?.toInt() ?? 0;
    }

    // Earliest USER message is the safe revert target: user prompts make no
    // file edits, so reverting TO the first user message undoes all assistant
    // file changes made after it.
    final messages = controller.chatMessagesFor(sessionId);
    ChatMessage? firstUserMessage;
    for (final m in messages) {
      if (m.role == 'user') {
        firstUserMessage = m;
        break;
      }
    }
    final canRevert = !reverted && firstUserMessage != null;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised,
        border: Border(
          bottom: BorderSide(color: context.rhythm.borderSubtle),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              '$files files · +$adds −$dels',
              key: const ValueKey('changes-summary'),
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                fontFamily: 'JetBrainsMono',
                color: context.rhythm.textSecondary,
              ),
            ),
          ),
          if (reverted)
            TextButton.icon(
              key: const ValueKey('changes-restore-button'),
              onPressed: () => _confirmRestore(context, controller),
              icon: const Icon(Icons.restore, size: 16),
              label: const Text('Restore'),
            )
          else
            Tooltip(
              message: canRevert
                  ? 'Revert all file changes in this session'
                  : 'No revert point yet',
              child: TextButton.icon(
                key: const ValueKey('changes-revert-button'),
                onPressed: canRevert
                    ? () => _confirmRevert(
                        context, controller, firstUserMessage!.id)
                    : null,
                icon: const Icon(Icons.undo, size: 16),
                label: const Text('Revert'),
              ),
            ),
        ],
      ),
    );
  }

  void _confirmRevert(
    BuildContext context,
    AgentsController controller,
    String messageId,
  ) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Revert changes?'),
        content: const Text(
          'Undo all file changes made by this session. This resets every file '
          'modified during the session.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(dialogContext).pop();
              controller.revertSession(sessionId, messageId);
            },
            child: const Text('Revert'),
          ),
        ],
      ),
    );
  }

  void _confirmRestore(BuildContext context, AgentsController controller) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Restore changes?'),
        content: const Text(
          'Re-apply the reverted file changes for this session.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(dialogContext).pop();
              controller.unrevertSession(sessionId);
            },
            child: const Text('Restore'),
          ),
        ],
      ),
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
  const _FileDiffRow({required this.entry, this.patchMode = false});

  final Map<String, dynamic> entry;

  /// OCU-23 (#1064): true for vcs/diff entries, which carry a raw unified
  /// `patch` string instead of split `before`/`after` content.
  final bool patchMode;

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
                part: widget.patchMode
                    ? _buildSyntheticPatchPart(
                        file: file,
                        patch: (entry['patch'] as String?) ?? '',
                      )
                    : _buildSyntheticPart(
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

  /// OCU-23 (#1064): vcs/diff entries carry a raw unified `patch` string (not
  /// split before/after content). [UnifiedDiffView] renders that as plain
  /// monospace output when `oldContent`/`newContent` are both absent — so this
  /// reuses the existing widget without modification, matching the issue's
  /// "render all three scopes through the existing UnifiedDiffView" scope.
  ChatPart _buildSyntheticPatchPart({
    required String file,
    required String patch,
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
        'input': {'filePath': file},
        'output': patch,
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
