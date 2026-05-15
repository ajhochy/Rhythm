import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agent_projects_controller.dart';
import '../models/agent_project.dart';

/// Shared create / edit project dialog. Called from the rail's `+` button
/// (create) and from a long-press / context-menu on a rail icon (edit).
///
/// Folder picker UX is currently a plain text field — `file_picker` is not
/// yet a dependency. The "Pick…" button is reserved for a follow-up; users
/// paste/type the absolute path for now.
///
/// On save the dialog stays open for ~800ms to show the server's VCS probe
/// result before dismissing.
Future<void> showEditProjectDialog(
  BuildContext context, {
  AgentProject? existing,
}) {
  return showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (dialogCtx) => ChangeNotifierProvider.value(
      value: context.read<AgentProjectsController>(),
      child: _EditProjectDialog(existing: existing),
    ),
  );
}

class _EditProjectDialog extends StatefulWidget {
  const _EditProjectDialog({this.existing});

  final AgentProject? existing;

  bool get isEdit => existing != null;

  @override
  State<_EditProjectDialog> createState() => _EditProjectDialogState();
}

class _EditProjectDialogState extends State<_EditProjectDialog> {
  late final TextEditingController _name;
  late final TextEditingController _cwd;
  late final TextEditingController _icon;

  AgentProject? _vcsResult;
  String? _serverError;
  bool _saving = false;
  bool _showVcsConfirmation = false;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    _name = TextEditingController(text: e?.name ?? '');
    _cwd = TextEditingController(text: e?.cwd ?? '');
    _icon = TextEditingController(text: e?.icon ?? '');
    for (final c in [_name, _cwd, _icon]) {
      c.addListener(_onChanged);
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _cwd.dispose();
    _icon.dispose();
    super.dispose();
  }

  void _onChanged() => setState(() {});

  bool get _canSave =>
      !_saving && _name.text.trim().isNotEmpty && _cwd.text.trim().isNotEmpty;

  Future<void> _save() async {
    final controller = context.read<AgentProjectsController>();
    setState(() {
      _saving = true;
      _serverError = null;
    });
    try {
      final iconValue = _icon.text.trim().isEmpty ? null : _icon.text.trim();
      final result = widget.isEdit
          ? await controller.update(
              widget.existing!.id,
              name: _name.text.trim(),
              cwd: _cwd.text.trim(),
              icon: iconValue,
            )
          : await controller.create(
              name: _name.text.trim(),
              cwd: _cwd.text.trim(),
              icon: iconValue,
            );
      if (!mounted) return;
      setState(() {
        _vcsResult = result;
        _showVcsConfirmation = true;
        _saving = false;
      });
      // Hold the VCS confirmation line briefly before closing — per the spec
      // this is intentional UX, not a server delay.
      await Future<void>.delayed(const Duration(milliseconds: 800));
      if (!mounted) return;
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _serverError = e.toString();
        _saving = false;
      });
    }
  }

  Future<void> _archive() async {
    final controller = context.read<AgentProjectsController>();
    try {
      await controller.archive(widget.existing!.id);
      if (!mounted) return;
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      setState(() => _serverError = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.isEdit ? 'Edit project' : 'New project';
    return AlertDialog(
      title: Text(title),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _name,
              decoration: const InputDecoration(labelText: 'Name'),
              autofocus: true,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _cwd,
                    decoration: const InputDecoration(
                      labelText: 'Folder (absolute path)',
                      hintText: '/Users/you/Documents/repo',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                // Folder picker stub — needs file_picker dep (follow-up).
                const Tooltip(
                  message: 'Folder picker coming soon — paste path for now',
                  child: OutlinedButton(
                    onPressed: null,
                    child: Text('Pick…'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _icon,
              decoration: const InputDecoration(
                labelText: 'Icon (emoji or #RRGGBB)',
                hintText: 'optional',
              ),
              maxLength: 7,
            ),
            if (_showVcsConfirmation && _vcsResult != null) ...[
              const SizedBox(height: 8),
              Divider(color: context.rhythm.borderSubtle),
              const SizedBox(height: 6),
              _VcsConfirmationLine(project: _vcsResult!),
            ],
            if (_serverError != null) ...[
              const SizedBox(height: 8),
              Text(
                _serverError!,
                style: const TextStyle(color: Color(0xFFEF4444)),
              ),
            ],
          ],
        ),
      ),
      actions: [
        if (widget.isEdit)
          TextButton(
            onPressed: _saving ? null : _archive,
            style:
                TextButton.styleFrom(foregroundColor: const Color(0xFFEF4444)),
            child: const Text('Archive'),
          ),
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _canSave ? _save : null,
          child: Text(_saving ? 'Saving…' : 'Save'),
        ),
      ],
    );
  }
}

class _VcsConfirmationLine extends StatelessWidget {
  const _VcsConfirmationLine({required this.project});
  final AgentProject project;

  @override
  Widget build(BuildContext context) {
    if (project.vcsRoot != null) {
      return Row(
        children: [
          const Icon(Icons.check_circle_outline,
              color: Color(0xFF10B981), size: 16),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Detected git branch: ${project.vcsBranch ?? '(detached)'}',
              style: TextStyle(color: context.rhythm.textPrimary),
            ),
          ),
        ],
      );
    }
    return Row(
      children: [
        Icon(Icons.info_outline, color: context.rhythm.textMuted, size: 16),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            'No git repository at this path',
            style: TextStyle(color: context.rhythm.textSecondary),
          ),
        ),
      ],
    );
  }
}
