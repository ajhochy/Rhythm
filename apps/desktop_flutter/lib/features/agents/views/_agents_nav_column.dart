/// Single Odysseus-style left navigation column for the Agents screen.
///
/// Replaces the old `ProjectsRail` + `_SessionListPanel` row children.
/// Contains, top to bottom:
///   1. Header: collapse toggle + "Agents" wordmark.
///   2. "+ New Session" action row.
///   3. Search field (client-side filter over CHATS).
///   4. CHATS section: "By Project" dropdown selector + filtered session list.
///   5. TOOLS section: Brain, Deep Research, Tasks, Webhooks, Profiles,
///      Cookbook, Review Queue, Report Card, Email, Gallery.
///   6. Footer: Account label + ⚙ Settings icon.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../../app/core/agents/agent_server_controller.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../agent_projects/controllers/agent_projects_controller.dart';
import '../../agent_cookbook/views/agent_cookbook_view.dart';
import '../../agent_email/views/agent_email_view.dart';
import '../../agent_gallery/views/agent_gallery_view.dart';
import '../../agent_memory/views/agent_memory_view.dart';
import '../../agent_optimizer/views/org_proposals_view.dart';
import '../../agent_research/views/agent_research_view.dart';
import '../../agent_schedules/views/agent_schedules_view.dart';
import '../../agent_skills/views/agent_skills_view.dart';
import '../../agent_webhooks/views/agent_webhooks_view.dart';
import '../../run_quality/views/run_quality_view.dart';
import '../../session_history/models/session_history_agent_session.dart';
import '../../session_history/views/session_history_view.dart';
import '../../settings/views/settings_view.dart';
import '../controllers/agents_controller.dart';
import '../models/agent_session.dart';
import '_agent_profile_sheet.dart';
import '_agent_settings_sheet.dart';
import '_session_list_body.dart';

// ---------------------------------------------------------------------------
// Public widget
// ---------------------------------------------------------------------------

/// Width of the nav column.
const double _kNavColumnWidth = 280.0;

class AgentsNavColumn extends StatefulWidget {
  const AgentsNavColumn({
    super.key,
    required this.resumableSectionExpanded,
    required this.onToggleResumable,
    required this.onNewSession,
    required this.onShowNewProjectDialog,
    required this.isCollapsed,
    required this.onToggleCollapse,
    required this.onShowSessionOptions,
  });

  final bool resumableSectionExpanded;
  final VoidCallback onToggleResumable;
  final VoidCallback? onNewSession;
  final VoidCallback onShowNewProjectDialog;
  final bool isCollapsed;
  final VoidCallback onToggleCollapse;
  final VoidCallback? onShowSessionOptions;

  @override
  State<AgentsNavColumn> createState() => _AgentsNavColumnState();
}

/// #903 — session list sort keys. #1026 (USO A3) adds [status].
enum _SessionSortField { dateNewest, dateOldest, name, lastActivity, status }

class _AgentsNavColumnState extends State<AgentsNavColumn> {
  String _searchQuery = '';
  final _searchController = TextEditingController();
  _SessionSortField _sortField = _SessionSortField.dateNewest;

  /// Sessions selected via Shift-click for bulk actions (mirrored from old
  /// _SessionListPanelState so existing selection behaviour is preserved).
  final Set<String> _multiSelected = {};

  bool _archivedSectionExpanded = false;

  bool get _hasMultiSelection => _multiSelected.isNotEmpty;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _onRowTap(String id) {
    final isShift = HardwareKeyboard.instance.isShiftPressed;
    if (isShift) {
      setState(() {
        if (_multiSelected.contains(id)) {
          _multiSelected.remove(id);
        } else {
          _multiSelected.add(id);
        }
      });
      return;
    }
    if (_hasMultiSelection) {
      setState(() => _multiSelected.clear());
    }
    final controller = context.read<AgentsController>();
    // #1027 (USO A4): scheduled / self-improvement rows are read-only
    // background runs — open the reused transcript detail view (the retained
    // Session History detail) instead of the interactive chat surface.
    if (controller.scope != AgentSessionScope.chats) {
      AgentSession? session;
      for (final s in controller.sessions) {
        if (s.id == id) {
          session = s;
          break;
        }
      }
      if (session != null) {
        final name = session.name.trim();
        Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => SessionTranscriptView(
              sessionId: session!.id,
              title: name.isEmpty ? 'Session' : name,
              status: SessionHistoryStatus.fromWire(session.status.wireValue),
              statusMessage: session.statusMessage,
            ),
          ),
        );
        return;
      }
    }
    controller.selectSession(id);
  }

  /// #903 — comparator backing the session-list sort menu. `lastActivity`
  /// falls back to `createdAt` for a session that has never had a turn yet,
  /// so it doesn't get pushed to a confusing "no date" bucket.
  int _compareSessions(AgentSession a, AgentSession b) {
    switch (_sortField) {
      case _SessionSortField.dateNewest:
        return b.createdAt.compareTo(a.createdAt);
      case _SessionSortField.dateOldest:
        return a.createdAt.compareTo(b.createdAt);
      case _SessionSortField.name:
        return a.name.toLowerCase().compareTo(b.name.toLowerCase());
      case _SessionSortField.lastActivity:
        final aTime = a.lastActivityAt ?? a.createdAt;
        final bTime = b.lastActivityAt ?? b.createdAt;
        return bTime.compareTo(aTime);
      case _SessionSortField.status:
        // #1026 (USO A3) — deterministic status order
        // (working → starting → idle → error), ties broken by recency.
        final byStatus = _statusRank(a.status).compareTo(_statusRank(b.status));
        if (byStatus != 0) return byStatus;
        final aTime = a.lastActivityAt ?? a.createdAt;
        final bTime = b.lastActivityAt ?? b.createdAt;
        return bTime.compareTo(aTime);
    }
  }

  /// #1026 (USO A3) — ordering weight for the Status sort. Lower sorts first:
  /// working → starting → idle → error, then the terminal/dormant states so
  /// the order is total (deterministic) across every possible status.
  static int _statusRank(AgentSessionStatus status) {
    switch (status) {
      case AgentSessionStatus.working:
        return 0;
      case AgentSessionStatus.starting:
        return 1;
      case AgentSessionStatus.idle:
        return 2;
      case AgentSessionStatus.error:
        return 3;
      case AgentSessionStatus.closed:
        return 4;
      case AgentSessionStatus.resumable:
        return 5;
    }
  }

  Future<void> _onToggleArchived() async {
    setState(() => _archivedSectionExpanded = !_archivedSectionExpanded);
    if (_archivedSectionExpanded) {
      await context.read<AgentsController>().loadArchivedSessions();
    }
  }

  Future<void> _confirmBulkDelete() async {
    final ids = _multiSelected.toList();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Delete ${ids.length} sessions?'),
        content: const Text(
          'This permanently removes the selected sessions and all of their '
          'messages. This cannot be undone.',
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
            child: Text('Delete ${ids.length}'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (!mounted) return;
    await context.read<AgentsController>().deleteSessions(ids);
    if (!mounted) return;
    setState(() => _multiSelected.clear());
  }

  @override
  Widget build(BuildContext context) {
    if (widget.isCollapsed) {
      // Render a narrow collapsed strip — just the toggle icon.
      return Container(
        width: 48,
        decoration: BoxDecoration(
          color: context.rhythm.surfaceRaised,
          borderRadius: BorderRadius.circular(RhythmRadius.xl),
          border: Border.all(color: context.rhythm.border),
          boxShadow: RhythmElevation.panel,
        ),
        child: Column(
          children: [
            const SizedBox(height: 12),
            IconButton(
              icon: const Icon(Icons.menu, size: 18),
              tooltip: 'Expand navigation',
              onPressed: widget.onToggleCollapse,
              style: IconButton.styleFrom(
                foregroundColor: context.rhythm.textMuted,
                minimumSize: const Size(36, 36),
                padding: EdgeInsets.zero,
              ),
            ),
          ],
        ),
      );
    }

    final controller = context.watch<AgentsController>();
    final agentServerController = context.watch<AgentServerController>();
    final projectsController = context.watch<AgentProjectsController>();

    final canStartSession =
        agentServerController.isReady && agentServerController.hasAnyAgent;

    final selectedProjectId = projectsController.selectedProjectId;

    // Filter by project, then by search query.
    final projectFiltered = selectedProjectId == null
        ? controller.sessions
        : controller.sessions
            .where((s) => s.projectId == selectedProjectId)
            .toList();

    final query = _searchQuery.trim().toLowerCase();
    final searchFiltered = query.isEmpty
        ? projectFiltered
        : projectFiltered
            .where(
              (s) =>
                  s.name.toLowerCase().contains(query) ||
                  (s.lastPreview?.toLowerCase().contains(query) ?? false),
            )
            .toList();

    // #903 — sortable session list. Default (dateNewest) preserves the prior
    // hardcoded behavior: a freshly created session appears at the TOP of the
    // list (the auto-selected row from _instantCreateSession) instead of
    // being appended to the bottom where it's easy to miss.
    // A sorted copy — controller.sessions is unmodifiable.
    final filteredSessions = [...searchFiltered]..sort(_compareSessions);

    return Container(
      key: const ValueKey('agents-nav-column'),
      width: _kNavColumnWidth,
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
        border: Border.all(color: context.rhythm.border),
        boxShadow: RhythmElevation.panel,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Header — pinned ──────────────────────────────────────────────
          _NavHeader(
            onToggleCollapse: widget.onToggleCollapse,
            onNewSession: canStartSession ? widget.onNewSession : null,
            onOptionsPressed:
                canStartSession ? widget.onShowSessionOptions : null,
          ),
          Divider(height: 1, color: context.rhythm.borderSubtle),

          // ── Search ──────────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
            child: TextField(
              key: const ValueKey('nav-search-field'),
              controller: _searchController,
              style: TextStyle(
                fontSize: 13,
                color: context.rhythm.textPrimary,
              ),
              decoration: InputDecoration(
                hintText: 'Search sessions…',
                hintStyle: TextStyle(
                  fontSize: 13,
                  color: context.rhythm.textMuted,
                ),
                prefixIcon: Icon(
                  Icons.search,
                  size: 16,
                  color: context.rhythm.textMuted,
                ),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: Icon(
                          Icons.close,
                          size: 14,
                          color: context.rhythm.textMuted,
                        ),
                        tooltip: 'Clear search',
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _searchQuery = '');
                        },
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(
                          minWidth: 28,
                          minHeight: 28,
                        ),
                      )
                    : null,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(
                  vertical: 8,
                  horizontal: 10,
                ),
                filled: true,
                fillColor: context.rhythm.surfaceMuted,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                  borderSide: BorderSide(color: context.rhythm.border),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                  borderSide: BorderSide(color: context.rhythm.borderSubtle),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                  borderSide: BorderSide(color: context.rhythm.accent),
                ),
              ),
              onChanged: (v) => setState(() => _searchQuery = v),
            ),
          ),
          const SizedBox(height: 10),

          // ── CHATS section ───────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
            child: Row(
              children: [
                // #1025 (USO A2) — category filter dropdown. Replaces the
                // static "CHATS" header; switching scope reloads the list with
                // the matching `?scope=` param. Default scope's headerLabel is
                // 'CHATS', preserving the original section wording.
                PopupMenuButton<AgentSessionScope>(
                  key: const ValueKey('session-scope-dropdown'),
                  tooltip: 'Filter sessions by category',
                  initialValue: controller.scope,
                  onSelected: (s) =>
                      context.read<AgentsController>().loadSessions(s),
                  itemBuilder: (_) => [
                    for (final s in AgentSessionScope.values)
                      PopupMenuItem<AgentSessionScope>(
                        value: s,
                        child: Text(s.menuLabel),
                      ),
                  ],
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Flexible(
                        child: Text(
                          controller.scope.headerLabel,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: context.rhythm.textMuted,
                            letterSpacing: 0.8,
                          ),
                        ),
                      ),
                      Icon(
                        Icons.arrow_drop_down,
                        size: 16,
                        color: context.rhythm.textMuted,
                      ),
                    ],
                  ),
                ),
                const Spacer(),
                // #903 — sort menu.
                PopupMenuButton<_SessionSortField>(
                  key: const ValueKey('session-sort-menu'),
                  tooltip: 'Sort sessions',
                  initialValue: _sortField,
                  onSelected: (v) => setState(() => _sortField = v),
                  itemBuilder: (_) => const [
                    PopupMenuItem(
                      value: _SessionSortField.dateNewest,
                      child: Text('Date (newest first)'),
                    ),
                    PopupMenuItem(
                      value: _SessionSortField.dateOldest,
                      child: Text('Date (oldest first)'),
                    ),
                    PopupMenuItem(
                      value: _SessionSortField.name,
                      child: Text('Name'),
                    ),
                    PopupMenuItem(
                      value: _SessionSortField.lastActivity,
                      child: Text('Last activity'),
                    ),
                    PopupMenuItem(
                      value: _SessionSortField.status,
                      child: Text('Status'),
                    ),
                  ],
                  child: SizedBox(
                    width: 28,
                    height: 28,
                    child: Icon(
                      Icons.sort_rounded,
                      size: 14,
                      color: context.rhythm.textMuted,
                    ),
                  ),
                ),
                // Refresh button (mirrored from old _SessionListHeader).
                SizedBox(
                  width: 28,
                  height: 28,
                  child: IconButton(
                    icon: const Icon(Icons.refresh, size: 14),
                    tooltip: 'Refresh',
                    padding: EdgeInsets.zero,
                    onPressed: () => context.read<AgentsController>().load(),
                    style: IconButton.styleFrom(
                      foregroundColor: context.rhythm.textMuted,
                      minimumSize: const Size(28, 28),
                      padding: EdgeInsets.zero,
                    ),
                  ),
                ),
              ],
            ),
          ),

          // "By Project" selector.
          _ByProjectSelector(
            onAddProject: widget.onShowNewProjectDialog,
          ),
          const SizedBox(height: 4),

          // Multi-select bulk-action bar.
          if (_hasMultiSelection)
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: context.rhythm.accentMuted,
                borderRadius: BorderRadius.circular(RhythmRadius.md),
              ),
              child: Row(
                children: [
                  Text(
                    '${_multiSelected.length} selected',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: context.rhythm.accent,
                    ),
                  ),
                  const Spacer(),
                  TextButton(
                    onPressed: () => setState(() => _multiSelected.clear()),
                    style: TextButton.styleFrom(
                      minimumSize: Size.zero,
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: const Text('Cancel'),
                  ),
                  const SizedBox(width: 4),
                  FilledButton.tonal(
                    onPressed: _confirmBulkDelete,
                    style: FilledButton.styleFrom(
                      backgroundColor: Theme.of(context)
                          .colorScheme
                          .error
                          .withValues(alpha: 0.18),
                      foregroundColor: Theme.of(context).colorScheme.error,
                      minimumSize: const Size(0, 26),
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                    ),
                    child: const Text('Delete'),
                  ),
                ],
              ),
            ),

          // ── Scrollable middle region ─────────────────────────────────────
          //
          // Everything between the pinned header above and the pinned footer
          // below lives inside a single SingleChildScrollView. This makes the
          // CHATS controls, session list, AND TOOLS section scroll together as
          // one area when the window is short — eliminating the layout overflow
          // that occurred when the 8-row TOOLS section exceeded the available
          // flex space.
          //
          // SessionListBody uses shrinkWrap:true so it does not try to fill an
          // unbounded height; it competes for natural column height instead.
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Session list — CHATS body (rich rows from SessionListBody).
                  SessionListBody(
                    filteredSessions: filteredSessions,
                    resumableSectionExpanded: widget.resumableSectionExpanded,
                    onToggleResumable: widget.onToggleResumable,
                    archivedSectionExpanded: _archivedSectionExpanded,
                    onToggleArchived: _onToggleArchived,
                    multiSelected: _multiSelected,
                    onRowTap: _onRowTap,
                    searchQuery: _searchQuery,
                    shrinkWrap: true,
                  ),

                  Divider(height: 1, color: context.rhythm.borderSubtle),

                  // ── TOOLS section ──────────────────────────────────────
                  const _ToolsSection(),
                ],
              ),
            ),
          ),

          Divider(height: 1, color: context.rhythm.borderSubtle),

          // ── Footer — pinned ──────────────────────────────────────────────
          const _NavFooter(),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

class _NavHeader extends StatelessWidget {
  const _NavHeader({
    required this.onToggleCollapse,
    required this.onNewSession,
    required this.onOptionsPressed,
  });

  final VoidCallback onToggleCollapse;
  final VoidCallback? onNewSession;
  final VoidCallback? onOptionsPressed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
      child: Row(
        children: [
          // Collapse / hamburger toggle.
          IconButton(
            icon: const Icon(Icons.menu, size: 18),
            tooltip: 'Collapse navigation',
            onPressed: onToggleCollapse,
            style: IconButton.styleFrom(
              foregroundColor: context.rhythm.textMuted,
              minimumSize: const Size(32, 32),
              padding: EdgeInsets.zero,
            ),
          ),
          const SizedBox(width: 8),
          // Wordmark.
          Expanded(
            child: Text(
              'Agents',
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: context.rhythm.textPrimary,
              ),
            ),
          ),
          // + New Session.
          if (onNewSession != null)
            FilledButton.tonal(
              onPressed: onNewSession,
              style: FilledButton.styleFrom(
                backgroundColor: context.rhythm.accentMuted,
                foregroundColor: context.rhythm.accent,
                elevation: 0,
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 7,
                ),
                minimumSize: const Size(0, 30),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                ),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.add, size: 14),
                  SizedBox(width: 4),
                  Text(
                    'New',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          if (onOptionsPressed != null) ...[
            const SizedBox(width: 2),
            IconButton(
              key: const Key('new-session-options-button'),
              icon: const Icon(Icons.more_horiz, size: 16),
              tooltip: 'Session options',
              onPressed: onOptionsPressed,
              style: IconButton.styleFrom(
                minimumSize: const Size(26, 30),
                padding: EdgeInsets.zero,
                foregroundColor: context.rhythm.textMuted,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// By Project selector
// ---------------------------------------------------------------------------

class _ByProjectSelector extends StatelessWidget {
  const _ByProjectSelector({required this.onAddProject});

  final VoidCallback onAddProject;

  @override
  Widget build(BuildContext context) {
    final ctrl = context.watch<AgentProjectsController>();
    final projects = ctrl.projects;
    final selectedId = ctrl.selectedProjectId;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        children: [
          Expanded(
            child: Container(
              key: const ValueKey('by-project-selector'),
              decoration: BoxDecoration(
                color: context.rhythm.surfaceMuted,
                borderRadius: BorderRadius.circular(RhythmRadius.md),
                border: Border.all(color: context.rhythm.borderSubtle),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String?>(
                  value: selectedId,
                  isExpanded: true,
                  isDense: true,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                  style: TextStyle(
                    fontSize: 12,
                    color: context.rhythm.textPrimary,
                  ),
                  hint: Text(
                    'By Project ▾',
                    style: TextStyle(
                      fontSize: 12,
                      color: context.rhythm.textSecondary,
                    ),
                  ),
                  icon: const SizedBox.shrink(),
                  onChanged: (id) => ctrl.select(id),
                  items: [
                    DropdownMenuItem<String?>(
                      value: null,
                      child: Text(
                        'All Sessions',
                        style: TextStyle(
                          fontSize: 12,
                          color: context.rhythm.textPrimary,
                        ),
                      ),
                    ),
                    ...projects.map(
                      (p) => DropdownMenuItem<String?>(
                        value: p.id,
                        child: Text(
                          p.name,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 12,
                            color: context.rhythm.textPrimary,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(width: 6),
          // Add project affordance.
          Tooltip(
            message: 'Add project',
            child: SizedBox(
              width: 28,
              height: 28,
              child: Material(
                color: context.rhythm.surfaceMuted,
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                child: InkWell(
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                  onTap: onAddProject,
                  child: Icon(
                    Icons.add,
                    size: 14,
                    color: context.rhythm.textMuted,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// TOOLS section
// ---------------------------------------------------------------------------

class _ToolsSection extends StatelessWidget {
  const _ToolsSection();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 6),
            child: Text(
              'TOOLS',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: context.rhythm.textMuted,
                letterSpacing: 0.8,
              ),
            ),
          ),
          _ToolsRow(
            key: const ValueKey('tools-row-brain'),
            icon: '🧠',
            label: 'Brain',
            subtitle: 'Persistent agent memories',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const AgentMemoryView(),
              ),
            ),
          ),
          const SizedBox(height: 2),
          _ToolsRow(
            key: const ValueKey('tools-row-research'),
            icon: '🔬',
            label: 'Deep Research',
            subtitle: 'Multi-source research runs',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const AgentResearchView(),
              ),
            ),
          ),
          const SizedBox(height: 2),
          _ToolsRow(
            key: const ValueKey('tools-row-tasks'),
            icon: '⏰',
            label: 'Tasks',
            subtitle: 'Scheduled agent jobs',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const AgentSchedulesView(),
              ),
            ),
          ),
          const SizedBox(height: 2),
          _ToolsRow(
            key: const ValueKey('tools-row-webhooks'),
            icon: '🪝',
            label: 'Webhooks',
            subtitle: 'Inbound trigger endpoints',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const AgentWebhooksView(),
              ),
            ),
          ),
          const SizedBox(height: 2),
          _ToolsRow(
            key: const ValueKey('tools-row-profiles'),
            icon: '🤖',
            label: 'Profiles',
            subtitle: 'Agent identity & permissions',
            onTap: () => showAgentProfilesManagerSheet(context),
          ),
          const SizedBox(height: 2),
          _ToolsRow(
            key: const ValueKey('tools-row-skills'),
            icon: '✨',
            label: 'Skills',
            subtitle: 'Self-improving skill library',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const AgentSkillsView(),
              ),
            ),
          ),
          const SizedBox(height: 2),
          _ToolsRow(
            key: const ValueKey('tools-row-cookbook'),
            icon: '📖',
            label: 'Cookbook',
            subtitle: 'Agent prompt recipes',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const AgentCookbookView(),
              ),
            ),
          ),
          const SizedBox(height: 2),
          _ToolsRow(
            key: const ValueKey('tools-row-review-queue'),
            icon: '🛂',
            label: 'Review Queue',
            subtitle: 'Human-gated org optimizer proposals',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const OrgProposalsView(),
              ),
            ),
          ),
          const SizedBox(height: 2),
          _ToolsRow(
            key: const ValueKey('tools-row-run-quality'),
            icon: '📋',
            label: 'Report Card',
            subtitle: 'How agents have been doing lately',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const RunQualityView(),
              ),
            ),
          ),
          const SizedBox(height: 2),
          _ToolsRow(
            key: const ValueKey('tools-row-email'),
            icon: '📧',
            label: 'Email',
            subtitle: 'Gmail signals & assistant',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const AgentEmailView(),
              ),
            ),
          ),
          const SizedBox(height: 2),
          _ToolsRow(
            key: const ValueKey('tools-row-gallery'),
            icon: '🎨',
            label: 'Gallery',
            subtitle: 'Canva design workspace',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const AgentGalleryView(),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ToolsRow extends StatelessWidget {
  const _ToolsRow({
    super.key,
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.onTap,
  });

  final String icon;
  final String label;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(RhythmRadius.sm),
      child: InkWell(
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
          child: Row(
            children: [
              SizedBox(
                width: 22,
                child: Text(icon, style: const TextStyle(fontSize: 14)),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: context.rhythm.textPrimary,
                      ),
                    ),
                    Text(
                      subtitle,
                      style: TextStyle(
                        fontSize: 10,
                        color: context.rhythm.textMuted,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.chevron_right,
                size: 14,
                color: context.rhythm.textMuted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

class _NavFooter extends StatelessWidget {
  const _NavFooter();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
      child: Row(
        children: [
          Icon(
            Icons.account_circle_outlined,
            size: 16,
            color: context.rhythm.textMuted,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Account',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: context.rhythm.textSecondary,
              ),
            ),
          ),
          // Agent settings (keeps the existing showAgentSettingsSheet path).
          IconButton(
            icon: const Icon(Icons.tune_rounded, size: 16),
            tooltip: 'Agent settings',
            onPressed: () => showAgentSettingsSheet(context),
            style: IconButton.styleFrom(
              foregroundColor: context.rhythm.textMuted,
              minimumSize: const Size(28, 28),
              padding: EdgeInsets.zero,
            ),
          ),
          // Settings navigation.
          IconButton(
            key: const ValueKey('nav-col-settings'),
            icon: const Icon(Icons.settings_outlined, size: 16),
            tooltip: 'Settings',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const SettingsView(),
              ),
            ),
            style: IconButton.styleFrom(
              foregroundColor: context.rhythm.textMuted,
              minimumSize: const Size(28, 28),
              padding: EdgeInsets.zero,
            ),
          ),
        ],
      ),
    );
  }
}
