import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../agent_configs/controllers/agent_configs_controller.dart';
import '../controllers/agent_playbooks_controller.dart';
import '../data/agent_playbooks_data_source.dart';
import '_playbook_editor_sheet.dart';

/// Standalone Playbooks manager (Agents → Tools → Playbooks, #1051 / OCU-10).
///
/// Custom slash-commands ("Playbooks") — saved, parameterized prompts staff
/// run from the slash popover. Mirrors AgentSkillsView's original list
/// pattern: name, description, source badge, managed rows get edit/delete;
/// built-ins (and MCP/skill-sourced commands) are read-only.
class AgentPlaybooksView extends StatefulWidget {
  const AgentPlaybooksView({super.key});

  @override
  State<AgentPlaybooksView> createState() => _AgentPlaybooksViewState();
}

class _AgentPlaybooksViewState extends State<AgentPlaybooksView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AgentPlaybooksController>().loadPlaybooks();
    });
  }

  Future<void> _onCreate(
    BuildContext context,
    AgentPlaybooksController controller,
  ) async {
    final created = await showPlaybookEditorSheet(
      context,
      dataSource: controller.dataSource,
      existingNames: controller.playbookNames,
      availableAgents: context
          .read<AgentConfigsController>()
          .sessionSelectableAgents,
    );
    if (created != true || !context.mounted) return;
    await controller.loadPlaybooks();
  }

  Future<void> _onEdit(
    BuildContext context,
    AgentPlaybooksController controller,
    PlaybookEntry playbook,
  ) async {
    final updated = await showPlaybookEditorSheet(
      context,
      dataSource: controller.dataSource,
      existingNames: controller.playbookNames,
      availableAgents: context
          .read<AgentConfigsController>()
          .sessionSelectableAgents,
      playbook: playbook,
    );
    if (updated != true || !context.mounted) return;
    await controller.loadPlaybooks();
  }

  Future<void> _confirmDelete(
    BuildContext context,
    AgentPlaybooksController controller,
    PlaybookEntry playbook,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: ctx.rhythm.surface,
        title: Text(
          'Delete Playbook',
          style: TextStyle(color: ctx.rhythm.textPrimary),
        ),
        content: Text(
          'Delete "${playbook.name}"? This removes the Rhythm-managed '
          'playbook from the engine and cannot be undone.',
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
    final ok = await controller.deletePlaybook(playbook.name);
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
    return Consumer<AgentPlaybooksController>(
      builder: (context, controller, _) {
        return Scaffold(
          backgroundColor: context.rhythm.canvas,
          appBar: AppBar(
            backgroundColor: context.rhythm.surface,
            elevation: 0,
            title: Text(
              'Playbooks',
              style: TextStyle(
                color: context.rhythm.textPrimary,
                fontWeight: FontWeight.w600,
                fontSize: 18,
              ),
            ),
            actions: [
              TextButton.icon(
                key: const ValueKey('new-playbook-button'),
                style: TextButton.styleFrom(
                  foregroundColor: context.rhythm.accent,
                ),
                icon: const Icon(Icons.add, size: 18),
                label: const Text('New playbook'),
                onPressed: () => _onCreate(context, controller),
              ),
              if (controller.status == AgentPlaybooksStatus.idle)
                IconButton(
                  icon: Icon(
                    Icons.refresh_rounded,
                    color: context.rhythm.textSecondary,
                  ),
                  tooltip: 'Refresh',
                  onPressed: () => controller.loadPlaybooks(),
                ),
            ],
          ),
          body: _buildBody(context, controller),
        );
      },
    );
  }

  Widget _buildBody(BuildContext context, AgentPlaybooksController controller) {
    if (controller.status == AgentPlaybooksStatus.loading &&
        controller.playbooks.isEmpty) {
      return Center(
        child: CircularProgressIndicator(color: context.rhythm.accent),
      );
    }

    if (controller.status == AgentPlaybooksStatus.error &&
        controller.playbooks.isEmpty) {
      return Center(
        key: const ValueKey('playbooks-error-state'),
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
              onPressed: () => controller.loadPlaybooks(),
              style: FilledButton.styleFrom(
                backgroundColor: context.rhythm.accent,
              ),
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (controller.playbooks.isEmpty) {
      return Center(
        key: const ValueKey('playbooks-empty-state'),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.bolt_outlined,
              color: context.rhythm.textMuted,
              size: 56,
            ),
            const SizedBox(height: RhythmSpacing.md),
            Text(
              'No playbooks yet',
              style: TextStyle(
                color: context.rhythm.textSecondary,
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: RhythmSpacing.xs),
            Text(
              'Slash commands appear here. Add one with "New playbook".',
              style: TextStyle(color: context.rhythm.textMuted, fontSize: 13),
            ),
          ],
        ),
      );
    }

    final sorted = [...controller.playbooks]
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(
        RhythmSpacing.md,
        RhythmSpacing.sm,
        RhythmSpacing.md,
        RhythmSpacing.md,
      ),
      itemCount: sorted.length,
      separatorBuilder: (_, __) => const SizedBox(height: RhythmSpacing.xs),
      itemBuilder: (context, index) {
        final playbook = sorted[index];
        return _PlaybookRow(
          playbook: playbook,
          onEdit: playbook.managed
              ? () => _onEdit(context, controller, playbook)
              : null,
          onDelete: playbook.managed
              ? () => _confirmDelete(context, controller, playbook)
              : null,
        );
      },
    );
  }
}

class _PlaybookRow extends StatelessWidget {
  const _PlaybookRow({required this.playbook, this.onEdit, this.onDelete});

  final PlaybookEntry playbook;

  /// Non-null only for managed playbooks (built-in/MCP/skill are read-only).
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final desc = playbook.description;
    return Container(
      key: ValueKey('playbook-tile-${playbook.name}'),
      padding: const EdgeInsets.symmetric(
        horizontal: RhythmSpacing.sm,
        vertical: RhythmSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: rhythm.borderSubtle),
        boxShadow: RhythmElevation.panel,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            flex: 3,
            child: Row(
              children: [
                Flexible(
                  child: Text(
                    '/${playbook.name}',
                    style: TextStyle(
                      color: rhythm.textPrimary,
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 6),
                _SourceBadge(playbook: playbook),
                if (!playbook.managed) ...[
                  const SizedBox(width: 6),
                  Icon(
                    Icons.lock_outline_rounded,
                    key: ValueKey('readonly-playbook-${playbook.name}'),
                    color: rhythm.textMuted,
                    size: 14,
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: RhythmSpacing.sm),
          Expanded(
            flex: 5,
            child: Text(
              (desc != null && desc.isNotEmpty) ? desc : '—',
              style: TextStyle(
                color: (desc != null && desc.isNotEmpty)
                    ? rhythm.textSecondary
                    : rhythm.textMuted,
                fontSize: 12,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (onEdit != null)
            IconButton(
              key: ValueKey('edit-playbook-${playbook.name}'),
              icon: Icon(
                Icons.edit_outlined,
                color: rhythm.textSecondary,
                size: 18,
              ),
              tooltip: 'Edit',
              onPressed: onEdit,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
            ),
          if (onDelete != null)
            IconButton(
              key: ValueKey('delete-playbook-${playbook.name}'),
              icon: Icon(
                Icons.delete_outline_rounded,
                color: rhythm.textMuted,
                size: 18,
              ),
              tooltip: 'Delete',
              onPressed: onDelete,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
            ),
        ],
      ),
    );
  }
}

/// `MANAGED` (accent) for Rhythm-authored playbooks, otherwise the engine's
/// reported source uppercased (e.g. `MCP`, `SKILL`, `COMMAND` for built-ins).
class _SourceBadge extends StatelessWidget {
  const _SourceBadge({required this.playbook});

  final PlaybookEntry playbook;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final label = playbook.managed ? 'MANAGED' : playbook.source.toUpperCase();
    final color = playbook.managed ? rhythm.accent : rhythm.textMuted;
    return Container(
      key: ValueKey('badge-${playbook.source}-${playbook.name}'),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(RhythmRadius.xs),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Text(
        label,
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
