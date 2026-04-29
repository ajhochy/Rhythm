import 'package:flutter/material.dart';

import '../../../shared/widgets/workspace_member_picker.dart';
import '../workspace/workspace_models.dart';
import 'rhythm_button.dart';
import 'rhythm_dialog.dart';
import 'tokens/rhythm_theme.dart';

class RhythmTaskCreateResult {
  const RhythmTaskCreateResult({
    required this.title,
    this.ownerId,
  });
  final String title;
  final int? ownerId;
}

Future<RhythmTaskCreateResult?> showRhythmTaskCreateDialog(
  BuildContext context, {
  required String title,
  required List<WorkspaceMember> workspaceMembers,
  String titleHint = 'Task title',
}) {
  return showDialog<RhythmTaskCreateResult>(
    context: context,
    builder: (_) => _RhythmTaskCreateDialog(
      title: title,
      workspaceMembers: workspaceMembers,
      titleHint: titleHint,
    ),
  );
}

class _RhythmTaskCreateDialog extends StatefulWidget {
  const _RhythmTaskCreateDialog({
    required this.title,
    required this.workspaceMembers,
    required this.titleHint,
  });

  final String title;
  final List<WorkspaceMember> workspaceMembers;
  final String titleHint;

  @override
  State<_RhythmTaskCreateDialog> createState() =>
      _RhythmTaskCreateDialogState();
}

class _RhythmTaskCreateDialogState extends State<_RhythmTaskCreateDialog> {
  final _titleController = TextEditingController();
  int? _ownerId;

  @override
  void dispose() {
    _titleController.dispose();
    super.dispose();
  }

  void _submit() {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;
    Navigator.of(context).pop(
      RhythmTaskCreateResult(title: title, ownerId: _ownerId),
    );
  }

  OutlineInputBorder _fieldBorder(Color color, {double width = 1}) {
    return OutlineInputBorder(
      borderRadius: BorderRadius.circular(RhythmRadius.md),
      borderSide: BorderSide(color: color, width: width),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final titleEmpty = _titleController.text.trim().isEmpty;

    return RhythmDialog(
      title: widget.title,
      width: 420,
      actions: [
        RhythmButton.quiet(
          onPressed: () => Navigator.of(context).pop(null),
          label: 'Cancel',
          compact: true,
        ),
        RhythmButton.filled(
          onPressed: titleEmpty ? null : _submit,
          label: 'Add',
          compact: true,
        ),
      ],
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _titleController,
            autofocus: true,
            decoration: InputDecoration(
              hintText: widget.titleHint,
              hintStyle: TextStyle(color: colors.textMuted),
              isDense: true,
              filled: true,
              fillColor: colors.surfaceMuted,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: RhythmSpacing.md,
                vertical: 10,
              ),
              border: _fieldBorder(colors.borderSubtle),
              enabledBorder: _fieldBorder(colors.borderSubtle),
              focusedBorder: _fieldBorder(colors.focusRing, width: 1.5),
            ),
            onChanged: (_) => setState(() {}),
            onSubmitted: (_) => _submit(),
          ),
          const SizedBox(height: RhythmSpacing.sm),
          WorkspaceMemberPicker(
            workspaceMembers: widget.workspaceMembers,
            selectedUserId: _ownerId,
            onChanged: (id) => setState(() => _ownerId = id),
            label: 'Owner',
            allowNone: true,
          ),
        ],
      ),
    );
  }
}
