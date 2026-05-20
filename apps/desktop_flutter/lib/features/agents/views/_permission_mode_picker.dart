import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agents_controller.dart';
import '../models/agent_session.dart';

/// #611 — Permission mode pill. Form-factor mirrors [SessionModelPicker].
///
/// Renders as a compact pill next to the model picker in the transcript header.
/// Tapping opens a [PopupMenuButton] listing the four modes with one-line
/// descriptions. The active mode is highlighted with a check-mark and accent
/// colour. Selecting [PermissionMode.bypassPermissions] for the first time on a
/// session shows a confirmation dialog before committing.
class PermissionModePicker extends StatelessWidget {
  const PermissionModePicker({
    super.key,
    required this.session,
  });

  final AgentSession session;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final currentMode = session.permissionMode;

    final pillLabel = _modeLabel(currentMode);

    return PopupMenuButton<PermissionMode>(
      tooltip: 'Permission mode',
      offset: const Offset(0, 36),
      constraints: const BoxConstraints(minWidth: 260, maxWidth: 340),
      onSelected: (mode) => _onModeSelected(context, controller, mode),
      itemBuilder: (context) => _buildItems(context, currentMode),
      child: _PillChip(
        label: pillLabel,
        mode: currentMode,
      ),
    );
  }

  String _modeLabel(PermissionMode mode) {
    switch (mode) {
      case PermissionMode.defaultMode:
        return 'Permissions: Default';
      case PermissionMode.acceptEdits:
        return 'Permissions: Accept Edits';
      case PermissionMode.plan:
        return 'Permissions: Plan';
      case PermissionMode.bypassPermissions:
        return 'Permissions: Bypass';
    }
  }

  Future<void> _onModeSelected(
    BuildContext context,
    AgentsController controller,
    PermissionMode mode,
  ) async {
    // bypassPermissions requires confirmation on first selection for this session.
    if (mode == PermissionMode.bypassPermissions &&
        session.permissionMode != PermissionMode.bypassPermissions) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (_) => const _BypassConfirmDialog(),
      );
      if (confirmed != true) return;
    }
    await controller.setPermissionMode(session.id, mode);
  }

  List<PopupMenuEntry<PermissionMode>> _buildItems(
    BuildContext context,
    PermissionMode current,
  ) {
    return PermissionMode.values.map((mode) {
      final isActive = mode == current;
      final accent = context.rhythm.accent;
      return PopupMenuItem<PermissionMode>(
        value: mode,
        height: 52,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 18,
              child: isActive
                  ? Icon(Icons.check, size: 14, color: accent)
                  : const SizedBox.shrink(),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    mode.displayLabel,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
                      color: isActive ? accent : context.rhythm.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    mode.description,
                    style: TextStyle(
                      fontSize: 11,
                      color: context.rhythm.textMuted,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }).toList();
  }
}

// ---------------------------------------------------------------------------
// Internal: the pill chip
// ---------------------------------------------------------------------------

class _PillChip extends StatelessWidget {
  const _PillChip({required this.label, required this.mode});

  final String label;
  final PermissionMode mode;

  Color _pillColor(BuildContext context) {
    switch (mode) {
      case PermissionMode.bypassPermissions:
        return context.rhythm.warning.withValues(alpha: 0.15);
      case PermissionMode.plan:
        return context.rhythm.accent.withValues(alpha: 0.10);
      case PermissionMode.acceptEdits:
        return context.rhythm.success.withValues(alpha: 0.10);
      case PermissionMode.defaultMode:
        return context.rhythm.surfaceMuted;
    }
  }

  Color _pillBorder(BuildContext context) {
    switch (mode) {
      case PermissionMode.bypassPermissions:
        return context.rhythm.warning.withValues(alpha: 0.35);
      case PermissionMode.plan:
        return context.rhythm.accent.withValues(alpha: 0.25);
      case PermissionMode.acceptEdits:
        return context.rhythm.success.withValues(alpha: 0.25);
      case PermissionMode.defaultMode:
        return context.rhythm.border;
    }
  }

  Color _labelColor(BuildContext context) {
    switch (mode) {
      case PermissionMode.bypassPermissions:
        return context.rhythm.warning;
      case PermissionMode.plan:
        return context.rhythm.accent;
      case PermissionMode.acceptEdits:
        return context.rhythm.success;
      case PermissionMode.defaultMode:
        return context.rhythm.textSecondary;
    }
  }

  @override
  Widget build(BuildContext context) {
    final labelColor = _labelColor(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: _pillColor(context),
        borderRadius: BorderRadius.circular(RhythmRadius.pill),
        border: Border.all(color: _pillBorder(context)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.security_outlined, size: 12, color: labelColor),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: labelColor,
            ),
          ),
          const SizedBox(width: 4),
          Icon(Icons.expand_more, size: 12, color: labelColor),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Confirm dialog for bypassPermissions
// ---------------------------------------------------------------------------

class _BypassConfirmDialog extends StatelessWidget {
  const _BypassConfirmDialog();

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: context.rhythm.surfaceRaised,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
      ),
      title: Text(
        'Bypass all permissions?',
        style: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w700,
          color: context.rhythm.textPrimary,
        ),
      ),
      content: Text(
        'The agent will auto-accept every tool call, including '
        'file writes, shell commands, and network requests, '
        'without asking for confirmation.\n\n'
        'Only enable this when you fully trust the agent\'s plan.',
        style: TextStyle(
          fontSize: 13,
          color: context.rhythm.textSecondary,
          height: 1.45,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          style: TextButton.styleFrom(
            foregroundColor: context.rhythm.textSecondary,
          ),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          style: FilledButton.styleFrom(
            backgroundColor: context.rhythm.warning,
          ),
          child: const Text('Enable Bypass'),
        ),
      ],
    );
  }
}
