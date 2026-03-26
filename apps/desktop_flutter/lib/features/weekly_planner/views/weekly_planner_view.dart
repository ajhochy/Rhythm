// ignore_for_file: use_build_context_synchronously
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../tasks/models/task.dart';
import '../controllers/weekly_planner_controller.dart';
import '../models/weekly_plan.dart';

class WeeklyPlannerView extends StatefulWidget {
  const WeeklyPlannerView({super.key});

  @override
  State<WeeklyPlannerView> createState() => _WeeklyPlannerViewState();
}

class _WeeklyPlannerViewState extends State<WeeklyPlannerView> {
  bool _showCompleted = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<WeeklyPlannerController>().load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<WeeklyPlannerController>(
      builder: (context, controller, _) {
        return Column(
          children: [
            _WeekHeader(
              controller: controller,
              showCompleted: _showCompleted,
              onToggleCompleted: () =>
                  setState(() => _showCompleted = !_showCompleted),
            ),
            if (controller.status == WeeklyPlannerStatus.error &&
                controller.errorMessage != null)
              _ErrorBanner(
                  message: controller.errorMessage!, onRetry: controller.load),
            Expanded(
              child: _PlannerBody(
                controller: controller,
                showCompleted: _showCompleted,
              ),
            ),
          ],
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

class _WeekHeader extends StatelessWidget {
  const _WeekHeader({
    required this.controller,
    required this.showCompleted,
    required this.onToggleCompleted,
  });
  final WeeklyPlannerController controller;
  final bool showCompleted;
  final VoidCallback onToggleCompleted;

  @override
  Widget build(BuildContext context) {
    final label = _formatWeekLabel(controller.currentWeekLabel);
    final hasSelection = controller.selectedTaskIds.isNotEmpty;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerLow,
        border:
            Border(bottom: BorderSide(color: Theme.of(context).dividerColor)),
      ),
      child: Wrap(
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        runSpacing: 8,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Weekly Planner',
                  style: Theme.of(context).textTheme.headlineSmall),
              if (hasSelection) ...[
                const SizedBox(width: 16),
                FilledButton.tonalIcon(
                  onPressed: () => controller.bulkToggleSelectedTasks(
                    [
                      ...?controller.plan?.days.expand((d) => d.tasks),
                      ...?controller.plan?.backlog,
                    ],
                    'done',
                  ),
                  icon: const Icon(Icons.checklist, size: 16),
                  label: Text('Complete ${controller.selectedTaskIds.length}'),
                ),
                const SizedBox(width: 8),
                TextButton(
                  onPressed: controller.clearTaskSelection,
                  child: const Text('Clear selection'),
                ),
              ],
            ],
          ),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
                icon: const Icon(Icons.chevron_left),
                tooltip: 'Previous week',
                onPressed: controller.goToPrevWeek,
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                child:
                    Text(label, style: Theme.of(context).textTheme.titleMedium),
              ),
              IconButton(
                icon: const Icon(Icons.chevron_right),
                tooltip: 'Next week',
                onPressed: controller.goToNextWeek,
              ),
              const SizedBox(width: 8),
              OutlinedButton(
                onPressed:
                    controller.isCurrentWeek ? null : controller.goToToday,
                child: const Text('Today'),
              ),
              const SizedBox(width: 16),
              TextButton.icon(
                onPressed: onToggleCompleted,
                icon: Icon(
                  showCompleted ? Icons.visibility_off : Icons.visibility,
                  size: 16,
                ),
                label:
                    Text(showCompleted ? 'Hide completed' : 'Show completed'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _formatWeekLabel(String label) {
    final m = RegExp(r'^(\d{4})-W(\d{1,2})$').firstMatch(label);
    if (m == null) return label;
    final year = int.parse(m.group(1)!);
    final week = int.parse(m.group(2)!);
    final jan4 = DateTime.utc(year, 1, 4);
    final mondayWeek1 = jan4.subtract(Duration(days: jan4.weekday - 1));
    final monday = mondayWeek1.add(Duration(days: (week - 1) * 7));
    const months = [
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
    return 'Week of ${months[monday.month - 1]} ${monday.day}, ${monday.year}';
  }
}

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 10),
      color: Theme.of(context).colorScheme.errorContainer,
      child: Row(
        children: [
          Icon(Icons.error_outline,
              color: Theme.of(context).colorScheme.onErrorContainer, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                  color: Theme.of(context).colorScheme.onErrorContainer,
                  fontSize: 13),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Three-pane body
// ---------------------------------------------------------------------------

class _PlannerBody extends StatelessWidget {
  const _PlannerBody({required this.controller, required this.showCompleted});
  final WeeklyPlannerController controller;
  final bool showCompleted;

  @override
  Widget build(BuildContext context) {
    if (controller.status == WeeklyPlannerStatus.loading &&
        controller.plan == null) {
      return const Center(child: CircularProgressIndicator());
    }
    final plan = controller.plan;
    if (plan == null) {
      return const Center(child: Text('No plan loaded.'));
    }

    final allTasks = [
      ...plan.days.expand((d) => d.tasks),
      ...plan.backlog,
    ];
    final selectedTask = controller.selectedTaskId != null
        ? allTasks.cast<Task?>().firstWhere(
            (t) => t?.id == controller.selectedTaskId,
            orElse: () => null)
        : null;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 220,
          child: _BacklogPane(
              plan: plan, controller: controller, showCompleted: showCompleted),
        ),
        VerticalDivider(width: 1, color: Theme.of(context).dividerColor),
        Expanded(
          child: _DayColumnsPane(
              plan: plan, controller: controller, showCompleted: showCompleted),
        ),
        if (selectedTask != null) ...[
          VerticalDivider(width: 1, color: Theme.of(context).dividerColor),
          SizedBox(
            width: 280,
            child: _DetailPane(
                key: ValueKey(selectedTask.id),
                task: selectedTask,
                controller: controller),
          ),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Backlog pane
// ---------------------------------------------------------------------------

class _BacklogPane extends StatelessWidget {
  const _BacklogPane(
      {required this.plan,
      required this.controller,
      required this.showCompleted});
  final WeeklyPlan plan;
  final WeeklyPlannerController controller;
  final bool showCompleted;

  @override
  Widget build(BuildContext context) {
    final backlog = showCompleted
        ? plan.backlog
        : plan.backlog.where((t) => t.status != 'done').toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Row(
            children: [
              Text('Unscheduled',
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(width: 6),
              if (backlog.isNotEmpty)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text('${backlog.length}',
                      style: Theme.of(context).textTheme.labelSmall),
                ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: Column(
            children: [
              Expanded(
                child: backlog.isEmpty
                    ? const Center(
                        child: Padding(
                        padding: EdgeInsets.all(16),
                        child: Text('No undated tasks',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Colors.grey, fontSize: 12)),
                      ))
                    : ListView.builder(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        itemCount: backlog.length,
                        itemBuilder: (context, i) => _TaskTile(
                          task: backlog[i],
                          controller: controller,
                          draggable: true,
                        ),
                      ),
              ),
              InkWell(
                onTap: () => _showAddBacklogTaskDialog(context),
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Row(
                    children: [
                      Icon(Icons.add, size: 13, color: Colors.grey[500]),
                      const SizedBox(width: 4),
                      Text('Add new task',
                          style:
                              TextStyle(fontSize: 12, color: Colors.grey[500])),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _showAddBacklogTaskDialog(BuildContext context) async {
    final ctrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add unscheduled task'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'Task title',
            border: OutlineInputBorder(),
          ),
          onSubmitted: (_) => Navigator.pop(ctx, true),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Add')),
        ],
      ),
    );
    if (confirmed == true && ctrl.text.trim().isNotEmpty) {
      await controller.createTask(ctrl.text.trim());
    }
  }
}

// ---------------------------------------------------------------------------
// Day columns pane
// ---------------------------------------------------------------------------

class _DayColumnsPane extends StatelessWidget {
  const _DayColumnsPane(
      {required this.plan,
      required this.controller,
      required this.showCompleted});
  final WeeklyPlan plan;
  final WeeklyPlannerController controller;
  final bool showCompleted;

  static const _dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: List.generate(plan.days.length, (i) {
        final day = plan.days[i];
        return Expanded(
          child: _DayColumn(
            dayName: _dayNames[i],
            date: day.date,
            tasks: plan.tasksForDate(day.date),
            controller: controller,
            showCompleted: showCompleted,
          ),
        );
      }),
    );
  }
}

class _DayColumn extends StatefulWidget {
  const _DayColumn({
    required this.dayName,
    required this.date,
    required this.tasks,
    required this.controller,
    required this.showCompleted,
  });
  final String dayName;
  final String date;
  final List<Task> tasks;
  final WeeklyPlannerController controller;
  final bool showCompleted;

  @override
  State<_DayColumn> createState() => _DayColumnState();
}

class _DayColumnState extends State<_DayColumn> {
  bool _hovering = false;

  bool _isToday() {
    final now = DateTime.now();
    final today =
        '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    return widget.date == today;
  }

  String _shortDate() {
    final parts = widget.date.split('-');
    if (parts.length != 3) return widget.date;
    return '${int.parse(parts[1])}/${int.parse(parts[2])}';
  }

  @override
  Widget build(BuildContext context) {
    final today = _isToday();
    final primaryColor = Theme.of(context).colorScheme.primary;

    return DragTarget<Task>(
      onWillAcceptWithDetails: (_) {
        setState(() => _hovering = true);
        return true;
      },
      onLeave: (_) => setState(() => _hovering = false),
      onAcceptWithDetails: (details) {
        setState(() => _hovering = false);
        widget.controller.scheduleTask(details.data, widget.date);
      },
      builder: (context, _, __) {
        return AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          decoration: BoxDecoration(
            color: _hovering
                ? Theme.of(context).colorScheme.tertiary.withValues(alpha: 0.08)
                : null,
            border: Border(
              right: BorderSide(color: Theme.of(context).dividerColor),
              top: today
                  ? BorderSide(color: primaryColor, width: 2)
                  : BorderSide.none,
            ),
          ),
          child: Column(
            children: [
              // Day header
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 8),
                color: Theme.of(context).colorScheme.surfaceContainerLow,
                child: Column(
                  children: [
                    Text(widget.dayName,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              fontWeight: FontWeight.bold,
                              color: today ? primaryColor : null,
                            )),
                    Text(_shortDate(),
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: today ? primaryColor : Colors.grey,
                            )),
                  ],
                ),
              ),
              Divider(
                  height: 1,
                  color: today
                      ? primaryColor.withValues(alpha: 0.4)
                      : Theme.of(context).dividerColor),
              // Tasks
              Expanded(
                child: Column(
                  children: [
                    Expanded(
                      child: () {
                        final displayTasks = widget.showCompleted
                            ? widget.tasks
                            : widget.tasks
                                .where((t) => t.status != 'done')
                                .toList();
                        return displayTasks.isEmpty
                            ? Center(
                                child: Text('—',
                                    style: TextStyle(color: Colors.grey[400])))
                            : ListView.builder(
                                padding: const EdgeInsets.all(6),
                                itemCount: displayTasks.length,
                                itemBuilder: (context, i) => _TaskTile(
                                  task: displayTasks[i],
                                  controller: widget.controller,
                                  draggable: true,
                                  compact: true,
                                ),
                              );
                      }(),
                    ),
                    // Inline add task
                    InkWell(
                      onTap: () => _showAddTaskDialog(context),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 4),
                        child: Row(
                          children: [
                            Icon(Icons.add, size: 12, color: Colors.grey[500]),
                            const SizedBox(width: 2),
                            Expanded(
                              child: Text('Add new task',
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                      fontSize: 10, color: Colors.grey[500])),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _showAddTaskDialog(BuildContext context) async {
    final ctrl = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Add task for ${widget.dayName}'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'Task title',
            border: OutlineInputBorder(),
          ),
          onSubmitted: (_) => Navigator.pop(ctx, true),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Add')),
        ],
      ),
    );
    if (confirmed == true && ctrl.text.trim().isNotEmpty) {
      await widget.controller
          .createTask(ctrl.text.trim(), dueDate: widget.date);
    }
  }
}

// ---------------------------------------------------------------------------
// Unified task tile — used in both backlog and day columns
// ---------------------------------------------------------------------------

class _TaskTile extends StatelessWidget {
  const _TaskTile({
    required this.task,
    required this.controller,
    this.draggable = false,
    this.compact = false,
  });
  final Task task;
  final WeeklyPlannerController controller;
  final bool draggable;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final card = _card(context);
    if (!draggable || task.sourceType == 'calendar_shadow_event') return card;
    return Draggable<Task>(
      data: task,
      feedback: Material(
        elevation: 4,
        borderRadius: BorderRadius.circular(6),
        child: Container(
          width: 160,
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.primaryContainer,
            borderRadius: BorderRadius.circular(6),
          ),
          child: Text(task.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.bodySmall),
        ),
      ),
      childWhenDragging: Opacity(opacity: 0.35, child: card),
      child: card,
    );
  }

  Widget _card(BuildContext context) {
    final isSelected = controller.selectedTaskId == task.id;
    final isMultiSelected = controller.selectedTaskIds.contains(task.id);
    final isDone = task.status == 'done';
    final isShadowEvent = task.sourceType == 'calendar_shadow_event';
    return GestureDetector(
      onTap: () => controller.selectTask(task.id),
      onLongPress:
          isShadowEvent ? null : () => controller.toggleTaskSelection(task.id),
      child: Container(
        margin: compact
            ? const EdgeInsets.only(bottom: 4)
            : const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        padding: EdgeInsets.symmetric(
            horizontal: compact ? 6 : 8, vertical: compact ? 3 : 8),
        decoration: BoxDecoration(
          color: isSelected || isMultiSelected
              ? Theme.of(context).colorScheme.primaryContainer
              : Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(
            color: isSelected || isMultiSelected
                ? Theme.of(context).colorScheme.primary
                : Colors.transparent,
          ),
        ),
        child: Row(
          children: [
            if (isMultiSelected && !compact) ...[
              Icon(Icons.done_all,
                  size: compact ? 12 : 14,
                  color: Theme.of(context).colorScheme.primary),
              const SizedBox(width: 4),
            ],
            // Completion checkbox
            SizedBox(
              width: compact ? 14 : 16,
              height: compact ? 14 : 16,
              child: Checkbox(
                value: isShadowEvent ? false : isDone,
                onChanged: isShadowEvent
                    ? null
                    : (_) => controller.toggleTaskDone(task, isDone),
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                visualDensity: compact
                    ? const VisualDensity(horizontal: -4, vertical: -4)
                    : VisualDensity.compact,
              ),
            ),
            SizedBox(width: compact ? 4 : 6),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (task.sourceName != null && task.sourceName!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 1),
                      child: Text(
                        task.sourceName!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: (compact
                                ? Theme.of(context).textTheme.labelSmall
                                : Theme.of(context).textTheme.bodySmall)
                            ?.copyWith(
                          fontSize: compact ? 9 : 10,
                          fontWeight: FontWeight.w700,
                          color: Theme.of(context).colorScheme.primary,
                        ),
                      ),
                    ),
                  Text(
                    task.title,
                    maxLines: compact ? 3 : 2,
                    overflow: TextOverflow.fade,
                    style: (compact
                            ? Theme.of(context).textTheme.labelSmall
                            : Theme.of(context).textTheme.bodySmall)
                        ?.copyWith(
                      decoration: isDone ? TextDecoration.lineThrough : null,
                      color: isDone ? Colors.grey : null,
                      fontSize: compact ? 10.5 : null,
                      height: compact ? 1.1 : null,
                    ),
                  ),
                ],
              ),
            ),
            if (task.locked && !compact) ...[
              const SizedBox(width: 4),
              Icon(Icons.lock,
                  size: compact ? 10 : 11,
                  color: Theme.of(context).colorScheme.primary),
            ],
            if (task.sourceType != null && !compact) ...[
              const SizedBox(width: 4),
              _SourceChip(sourceType: task.sourceType!),
            ],
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Detail pane — editable notes
// ---------------------------------------------------------------------------

class _DetailPane extends StatefulWidget {
  const _DetailPane({super.key, required this.task, required this.controller});
  final Task task;
  final WeeklyPlannerController controller;

  @override
  State<_DetailPane> createState() => _DetailPaneState();
}

class _DetailPaneState extends State<_DetailPane> {
  late TextEditingController _notesCtrl;
  bool _notesDirty = false;
  bool _saving = false;
  String? _dueDate;
  String? _scheduledDate;
  bool _datesDirty = false;

  @override
  void initState() {
    super.initState();
    _notesCtrl = TextEditingController();
    _notesCtrl.addListener(() => setState(
        () => _notesDirty = _notesCtrl.text != (widget.task.notes ?? '')));
    _syncFromTask();
  }

  @override
  void didUpdateWidget(covariant _DetailPane oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.task.id != widget.task.id ||
        oldWidget.task.notes != widget.task.notes ||
        oldWidget.task.dueDate != widget.task.dueDate ||
        oldWidget.task.scheduledDate != widget.task.scheduledDate ||
        oldWidget.task.status != widget.task.status) {
      _syncFromTask();
    }
  }

  @override
  void dispose() {
    _notesCtrl.dispose();
    super.dispose();
  }

  void _syncFromTask() {
    _notesCtrl.text = widget.task.notes ?? '';
    _dueDate = widget.task.dueDate;
    _scheduledDate = widget.task.scheduledDate;
    _notesDirty = false;
    _datesDirty = false;
  }

  Future<void> _saveDetailChanges() async {
    setState(() => _saving = true);
    await widget.controller.updateTask(
      widget.task,
      notes: _notesCtrl.text,
      dueDate: _datesDirty ? (_dueDate ?? '') : null,
      scheduledDate: widget.task.sourceType == 'project_step'
          ? null
          : _datesDirty
              ? (_scheduledDate ?? '')
              : null,
    );
    setState(() {
      _saving = false;
      _notesDirty = false;
      _datesDirty = false;
    });
  }

  String? get _plannerDate => _scheduledDate ?? _dueDate;

  Future<void> _pickPlannerDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate:
          _plannerDate != null ? DateTime.parse(_plannerDate!) : DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );
    if (picked == null) return;
    final value = picked.toIso8601String().substring(0, 10);
    setState(() {
      if (widget.task.sourceType == 'project_step') {
        _dueDate = value;
      } else if (widget.task.scheduledDate != null ||
          widget.task.dueDate == null) {
        _scheduledDate = value;
      } else {
        _dueDate = value;
      }
      _datesDirty = _dueDate != widget.task.dueDate ||
          _scheduledDate != widget.task.scheduledDate;
    });
  }

  void _clearPlannerDate() {
    setState(() {
      if (widget.task.sourceType == 'project_step') {
        _dueDate = null;
      } else if (widget.task.scheduledDate != null ||
          widget.task.dueDate == null) {
        _scheduledDate = null;
      } else {
        _dueDate = null;
      }
      _datesDirty = _dueDate != widget.task.dueDate ||
          _scheduledDate != widget.task.scheduledDate;
    });
  }

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final isDone = task.status == 'done';
    final isShadowEvent = task.sourceType == 'calendar_shadow_event';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Header
        Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerLow,
            border: Border(
                bottom: BorderSide(color: Theme.of(context).dividerColor)),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text('Task Details',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.bold)),
              ),
              IconButton(
                icon: const Icon(Icons.close, size: 18),
                onPressed: () => widget.controller.selectTask(null),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ],
          ),
        ),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(task.title,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          decoration:
                              isDone ? TextDecoration.lineThrough : null,
                          color: isDone ? Colors.grey : null,
                        )),
                const SizedBox(height: 4),
                // Quick complete toggle
                if (!isShadowEvent)
                  TextButton.icon(
                    icon: Icon(
                        isDone
                            ? Icons.check_circle
                            : Icons.radio_button_unchecked,
                        size: 16),
                    label: Text(isDone ? 'Mark open' : 'Mark done'),
                    style: TextButton.styleFrom(
                      padding: EdgeInsets.zero,
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    onPressed: () =>
                        widget.controller.toggleTaskDone(task, isDone),
                  ),
                const SizedBox(height: 12),
                if (!isShadowEvent)
                  _editableDateRow(
                    context,
                    label: 'Date',
                    value: _plannerDate,
                    onPick: _pickPlannerDate,
                    onClear: () => _clearPlannerDate(),
                  ),
                if (isShadowEvent && _plannerDate != null)
                  _row(context, 'Date', _plannerDate!),
                if (task.sourceType != null)
                  _row(context, 'Source', _sourceLabel(task.sourceType!)),
                if (task.sourceName != null && task.sourceName!.isNotEmpty)
                  _row(context, isShadowEvent ? 'Calendar' : 'Project',
                      task.sourceName!),
                const SizedBox(height: 16),
                Text(
                  isShadowEvent ? 'Details' : 'Notes',
                  style: Theme.of(context)
                      .textTheme
                      .labelSmall
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 6),
                if (isShadowEvent)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      border: Border.all(color: Theme.of(context).dividerColor),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      task.notes?.isNotEmpty == true
                          ? task.notes!
                          : 'No additional details.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  )
                else
                  TextField(
                    controller: _notesCtrl,
                    decoration: const InputDecoration(
                      hintText: 'Add a note...',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                    minLines: 3,
                    maxLines: 8,
                  ),
                const SizedBox(height: 8),
                if (!isShadowEvent && (_notesDirty || _datesDirty))
                  Row(
                    children: [
                      FilledButton.tonal(
                        onPressed: _saving ? null : _saveDetailChanges,
                        child: _saving
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2))
                            : const Text('Save'),
                      ),
                      const SizedBox(width: 8),
                      TextButton(
                        onPressed: _saving
                            ? null
                            : () => setState(() {
                                  _notesCtrl.text = widget.task.notes ?? '';
                                  _dueDate = widget.task.dueDate;
                                  _scheduledDate = widget.task.scheduledDate;
                                  _notesDirty = false;
                                  _datesDirty = false;
                                }),
                        child: const Text('Discard'),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _row(BuildContext context, String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          SizedBox(
            width: 76,
            child: Text(label,
                style: Theme.of(context)
                    .textTheme
                    .labelSmall
                    ?.copyWith(color: Colors.grey)),
          ),
          Expanded(
              child: Text(value, style: Theme.of(context).textTheme.bodySmall)),
        ],
      ),
    );
  }

  Widget _editableDateRow(BuildContext context,
      {required String label,
      required String? value,
      required VoidCallback onPick,
      required VoidCallback? onClear}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 76,
            child: Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(label,
                  style: Theme.of(context)
                      .textTheme
                      .labelSmall
                      ?.copyWith(color: Colors.grey)),
            ),
          ),
          Expanded(
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: onPick,
                  icon: const Icon(Icons.calendar_today, size: 14),
                  label: Text(value ?? 'Set date'),
                ),
                if (value != null && onClear != null)
                  TextButton(onPressed: onClear, child: const Text('Clear')),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _sourceLabel(String t) => switch (t) {
        'recurring_rule' => 'Rhythm',
        'project_step' => 'Project',
        'calendar_shadow_event' => 'Calendar',
        'planning_center_signal' => 'Planning Center',
        _ => t,
      };
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

class _SourceChip extends StatelessWidget {
  const _SourceChip({required this.sourceType});
  final String sourceType;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (sourceType) {
      'recurring_rule' => ('R', Colors.blue),
      'project_step' => ('P', Colors.green),
      'calendar_shadow_event' => ('C', Colors.orange),
      'planning_center_signal' => ('PC', Colors.red),
      _ => ('T', Colors.grey),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(3),
      ),
      child: Text(label,
          style: TextStyle(
              fontSize: 9.5, fontWeight: FontWeight.bold, color: color)),
    );
  }
}
