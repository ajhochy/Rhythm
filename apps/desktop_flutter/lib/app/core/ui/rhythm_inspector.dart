import 'package:flutter/material.dart';

import '../../../features/projects/models/project_instance.dart';
import '../../../features/tasks/models/task.dart';
import '../../../features/tasks/models/task_collaborator.dart';
import '../../../shared/widgets/workspace_member_picker.dart';
import '../formatters/date_formatters.dart';
import '../tasks/task_visual_style.dart';
import '../workspace/workspace_models.dart';
import 'rhythm_button.dart';
import 'tokens/rhythm_theme.dart';

typedef RhythmTaskCollaboratorUpdate = Future<List<TaskCollaborator>> Function(
  int userId,
);

class RhythmTaskInspectorSaveRequest {
  const RhythmTaskInspectorSaveRequest({
    required this.title,
    required this.notes,
    required this.dueDate,
    required this.scheduledDate,
  });

  final String title;
  final String? notes;
  final String? dueDate;
  final String? scheduledDate;
}

class RhythmProjectStepInspectorSaveRequest {
  const RhythmProjectStepInspectorSaveRequest({
    required this.title,
    required this.notes,
    required this.dueDate,
    required this.assigneeId,
  });

  final String title;
  final String? notes;
  final String? dueDate;
  final int? assigneeId;
}

typedef RhythmTaskInspectorSave = Future<void> Function(
    RhythmTaskInspectorSaveRequest request);
typedef RhythmProjectStepInspectorSave = Future<void> Function(
    RhythmProjectStepInspectorSaveRequest request);

Future<void> showRhythmTaskInspector(
  BuildContext context, {
  required Task task,
  required List<WorkspaceMember> workspaceMembers,
  required RhythmTaskInspectorSave onSaveDetails,
  RhythmTaskCollaboratorUpdate? onAddCollaborator,
  RhythmTaskCollaboratorUpdate? onRemoveCollaborator,
}) {
  return showDialog<void>(
    context: context,
    builder: (_) => _RhythmTaskInspector(
      task: task,
      workspaceMembers: workspaceMembers,
      onSaveDetails: onSaveDetails,
      onAddCollaborator: onAddCollaborator,
      onRemoveCollaborator: onRemoveCollaborator,
    ),
  );
}

Future<void> showRhythmProjectStepInspector(
  BuildContext context, {
  required ProjectInstanceStep step,
  required String projectTitle,
  required String? projectOwnerLabel,
  required List<TaskCollaborator> projectCollaborators,
  required List<WorkspaceMember> workspaceMembers,
  required RhythmProjectStepInspectorSave onSaveDetails,
}) {
  return showDialog<void>(
    context: context,
    builder: (_) => _RhythmProjectStepInspector(
      step: step,
      projectTitle: projectTitle,
      projectOwnerLabel: projectOwnerLabel,
      projectCollaborators: projectCollaborators,
      workspaceMembers: workspaceMembers,
      onSaveDetails: onSaveDetails,
    ),
  );
}

class _RhythmInspectorShell extends StatelessWidget {
  const _RhythmInspectorShell({
    required this.kicker,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.accent,
    required this.headerPills,
    required this.main,
    required this.aside,
    required this.actions,
    this.headerBody,
  });

  final String kicker;
  final String title;
  final String subtitle;
  final IconData icon;
  final Color accent;
  final List<Widget> headerPills;
  final Widget main;
  final Widget aside;
  final List<Widget> actions;
  final Widget? headerBody;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 40, vertical: 28),
      backgroundColor: Colors.transparent,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1080, maxHeight: 760),
        child: Container(
          decoration: BoxDecoration(
            color: colors.surfaceRaised,
            borderRadius: BorderRadius.circular(RhythmRadius.lg),
            border: Border.all(color: colors.border),
            boxShadow: RhythmElevation.panel,
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.fromLTRB(24, 22, 24, 18),
                decoration: BoxDecoration(
                  color: Color.lerp(colors.surfaceRaised, accent, 0.1),
                  border: Border(bottom: BorderSide(color: colors.border)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      kicker,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: accent,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.6,
                          ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            color: accent.withValues(alpha: 0.18),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Icon(icon, color: accent, size: 22),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                title,
                                style: Theme.of(context)
                                    .textTheme
                                    .headlineSmall
                                    ?.copyWith(
                                      color: colors.textPrimary,
                                      fontWeight: FontWeight.w800,
                                      height: 1.05,
                                    ),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                subtitle,
                                style: Theme.of(context)
                                    .textTheme
                                    .bodyMedium
                                    ?.copyWith(
                                      color: colors.textSecondary,
                                      height: 1.4,
                                    ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 16),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: actions,
                        ),
                      ],
                    ),
                    if (headerPills.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Wrap(spacing: 8, runSpacing: 8, children: headerPills),
                    ],
                    if (headerBody != null) ...[
                      const SizedBox(height: 16),
                      headerBody!,
                    ],
                  ],
                ),
              ),
              Expanded(
                child: Row(
                  children: [
                    Expanded(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(24),
                        child: main,
                      ),
                    ),
                    Container(width: 1, color: colors.border),
                    SizedBox(
                      width: 308,
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(24),
                        child: aside,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InspectorSection extends StatelessWidget {
  const _InspectorSection({
    required this.title,
    required this.child,
    this.subtitle,
  });

  final String title;
  final String? subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: colors.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  color: colors.textPrimary,
                  fontWeight: FontWeight.w700,
                ),
          ),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(
              subtitle!,
              style: Theme.of(context)
                  .textTheme
                  .bodySmall
                  ?.copyWith(color: colors.textSecondary, height: 1.4),
            ),
          ],
          const SizedBox(height: 14),
          child,
        ],
      ),
    );
  }
}

class _MetaRow extends StatelessWidget {
  const _MetaRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: colors.textMuted,
                  fontWeight: FontWeight.w700,
                ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: colors.textPrimary,
                  height: 1.35,
                ),
          ),
        ],
      ),
    );
  }
}

class _PeopleChip extends StatelessWidget {
  const _PeopleChip({
    required this.label,
    this.onDeleted,
  });

  final String label;
  final VoidCallback? onDeleted;

  @override
  Widget build(BuildContext context) {
    return InputChip(
      avatar: CircleAvatar(child: Text(_initial(label))),
      label: Text(label),
      onDeleted: onDeleted,
    );
  }
}

class _RhythmTaskInspector extends StatefulWidget {
  const _RhythmTaskInspector({
    required this.task,
    required this.workspaceMembers,
    required this.onSaveDetails,
    required this.onAddCollaborator,
    required this.onRemoveCollaborator,
  });

  final Task task;
  final List<WorkspaceMember> workspaceMembers;
  final RhythmTaskInspectorSave onSaveDetails;
  final RhythmTaskCollaboratorUpdate? onAddCollaborator;
  final RhythmTaskCollaboratorUpdate? onRemoveCollaborator;

  @override
  State<_RhythmTaskInspector> createState() => _RhythmTaskInspectorState();
}

class _RhythmTaskInspectorState extends State<_RhythmTaskInspector> {
  late final TextEditingController _titleController;
  late final TextEditingController _notesController;
  late List<TaskCollaborator> _collaborators;
  late String? _primaryDate;
  late bool _usesScheduledDate;
  bool _editing = false;
  bool _saving = false;
  bool _updatingCollaborators = false;

  bool get _readOnly => widget.task.sourceType == 'calendar_shadow_event';

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.task.title);
    _notesController = TextEditingController(text: widget.task.notes ?? '');
    _collaborators = [...widget.task.collaborators];
    _usesScheduledDate = widget.task.sourceType != 'project_step' &&
        (widget.task.scheduledDate != null || widget.task.dueDate == null);
    _primaryDate =
        _usesScheduledDate ? widget.task.scheduledDate : widget.task.dueDate;
  }

  @override
  void dispose() {
    _titleController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final visualStyle = TaskVisualStyles.resolve(widget.task);
    final ownerLabel =
        _memberName(widget.task.ownerId, widget.workspaceMembers);
    final sourceLabel = _taskSourceLabel(widget.task);
    final scheduleLabel = _primaryDate == null
        ? 'No date set'
        : DateFormatters.fullDate(_primaryDate, fallback: _primaryDate!);

    return _RhythmInspectorShell(
      kicker: _readOnly ? 'TASK INSPECTOR · READ ONLY' : 'TASK INSPECTOR',
      title: _editing ? _titleController.text.trim() : widget.task.title,
      subtitle: _readOnly
          ? 'This item is synced from your calendar and shown here for context.'
          : 'Review context, coordinate with collaborators, and edit the work when needed.',
      icon: _readOnly ? Icons.event_note_outlined : Icons.task_alt_outlined,
      accent: visualStyle.accent,
      headerPills: [
        _headerPill(
          context,
          widget.task.status == 'done' ? 'Done' : 'Open',
          widget.task.status == 'done'
              ? colors.success
              : visualStyle.accent.withValues(alpha: 0.95),
        ),
        if (sourceLabel != null) _headerPill(context, sourceLabel, colors.info),
        if (_primaryDate != null)
          _headerPill(context, scheduleLabel, colors.warning),
      ],
      headerBody: _editing && !_readOnly
          ? TextField(
              controller: _titleController,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Task title',
                border: OutlineInputBorder(),
              ),
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
              onChanged: (_) => setState(() {}),
            )
          : null,
      actions: [
        if (!_readOnly && !_editing)
          RhythmButton.filled(
            onPressed: () => setState(() => _editing = true),
            icon: Icons.edit_outlined,
            label: 'Edit details',
            compact: true,
          ),
        if (_editing) ...[
          RhythmButton.quiet(
            onPressed: _saving
                ? null
                : () {
                    setState(() {
                      _editing = false;
                      _titleController.text = widget.task.title;
                      _notesController.text = widget.task.notes ?? '';
                      _collaborators = [...widget.task.collaborators];
                      _primaryDate = _usesScheduledDate
                          ? widget.task.scheduledDate
                          : widget.task.dueDate;
                    });
                  },
            label: 'Cancel',
            compact: true,
          ),
          RhythmButton.filled(
            onPressed: _saving ? null : _save,
            label: _saving ? 'Saving...' : 'Save changes',
            compact: true,
          ),
        ],
        RhythmButton.icon(
          onPressed: () => Navigator.of(context).pop(),
          icon: Icons.close,
          tooltip: 'Close inspector',
          compact: true,
        ),
      ],
      main: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _InspectorSection(
            title: 'Task Details',
            subtitle: _editing
                ? 'Notes, context, and the working detail attached to this task.'
                : 'Task notes and execution detail.',
            child: _editing && !_readOnly
                ? TextField(
                    controller: _notesController,
                    minLines: 8,
                    maxLines: 14,
                    decoration: const InputDecoration(
                      hintText:
                          'Add notes, context, prep detail, or next-step instructions...',
                      border: OutlineInputBorder(),
                    ),
                  )
                : _readOnlyNotes(context, _notesController.text.trim()),
          ),
          const SizedBox(height: 18),
          _InspectorSection(
            title: 'Schedule',
            subtitle: _editing
                ? 'Update the planning date for this task.'
                : 'Operational planning metadata.',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_editing && !_readOnly) ...[
                  Row(
                    children: [
                      OutlinedButton.icon(
                        onPressed: _pickDate,
                        icon: const Icon(Icons.calendar_today, size: 16),
                        label: Text(
                          _primaryDate == null
                              ? 'Set date'
                              : DateFormatters.fullDate(
                                  _primaryDate,
                                  fallback: _primaryDate!,
                                ),
                        ),
                      ),
                      if (_primaryDate != null) ...[
                        const SizedBox(width: 8),
                        TextButton(
                          onPressed: () => setState(() => _primaryDate = null),
                          child: const Text('Clear'),
                        ),
                      ],
                    ],
                  ),
                ] else ...[
                  _MetaRow(label: 'Date', value: scheduleLabel),
                  if (widget.task.scheduledDate != null &&
                      widget.task.dueDate != null &&
                      widget.task.scheduledDate != widget.task.dueDate)
                    _MetaRow(
                      label: 'Due',
                      value: DateFormatters.fullDate(
                        widget.task.dueDate,
                        fallback: widget.task.dueDate!,
                      ),
                    ),
                ],
              ],
            ),
          ),
        ],
      ),
      aside: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _InspectorSection(
            title: 'People',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _MetaRow(
                  label: 'Created by',
                  value: ownerLabel ?? 'Rhythm workspace',
                ),
                if (_collaborators.isEmpty)
                  Text(
                    'No collaborators yet.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: colors.textSecondary,
                        ),
                  )
                else
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final collaborator in _collaborators)
                        _PeopleChip(
                          label: collaborator.name,
                          onDeleted: _editing &&
                                  !_readOnly &&
                                  !_updatingCollaborators &&
                                  widget.onRemoveCollaborator != null
                              ? () => _removeCollaborator(collaborator.userId)
                              : null,
                        ),
                    ],
                  ),
                if (_editing &&
                    !_readOnly &&
                    widget.onAddCollaborator != null &&
                    widget.workspaceMembers.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  RhythmButton.quiet(
                    onPressed:
                        _updatingCollaborators ? null : _showPeoplePicker,
                    icon: Icons.person_add_outlined,
                    label: _updatingCollaborators
                        ? 'Updating...'
                        : 'Add collaborator',
                    compact: true,
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 18),
          _InspectorSection(
            title: 'Metadata',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _MetaRow(
                  label: 'Status',
                  value: widget.task.status == 'done' ? 'Done' : 'Open',
                ),
                if (sourceLabel != null)
                  _MetaRow(label: 'Source', value: sourceLabel),
                if (widget.task.sourceName?.trim().isNotEmpty == true)
                  _MetaRow(
                      label: 'Feed', value: widget.task.sourceName!.trim()),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _readOnlyNotes(BuildContext context, String notes) {
    final colors = context.rhythm;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colors.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
      ),
      child: Text(
        notes.isEmpty ? 'No task details yet.' : notes,
        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: notes.isEmpty ? colors.textSecondary : colors.textPrimary,
              height: 1.5,
            ),
      ),
    );
  }

  Future<void> _pickDate() async {
    final initial = _primaryDate != null
        ? DateTime.tryParse(_primaryDate!) ?? DateTime.now()
        : DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );
    if (picked != null) {
      setState(() => _primaryDate = picked.toIso8601String().substring(0, 10));
    }
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
              child: Text(member.name),
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

  Future<void> _save() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;
    setState(() => _saving = true);
    final notes = _notesController.text.trim();
    try {
      await widget.onSaveDetails(
        RhythmTaskInspectorSaveRequest(
          title: title,
          notes: notes.isEmpty ? null : notes,
          dueDate: _usesScheduledDate ? widget.task.dueDate : _primaryDate,
          scheduledDate:
              _usesScheduledDate ? _primaryDate : widget.task.scheduledDate,
        ),
      );
      if (mounted) Navigator.of(context).pop();
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

class _RhythmProjectStepInspector extends StatefulWidget {
  const _RhythmProjectStepInspector({
    required this.step,
    required this.projectTitle,
    required this.projectOwnerLabel,
    required this.projectCollaborators,
    required this.workspaceMembers,
    required this.onSaveDetails,
  });

  final ProjectInstanceStep step;
  final String projectTitle;
  final String? projectOwnerLabel;
  final List<TaskCollaborator> projectCollaborators;
  final List<WorkspaceMember> workspaceMembers;
  final RhythmProjectStepInspectorSave onSaveDetails;

  @override
  State<_RhythmProjectStepInspector> createState() =>
      _RhythmProjectStepInspectorState();
}

class _RhythmProjectStepInspectorState
    extends State<_RhythmProjectStepInspector> {
  late final TextEditingController _titleController;
  late final TextEditingController _notesController;
  late String? _dueDate;
  late int? _assigneeId;
  bool _editing = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.step.title);
    _notesController = TextEditingController(text: widget.step.notes ?? '');
    _dueDate = widget.step.dueDate;
    _assigneeId = widget.step.assigneeId;
  }

  @override
  void dispose() {
    _titleController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return _RhythmInspectorShell(
      kicker: 'STEP INSPECTOR',
      title: _editing ? _titleController.text.trim() : widget.step.title,
      subtitle:
          'Inspect the next piece of work, review ownership, and update the step without leaving context.',
      icon: Icons.playlist_add_check_circle_outlined,
      accent: colors.warning,
      headerPills: [
        _headerPill(
          context,
          widget.step.status == 'done' ? 'Done' : 'Open',
          widget.step.status == 'done' ? colors.success : colors.warning,
        ),
        _headerPill(
          context,
          DateFormatters.fullDate(_dueDate,
              fallback: _dueDate ?? 'No due date'),
          colors.info,
        ),
      ],
      headerBody: _editing
          ? TextField(
              controller: _titleController,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Step title',
                border: OutlineInputBorder(),
              ),
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
              onChanged: (_) => setState(() {}),
            )
          : null,
      actions: [
        if (!_editing)
          RhythmButton.filled(
            onPressed: () => setState(() => _editing = true),
            icon: Icons.edit_outlined,
            label: 'Edit details',
            compact: true,
          ),
        if (_editing) ...[
          RhythmButton.quiet(
            onPressed: _saving
                ? null
                : () {
                    setState(() {
                      _editing = false;
                      _titleController.text = widget.step.title;
                      _notesController.text = widget.step.notes ?? '';
                      _dueDate = widget.step.dueDate;
                      _assigneeId = widget.step.assigneeId;
                    });
                  },
            label: 'Cancel',
            compact: true,
          ),
          RhythmButton.filled(
            onPressed: _saving ? null : _save,
            label: _saving ? 'Saving...' : 'Save changes',
            compact: true,
          ),
        ],
        RhythmButton.icon(
          onPressed: () => Navigator.of(context).pop(),
          icon: Icons.close,
          tooltip: 'Close inspector',
          compact: true,
        ),
      ],
      main: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _InspectorSection(
            title: 'Step Details',
            subtitle: _editing
                ? 'Notes, prep detail, and execution context for this step.'
                : 'The notes attached to this step.',
            child: _editing
                ? TextField(
                    controller: _notesController,
                    minLines: 8,
                    maxLines: 14,
                    decoration: const InputDecoration(
                      hintText:
                          'Add step notes, blockers, prep detail, or execution context...',
                      border: OutlineInputBorder(),
                    ),
                  )
                : _readOnlyNotes(context, _notesController.text.trim()),
          ),
          const SizedBox(height: 18),
          _InspectorSection(
            title: 'Schedule & Assignment',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_editing) ...[
                  Row(
                    children: [
                      OutlinedButton.icon(
                        onPressed: _pickDate,
                        icon: const Icon(Icons.calendar_today, size: 16),
                        label: Text(
                          _dueDate == null
                              ? 'Set due date'
                              : DateFormatters.fullDate(
                                  _dueDate,
                                  fallback: _dueDate!,
                                ),
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
                  const SizedBox(height: 12),
                  Text(
                    'Assignee',
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      border: Border.all(color: colors.borderSubtle),
                      borderRadius: BorderRadius.circular(RhythmRadius.sm),
                    ),
                    child: WorkspaceMemberPicker(
                      workspaceMembers: widget.workspaceMembers,
                      selectedUserId: _assigneeId,
                      onChanged: (value) => setState(() => _assigneeId = value),
                    ),
                  ),
                ] else ...[
                  _MetaRow(label: 'Project', value: widget.projectTitle),
                  _MetaRow(
                    label: 'Due',
                    value: DateFormatters.fullDate(
                      _dueDate,
                      fallback: _dueDate ?? 'No due date',
                    ),
                  ),
                  _MetaRow(
                    label: 'Assigned to',
                    value: _memberName(_assigneeId, widget.workspaceMembers) ??
                        widget.step.assigneeName ??
                        'Unassigned',
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
      aside: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _InspectorSection(
            title: 'People',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _MetaRow(
                  label: 'Project owner',
                  value: widget.projectOwnerLabel ?? 'Project owner',
                ),
                if (widget.projectCollaborators.isNotEmpty)
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final collaborator in widget.projectCollaborators)
                        _PeopleChip(label: collaborator.name),
                    ],
                  )
                else
                  Text(
                    'No additional collaborators on this project.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: colors.textSecondary,
                        ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          _InspectorSection(
            title: 'Metadata',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _MetaRow(label: 'Project', value: widget.projectTitle),
                _MetaRow(
                  label: 'Status',
                  value: widget.step.status == 'done' ? 'Done' : 'Open',
                ),
                _MetaRow(
                  label: 'Step ID',
                  value: widget.step.id,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _readOnlyNotes(BuildContext context, String notes) {
    final colors = context.rhythm;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colors.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
      ),
      child: Text(
        notes.isEmpty ? 'No step details yet.' : notes,
        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: notes.isEmpty ? colors.textSecondary : colors.textPrimary,
              height: 1.5,
            ),
      ),
    );
  }

  Future<void> _pickDate() async {
    final initial = _dueDate != null
        ? DateTime.tryParse(_dueDate!) ?? DateTime.now()
        : DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );
    if (picked != null) {
      setState(() => _dueDate = picked.toIso8601String().substring(0, 10));
    }
  }

  Future<void> _save() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;
    setState(() => _saving = true);
    final notes = _notesController.text.trim();
    try {
      await widget.onSaveDetails(
        RhythmProjectStepInspectorSaveRequest(
          title: title,
          notes: notes.isEmpty ? null : notes,
          dueDate: _dueDate,
          assigneeId: _assigneeId,
        ),
      );
      if (mounted) Navigator.of(context).pop();
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

Widget _headerPill(BuildContext context, String label, Color color) {
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.16),
      borderRadius: BorderRadius.circular(RhythmRadius.pill),
      border: Border.all(color: color.withValues(alpha: 0.24)),
    ),
    child: Text(
      label,
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: color,
            fontWeight: FontWeight.w700,
          ),
    ),
  );
}

String? _memberName(int? userId, List<WorkspaceMember> members) {
  if (userId == null) return null;
  for (final member in members) {
    if (member.userId == userId) return member.name;
  }
  return 'User #$userId';
}

String? _taskSourceLabel(Task task) {
  final sourceName = task.sourceName?.trim();
  if (sourceName != null && sourceName.isNotEmpty) return sourceName;
  return switch (task.sourceType) {
    'project_step' => 'Project step',
    'recurring_rule' => 'Rhythm',
    'calendar_shadow_event' => 'Calendar event',
    'automation_rule' => 'Automation',
    'planning_center_signal' => 'Planning Center',
    _ => null,
  };
}

String _initial(String label) {
  final trimmed = label.trim();
  if (trimmed.isEmpty) return '?';
  return trimmed[0].toUpperCase();
}
