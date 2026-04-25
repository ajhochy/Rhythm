import 'package:flutter/material.dart';

import '../../app/core/formatters/date_formatters.dart';
import '../../app/core/ui/rhythm_ui.dart';
import 'rhythm_date_button.dart';

typedef RhythmTaskCreateCallback = void Function(
  String title, {
  String? notes,
  String? dueDate,
});

class RhythmTaskCreateBar extends StatefulWidget {
  const RhythmTaskCreateBar({
    super.key,
    required this.onSubmit,
    this.showNotes = false,
    this.addLabel = 'Add task',
    this.titleHint = 'New task title',
  });

  final RhythmTaskCreateCallback onSubmit;
  final bool showNotes;
  final String addLabel;
  final String titleHint;

  @override
  State<RhythmTaskCreateBar> createState() => _RhythmTaskCreateBarState();
}

class _RhythmTaskCreateBarState extends State<RhythmTaskCreateBar> {
  final _titleController = TextEditingController();
  final _notesController = TextEditingController();
  String? _selectedDueDate;

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
    );
    _titleController.clear();
    _notesController.clear();
    setState(() => _selectedDueDate = null);
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
                children: [dateButton, addButton],
              ),
            ],
          );
        },
      ),
    );
  }
}
