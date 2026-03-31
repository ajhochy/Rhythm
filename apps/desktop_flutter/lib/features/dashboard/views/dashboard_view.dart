// ignore_for_file: use_build_context_synchronously

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../controllers/dashboard_controller.dart';
import '../../tasks/models/task.dart';

// ---------------------------------------------------------------------------
// Theme constants (Rhythm 2.0)
// ---------------------------------------------------------------------------

const _kTextPrimary = Color(0xFF111827);
const _kTextSecondary = Color(0xFF6B7280);
const _kCardBorder = Color(0xFFE5E7EB);
const _kPrimary = Color(0xFF4F6AF5);

class DashboardView extends StatefulWidget {
  const DashboardView({super.key});

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
    return Consumer<DashboardController>(
      builder: (context, controller, _) {
        return switch (controller.status) {
          DashboardStatus.loading => const Center(
              child: CircularProgressIndicator(color: _kPrimary),
            ),
          DashboardStatus.error => _ErrorView(
              message: controller.errorMessage ?? 'Unknown error',
              onRetry: controller.refresh,
            ),
          DashboardStatus.ready => _DashboardBody(controller: controller),
        };
      },
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
  const _DashboardBody({required this.controller});

  final DashboardController controller;

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
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildSummaryGrid(c),
                const SizedBox(height: 28),
                _buildRecentTasksSection(context, c),
              ],
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
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
      child: Row(
        children: [
          Text('Dashboard',
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    color: _kTextPrimary,
                    fontWeight: FontWeight.w600,
                  )),
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

  // -------------------------------------------------------------------------
  // Summary card grid (2 columns)
  // -------------------------------------------------------------------------

  Widget _buildSummaryGrid(DashboardController c) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = 12.0;
        final cardWidth = (constraints.maxWidth - gap) / 2;
        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [
            SizedBox(
              width: cardWidth,
              child: _SummaryCard(
                icon: Icons.check_circle_outline,
                label: 'Open Tasks',
                value: '${c.openTaskCount}',
                subLabel: '${c.dueThisWeekCount} due this week',
                iconColor: _kPrimary,
              ),
            ),
            SizedBox(
              width: cardWidth,
              child: _SummaryCard(
                icon: Icons.loop,
                label: 'Active Rhythms',
                value: '${c.activeRhythmsCount}',
                subLabel: 'recurring rules enabled',
                iconColor: const Color(0xFF10B981),
              ),
            ),
            SizedBox(
              width: cardWidth,
              child: _SummaryCard(
                icon: Icons.folder_outlined,
                label: 'Active Projects',
                value: '${c.activeProjectsCount}',
                subLabel: 'project instances',
                iconColor: const Color(0xFFF59E0B),
              ),
            ),
            SizedBox(
              width: cardWidth,
              child: _SummaryCard(
                icon: Icons.chat_bubble_outline,
                label: 'Messages',
                value: '${c.messageThreadCount}',
                subLabel: 'message threads',
                iconColor: const Color(0xFF8B5CF6),
              ),
            ),
          ],
        );
      },
    );
  }

  // -------------------------------------------------------------------------
  // Recent tasks
  // -------------------------------------------------------------------------

  Widget _buildRecentTasksSection(BuildContext context, DashboardController c) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Recent Tasks',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: _kTextSecondary,
            letterSpacing: 0.4,
          ),
        ),
        const SizedBox(height: 8),
        if (c.recentTasks.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 20),
            child: Text(
              'No tasks yet. Add one below.',
              style: TextStyle(color: _kTextSecondary, fontSize: 14),
            ),
          )
        else
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: _kCardBorder),
            ),
            child: Column(
              children: c.recentTasks
                  .asMap()
                  .entries
                  .map((entry) => _buildRecentTaskRow(
                      context, entry.value, c, entry.key, c.recentTasks.length))
                  .toList(),
            ),
          ),
      ],
    );
  }

  Widget _buildRecentTaskRow(BuildContext context, Task task,
      DashboardController c, int index, int total) {
    final isDone = task.status == 'done';
    final isLast = index == total - 1;
    return Container(
      decoration: BoxDecoration(
        border: isLast
            ? null
            : const Border(bottom: BorderSide(color: _kCardBorder)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          children: [
            SizedBox(
              width: 20,
              height: 20,
              child: Checkbox(
                value: isDone,
                onChanged: (_) => c.toggleTaskDone(task.id),
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                visualDensity: VisualDensity.compact,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    task.title,
                    style: TextStyle(
                      fontSize: 14,
                      color: isDone ? _kTextSecondary : _kTextPrimary,
                      decoration: isDone ? TextDecoration.lineThrough : null,
                      decorationColor: _kTextSecondary,
                    ),
                  ),
                  if (task.sourceName != null || task.dueDate != null) ...[
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        if (task.sourceName != null)
                          Text(
                            task.sourceName!,
                            style: const TextStyle(
                                fontSize: 12, color: _kTextSecondary),
                          ),
                        if (task.sourceName != null && task.dueDate != null)
                          const Text(' · ',
                              style: TextStyle(
                                  fontSize: 12, color: _kTextSecondary)),
                        if (task.dueDate != null)
                          Text(
                            'Due ${task.dueDate}',
                            style: const TextStyle(
                                fontSize: 12, color: _kTextSecondary),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Add task bar
  // -------------------------------------------------------------------------

  Widget _buildAddTaskBar(BuildContext context, DashboardController c) {
    return Container(
      padding: const EdgeInsets.fromLTRB(24, 12, 24, 20),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerLow,
        border: const Border(top: BorderSide(color: _kCardBorder)),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _addTaskController,
              decoration: const InputDecoration(
                hintText: 'Add a task...',
                isDense: true,
                border: OutlineInputBorder(),
              ),
              onSubmitted: (_) => _submitTask(),
            ),
          ),
          const SizedBox(width: 8),
          OutlinedButton.icon(
            onPressed: _pickDate,
            icon: const Icon(Icons.calendar_today, size: 16),
            label: Text(_selectedDueDate ?? 'Due date'),
          ),
          const SizedBox(width: 8),
          FilledButton(
            onPressed: _submitTask,
            child: const Text('Add Task'),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Summary card widget
// ---------------------------------------------------------------------------

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.subLabel,
    required this.iconColor,
  });

  final IconData icon;
  final String label;
  final String value;
  final String subLabel;
  final Color iconColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: _kCardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: iconColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Icon(icon, size: 18, color: iconColor),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: _kTextSecondary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            value,
            style: const TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.w700,
              color: _kTextPrimary,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            subLabel,
            style: const TextStyle(fontSize: 12, color: _kTextSecondary),
          ),
        ],
      ),
    );
  }
}
