import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../../app/core/utils/time_format.dart';
import '../../agent_configs/controllers/agent_configs_controller.dart';
import '../../agents/models/agent_session.dart';
import '../../notifications/controllers/notifications_controller.dart';
import '../controllers/agent_schedules_controller.dart';
import '../models/agent_scheduled_task.dart';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

class AgentSchedulesView extends StatefulWidget {
  const AgentSchedulesView({super.key});

  @override
  State<AgentSchedulesView> createState() => _AgentSchedulesViewState();
}

/// #902 — sort keys for the Scheduled Tasks list.
enum _ScheduleSortField { name, nextRun, scheduleType, enabled }

class _AgentSchedulesViewState extends State<AgentSchedulesView> {
  final _searchCtrl = TextEditingController();
  String _searchQuery = '';
  _ScheduleSortField _sortField = _ScheduleSortField.name;
  bool _sortAscending = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AgentSchedulesController>().refresh();
    });
    _searchCtrl.addListener(() {
      setState(() => _searchQuery = _searchCtrl.text);
    });
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  /// #902 — live substring match by name, then sort by the selected field.
  List<AgentScheduledTask> _visibleTasks(List<AgentScheduledTask> tasks) {
    final query = _searchQuery.trim().toLowerCase();
    final filtered = query.isEmpty
        ? tasks
        : tasks.where((t) => t.name.toLowerCase().contains(query)).toList();

    final sorted = [...filtered];
    int compare(AgentScheduledTask a, AgentScheduledTask b) {
      switch (_sortField) {
        case _ScheduleSortField.name:
          return a.name.toLowerCase().compareTo(b.name.toLowerCase());
        case _ScheduleSortField.nextRun:
          // Tasks with no next run sort last regardless of direction.
          if (a.nextRunAt == null && b.nextRunAt == null) return 0;
          if (a.nextRunAt == null) return 1;
          if (b.nextRunAt == null) return -1;
          return a.nextRunAt!.compareTo(b.nextRunAt!);
        case _ScheduleSortField.scheduleType:
          return a.scheduleType.compareTo(b.scheduleType);
        case _ScheduleSortField.enabled:
          return (a.enabled ? 0 : 1).compareTo(b.enabled ? 0 : 1);
      }
    }

    sorted.sort(compare);
    if (!_sortAscending) return sorted.reversed.toList();
    return sorted;
  }

  Future<void> _confirmDelete(
    BuildContext context,
    AgentScheduledTask task,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: ctx.rhythm.surface,
        title: Text(
          'Delete Schedule',
          style: TextStyle(color: ctx.rhythm.textPrimary),
        ),
        content: Text(
          'Delete "${task.name}"? This cannot be undone.',
          style: TextStyle(color: ctx.rhythm.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(
              'Cancel',
              style: TextStyle(color: ctx.rhythm.textMuted),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text('Delete', style: TextStyle(color: ctx.rhythm.danger)),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      await context.read<AgentSchedulesController>().delete(task.id);
    }
  }

  void _showEnableSheet(BuildContext context, AgentScheduledTask task) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: context.rhythm.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(RhythmRadius.lg),
        ),
      ),
      builder: (ctx) => _EnableToggleSheet(task: task),
    );
  }

  void _showDetailSheet(BuildContext context, AgentScheduledTask task) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: context.rhythm.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(RhythmRadius.lg),
        ),
      ),
      builder: (ctx) => _TaskDetailSheet(
        task: task,
        onEdit: () => _showEditScheduleSheet(context, task),
      ),
    );
  }

  void _showNewScheduleSheet(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: context.rhythm.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(RhythmRadius.lg),
        ),
      ),
      builder: (ctx) => const _ScheduleFormSheet(),
    );
  }

  void _showEditScheduleSheet(BuildContext context, AgentScheduledTask task) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: context.rhythm.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(RhythmRadius.lg),
        ),
      ),
      builder: (ctx) => _ScheduleFormSheet(existing: task),
    );
  }

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final controller = context.watch<AgentSchedulesController>();

    return Scaffold(
      backgroundColor: rhythm.canvas,
      appBar: AppBar(
        backgroundColor: rhythm.surface,
        elevation: 0,
        title: Text(
          'Scheduled Tasks',
          style: TextStyle(
            color: rhythm.textPrimary,
            fontWeight: FontWeight.w600,
            fontSize: 18,
          ),
        ),
        actions: [
          if (controller.status == AgentSchedulesStatus.idle)
            IconButton(
              icon: Icon(Icons.refresh_rounded, color: rhythm.textSecondary),
              tooltip: 'Refresh',
              onPressed: () => controller.refresh(),
            ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: rhythm.accent,
        foregroundColor: Colors.white,
        tooltip: 'New Schedule',
        onPressed: () => _showNewScheduleSheet(context),
        child: const Icon(Icons.add_rounded),
      ),
      body: _buildBody(context, controller),
    );
  }

  Widget _buildBody(BuildContext context, AgentSchedulesController controller) {
    final rhythm = context.rhythm;

    if (controller.status == AgentSchedulesStatus.loading &&
        controller.tasks.isEmpty) {
      return Center(child: CircularProgressIndicator(color: rhythm.accent));
    }

    if (controller.status == AgentSchedulesStatus.error &&
        controller.tasks.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline_rounded, color: rhythm.danger, size: 48),
            const SizedBox(height: RhythmSpacing.md),
            Text(
              controller.error ?? 'An error occurred',
              style: TextStyle(color: rhythm.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: RhythmSpacing.md),
            FilledButton(
              onPressed: () => controller.refresh(),
              style: FilledButton.styleFrom(backgroundColor: rhythm.accent),
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (controller.tasks.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.schedule_rounded, color: rhythm.textMuted, size: 56),
            const SizedBox(height: RhythmSpacing.md),
            Text(
              'No scheduled tasks yet',
              style: TextStyle(
                color: rhythm.textSecondary,
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: RhythmSpacing.xs),
            Text(
              'Tap + to create your first schedule',
              style: TextStyle(color: rhythm.textMuted, fontSize: 13),
            ),
          ],
        ),
      );
    }

    final visible = _visibleTasks(controller.tasks);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            RhythmSpacing.md,
            RhythmSpacing.md,
            RhythmSpacing.md,
            0,
          ),
          child: _SearchAndSortBar(
            searchController: _searchCtrl,
            sortField: _sortField,
            sortAscending: _sortAscending,
            onSortFieldChanged: (field) => setState(() => _sortField = field),
            onToggleDirection: () =>
                setState(() => _sortAscending = !_sortAscending),
          ),
        ),
        Expanded(
          child: visible.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.search_off_rounded,
                        color: rhythm.textMuted,
                        size: 40,
                      ),
                      const SizedBox(height: RhythmSpacing.sm),
                      Text(
                        'No tasks match "${_searchQuery.trim()}"',
                        style: TextStyle(color: rhythm.textSecondary),
                      ),
                    ],
                  ),
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(RhythmSpacing.md),
                  itemCount: visible.length,
                  separatorBuilder: (_, __) =>
                      const SizedBox(height: RhythmSpacing.xs),
                  itemBuilder: (context, index) {
                    final task = visible[index];
                    return _TaskTile(
                      task: task,
                      onTap: () => _showDetailSheet(context, task),
                      onLongPress: () => _showEnableSheet(context, task),
                      onDelete: () => _confirmDelete(context, task),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// #902 — Search + sort bar
// ---------------------------------------------------------------------------

class _SearchAndSortBar extends StatelessWidget {
  const _SearchAndSortBar({
    required this.searchController,
    required this.sortField,
    required this.sortAscending,
    required this.onSortFieldChanged,
    required this.onToggleDirection,
  });

  final TextEditingController searchController;
  final _ScheduleSortField sortField;
  final bool sortAscending;
  final ValueChanged<_ScheduleSortField> onSortFieldChanged;
  final VoidCallback onToggleDirection;

  static const _sortLabels = {
    _ScheduleSortField.name: 'Name',
    _ScheduleSortField.nextRun: 'Next run',
    _ScheduleSortField.scheduleType: 'Schedule type',
    _ScheduleSortField.enabled: 'Enabled status',
  };

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    return Row(
      children: [
        Expanded(
          child: TextField(
            key: const ValueKey('schedule-search-field'),
            controller: searchController,
            style: TextStyle(color: rhythm.textPrimary, fontSize: 13),
            decoration: InputDecoration(
              hintText: 'Search by name…',
              hintStyle: TextStyle(color: rhythm.textMuted),
              prefixIcon: Icon(
                Icons.search_rounded,
                color: rhythm.textMuted,
                size: 18,
              ),
              isDense: true,
              filled: true,
              fillColor: rhythm.surfaceMuted,
              contentPadding: const EdgeInsets.symmetric(
                vertical: 10,
                horizontal: 8,
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                borderSide: BorderSide(color: rhythm.borderSubtle),
              ),
            ),
          ),
        ),
        const SizedBox(width: RhythmSpacing.sm),
        PopupMenuButton<_ScheduleSortField>(
          key: const ValueKey('schedule-sort-menu'),
          tooltip: 'Sort by',
          initialValue: sortField,
          onSelected: onSortFieldChanged,
          itemBuilder: (context) => _sortLabels.entries
              .map((e) => PopupMenuItem(value: e.key, child: Text(e.value)))
              .toList(),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: rhythm.surfaceMuted,
              borderRadius: BorderRadius.circular(RhythmRadius.sm),
              border: Border.all(color: rhythm.borderSubtle),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.sort_rounded, size: 16, color: rhythm.textSecondary),
                const SizedBox(width: 4),
                Text(
                  _sortLabels[sortField]!,
                  style: TextStyle(color: rhythm.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 4),
        IconButton(
          key: const ValueKey('schedule-sort-direction'),
          tooltip: sortAscending ? 'Ascending' : 'Descending',
          icon: Icon(
            sortAscending
                ? Icons.arrow_upward_rounded
                : Icons.arrow_downward_rounded,
            size: 18,
            color: rhythm.textSecondary,
          ),
          onPressed: onToggleDirection,
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Task tile
// ---------------------------------------------------------------------------

class _TaskTile extends StatelessWidget {
  const _TaskTile({
    required this.task,
    required this.onTap,
    required this.onLongPress,
    required this.onDelete,
  });

  final AgentScheduledTask task;
  final VoidCallback onTap;
  final VoidCallback onLongPress;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;

    return Dismissible(
      key: ValueKey(task.id),
      direction: DismissDirection.endToStart,
      confirmDismiss: (_) async {
        onDelete();
        return false; // Deletion handled by onDelete callback
      },
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: RhythmSpacing.lg),
        decoration: BoxDecoration(
          color: rhythm.danger,
          borderRadius: BorderRadius.circular(RhythmRadius.md),
        ),
        child: const Icon(Icons.delete_outline_rounded, color: Colors.white),
      ),
      child: GestureDetector(
        onTap: onTap,
        onLongPress: onLongPress,
        child: Container(
          decoration: BoxDecoration(
            color: rhythm.surfaceRaised,
            borderRadius: BorderRadius.circular(RhythmRadius.md),
            border: Border.all(color: rhythm.borderSubtle),
            boxShadow: RhythmElevation.panel,
          ),
          padding: const EdgeInsets.all(RhythmSpacing.md),
          child: Row(
            children: [
              // Status indicator dot
              Container(
                width: 8,
                height: 8,
                margin: const EdgeInsets.only(right: RhythmSpacing.sm),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: task.enabled ? rhythm.success : rhythm.textMuted,
                ),
              ),
              // Main content
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            task.name,
                            style: TextStyle(
                              color: rhythm.textPrimary,
                              fontWeight: FontWeight.w600,
                              fontSize: 14,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        _EnabledBadge(enabled: task.enabled),
                        if (task.lastRunStatus != null) ...[
                          const SizedBox(width: 4),
                          _StatusChip(status: task.lastRunStatus!),
                        ],
                      ],
                    ),
                    const SizedBox(height: RhythmSpacing.xxs),
                    Row(
                      children: [
                        Icon(
                          Icons.schedule_rounded,
                          size: 12,
                          color: rhythm.textMuted,
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Text(
                            task.scheduleLabel,
                            style: TextStyle(
                              color: rhythm.textSecondary,
                              fontSize: 12,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                    if (task.nextRunAt != null) ...[
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          Icon(
                            Icons.arrow_forward_rounded,
                            size: 12,
                            color: rhythm.textMuted,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            'Next: ${_formatDateTime(task.nextRunAt!)}',
                            style: TextStyle(
                              color: rhythm.textMuted,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              Icon(
                Icons.chevron_right_rounded,
                color: rhythm.textMuted,
                size: 20,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// #902 — Enabled/disabled badge
// ---------------------------------------------------------------------------

class _EnabledBadge extends StatelessWidget {
  const _EnabledBadge({required this.enabled});

  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final color = enabled ? rhythm.success : rhythm.textMuted;
    return Container(
      key: ValueKey(
        enabled ? 'schedule-badge-enabled' : 'schedule-badge-disabled',
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(RhythmRadius.pill),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        enabled ? 'Enabled' : 'Disabled',
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    Color chipColor;
    String label;

    switch (status) {
      case 'success':
        chipColor = rhythm.success;
        label = 'Success';
      case 'error':
        chipColor = rhythm.danger;
        label = 'Error';
      case 'running':
        chipColor = rhythm.info;
        label = 'Running';
      default:
        chipColor = rhythm.textMuted;
        label = status;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: chipColor.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(RhythmRadius.pill),
        border: Border.all(color: chipColor.withValues(alpha: 0.4)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: chipColor,
          fontSize: 10,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Enable toggle sheet (long press)
// ---------------------------------------------------------------------------

class _EnableToggleSheet extends StatelessWidget {
  const _EnableToggleSheet({required this.task});

  final AgentScheduledTask task;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final controller = context.read<AgentSchedulesController>();

    return Padding(
      padding: const EdgeInsets.all(RhythmSpacing.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            task.name,
            style: TextStyle(
              color: rhythm.textPrimary,
              fontWeight: FontWeight.w700,
              fontSize: 16,
            ),
          ),
          const SizedBox(height: RhythmSpacing.md),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(
              task.enabled
                  ? Icons.pause_circle_outline_rounded
                  : Icons.play_circle_outline_rounded,
              color: task.enabled ? rhythm.warning : rhythm.success,
            ),
            title: Text(
              task.enabled ? 'Pause Schedule' : 'Resume Schedule',
              style: TextStyle(color: rhythm.textPrimary),
            ),
            subtitle: Text(
              task.enabled
                  ? 'Temporarily disable this task'
                  : 'Re-enable this task',
              style: TextStyle(color: rhythm.textMuted, fontSize: 12),
            ),
            onTap: () async {
              Navigator.pop(context);
              await controller.update(task.id, {'enabled': !task.enabled});
            },
          ),
          const SizedBox(height: RhythmSpacing.sm),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Task detail sheet
// ---------------------------------------------------------------------------

class _TaskDetailSheet extends StatefulWidget {
  const _TaskDetailSheet({required this.task, required this.onEdit});

  final AgentScheduledTask task;
  final VoidCallback onEdit;

  @override
  State<_TaskDetailSheet> createState() => _TaskDetailSheetState();
}

class _TaskDetailSheetState extends State<_TaskDetailSheet> {
  bool _triggering = false;

  Future<void> _triggerNow() async {
    setState(() => _triggering = true);
    try {
      await context.read<AgentSchedulesController>().triggerNow(widget.task.id);
      if (mounted) {
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('${widget.task.name} triggered'),
            backgroundColor: context.rhythm.success,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            backgroundColor: context.rhythm.danger,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _triggering = false);
    }
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: ctx.rhythm.surface,
        title: Text(
          'Delete Schedule',
          style: TextStyle(color: ctx.rhythm.textPrimary),
        ),
        content: Text(
          'Delete "${widget.task.name}"? This cannot be undone.',
          style: TextStyle(color: ctx.rhythm.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(
              'Cancel',
              style: TextStyle(color: ctx.rhythm.textMuted),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text('Delete', style: TextStyle(color: ctx.rhythm.danger)),
          ),
        ],
      ),
    );
    if (confirmed == true && mounted) {
      await context.read<AgentSchedulesController>().delete(widget.task.id);
      if (mounted) Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final task = widget.task;

    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      minChildSize: 0.4,
      maxChildSize: 0.95,
      expand: false,
      builder: (_, scrollController) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: RhythmSpacing.lg),
        child: ListView(
          controller: scrollController,
          children: [
            const SizedBox(height: RhythmSpacing.sm),
            // Handle
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: rhythm.border,
                  borderRadius: BorderRadius.circular(RhythmRadius.pill),
                ),
              ),
            ),
            const SizedBox(height: RhythmSpacing.lg),
            // Title row
            Row(
              children: [
                Expanded(
                  child: Text(
                    task.name,
                    style: TextStyle(
                      color: rhythm.textPrimary,
                      fontWeight: FontWeight.w700,
                      fontSize: 18,
                    ),
                  ),
                ),
                if (task.lastRunStatus != null)
                  _StatusChip(status: task.lastRunStatus!),
              ],
            ),
            if (task.description != null) ...[
              const SizedBox(height: RhythmSpacing.xs),
              Text(
                task.description!,
                style: TextStyle(color: rhythm.textSecondary, fontSize: 13),
              ),
            ],
            const SizedBox(height: RhythmSpacing.md),
            _detailDivider(rhythm),
            _detailRow(rhythm, 'Schedule', task.scheduleLabel),
            _detailRow(rhythm, 'Agent', task.agentKind),
            _detailRow(rhythm, 'Timezone', task.timezone),
            if (task.nextRunAt != null)
              _detailRow(rhythm, 'Next Run', _formatDateTime(task.nextRunAt!)),
            if (task.lastRunAt != null)
              _detailRow(rhythm, 'Last Run', _formatDateTime(task.lastRunAt!)),
            if (task.lastError != null) ...[
              const SizedBox(height: RhythmSpacing.sm),
              Container(
                padding: const EdgeInsets.all(RhythmSpacing.sm),
                decoration: BoxDecoration(
                  color: rhythm.danger.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                  border: Border.all(
                    color: rhythm.danger.withValues(alpha: 0.3),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'LAST ERROR',
                      style: TextStyle(
                        color: rhythm.danger,
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 0.8,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      task.lastError!,
                      style: TextStyle(
                        color: rhythm.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ],
            _detailDivider(rhythm),
            // Prompt section
            Text(
              'PROMPT',
              style: TextStyle(
                color: rhythm.textSecondary,
                fontSize: 10,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.8,
              ),
            ),
            const SizedBox(height: RhythmSpacing.xs),
            Container(
              padding: const EdgeInsets.all(RhythmSpacing.sm),
              decoration: BoxDecoration(
                color: rhythm.surfaceMuted,
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                border: Border.all(color: rhythm.borderSubtle),
              ),
              child: Text(
                task.prompt,
                style: TextStyle(
                  color: rhythm.textSecondary,
                  fontSize: 12,
                  height: 1.5,
                ),
              ),
            ),
            _detailDivider(rhythm),
            // #904 — activity log: what actually happened on recent runs, not
            // just the run/no-run status already shown above.
            Text(
              'ACTIVITY',
              style: TextStyle(
                color: rhythm.textSecondary,
                fontSize: 10,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.8,
              ),
            ),
            const SizedBox(height: RhythmSpacing.xs),
            _ActivityLog(taskId: task.id),
            const SizedBox(height: RhythmSpacing.lg),
            // Actions
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _delete,
                    icon: Icon(
                      Icons.delete_outline_rounded,
                      color: rhythm.danger,
                      size: 18,
                    ),
                    label: Text(
                      'Delete',
                      style: TextStyle(color: rhythm.danger),
                    ),
                    style: OutlinedButton.styleFrom(
                      side: BorderSide(
                        color: rhythm.danger.withValues(alpha: 0.5),
                      ),
                      padding: const EdgeInsets.symmetric(
                        vertical: RhythmSpacing.sm,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: RhythmSpacing.sm),
                Expanded(
                  child: OutlinedButton.icon(
                    key: const ValueKey('edit-schedule-button'),
                    onPressed: () {
                      Navigator.pop(context);
                      widget.onEdit();
                    },
                    icon: Icon(
                      Icons.edit_outlined,
                      color: rhythm.accent,
                      size: 18,
                    ),
                    label: Text('Edit', style: TextStyle(color: rhythm.accent)),
                    style: OutlinedButton.styleFrom(
                      side: BorderSide(
                        color: rhythm.accent.withValues(alpha: 0.5),
                      ),
                      padding: const EdgeInsets.symmetric(
                        vertical: RhythmSpacing.sm,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: RhythmSpacing.sm),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _triggering ? null : _triggerNow,
                    icon: _triggering
                        ? SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.play_arrow_rounded, size: 18),
                    label: const Text('Trigger Now'),
                    style: FilledButton.styleFrom(
                      backgroundColor: rhythm.accent,
                      padding: const EdgeInsets.symmetric(
                        vertical: RhythmSpacing.sm,
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: RhythmSpacing.lg),
          ],
        ),
      ),
    );
  }

  Widget _detailDivider(RhythmColorRoles rhythm) => Padding(
    padding: const EdgeInsets.symmetric(vertical: RhythmSpacing.sm),
    child: Divider(color: rhythm.borderSubtle, height: 1),
  );

  Widget _detailRow(RhythmColorRoles rhythm, String label, String value) =>
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 90,
              child: Text(
                label,
                style: TextStyle(
                  color: rhythm.textMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            Expanded(
              child: Text(
                value,
                style: TextStyle(color: rhythm.textPrimary, fontSize: 12),
              ),
            ),
          ],
        ),
      );
}

// ---------------------------------------------------------------------------
// #904 — Activity log (recent runs of a scheduled task)
// ---------------------------------------------------------------------------

class _ActivityLog extends StatelessWidget {
  const _ActivityLog({required this.taskId});

  final String taskId;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    return FutureBuilder<List<AgentSession>>(
      future: context.read<AgentSchedulesController>().listRuns(taskId),
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: RhythmSpacing.sm),
            child: Center(
              child: SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: rhythm.textMuted,
                ),
              ),
            ),
          );
        }
        if (snapshot.hasError) {
          return Text(
            'Could not load activity.',
            style: TextStyle(color: rhythm.textMuted, fontSize: 12),
          );
        }
        final runs = snapshot.data ?? [];
        if (runs.isEmpty) {
          return Text(
            'No runs yet.',
            style: TextStyle(color: rhythm.textMuted, fontSize: 12),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [for (final run in runs) _ActivityLogRow(run: run)],
        );
      },
    );
  }
}

class _ActivityLogRow extends StatelessWidget {
  const _ActivityLogRow({required this.run});

  final AgentSession run;

  Color _statusColor(RhythmColorRoles rhythm) {
    switch (run.status) {
      case AgentSessionStatus.error:
        return rhythm.danger;
      case AgentSessionStatus.working:
      case AgentSessionStatus.starting:
        return rhythm.info;
      default:
        return rhythm.success;
    }
  }

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    return InkWell(
      key: ValueKey('activity-log-row-${run.id}'),
      borderRadius: BorderRadius.circular(RhythmRadius.sm),
      onTap: () {
        context.read<NotificationsController>().navigateTo(
          'agentSession',
          run.id,
        );
        Navigator.of(context, rootNavigator: true).maybePop();
      },
      child: Container(
        margin: const EdgeInsets.only(bottom: RhythmSpacing.xs),
        padding: const EdgeInsets.all(RhythmSpacing.sm),
        decoration: BoxDecoration(
          color: rhythm.surfaceMuted,
          borderRadius: BorderRadius.circular(RhythmRadius.sm),
          border: Border.all(color: rhythm.borderSubtle),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: _statusColor(rhythm),
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  _formatDateTime(run.createdAt.toIso8601String()),
                  style: TextStyle(
                    color: rhythm.textMuted,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const Spacer(),
                Text(
                  run.status.wireValue,
                  style: TextStyle(color: rhythm.textMuted, fontSize: 11),
                ),
                const SizedBox(width: 4),
                Icon(Icons.chevron_right, size: 16, color: rhythm.textMuted),
              ],
            ),
            if ((run.lastPreview ?? '').isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                run.lastPreview!,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: rhythm.textSecondary, fontSize: 12),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Schedule form sheet (create + edit)
// ---------------------------------------------------------------------------

class _ScheduleFormSheet extends StatefulWidget {
  const _ScheduleFormSheet({this.existing});

  /// When non-null the sheet is in edit mode; pre-fills all fields and calls
  /// [AgentSchedulesController.update] on submit instead of [create].
  final AgentScheduledTask? existing;

  @override
  State<_ScheduleFormSheet> createState() => _ScheduleFormSheetState();
}

class _ScheduleFormSheetState extends State<_ScheduleFormSheet> {
  final _formKey = GlobalKey<FormState>();
  final _nameCtrl = TextEditingController();
  final _promptCtrl = TextEditingController();
  final _cronCtrl = TextEditingController();
  final _runAtCtrl = TextEditingController();

  String _scheduleType = 'daily';
  String _scheduledTime = '09:00';
  int _scheduledDay = 0;
  bool _enabled = true;
  String? _selectedAgentConfigId;
  bool _creating = false;

  // For monthly day
  int _monthDay = 1;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final t = widget.existing;
    if (t != null) {
      _nameCtrl.text = t.name;
      _promptCtrl.text = t.prompt;
      _scheduleType = t.scheduleType;
      _scheduledTime = t.scheduledTime ?? '09:00';
      _scheduledDay = t.scheduledDay ?? 0;
      _cronCtrl.text = t.cronExpression ?? '';
      _runAtCtrl.text = t.runAt ?? '';
      _enabled = t.enabled;
      _selectedAgentConfigId = t.agentConfigId ?? t.agentKind;
      // For monthly the day field is stored in scheduledDay
      _monthDay = (t.scheduleType == 'monthly') ? (t.scheduledDay ?? 1) : 1;
    }
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _promptCtrl.dispose();
    _cronCtrl.dispose();
    _runAtCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickTime() async {
    final parts = _scheduledTime.split(':');
    final initial = TimeOfDay(
      hour: int.tryParse(parts[0]) ?? 9,
      minute: int.tryParse(parts.length > 1 ? parts[1] : '0') ?? 0,
    );
    final picked = await showTimePicker(context: context, initialTime: initial);
    if (picked != null) {
      setState(() {
        _scheduledTime =
            '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';
      });
    }
  }

  Future<void> _pickDateTime() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: now.add(const Duration(hours: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(now),
    );
    if (time == null) return;
    final combined = DateTime(
      date.year,
      date.month,
      date.day,
      time.hour,
      time.minute,
    );
    setState(() {
      _runAtCtrl.text = combined.toIso8601String();
    });
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _creating = true);

    try {
      final payload = <String, dynamic>{
        'name': _nameCtrl.text.trim(),
        'prompt': _promptCtrl.text.trim(),
        'scheduleType': _scheduleType,
        'timezone': 'America/Los_Angeles',
        'enabled': _enabled,
        if (_selectedAgentConfigId != null) 'agentKind': _selectedAgentConfigId,
        if (_selectedAgentConfigId != null)
          'agentConfigId': _selectedAgentConfigId,
      };

      switch (_scheduleType) {
        case 'daily':
          payload['scheduledTime'] = _scheduledTime;
        case 'weekly':
          payload['scheduledTime'] = _scheduledTime;
          payload['scheduledDay'] = _scheduledDay;
        case 'monthly':
          payload['scheduledTime'] = _scheduledTime;
          payload['scheduledDay'] = _monthDay;
        case 'cron':
          payload['cronExpression'] = _cronCtrl.text.trim();
        case 'once':
          payload['runAt'] = _runAtCtrl.text.trim();
      }

      final controller = context.read<AgentSchedulesController>();
      if (_isEdit) {
        await controller.update(widget.existing!.id, payload);
      } else {
        await controller.create(payload);
      }
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            backgroundColor: context.rhythm.danger,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final agents = context
        .watch<AgentConfigsController>()
        .configs
        .where((c) => c.isAgent)
        .toList();

    final inputDecoration = InputDecoration(
      filled: true,
      fillColor: rhythm.surfaceMuted,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        borderSide: BorderSide(color: rhythm.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        borderSide: BorderSide(color: rhythm.borderSubtle),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        borderSide: BorderSide(color: rhythm.accent, width: 1.5),
      ),
      labelStyle: TextStyle(color: rhythm.textMuted),
      hintStyle: TextStyle(color: rhythm.textMuted),
    );

    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (_, scrollController) => Form(
        key: _formKey,
        child: ListView(
          controller: scrollController,
          padding: const EdgeInsets.symmetric(horizontal: RhythmSpacing.lg),
          children: [
            const SizedBox(height: RhythmSpacing.sm),
            // Handle
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: rhythm.border,
                  borderRadius: BorderRadius.circular(RhythmRadius.pill),
                ),
              ),
            ),
            const SizedBox(height: RhythmSpacing.lg),
            Text(
              _isEdit ? 'Edit Scheduled Task' : 'New Scheduled Task',
              style: TextStyle(
                color: rhythm.textPrimary,
                fontWeight: FontWeight.w700,
                fontSize: 18,
              ),
            ),
            const SizedBox(height: RhythmSpacing.md),

            // Name
            TextFormField(
              controller: _nameCtrl,
              style: TextStyle(color: rhythm.textPrimary),
              decoration: inputDecoration.copyWith(labelText: 'Name'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Name is required' : null,
            ),
            const SizedBox(height: RhythmSpacing.sm),

            // Prompt
            TextFormField(
              controller: _promptCtrl,
              style: TextStyle(color: rhythm.textPrimary),
              decoration: inputDecoration.copyWith(
                labelText: 'Instructions / Prompt',
              ),
              minLines: 3,
              maxLines: 6,
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Prompt is required' : null,
            ),
            const SizedBox(height: RhythmSpacing.sm),

            // Schedule type
            DropdownButtonFormField<String>(
              value: _scheduleType,
              dropdownColor: rhythm.surface,
              style: TextStyle(color: rhythm.textPrimary),
              decoration: inputDecoration.copyWith(labelText: 'Schedule Type'),
              items: const [
                DropdownMenuItem(value: 'daily', child: Text('Daily')),
                DropdownMenuItem(value: 'weekly', child: Text('Weekly')),
                DropdownMenuItem(value: 'monthly', child: Text('Monthly')),
                DropdownMenuItem(value: 'cron', child: Text('Cron Expression')),
                DropdownMenuItem(value: 'once', child: Text('Once')),
              ],
              onChanged: (v) {
                if (v != null) setState(() => _scheduleType = v);
              },
            ),
            const SizedBox(height: RhythmSpacing.sm),

            // Conditional schedule fields
            ..._buildScheduleFields(rhythm, inputDecoration),

            const SizedBox(height: RhythmSpacing.sm),

            // Agent profile
            if (agents.isNotEmpty)
              DropdownButtonFormField<String>(
                value: _selectedAgentConfigId,
                dropdownColor: rhythm.surface,
                style: TextStyle(color: rhythm.textPrimary),
                decoration: inputDecoration.copyWith(
                  labelText: 'Agent Profile',
                  helperText: 'Model is set on the profile',
                  helperStyle: TextStyle(color: rhythm.textMuted, fontSize: 11),
                ),
                hint: Text(
                  'Default',
                  style: TextStyle(color: rhythm.textMuted),
                ),
                items: agents
                    .map(
                      (a) =>
                          DropdownMenuItem(value: a.id, child: Text(a.label)),
                    )
                    .toList(),
                onChanged: (v) => setState(() => _selectedAgentConfigId = v),
              ),
            if (agents.isNotEmpty) const SizedBox(height: RhythmSpacing.sm),

            // Enabled toggle
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: RhythmSpacing.sm,
                vertical: RhythmSpacing.xs,
              ),
              decoration: BoxDecoration(
                color: rhythm.surfaceMuted,
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                border: Border.all(color: rhythm.borderSubtle),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Enabled',
                      style: TextStyle(color: rhythm.textPrimary),
                    ),
                  ),
                  Switch(
                    value: _enabled,
                    activeThumbColor: rhythm.accent,
                    onChanged: (v) => setState(() => _enabled = v),
                  ),
                ],
              ),
            ),
            const SizedBox(height: RhythmSpacing.lg),

            // Submit
            FilledButton(
              onPressed: _creating ? null : _submit,
              style: FilledButton.styleFrom(
                backgroundColor: rhythm.accent,
                padding: const EdgeInsets.symmetric(vertical: RhythmSpacing.sm),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                ),
              ),
              child: _creating
                  ? SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Text(
                      _isEdit ? 'Save' : 'Create Schedule',
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 15,
                      ),
                    ),
            ),
            const SizedBox(height: RhythmSpacing.lg),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildScheduleFields(
    RhythmColorRoles rhythm,
    InputDecoration base,
  ) {
    switch (_scheduleType) {
      case 'daily':
        return [_timePickerRow(rhythm)];

      case 'weekly':
        return [
          _dayOfWeekRow(rhythm),
          const SizedBox(height: RhythmSpacing.sm),
          _timePickerRow(rhythm),
        ];

      case 'monthly':
        return [
          _monthDayRow(rhythm),
          const SizedBox(height: RhythmSpacing.sm),
          _timePickerRow(rhythm),
        ];

      case 'cron':
        final preview = _cronCtrl.text.isNotEmpty
            ? _describeCron(_cronCtrl.text)
            : null;
        return [
          TextFormField(
            controller: _cronCtrl,
            style: TextStyle(
              color: rhythm.textPrimary,
              fontFamily: 'monospace',
            ),
            decoration: base.copyWith(
              labelText: 'Cron Expression (e.g. 0 9 * * 1)',
            ),
            onChanged: (_) => setState(() {}),
            validator: (v) => (v == null || v.trim().isEmpty)
                ? 'Cron expression required'
                : null,
          ),
          if (preview != null) ...[
            const SizedBox(height: 4),
            Padding(
              padding: const EdgeInsets.only(left: 4),
              child: Text(
                preview,
                style: TextStyle(
                  color: rhythm.textMuted,
                  fontSize: 11,
                  fontStyle: FontStyle.italic,
                ),
              ),
            ),
          ],
        ];

      case 'once':
        return [
          InkWell(
            onTap: _pickDateTime,
            borderRadius: BorderRadius.circular(RhythmRadius.sm),
            child: IgnorePointer(
              child: TextFormField(
                controller: _runAtCtrl,
                style: TextStyle(color: rhythm.textPrimary),
                decoration: base.copyWith(
                  labelText: 'Run At (tap to pick)',
                  suffixIcon: Icon(
                    Icons.calendar_today_rounded,
                    color: rhythm.textMuted,
                    size: 18,
                  ),
                ),
                validator: (v) => (v == null || v.trim().isEmpty)
                    ? 'Please pick a date/time'
                    : null,
              ),
            ),
          ),
        ];

      default:
        return [];
    }
  }

  Widget _timePickerRow(RhythmColorRoles rhythm) {
    return InkWell(
      onTap: _pickTime,
      borderRadius: BorderRadius.circular(RhythmRadius.sm),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: RhythmSpacing.sm,
          vertical: RhythmSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: rhythm.surfaceMuted,
          borderRadius: BorderRadius.circular(RhythmRadius.sm),
          border: Border.all(color: rhythm.borderSubtle),
        ),
        child: Row(
          children: [
            Icon(Icons.access_time_rounded, color: rhythm.textMuted, size: 18),
            const SizedBox(width: RhythmSpacing.xs),
            Text('Time: ', style: TextStyle(color: rhythm.textMuted)),
            Text(
              _scheduledTime,
              style: TextStyle(
                color: rhythm.textPrimary,
                fontWeight: FontWeight.w600,
              ),
            ),
            const Spacer(),
            Text(
              'Tap to change',
              style: TextStyle(color: rhythm.textMuted, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }

  Widget _dayOfWeekRow(RhythmColorRoles rhythm) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return Row(
      children: List.generate(7, (i) {
        final selected = _scheduledDay == i;
        return Expanded(
          child: GestureDetector(
            onTap: () => setState(() => _scheduledDay = i),
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 2),
              padding: const EdgeInsets.symmetric(vertical: 8),
              decoration: BoxDecoration(
                color: selected ? rhythm.accent : rhythm.surfaceMuted,
                borderRadius: BorderRadius.circular(RhythmRadius.xs),
                border: Border.all(
                  color: selected ? rhythm.accent : rhythm.borderSubtle,
                ),
              ),
              child: Text(
                days[i],
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: selected ? Colors.white : rhythm.textSecondary,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        );
      }),
    );
  }

  Widget _monthDayRow(RhythmColorRoles rhythm) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: RhythmSpacing.sm,
        vertical: RhythmSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        border: Border.all(color: rhythm.borderSubtle),
      ),
      child: Row(
        children: [
          Text('Day of month:', style: TextStyle(color: rhythm.textMuted)),
          const Spacer(),
          IconButton(
            icon: Icon(Icons.remove_rounded, color: rhythm.textSecondary),
            onPressed: _monthDay > 1 ? () => setState(() => _monthDay--) : null,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
          ),
          SizedBox(
            width: 36,
            child: Text(
              '$_monthDay',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: rhythm.textPrimary,
                fontWeight: FontWeight.w700,
                fontSize: 16,
              ),
            ),
          ),
          IconButton(
            icon: Icon(Icons.add_rounded, color: rhythm.textSecondary),
            onPressed: _monthDay < 31
                ? () => setState(() => _monthDay++)
                : null,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

String _formatDateTime(String raw) {
  return formatLocalTimestamp(raw);
}

String _describeCron(String expr) {
  final parts = expr.trim().split(RegExp(r'\s+'));
  if (parts.length < 5) return 'Invalid cron';
  final labels = ['min', 'hr', 'day', 'mon', 'wday'];
  return List.generate(5, (i) => '${labels[i]}=${parts[i]}').join(' ');
}
