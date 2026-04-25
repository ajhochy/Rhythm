import 'package:flutter/material.dart';

import '../../app/core/workspace/workspace_models.dart';

class WorkspaceMemberPicker extends StatelessWidget {
  const WorkspaceMemberPicker({
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
    return DropdownButtonHideUnderline(
      child: DropdownButton<int?>(
        value: selectedUserId,
        hint: Text(
          label,
          style: const TextStyle(fontSize: 13, color: Color(0xFF9CA3AF)),
        ),
        isDense: true,
        items: [
          if (allowNone)
            const DropdownMenuItem<int?>(
              value: null,
              child: Text('— None —', style: TextStyle(fontSize: 13)),
            ),
          ...workspaceMembers.map(
            (member) => DropdownMenuItem<int?>(
              value: member.userId,
              child: _WorkspaceMemberLabel(member: member),
            ),
          ),
        ],
        selectedItemBuilder: (_) => [
          if (allowNone)
            const Text(
              '— None —',
              style: TextStyle(fontSize: 13, color: Color(0xFF9CA3AF)),
            ),
          ...workspaceMembers.map(
            (member) => _WorkspaceMemberLabel(member: member, dense: true),
          ),
        ],
        onChanged: onChanged,
      ),
    );
  }
}

class _WorkspaceMemberLabel extends StatelessWidget {
  const _WorkspaceMemberLabel({required this.member, this.dense = false});

  final WorkspaceMember member;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        CircleAvatar(
          radius: dense ? 10 : 11,
          backgroundColor: const Color(0xFF4F6AF5),
          child: Text(
            _initialFor(member.name),
            style: const TextStyle(fontSize: 9, color: Colors.white),
          ),
        ),
        SizedBox(width: dense ? 4 : 6),
        Flexible(
          child: Text(
            member.name,
            style: TextStyle(fontSize: dense ? 12 : 13),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }

  String _initialFor(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return '?';
    return trimmed[0].toUpperCase();
  }
}

Future<WorkspaceMember?> showWorkspaceMemberPickerDialog(
  BuildContext context, {
  required List<WorkspaceMember> candidates,
  String title = 'Select person',
}) async {
  if (candidates.isEmpty) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('No other workspace members to add')),
    );
    return null;
  }
  return showDialog<WorkspaceMember>(
    context: context,
    builder: (ctx) => SimpleDialog(
      title: Text(title),
      children: [
        for (final member in candidates)
          SimpleDialogOption(
            onPressed: () => Navigator.pop(ctx, member),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 14,
                  backgroundColor: const Color(0xFF4F6AF5),
                  child: Text(
                    member.name.isNotEmpty ? member.name[0].toUpperCase() : '?',
                    style: const TextStyle(fontSize: 11, color: Colors.white),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(child: Text(member.name)),
              ],
            ),
          ),
      ],
    ),
  );
}
