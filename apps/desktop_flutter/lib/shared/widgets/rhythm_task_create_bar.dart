import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../app/core/formatters/date_formatters.dart';
import '../../app/core/ui/rhythm_ui.dart';
import '../../app/core/workspace/workspace_controller.dart';
import '../../app/core/workspace/workspace_models.dart';
import 'rhythm_date_button.dart';
import 'workspace_member_picker.dart';

typedef RhythmTaskCreateCallback = void Function(
  String title, {
  String? notes,
  String? dueDate,
  int? collaboratorId,
});

class RhythmTaskCreateBar extends StatefulWidget {
  const RhythmTaskCreateBar({
    super.key,
    required this.onSubmit,
    this.showNotes = true,
    this.showCollaborator = true,
    this.addLabel = 'Add task',
    this.titleHint = 'New task title',
  });

  final RhythmTaskCreateCallback onSubmit;
  final bool showNotes;
  final bool showCollaborator;
  final String addLabel;
  final String titleHint;

  @override
  State<RhythmTaskCreateBar> createState() => _RhythmTaskCreateBarState();
}

class _RhythmTaskCreateBarState extends State<RhythmTaskCreateBar> {
  final _titleController = TextEditingController();
  final _notesController = TextEditingController();
  String? _selectedDueDate;
  WorkspaceMember? _selectedCollaborator;

  @override
  void dispose() {
    _titleController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  void _submit() {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;
    widget.onSubmit(
      title,
      notes: widget.showNotes ? _notesController.text.trim() : null,
      dueDate: _selectedDueDate,
      collaboratorId: _selectedCollaborator?.userId,
    );
    _titleController.clear();
    _notesController.clear();
    setState(() {
      _selectedDueDate = null;
      _selectedCollaborator = null;
    });
  }

  InputDecoration _fieldDecoration(
    BuildContext context, {
    required String hintText,
    required IconData icon,
  }) {
    final colors = context.rhythm;
    return InputDecoration(
      hintText: hintText,
      hintStyle: TextStyle(color: colors.textMuted),
      prefixIcon: Icon(icon, size: 18, color: colors.textMuted),
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
    );
  }

  OutlineInputBorder _fieldBorder(Color color, {double width = 1}) {
    return OutlineInputBorder(
      borderRadius: BorderRadius.circular(RhythmRadius.md),
      borderSide: BorderSide(color: color, width: width),
    );
  }

  Widget _collaboratorButton(BuildContext context) {
    final members = context.watch<WorkspaceController>().members;
    return OutlinedButton.icon(
      onPressed: () async {
        final selected = await showWorkspaceMemberPickerDialog(
          context,
          candidates: members,
          title: 'Add collaborator',
        );
        if (selected != null) setState(() => _selectedCollaborator = selected);
      },
      icon: Icon(
        _selectedCollaborator != null
            ? Icons.person
            : Icons.person_add_outlined,
        size: 16,
      ),
      label: Text(_selectedCollaborator?.name ?? 'Collaborator'),
    );
  }

  @override
  Widget build(BuildContext context) {
    return RhythmPanel(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final titleField = TextField(
            controller: _titleController,
            decoration: _fieldDecoration(
              context,
              hintText: widget.titleHint,
              icon: Icons.edit_note_outlined,
            ),
            textInputAction:
                widget.showNotes ? TextInputAction.next : TextInputAction.done,
            onSubmitted: (_) => _submit(),
          );

          final dateButton = RhythmDateButton(
            date: _selectedDueDate,
            placeholder: 'Due date',
            onTap: () async {
              final result =
                  await pickRhythmDate(context, current: _selectedDueDate);
              if (result != null) setState(() => _selectedDueDate = result);
            },
            onClear: _selectedDueDate != null
                ? () => setState(() => _selectedDueDate = null)
                : null,
          );

          final addButton = RhythmButton.filled(
            onPressed: _submit,
            icon: Icons.add,
            label: widget.addLabel,
            compact: true,
          );

          final collaboratorButton =
              widget.showCollaborator ? _collaboratorButton(context) : null;

          if (constraints.maxWidth >= 900) {
            return Row(
              children: [
                Expanded(
                  flex: widget.showNotes ? 3 : 5,
                  child: titleField,
                ),
                if (widget.showNotes) ...[
                  const SizedBox(width: RhythmSpacing.xs),
                  Expanded(
                    flex: 4,
                    child: TextField(
                      controller: _notesController,
                      decoration: _fieldDecoration(
                        context,
                        hintText: 'Add a note, context, or next step',
                        icon: Icons.subject_outlined,
                      ),
                      minLines: 1,
                      maxLines: 1,
                    ),
                  ),
                ],
                if (collaboratorButton != null) ...[
                  const SizedBox(width: RhythmSpacing.xs),
                  collaboratorButton,
                ],
                const SizedBox(width: RhythmSpacing.xs),
                dateButton,
                const SizedBox(width: RhythmSpacing.xs),
                addButton,
              ],
            );
          }

          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              titleField,
              if (widget.showNotes) ...[
                const SizedBox(height: RhythmSpacing.xs),
                TextField(
                  controller: _notesController,
                  decoration: _fieldDecoration(
                    context,
                    hintText: 'Add a note, context, or next step',
                    icon: Icons.subject_outlined,
                  ),
                  minLines: 1,
                  maxLines: 1,
                ),
              ],
              const SizedBox(height: RhythmSpacing.xs),
              Wrap(
                spacing: RhythmSpacing.xs,
                runSpacing: RhythmSpacing.xs,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (collaboratorButton != null) collaboratorButton,
                  dateButton,
                  addButton,
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}
