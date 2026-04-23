import 'package:flutter/material.dart';

import '../../../features/tasks/models/task_collaborator.dart';
import '../../../features/tasks/models/task.dart';
import '../workspace/workspace_models.dart';
import '../formatters/date_formatters.dart';

class RhythmTaskEditResult {
  const RhythmTaskEditResult({
    required this.title,
    this.notes,
    this.dueDate,
  });

  final String title;
  final String? notes;
  final String? dueDate;
}

typedef RhythmTaskCollaboratorUpdate = Future<List<TaskCollaborator>> Function(
  int userId,
);

Future<RhythmTaskEditResult?> showRhythmTaskEditDialog(
  BuildContext context, {
  required Task task,
  List<WorkspaceMember> workspaceMembers = const [],
  RhythmTaskCollaboratorUpdate? onAddCollaborator,
  RhythmTaskCollaboratorUpdate? onRemoveCollaborator,
}) {
  return showDialog<RhythmTaskEditResult>(
    context: context,
    builder: (_) => _RhythmTaskEditDialog(
      task: task,
      workspaceMembers: workspaceMembers,
      onAddCollaborator: onAddCollaborator,
      onRemoveCollaborator: onRemoveCollaborator,
    ),
  );
}

class _RhythmTaskEditDialog extends StatefulWidget {
  const _RhythmTaskEditDialog({
    required this.task,
    required this.workspaceMembers,
    required this.onAddCollaborator,
    required this.onRemoveCollaborator,
  });

  final Task task;
  final List<WorkspaceMember> workspaceMembers;
  final RhythmTaskCollaboratorUpdate? onAddCollaborator;
  final RhythmTaskCollaboratorUpdate? onRemoveCollaborator;

  @override
  State<_RhythmTaskEditDialog> createState() => _RhythmTaskEditDialogState();
}

class _RhythmTaskEditDialogState extends State<_RhythmTaskEditDialog> {
  late final TextEditingController _titleController;
  late final TextEditingController _notesController;
  String? _dueDate;
  late List<TaskCollaborator> _collaborators;
  bool _updatingCollaborators = false;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.task.title);
    _notesController = TextEditingController(text: widget.task.notes ?? '');
    _dueDate = widget.task.dueDate;
    _collaborators = [...widget.task.collaborators];
  }

  @override
  void dispose() {
    _titleController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final initial = _dueDate != null
        ? DateTime.tryParse(_dueDate!) ?? DateTime.now()
        : DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2020),
      lastDate: DateTime(2030),
    );
    if (picked != null) {
      setState(() => _dueDate = picked.toIso8601String().substring(0, 10));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit Task'),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _titleController,
              decoration: const InputDecoration(
                labelText: 'Title',
                border: OutlineInputBorder(),
              ),
              autofocus: true,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _notesController,
              decoration: const InputDecoration(
                labelText: 'Notes',
                border: OutlineInputBorder(),
              ),
              minLines: 2,
              maxLines: 5,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                OutlinedButton.icon(
                  onPressed: _pickDate,
                  icon: const Icon(Icons.calendar_today, size: 16),
                  label: Text(
                    _dueDate == null
                        ? 'Set due date'
                        : DateFormatters.fullDate(_dueDate),
                  ),
                ),
                if (_dueDate != null) ...[
                  const SizedBox(width: 8),
                  TextButton(
                    onPressed: () => setState(() => _dueDate = null),
                    child: const Text('Clear'),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 14),
            _buildCollaboratorsSection(context),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _save,
          child: const Text('Save'),
        ),
      ],
    );
  }

  Widget _buildCollaboratorsSection(BuildContext context) {
    final canEdit = widget.onAddCollaborator != null &&
        widget.onRemoveCollaborator != null &&
        widget.workspaceMembers.isNotEmpty;
    return Align(
      alignment: Alignment.centerLeft,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Collaborators',
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              for (final collaborator in _collaborators)
                InputChip(
                  avatar: CircleAvatar(
                    backgroundImage: collaborator.photoUrl == null
                        ? null
                        : NetworkImage(collaborator.photoUrl!),
                    child: collaborator.photoUrl == null
                        ? Text(_initial(collaborator.name))
                        : null,
                  ),
                  label: Text(collaborator.name),
                  onDeleted: canEdit && !_updatingCollaborators
                      ? () => _removeCollaborator(collaborator.userId)
                      : null,
                ),
              ActionChip(
                avatar: _updatingCollaborators
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.person_add_outlined, size: 18),
                label: const Text('Add collaborator'),
                onPressed: canEdit && !_updatingCollaborators
                    ? _showPeoplePicker
                    : null,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _showPeoplePicker() async {
    final alreadyAdded = {
      if (widget.task.ownerId != null) widget.task.ownerId!,
      ..._collaborators.map((c) => c.userId),
    };
    final candidates = widget.workspaceMembers
        .where((member) => !alreadyAdded.contains(member.userId))
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
        children: [
          for (final member in candidates)
            SimpleDialogOption(
              onPressed: () => Navigator.pop(ctx, member),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 14,
                    child: Text(
                      _initial(member.name),
                      style: const TextStyle(fontSize: 11),
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
    if (selected == null || widget.onAddCollaborator == null) return;

    setState(() => _updatingCollaborators = true);
    try {
      final updated = await widget.onAddCollaborator!(selected.userId);
      if (mounted) setState(() => _collaborators = updated);
    } finally {
      if (mounted) setState(() => _updatingCollaborators = false);
    }
  }

  Future<void> _removeCollaborator(int userId) async {
    if (widget.onRemoveCollaborator == null) return;
    setState(() => _updatingCollaborators = true);
    try {
      final updated = await widget.onRemoveCollaborator!(userId);
      if (mounted) setState(() => _collaborators = updated);
    } finally {
      if (mounted) setState(() => _updatingCollaborators = false);
    }
  }

  void _save() {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;
    final notes = _notesController.text.trim();
    Navigator.pop(
      context,
      RhythmTaskEditResult(
        title: title,
        notes: notes.isEmpty ? null : notes,
        dueDate: _dueDate,
      ),
    );
  }
}

String _initial(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return '?';
  return trimmed.characters.first.toUpperCase();
}
