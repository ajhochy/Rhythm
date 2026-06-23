import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../agent_configs/controllers/agent_configs_controller.dart';
import '../../agent_configs/models/agent_config.dart';
import '../../agent_projects/controllers/agent_projects_controller.dart';
import '../../agent_projects/models/agent_project.dart';
import '../../agent_projects/views/edit_project_dialog.dart';
import '_agent_profile_sheet.dart';

/// 64px sidebar rail listing agent projects.
///
/// Layout: ⭐ All-sessions pseudo-project, divider, one icon per project,
/// `+` button at the bottom. Selected entry uses the primary-tint background
/// from theme tokens.
class ProjectsRail extends StatefulWidget {
  const ProjectsRail({super.key, this.onAddProject});

  /// Called when the user taps the `+` button.
  final VoidCallback? onAddProject;

  static const double railWidth = 64;

  @override
  State<ProjectsRail> createState() => _ProjectsRailState();
}

class _ProjectsRailState extends State<ProjectsRail> {
  @override
  void initState() {
    super.initState();
    // Fetch existing projects from the server on first paint so the rail
    // reflects what is persisted, not just whatever the user creates this
    // session.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<AgentProjectsController>().load();
    });
  }

  static const double railWidth = ProjectsRail.railWidth;

  @override
  Widget build(BuildContext context) {
    final onAddProject = widget.onAddProject;
    final controller = context.watch<AgentProjectsController>();
    final selectedId = controller.selectedProjectId;

    return Container(
      width: railWidth,
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
        border: Border.all(color: context.rhythm.border),
        boxShadow: RhythmElevation.panel,
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Column(
          children: [
            _RailItem(
              tooltip: 'All sessions',
              selected: selectedId == null,
              onTap: () => controller.select(null),
              child: const Icon(Icons.star_rounded, size: 22),
            ),
            const SizedBox(height: 6),
            Divider(
              color: context.rhythm.borderSubtle,
              indent: 12,
              endIndent: 12,
              height: 8,
            ),
            const SizedBox(height: 6),
            Expanded(
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(vertical: 2),
                itemCount: controller.projects.length,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (ctx, i) {
                  final p = controller.projects[i];
                  return GestureDetector(
                    onLongPress: () => showEditProjectDialog(ctx, existing: p),
                    onSecondaryTap: () =>
                        showEditProjectDialog(ctx, existing: p),
                    child: _RailItem(
                      tooltip: p.name,
                      selected: p.id == selectedId,
                      onTap: () => controller.select(p.id),
                      child: _ProjectIcon(project: p),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 6),
            Divider(
              color: context.rhythm.borderSubtle,
              indent: 12,
              endIndent: 12,
              height: 8,
            ),
            const SizedBox(height: 6),
            _RailItem(
              tooltip: 'New project',
              selected: false,
              onTap: onAddProject,
              child: Icon(
                Icons.add_rounded,
                size: 22,
                color: context.rhythm.textMuted,
              ),
            ),
            const SizedBox(height: 6),
            Divider(
              color: context.rhythm.borderSubtle,
              indent: 12,
              endIndent: 12,
              height: 8,
            ),
            const SizedBox(height: 6),
            // Agent Profiles section
            const _ProfilesSection(),
          ],
        ),
      ),
    );
  }
}

/// Profiles section shown at the bottom of the rail.
/// Displays enabled agent configs (isAgent=true) as small icon buttons.
/// Manager profiles get a crown badge. Tap to open profile sheet to edit.
/// The "+" button creates a new profile.
class _ProfilesSection extends StatelessWidget {
  const _ProfilesSection();

  @override
  Widget build(BuildContext context) {
    final configsController = context.watch<AgentConfigsController>();
    final profiles = configsController.configs.where((c) => c.isAgent).toList()
      ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final profile in profiles) ...[
          GestureDetector(
            onLongPress: () => showAgentProfileSheet(context, config: profile),
            onSecondaryTap: () =>
                showAgentProfileSheet(context, config: profile),
            child: _ProfileRailItem(profile: profile),
          ),
          const SizedBox(height: 8),
        ],
        _RailItem(
          tooltip: 'New agent profile',
          selected: false,
          onTap: () => showAgentProfileSheet(context),
          child: Icon(
            Icons.person_add_outlined,
            size: 20,
            color: context.rhythm.textMuted,
          ),
        ),
        const SizedBox(height: 6),
      ],
    );
  }
}

class _ProfileRailItem extends StatelessWidget {
  const _ProfileRailItem({required this.profile});

  final AgentConfig profile;

  @override
  Widget build(BuildContext context) {
    final initial =
        profile.label.isNotEmpty ? profile.label[0].toUpperCase() : '?';
    return Tooltip(
      message: '${profile.label}${profile.isManager ? ' (Manager)' : ''}',
      child: Center(
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            SizedBox(
              width: 40,
              height: 40,
              child: Material(
                color: profile.isManager
                    ? context.rhythm.accentMuted
                    : context.rhythm.surfaceMuted,
                borderRadius: BorderRadius.circular(10),
                child: InkWell(
                  borderRadius: BorderRadius.circular(10),
                  onTap: () => showAgentProfileSheet(context, config: profile),
                  child: Center(
                    child: Text(
                      initial,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: profile.isManager
                            ? context.rhythm.accent
                            : context.rhythm.textSecondary,
                      ),
                    ),
                  ),
                ),
              ),
            ),
            if (profile.isManager)
              Positioned(
                top: -4,
                right: -4,
                child: Container(
                  width: 14,
                  height: 14,
                  decoration: BoxDecoration(
                    color: context.rhythm.accent,
                    shape: BoxShape.circle,
                  ),
                  child: const Center(
                    child: Text(
                      '★',
                      style: TextStyle(
                        fontSize: 8,
                        color: Colors.white,
                        height: 1,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _RailItem extends StatelessWidget {
  const _RailItem({
    required this.tooltip,
    required this.selected,
    required this.onTap,
    required this.child,
  });

  final String tooltip;
  final bool selected;
  final VoidCallback? onTap;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    const selectedBg = Color(0x144F6AF5);
    final button = SizedBox(
      width: 40,
      height: 40,
      child: Material(
        color: selected ? selectedBg : Colors.transparent,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: onTap,
          child: Center(child: child),
        ),
      ),
    );
    return Tooltip(message: tooltip, child: Center(child: button));
  }
}

class _ProjectIcon extends StatelessWidget {
  const _ProjectIcon({required this.project});

  final AgentProject project;

  @override
  Widget build(BuildContext context) {
    final icon = project.icon;
    if (icon != null && icon.startsWith('#') && icon.length == 7) {
      final color = _tryParseHex(icon);
      if (color != null) {
        return CircleAvatar(radius: 12, backgroundColor: color);
      }
    }
    if (icon != null && icon.trim().isNotEmpty) {
      return Text(icon, style: const TextStyle(fontSize: 18));
    }
    // Default fallback — folder glyph.
    return const Text('📁', style: TextStyle(fontSize: 18));
  }

  static Color? _tryParseHex(String hex) {
    final v = int.tryParse(hex.substring(1), radix: 16);
    if (v == null) return null;
    return Color(0xFF000000 | v);
  }
}
