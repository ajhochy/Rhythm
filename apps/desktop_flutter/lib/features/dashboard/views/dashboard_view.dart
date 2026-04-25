// ignore_for_file: use_build_context_synchronously, unused_element

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../app/core/formatters/date_formatters.dart';
import '../../../shared/widgets/rhythm_task_create_bar.dart';
import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/ui/rhythm_ui.dart';
import '../../../app/core/workspace/workspace_controller.dart';
import '../../../app/core/workspace/workspace_models.dart';
import '../../messages/controllers/messages_controller.dart';
import '../../projects/models/project_instance.dart';
import '../controllers/dashboard_controller.dart';
import '../../tasks/data/collaborators_data_source.dart';
import '../../tasks/models/task_collaborator.dart';
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
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RhythmSurface.page(
      padding: const EdgeInsets.all(RhythmSpacing.sm),
      child: Consumer<DashboardController>(
        builder: (context, controller, _) {
          return switch (controller.status) {
            DashboardStatus.loading => const RhythmSurface.section(
                clipBehavior: Clip.antiAlias,
                child: RhythmEmptyState(
                  title: 'Loading dashboard...',
                  message: 'Planning, handoffs, and previews will appear here.',
                  tone: RhythmEmptyStateTone.loading,
                ),
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
                      _buildHero(
                        context,
                        c,
                        currentUserId: currentUserId,
                        workspaceMembers: workspaceMembers,
                      ),
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
          RhythmTaskCreateBar(
            addLabel: 'Add task',
            onSubmit: (title, {notes, dueDate, collaboratorId}) {
              context.read<DashboardController>().createTask(
                    title,
                    notes: notes,
                    dueDate: dueDate,
                    collaboratorId: collaboratorId,
                  );
            },
          ),
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

  Widget _buildHero(
    BuildContext context,
    DashboardController c, {
    required int? currentUserId,
    required List<WorkspaceMember> workspaceMembers,
  }) {
    final colors = context.rhythm;
    return RhythmPanel(
      elevated: true,
      backgroundColor: colors.surfaceRaised,
      borderColor: colors.border,
      padding: const EdgeInsets.all(RhythmSpacing.md),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final tomorrowTasks = _tasksForDate(
            c.thisWeekTasks,
            DateTime.now().add(const Duration(days: 1)),
          );
          final thisWeekOnDeckTasks = _onDeckAfterFirstTomorrow(
            weekTasks: c.thisWeekTasks,
            tomorrowTasks: tomorrowTasks,
            currentUserId: currentUserId,
            workspaceMembers: workspaceMembers,
          );

          final todayCard = _buildTaskProgressPanel(
            panelTitle: 'TODAY',
            title: "Today's Tasks",
            subtitle: c.todayTasksRemainingCount == 0
                ? 'Clear for today'
                : '${c.todayTasksRemainingCount} task${c.todayTasksRemainingCount == 1 ? '' : 's'} left today',
            tone: RhythmBadgeTone.accent,
            icon: Icons.today_outlined,
            remainingCount: c.todayTasksRemainingCount,
            totalCount: c.todayTasksTotalCount,
            nextMetricLabel: 'NEXT',
            nextTaskTitle: _nextTaskTitle(c.todayTasks, 'Clear for today'),
            onNextTap: c.todayTasks.isEmpty
                ? null
                : () => _showTaskEditDialog(c.todayTasks.first),
            onDeckTitle: 'On Deck',
            onDeckTasks: _onDeckTaskItems(
              c.todayTasks,
              currentUserId: currentUserId,
              workspaceMembers: workspaceMembers,
            ),
            onTap: widget.openWeeklyPlanner,
          );

          final thisWeekCard = _buildTaskProgressPanel(
            panelTitle: 'THIS WEEK',
            title: "This Week",
            subtitle: c.thisWeekTasksRemainingCount == 0
                ? 'Week is clear'
                : '${c.thisWeekTasksRemainingCount} task${c.thisWeekTasksRemainingCount == 1 ? '' : 's'} left this week',
            tone: RhythmBadgeTone.success,
            icon: Icons.calendar_view_week_outlined,
            remainingCount: c.thisWeekTasksRemainingCount,
            totalCount: c.thisWeekTasksTotalCount,
            nextMetricLabel: 'TOMORROW',
            nextTaskTitle: _nextTaskTitle(tomorrowTasks, 'Clear tomorrow'),
            onNextTap: tomorrowTasks.isEmpty
                ? null
                : () => _showTaskEditDialog(tomorrowTasks.first),
            onDeckTitle: 'On Deck This Week',
            onDeckTasks: thisWeekOnDeckTasks,
            onTap: widget.openWeeklyPlanner,
          );

          final unreadCard = _UnreadOverviewCard(
            items: c.unreadMessages,
            onTapHeader: widget.openMessages,
            onTapItem: (preview) => _openMessageThread(context, preview),
          );

          final projectCards = _buildProjectMetricCards(
            c,
            currentUserId: currentUserId,
            workspaceMembers: workspaceMembers,
          );
          final glanceCards = <Widget>[
            todayCard,
            thisWeekCard,
            ...projectCards,
            unreadCard,
          ];
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
              for (var index = 0; index < glanceCards.length; index++) ...[
                if (index > 0) const SizedBox(height: RhythmSpacing.sm),
                glanceCards[index],
              ],
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
                    onTapHeader: widget.openWeeklyPlanner,
                    onTapTask: (_) => widget.openWeeklyPlanner(),
                    showPastDue: false,
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

  Future<void> _showTaskEditDialog(Task task) async {
    final collaboratorsDataSource = CollaboratorsDataSource();
    await showRhythmTaskInspector(
      context,
      task: task,
      workspaceMembers: context.read<WorkspaceController>().members,
      onSaveDetails: (request) => widget.controller.updateTask(
        task.id,
        title: request.title,
        notes: request.notes,
        dueDate: request.dueDate,
        scheduledDate: request.scheduledDate,
        includeNotes: true,
        includeDueDate: true,
        includeScheduledDate: true,
      ),
      onAddCollaborator: (userId) async {
        final collaborators =
            await collaboratorsDataSource.addToTask(task.id, userId);
        return collaborators;
      },
      onRemoveCollaborator: (userId) async {
        await collaboratorsDataSource.removeFromTask(task.id, userId);
        final collaborators =
            await collaboratorsDataSource.fetchForTask(task.id);
        return collaborators;
      },
    );
  }

  Future<void> _showProjectStepEditDialog(
    DashboardProjectStepPreview step, {
    required String projectTitle,
    required int? ownerId,
    required List<String> collaboratorNames,
  }) async {
    final workspaceMembers = context.read<WorkspaceController>().members;
    await showRhythmProjectStepInspector(
      context,
      step: ProjectInstanceStep(
        id: step.id,
        instanceId: '',
        stepId: step.id,
        title: step.title,
        dueDate: step.dueDate,
        status: step.status,
        notes: step.notes,
        assigneeId: step.assigneeId,
        assigneeName: step.assigneeName,
      ),
      projectTitle: projectTitle,
      projectOwnerLabel: _memberName(ownerId, workspaceMembers),
      projectCollaborators: [
        for (final name in collaboratorNames)
          TaskCollaborator(userId: 0, name: name),
      ],
      workspaceMembers: workspaceMembers,
      onSaveDetails: (request) => widget.controller.updateProjectStep(
        step.id,
        title: request.title,
        dueDate: request.dueDate,
        notes: request.notes,
        assigneeId: request.assigneeId,
        includeNotes: true,
      ),
    );
  }

  List<Task> _tasksForDate(List<Task> tasks, DateTime date) {
    final target = DateTime(date.year, date.month, date.day);
    return tasks.where((task) {
      final taskDate = _taskPriorityDate(task);
      return taskDate != null &&
          taskDate.year == target.year &&
          taskDate.month == target.month &&
          taskDate.day == target.day;
    }).toList();
  }

  String _nextTaskTitle(List<Task> tasks, String fallback) {
    if (tasks.isEmpty) return fallback;
    return tasks.first.title;
  }

  List<FocusOnDeckItem> _onDeckTaskItems(
    List<Task> tasks, {
    required int? currentUserId,
    required List<WorkspaceMember> workspaceMembers,
  }) {
    return tasks
        .skip(1)
        .take(3)
        .map(
          (task) => _onDeckTaskItem(
            task,
            currentUserId: currentUserId,
            workspaceMembers: workspaceMembers,
          ),
        )
        .toList();
  }

  FocusOnDeckItem _onDeckTaskItem(
    Task task, {
    required int? currentUserId,
    required List<WorkspaceMember> workspaceMembers,
  }) {
    return FocusOnDeckItem(
      title: task.title,
      checked: task.status == 'done',
      onChanged: (_) => widget.controller.toggleTaskDone(task.id),
      onTap: () => _showTaskEditDialog(task),
      avatarLabel: _onDeckTaskPersonLabel(
        task,
        currentUserId,
        workspaceMembers,
      ),
    );
  }

  List<FocusOnDeckItem> _onDeckAfterFirstTomorrow({
    required List<Task> weekTasks,
    required List<Task> tomorrowTasks,
    required int? currentUserId,
    required List<WorkspaceMember> workspaceMembers,
  }) {
    final excludedTaskId =
        tomorrowTasks.isEmpty ? null : tomorrowTasks.first.id;
    return weekTasks
        .where((task) => task.id != excludedTaskId)
        .take(3)
        .map(
          (task) => _onDeckTaskItem(
            task,
            currentUserId: currentUserId,
            workspaceMembers: workspaceMembers,
          ),
        )
        .toList();
  }

  String? _onDeckTaskPersonLabel(
    Task task,
    int? currentUserId,
    List<WorkspaceMember> workspaceMembers,
  ) {
    for (final collaborator in task.collaborators) {
      if (collaborator.userId == currentUserId) continue;
      final name = collaborator.name.trim();
      if (name.isNotEmpty) return name;
      return _memberName(
        collaborator.userId,
        workspaceMembers,
        fallbackLabel: 'User',
      );
    }
    if (task.ownerId != null && task.ownerId != currentUserId) {
      return _memberName(task.ownerId, workspaceMembers);
    }
    return null;
  }

  Widget _buildTaskProgressPanel({
    required String panelTitle,
    required String title,
    required String subtitle,
    required RhythmBadgeTone tone,
    required IconData icon,
    required int remainingCount,
    required int totalCount,
    required String nextMetricLabel,
    required String nextTaskTitle,
    required VoidCallback? onNextTap,
    required String onDeckTitle,
    required List<FocusOnDeckItem> onDeckTasks,
    required VoidCallback onTap,
  }) {
    final completed = (totalCount - remainingCount).clamp(0, totalCount);
    final progress = totalCount == 0 ? 1.0 : completed / totalCount;
    return FocusBusinessProjectProgress(
      panelTitle: panelTitle,
      title: title,
      description: onDeckTasks.isEmpty
          ? "You're done! Look at you! You're a real worker!!!"
          : subtitle,
      progress: progress,
      icon: icon,
      metrics: [
        FocusBusinessMetric(
          label: 'COMPLETE',
          value: '$completed/$totalCount',
          tone: tone,
        ),
        FocusBusinessMetric(
          label: 'OPEN',
          value: '$remainingCount',
        ),
        FocusBusinessMetric(
          label: nextMetricLabel,
          value: nextTaskTitle,
          onTap: onNextTap,
        ),
        FocusBusinessMetric(
          label: 'PROGRESS',
          value: '${(progress.clamp(0, 1) * 100).round()}%',
          tone: tone,
        ),
      ],
      pills: [
        FocusBusinessPill(
          label: totalCount == 0
              ? 'No scheduled tasks'
              : '${(progress.clamp(0, 1) * 100).round()}% complete',
          tone: tone,
        ),
        FocusBusinessPill(
          label: '$remainingCount open',
        ),
      ],
      descriptionTitle: onDeckTitle,
      descriptionItems: onDeckTasks,
      showPeople: false,
      onTap: onTap,
    );
  }

  List<FocusBusinessMetric> _progressMetrics(
    DashboardProgressItem item,
    RhythmBadgeTone tone, {
    VoidCallback? onNextTap,
  }) {
    final remaining =
        (item.totalCount - item.completedCount).clamp(0, item.totalCount);
    return [
      FocusBusinessMetric(
        label: 'COMPLETE',
        value: '${item.completedCount}/${item.totalCount}',
        tone: tone,
      ),
      FocusBusinessMetric(
        label: 'OPEN',
        value: '$remaining',
      ),
      FocusBusinessMetric(
        label: 'NEXT',
        value: _nextProgressTitle(item),
        onTap: onNextTap,
      ),
      FocusBusinessMetric(
        label: 'PROGRESS',
        value: '${(item.progress.clamp(0, 1) * 100).round()}%',
        tone: tone,
      ),
    ];
  }

  String _nextProgressTitle(DashboardProgressItem item) {
    if (item is DashboardProjectProgress) {
      return item.nextStepTitle?.trim().isNotEmpty == true
          ? item.nextStepTitle!.trim()
          : 'No open tasks';
    }
    final nextDueDate = item.nextDueDate;
    return nextDueDate == null
        ? 'No date'
        : DateFormatters.fullDate(nextDueDate, fallback: nextDueDate);
  }

  String _projectOwnerName(
    DashboardProjectProgress project,
    List<WorkspaceMember> workspaceMembers,
  ) {
    return _memberName(project.ownerId, workspaceMembers) ?? 'Project owner';
  }

  String? _projectStepAvatarLabel(
    DashboardProjectStepPreview step, {
    required int? currentUserId,
  }) {
    if (step.assigneeId != null && step.assigneeId == currentUserId) {
      return null;
    }
    final name = step.assigneeName?.trim();
    if (name != null && name.isNotEmpty) return name;
    return step.assigneeId == null ? null : 'User #${step.assigneeId}';
  }

  List<Widget> _buildProjectMetricCards(
    DashboardController controller, {
    required int? currentUserId,
    required List<WorkspaceMember> workspaceMembers,
  }) {
    final projects = controller.activeProjects;
    if (projects.isEmpty) return const [];

    final visibleProjects = projects.take(2).toList();

    return [
      for (var index = 0; index < visibleProjects.length; index++)
        FocusBusinessProjectProgress(
          panelTitle: index == 0 ? 'URGENT PROJECT' : 'NEXT PROJECT',
          title: visibleProjects[index].title,
          description: visibleProjects[index].onDeckSteps.isEmpty
              ? 'No other open tasks queued.'
              : visibleProjects[index].subtitle,
          descriptionTitle: 'On Deck',
          descriptionItems: [
            for (final step in visibleProjects[index].onDeckSteps)
              FocusOnDeckItem(
                title: step.title,
                checked: step.isDone,
                onChanged: (_) => controller.toggleProjectStepDone(
                  step.id,
                  step.isDone,
                ),
                onTap: () => _showProjectStepEditDialog(
                  step,
                  projectTitle: visibleProjects[index].title,
                  ownerId: visibleProjects[index].ownerId,
                  collaboratorNames: visibleProjects[index].collaboratorNames,
                ),
                avatarLabel: _projectStepAvatarLabel(
                  step,
                  currentUserId: currentUserId,
                ),
                avatarTone: RhythmBadgeTone.warning,
              ),
          ],
          progress: visibleProjects[index].progress,
          icon: Icons.folder_open_outlined,
          metrics: _progressMetrics(
            visibleProjects[index],
            RhythmBadgeTone.warning,
            onNextTap: visibleProjects[index].nextStep == null
                ? null
                : () => _showProjectStepEditDialog(
                      visibleProjects[index].nextStep!,
                      projectTitle: visibleProjects[index].title,
                      ownerId: visibleProjects[index].ownerId,
                      collaboratorNames:
                          visibleProjects[index].collaboratorNames,
                    ),
          ),
          pills: [
            FocusBusinessPill(
              label: _progressStatusLabel(visibleProjects[index]),
              tone: _progressStatusTone(
                visibleProjects[index],
                RhythmBadgeTone.warning,
              ),
            ),
            FocusBusinessPill(
              label: visibleProjects[index].nextDueDate == null
                  ? 'No due date'
                  : 'Next ${DateFormatters.fullDate(
                      visibleProjects[index].nextDueDate!,
                      fallback: visibleProjects[index].nextDueDate!,
                    )}',
              tone: RhythmBadgeTone.warning,
            ),
          ],
          managers: [
            FocusBusinessAvatar(
              label: _projectOwnerName(
                visibleProjects[index],
                workspaceMembers,
              ),
              tone: RhythmBadgeTone.warning,
            ),
          ],
          team: [
            for (final name in visibleProjects[index].collaboratorNames)
              FocusBusinessAvatar(label: name, tone: RhythmBadgeTone.accent),
          ],
          onTap: widget.openProjects,
        ),
    ];
  }
  // -------------------------------------------------------------------------
  // Add task bar
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
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: colors.textPrimary,
                        letterSpacing: 0,
                      ),
                ),
                const SizedBox(height: RhythmSpacing.xxs),
                Text(
                  subtitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: colors.textSecondary),
                ),
              ],
            ),
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
  });

  final String title;
  final RhythmBadgeTone tone;
  final IconData icon;
  final int remainingCount;
  final int totalCount;
  final String subtitle;
  final String openText;
  final VoidCallback onTap;

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
      child: LayoutBuilder(
        builder: (context, constraints) {
          final primary = totalCount == 0 ? 'No tasks' : '$remainingCount left';
          final percent =
              totalCount == 0 ? '0%' : '${((progress * 100).round())}%';
          final details = Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                primary,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: colors.textPrimary,
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  height: 1.15,
                ),
              ),
              const SizedBox(height: RhythmSpacing.xs),
              Wrap(
                spacing: RhythmSpacing.xs,
                runSpacing: RhythmSpacing.xs,
                children: [
                  RhythmBadge(
                    label:
                        totalCount == 0 ? '0% complete' : '$percent complete',
                    tone: tone,
                    compact: true,
                  ),
                  RhythmBadge(
                    label: '$remainingCount remaining',
                    compact: true,
                  ),
                ],
              ),
              const SizedBox(height: RhythmSpacing.sm),
              LinearProgressIndicator(
                value: progress,
                minHeight: 7,
                borderRadius: BorderRadius.circular(999),
                backgroundColor: colors.surfaceMuted,
                valueColor: AlwaysStoppedAnimation<Color>(accent),
              ),
              const SizedBox(height: RhythmSpacing.sm),
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
          );

          if (constraints.maxWidth < 360) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _ProgressRing(
                    percent: percent, progress: progress, accent: accent),
                const SizedBox(height: RhythmSpacing.md),
                details,
              ],
            );
          }

          return Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              _ProgressRing(
                  percent: percent, progress: progress, accent: accent),
              const SizedBox(width: RhythmSpacing.lg),
              Expanded(child: details),
            ],
          );
        },
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
    final visible = items.take(3).toList();
    final description = visible.isEmpty
        ? 'You are caught up.'
        : '${visible.first.senderName}: ${visible.first.preview}';
    return FocusSmallInfo06(
      header: 'Unread Messages',
      value: '${items.length} unread',
      description: description,
      tone: RhythmBadgeTone.info,
      icon: Icons.mark_chat_unread_outlined,
      onTap: onTapHeader,
      subtle: true,
      actions: [
        RhythmButton.icon(
          onPressed: onTapHeader,
          icon: Icons.arrow_forward,
          tooltip: 'Open messages',
          compact: true,
        ),
      ],
      footer: visible.isEmpty
          ? null
          : Wrap(
              spacing: RhythmSpacing.xs,
              runSpacing: RhythmSpacing.xs,
              children: [
                for (final item in visible)
                  InkWell(
                    onTap: () => onTapItem(item),
                    borderRadius: BorderRadius.circular(RhythmRadius.pill),
                    child: RhythmBadge(
                      label: item.threadTitle,
                      tone: RhythmBadgeTone.info,
                      compact: true,
                    ),
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
    required this.onTapHeader,
    required this.onTapTask,
    required this.countLabel,
    this.showPastDue = false,
  });

  final String title;
  final List<Task> items;
  final String emptyLabel;
  final RhythmBadgeTone tone;
  final VoidCallback onTapHeader;
  final ValueChanged<Task> onTapTask;
  final String countLabel;
  final bool showPastDue;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    final visible = items.take(3).toList();
    return FocusBusinessTaskListPanel(
      header: title.toUpperCase(),
      onTap: onTapHeader,
      headerActions: [
        RhythmBadge(label: countLabel, tone: tone, compact: true),
      ],
      children: visible.isEmpty
          ? [
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(
                  emptyLabel,
                  style: TextStyle(
                    color: colors.textSecondary,
                    fontSize: 13,
                    height: 1.4,
                  ),
                ),
              ),
            ]
          : [
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

    return FocusBusinessTaskListPanel(
      header: 'COLLABORATOR HANDOFFS',
      onTap: onTapHeader,
      headerActions: [
        RhythmBadge(
          label: '${items.length} shared',
          tone: RhythmBadgeTone.warning,
          compact: true,
        ),
      ],
      children: items.isEmpty
          ? [
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(
                  'No shared tasks need attention right now.',
                  style: TextStyle(
                    color: colors.textSecondary,
                    fontSize: 13,
                    height: 1.4,
                  ),
                ),
              ),
            ]
          : [
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
    final feature = items.isEmpty ? null : items.first;
    if (feature == null) {
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
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 18),
          child: Text(
            emptyLabel,
            style: TextStyle(
              color: colors.textSecondary,
              fontSize: 13,
              height: 1.4,
            ),
          ),
        ),
      );
    }

    final visibleItems = items.take(2).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var index = 0; index < visibleItems.length; index++) ...[
          FocusBusinessProjectProgress(
            panelTitle: index == 0 ? title.toUpperCase() : 'MORE $title',
            title: visibleItems[index].title,
            description: visibleItems[index].subtitle,
            progress: visibleItems[index].progress,
            icon: icon,
            pills: [
              FocusBusinessPill(
                label: countLabel,
                tone: tone,
              ),
              FocusBusinessPill(
                label: _progressStatusLabel(visibleItems[index]),
                tone: _progressStatusTone(visibleItems[index], tone),
              ),
            ],
            metrics: _progressMetrics(visibleItems[index], tone),
            managers: [
              FocusBusinessAvatar(
                label: title == 'Active Rhythms'
                    ? 'Rhythm owner'
                    : 'Project owner',
                tone: tone,
              ),
            ],
            team: [
              const FocusBusinessAvatar(
                  label: 'Workspace', tone: RhythmBadgeTone.accent),
              FocusBusinessAvatar(label: countLabel, tone: tone),
            ],
            onTap: () => onTapItem(visibleItems[index]),
          ),
          if (index < visibleItems.length - 1)
            const SizedBox(height: RhythmSpacing.sm),
        ],
        if (items.length > visibleItems.length)
          Padding(
            padding: const EdgeInsets.only(top: RhythmSpacing.sm),
            child: Text(
              '+${items.length - visibleItems.length} more',
              style: TextStyle(
                color: colors.textSecondary,
                fontSize: 12,
              ),
            ),
          ),
      ],
    );
  }

  List<FocusBusinessMetric> _progressMetrics(
    DashboardProgressItem item,
    RhythmBadgeTone tone,
  ) {
    final remaining =
        (item.totalCount - item.completedCount).clamp(0, item.totalCount);
    final nextDueDate = item.nextDueDate;
    return [
      FocusBusinessMetric(
        label: 'COMPLETE',
        value: '${item.completedCount}/${item.totalCount}',
        tone: tone,
      ),
      FocusBusinessMetric(
        label: 'OPEN',
        value: '$remaining',
      ),
      FocusBusinessMetric(
        label: 'NEXT',
        value: nextDueDate == null
            ? 'No date'
            : DateFormatters.fullDate(nextDueDate, fallback: nextDueDate),
      ),
      FocusBusinessMetric(
        label: 'PROGRESS',
        value: '${(item.progress.clamp(0, 1) * 100).round()}%',
        tone: tone,
      ),
    ];
  }
}

class _ProgressFeaturePanel extends StatelessWidget {
  const _ProgressFeaturePanel({
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
    final progress = item.progress.clamp(0.0, 1.0);
    final percent = '${(progress * 100).round()}%';
    final nextDueDate = item.nextDueDate;
    final dueLabel = nextDueDate == null
        ? null
        : DateFormatters.fullDate(
            nextDueDate,
            fallback: nextDueDate,
          );

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(RhythmRadius.lg),
      child: Container(
        padding: const EdgeInsets.all(RhythmSpacing.md),
        decoration: BoxDecoration(
          color: colors.surfaceMuted.withValues(alpha: 0.62),
          borderRadius: BorderRadius.circular(RhythmRadius.lg),
          border: Border.all(color: accent.withValues(alpha: 0.22)),
        ),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final stacked = constraints.maxWidth < 420;
            final ring = _ProgressRing(
              percent: percent,
              progress: progress,
              accent: accent,
            );
            final details = _ProgressFeatureDetails(
              item: item,
              tone: tone,
              accent: accent,
              dueLabel: dueLabel,
            );
            if (stacked) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ring,
                  const SizedBox(height: RhythmSpacing.md),
                  details,
                ],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                ring,
                const SizedBox(width: RhythmSpacing.lg),
                Expanded(child: details),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _ProgressRing extends StatelessWidget {
  const _ProgressRing({
    required this.percent,
    required this.progress,
    required this.accent,
  });

  final String percent;
  final double progress;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return SizedBox(
      width: 96,
      height: 96,
      child: Stack(
        alignment: Alignment.center,
        children: [
          SizedBox(
            width: 86,
            height: 86,
            child: CircularProgressIndicator(
              value: progress,
              strokeWidth: 7,
              backgroundColor: colors.surface,
              valueColor: AlwaysStoppedAnimation<Color>(accent),
            ),
          ),
          Text(
            percent,
            style: TextStyle(
              color: colors.textPrimary,
              fontSize: 18,
              fontWeight: FontWeight.w800,
              height: 1,
            ),
          ),
        ],
      ),
    );
  }
}

class _ProgressFeatureDetails extends StatelessWidget {
  const _ProgressFeatureDetails({
    required this.item,
    required this.tone,
    required this.accent,
    required this.dueLabel,
  });

  final DashboardProgressItem item;
  final RhythmBadgeTone tone;
  final Color accent;
  final String? dueLabel;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.grid_view_rounded, color: accent, size: 18),
            const SizedBox(width: RhythmSpacing.xs),
            Expanded(
              child: Text(
                item.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: colors.textPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0,
                  height: 1.15,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: RhythmSpacing.sm),
        Wrap(
          spacing: RhythmSpacing.xs,
          runSpacing: RhythmSpacing.xs,
          children: [
            RhythmBadge(
              label: '${item.completedCount}/${item.totalCount} complete',
              tone: tone,
              compact: true,
            ),
            if (dueLabel != null)
              RhythmBadge(
                label: 'Next $dueLabel',
                icon: Icons.event_outlined,
                compact: true,
              ),
          ],
        ),
        const SizedBox(height: RhythmSpacing.md),
        Text(
          item.subtitle,
          maxLines: 3,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: colors.textSecondary,
            fontSize: 12.5,
            height: 1.45,
          ),
        ),
      ],
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

String _progressStatusLabel(DashboardProgressItem item) {
  if (item.totalCount == 0) return 'No tasks';
  if (item.completedCount >= item.totalCount) return 'Complete';
  if (item.progress >= 0.75) return 'On track';
  if (item.progress >= 0.35) return 'In progress';
  return 'Needs attention';
}

RhythmBadgeTone _progressStatusTone(
  DashboardProgressItem item,
  RhythmBadgeTone fallback,
) {
  if (item.totalCount == 0) return RhythmBadgeTone.neutral;
  if (item.completedCount >= item.totalCount) return RhythmBadgeTone.success;
  if (item.progress >= 0.75) return RhythmBadgeTone.success;
  if (item.progress >= 0.35) return fallback;
  return RhythmBadgeTone.warning;
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
    final description = task.notes?.trim().isNotEmpty == true
        ? task.notes!.trim()
        : [
            if (task.scheduledDate != null)
              'Scheduled ${DateFormatters.fullDate(task.scheduledDate, fallback: task.scheduledDate!)}',
            if (task.dueDate != null)
              'Due ${DateFormatters.fullDate(task.dueDate, fallback: task.dueDate!)}',
            if (task.sourceName?.trim().isNotEmpty == true)
              'From ${task.sourceName!.trim()}',
            if (task.scheduledDate == null &&
                task.dueDate == null &&
                task.sourceName?.trim().isNotEmpty != true)
              'Open the planner for details and next steps.',
          ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: FocusBusinessTaskListItem(
        title: task.title,
        description: description,
        checked: task.status == 'done',
        onChanged: (_) => onTap(),
        onTap: onTap,
        backgroundColor: colors.surfaceMuted.withValues(alpha: 0.62),
        borderColor: accent.withValues(alpha: 0.18),
        accentColor: accent,
        pills: [
          if (showPastDue && _isPastDue(task))
            const FocusBusinessPill(
              label: 'Past due',
              tone: RhythmBadgeTone.danger,
            ),
          if (task.dueDate != null)
            FocusBusinessPill(
              label:
                  'Due ${DateFormatters.fullDate(task.dueDate, fallback: task.dueDate!)}',
              tone: RhythmBadgeTone.neutral,
            ),
          if (task.scheduledDate != null)
            FocusBusinessPill(
              label:
                  'Scheduled ${DateFormatters.fullDate(task.scheduledDate, fallback: task.scheduledDate!)}',
              tone: RhythmBadgeTone.neutral,
            ),
          if (task.sourceName?.trim().isNotEmpty == true)
            FocusBusinessPill(label: task.sourceName!.trim(), tone: tone)
          else if (task.sourceType != null)
            FocusBusinessPill(label: _taskSourceLabel(task), tone: tone),
        ],
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
