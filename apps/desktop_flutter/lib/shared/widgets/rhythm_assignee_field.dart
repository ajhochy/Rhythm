import 'package:flutter/material.dart';

import '../../app/core/ui/rhythm_ui.dart';
import '../../app/core/workspace/workspace_models.dart';
import 'workspace_member_picker.dart';

class RhythmAssigneeField extends StatelessWidget {
  const RhythmAssigneeField({
    super.key,
    required this.workspaceMembers,
    required this.selectedUserId,
    required this.onChanged,
    this.label = 'Assign to',
    this.allowNone = true,
  });

  final List<WorkspaceMember> workspaceMembers;
  final int? selectedUserId;
  final ValueChanged<int?> onChanged;
  final String label;
  final bool allowNone;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final safeId = selectedUserId != null &&
            workspaceMembers.any((m) => m.userId == selectedUserId)
        ? selectedUserId
        : null;

    return Row(
      children: [
        SizedBox(
          width: 76,
          child: Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: colors.textSecondary,
                  fontWeight: FontWeight.w600,
                ),
          ),
        ),
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              border: Border.all(color: colors.borderSubtle),
              borderRadius: BorderRadius.circular(RhythmRadius.sm),
            ),
            child: WorkspaceMemberPicker(
              workspaceMembers: workspaceMembers,
              selectedUserId: safeId,
              onChanged: onChanged,
              label: label,
              allowNone: allowNone,
            ),
          ),
        ),
      ],
    );
  }
}
