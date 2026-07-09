/// Shared session-list rendering for the Agents screen.
///
/// Contains:
///   - [SessionListBody]: renders Active / Resumable / Archived sections.
///   - [SessionRow]: rich active-session row with model badge, status dot,
///     context menu (archive / delete).
///   - [ResumableSessionRow]: resumable-session row with Resume button.
///   - [ArchivedSessionRow]: archived-session row with Restore / Delete actions.
///   - [AgentKindBadge]: pill badge resolved from agentId/providerId/modelId.
///   - [AgentConfigBadge]: badge renderer from a resolved [AgentBadgeIdentity].
///   - [SessionStatusDot]: animated status indicator dot / spinner.
///   - [SessionRowMenu]: ⋯ popup menu (Archive / Delete) for an active row.
///
/// Used by both [_AgentsNavColumnState] (the nav column) and the test harnesses
/// exported from agents_view.dart.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/agents/agent_server_controller.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../agent_configs/controllers/agent_configs_controller.dart';
import '../../agent_configs/widgets/agent_icon.dart';
import '../controllers/agents_controller.dart';
import '../models/agent_session.dart';
import 'agent_badge_identity.dart';

// ---------------------------------------------------------------------------
// SessionListBody
// ---------------------------------------------------------------------------

/// Renders Active / Resumable / Archived session sections for a pre-filtered
/// list of sessions.
///
/// Callers supply:
///   - [filteredSessions]: the sessions to show in the Active section.
///   - [resumableSectionExpanded] / [onToggleResumable]: collapsible Resumable.
///   - [archivedSectionExpanded] / [onToggleArchived]: collapsible Archived.
///   - [multiSelected]: set of session ids selected via Shift-click.
///   - [onRowTap]: called when a row is tapped.
///   - [searchQuery]: non-empty string shows the empty-state "no matching" copy.
class SessionListBody extends StatelessWidget {
  const SessionListBody({
    super.key,
    required this.filteredSessions,
    required this.resumableSectionExpanded,
    required this.onToggleResumable,
    required this.archivedSectionExpanded,
    required this.onToggleArchived,
    required this.multiSelected,
    required this.onRowTap,
    this.searchQuery = '',
    this.listPadding = const EdgeInsets.fromLTRB(12, 4, 12, 12),
    // When true the inner ListView uses shrinkWrap + NeverScrollableScrollPhysics
    // so it can sit inside an outer scrollable without creating a competing scroll.
    this.shrinkWrap = false,
  });

  final List<AgentSession> filteredSessions;
  final bool resumableSectionExpanded;
  final VoidCallback onToggleResumable;
  final bool archivedSectionExpanded;
  final VoidCallback onToggleArchived;
  final Set<String> multiSelected;
  final void Function(String id) onRowTap;
  final String searchQuery;
  final EdgeInsets listPadding;
  final bool shrinkWrap;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();

    if (controller.status == AgentsLoadStatus.loading &&
        filteredSessions.isEmpty) {
      final indicator = CircularProgressIndicator(color: context.rhythm.accent);
      return shrinkWrap
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Center(child: indicator),
            )
          : Center(child: indicator);
    }

    if (filteredSessions.isEmpty &&
        controller.resumable.isEmpty &&
        !controller.isCreating) {
      final emptyState = _EmptyChatsState(hasQuery: searchQuery.isNotEmpty);
      return shrinkWrap
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: emptyState,
            )
          : emptyState;
    }

    return ListView(
      padding: listPadding,
      shrinkWrap: shrinkWrap,
      physics: shrinkWrap ? const NeverScrollableScrollPhysics() : null,
      children: [
        if (controller.isCreating) ...[
          const _CreatingSessionRow(),
          const SizedBox(height: 6),
        ],
        // #910 — "collapse all / expand all" for subagent groups, shown only
        // when at least one session in view actually has subagents.
        if (_parentIdsWithChildren(filteredSessions).isNotEmpty) ...[
          _SubagentCollapseAllToggle(
            parentIds: _parentIdsWithChildren(filteredSessions),
          ),
          const SizedBox(height: 4),
        ],
        // ── Active sessions ────────────────────────────────────────────────
        // Child sessions (parentId != null) are rendered indented under their
        // parent. Root sessions are rendered first; their children follow inline.
        ..._buildSessionTree(
          context,
          filteredSessions,
          controller,
          multiSelected,
          onRowTap,
        ),

        // ── Resumable section ──────────────────────────────────────────────
        if (controller.resumable.isNotEmpty) ...[
          GestureDetector(
            onTap: onToggleResumable,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  Icon(
                    resumableSectionExpanded
                        ? Icons.expand_less
                        : Icons.expand_more,
                    size: 14,
                    color: context.rhythm.textMuted,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    'Resumable (${controller.resumable.length})',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: context.rhythm.textMuted,
                      letterSpacing: 0.5,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (resumableSectionExpanded)
            for (final session in controller.resumable) ...[
              ResumableSessionRow(
                session: session,
                onResume: () =>
                    context.read<AgentsController>().resumeSession(session.id),
              ),
              const SizedBox(height: 6),
            ],
        ],

        // ── Archived section ───────────────────────────────────────────────
        GestureDetector(
          key: const ValueKey('archived-section-header'),
          onTap: onToggleArchived,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                Icon(
                  archivedSectionExpanded
                      ? Icons.expand_less
                      : Icons.expand_more,
                  size: 14,
                  color: context.rhythm.textMuted,
                ),
                const SizedBox(width: 4),
                Text(
                  'Archived (${controller.archived.length})',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: context.rhythm.textMuted,
                    letterSpacing: 0.5,
                  ),
                ),
              ],
            ),
          ),
        ),
        if (archivedSectionExpanded)
          for (final session in controller.archived) ...[
            ArchivedSessionRow(
              session: session,
              onUnarchive: () =>
                  context.read<AgentsController>().unarchiveSession(session.id),
            ),
            const SizedBox(height: 6),
          ],
      ],
    );
  }
}

/// #910 — every session id (within [sessions]) that has at least one child
/// also present in [sessions]. Used to decide whether the "collapse all /
/// expand all" toggle should render, and what it should act on.
Set<String> _parentIdsWithChildren(List<AgentSession> sessions) {
  final sessionIds = {for (final s in sessions) s.id};
  final parents = <String>{};
  for (final s in sessions) {
    if (s.parentId != null && sessionIds.contains(s.parentId)) {
      parents.add(s.parentId!);
    }
  }
  return parents;
}

/// #910 — a single "Collapse all" / "Expand all" text toggle for every
/// subagent group currently in view. Reads current state as "collapse all"
/// when ANY covered parent is expanded (so one tap always fully collapses
/// first), matching common tree-view conventions.
class _SubagentCollapseAllToggle extends StatelessWidget {
  const _SubagentCollapseAllToggle({required this.parentIds});

  final Set<String> parentIds;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final anyExpanded =
        parentIds.any((id) => !controller.isParentSessionCollapsed(id));
    return Align(
      alignment: Alignment.centerRight,
      child: TextButton(
        onPressed: () => controller.setAllParentSessionsCollapsed(
          parentIds,
          anyExpanded,
        ),
        style: TextButton.styleFrom(
          foregroundColor: context.rhythm.accent,
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          minimumSize: Size.zero,
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          textStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
        ),
        child: Text(anyExpanded ? 'Collapse all' : 'Expand all'),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Session tree builder (#743)
// ---------------------------------------------------------------------------

/// Groups [sessions] into a parent→children tree and builds the widget list.
///
/// Root sessions (parentId == null, or parentId not in the filtered set) are
/// rendered as [SessionRow]. Their children are rendered indented beneath them
/// as [ChildSessionRow] widgets, so the UI communicates the delegation chain.
///
/// Sessions whose parent IS in the filtered list are NOT rendered as standalone
/// root rows — they appear only under their parent row.
List<Widget> _buildSessionTree(
  BuildContext context,
  List<AgentSession> sessions,
  AgentsController controller,
  Set<String> multiSelected,
  void Function(String id) onRowTap,
) {
  // Build a parent-id → children map.
  final childrenOf = <String, List<AgentSession>>{};
  final sessionIds = {for (final s in sessions) s.id};
  for (final s in sessions) {
    if (s.parentId != null && sessionIds.contains(s.parentId)) {
      childrenOf.putIfAbsent(s.parentId!, () => []).add(s);
    }
  }

  final widgets = <Widget>[];
  for (final session in sessions) {
    // Skip sessions that are children of another session in this filtered list.
    if (session.parentId != null && sessionIds.contains(session.parentId)) {
      continue;
    }
    widgets.add(SessionRow(
      session: session,
      isSelected: controller.selectedSessionId == session.id,
      isMultiSelected: multiSelected.contains(session.id),
      isWorking: controller.isWorking(session.id),
      isStuck: controller.connectivity.isStuck(session.id),
      onTap: () => onRowTap(session.id),
    ));
    widgets.add(const SizedBox(height: 4));

    // #910 — a parent with subagents renders a collapse/expand toggle. When
    // collapsed, the children shrink to a single one-line summary instead of
    // one row each, so a session that spawned many subagents doesn't dominate
    // the list.
    final children = childrenOf[session.id] ?? [];
    if (children.isNotEmpty) {
      final collapsed = controller.isParentSessionCollapsed(session.id);
      widgets.add(Padding(
        padding: const EdgeInsets.only(left: 16),
        child: _SubagentGroupSummary(
          count: children.length,
          workingCount:
              children.where((c) => controller.isWorking(c.id)).length,
          collapsed: collapsed,
          onTap: () => controller.toggleParentSessionCollapsed(session.id),
        ),
      ));
      widgets.add(const SizedBox(height: 3));
      if (!collapsed) {
        for (final child in children) {
          widgets.add(Padding(
            padding: const EdgeInsets.only(left: 16),
            child: ChildSessionRow(
              session: child,
              isSelected: controller.selectedSessionId == child.id,
              isWorking: controller.isWorking(child.id),
              onTap: () => onRowTap(child.id),
            ),
          ));
          widgets.add(const SizedBox(height: 3));
        }
      }
    }
  }
  return widgets;
}

/// #910 — one-line "N subagents" summary row that toggles the child rows
/// beneath its parent session. Always tappable (unlike [ChildSessionRow],
/// which represents a single navigable session).
class _SubagentGroupSummary extends StatelessWidget {
  const _SubagentGroupSummary({
    required this.count,
    required this.workingCount,
    required this.collapsed,
    required this.onTap,
  });

  final int count;
  final int workingCount;
  final bool collapsed;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final label = workingCount > 0
        ? '$count subagent${count == 1 ? '' : 's'} · $workingCount running'
        : '$count subagent${count == 1 ? '' : 's'}';
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(RhythmRadius.md),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Row(
          children: [
            Icon(
              collapsed ? Icons.chevron_right : Icons.expand_more,
              size: 14,
              color: context.rhythm.textMuted,
            ),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w500,
                color: context.rhythm.textMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// SessionRow — rich active-session row
// ---------------------------------------------------------------------------

class SessionRow extends StatelessWidget {
  const SessionRow({
    super.key,
    required this.session,
    required this.isSelected,
    required this.isWorking,
    required this.isStuck,
    required this.onTap,
    this.isMultiSelected = false,
  });

  final AgentSession session;
  final bool isSelected;
  final bool isMultiSelected;
  final bool isWorking;
  final bool isStuck;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final highlighted = isSelected || isMultiSelected;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(RhythmRadius.lg),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        curve: Curves.easeOut,
        // Minimal: a single tight line — agent icon · title · status light · menu.
        // No agent label, no preview, no stuck text (status light conveys state).
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
        decoration: BoxDecoration(
          color: highlighted
              ? context.rhythm.accentMuted
              : context.rhythm.surfaceMuted,
          borderRadius: BorderRadius.circular(RhythmRadius.lg),
          border: Border.all(
            color: isMultiSelected
                ? context.rhythm.accent
                : isSelected
                    ? context.rhythm.accent.withValues(alpha: 0.28)
                    : context.rhythm.border,
            width: isMultiSelected ? 2 : 1,
          ),
          boxShadow: highlighted
              ? [
                  BoxShadow(
                    color: context.rhythm.accent.withValues(alpha: 0.08),
                    blurRadius: 18,
                    offset: const Offset(0, 6),
                  ),
                ]
              : const [],
        ),
        child: Row(
          children: [
            AgentKindIcon(
              agentId: session.agentId,
              providerId: session.providerId,
              modelId: session.modelId,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                session.name.isNotEmpty ? session.name : 'New session',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: session.name.isNotEmpty
                      ? context.rhythm.textPrimary
                      : context.rhythm.textMuted,
                ),
              ),
            ),
            const SizedBox(width: 6),
            SessionStatusDot(status: session.status, isWorking: isWorking),
            SessionRowMenu(session: session),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// ChildSessionRow — compact indented row for delegated subagent sessions (#743)
// ---------------------------------------------------------------------------

class ChildSessionRow extends StatelessWidget {
  const ChildSessionRow({
    super.key,
    required this.session,
    required this.isSelected,
    required this.isWorking,
    required this.onTap,
  });

  final AgentSession session;
  final bool isSelected;
  final bool isWorking;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(RhythmRadius.md),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: isSelected
              ? context.rhythm.accentMuted
              : context.rhythm.surfaceMuted.withValues(alpha: 0.6),
          borderRadius: BorderRadius.circular(RhythmRadius.md),
          border: Border.all(
            color: isSelected
                ? context.rhythm.accent.withValues(alpha: 0.28)
                : context.rhythm.border.withValues(alpha: 0.5),
          ),
        ),
        child: Row(
          children: [
            Icon(
              Icons.subdirectory_arrow_right,
              size: 11,
              color: context.rhythm.textMuted,
            ),
            const SizedBox(width: 5),
            Expanded(
              child: Text(
                session.name.isNotEmpty ? session.name : 'Subagent task',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                  color: context.rhythm.textSecondary,
                ),
              ),
            ),
            const SizedBox(width: 4),
            SessionStatusDot(status: session.status, isWorking: isWorking),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// ResumableSessionRow
// ---------------------------------------------------------------------------

class ResumableSessionRow extends StatelessWidget {
  const ResumableSessionRow({
    super.key,
    required this.session,
    required this.onResume,
  });

  final AgentSession session;
  final VoidCallback onResume;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Row(
        children: [
          AgentKindBadge(
            agentId: session.agentId,
            providerId: session.providerId,
            modelId: session.modelId,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              session.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textSecondary,
              ),
            ),
          ),
          TextButton(
            onPressed: onResume,
            style: TextButton.styleFrom(
              foregroundColor: context.rhythm.accent,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('Resume', style: TextStyle(fontSize: 12)),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// ArchivedSessionRow
// ---------------------------------------------------------------------------

class ArchivedSessionRow extends StatelessWidget {
  const ArchivedSessionRow({
    super.key,
    required this.session,
    required this.onUnarchive,
  });

  final AgentSession session;
  final VoidCallback onUnarchive;

  Future<void> _confirmDelete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete session permanently?'),
        content: Text(
          'This permanently removes "${session.name}" and all of its messages. '
          'This cannot be undone.',
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
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (!context.mounted) return;
    await context.read<AgentsController>().deleteSession(session.id);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Row(
        children: [
          Icon(
            Icons.archive_outlined,
            size: 14,
            color: context.rhythm.textMuted,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              session.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w500,
                color: context.rhythm.textMuted,
              ),
            ),
          ),
          TextButton(
            onPressed: onUnarchive,
            style: TextButton.styleFrom(
              foregroundColor: context.rhythm.accent,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('Restore', style: TextStyle(fontSize: 12)),
          ),
          PopupMenuButton<String>(
            tooltip: 'More actions',
            icon: Icon(
              Icons.more_horiz,
              size: 15,
              color: context.rhythm.textMuted,
            ),
            padding: EdgeInsets.zero,
            iconSize: 15,
            splashRadius: 14,
            itemBuilder: (_) => [
              PopupMenuItem<String>(
                value: 'delete',
                child: Row(
                  children: [
                    Icon(
                      Icons.delete_outline,
                      size: 16,
                      color: Theme.of(context).colorScheme.error,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'Delete permanently',
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ],
                ),
              ),
            ],
            onSelected: (v) {
              if (v == 'delete') _confirmDelete(context);
            },
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// AgentKindBadge
// ---------------------------------------------------------------------------

/// Pill badge that resolves the agent identity from agentId / providerId /
/// modelId and renders an [AgentConfigBadge].
///
/// Uses [AgentConfigsController] and [AgentServerController] from the
/// Provider tree.
/// Icon-only agent identity for the compact session row — same resolution as
/// [AgentKindBadge] but renders just the icon (no label pill / "description").
class AgentKindIcon extends StatelessWidget {
  const AgentKindIcon({
    super.key,
    required this.agentId,
    this.providerId,
    this.modelId,
    this.size = 14,
  });

  final String agentId;
  final String? providerId;
  final String? modelId;
  final double size;

  @override
  Widget build(BuildContext context) {
    final configsCtrl = context.watch<AgentConfigsController>();
    final providerToAgentKind =
        context.watch<AgentServerController>().providerToAgentKind;

    final identity = resolveAgentBadgeIdentity(
      agentId: agentId,
      providerId: providerId,
      modelId: modelId,
      providerToAgentKind: providerToAgentKind,
      configById: configsCtrl.byId,
    );
    final config = identity.config;
    final color = identity.isRecognised
        ? context.rhythm.accent
        : context.rhythm.textMuted;

    if (config != null) {
      return AgentIcon(config.icon,
          size: size, fallbackLabel: config.displayLabel);
    }
    if (identity.materialIcon != null) {
      return Icon(identity.materialIcon, size: size, color: color);
    }
    return Icon(Icons.smart_toy_outlined, size: size, color: color);
  }
}

class AgentKindBadge extends StatelessWidget {
  const AgentKindBadge({
    super.key,
    required this.agentId,
    this.providerId,
    this.modelId,
  });

  final String agentId;
  final String? providerId;
  final String? modelId;

  @override
  Widget build(BuildContext context) {
    final configsCtrl = context.watch<AgentConfigsController>();
    final providerToAgentKind =
        context.watch<AgentServerController>().providerToAgentKind;

    final identity = resolveAgentBadgeIdentity(
      agentId: agentId,
      providerId: providerId,
      modelId: modelId,
      providerToAgentKind: providerToAgentKind,
      configById: configsCtrl.byId,
    );
    return AgentConfigBadge(identity: identity);
  }
}

// ---------------------------------------------------------------------------
// AgentConfigBadge
// ---------------------------------------------------------------------------

/// Renders an agent badge pill from a resolved [AgentBadgeIdentity]:
///   - config present → agent icon asset + config label (accent style)
///   - config null but [AgentBadgeIdentity.materialIcon] present → neutral
///     Material icon + label (accent style — e.g. the OpenRouter identity)
///   - neither → label only (muted — a truly-unknown / deleted agent)
class AgentConfigBadge extends StatelessWidget {
  const AgentConfigBadge({super.key, required this.identity});

  final AgentBadgeIdentity identity;

  @override
  Widget build(BuildContext context) {
    final config = identity.config;
    final badgeColor = identity.isRecognised
        ? context.rhythm.accent
        : context.rhythm.textMuted;
    final bgColor = badgeColor.withValues(alpha: 0.12);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (config != null) ...[
            AgentIcon(config.icon,
                size: 12, fallbackLabel: config.displayLabel),
            const SizedBox(width: 4),
          ] else if (identity.materialIcon != null) ...[
            Icon(identity.materialIcon, size: 12, color: badgeColor),
            const SizedBox(width: 4),
          ],
          Text(
            identity.label,
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: badgeColor,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// SessionStatusDot
// ---------------------------------------------------------------------------

class SessionStatusDot extends StatelessWidget {
  const SessionStatusDot({
    super.key,
    required this.status,
    required this.isWorking,
  });

  final AgentSessionStatus status;
  final bool isWorking;

  @override
  Widget build(BuildContext context) {
    if (isWorking) {
      return SizedBox(
        width: 10,
        height: 10,
        child: CircularProgressIndicator(
          strokeWidth: 2,
          color: context.rhythm.accent,
        ),
      );
    }
    final color = switch (status) {
      AgentSessionStatus.starting => context.rhythm.warning,
      AgentSessionStatus.working => context.rhythm.accent,
      AgentSessionStatus.idle => context.rhythm.success,
      AgentSessionStatus.resumable => context.rhythm.textMuted,
      AgentSessionStatus.closed => context.rhythm.borderSubtle,
      AgentSessionStatus.error => context.rhythm.danger,
    };
    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

// ---------------------------------------------------------------------------
// SessionRowMenu
// ---------------------------------------------------------------------------

class SessionRowMenu extends StatelessWidget {
  const SessionRowMenu({super.key, required this.session});

  final AgentSession session;

  Future<void> _confirmDelete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete session?'),
        content: Text(
          'This permanently removes "${session.name}" and all of its messages. '
          'This cannot be undone.',
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
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    if (!context.mounted) return;
    await context.read<AgentsController>().deleteSession(session.id);
  }

  /// #903 — rename a session in place. Pre-fills the current name (falling
  /// back to an empty field for an instant-create session with no name yet).
  Future<void> _rename(BuildContext context) async {
    final newName = await showDialog<String>(
      context: context,
      builder: (ctx) => _RenameSessionDialog(currentName: session.name),
    );
    if (newName == null || newName.isEmpty || newName == session.name) return;
    if (!context.mounted) return;
    await context
        .read<AgentsController>()
        .updateSession(session.id, name: newName);
  }

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      tooltip: 'Session actions',
      icon: Icon(
        Icons.more_horiz,
        size: 16,
        color: context.rhythm.textMuted,
      ),
      padding: EdgeInsets.zero,
      iconSize: 16,
      splashRadius: 16,
      itemBuilder: (_) => [
        PopupMenuItem<String>(
          value: 'rename',
          child: Row(
            children: [
              Icon(
                Icons.edit_outlined,
                size: 16,
                color: context.rhythm.textSecondary,
              ),
              const SizedBox(width: 8),
              const Text('Rename'),
            ],
          ),
        ),
        PopupMenuItem<String>(
          value: 'archive',
          child: Row(
            children: [
              Icon(
                Icons.archive_outlined,
                size: 16,
                color: context.rhythm.textSecondary,
              ),
              const SizedBox(width: 8),
              const Text('Archive'),
            ],
          ),
        ),
        PopupMenuItem<String>(
          value: 'delete',
          child: Row(
            children: [
              Icon(
                Icons.delete_outline,
                size: 16,
                color: Theme.of(context).colorScheme.error,
              ),
              const SizedBox(width: 8),
              Text(
                'Delete session',
                style: TextStyle(
                  color: Theme.of(context).colorScheme.error,
                ),
              ),
            ],
          ),
        ),
      ],
      onSelected: (v) {
        if (v == 'rename') {
          _rename(context);
        } else if (v == 'archive') {
          context.read<AgentsController>().archiveSession(session.id);
        } else if (v == 'delete') {
          _confirmDelete(context);
        }
      },
    );
  }
}

// ---------------------------------------------------------------------------
// #903 — Rename dialog
// ---------------------------------------------------------------------------

/// A StatefulWidget (not a bare inline builder) so its TextEditingController
/// is disposed by State.dispose() at the correct point in the dialog route's
/// lifecycle. Disposing it manually right after showDialog() returns races
/// the route's exit transition, which can still be rebuilding the bound
/// TextField — "A TextEditingController was used after being disposed."
class _RenameSessionDialog extends StatefulWidget {
  const _RenameSessionDialog({required this.currentName});

  final String currentName;

  @override
  State<_RenameSessionDialog> createState() => _RenameSessionDialogState();
}

class _RenameSessionDialogState extends State<_RenameSessionDialog> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.currentName);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Rename session'),
      content: TextField(
        key: const ValueKey('rename-session-field'),
        controller: _controller,
        autofocus: true,
        decoration: const InputDecoration(hintText: 'Session name'),
        onSubmitted: (v) => Navigator.of(context).pop(v.trim()),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_controller.text.trim()),
          child: const Text('Save'),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Private helpers (used only within this file)
// ---------------------------------------------------------------------------

class _CreatingSessionRow extends StatelessWidget {
  const _CreatingSessionRow();

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 160),
      curve: Curves.easeOut,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: context.rhythm.accentMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(
          color: context.rhythm.accent.withValues(alpha: 0.28),
        ),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: context.rhythm.accent,
            ),
          ),
          const SizedBox(width: 10),
          Text(
            'Starting session…',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: context.rhythm.accent,
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyChatsState extends StatelessWidget {
  const _EmptyChatsState({required this.hasQuery});

  final bool hasQuery;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              hasQuery ? Icons.search_off_rounded : Icons.smart_toy_outlined,
              size: 28,
              color: context.rhythm.textMuted,
            ),
            const SizedBox(height: 8),
            Text(
              hasQuery ? 'No matching sessions' : 'No sessions yet',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textPrimary,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              hasQuery ? 'Try a different query.' : 'Tap + New to start one.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 11,
                color: context.rhythm.textMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
