import 'package:flutter/material.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../agent_projects/models/agent_project.dart';

/// Rounded chip showing the selected project's git branch + a dirty-state
/// dot. Hidden when the project is not a git repo.
///
/// Tap fires [onRefresh] (typically `controller.refreshVcs(project.id)`).
class ProjectVcsChip extends StatelessWidget {
  const ProjectVcsChip({
    super.key,
    required this.project,
    this.onRefresh,
  });

  final AgentProject project;
  final VoidCallback? onRefresh;

  @override
  Widget build(BuildContext context) {
    if (project.vcsRoot == null) return const SizedBox.shrink();

    final branch = project.vcsBranch ?? '(detached)';
    final tooltipLines = <String>[
      'Branch: ${project.vcsBranch ?? '(detached)'}',
      'Root: ${project.vcsRoot}',
      if (project.vcsCheckedAt != null)
        'Last checked: ${_relative(project.vcsCheckedAt!)}',
    ];

    return Tooltip(
      message: tooltipLines.join('\n'),
      child: InkWell(
        borderRadius: BorderRadius.circular(999),
        onTap: onRefresh,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: context.rhythm.surfaceRaised,
            border: Border.all(color: context.rhythm.border),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.call_split_rounded,
                size: 12,
                color: context.rhythm.textMuted,
              ),
              const SizedBox(width: 4),
              Text(
                branch,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: context.rhythm.textPrimary,
                ),
              ),
              const SizedBox(width: 6),
              _DirtyDot(dirty: project.vcsDirty),
            ],
          ),
        ),
      ),
    );
  }

  static String _relative(DateTime at) {
    final diff = DateTime.now().difference(at);
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inHours < 1) return '${diff.inMinutes}m ago';
    if (diff.inDays < 1) return '${diff.inHours}h ago';
    return '${diff.inDays}d ago';
  }
}

class _DirtyDot extends StatelessWidget {
  const _DirtyDot({required this.dirty});
  final bool dirty;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: dirty ? const Color(0xFFEF4444) : Colors.transparent,
        border: Border.all(
          color: dirty ? const Color(0xFFEF4444) : context.rhythm.textMuted,
          width: 1.5,
        ),
      ),
    );
  }
}
