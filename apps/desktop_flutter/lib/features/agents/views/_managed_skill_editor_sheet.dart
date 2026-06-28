import 'package:flutter/material.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../data/opencode_skills_data_source.dart';

/// A small editor for authoring / editing a Rhythm-managed skill (name +
/// description + content). Used from the Agent Profile sheet's Skills section.
///
/// Opens as a modal bottom sheet. On a successful save the new/edited
/// [OpencodeSkillEntry] is returned; dismissing returns null.
///
/// Name-collision and empty-name guarding (#4 boundary criterion) is enforced
/// here in the UI before any network call: pass [existingNames] (the live set,
/// lowercased comparison) so a create cannot collide with an existing skill.
Future<OpencodeSkillEntry?> showManagedSkillEditorSheet(
  BuildContext context, {
  required OpencodeSkillsDataSource dataSource,
  required Set<String> existingNames,
  OpencodeSkillEntry? skill,
}) {
  return showModalBottomSheet<OpencodeSkillEntry>(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.rhythm.surface,
    shape: RoundedRectangleBorder(
      borderRadius: const BorderRadius.vertical(
        top: Radius.circular(RhythmRadius.xl),
      ),
      side: BorderSide(color: context.rhythm.border),
    ),
    builder: (_) => ManagedSkillEditorSheet(
      dataSource: dataSource,
      existingNames: existingNames,
      skill: skill,
    ),
  );
}

class ManagedSkillEditorSheet extends StatefulWidget {
  const ManagedSkillEditorSheet({
    super.key,
    required this.dataSource,
    required this.existingNames,
    this.skill,
  });

  final OpencodeSkillsDataSource dataSource;

  /// Live skill names (used to block a create that collides). Compared
  /// case-insensitively.
  final Set<String> existingNames;

  /// Non-null = edit mode (name is locked); null = create mode.
  final OpencodeSkillEntry? skill;

  @override
  State<ManagedSkillEditorSheet> createState() =>
      _ManagedSkillEditorSheetState();
}

class _ManagedSkillEditorSheetState extends State<ManagedSkillEditorSheet> {
  late final TextEditingController _nameController;
  late final TextEditingController _descriptionController;
  late final TextEditingController _contentController;

  bool _saving = false;
  String? _error;

  bool get _isEdit => widget.skill != null;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.skill?.name ?? '');
    _descriptionController =
        TextEditingController(text: widget.skill?.description ?? '');
    _contentController = TextEditingController();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _contentController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _nameController.text.trim();
    final content = _contentController.text;

    if (!_isEdit) {
      if (name.isEmpty) {
        setState(() => _error = 'Name is required.');
        return;
      }
      final collides = widget.existingNames
          .map((n) => n.toLowerCase())
          .contains(name.toLowerCase());
      if (collides) {
        setState(() => _error = 'A skill named "$name" already exists.');
        return;
      }
    }

    if (content.trim().isEmpty) {
      setState(() => _error = 'Content is required.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    final description = _descriptionController.text.trim().isEmpty
        ? null
        : _descriptionController.text.trim();

    try {
      final OpencodeSkillEntry result;
      if (_isEdit) {
        result = await widget.dataSource.update(
          widget.skill!.name,
          description: description,
          content: content,
        );
      } else {
        result = await widget.dataSource.create(
          name: name,
          description: description,
          content: content,
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop(result);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 24,
          right: 24,
          top: 16,
          bottom: MediaQuery.of(context).viewInsets.bottom + 24,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    _isEdit ? 'Edit skill' : 'New skill',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: rhythm.textPrimary,
                    ),
                  ),
                ),
                IconButton(
                  icon: Icon(Icons.close, size: 20, color: rhythm.textMuted),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _nameController,
              enabled: !_isEdit,
              autofocus: !_isEdit,
              style: TextStyle(
                color: _isEdit ? rhythm.textMuted : rhythm.textPrimary,
              ),
              decoration: _decoration(context, 'Name (e.g. release-notes)'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _descriptionController,
              style: TextStyle(color: rhythm.textPrimary),
              decoration: _decoration(context, 'Description (optional)'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _contentController,
              minLines: 5,
              maxLines: 12,
              style: TextStyle(color: rhythm.textPrimary, fontSize: 13),
              decoration: _decoration(
                context,
                'Skill content (SKILL.md body)…',
                alignLabelWithHint: true,
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(
                _error!,
                style: TextStyle(color: rhythm.danger, fontSize: 13),
              ),
            ],
            const SizedBox(height: 16),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: rhythm.accent,
                minimumSize: const Size.fromHeight(48),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                ),
              ),
              onPressed: _saving ? null : _save,
              child: _saving
                  ? SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white.withValues(alpha: 0.8),
                      ),
                    )
                  : Text(_isEdit ? 'Save skill' : 'Create skill'),
            ),
          ],
        ),
      ),
    );
  }

  InputDecoration _decoration(
    BuildContext context,
    String hint, {
    bool alignLabelWithHint = false,
  }) {
    return InputDecoration(
      hintText: hint,
      alignLabelWithHint: alignLabelWithHint,
      hintStyle: TextStyle(color: context.rhythm.textMuted, fontSize: 13),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        borderSide: BorderSide(color: context.rhythm.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        borderSide: BorderSide(color: context.rhythm.accent, width: 1.5),
      ),
      disabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        borderSide: BorderSide(color: context.rhythm.borderSubtle),
      ),
      filled: true,
      fillColor: context.rhythm.surfaceMuted,
    );
  }
}
