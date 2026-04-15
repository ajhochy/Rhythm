import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/formatters/date_formatters.dart';
import '../../../app/core/widgets/error_banner.dart';
import '../../../app/core/workspace/workspace_controller.dart';
import '../../../app/core/workspace/workspace_models.dart';
import '../../../app/theme/rhythm_tokens.dart';
import '../controllers/rhythms_controller.dart';
import '../data/rhythms_data_source.dart';
import '../../../features/tasks/models/recurring_task_rule.dart';
import '../../../features/tasks/services/recurrence_service.dart';
import '../../../shared/widgets/workspace_member_picker.dart';

const _kCanvas = RhythmTokens.background;
const _kCanvasAccent = RhythmTokens.backgroundAccent;
const _kSurface = RhythmTokens.surfaceStrong;
const _kSurfaceMuted = RhythmTokens.surfaceMuted;
const _kBorder = RhythmTokens.border;
const _kBorderSoft = RhythmTokens.borderSoft;
const _kTextPrimary = RhythmTokens.textPrimary;
const _kTextSecondary = RhythmTokens.textSecondary;
const _kTextMuted = RhythmTokens.textMuted;
const _kPrimary = RhythmTokens.accent;
const _kPrimarySoft = RhythmTokens.accentSoft;
const _kWarm = RhythmTokens.accentWarm;

class RhythmsView extends StatefulWidget {
  const RhythmsView({super.key});

  @override
  State<RhythmsView> createState() => _RhythmsViewState();
}

class _RhythmsViewState extends State<RhythmsView> {
  final RhythmsDataSource _dataSource = RhythmsDataSource();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<RhythmsController>().load();
      context.read<WorkspaceController>().loadMembers();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<RhythmsController>(
      builder: (context, controller, _) {
        return Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [_kCanvas, Color(0xFFF7F4EF), _kCanvasAccent],
              stops: [0.0, 0.55, 1.0],
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: _kSurface,
                borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
                border: Border.all(color: _kBorderSoft),
                boxShadow: RhythmTokens.shadow,
              ),
              child: Column(
                children: [
                  _Header(onAdd: () => _showCreateDialog(context, controller)),
                  if (controller.status == RhythmsStatus.error &&
                      controller.errorMessage != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                      child: ErrorBanner(
                        message: controller.errorMessage!,
                        onRetry: controller.load,
                      ),
                    ),
                  Expanded(
                    child: _RulesList(
                      controller: controller,
                      dataSource: _dataSource,
                      onCreate: () => _showCreateDialog(context, controller),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _showCreateDialog(
    BuildContext context,
    RhythmsController controller,
  ) async {
    await showDialog<void>(
      context: context,
      builder: (_) => _CreateRuleDialog(controller: controller),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.onAdd});
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
      decoration: const BoxDecoration(
        color: _kSurface,
        border: Border(bottom: BorderSide(color: _kBorderSoft)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Rhythms',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: _kTextPrimary,
                    letterSpacing: -0.3,
                  ),
                ),
                SizedBox(height: 4),
                Text(
                  'Recurring rules that quietly keep the workspace moving.',
                  style: TextStyle(fontSize: 12, color: _kTextSecondary),
                ),
              ],
            ),
          ),
          const SizedBox(width: 16),
          FilledButton.tonalIcon(
            onPressed: onAdd,
            style: FilledButton.styleFrom(
              backgroundColor: _kPrimarySoft,
              foregroundColor: _kPrimary,
              elevation: 0,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
              ),
            ),
            icon: const Icon(Icons.add, size: 18),
            label: const Text(
              'New rule',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

class _RulesList extends StatelessWidget {
  const _RulesList({
    required this.controller,
    required this.dataSource,
    required this.onCreate,
  });
  final RhythmsController controller;
  final RhythmsDataSource dataSource;
  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    if (controller.status == RhythmsStatus.loading &&
        controller.rules.isEmpty) {
      return const Center(child: CircularProgressIndicator(color: _kPrimary));
    }
    if (controller.rules.isEmpty) {
      return Center(child: _EmptyState(onCreate: onCreate));
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
      itemCount: controller.rules.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (context, i) => _RuleTile(
        rule: controller.rules[i],
        controller: controller,
        dataSource: dataSource,
        onDelete: () => controller.deleteRule(controller.rules[i].id),
      ),
    );
  }
}

class _RuleTile extends StatefulWidget {
  const _RuleTile({
    required this.rule,
    required this.onDelete,
    required this.controller,
    required this.dataSource,
  });
  final RecurringTaskRule rule;
  final VoidCallback onDelete;
  final RhythmsController controller;
  final RhythmsDataSource dataSource;

  @override
  State<_RuleTile> createState() => _RuleTileState();
}

class _RuleTileState extends State<_RuleTile> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final dimmed = !widget.rule.enabled;
    final currentUserId = AuthSessionService.instance.currentUser?.id;
    final isOwner =
        widget.rule.ownerId != null && widget.rule.ownerId == currentUserId;
    final previewDates = RecurrenceService()
        .previewNextDates(widget.rule, DateTime.now(), count: 3)
        .map(
          (d) =>
              '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}',
        )
        .toList();

    return Card(
      elevation: 0,
      color: _kSurface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
        side: const BorderSide(color: _kBorderSoft),
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: dimmed ? _kSurfaceMuted : _kPrimarySoft,
                    borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                    border: Border.all(color: _kBorderSoft),
                  ),
                  child: Icon(
                    Icons.repeat,
                    size: 20,
                    color: dimmed ? _kTextMuted : _kPrimary,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              widget.rule.title,
                              style: Theme.of(context).textTheme.titleMedium
                                  ?.copyWith(
                                    color: dimmed ? _kTextMuted : _kTextPrimary,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: -0.2,
                                  ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          _StatusChip(enabled: widget.rule.enabled),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        widget.rule.patternDescription,
                        style: Theme.of(
                          context,
                        ).textTheme.bodySmall?.copyWith(color: _kTextSecondary),
                      ),
                      if (widget.rule.progress != null) ...[
                        const SizedBox(height: 12),
                        _ProgressStrip(rule: widget.rule),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Switch(
                  value: widget.rule.enabled,
                  onChanged: (_) => widget.controller.toggleEnabled(
                    widget.rule.id,
                    enabled: !widget.rule.enabled,
                  ),
                ),
              ],
            ),
            if (widget.rule.collaborators.isNotEmpty || isOwner) ...[
              const SizedBox(height: 12),
              _RhythmCollaboratorsRow(
                rule: widget.rule,
                isOwner: isOwner,
                dataSource: widget.dataSource,
                onChanged: () => widget.controller.load(),
              ),
            ],
            const SizedBox(height: 14),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                TextButton.icon(
                  onPressed: () => setState(() => _expanded = !_expanded),
                  style: TextButton.styleFrom(
                    foregroundColor: _kTextPrimary,
                    backgroundColor: _kSurfaceMuted,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                    ),
                  ),
                  icon: Icon(
                    _expanded ? Icons.expand_less : Icons.expand_more,
                    size: 16,
                  ),
                  label: Text(_expanded ? 'Hide preview' : 'Preview'),
                ),
                OutlinedButton.icon(
                  onPressed: () => _showEditDialog(context),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: _kTextPrimary,
                    side: const BorderSide(color: _kBorder),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                    ),
                  ),
                  icon: const Icon(Icons.edit_outlined, size: 16),
                  label: const Text('Edit'),
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline, size: 18),
                  onPressed: () => _confirmDelete(context),
                  tooltip: 'Delete rule',
                ),
              ],
            ),
            AnimatedCrossFade(
              firstChild: const SizedBox.shrink(),
              secondChild: Padding(
                padding: const EdgeInsets.only(top: 14),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: _kSurfaceMuted,
                    borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                    border: Border.all(color: _kBorderSoft),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (widget.rule.steps.isNotEmpty) ...[
                        Row(
                          children: [
                            const Icon(
                              Icons.route_outlined,
                              size: 14,
                              color: _kTextMuted,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              'Workflow steps',
                              style: Theme.of(context).textTheme.labelMedium
                                  ?.copyWith(
                                    color: _kTextSecondary,
                                    fontWeight: FontWeight.w600,
                                  ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Column(
                          children: widget.rule.steps
                              .asMap()
                              .entries
                              .map(
                                (entry) => Padding(
                                  padding: const EdgeInsets.only(bottom: 8),
                                  child: _WorkflowStepTile(
                                    step: entry.value,
                                    stepIndex: entry.key,
                                    isSequential: widget.rule.sequential,
                                  ),
                                ),
                              )
                              .toList(),
                        ),
                        const SizedBox(height: 8),
                      ],
                      Row(
                        children: [
                          const Icon(
                            Icons.calendar_today_outlined,
                            size: 14,
                            color: _kTextMuted,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            'Next occurrences',
                            style: Theme.of(context).textTheme.labelMedium
                                ?.copyWith(
                                  color: _kTextSecondary,
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: previewDates
                            .map(
                              (date) => Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 10,
                                  vertical: 7,
                                ),
                                decoration: BoxDecoration(
                                  color: _kSurface,
                                  borderRadius: BorderRadius.circular(999),
                                  border: Border.all(color: _kBorderSoft),
                                ),
                                child: Text(
                                  DateFormatters.fullDate(date, fallback: date),
                                  style: Theme.of(context).textTheme.labelSmall
                                      ?.copyWith(
                                        color: _kTextSecondary,
                                        fontWeight: FontWeight.w600,
                                      ),
                                ),
                              ),
                            )
                            .toList(),
                      ),
                    ],
                  ),
                ),
              ),
              crossFadeState: _expanded
                  ? CrossFadeState.showSecond
                  : CrossFadeState.showFirst,
              duration: const Duration(milliseconds: 180),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showEditDialog(BuildContext context) async {
    await showDialog<void>(
      context: context,
      builder: (_) =>
          _EditRuleDialog(rule: widget.rule, controller: widget.controller),
    );
  }

  Future<void> _confirmDelete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Rule'),
        content: Text(
          'Delete "${widget.rule.title}"? This will not remove already-generated tasks.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed == true) widget.onDelete();
  }
}

class _ProgressStrip extends StatelessWidget {
  const _ProgressStrip({required this.rule});

  final RecurringTaskRule rule;

  @override
  Widget build(BuildContext context) {
    final progress = rule.progress;
    if (progress == null) return const SizedBox.shrink();
    final percent = (progress.completionRatio * 100).round().clamp(0, 100);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            _InlineMetric(
              label: 'Remaining',
              value: '${progress.remainingCount}',
              color: _kPrimary,
            ),
            const SizedBox(width: 8),
            _InlineMetric(
              label: 'Personal',
              value: '${progress.personalRemainingCount}',
              color: _kWarm,
            ),
            const SizedBox(width: 8),
            _InlineMetric(
              label: 'Complete',
              value: '$percent%',
              color: _kPrimary,
            ),
            const SizedBox(width: 8),
            if (progress.waitingOnUserName != null)
              Flexible(
                child: _InlineMetric(
                  label: 'Waiting on',
                  value: progress.waitingOnUserName!,
                  color: _kTextSecondary,
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: LinearProgressIndicator(
            minHeight: 7,
            value: progress.totalCount == 0 ? 0 : progress.completionRatio,
            backgroundColor: _kBorderSoft,
            valueColor: const AlwaysStoppedAnimation<Color>(_kPrimary),
          ),
        ),
      ],
    );
  }
}

class _RhythmCollaboratorsRow extends StatelessWidget {
  const _RhythmCollaboratorsRow({
    required this.rule,
    required this.isOwner,
    required this.dataSource,
    required this.onChanged,
  });

  final RecurringTaskRule rule;
  final bool isOwner;
  final RhythmsDataSource dataSource;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final workspaceMembers = context.watch<WorkspaceController>().members;
    final collaboratorIds = rule.collaborators.map((c) => c.userId).toSet();
    final currentUserId = AuthSessionService.instance.currentUser?.id;
    final candidates = workspaceMembers
        .where(
          (member) =>
              member.userId != rule.ownerId &&
              !collaboratorIds.contains(member.userId) &&
              member.userId != currentUserId,
        )
        .toList();

    if (rule.collaborators.isEmpty && !isOwner) {
      return const SizedBox.shrink();
    }

    return Row(
      children: [
        Expanded(
          child: Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              ...rule.collaborators.map(
                (collaborator) => Tooltip(
                  message:
                      '${collaborator.name}${isOwner ? ' (long-press to remove)' : ''}',
                  child: GestureDetector(
                    onLongPress: isOwner
                        ? () =>
                              _confirmRemoveCollaborator(context, collaborator)
                        : null,
                    child: CircleAvatar(
                      radius: 13,
                      backgroundImage: collaborator.photoUrl != null
                          ? NetworkImage(collaborator.photoUrl!)
                          : null,
                      backgroundColor: _kPrimarySoft,
                      child: collaborator.photoUrl == null
                          ? Text(
                              _initialFor(collaborator.name),
                              style: const TextStyle(
                                fontSize: 10,
                                color: _kPrimary,
                                fontWeight: FontWeight.w700,
                              ),
                            )
                          : null,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        if (isOwner)
          IconButton(
            icon: const Icon(Icons.person_add_outlined, size: 18),
            tooltip: 'Add collaborator',
            onPressed: () => _showAddCollaboratorDialog(context, candidates),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
          ),
      ],
    );
  }

  Future<void> _confirmRemoveCollaborator(
    BuildContext context,
    RhythmCollaborator collaborator,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove collaborator'),
        content: Text('Remove ${collaborator.name} from this rhythm?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await dataSource.removeCollaborator(rule.id, collaborator.userId);
    onChanged();
  }

  Future<void> _showAddCollaboratorDialog(
    BuildContext context,
    List<WorkspaceMember> candidates,
  ) async {
    if (candidates.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No other workspace members to add')),
      );
      return;
    }

    final selectedUserId = await showDialog<int>(
      context: context,
      builder: (ctx) {
        var selectedId = candidates.first.userId;
        return StatefulBuilder(
          builder: (ctx, setState) => AlertDialog(
            title: const Text('Add collaborator'),
            content: SizedBox(
              width: 360,
              child: WorkspaceMemberPicker(
                workspaceMembers: candidates,
                selectedUserId: selectedId,
                allowNone: false,
                onChanged: (value) {
                  if (value == null) return;
                  setState(() => selectedId = value);
                },
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, selectedId),
                child: const Text('Add'),
              ),
            ],
          ),
        );
      },
    );

    if (selectedUserId == null) return;
    await dataSource.addCollaborator(rule.id, selectedUserId);
    onChanged();
  }
}

class _InlineMetric extends StatelessWidget {
  const _InlineMetric({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
        border: Border.all(color: color.withValues(alpha: 0.14)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: _kTextMuted,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
              color: color,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _WorkflowStepTile extends StatelessWidget {
  const _WorkflowStepTile({
    required this.step,
    this.stepIndex = 0,
    this.isSequential = false,
  });

  final RecurringTaskRuleStep step;
  final int stepIndex;
  final bool isSequential;

  @override
  Widget build(BuildContext context) {
    final assignee = step.assigneeName?.trim().isNotEmpty == true
        ? step.assigneeName!
        : 'Unassigned';
    final isLocked = isSequential && stepIndex > 0;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: isLocked ? _kSurfaceMuted : _kSurface,
        borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
        border: Border.all(color: _kBorderSoft),
      ),
      child: Row(
        children: [
          Container(
            width: 22,
            height: 22,
            decoration: BoxDecoration(
              color: isLocked ? const Color(0xFFE5E7EB) : _kPrimarySoft,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(
              isLocked ? Icons.lock_outline : Icons.checklist,
              size: 13,
              color: isLocked ? _kTextMuted : _kPrimary,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  step.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: isLocked ? _kTextMuted : _kTextPrimary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  isLocked ? 'Waiting for previous step' : assignee,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(
                    context,
                  ).textTheme.labelSmall?.copyWith(color: _kTextMuted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Create Rule Dialog
// ---------------------------------------------------------------------------

class _StepEditorModel {
  _StepEditorModel({required this.id, String? title, this.assigneeId})
    : titleController = TextEditingController(text: title ?? '');

  final String id;
  final TextEditingController titleController;
  int? assigneeId;

  void dispose() => titleController.dispose();

  RecurringTaskRuleStep toStep() {
    return RecurringTaskRuleStep(
      id: id,
      title: titleController.text.trim(),
      assigneeId: assigneeId,
    );
  }
}

class _CreateRuleDialog extends StatefulWidget {
  const _CreateRuleDialog({required this.controller});
  final RhythmsController controller;

  @override
  State<_CreateRuleDialog> createState() => _CreateRuleDialogState();
}

class _CreateRuleDialogState extends State<_CreateRuleDialog> {
  final _titleController = TextEditingController();
  String _frequency = 'weekly';
  int _dayOfWeek = 1; // Monday
  int _dayOfMonth = 1;
  int _month = 1;
  bool _sequential = false;
  bool _saving = false;
  final List<_StepEditorModel> _steps = [];

  static const _weekdays = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  static const _months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  @override
  void dispose() {
    for (final step in _steps) {
      step.dispose();
    }
    _titleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('New Recurring Rule'),
      content: SizedBox(
        width: 620,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextField(
                controller: _titleController,
                decoration: const InputDecoration(
                  labelText: 'Title',
                  border: OutlineInputBorder(),
                ),
                autofocus: true,
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                value: _frequency,
                decoration: const InputDecoration(
                  labelText: 'Frequency',
                  border: OutlineInputBorder(),
                ),
                items: const [
                  DropdownMenuItem(value: 'weekly', child: Text('Weekly')),
                  DropdownMenuItem(value: 'monthly', child: Text('Monthly')),
                  DropdownMenuItem(value: 'annual', child: Text('Annual')),
                ],
                onChanged: (v) => setState(() => _frequency = v!),
              ),
              const SizedBox(height: 16),
              if (_frequency == 'weekly') ...[
                DropdownButtonFormField<int>(
                  value: _dayOfWeek,
                  decoration: const InputDecoration(
                    labelText: 'Day of Week',
                    border: OutlineInputBorder(),
                  ),
                  items: List.generate(
                    7,
                    (i) =>
                        DropdownMenuItem(value: i, child: Text(_weekdays[i])),
                  ),
                  onChanged: (v) => setState(() => _dayOfWeek = v!),
                ),
              ],
              if (_frequency == 'monthly') ...[
                _DayOfMonthField(
                  value: _dayOfMonth,
                  onChanged: (v) => setState(() => _dayOfMonth = v),
                ),
              ],
              if (_frequency == 'annual') ...[
                DropdownButtonFormField<int>(
                  value: _month,
                  decoration: const InputDecoration(
                    labelText: 'Month',
                    border: OutlineInputBorder(),
                  ),
                  items: List.generate(
                    12,
                    (i) =>
                        DropdownMenuItem(value: i + 1, child: Text(_months[i])),
                  ),
                  onChanged: (v) => setState(() => _month = v!),
                ),
                const SizedBox(height: 12),
                _DayOfMonthField(
                  value: _dayOfMonth,
                  onChanged: (v) => setState(() => _dayOfMonth = v),
                ),
              ],
              const SizedBox(height: 18),
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Workflow steps',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: _kTextPrimary,
                      ),
                    ),
                  ),
                  TextButton.icon(
                    onPressed: () {
                      setState(() {
                        _steps.add(
                          _StepEditorModel(id: _newStepId(_steps.length)),
                        );
                      });
                    },
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('Add step'),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                'Leave this empty to use the rhythm title as a single recurring task.',
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(color: _kTextMuted),
              ),
              if (_steps.length > 1) ...[
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Sequential steps',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w500,
                              color: _kTextPrimary,
                            ),
                          ),
                          const SizedBox(height: 2),
                          const Text(
                            'Each step unlocks only after the previous one is completed.',
                            style: TextStyle(fontSize: 11, color: _kTextMuted),
                          ),
                        ],
                      ),
                    ),
                    Switch(
                      value: _sequential,
                      onChanged: (v) => setState(() => _sequential = v),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 12),
              if (_steps.isEmpty)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: _kSurfaceMuted,
                    borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                    border: Border.all(color: _kBorderSoft),
                  ),
                  child: const Text(
                    'No steps yet. Add one if this rhythm needs multiple tasks or assignees.',
                    style: TextStyle(color: _kTextMuted, fontSize: 12),
                  ),
                )
              else
                Column(
                  children: [
                    for (var i = 0; i < _steps.length; i++) ...[
                      _StepEditorRow(
                        step: _steps[i],
                        onAssigneeChanged: (value) =>
                            setState(() => _steps[i].assigneeId = value),
                        onRemove: () {
                          setState(() {
                            _steps[i].dispose();
                            _steps.removeAt(i);
                          });
                        },
                      ),
                      if (i != _steps.length - 1) const SizedBox(height: 10),
                    ],
                  ],
                ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Create'),
        ),
      ],
    );
  }

  String _newStepId(int index) {
    return 'step-${DateTime.now().microsecondsSinceEpoch}-$index';
  }

  Future<void> _save() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;

    final steps = _steps
        .map((step) => step.toStep())
        .where((step) => step.title.trim().isNotEmpty)
        .toList();

    setState(() => _saving = true);
    await widget.controller.createRule(
      title: title,
      frequency: _frequency,
      dayOfWeek: _frequency == 'weekly' ? _dayOfWeek : null,
      dayOfMonth: (_frequency == 'monthly' || _frequency == 'annual')
          ? _dayOfMonth
          : null,
      month: _frequency == 'annual' ? _month : null,
      sequential: _sequential,
      steps: steps,
    );
    if (mounted) Navigator.pop(context);
  }
}

class _EditRuleDialog extends StatefulWidget {
  const _EditRuleDialog({required this.rule, required this.controller});
  final RecurringTaskRule rule;
  final RhythmsController controller;

  @override
  State<_EditRuleDialog> createState() => _EditRuleDialogState();
}

class _EditRuleDialogState extends State<_EditRuleDialog> {
  late final TextEditingController _titleController;
  late String _frequency;
  late int _dayOfWeek;
  late int _dayOfMonth;
  late int _month;
  late bool _sequential;
  bool _saving = false;
  final List<_StepEditorModel> _steps = [];

  static const _weekdays = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  static const _months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  @override
  void initState() {
    super.initState();
    _titleController = TextEditingController(text: widget.rule.title);
    _frequency = widget.rule.frequency;
    _dayOfWeek = widget.rule.dayOfWeek ?? 1;
    _dayOfMonth = widget.rule.dayOfMonth ?? 1;
    _month = widget.rule.month ?? 1;
    _sequential = widget.rule.sequential;
    _steps.addAll(
      widget.rule.steps.map(
        (step) => _StepEditorModel(
          id: step.id,
          title: step.title,
          assigneeId: step.assigneeId,
        ),
      ),
    );
  }

  @override
  void dispose() {
    for (final step in _steps) {
      step.dispose();
    }
    _titleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Edit Rule'),
      content: SizedBox(
        width: 620,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextField(
                controller: _titleController,
                decoration: const InputDecoration(
                  labelText: 'Title',
                  border: OutlineInputBorder(),
                ),
                autofocus: true,
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                value: _frequency,
                decoration: const InputDecoration(
                  labelText: 'Frequency',
                  border: OutlineInputBorder(),
                ),
                items: const [
                  DropdownMenuItem(value: 'weekly', child: Text('Weekly')),
                  DropdownMenuItem(value: 'monthly', child: Text('Monthly')),
                  DropdownMenuItem(value: 'annual', child: Text('Annual')),
                ],
                onChanged: (v) => setState(() => _frequency = v!),
              ),
              const SizedBox(height: 16),
              if (_frequency == 'weekly')
                DropdownButtonFormField<int>(
                  value: _dayOfWeek,
                  decoration: const InputDecoration(
                    labelText: 'Day of Week',
                    border: OutlineInputBorder(),
                  ),
                  items: List.generate(
                    7,
                    (i) =>
                        DropdownMenuItem(value: i, child: Text(_weekdays[i])),
                  ),
                  onChanged: (v) => setState(() => _dayOfWeek = v!),
                ),
              if (_frequency == 'monthly')
                _DayOfMonthField(
                  value: _dayOfMonth,
                  onChanged: (v) => setState(() => _dayOfMonth = v),
                ),
              if (_frequency == 'annual') ...[
                DropdownButtonFormField<int>(
                  value: _month,
                  decoration: const InputDecoration(
                    labelText: 'Month',
                    border: OutlineInputBorder(),
                  ),
                  items: List.generate(
                    12,
                    (i) =>
                        DropdownMenuItem(value: i + 1, child: Text(_months[i])),
                  ),
                  onChanged: (v) => setState(() => _month = v!),
                ),
                const SizedBox(height: 12),
                _DayOfMonthField(
                  value: _dayOfMonth,
                  onChanged: (v) => setState(() => _dayOfMonth = v),
                ),
              ],
              const SizedBox(height: 18),
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Workflow steps',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: _kTextPrimary,
                      ),
                    ),
                  ),
                  TextButton.icon(
                    onPressed: () {
                      setState(() {
                        _steps.add(
                          _StepEditorModel(id: _newStepId(_steps.length)),
                        );
                      });
                    },
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('Add step'),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                'Leave this empty to keep the rhythm as a single task.',
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(color: _kTextMuted),
              ),
              if (_steps.length > 1) ...[
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Sequential steps',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w500,
                              color: _kTextPrimary,
                            ),
                          ),
                          const SizedBox(height: 2),
                          const Text(
                            'Each step unlocks only after the previous one is completed.',
                            style: TextStyle(fontSize: 11, color: _kTextMuted),
                          ),
                        ],
                      ),
                    ),
                    Switch(
                      value: _sequential,
                      onChanged: (v) => setState(() => _sequential = v),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 12),
              if (_steps.isEmpty)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: _kSurfaceMuted,
                    borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                    border: Border.all(color: _kBorderSoft),
                  ),
                  child: const Text(
                    'No steps yet. Add one if this rhythm needs multiple tasks or assignees.',
                    style: TextStyle(color: _kTextMuted, fontSize: 12),
                  ),
                )
              else
                Column(
                  children: [
                    for (var i = 0; i < _steps.length; i++) ...[
                      _StepEditorRow(
                        step: _steps[i],
                        onAssigneeChanged: (value) =>
                            setState(() => _steps[i].assigneeId = value),
                        onRemove: () {
                          setState(() {
                            _steps[i].dispose();
                            _steps.removeAt(i);
                          });
                        },
                      ),
                      if (i != _steps.length - 1) const SizedBox(height: 10),
                    ],
                  ],
                ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Save'),
        ),
      ],
    );
  }

  String _newStepId(int index) {
    return 'step-${DateTime.now().microsecondsSinceEpoch}-$index';
  }

  Future<void> _save() async {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;
    final steps = _steps
        .map((step) => step.toStep())
        .where((step) => step.title.trim().isNotEmpty)
        .toList();
    setState(() => _saving = true);
    await widget.controller.updateRule(
      widget.rule.id,
      title: title,
      frequency: _frequency,
      dayOfWeek: _frequency == 'weekly' ? _dayOfWeek : null,
      dayOfMonth: (_frequency == 'monthly' || _frequency == 'annual')
          ? _dayOfMonth
          : null,
      month: _frequency == 'annual' ? _month : null,
      sequential: _sequential,
      steps: steps,
    );
    if (mounted) Navigator.pop(context);
  }
}

String _initialFor(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return '?';
  return trimmed[0].toUpperCase();
}

class _StepEditorRow extends StatelessWidget {
  const _StepEditorRow({
    required this.step,
    required this.onAssigneeChanged,
    required this.onRemove,
  });

  final _StepEditorModel step;
  final ValueChanged<int?> onAssigneeChanged;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _kSurfaceMuted,
        borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
        border: Border.all(color: _kBorderSoft),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Step',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: _kTextSecondary,
                  ),
                ),
              ),
              IconButton(
                onPressed: onRemove,
                icon: const Icon(Icons.delete_outline, size: 18),
                tooltip: 'Remove step',
              ),
            ],
          ),
          TextField(
            controller: step.titleController,
            decoration: const InputDecoration(
              labelText: 'Task title',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          WorkspaceMemberPicker(
            workspaceMembers: context.watch<WorkspaceController>().members,
            selectedUserId: step.assigneeId,
            onChanged: onAssigneeChanged,
          ),
        ],
      ),
    );
  }
}

class _DayOfMonthField extends StatelessWidget {
  const _DayOfMonthField({required this.value, required this.onChanged});
  final int value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      initialValue: value.toString(),
      decoration: const InputDecoration(
        labelText: 'Day of Month (1–31)',
        border: OutlineInputBorder(),
      ),
      keyboardType: TextInputType.number,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      onChanged: (v) {
        final n = int.tryParse(v);
        if (n != null && n >= 1 && n <= 31) onChanged(n);
      },
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onCreate});

  final VoidCallback onCreate;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 420),
      child: Container(
        padding: const EdgeInsets.all(28),
        decoration: BoxDecoration(
          color: _kSurfaceMuted,
          borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
          border: Border.all(color: _kBorderSoft),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: _kPrimarySoft,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: _kBorderSoft),
              ),
              child: const Icon(Icons.repeat, size: 28, color: _kPrimary),
            ),
            const SizedBox(height: 18),
            Text(
              'No recurring rules yet',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                color: _kTextPrimary,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.2,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Create a rhythm for weekly work, monthly check-ins, or annual reminders. The list will stay quiet until you add one.',
              textAlign: TextAlign.center,
              style: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(color: _kTextSecondary),
            ),
            const SizedBox(height: 18),
            FilledButton.tonalIcon(
              onPressed: onCreate,
              style: FilledButton.styleFrom(
                backgroundColor: _kPrimarySoft,
                foregroundColor: _kPrimary,
                elevation: 0,
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                ),
              ),
              icon: const Icon(Icons.add, size: 18),
              label: const Text('New rule'),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.enabled});

  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final background = enabled ? _kPrimarySoft : _kSurfaceMuted;
    final foreground = enabled ? _kPrimary : _kTextSecondary;
    final label = enabled ? 'Enabled' : 'Paused';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: _kBorderSoft),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
          color: foreground,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
