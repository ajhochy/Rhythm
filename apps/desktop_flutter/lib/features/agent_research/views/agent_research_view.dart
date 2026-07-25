import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agent_research_controller.dart';
import '../models/agent_research_job.dart';

class AgentResearchView extends StatefulWidget {
  const AgentResearchView({super.key});

  @override
  State<AgentResearchView> createState() => _AgentResearchViewState();
}

class _AgentResearchViewState extends State<AgentResearchView> {
  AgentResearchController? _controller;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final controller = context.read<AgentResearchController>();
      controller.refresh();
      controller.startPolling();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _controller = context.read<AgentResearchController>();
  }

  @override
  void dispose() {
    _controller?.stopPolling();
    super.dispose();
  }

  void _showNewResearchDialog(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (ctx) => _NewResearchDialog(
        onSubmit: (query, depth) async {
          Navigator.of(ctx).pop();
          await context.read<AgentResearchController>().create({
            'query': query,
            'depth': depth,
          });
        },
      ),
    );
  }

  void _showReportBottomSheet(BuildContext context, AgentResearchJob job) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _ReportBottomSheet(job: job),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AgentResearchController>(
      builder: (context, controller, _) {
        return Scaffold(
          backgroundColor: context.rhythm.canvas,
          appBar: AppBar(
            backgroundColor: context.rhythm.surface,
            title: Text(
              'Deep Research',
              style: TextStyle(color: context.rhythm.textPrimary),
            ),
          ),
          floatingActionButton: FloatingActionButton.extended(
            onPressed: () => _showNewResearchDialog(context),
            backgroundColor: context.rhythm.accent,
            icon: const Icon(Icons.add, color: Colors.white),
            label: const Text(
              'New Research',
              style: TextStyle(color: Colors.white),
            ),
          ),
          body: _buildBody(context, controller),
        );
      },
    );
  }

  Widget _buildBody(BuildContext context, AgentResearchController controller) {
    if (controller.status == AgentResearchStatus.loading &&
        controller.jobs.isEmpty) {
      return Center(
        child: CircularProgressIndicator(color: context.rhythm.accent),
      );
    }

    if (controller.jobs.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.science_outlined,
                size: 48, color: context.rhythm.textMuted),
            const SizedBox(height: RhythmSpacing.md),
            Text(
              'No research jobs yet',
              style: TextStyle(
                color: context.rhythm.textMuted,
                fontSize: 16,
              ),
            ),
            const SizedBox(height: RhythmSpacing.xs),
            Text(
              'Tap + New Research to get started',
              style: TextStyle(
                color: context.rhythm.textMuted,
                fontSize: 13,
              ),
            ),
          ],
        ),
      );
    }

    final active = controller.activeJobs;
    final completed = controller.completedJobs;
    final failed = controller.failedJobs;

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        RhythmSpacing.md,
        RhythmSpacing.md,
        RhythmSpacing.md,
        80, // space for FAB
      ),
      children: [
        if (active.isNotEmpty) ...[
          const _SectionHeader(title: 'Active'),
          const SizedBox(height: RhythmSpacing.xs),
          ...active.map(
            (job) => _ActiveJobCard(job: job),
          ),
          const SizedBox(height: RhythmSpacing.md),
        ],
        if (failed.isNotEmpty) ...[
          const _SectionHeader(title: 'Failed'),
          const SizedBox(height: RhythmSpacing.xs),
          ...failed.map(
            (job) => _FailedJobCard(
              job: job,
              onRetry: () => controller.retry(job.id),
              onTap: () => _showReportBottomSheet(context, job),
            ),
          ),
          const SizedBox(height: RhythmSpacing.md),
        ],
        if (completed.isNotEmpty) ...[
          const _SectionHeader(title: 'Completed'),
          const SizedBox(height: RhythmSpacing.xs),
          ...completed.map(
            (job) => _CompletedJobCard(
              job: job,
              onTap: () => _showReportBottomSheet(context, job),
            ),
          ),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// New Research Dialog
// ---------------------------------------------------------------------------

class _NewResearchDialog extends StatefulWidget {
  const _NewResearchDialog({required this.onSubmit});

  final void Function(String query, String depth) onSubmit;

  @override
  State<_NewResearchDialog> createState() => _NewResearchDialogState();
}

class _NewResearchDialogState extends State<_NewResearchDialog> {
  final _queryController = TextEditingController();
  String _depth = 'standard';
  bool _submitting = false;

  @override
  void dispose() {
    _queryController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        width: 480,
        padding: const EdgeInsets.all(RhythmSpacing.lg),
        decoration: BoxDecoration(
          color: context.rhythm.surface,
          borderRadius: BorderRadius.circular(RhythmRadius.xl),
          border: Border.all(color: context.rhythm.borderSubtle),
          boxShadow: RhythmElevation.raised,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'New Research',
              style: TextStyle(
                color: context.rhythm.textPrimary,
                fontSize: 18,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: RhythmSpacing.md),
            Text(
              'Question / Topic',
              style: TextStyle(
                color: context.rhythm.textSecondary,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: RhythmSpacing.xs),
            TextField(
              controller: _queryController,
              autofocus: true,
              maxLines: 4,
              minLines: 2,
              style: TextStyle(color: context.rhythm.textPrimary),
              decoration: InputDecoration(
                hintText: 'What would you like to research?',
                hintStyle: TextStyle(color: context.rhythm.textMuted),
                filled: true,
                fillColor: context.rhythm.canvas.withValues(alpha: 0.5),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                  borderSide: BorderSide(color: context.rhythm.border),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                  borderSide: BorderSide(color: context.rhythm.border),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.md),
                  borderSide:
                      BorderSide(color: context.rhythm.accent, width: 2),
                ),
              ),
            ),
            const SizedBox(height: RhythmSpacing.md),
            Text(
              'Depth',
              style: TextStyle(
                color: context.rhythm.textSecondary,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: RhythmSpacing.xs),
            Row(
              children: [
                _DepthOption(
                  label: 'Standard',
                  value: 'standard',
                  selected: _depth == 'standard',
                  onTap: () => setState(() => _depth = 'standard'),
                ),
                const SizedBox(width: RhythmSpacing.sm),
                _DepthOption(
                  label: 'Deep',
                  value: 'deep',
                  selected: _depth == 'deep',
                  onTap: () => setState(() => _depth = 'deep'),
                ),
              ],
            ),
            const SizedBox(height: RhythmSpacing.lg),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text(
                    'Cancel',
                    style: TextStyle(color: context.rhythm.textMuted),
                  ),
                ),
                const SizedBox(width: RhythmSpacing.sm),
                FilledButton(
                  onPressed: _submitting
                      ? null
                      : () {
                          final q = _queryController.text.trim();
                          if (q.isEmpty) return;
                          setState(() => _submitting = true);
                          widget.onSubmit(q, _depth);
                        },
                  style: FilledButton.styleFrom(
                    backgroundColor: context.rhythm.accent,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(RhythmRadius.md),
                    ),
                  ),
                  child: _submitting
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Start'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _DepthOption extends StatelessWidget {
  const _DepthOption({
    required this.label,
    required this.value,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final String value;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(
          horizontal: RhythmSpacing.md,
          vertical: RhythmSpacing.xs,
        ),
        decoration: BoxDecoration(
          color: selected
              ? context.rhythm.accentMuted
              : context.rhythm.canvas.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(RhythmRadius.sm),
          border: Border.all(
            color: selected ? context.rhythm.accent : context.rhythm.border,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color:
                selected ? context.rhythm.accent : context.rhythm.textSecondary,
            fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
            fontSize: 13,
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Section Header
// ---------------------------------------------------------------------------

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: TextStyle(
        color: context.rhythm.textSecondary,
        fontSize: 12,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.8,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Active Job Card
// ---------------------------------------------------------------------------

class _ActiveJobCard extends StatelessWidget {
  const _ActiveJobCard({required this.job});

  final AgentResearchJob job;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: RhythmSpacing.sm),
      padding: const EdgeInsets.all(RhythmSpacing.md),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised.withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: context.rhythm.borderSubtle),
        boxShadow: RhythmElevation.panel,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            job.query,
            style: TextStyle(
              color: context.rhythm.textPrimary,
              fontSize: 14,
              fontWeight: FontWeight.w500,
            ),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: RhythmSpacing.sm),
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: context.rhythm.accent,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: RhythmSpacing.xs),
              Text(
                job.statusLabel,
                style: TextStyle(
                  color: context.rhythm.accent,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
          const SizedBox(height: RhythmSpacing.xs),
          LinearProgressIndicator(
            backgroundColor: context.rhythm.borderSubtle,
            color: context.rhythm.accent,
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Completed Job Card
// ---------------------------------------------------------------------------

class _CompletedJobCard extends StatelessWidget {
  const _CompletedJobCard({
    required this.job,
    required this.onTap,
  });

  final AgentResearchJob job;
  final VoidCallback onTap;

  Future<void> _copyToClipboard(BuildContext context) async {
    final text = job.report ?? job.error ?? '';
    await Clipboard.setData(ClipboardData(text: text));
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Copied to clipboard'),
          backgroundColor: context.rhythm.surface,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDone = job.status == 'done';

    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: RhythmSpacing.sm),
        padding: const EdgeInsets.all(RhythmSpacing.md),
        decoration: BoxDecoration(
          color: context.rhythm.surfaceRaised.withValues(alpha: 0.92),
          borderRadius: BorderRadius.circular(RhythmRadius.md),
          border: Border.all(color: context.rhythm.borderSubtle),
          boxShadow: RhythmElevation.panel,
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    job.query,
                    style: TextStyle(
                      color: context.rhythm.textPrimary,
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: RhythmSpacing.xs),
                  Row(
                    children: [
                      _StatusChip(isDone: isDone),
                      if (job.sources.isNotEmpty) ...[
                        const SizedBox(width: RhythmSpacing.xs),
                        Text(
                          '${job.sources.length} sources',
                          style: TextStyle(
                            color: context.rhythm.textMuted,
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: RhythmSpacing.sm),
            IconButton(
              icon: Icon(
                Icons.copy_outlined,
                color: context.rhythm.textMuted,
                size: 18,
              ),
              tooltip: 'Copy to clipboard',
              onPressed: () => _copyToClipboard(context),
            ),
            Icon(
              Icons.chevron_right,
              color: context.rhythm.textMuted,
              size: 18,
            ),
          ],
        ),
      ),
    );
  }
}

class _FailedJobCard extends StatelessWidget {
  const _FailedJobCard({
    required this.job,
    required this.onRetry,
    required this.onTap,
  });

  final AgentResearchJob job;
  final VoidCallback onRetry;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: RhythmSpacing.sm),
      padding: const EdgeInsets.all(RhythmSpacing.md),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised.withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: context.rhythm.danger.withValues(alpha: 0.5)),
      ),
      child: Row(
        children: [
          Expanded(
            child: GestureDetector(
              onTap: onTap,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    job.query,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: context.rhythm.textPrimary,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: RhythmSpacing.xs),
                  Text(
                    job.error ?? 'Research failed. Retry to run it again.',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: context.rhythm.danger,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: RhythmSpacing.sm),
          TextButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh, size: 16),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.isDone});

  final bool isDone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: RhythmSpacing.xs,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: isDone
            ? context.rhythm.success.withValues(alpha: 0.15)
            : context.rhythm.danger.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(RhythmRadius.xs),
      ),
      child: Text(
        isDone ? 'Done' : 'Failed',
        style: TextStyle(
          color: isDone ? context.rhythm.success : context.rhythm.danger,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Report Bottom Sheet
// ---------------------------------------------------------------------------

class _ReportBottomSheet extends StatelessWidget {
  const _ReportBottomSheet({required this.job});

  final AgentResearchJob job;

  Future<void> _copyToClipboard(BuildContext context) async {
    final text = job.report ?? job.error ?? '';
    await Clipboard.setData(ClipboardData(text: text));
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Copied to clipboard'),
          backgroundColor: context.rhythm.surface,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDone = job.status == 'done';
    final reportText =
        isDone ? (job.report ?? '') : (job.error ?? 'An error occurred.');

    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      minChildSize: 0.4,
      maxChildSize: 0.95,
      builder: (ctx, scrollController) {
        return Container(
          decoration: BoxDecoration(
            color: context.rhythm.surface,
            borderRadius: const BorderRadius.vertical(
              top: Radius.circular(RhythmRadius.xl),
            ),
            border: Border.all(color: context.rhythm.borderSubtle),
          ),
          child: Column(
            children: [
              // Handle
              Padding(
                padding: const EdgeInsets.only(top: RhythmSpacing.sm),
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: context.rhythm.borderSubtle,
                    borderRadius: BorderRadius.circular(RhythmRadius.pill),
                  ),
                ),
              ),
              // Header
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  RhythmSpacing.lg,
                  RhythmSpacing.md,
                  RhythmSpacing.sm,
                  RhythmSpacing.xs,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        job.query,
                        style: TextStyle(
                          color: context.rhythm.textPrimary,
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    IconButton(
                      icon: Icon(Icons.copy_outlined,
                          color: context.rhythm.textMuted, size: 18),
                      tooltip: 'Copy report',
                      onPressed: () => _copyToClipboard(context),
                    ),
                    IconButton(
                      icon: Icon(Icons.close,
                          color: context.rhythm.textMuted, size: 18),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ],
                ),
              ),
              Divider(color: context.rhythm.borderSubtle),
              // Report body
              Expanded(
                child: SingleChildScrollView(
                  controller: scrollController,
                  padding: const EdgeInsets.fromLTRB(
                    RhythmSpacing.lg,
                    RhythmSpacing.sm,
                    RhythmSpacing.lg,
                    RhythmSpacing.xl,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (!isDone)
                        Container(
                          margin:
                              const EdgeInsets.only(bottom: RhythmSpacing.md),
                          padding: const EdgeInsets.all(RhythmSpacing.sm),
                          decoration: BoxDecoration(
                            color: context.rhythm.danger.withValues(alpha: 0.1),
                            borderRadius:
                                BorderRadius.circular(RhythmRadius.sm),
                          ),
                          child: Row(
                            children: [
                              Icon(Icons.error_outline,
                                  color: context.rhythm.danger, size: 16),
                              const SizedBox(width: RhythmSpacing.xs),
                              Text(
                                'Research failed',
                                style: TextStyle(
                                  color: context.rhythm.danger,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          ),
                        ),
                      Text(
                        reportText,
                        style: TextStyle(
                          color: context.rhythm.textPrimary,
                          fontSize: 14,
                          height: 1.6,
                        ),
                      ),
                      if (job.sources.isNotEmpty) ...[
                        const SizedBox(height: RhythmSpacing.lg),
                        Text(
                          'Sources',
                          style: TextStyle(
                            color: context.rhythm.textSecondary,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: RhythmSpacing.xs),
                        ...job.sources.map(
                          (url) => Padding(
                            padding: const EdgeInsets.only(
                                bottom: RhythmSpacing.xxs),
                            child: Text(
                              url,
                              style: TextStyle(
                                color: context.rhythm.accent,
                                fontSize: 12,
                                decoration: TextDecoration.underline,
                                decorationColor: context.rhythm.accent,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
