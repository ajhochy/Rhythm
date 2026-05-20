import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../agent_projects/controllers/agent_projects_controller.dart';
import '../../agent_projects/models/agent_project.dart';
import '../../agent_projects/models/project_branches.dart';

/// Rounded chip showing the selected project's git branch + a dirty-state
/// dot. Hidden when the project is not a git repo.
///
/// Tap opens a branch-switcher popover (issue #607). The popover fetches
/// branches lazily on first open.
class ProjectVcsChip extends StatefulWidget {
  const ProjectVcsChip({
    super.key,
    required this.project,
    this.onRefresh,
  });

  final AgentProject project;

  /// Called when the user closes the popover without switching; also used as a
  /// refresh fallback for callers that relied on the old tap behaviour.
  final VoidCallback? onRefresh;

  @override
  State<ProjectVcsChip> createState() => _ProjectVcsChipState();
}

class _ProjectVcsChipState extends State<ProjectVcsChip> {
  OverlayEntry? _overlay;
  final _chipKey = GlobalKey();

  ProjectBranches? _branches;
  bool _loadingBranches = false;
  bool _newBranchMode = false;
  final _newBranchController = TextEditingController();

  bool _isSwitching = false;
  String? _switchError;

  @override
  void dispose() {
    _closePopover();
    _newBranchController.dispose();
    super.dispose();
  }

  void _closePopover() {
    _overlay?.remove();
    _overlay = null;
  }

  Future<void> _openPopover() async {
    if (_overlay != null) {
      _closePopover();
      return;
    }

    // Load branches if not yet loaded.
    if (_branches == null && !_loadingBranches) {
      setState(() => _loadingBranches = true);
      try {
        final b = await context
            .read<AgentProjectsController>()
            .listBranches(widget.project.id);
        if (mounted) {
          setState(() {
            _branches = b;
            _loadingBranches = false;
          });
        }
      } catch (_) {
        if (mounted) setState(() => _loadingBranches = false);
      }
    }

    if (!mounted) return;

    // Anchor the popover below the chip.
    final box = _chipKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null) return;
    final offset = box.localToGlobal(Offset.zero);
    final chipSize = box.size;

    final overlay = Overlay.of(context);
    _overlay = OverlayEntry(
      builder: (ctx) => _BranchPopover(
        anchorOffset: offset,
        anchorSize: chipSize,
        project: widget.project,
        branches: _branches,
        loadingBranches: _loadingBranches,
        newBranchMode: _newBranchMode,
        newBranchController: _newBranchController,
        isSwitching: _isSwitching,
        switchError: _switchError,
        onEnterNewBranch: () => setState(() => _newBranchMode = true),
        onCancelNewBranch: () => setState(() {
          _newBranchMode = false;
          _newBranchController.clear();
        }),
        onSelectBranch: (branch) =>
            _onSelectBranch(branch, createBranch: false),
        onCreateBranch: () => _onSelectBranch(_newBranchController.text.trim(),
            createBranch: true),
        onDismiss: () {
          _closePopover();
          setState(() {
            _newBranchMode = false;
            _newBranchController.clear();
            _switchError = null;
          });
        },
      ),
    );
    overlay.insert(_overlay!);
    // Force popover to rebuild if loading state changes.
    setState(() {});
  }

  Future<void> _onSelectBranch(String branch,
      {required bool createBranch}) async {
    if (branch.isEmpty) return;

    // Warn if any session on this project is currently working.
    // (We don't have session state here so we skip that guard — see design note.)

    final project = widget.project;

    // If dirty and switching, ask the user what to do.
    String stashMode = 'none';
    if (project.vcsDirty &&
        branch != (project.vcsBranch ?? '') &&
        !createBranch) {
      final choice = await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Working tree has uncommitted changes'),
          content: const Text(
            'The working directory has unsaved changes. '
            'What should happen to them before switching branches?',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(null),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop('stash'),
              child: const Text('Stash'),
            ),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop('discard'),
              style: TextButton.styleFrom(
                foregroundColor: Theme.of(ctx).colorScheme.error,
              ),
              child: const Text('Discard'),
            ),
          ],
        ),
      );
      if (choice == null) return;
      stashMode = choice;
    }

    _closePopover();
    if (!mounted) return;
    setState(() {
      _isSwitching = true;
      _switchError = null;
      _newBranchMode = false;
      _newBranchController.clear();
    });

    try {
      await context.read<AgentProjectsController>().checkoutBranch(
            project.id,
            branch: branch,
            stash: stashMode,
            createBranch: createBranch,
          );
      if (mounted) {
        setState(() {
          _isSwitching = false;
          _branches = null; // reset so popover reloads next time
        });
      }
    } catch (e) {
      if (mounted) {
        final msg = e.toString().replaceFirst('Exception: ', '');
        setState(() {
          _isSwitching = false;
          _switchError = msg;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(msg),
            backgroundColor: Theme.of(context).colorScheme.error,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.project.vcsRoot == null) return const SizedBox.shrink();

    final branch = widget.project.vcsBranch ?? '(detached)';
    final tooltipLines = <String>[
      'Branch: ${widget.project.vcsBranch ?? '(detached)'}',
      'Root: ${widget.project.vcsRoot}',
      if (widget.project.vcsCheckedAt != null)
        'Last checked: ${_relative(widget.project.vcsCheckedAt!)}',
    ];

    return Tooltip(
      message: tooltipLines.join('\n'),
      child: InkWell(
        key: _chipKey,
        borderRadius: BorderRadius.circular(999),
        onTap: _isSwitching ? null : _openPopover,
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
              if (_isSwitching)
                SizedBox(
                  width: 10,
                  height: 10,
                  child: CircularProgressIndicator(
                    strokeWidth: 1.5,
                    color: context.rhythm.accent,
                  ),
                )
              else
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
              _DirtyDot(dirty: widget.project.vcsDirty),
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

// ---------------------------------------------------------------------------
// Branch popover overlay
// ---------------------------------------------------------------------------

class _BranchPopover extends StatefulWidget {
  const _BranchPopover({
    required this.anchorOffset,
    required this.anchorSize,
    required this.project,
    required this.branches,
    required this.loadingBranches,
    required this.newBranchMode,
    required this.newBranchController,
    required this.isSwitching,
    required this.switchError,
    required this.onEnterNewBranch,
    required this.onCancelNewBranch,
    required this.onSelectBranch,
    required this.onCreateBranch,
    required this.onDismiss,
  });

  final Offset anchorOffset;
  final Size anchorSize;
  final AgentProject project;
  final ProjectBranches? branches;
  final bool loadingBranches;
  final bool newBranchMode;
  final TextEditingController newBranchController;
  final bool isSwitching;
  final String? switchError;
  final VoidCallback onEnterNewBranch;
  final VoidCallback onCancelNewBranch;
  final ValueChanged<String> onSelectBranch;
  final VoidCallback onCreateBranch;
  final VoidCallback onDismiss;

  @override
  State<_BranchPopover> createState() => _BranchPopoverState();
}

class _BranchPopoverState extends State<_BranchPopover> {
  @override
  Widget build(BuildContext context) {
    const popoverWidth = 280.0;
    final left = widget.anchorOffset.dx;
    final top = widget.anchorOffset.dy + widget.anchorSize.height + 4;

    return Stack(
      children: [
        // Dismiss barrier.
        Positioned.fill(
          child: GestureDetector(
            onTap: widget.onDismiss,
            behavior: HitTestBehavior.translucent,
          ),
        ),
        Positioned(
          left: left,
          top: top,
          width: popoverWidth,
          child: Material(
            elevation: 8,
            borderRadius: BorderRadius.circular(12),
            color: context.rhythm.surfaceRaised,
            child: Container(
              decoration: BoxDecoration(
                border: Border.all(color: context.rhythm.border),
                borderRadius: BorderRadius.circular(12),
              ),
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: _buildContent(context),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildContent(BuildContext context) {
    if (widget.loadingBranches) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }

    final branches = widget.branches;
    final current = branches?.current ?? widget.project.vcsBranch;
    final recent = branches?.recent ?? [];
    final local = branches?.local ?? [];

    final shownInRecent = recent.toSet();
    final remaining = local.where((b) => !shownInRecent.contains(b)).toList();

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Recent branches section.
        if (recent.isNotEmpty) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
            child: Text(
              'RECENT',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: context.rhythm.textMuted,
                letterSpacing: 0.8,
              ),
            ),
          ),
          for (final b in recent)
            _BranchRow(
              branch: b,
              isCurrent: b == current,
              onTap: () => widget.onSelectBranch(b),
            ),
        ],

        // Other local branches.
        if (remaining.isNotEmpty) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
            child: Text(
              'LOCAL',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: context.rhythm.textMuted,
                letterSpacing: 0.8,
              ),
            ),
          ),
          for (final b in remaining)
            _BranchRow(
              branch: b,
              isCurrent: b == current,
              onTap: () => widget.onSelectBranch(b),
            ),
        ],

        // New branch input / button.
        const Divider(height: 1),
        if (widget.newBranchMode)
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: widget.newBranchController,
                    autofocus: true,
                    style: TextStyle(
                      fontSize: 12,
                      fontFamily: 'Menlo',
                      color: context.rhythm.textPrimary,
                    ),
                    decoration: InputDecoration(
                      hintText: 'new-branch-name',
                      hintStyle: TextStyle(color: context.rhythm.textMuted),
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 6,
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(6),
                        borderSide: BorderSide(color: context.rhythm.border),
                      ),
                    ),
                    onSubmitted: (_) => widget.onCreateBranch(),
                  ),
                ),
                const SizedBox(width: 6),
                IconButton(
                  icon:
                      Icon(Icons.check, size: 16, color: context.rhythm.accent),
                  onPressed: widget.onCreateBranch,
                  padding: EdgeInsets.zero,
                  constraints:
                      const BoxConstraints(minWidth: 28, minHeight: 28),
                ),
                IconButton(
                  icon: Icon(Icons.close,
                      size: 16, color: context.rhythm.textMuted),
                  onPressed: widget.onCancelNewBranch,
                  padding: EdgeInsets.zero,
                  constraints:
                      const BoxConstraints(minWidth: 28, minHeight: 28),
                ),
              ],
            ),
          )
        else
          InkWell(
            onTap: widget.onEnterNewBranch,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Row(
                children: [
                  Icon(Icons.add, size: 14, color: context.rhythm.accent),
                  const SizedBox(width: 8),
                  Text(
                    'New branch from current',
                    style: TextStyle(
                      fontSize: 12,
                      color: context.rhythm.accent,
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _BranchRow extends StatelessWidget {
  const _BranchRow({
    required this.branch,
    required this.isCurrent,
    required this.onTap,
  });

  final String branch;
  final bool isCurrent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: isCurrent ? null : onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          children: [
            if (isCurrent)
              Icon(Icons.check, size: 14, color: context.rhythm.accent)
            else
              const SizedBox(width: 14),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                branch,
                style: TextStyle(
                  fontSize: 12,
                  fontFamily: 'Menlo',
                  fontWeight: isCurrent ? FontWeight.w700 : FontWeight.w400,
                  color: isCurrent
                      ? context.rhythm.textPrimary
                      : context.rhythm.textSecondary,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
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
