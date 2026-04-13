import 'package:flutter/material.dart';

import '../../app/core/auth/auth_session_service.dart';
import '../../app/core/workspace/workspace_models.dart';
import '../../features/tasks/models/task_collaborator.dart';

typedef OnCollaboratorAdded = Future<void> Function(int userId);
typedef OnCollaboratorRemoved = Future<void> Function(int userId);

class CollaboratorsRow extends StatelessWidget {
  const CollaboratorsRow({
    super.key,
    required this.collaborators,
    required this.ownerId,
    required this.onAdd,
    required this.onRemove,
    required this.workspaceMembers,
  });

  final List<TaskCollaborator> collaborators;
  final int ownerId;
  final OnCollaboratorAdded onAdd;
  final OnCollaboratorRemoved onRemove;
  final List<WorkspaceMember> workspaceMembers;

  @override
  Widget build(BuildContext context) {
    final currentUserId = AuthSessionService.instance.currentUser?.id;
    final isOwner = currentUserId == ownerId;

    if (collaborators.isEmpty && !isOwner) return const SizedBox.shrink();

    return Row(
      children: [
        ...collaborators.map(
          (c) => Padding(
            padding: const EdgeInsets.only(right: 4),
            child: GestureDetector(
              onLongPress: isOwner ? () => onRemove(c.userId) : null,
              child: Tooltip(
                message: '${c.name}${isOwner ? ' (long-press to remove)' : ''}',
                child: CircleAvatar(
                  radius: 14,
                  backgroundImage:
                      c.photoUrl != null ? NetworkImage(c.photoUrl!) : null,
                  child: c.photoUrl == null
                      ? Text(c.name[0].toUpperCase(),
                          style: const TextStyle(fontSize: 11))
                      : null,
                ),
              ),
            ),
          ),
        ),
        if (isOwner)
          IconButton(
            icon: const Icon(Icons.person_add_outlined, size: 18),
            tooltip: 'Add collaborator',
            onPressed: () => _showPeoplePicker(context),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
          ),
      ],
    );
  }

  Future<void> _showPeoplePicker(BuildContext context) async {
    final alreadyAdded = {ownerId, ...collaborators.map((c) => c.userId)};
    final candidates = workspaceMembers
        .where((m) => !alreadyAdded.contains(m.userId))
        .toList();

    if (candidates.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No other workspace members to add')),
      );
      return;
    }

    final selected = await showDialog<WorkspaceMember>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Add collaborator'),
        children: candidates
            .map(
              (m) => SimpleDialogOption(
                onPressed: () => Navigator.pop(ctx, m),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 14,
                      child: Text(m.name[0].toUpperCase(),
                          style: const TextStyle(fontSize: 11)),
                    ),
                    const SizedBox(width: 8),
                    Text(m.name),
                  ],
                ),
              ),
            )
            .toList(),
      ),
    );
    if (selected != null) {
      await onAdd(selected.userId);
    }
  }
}
