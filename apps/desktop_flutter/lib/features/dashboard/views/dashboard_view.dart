// ignore_for_file: use_build_context_synchronously, unused_element

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../app/core/formatters/date_formatters.dart';
import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/ui/rhythm_ui.dart';
import '../../../app/core/workspace/workspace_controller.dart';
import '../../../app/core/workspace/workspace_models.dart';
import '../../messages/controllers/messages_controller.dart';
import '../controllers/dashboard_controller.dart';
import '../../tasks/models/task.dart';
import '../models/dashboard_overview_models.dart';

class DashboardView extends StatefulWidget {
  const DashboardView({
    super.key,
    required this.openWeeklyPlanner,
    required this.openRhythms,
    required this.openProjects,
    required this.openMessages,
  });

  final VoidCallback openWeeklyPlanner;
  final VoidCallback openRhythms;
  final VoidCallback openProjects;
  final VoidCallback openMessages;

  @override
  State<DashboardView> createState() => _DashboardViewState();
}

class _DashboardViewState extends State<DashboardView> {
  final _addTaskController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<DashboardController>().load();
      context.read<WorkspaceController>().loadMembers();
    });
  }

  @override
  void dispose() {
    _addTaskController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RhythmSurface.page(
      padding: const EdgeInsets.all(RhythmSpacing.sm),
      child: Consumer<DashboardController>(
        builder: (context, controller, _) {
          return switch (controller.status) {
            DashboardStatus.loading => const RhythmEmptyState(
                title: 'Loading dashboard...',
                tone: RhythmEmptyStateTone.loading,
              ),
            DashboardStatus.error => _ErrorView(
                message: controller.errorMessage ?? 'Unknown error',
                onRetry: controller.refresh,
              ),
            DashboardStatus.ready => _DashboardBody(
                controller: controller,
                openWeeklyPlanner: widget.openWeeklyPlanner,
                openRhythms: widget.openRhythms,
                openProjects: widget.openProjects,
                openMessages: widget.openMessages,
              ),
          };
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Error view
// ---------------------------------------------------------------------------

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return RhythmSurface.section(
      clipBehavior: Clip.antiAlias,
      child: RhythmEmptyState(
        title: 'Dashboard could not load',
        message: message,
        icon: Icons.error_outline,
        tone: RhythmEmptyStateTone.error,
        actionLabel: 'Retry',
        onAction: onRetry,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Main body
// ---------------------------------------------------------------------------

class _DashboardBody extends StatefulWidget {
  const _DashboardBody({
    required this.controller,
    required this.openWeeklyPlanner,
    required this.openRhythms,
    required this.openProjects,
    required this.openMessages,
  });

  final DashboardController controller;
  final VoidCallback openWeeklyPlanner;
  final VoidCallback openRhythms;
  final VoidCallback openProjects;
  final VoidCallback openMessages;

  @override
  State<_DashboardBody> createState() => _DashboardBodyState();
}

class _DashboardBodyState extends State<_DashboardBody> {
  final _addTaskController = TextEditingController();
  String? _selectedDueDate;

  @override
  void dispose() {
    _addTaskController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2030),
    );
    if (picked != null) {
      setState(
        () => _selectedDueDate = picked.toIso8601String().substring(0, 10),
      );
    }
  }

  Future<void> _submitTask() async {
    final title = _addTaskController.text.trim();
    if (title.isEmpty) return;
    await widget.controller.createTask(title, dueDate: _selectedDueDate);
    _addTaskController.clear();
    setState(() => _selectedDueDate = null);
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    final currentUserId = context.watch<AuthSessionService>().currentUser?.id;
    final workspaceMembers = context.watch<WorkspaceController>().members;
    return RhythmSurface.section(
      clipBehavior: Clip.antiAlias,
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildHeader(context, c),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(
                RhythmSpacing.md,
                0,
                RhythmSpacing.md,
                RhythmSpacing.md,
              ),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 1280),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _buildHero(context, c),
                      const SizedBox(height: RhythmSpacing.lg),
                      const _SectionLabel(
                        title: 'Planning',
                        subtitle: 'What needs attention this week and today',
                      ),
                      const SizedBox(height: RhythmSpacing.sm),
                      _buildOverviewGrid(
                        context,
                        c,
                        currentUserId: currentUserId,
                        workspaceMembers: workspaceMembers,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          _buildAddTaskBar(context, c),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------

  Widget _buildHeader(BuildContext context, DashboardController c) {
    return RhythmToolbar(
      title: 'Dashboard',
      subtitle: 'A calm view of the week ahead.',
      leading: const RhythmBadge(
        label: 'Planning',
        icon: Icons.dashboard_outlined,
        tone: RhythmBadgeTone.accent,
      ),
      padding: const EdgeInsets.fromLTRB(
        RhythmSpacing.md,
        RhythmSpacing.sm,
        RhythmSpacing.md,
        RhythmSpacing.sm,
      ),
      actions: [
        RhythmBadge(
          label: '${c.openTaskCount} open',
          icon: Icons.radio_button_unchecked,
          compact: true,
        ),
        RhythmBadge(
          label: '${c.messageThreadCount} threads',
          icon: Icons.chat_bubble_outline,
          compact: true,
        ),
        RhythmButton.icon(
          onPressed: c.refresh,
          icon: Icons.refresh,
          tooltip: 'Refresh',
        ),
      ],
    );
  }

  Widget _buildHero(BuildContext context, DashboardController c) {
    final colors = context.rhythm;
    return RhythmPanel(
      elevated: true,
      backgroundColor: colors.surfaceRaised,
      borderColor: colors.border,
      padding: const EdgeInsets.all(RhythmSpacing.md),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          final useSingleColumn = width < 900;

          final todayCard = _ProgressDialCard(
            title: "Today's Tasks",
            tone: RhythmBadgeTone.accent,
            icon: Icons.today_outlined,
            remainingCount: c.todayTasksRemainingCount,
            totalCount: c.todayTasksTotalCount,
            subtitle: c.todayTasksRemainingCount == 0
                ? 'Clear for today'
                : '${c.todayTasksRemainingCount} remaining',
            openText: 'Planner',
            onTap: widget.openWeeklyPlanner,
          );

          final thisWeekCard = _ProgressDialCard(
            title: "This Week",
            tone: RhythmBadgeTone.success,
            icon: Icons.calendar_view_week_outlined,
            remainingCount: c.thisWeekTasksRemainingCount,
            totalCount: c.thisWeekTasksTotalCount,
            subtitle: c.thisWeekTasksRemainingCount == 0
                ? 'Week is clear'
                : '${c.thisWeekTasksRemainingCount} remaining',
            openText: 'Planner',
            onTap: widget.openWeeklyPlanner,
          );

          final unreadCard = _UnreadOverviewCard(
            items: c.unreadMessages,
            onTapHeader: widget.openMessages,
            onTapItem: (preview) => _openMessageThread(context, preview),
          );

          final projectCards = _buildProjectMetricCards(c);

          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const _HeroEyebrow(text: 'At a glance'),
              const SizedBox(height: RhythmSpacing.sm),
              Text(
                'Move the week forward.',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      color: colors.textPrimary,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0,
                    ),
              ),
              const SizedBox(height: RhythmSpacing.xs),
              Text(
                'Today, this week, your next project, and unread messages in one compact view.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: colors.textSecondary,
                      height: 1.4,
                    ),
              ),
              const SizedBox(height: RhythmSpacing.md),
              if (useSingleColumn)
                Column(
                  children: [
                    todayCard,
                    const SizedBox(height: RhythmSpacing.sm),
                    thisWeekCard,
                    for (final card in projectCards) ...[
                      const SizedBox(height: RhythmSpacing.sm),
                      card,
                    ],
                    const SizedBox(height: RhythmSpacing.sm),
                    unreadCard,
                  ],
                )
              else
                Column(
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: todayCard),
                        const SizedBox(width: RhythmSpacing.sm),
                        Expanded(child: thisWeekCard),
                      ],
                    ),
                    if (projectCards.isEmpty) ...[
                      const SizedBox(height: RhythmSpacing.sm),
                      unreadCard,
                    ] else if (projectCards.length == 1) ...[
                      const SizedBox(height: RhythmSpacing.sm),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(child: projectCards.first),
                          const SizedBox(width: RhythmSpacing.sm),
                          Expanded(child: unreadCard),
                        ],
                      ),
                    ] else ...[
                      const SizedBox(height: RhythmSpacing.sm),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(child: projectCards[0]),
                          const SizedBox(width: RhythmSpacing.sm),
                          Expanded(child: projectCards[1]),
                        ],
                      ),
                      const SizedBox(height: RhythmSpacing.sm),
                      unreadCard,
                    ],
                  ],
                ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildOverviewGrid(
    BuildContext context,
    DashboardController c, {
    required int? currentUserId,
    required List<WorkspaceMember> workspaceMembers,
  }) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = 14.0;
        final cardWidth = constraints.maxWidth < 1180
            ? constraints.maxWidth
            : (constraints.maxWidth - gap) / 2;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (c.pastDueTasks.isNotEmpty) ...[
              SizedBox(
                width: constraints.maxWidth,
                child: _TaskListCard(
                  title: 'Past Due Tasks',
                  countLabel: '${c.pastDueTaskCount} past due',
                  items: c.pastDueTasks,
                  emptyLabel: 'Nothing past due.',
                  tone: RhythmBadgeTone.danger,
                  icon: Icons.priority_high_outlined,
                  onTapHeader: widget.openWeeklyPlanner,
                  onTapTask: (_) => widget.openWeeklyPlanner(),
                  showPastDue: true,
                ),
              ),
              const SizedBox(height: gap),
            ],
            Wrap(
              spacing: gap,
              runSpacing: gap,
              children: [
                SizedBox(
                  width: cardWidth,
                  child: _HandoffListCard(
                    items: c.handoffTasks,
                    currentUserId: currentUserId,
                    workspaceMembers: workspaceMembers,
                    onTapHeader: widget.openWeeklyPlanner,
                    onTapTask: (_) => widget.openWeeklyPlanner(),
                  ),
                ),
                SizedBox(
                  width: cardWidth,
                  child: _TaskListCard(
                    title: "Today's Tasks",
                    countLabel: '${c.todayTasksRemainingCount} left',
                    items: c.todayTasks,
                    emptyLabel: 'No tasks scheduled for today.',
                    tone: RhythmBadgeTone.accent,
                    icon: Icons.today_outlined,
                    onTapHeader: widget.openWeeklyPlanner,
                    onTapTask: (_) => widget.openWeeklyPlanner(),
                    showPastDue: true,
                  ),
                ),
                SizedBox(
                  width: cardWidth,
                  child: _TaskListCard(
                    title: "This Week's Tasks",
                    countLabel: '${c.thisWeekTasksRemainingCount} left',
                    items: c.thisWeekTasks,
                    emptyLabel: 'No tasks due this week.',
                    tone: RhythmBadgeTone.success,
                    icon: Icons.calendar_view_week_outlined,
                    onTapHeader: widget.openWeeklyPlanner,
                    onTapTask: (_) => widget.openWeeklyPlanner(),
                    showPastDue: true,
                  ),
                ),
                SizedBox(
                  width: cardWidth,
                  child: _TaskListCard(
                    title: 'Unscheduled Tasks',
                    countLabel: '${c.unscheduledTaskCount} unscheduled',
                    items: c.unscheduledTasks,
                    emptyLabel: 'No unscheduled tasks.',
                    tone: RhythmBadgeTone.neutral,
                    icon: Icons.inbox_outlined,
                    onTapHeader: widget.openWeeklyPlanner,
                    onTapTask: (_) => widget.openWeeklyPlanner(),
                    showPastDue: false,
                  ),
                ),
                SizedBox(
                  width: cardWidth,
                  child: _ProgressPreviewCard(
                    title: 'Active Rhythms',
                    countLabel: '${c.activeRhythmsCount} active',
                    emptyLabel: 'No active rhythms.',
                    items: c.activeRhythms,
                    tone: RhythmBadgeTone.success,
                    icon: Icons.repeat,
                    onTapHeader: widget.openRhythms,
                    onTapItem: (_) => widget.openRhythms(),
                  ),
                ),
                SizedBox(
                  width: cardWidth,
                  child: _ProgressPreviewCard(
                    title: 'Active Projects',
                    countLabel: '${c.activeProjectsCount} active',
                    emptyLabel: 'No active projects.',
                    items: c.activeProjects,
                    tone: RhythmBadgeTone.warning,
                    icon: Icons.folder_open_outlined,
                    onTapHeader: widget.openProjects,
                    onTapItem: (_) => widget.openProjects(),
                  ),
                ),
              ],
            ),
          ],
        );
      },
    );
  }

  Future<void> _openMessageThread(
    BuildContext context,
    DashboardUnreadMessagePreview preview,
  ) async {
    await context.read<MessagesController>().selectThread(preview.threadId);
    if (!mounted) return;
    widget.openMessages();
  }

  List<Widget> _buildProjectMetricCards(DashboardController controller) {
    final projects = controller.activeProjects;
    if (projects.isEmpty) return const [];

    final visibleProjects = projects.take(2).toList();

    return [
      for (final project in visibleProjects)
        _ProgressDialCard(
          title: visibleProjects.length == 1
              ? 'Project due soonest'
              : project.title,
          tone: RhythmBadgeTone.warning,
          icon: Icons.folder_open_outlined,
          remainingCount: project.totalCount - project.completedCount,
          totalCount: project.totalCount,
          primaryLabel: project.title,
          subtitle: project.nextDueDate == null
              ? '${project.completedCount}/${project.totalCount} complete'
              : 'Next ${DateFormatters.fullDate(project.nextDueDate!, fallback: project.nextDueDate!)}',
          openText: 'Projects',
          onTap: widget.openProjects,
        ),
    ];
  }
  // -------------------------------------------------------------------------
  // Add task bar
  // -------------------------------------------------------------------------

  Widget _buildAddTaskBar(BuildContext context, DashboardController c) {
    final colors = context.rhythm;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        RhythmSpacing.md,
        0,
        RhythmSpacing.md,
        RhythmSpacing.md,
      ),
      child: RhythmPanel(
        elevated: true,
        backgroundColor: colors.surfaceRaised,
        borderColor: colors.border,
        padding: const EdgeInsets.all(RhythmSpacing.sm),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final taskField = TextField(
              controller: _addTaskController,
              style: TextStyle(color: colors.textPrimary),
              decoration: InputDecoration(
                hintText: 'Add a task...',
                hintStyle: TextStyle(color: colors.textMuted),
                isDense: true,
                filled: true,
                fillColor: colors.surfaceMuted,
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                  borderSide: BorderSide(color: colors.borderSubtle),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                  borderSide: BorderSide(color: colors.focusRing),
                ),
              ),
              onSubmitted: (_) => _submitTask(),
            );

            final dueDateButton = RhythmButton.outlined(
              onPressed: _pickDate,
              icon: Icons.calendar_today_outlined,
              label: _selectedDueDate == null
                  ? 'Due date'
                  : DateFormatters.fullDate(_selectedDueDate),
            );

            final addButton = RhythmButton.filled(
              onPressed: _submitTask,
              icon: Icons.add,
              label: 'Add Task',
            );

            if (constraints.maxWidth < 720) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  taskField,
                  const SizedBox(height: RhythmSpacing.sm),
                  Wrap(
                    spacing: RhythmSpacing.sm,
                    runSpacing: RhythmSpacing.sm,
                    alignment: WrapAlignment.end,
                    children: [
                      dueDateButton,
                      addButton,
                    ],
                  ),
                ],
              );
            }

            return Row(
              children: [
                Expanded(child: taskField),
                const SizedBox(width: RhythmSpacing.sm),
                dueDateButton,
                const SizedBox(width: RhythmSpacing.sm),
                addButton,
              ],
            );
          },
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Row(
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: colors.textPrimary,
                      letterSpacing: 0,
                    ),
              ),
              const SizedBox(height: RhythmSpacing.xxs),
              Text(
                subtitle,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: colors.textSecondary),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _HeroEyebrow extends StatelessWidget {
  const _HeroEyebrow({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return RhythmBadge(
      label: text.toUpperCase(),
      icon: Icons.auto_awesome_outlined,
      tone: RhythmBadgeTone.accent,
      compact: true,
    );
  }
}

class _ProgressDialCard extends StatelessWidget {
  const _ProgressDialCard({
    required this.title,
    required this.tone,
    required this.icon,
    required this.remainingCount,
    required this.totalCount,
    required this.subtitle,
    required this.openText,
    required this.onTap,
    this.primaryLabel,
  });

  final String title;
  final RhythmBadgeTone tone;
  final IconData icon;
  final int remainingCount;
  final int totalCount;
  final String subtitle;
  final String openText;
  final VoidCallback onTap;
  final String? primaryLabel;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final accent = _toneColor(colors, tone);
    final progress = totalCount == 0
        ? 0.0
        : ((totalCount - remainingCount).clamp(0, totalCount) / totalCount);
    return _DashboardPreviewShell(
      title: title,
      tone: tone,
      icon: icon,
      onTap: onTap,
      trailing: RhythmButton.quiet(
        onPressed: onTap,
        label: openText,
        icon: Icons.arrow_forward,
        compact: true,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      primaryLabel ??
                          (totalCount == 0
                              ? 'No tasks'
                              : '$remainingCount left'),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      totalCount == 0
                          ? '0% complete'
                          : '${((progress * 100).round())}% complete',
                      style: TextStyle(
                        fontSize: 12,
                        color: accent,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              SizedBox(
                width: 70,
                height: 70,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    CircularProgressIndicator(
                      value: progress,
                      strokeWidth: 7,
                      backgroundColor: colors.surfaceMuted,
                      valueColor: AlwaysStoppedAnimation<Color>(accent),
                    ),
                    Text(
                      totalCount == 0 ? '0%' : '${((progress * 100).round())}%',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: colors.textPrimary,
                        height: 1,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          LinearProgressIndicator(
            value: progress,
            minHeight: 7,
            borderRadius: BorderRadius.circular(999),
            backgroundColor: colors.surfaceMuted,
            valueColor: AlwaysStoppedAnimation<Color>(accent),
          ),
          const SizedBox(height: 8),
          Text(
            subtitle,
            style: TextStyle(
              fontSize: 12,
              color: colors.textSecondary,
              height: 1.35,
            ),
          ),
        ],
      ),
    );
  }
}

class _UnreadOverviewCard extends StatelessWidget {
  const _UnreadOverviewCard({
    required this.items,
    required this.onTapHeader,
    required this.onTapItem,
  });

  final List<DashboardUnreadMessagePreview> items;
  final VoidCallback onTapHeader;
  final ValueChanged<DashboardUnreadMessagePreview> onTapItem;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final visible = items.take(3).toList();
    return _DashboardPreviewShell(
      title: 'Unread Messages',
      tone: RhythmBadgeTone.info,
      icon: Icons.mark_chat_unread_outlined,
      onTap: onTapHeader,
      trailing: RhythmBadge(
        label: '${items.length} unread',
        tone: RhythmBadgeTone.info,
        compact: true,
      ),
      child: visible.isEmpty
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: RhythmSpacing.xs),
              child: Text(
                'You are caught up.',
                style: TextStyle(color: colors.textSecondary, fontSize: 13),
              ),
            )
          : Column(
              children: [
                for (final item in visible)
                  _UnreadMessagePreviewRow(
                    preview: item,
                    tone: RhythmBadgeTone.info,
                    onTap: () => onTapItem(item),
                  ),
              ],
            ),
    );
  }
}

class _TaskListCard extends StatelessWidget {
  const _TaskListCard({
    required this.title,
    required this.items,
    required this.emptyLabel,
    required this.tone,
    required this.icon,
    required this.onTapHeader,
    required this.onTapTask,
    required this.countLabel,
    this.showPastDue = false,
  });

  final String title;
  final List<Task> items;
  final String emptyLabel;
  final RhythmBadgeTone tone;
  final IconData icon;
  final VoidCallback onTapHeader;
  final ValueChanged<Task> onTapTask;
  final String countLabel;
  final bool showPastDue;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final visible = items.take(3).toList();
    return _DashboardPreviewShell(
      title: title,
      tone: tone,
      icon: icon,
      onTap: onTapHeader,
      trailing: RhythmBadge(
        label: countLabel,
        tone: tone,
        compact: true,
      ),
      child: visible.isEmpty
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                emptyLabel,
                style: TextStyle(
                  color: colors.textSecondary,
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
            )
          : Column(
              children: [
                for (final task in visible)
                  _TaskPreviewRow(
                    task: task,
                    showPastDue: showPastDue,
                    onTap: () => onTapTask(task),
                  ),
                if (items.length > visible.length)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        '+${items.length - visible.length} more',
                        style: TextStyle(
                          color: colors.textSecondary,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
    );
  }
}

class _HandoffListCard extends StatelessWidget {
  const _HandoffListCard({
    required this.items,
    required this.currentUserId,
    required this.workspaceMembers,
    required this.onTapHeader,
    required this.onTapTask,
  });

  final List<Task> items;
  final int? currentUserId;
  final List<WorkspaceMember> workspaceMembers;
  final VoidCallback onTapHeader;
  final ValueChanged<Task> onTapTask;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final waitingOnMe = <Task>[];
    final sharedWithMe = <Task>[];
    final teamShared = <Task>[];

    for (final task in items) {
      final collaboratorIds = task.collaborators.map((c) => c.userId).toSet();
      final ownedByMe = currentUserId != null && task.ownerId == currentUserId;
      final includesMe =
          currentUserId != null && collaboratorIds.contains(currentUserId);

      if (ownedByMe) {
        waitingOnMe.add(task);
      } else if (includesMe) {
        sharedWithMe.add(task);
      } else {
        teamShared.add(task);
      }
    }

    final visible = [
      ...waitingOnMe.take(2),
      ...sharedWithMe.take(2),
      ...teamShared.take(2),
    ].take(4).toList();

    return _DashboardPreviewShell(
      title: 'Collaborator Handoffs',
      tone: RhythmBadgeTone.warning,
      icon: Icons.handshake_outlined,
      onTap: onTapHeader,
      trailing: RhythmBadge(
        label: '${items.length} shared',
        tone: RhythmBadgeTone.warning,
        compact: true,
      ),
      child: items.isEmpty
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                'No shared tasks need attention right now.',
                style: TextStyle(
                  color: colors.textSecondary,
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: RhythmSpacing.xs,
                  runSpacing: RhythmSpacing.xs,
                  children: [
                    _HandoffSummaryPill(
                      label: 'Waiting on me',
                      count: waitingOnMe.length,
                      tone: RhythmBadgeTone.warning,
                    ),
                    _HandoffSummaryPill(
                      label: 'Shared with me',
                      count: sharedWithMe.length,
                      tone: RhythmBadgeTone.accent,
                    ),
                    _HandoffSummaryPill(
                      label: 'Team shared',
                      count: teamShared.length,
                      tone: RhythmBadgeTone.info,
                    ),
                  ],
                ),
                const SizedBox(height: RhythmSpacing.xs),
                for (final task in visible)
                  _HandoffPreviewRow(
                    task: task,
                    currentUserId: currentUserId,
                    workspaceMembers: workspaceMembers,
                    onTap: () => onTapTask(task),
                  ),
                if (items.length > visible.length)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      '+${items.length - visible.length} more shared tasks',
                      style: TextStyle(
                        color: colors.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                  ),
                if (currentUserId == null)
                  Padding(
                    padding: const EdgeInsets.only(top: RhythmSpacing.xs),
                    child: Text(
                      'Sign-in context is needed to separate tasks owned by you from tasks shared with you.',
                      style: TextStyle(
                        color: colors.textMuted,
                        fontSize: 11.5,
                        height: 1.35,
                      ),
                    ),
                  ),
              ],
            ),
    );
  }
}

class _HandoffSummaryPill extends StatelessWidget {
  const _HandoffSummaryPill({
    required this.label,
    required this.count,
    required this.tone,
  });

  final String label;
  final int count;
  final RhythmBadgeTone tone;

  @override
  Widget build(BuildContext context) {
    return RhythmBadge(
      label: '$count $label',
      tone: tone,
      compact: true,
    );
  }
}

class _ProgressPreviewCard<T extends DashboardProgressItem>
    extends StatelessWidget {
  const _ProgressPreviewCard({
    required this.title,
    required this.items,
    required this.emptyLabel,
    required this.tone,
    required this.icon,
    required this.onTapHeader,
    required this.onTapItem,
    required this.countLabel,
  });

  final String title;
  final List<T> items;
  final String emptyLabel;
  final RhythmBadgeTone tone;
  final IconData icon;
  final VoidCallback onTapHeader;
  final ValueChanged<T> onTapItem;
  final String countLabel;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final visible = items.take(3).toList();
    return _DashboardPreviewShell(
      title: title,
      tone: tone,
      icon: icon,
      onTap: onTapHeader,
      trailing: RhythmBadge(
        label: countLabel,
        tone: tone,
        compact: true,
      ),
      child: visible.isEmpty
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: 18),
              child: Text(
                emptyLabel,
                style: TextStyle(
                  color: colors.textSecondary,
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
            )
          : Column(
              children: [
                for (final item in visible)
                  _ProgressPreviewRow(
                    item: item,
                    tone: tone,
                    onTap: () => onTapItem(item),
                  ),
                if (items.length > visible.length)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        '+${items.length - visible.length} more',
                        style: TextStyle(
                          color: colors.textSecondary,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
    );
  }
}

bool _isPastDue(Task task) {
  if (task.status == 'done') return false;
  final date = _taskPriorityDate(task);
  if (date == null) return false;
  final today = DateTime.now();
  final stripped = DateTime(today.year, today.month, today.day);
  return date.isBefore(stripped);
}

DateTime? _taskPriorityDate(Task task) {
  final scheduled = task.scheduledDate == null
      ? null
      : DateTime.tryParse(task.scheduledDate!);
  if (scheduled != null) {
    return DateTime(scheduled.year, scheduled.month, scheduled.day);
  }
  final due = task.dueDate == null ? null : DateTime.tryParse(task.dueDate!);
  return due == null ? null : DateTime(due.year, due.month, due.day);
}

String _taskSourceLabel(Task task) {
  final sourceName = task.sourceName?.trim();
  if (sourceName != null && sourceName.isNotEmpty) return sourceName;
  return switch (task.sourceType) {
    'recurring_rule' => 'Rhythm',
    'project_step' => 'Project',
    'calendar_shadow_event' => 'Calendar',
    'planning_center_signal' => 'Planning Center',
    'automation_rule' => 'Automation',
    _ => task.sourceType ?? 'Source',
  };
}

RhythmBadgeTone _taskTone(Task task, {bool showPastDue = false}) {
  if (showPastDue && _isPastDue(task)) return RhythmBadgeTone.danger;
  return switch (task.sourceType) {
    'recurring_rule' => RhythmBadgeTone.success,
    'project_step' => RhythmBadgeTone.warning,
    'calendar_shadow_event' => RhythmBadgeTone.info,
    'planning_center_signal' => RhythmBadgeTone.warning,
    'automation_rule' => RhythmBadgeTone.accent,
    _ => RhythmBadgeTone.neutral,
  };
}

RhythmBadgeTone _handoffTone(Task task, int? currentUserId) {
  final collaboratorIds = task.collaborators.map((c) => c.userId).toSet();
  final ownedByMe = currentUserId != null && task.ownerId == currentUserId;
  final includesMe =
      currentUserId != null && collaboratorIds.contains(currentUserId);

  if (ownedByMe) return RhythmBadgeTone.warning;
  if (includesMe) return RhythmBadgeTone.accent;
  return RhythmBadgeTone.info;
}

String _handoffLabel(
  Task task,
  int? currentUserId,
  List<WorkspaceMember> workspaceMembers,
) {
  final collaboratorIds = task.collaborators.map((c) => c.userId).toSet();
  final ownedByMe = currentUserId != null && task.ownerId == currentUserId;
  final includesMe =
      currentUserId != null && collaboratorIds.contains(currentUserId);

  if (ownedByMe) return 'Waiting on me';
  if (includesMe) {
    final ownerName = _memberName(task.ownerId, workspaceMembers);
    if (ownerName == null) return 'Shared with me';
    return '$ownerName owns this with you';
  }
  return 'Team shared';
}

String? _handoffPeopleLabel(
  Task task,
  int? currentUserId,
  List<WorkspaceMember> workspaceMembers,
) {
  final names = <String>[];
  for (final collaborator in task.collaborators) {
    if (collaborator.userId == currentUserId) continue;
    final name = collaborator.name.trim().isNotEmpty
        ? collaborator.name.trim()
        : _memberName(
            collaborator.userId,
            workspaceMembers,
            fallbackLabel: 'User',
          );
    if (name != null && !names.contains(name)) names.add(name);
  }

  final ownerName = _memberName(task.ownerId, workspaceMembers);
  if (ownerName != null &&
      task.ownerId != currentUserId &&
      !names.contains(ownerName)) {
    names.insert(0, ownerName);
  }

  if (names.isEmpty) return null;
  if (names.length == 1) return 'With ${names.first}';
  if (names.length == 2) return 'With ${names.join(' and ')}';
  return 'With ${names.take(2).join(', ')} +${names.length - 2}';
}

String? _memberName(
  int? userId,
  List<WorkspaceMember> workspaceMembers, {
  String fallbackLabel = 'Owner',
}) {
  if (userId == null) return null;
  for (final member in workspaceMembers) {
    if (member.userId == userId) return member.name;
  }
  return '$fallbackLabel #$userId';
}

Color _toneColor(RhythmColorRoles colors, RhythmBadgeTone tone) {
  return switch (tone) {
    RhythmBadgeTone.neutral => colors.textSecondary,
    RhythmBadgeTone.accent => colors.accent,
    RhythmBadgeTone.success => colors.success,
    RhythmBadgeTone.warning => colors.warning,
    RhythmBadgeTone.danger => colors.danger,
    RhythmBadgeTone.info => colors.info,
  };
}

class _DashboardPreviewShell extends StatelessWidget {
  const _DashboardPreviewShell({
    required this.title,
    required this.child,
    required this.trailing,
    required this.onTap,
    required this.tone,
    required this.icon,
  });

  final String title;
  final Widget child;
  final Widget trailing;
  final VoidCallback onTap;
  final RhythmBadgeTone tone;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final accent = _toneColor(colors, tone);
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(RhythmRadius.lg),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        child: Container(
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(RhythmRadius.lg),
            color: colors.surface,
            border: Border.all(color: colors.borderSubtle),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                height: 3,
                color: accent.withValues(alpha: 0.8),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 16, 18, 0),
                child: Row(
                  children: [
                    Container(
                      width: 30,
                      height: 30,
                      decoration: BoxDecoration(
                        color: accent.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(RhythmRadius.sm),
                        border: Border.all(
                          color: accent.withValues(alpha: 0.22),
                        ),
                      ),
                      child: Icon(icon, size: 16, color: accent),
                    ),
                    const SizedBox(width: RhythmSpacing.sm),
                    Expanded(
                      child: Text(
                        title,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: colors.textPrimary,
                          letterSpacing: 0,
                        ),
                      ),
                    ),
                    trailing,
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 14, 18, 18),
                child: child,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TaskPreviewRow extends StatelessWidget {
  const _TaskPreviewRow({
    required this.task,
    required this.onTap,
    this.showPastDue = false,
  });

  final Task task;
  final VoidCallback onTap;
  final bool showPastDue;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final tone = _taskTone(task, showPastDue: showPastDue);
    final accent = _toneColor(colors, tone);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(RhythmRadius.md),
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: colors.surfaceMuted.withValues(alpha: 0.74),
          borderRadius: BorderRadius.circular(RhythmRadius.md),
          border: Border.all(color: colors.borderSubtle),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 4,
              height: 22,
              margin: const EdgeInsets.only(top: 1),
              decoration: BoxDecoration(
                color: task.status == 'done' ? colors.border : accent,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (task.sourceName?.trim().isNotEmpty == true) ...[
                    Text(
                      task.sourceName!.trim(),
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: accent,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 3),
                  ],
                  Text(
                    task.title,
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: colors.textPrimary,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      if (showPastDue && _isPastDue(task))
                        const RhythmBadge(
                          label: 'Past due',
                          tone: RhythmBadgeTone.danger,
                          compact: true,
                        ),
                      if (task.dueDate != null)
                        RhythmBadge(
                          label:
                              'Due ${DateFormatters.fullDate(task.dueDate, fallback: task.dueDate!)}',
                          tone: RhythmBadgeTone.neutral,
                          compact: true,
                        ),
                      if (task.scheduledDate != null)
                        RhythmBadge(
                          label:
                              'Scheduled ${DateFormatters.fullDate(task.scheduledDate, fallback: task.scheduledDate!)}',
                          tone: RhythmBadgeTone.neutral,
                          compact: true,
                        ),
                      if (task.sourceType != null)
                        RhythmBadge(
                          label: _taskSourceLabel(task),
                          tone: tone,
                          compact: true,
                        ),
                    ],
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

class _HandoffPreviewRow extends StatelessWidget {
  const _HandoffPreviewRow({
    required this.task,
    required this.currentUserId,
    required this.workspaceMembers,
    required this.onTap,
  });

  final Task task;
  final int? currentUserId;
  final List<WorkspaceMember> workspaceMembers;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final tone = _handoffTone(task, currentUserId);
    final accent = _toneColor(colors, tone);
    final label = _handoffLabel(task, currentUserId, workspaceMembers);
    final peopleLabel =
        _handoffPeopleLabel(task, currentUserId, workspaceMembers);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(RhythmRadius.md),
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
        decoration: BoxDecoration(
          color: colors.surfaceMuted.withValues(alpha: 0.78),
          borderRadius: BorderRadius.circular(RhythmRadius.md),
          border: Border.all(color: accent.withValues(alpha: 0.2)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: accent.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                border: Border.all(color: accent.withValues(alpha: 0.22)),
              ),
              child: Icon(Icons.group_outlined, size: 15, color: accent),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 11.5,
                      color: accent,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    task.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12.5,
                      color: colors.textPrimary,
                      fontWeight: FontWeight.w700,
                      height: 1.25,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      if (peopleLabel != null)
                        RhythmBadge(
                          label: peopleLabel,
                          icon: Icons.people_outline,
                          tone: RhythmBadgeTone.neutral,
                          compact: true,
                        ),
                      if (task.dueDate != null)
                        RhythmBadge(
                          label:
                              'Due ${DateFormatters.fullDate(task.dueDate, fallback: task.dueDate!)}',
                          tone: RhythmBadgeTone.neutral,
                          compact: true,
                        ),
                      if (task.sourceType != null)
                        RhythmBadge(
                          label: _taskSourceLabel(task),
                          tone: tone,
                          compact: true,
                        ),
                    ],
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

class _ProgressPreviewRow extends StatelessWidget {
  const _ProgressPreviewRow({
    required this.item,
    required this.onTap,
    required this.tone,
  });

  final DashboardProgressItem item;
  final VoidCallback onTap;
  final RhythmBadgeTone tone;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final accent = _toneColor(colors, tone);
    final title = item.title;
    final subtitle = item.subtitle;
    final progress = item.progress.clamp(0.0, 1.0);
    final completedCount = item.completedCount;
    final totalCount = item.totalCount;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                      color: colors.textPrimary,
                    ),
                  ),
                ),
                Text(
                  '$completedCount/$totalCount',
                  style: TextStyle(fontSize: 12, color: colors.textSecondary),
                ),
              ],
            ),
            const SizedBox(height: 4),
            LinearProgressIndicator(
              value: progress,
              minHeight: 7,
              backgroundColor: colors.surfaceMuted,
              valueColor: AlwaysStoppedAnimation<Color>(accent),
              borderRadius: BorderRadius.circular(999),
            ),
            const SizedBox(height: 4),
            Text(
              subtitle,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12,
                color: colors.textSecondary,
                height: 1.35,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _UnreadMessagePreviewRow extends StatelessWidget {
  const _UnreadMessagePreviewRow({
    required this.preview,
    required this.onTap,
    required this.tone,
  });

  final DashboardUnreadMessagePreview preview;
  final VoidCallback onTap;
  final RhythmBadgeTone tone;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final accent = _toneColor(colors, tone);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(RhythmRadius.md),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 4,
              height: 30,
              margin: const EdgeInsets.only(top: 1),
              decoration: BoxDecoration(color: accent, shape: BoxShape.circle),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          preview.senderName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w700,
                            color: colors.textPrimary,
                          ),
                        ),
                      ),
                      RhythmBadge(
                        label: '${preview.unreadCount}',
                        tone: tone,
                        compact: true,
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    preview.preview,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12,
                      color: colors.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    preview.threadTitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 11,
                      color: colors.textMuted,
                      height: 1.25,
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
