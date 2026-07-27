import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/tasks_controller.dart';

/// Quick Add tab — lightweight single-screen task capture.
///
/// Title is required (non-whitespace). Notes and due date are optional.
/// Due date defaults to today. On successful save, calls [onTaskCreated]
/// so the parent shell can bounce back to the Today tab.
class QuickAddView extends StatefulWidget {
  const QuickAddView({
    super.key,
    required this.onTaskCreated,
    this.now,
  });

  final VoidCallback onTaskCreated;

  /// Injectable wall clock for deterministic date-rollover verification.
  ///
  /// Production callers leave this null and use the device's local time.
  final DateTime Function()? now;

  @override
  State<QuickAddView> createState() => QuickAddViewState();
}

class QuickAddViewState extends State<QuickAddView>
    with WidgetsBindingObserver {
  final _titleController = TextEditingController();
  final _notesController = TextEditingController();
  final _titleFocus = FocusNode();

  DateTime? _dueDate;
  bool _tracksTodayDefault = true;

  bool _isSaving = false;
  String? _inlineError;

  DateTime _today() {
    final now = widget.now?.call() ?? DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _dueDate = _today();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _titleController.dispose();
    _notesController.dispose();
    _titleFocus.dispose();
    super.dispose();
  }

  /// Called by AppShell via a key when the Add tab becomes active.
  ///
  /// Refreshes the implicit due-date default and requests focus so the
  /// keyboard opens automatically.
  void requestTitleFocus() {
    _refreshTrackedToday();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _titleFocus.requestFocus();
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshTrackedToday();
    }
  }

  bool _isSameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  /// Advances only the implicit "today" default across midnight.
  ///
  /// A date chosen (or cleared) by the user is explicit state and must survive
  /// tab changes and foreground resumes unchanged.
  void _refreshTrackedToday() {
    if (!_tracksTodayDefault || !mounted) return;
    final today = _today();
    final dueDate = _dueDate;
    if (dueDate != null && _isSameDay(dueDate, today)) return;
    setState(() => _dueDate = today);
  }

  bool get _canSave => _titleController.text.trim().isNotEmpty && !_isSaving;

  static const _monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  String _formatDisplayDate(DateTime d) =>
      '${_monthNames[d.month - 1]} ${d.day}, ${d.year}';

  String? _dueDateString() {
    if (_dueDate == null) return null;
    final d = _dueDate!;
    final mm = d.month.toString().padLeft(2, '0');
    final dd = d.day.toString().padLeft(2, '0');
    return '${d.year}-$mm-$dd';
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _dueDate ?? _today(),
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null) {
      setState(() {
        _dueDate = picked;
        _tracksTodayDefault = false;
      });
    }
  }

  void _clearDate() => setState(() {
        _dueDate = null;
        _tracksTodayDefault = false;
      });

  Future<void> _save() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;

    // The Add tab may remain visible across midnight without a lifecycle or
    // tab-selection event. Refresh immediately before serializing as a final
    // guard against submitting yesterday's implicit default.
    _refreshTrackedToday();

    setState(() {
      _isSaving = true;
      _inlineError = null;
    });

    final controller = context.read<TasksController>();
    final task = await controller.createTask(
      title: title,
      notes:
          _notesController.text.trim().isEmpty ? null : _notesController.text,
      dueDate: _dueDateString(),
    );

    if (!mounted) return;

    if (task != null) {
      // Success: reset the form and bounce to Today.
      _titleController.clear();
      _notesController.clear();
      setState(() {
        _dueDate = _today();
        _tracksTodayDefault = true;
        _isSaving = false;
        _inlineError = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Task added')),
      );
      widget.onTaskCreated();
    } else {
      // Failure: preserve form contents and show inline error.
      setState(() {
        _isSaving = false;
        _inlineError = controller.errorMessage ?? 'Failed to create task.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final theme = Theme.of(context);

    final dueDateLabel =
        _dueDate == null ? 'No due date' : _formatDisplayDate(_dueDate!);

    return Scaffold(
      backgroundColor: colors.canvas,
      appBar: AppBar(
        title: Text('Quick Add', style: theme.textTheme.headlineSmall),
        actions: [
          ValueListenableBuilder<TextEditingValue>(
            valueListenable: _titleController,
            builder: (context, value, _) {
              final enabled = value.text.trim().isNotEmpty && !_isSaving;
              return TextButton(
                onPressed: enabled ? _save : null,
                child: _isSaving
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        'Save',
                        style: TextStyle(
                          color: enabled ? colors.accent : colors.textMuted,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
              );
            },
          ),
          const SizedBox(width: RhythmSpacing.xs),
        ],
      ),
      body: GestureDetector(
        onTap: () => FocusScope.of(context).unfocus(),
        child: ListView(
          padding: const EdgeInsets.all(RhythmSpacing.md),
          children: [
            // Title field.
            TextField(
              controller: _titleController,
              focusNode: _titleFocus,
              autofocus: true,
              textCapitalization: TextCapitalization.sentences,
              style: theme.textTheme.titleLarge?.copyWith(
                color: colors.textPrimary,
              ),
              decoration: InputDecoration(
                hintText: 'Task title',
                hintStyle: theme.textTheme.titleLarge?.copyWith(
                  color: colors.textMuted,
                ),
                border: InputBorder.none,
              ),
              onSubmitted: (_) {
                if (_canSave) _save();
              },
            ),
            Divider(color: colors.border, height: 1),
            const SizedBox(height: RhythmSpacing.md),

            // Notes field.
            TextField(
              controller: _notesController,
              maxLines: null,
              keyboardType: TextInputType.multiline,
              textCapitalization: TextCapitalization.sentences,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: colors.textPrimary,
              ),
              decoration: InputDecoration(
                hintText: 'Notes (optional)',
                hintStyle: theme.textTheme.bodyMedium?.copyWith(
                  color: colors.textMuted,
                ),
                border: InputBorder.none,
              ),
            ),
            const SizedBox(height: RhythmSpacing.lg),

            // Due date selector.
            Row(
              children: [
                Icon(Icons.calendar_today_outlined,
                    size: 18, color: colors.textSecondary),
                const SizedBox(width: RhythmSpacing.xs),
                GestureDetector(
                  onTap: _pickDate,
                  child: Text(
                    dueDateLabel,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: _dueDate != null
                          ? colors.accent
                          : colors.textSecondary,
                    ),
                  ),
                ),
                if (_dueDate != null) ...[
                  const SizedBox(width: RhythmSpacing.xs),
                  GestureDetector(
                    onTap: _clearDate,
                    child: Icon(Icons.close, size: 16, color: colors.textMuted),
                  ),
                ],
              ],
            ),
            const SizedBox(height: RhythmSpacing.lg),

            // Inline error.
            if (_inlineError != null)
              Padding(
                padding: const EdgeInsets.only(bottom: RhythmSpacing.md),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.error_outline, size: 16, color: colors.danger),
                    const SizedBox(width: RhythmSpacing.xs),
                    Expanded(
                      child: Text(
                        _inlineError!,
                        style: theme.textTheme.bodySmall
                            ?.copyWith(color: colors.danger),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
