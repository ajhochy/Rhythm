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

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();

    if (controller.status == AgentsLoadStatus.loading &&
        filteredSessions.isEmpty) {
      return Center(
        child: CircularProgressIndicator(color: context.rhythm.accent),
      );
    }

    if (filteredSessions.isEmpty &&
        controller.resumable.isEmpty &&
        !controller.isCreating) {
      return _EmptyChatsState(hasQuery: searchQuery.isNotEmpty);
    }

    return ListView(
      padding: listPadding,
      children: [
        if (controller.isCreating) ...[
          const _CreatingSessionRow(),
          const SizedBox(height: 6),
        ],
        // ── Active sessions ────────────────────────────────────────────────
        for (final session in filteredSessions) ...[
          SessionRow(
            session: session,
            isSelected: controller.selectedSessionId == session.id,
            isMultiSelected: multiSelected.contains(session.id),
            isWorking: controller.isWorking(session.id),
            isStuck: controller.connectivity.isStuck(session.id),
            onTap: () => onRowTap(session.id),
          ),
          const SizedBox(height: 6),
        ],

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
        padding: const EdgeInsets.all(12),
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
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                AgentKindBadge(
                  agentId: session.agentId,
                  providerId: session.providerId,
                  modelId: session.modelId,
                ),
                const Spacer(),
                SessionStatusDot(
                  status: session.status,
                  isWorking: isWorking,
                ),
                const SizedBox(width: 4),
                SessionRowMenu(session: session),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              session.name.isNotEmpty ? session.name : 'New session',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w700,
                color: session.name.isNotEmpty
                    ? context.rhythm.textPrimary
                    : context.rhythm.textMuted,
              ),
            ),
            if (session.lastPreview != null &&
                session.lastPreview!.isNotEmpty) ...[
              const SizedBox(height: 3),
              Text(
                session.lastPreview!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11,
                  color: context.rhythm.textMuted,
                  fontFamily: 'Menlo',
                ),
              ),
            ],
            if (isStuck)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  'No output yet — the agent may be stuck',
                  style: TextStyle(
                    fontSize: 10,
                    color: context.rhythm.warning,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ),
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
            AgentIcon(config.icon, size: 12, fallbackLabel: config.label),
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
        if (v == 'archive') {
          context.read<AgentsController>().archiveSession(session.id);
        } else if (v == 'delete') {
          _confirmDelete(context);
        }
      },
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
