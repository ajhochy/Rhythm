import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../agents/data/opencode_skills_data_source.dart';
import '../../agents/views/_managed_skill_editor_sheet.dart';
import '../controllers/agent_skills_controller.dart';

/// Standalone Skills menu (Agents → Tools → Skills).
///
/// #796 (skill-unify2, subsumes #779): one unified list of EVERY engine skill —
/// handwritten, imported, external, and Rhythm-managed — read from the unified
/// endpoint `GET /opencode/skills?withMetadata=true` (#793) via
/// [AgentSkillsController]. Each row shows a managed/external badge plus the
/// auto-apply lifecycle + score metadata when present.
///
/// Actions are gated by provenance:
///   - Managed skills: edit (reuse the managed-skill editor sheet) + delete,
///     plus a top-level "New skill" create button.
///   - External / handwritten skills: read-only — no edit/delete. The
///     self-improvement loop improves them automatically (forking an external
///     skill to a managed shadow); there is no manual proposal/approve action.
class AgentSkillsView extends StatefulWidget {
  const AgentSkillsView({super.key});

  @override
  State<AgentSkillsView> createState() => _AgentSkillsViewState();
}

class _AgentSkillsViewState extends State<AgentSkillsView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AgentSkillsController>().loadSkills();
    });
  }

  Future<void> _onCreateSkill(
    BuildContext context,
    AgentSkillsController controller,
  ) async {
    final created = await showManagedSkillEditorSheet(
      context,
      dataSource: controller.dataSource,
      existingNames: controller.skillNames,
    );
    if (created == null || !context.mounted) return;
    await controller.loadSkills();
  }

  Future<void> _onEditSkill(
    BuildContext context,
    AgentSkillsController controller,
    OpencodeSkillEntry skill,
  ) async {
    final updated = await showManagedSkillEditorSheet(
      context,
      dataSource: controller.dataSource,
      existingNames: controller.skillNames,
      skill: skill,
    );
    if (updated == null || !context.mounted) return;
    await controller.loadSkills();
  }

  Future<void> _confirmDelete(
    BuildContext context,
    AgentSkillsController controller,
    OpencodeSkillEntry skill,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: ctx.rhythm.surface,
        title: Text(
          'Delete Skill',
          style: TextStyle(color: ctx.rhythm.textPrimary),
        ),
        content: Text(
          'Delete "${skill.name}"? This removes the Rhythm-managed skill from '
          'the engine and cannot be undone.',
          style: TextStyle(color: ctx.rhythm.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(
              'Cancel',
              style: TextStyle(color: ctx.rhythm.textMuted),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text('Delete', style: TextStyle(color: ctx.rhythm.danger)),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    final ok = await controller.deleteSkill(skill.name);
    if (!context.mounted || ok) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Error: ${controller.error ?? 'Unknown error'}'),
        backgroundColor: context.rhythm.danger,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AgentSkillsController>(
      builder: (context, controller, _) {
        return Scaffold(
          backgroundColor: context.rhythm.canvas,
          appBar: AppBar(
            backgroundColor: context.rhythm.surface,
            elevation: 0,
            title: Text(
              'Skills',
              style: TextStyle(
                color: context.rhythm.textPrimary,
                fontWeight: FontWeight.w600,
                fontSize: 18,
              ),
            ),
            actions: [
              TextButton.icon(
                key: const ValueKey('new-skill-button'),
                style: TextButton.styleFrom(
                  foregroundColor: context.rhythm.accent,
                ),
                icon: const Icon(Icons.add, size: 18),
                label: const Text('New skill'),
                onPressed: () => _onCreateSkill(context, controller),
              ),
              if (controller.status == AgentSkillsStatus.idle)
                IconButton(
                  icon: Icon(
                    Icons.refresh_rounded,
                    color: context.rhythm.textSecondary,
                  ),
                  tooltip: 'Refresh',
                  onPressed: () => controller.loadSkills(),
                ),
            ],
          ),
          body: _buildBody(context, controller),
        );
      },
    );
  }

  Widget _buildBody(BuildContext context, AgentSkillsController controller) {
    if (controller.status == AgentSkillsStatus.loading &&
        controller.skills.isEmpty) {
      return Center(
        child: CircularProgressIndicator(color: context.rhythm.accent),
      );
    }

    if (controller.status == AgentSkillsStatus.error &&
        controller.skills.isEmpty) {
      return Center(
        key: const ValueKey('skills-error-state'),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.error_outline_rounded,
              color: context.rhythm.danger,
              size: 48,
            ),
            const SizedBox(height: RhythmSpacing.md),
            Text(
              controller.error ?? 'An error occurred',
              style: TextStyle(color: context.rhythm.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: RhythmSpacing.md),
            FilledButton(
              onPressed: () => controller.loadSkills(),
              style: FilledButton.styleFrom(
                backgroundColor: context.rhythm.accent,
              ),
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (controller.skills.isEmpty) {
      return Center(
        key: const ValueKey('skills-empty-state'),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.auto_awesome_outlined,
              color: context.rhythm.textMuted,
              size: 56,
            ),
            const SizedBox(height: RhythmSpacing.md),
            Text(
              'No skills yet',
              style: TextStyle(
                color: context.rhythm.textSecondary,
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: RhythmSpacing.xs),
            Text(
              'Engine skills appear here. Add a managed skill with "New skill".',
              style: TextStyle(color: context.rhythm.textMuted, fontSize: 13),
            ),
          ],
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(RhythmSpacing.md),
      itemCount: controller.skills.length,
      separatorBuilder: (_, __) => const SizedBox(height: RhythmSpacing.xs),
      itemBuilder: (context, index) {
        final skill = controller.skills[index];
        return _SkillTile(
          skill: skill,
          onEdit: skill.managed
              ? () => _onEditSkill(context, controller, skill)
              : null,
          onDelete: skill.managed
              ? () => _confirmDelete(context, controller, skill)
              : null,
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Skill tile
// ---------------------------------------------------------------------------

class _SkillTile extends StatelessWidget {
  const _SkillTile({required this.skill, this.onEdit, this.onDelete});

  final OpencodeSkillEntry skill;

  /// Non-null only for managed skills (external/handwritten are read-only).
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final meta = skill.metadata;
    final snippet = skill.description;

    return Container(
      key: ValueKey('skill-tile-${skill.name}'),
      decoration: BoxDecoration(
        color: rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: rhythm.borderSubtle),
        boxShadow: RhythmElevation.panel,
      ),
      padding: const EdgeInsets.all(RhythmSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.auto_awesome_outlined, color: rhythm.accent, size: 20),
          const SizedBox(width: RhythmSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Name + managed/external badge + status badge.
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        skill.name,
                        style: TextStyle(
                          color: rhythm.textPrimary,
                          fontWeight: FontWeight.w600,
                          fontSize: 14,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 6),
                    _ProvenanceBadge(skill: skill),
                    if (meta?.status != null && meta!.status != 'active') ...[
                      const SizedBox(width: 6),
                      _StatusBadge(status: meta.status!),
                    ],
                  ],
                ),
                if (snippet != null && snippet.isNotEmpty) ...[
                  const SizedBox(height: RhythmSpacing.xxs),
                  Text(
                    snippet,
                    style: TextStyle(color: rhythm.textSecondary, fontSize: 12),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
                if (meta != null) ...[
                  const SizedBox(height: RhythmSpacing.xxs),
                  _MetaLine(meta: meta),
                  if (meta.hasScores) ...[
                    const SizedBox(height: RhythmSpacing.xxs),
                    _ScoreLine(meta: meta),
                  ],
                  if (meta.isExternalFork) ...[
                    const SizedBox(height: RhythmSpacing.xxs),
                    Text(
                      '⭐ auto-improved (forked from an external skill)',
                      style: TextStyle(
                        color: rhythm.warning,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ],
              ],
            ),
          ),
          // Managed skills: edit + delete. External/handwritten: read-only.
          if (onEdit != null)
            IconButton(
              key: ValueKey('edit-skill-${skill.name}'),
              icon: Icon(
                Icons.edit_outlined,
                color: rhythm.textSecondary,
                size: 19,
              ),
              tooltip: 'Edit',
              onPressed: onEdit,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
            ),
          if (onDelete != null)
            IconButton(
              key: ValueKey('delete-skill-${skill.name}'),
              icon: Icon(
                Icons.delete_outline_rounded,
                color: rhythm.textMuted,
                size: 18,
              ),
              tooltip: 'Delete',
              onPressed: onDelete,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
            ),
          if (onEdit == null && onDelete == null)
            Padding(
              key: ValueKey('readonly-skill-${skill.name}'),
              padding: const EdgeInsets.only(left: RhythmSpacing.xs),
              child: Icon(
                Icons.lock_outline_rounded,
                color: rhythm.textMuted,
                size: 16,
              ),
            ),
        ],
      ),
    );
  }
}

/// `MANAGED` (accent) or `EXTERNAL` (muted) pill rendered next to a skill name.
class _ProvenanceBadge extends StatelessWidget {
  const _ProvenanceBadge({required this.skill});

  final OpencodeSkillEntry skill;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final managed = skill.managed;
    final color = managed ? rhythm.accent : rhythm.textMuted;
    return Container(
      key: ValueKey(
        managed
            ? 'badge-managed-${skill.name}'
            : 'badge-external-${skill.name}',
      ),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(RhythmRadius.xs),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Text(
        managed ? 'MANAGED' : 'EXTERNAL',
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.6,
          color: color,
        ),
      ),
    );
  }
}

/// Lifecycle status pill — only rendered for non-`active` statuses
/// (`measuring` amber, `reverted` red).
class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final color = status == 'reverted' ? rhythm.danger : rhythm.warning;
    return Container(
      key: ValueKey('status-badge-$status'),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(RhythmRadius.xs),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Text(
        status.toUpperCase(),
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.6,
          color: color,
        ),
      ),
    );
  }
}

/// Source + confidence + version meta line (only when metadata is present).
class _MetaLine extends StatelessWidget {
  const _MetaLine({required this.meta});

  final OpencodeSkillMetadata meta;

  @override
  Widget build(BuildContext context) {
    final parts = <String>[
      meta.source ?? 'engine',
      if (meta.confidence != null)
        'confidence ${meta.confidence!.toStringAsFixed(2)}',
      'v${meta.version}',
      if (meta.uses != null) '${meta.uses} uses',
    ];
    return Text(
      parts.join(' · '),
      style: TextStyle(color: context.rhythm.textMuted, fontSize: 11),
    );
  }
}

/// Baseline → post score line, shown once a measured change has both scores.
class _ScoreLine extends StatelessWidget {
  const _ScoreLine({required this.meta});

  final OpencodeSkillMetadata meta;

  @override
  Widget build(BuildContext context) {
    return Text(
      'score ${meta.baselineScore!.toStringAsFixed(2)} → '
      '${meta.postScore!.toStringAsFixed(2)}',
      style: TextStyle(color: context.rhythm.textMuted, fontSize: 11),
    );
  }
}
