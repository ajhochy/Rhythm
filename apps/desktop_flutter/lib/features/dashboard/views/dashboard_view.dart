// ignore_for_file: use_build_context_synchronously, unused_element

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../app/core/formatters/date_formatters.dart';
import '../../messages/controllers/messages_controller.dart';
import '../controllers/dashboard_controller.dart';
import '../../tasks/models/task.dart';
import '../models/dashboard_overview_models.dart';

// ---------------------------------------------------------------------------
// Theme constants (Rhythm 2.0)
// ---------------------------------------------------------------------------

const _kTextPrimary = Color(0xFF111827);
const _kTextSecondary = Color(0xFF6B7280);
const _kCardBorder = Color(0xFFE8E2D9);
const _kPrimary = Color(0xFF5666F7);
const _kCanvas = Color(0xFFF6F3ED);
const _kSurface = Color(0xFFFEFCF8);
const _kSurfaceSoft = Color(0xFFF8F5EF);
const _kShadow = Color(0x1A111827);
const _kTaskAccent = Color(0xFF5A6CF9);
const _kRhythmAccent = Color(0xFF1FA97A);
const _kProjectAccent = Color(0xFFE29A3A);
const _kMessageAccent = Color(0xFF8D68F3);
const _kDanger = Color(0xFFEF4444);

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
    });
  }

  @override
  void dispose() {
    _addTaskController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        const _DashboardBackdrop(),
        Consumer<DashboardController>(
          builder: (context, controller, _) {
            return switch (controller.status) {
              DashboardStatus.loading => const Center(
                  child: CircularProgressIndicator(color: _kPrimary),
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
      ],
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
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.error_outline, size: 40, color: Color(0xFFEF4444)),
          const SizedBox(height: 12),
          Text(message,
              style: const TextStyle(color: _kTextSecondary, fontSize: 14)),
          const SizedBox(height: 16),
          FilledButton(onPressed: onRetry, child: const Text('Retry')),
        ],
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
          () => _selectedDueDate = picked.toIso8601String().substring(0, 10));
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildHeader(context, c),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1280),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildHero(context, c),
                    const SizedBox(height: 28),
                    const _SectionLabel(
                      title: 'Planning',
                      subtitle: 'What needs attention this week and today',
                    ),
                    const SizedBox(height: 12),
                    _buildOverviewGrid(context, c),
                  ],
                ),
              ),
            ),
          ),
        ),
        _buildAddTaskBar(context, c),
      ],
    );
  }

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------

  Widget _buildHeader(BuildContext context, DashboardController c) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 20, 24, 12),
      child: Row(
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Dashboard',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      color: _kTextPrimary,
                      fontWeight: FontWeight.w600,
                      letterSpacing: -0.4,
                    ),
              ),
              const SizedBox(height: 4),
              const Text(
                'A calm view of the week ahead.',
                style: TextStyle(color: _kTextSecondary, fontSize: 13),
              ),
            ],
          ),
          const Spacer(),
          IconButton(
            icon: const Icon(Icons.refresh, size: 20, color: _kTextSecondary),
            tooltip: 'Refresh',
            onPressed: c.refresh,
          ),
        ],
      ),
    );
  }

  Widget _buildHero(BuildContext context, DashboardController c) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFFFFFFF), Color(0xFFF7F2EA)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: const Color(0xFFE8E0D7)),
        boxShadow: const [
          BoxShadow(
            color: _kShadow,
            blurRadius: 30,
            offset: Offset(0, 18),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final width = constraints.maxWidth;
            final useSingleColumn = width < 900;

            final todayCard = _ProgressDialCard(
              title: "Today's Tasks",
              accent: _kTaskAccent,
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
              accent: _kRhythmAccent,
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
              accent: _kMessageAccent,
              onTapHeader: widget.openMessages,
              onTapItem: (preview) => _openMessageThread(context, preview),
            );

            final projectCards = _buildProjectMetricCards(c);

            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const _HeroEyebrow(text: 'At a glance'),
                const SizedBox(height: 10),
                Text(
                  'Move the week forward.',
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        color: _kTextPrimary,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.6,
                      ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Today, this week, your next project, and unread messages in one compact view.',
                  style: TextStyle(
                    color: _kTextSecondary,
                    fontSize: 13,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 14),
                if (useSingleColumn)
                  Column(
                    children: [
                      todayCard,
                      const SizedBox(height: 12),
                      thisWeekCard,
                      for (final card in projectCards) ...[
                        const SizedBox(height: 12),
                        card,
                      ],
                      const SizedBox(height: 12),
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
                          const SizedBox(width: 12),
                          Expanded(child: thisWeekCard),
                        ],
                      ),
                      if (projectCards.isEmpty) ...[
                        const SizedBox(height: 12),
                        unreadCard,
                      ] else if (projectCards.length == 1) ...[
                        const SizedBox(height: 12),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(child: projectCards.first),
                            const SizedBox(width: 12),
                            Expanded(child: unreadCard),
                          ],
                        ),
                      ] else ...[
                        const SizedBox(height: 12),
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(child: projectCards[0]),
                            const SizedBox(width: 12),
                            Expanded(child: projectCards[1]),
                          ],
                        ),
                        const SizedBox(height: 12),
                        unreadCard,
                      ],
                    ],
                  ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildOverviewGrid(BuildContext context, DashboardController c) {
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
                  accent: _kDanger,
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
                  child: _TaskListCard(
                    title: "Today's Tasks",
                    countLabel: '${c.todayTasksRemainingCount} left',
                    items: c.todayTasks,
                    emptyLabel: 'No tasks scheduled for today.',
                    accent: _kTaskAccent,
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
                    accent: _kRhythmAccent,
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
                    accent: _kTextSecondary,
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
                    accent: _kRhythmAccent,
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
                    accent: _kProjectAccent,
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
          accent: _kProjectAccent,
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
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 0, 24, 20),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: _kSurface,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: _kCardBorder),
          boxShadow: const [
            BoxShadow(
              color: _kShadow,
              blurRadius: 28,
              offset: Offset(0, 14),
            ),
          ],
        ),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: _addTaskController,
                decoration: const InputDecoration(
                  hintText: 'Add a task...',
                  isDense: true,
                  filled: true,
                  fillColor: _kSurfaceSoft,
                  border: OutlineInputBorder(),
                ),
                onSubmitted: (_) => _submitTask(),
              ),
            ),
            const SizedBox(width: 10),
            OutlinedButton.icon(
              onPressed: _pickDate,
              icon: const Icon(Icons.calendar_today, size: 16),
              label: Text(_selectedDueDate == null
                  ? 'Due date'
                  : DateFormatters.fullDate(_selectedDueDate)),
            ),
            const SizedBox(width: 10),
            FilledButton(
              onPressed: _submitTask,
              child: const Text('Add Task'),
            ),
          ],
        ),
      ),
    );
  }
}

class _DashboardBackdrop extends StatelessWidget {
  const _DashboardBackdrop();

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              _kCanvas,
              _kCanvas.withValues(alpha: 0.92),
              const Color(0xFFF2EEE7),
            ],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          ),
        ),
        child: const Stack(
          children: [
            Positioned(
              top: -140,
              right: -80,
              child: _BackdropGlow(
                size: 320,
                colors: [Color(0x22A78BFA), Color(0x00A78BFA)],
              ),
            ),
            Positioned(
              top: 160,
              left: -120,
              child: _BackdropGlow(
                size: 260,
                colors: [Color(0x18F59E0B), Color(0x00F59E0B)],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BackdropGlow extends StatelessWidget {
  const _BackdropGlow({required this.size, required this.colors});

  final double size;
  final List<Color> colors;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(colors: colors),
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
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Row(
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: _kTextPrimary,
                  letterSpacing: 0.2,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: const TextStyle(fontSize: 12, color: _kTextSecondary),
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
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFFF1ECFF),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFFE3DAFF)),
      ),
      child: Text(
        text.toUpperCase(),
        style: const TextStyle(
          fontSize: 11,
          letterSpacing: 1.1,
          color: Color(0xFF6B5BD2),
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _HeroAction extends StatelessWidget {
  const _HeroAction({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return FilledButton.tonalIcon(
      onPressed: onTap,
      icon: Icon(icon, size: 16),
      label: Text(label),
      style: FilledButton.styleFrom(
        backgroundColor: const Color(0xFFF7F3EE),
        foregroundColor: _kTextPrimary,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
        ),
      ),
    );
  }
}

class _MiniStatChip extends StatelessWidget {
  const _MiniStatChip({
    required this.label,
    required this.value,
    required this.accent,
  });

  final String label;
  final String value;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 148,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: _kSurface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: _kCardBorder),
      ),
      child: Row(
        children: [
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(
              color: accent,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(fontSize: 11, color: _kTextSecondary),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 22,
                    height: 1.0,
                    fontWeight: FontWeight.w700,
                    color: _kTextPrimary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ProgressDialCard extends StatelessWidget {
  const _ProgressDialCard({
    required this.title,
    required this.accent,
    required this.remainingCount,
    required this.totalCount,
    required this.subtitle,
    required this.openText,
    required this.onTap,
    this.primaryLabel,
  });

  final String title;
  final Color accent;
  final int remainingCount;
  final int totalCount;
  final String subtitle;
  final String openText;
  final VoidCallback onTap;
  final String? primaryLabel;

  @override
  Widget build(BuildContext context) {
    final progress = totalCount == 0
        ? 0.0
        : ((totalCount - remainingCount).clamp(0, totalCount) / totalCount);
    return _DashboardPreviewShell(
      title: title,
      accent: accent,
      onTap: onTap,
      trailing: TextButton(
        onPressed: onTap,
        child: Text(openText),
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
                          (totalCount == 0 ? 'No tasks' : '$remainingCount left'),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: _kTextPrimary,
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
                      backgroundColor: _kSurfaceSoft,
                      valueColor: AlwaysStoppedAnimation<Color>(accent),
                    ),
                    Text(
                      totalCount == 0 ? '0%' : '${((progress * 100).round())}%',
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: _kTextPrimary,
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
            backgroundColor: _kSurfaceSoft,
            valueColor: AlwaysStoppedAnimation<Color>(accent),
          ),
          const SizedBox(height: 8),
          Text(
            subtitle,
            style: const TextStyle(
              fontSize: 12,
              color: _kTextSecondary,
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
    required this.accent,
    required this.onTapHeader,
    required this.onTapItem,
  });

  final List<DashboardUnreadMessagePreview> items;
  final Color accent;
  final VoidCallback onTapHeader;
  final ValueChanged<DashboardUnreadMessagePreview> onTapItem;

  @override
  Widget build(BuildContext context) {
    final visible = items.take(3).toList();
    return _DashboardPreviewShell(
      title: 'Unread Messages',
      accent: accent,
      onTap: onTapHeader,
      trailing: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: accent.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          '${items.length} unread',
          style: TextStyle(
            color: accent,
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      child: visible.isEmpty
          ? const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'You are caught up.',
                style: TextStyle(
                  color: _kTextSecondary,
                  fontSize: 13,
                ),
              ),
            )
          : Column(
              children: [
                for (final item in visible)
                  _UnreadMessagePreviewRow(
                    preview: item,
                    accent: accent,
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
    required this.accent,
    required this.onTapHeader,
    required this.onTapTask,
    required this.countLabel,
    this.showPastDue = false,
  });

  final String title;
  final List<Task> items;
  final String emptyLabel;
  final Color accent;
  final VoidCallback onTapHeader;
  final ValueChanged<Task> onTapTask;
  final String countLabel;
  final bool showPastDue;

  @override
  Widget build(BuildContext context) {
    final visible = items.take(3).toList();
    return _DashboardPreviewShell(
      title: title,
      accent: accent,
      onTap: onTapHeader,
      trailing: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: accent.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          countLabel,
          style: TextStyle(
            color: accent,
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      child: visible.isEmpty
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(emptyLabel,
                  style: const TextStyle(
                      color: _kTextSecondary, fontSize: 13, height: 1.4)),
            )
          : Column(
              children: [
                for (final task in visible)
                  _TaskPreviewRow(
                    task: task,
                    accent: accent,
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
                        style: const TextStyle(
                            color: _kTextSecondary, fontSize: 12),
                      ),
                    ),
                  ),
              ],
            ),
    );
  }
}

class _ProgressPreviewCard<T extends DashboardProgressItem>
    extends StatelessWidget {
  const _ProgressPreviewCard({
    required this.title,
    required this.items,
    required this.emptyLabel,
    required this.accent,
    required this.onTapHeader,
    required this.onTapItem,
    required this.countLabel,
  });

  final String title;
  final List<T> items;
  final String emptyLabel;
  final Color accent;
  final VoidCallback onTapHeader;
  final ValueChanged<T> onTapItem;
  final String countLabel;

  @override
  Widget build(BuildContext context) {
    final visible = items.take(3).toList();
    return _DashboardPreviewShell(
      title: title,
      accent: accent,
      onTap: onTapHeader,
      trailing: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: accent.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          countLabel,
          style: TextStyle(
            color: accent,
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      child: visible.isEmpty
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: 18),
              child: Text(emptyLabel,
                  style: const TextStyle(
                      color: _kTextSecondary, fontSize: 13, height: 1.4)),
            )
          : Column(
              children: [
                for (final item in visible)
                  _ProgressPreviewRow(
                    item: item,
                    accent: accent,
                    onTap: () => onTapItem(item),
                  ),
                if (items.length > visible.length)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        '+${items.length - visible.length} more',
                        style: const TextStyle(
                            color: _kTextSecondary, fontSize: 12),
                      ),
                    ),
                  ),
              ],
            ),
    );
  }
}

class _MessagePreviewCard extends StatelessWidget {
  const _MessagePreviewCard({
    required this.title,
    required this.items,
    required this.emptyLabel,
    required this.accent,
    required this.onTapHeader,
    required this.onTapItem,
  });

  final String title;
  final List<DashboardUnreadMessagePreview> items;
  final String emptyLabel;
  final Color accent;
  final VoidCallback onTapHeader;
  final ValueChanged<DashboardUnreadMessagePreview> onTapItem;

  @override
  Widget build(BuildContext context) {
    final visible = items.take(3).toList();
    return _DashboardPreviewShell(
      title: title,
      accent: accent,
      onTap: onTapHeader,
      trailing: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: accent.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          '${items.length} unread',
          style: TextStyle(
            color: accent,
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      child: visible.isEmpty
          ? Padding(
              padding: const EdgeInsets.symmetric(vertical: 18),
              child: Text(emptyLabel,
                  style: const TextStyle(
                      color: _kTextSecondary, fontSize: 13, height: 1.4)),
            )
          : Column(
              children: [
                for (final item in visible)
                  _UnreadMessagePreviewRow(
                    preview: item,
                    accent: accent,
                    onTap: () => onTapItem(item),
                  ),
                if (items.length > visible.length)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        '+${items.length - visible.length} more',
                        style: const TextStyle(
                            color: _kTextSecondary, fontSize: 12),
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
  if (scheduled != null) return DateTime(scheduled.year, scheduled.month, scheduled.day);
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

Color _taskSourceColor(Task task) => switch (task.sourceType) {
      'recurring_rule' => _kRhythmAccent,
      'project_step' => _kProjectAccent,
      'calendar_shadow_event' => _kMessageAccent,
      'planning_center_signal' => const Color(0xFFD97706),
      'automation_rule' => const Color(0xFF8B5CF6),
      _ => _kTextSecondary,
    };

class _DashboardPreviewShell extends StatelessWidget {
  const _DashboardPreviewShell({
    required this.title,
    required this.child,
    required this.trailing,
    required this.onTap,
    required this.accent,
  });

  final String title;
  final Widget child;
  final Widget trailing;
  final VoidCallback onTap;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(24),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(24),
        child: Container(
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            color: _kSurface,
            border: Border.all(color: _kCardBorder),
            boxShadow: const [
              BoxShadow(
                color: _kShadow,
                blurRadius: 28,
                offset: Offset(0, 14),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                height: 4,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      accent.withValues(alpha: 0.85),
                      accent.withValues(alpha: 0.15),
                    ],
                    begin: Alignment.centerLeft,
                    end: Alignment.centerRight,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 16, 18, 0),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        title,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: _kTextPrimary,
                          letterSpacing: -0.1,
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
    required this.accent,
    this.showPastDue = false,
  });

  final Task task;
  final VoidCallback onTap;
  final Color accent;
  final bool showPastDue;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 4,
              height: 22,
              margin: const EdgeInsets.only(top: 1),
              decoration: BoxDecoration(
                color: task.status == 'done'
                    ? _kCardBorder
                    : showPastDue && _isPastDue(task)
                        ? _kDanger
                        : accent.withValues(alpha: 0.9),
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
                        color: _taskSourceColor(task),
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 3),
                  ],
                  Text(
                    task.title,
                    style: const TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: _kTextPrimary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      if (showPastDue && _isPastDue(task))
                        const _TaskBadge(
                          label: 'Past due',
                          backgroundColor: Color(0x1ADC5B58),
                          foregroundColor: _kDanger,
                        ),
                      if (task.dueDate != null)
                        _TaskBadge(
                          label: 'Due ${DateFormatters.fullDate(task.dueDate, fallback: task.dueDate!)}',
                          backgroundColor: _kSurfaceSoft,
                          foregroundColor: _kTextSecondary,
                        ),
                      if (task.scheduledDate != null)
                        _TaskBadge(
                          label:
                              'Scheduled ${DateFormatters.fullDate(task.scheduledDate, fallback: task.scheduledDate!)}',
                          backgroundColor: _kSurfaceSoft,
                          foregroundColor: _kTextSecondary,
                        ),
                      if (task.sourceType != null)
                        _TaskBadge(
                          label: _taskSourceLabel(task),
                          backgroundColor:
                              _taskSourceColor(task).withValues(alpha: 0.12),
                          foregroundColor: _taskSourceColor(task),
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

class _TaskBadge extends StatelessWidget {
  const _TaskBadge({
    required this.label,
    required this.backgroundColor,
    required this.foregroundColor,
  });

  final String label;
  final Color backgroundColor;
  final Color foregroundColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
          color: foregroundColor,
        ),
      ),
    );
  }
}

class _ProgressPreviewRow extends StatelessWidget {
  const _ProgressPreviewRow({
    required this.item,
    required this.onTap,
    required this.accent,
  });

  final DashboardProgressItem item;
  final VoidCallback onTap;
  final Color accent;

  @override
  Widget build(BuildContext context) {
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
                    style: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                      color: _kTextPrimary,
                    ),
                  ),
                ),
                Text(
                  '$completedCount/$totalCount',
                  style: const TextStyle(fontSize: 12, color: _kTextSecondary),
                ),
              ],
            ),
            const SizedBox(height: 4),
            LinearProgressIndicator(
              value: progress,
              minHeight: 7,
              backgroundColor: _kSurfaceSoft,
              valueColor: AlwaysStoppedAnimation<Color>(accent),
              borderRadius: BorderRadius.circular(999),
            ),
            const SizedBox(height: 4),
            Text(
              subtitle,
              style: const TextStyle(
                fontSize: 12,
                color: _kTextSecondary,
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
    required this.accent,
  });

  final DashboardUnreadMessagePreview preview;
  final VoidCallback onTap;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 4,
              height: 30,
              margin: const EdgeInsets.only(top: 1),
              decoration: BoxDecoration(
                color: accent,
                shape: BoxShape.circle,
              ),
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
                          style: const TextStyle(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w700,
                            color: _kTextPrimary,
                          ),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF1ECFF),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          '${preview.unreadCount}',
                          style: const TextStyle(
                            fontSize: 11,
                            color: Color(0xFF6B5BD2),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    preview.preview,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style:
                        const TextStyle(fontSize: 12, color: _kTextSecondary),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    preview.threadTitle,
                    style: const TextStyle(
                      fontSize: 11,
                      color: _kTextSecondary,
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
