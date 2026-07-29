/// Plain-language QUALITY scorecard for recent agent runs (#865).
///
/// DISTINCT from the "Usage Budget" SPEND view (`GET /agents/usage-budget`):
/// spend answers "how much did this cost"; this screen answers "is this
/// agent doing a good job" — written for non-technical church-office staff,
/// not engineers. No raw percentages-with-no-context, no jargon like "token"
/// left unexplained, no misleading 0%/100% from a handful of runs.
///
/// READ-ONLY. This view (and its backing service) is never wired into the
/// org-optimizer auto-tune loop (#816 is the separate, explicitly-scoped
/// concern for automatic changes) — it only ever reports what already
/// happened.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/run_quality_controller.dart';
import '../models/agent_run_quality.dart';

class RunQualityView extends StatefulWidget {
  const RunQualityView({super.key});

  @override
  State<RunQualityView> createState() => _RunQualityViewState();
}

class _RunQualityViewState extends State<RunQualityView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<RunQualityController>().refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<RunQualityController>(
      builder: (context, controller, _) {
        return Scaffold(
          backgroundColor: context.rhythm.canvas,
          appBar: AppBar(
            backgroundColor: context.rhythm.surface,
            elevation: 0,
            title: Text(
              'Agent Report Card',
              style: TextStyle(
                color: context.rhythm.textPrimary,
                fontWeight: FontWeight.w700,
                fontSize: 17,
              ),
            ),
            iconTheme: IconThemeData(color: context.rhythm.textSecondary),
            actions: [
              IconButton(
                icon: Icon(Icons.refresh, color: context.rhythm.textSecondary),
                tooltip: 'Refresh',
                onPressed: controller.refresh,
              ),
              const SizedBox(width: 8),
            ],
            bottom: PreferredSize(
              preferredSize: const Size.fromHeight(1),
              child: Divider(
                height: 1,
                thickness: 1,
                color: context.rhythm.border,
              ),
            ),
          ),
          body: _buildBody(context, controller),
        );
      },
    );
  }

  Widget _buildBody(BuildContext context, RunQualityController controller) {
    if (controller.status == RunQualityStatus.loading &&
        controller.agents.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (controller.status == RunQualityStatus.error &&
        controller.error != null &&
        controller.agents.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, color: context.rhythm.danger, size: 40),
            const SizedBox(height: 12),
            Text(
              controller.error!,
              style: TextStyle(color: context.rhythm.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: controller.refresh,
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (controller.agents.isEmpty) {
      return Center(
        key: const ValueKey('run-quality-empty-state'),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.fact_check_outlined,
              size: 56,
              color: context.rhythm.textMuted,
            ),
            const SizedBox(height: 16),
            Text(
              'No agent runs yet',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textSecondary,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Once your agents have run a few times, their report cards will show up here.',
              style: TextStyle(fontSize: 14, color: context.rhythm.textMuted),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    return ListView(
      key: const ValueKey('run-quality-list'),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 12, left: 4, right: 4),
          child: Text(
            'How each agent has been doing over the last '
            '${controller.rollup?.windowDays ?? 30} days — separate from how '
            'much they cost.',
            style: TextStyle(fontSize: 13, color: context.rhythm.textMuted),
          ),
        ),
        for (final agent in controller.agents) ...[
          _AgentReportCard(
            key: ValueKey('run-quality-card-${agent.agentKind}'),
            agent: agent,
          ),
          const SizedBox(height: 12),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Per-agent report card
// ---------------------------------------------------------------------------

class _AgentReportCard extends StatelessWidget {
  const _AgentReportCard({super.key, required this.agent});

  final AgentRunQuality agent;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: context.rhythm.surface,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: context.rhythm.border),
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  agent.agentLabel,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: context.rhythm.textPrimary,
                  ),
                ),
              ),
              Text(
                '${agent.totalRuns} run${agent.totalRuns == 1 ? '' : 's'}',
                style: TextStyle(fontSize: 12, color: context.rhythm.textMuted),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (agent.notEnoughData)
            _NotEnoughDataBanner(agent: agent)
          else ...[
            _CompletionRow(agent: agent),
            const SizedBox(height: 10),
            _WasteRow(agent: agent),
            const SizedBox(height: 10),
            _CorrectionsRow(agent: agent),
          ],
          if (agent.unmeasuredRuns > 0) ...[
            const SizedBox(height: 10),
            _UnmeasuredNote(agent: agent),
          ],
          if (agent.repeatedMistakes.isNotEmpty) ...[
            const SizedBox(height: 12),
            _RepeatedMistakesBlock(agent: agent),
          ],
        ],
      ),
    );
  }
}

class _NotEnoughDataBanner extends StatelessWidget {
  const _NotEnoughDataBanner({required this.agent});

  final AgentRunQuality agent;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('not-enough-data-banner'),
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
      ),
      child: Row(
        children: [
          Icon(
            Icons.hourglass_empty,
            size: 16,
            color: context.rhythm.textMuted,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Not enough runs yet to say how this agent is doing '
              '(${agent.totalRuns} so far). Check back after a few more.',
              style: TextStyle(
                fontSize: 13,
                color: context.rhythm.textSecondary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _UnmeasuredNote extends StatelessWidget {
  const _UnmeasuredNote({required this.agent});

  final AgentRunQuality agent;

  @override
  Widget build(BuildContext context) {
    return Row(
      key: const ValueKey('unmeasured-note'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.help_outline, size: 14, color: context.rhythm.textMuted),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            '${agent.unmeasuredRuns} run${agent.unmeasuredRuns == 1 ? '' : 's'} '
            "couldn't be scored and ${agent.unmeasuredRuns == 1 ? 'is' : 'are'} "
            'shown as unmeasured rather than counted as a pass.',
            style: TextStyle(fontSize: 12, color: context.rhythm.textMuted),
          ),
        ),
      ],
    );
  }
}

class _CompletionRow extends StatelessWidget {
  const _CompletionRow({required this.agent});

  final AgentRunQuality agent;

  @override
  Widget build(BuildContext context) {
    final rate = agent.completionRate ?? 0;
    final pct = (rate * 100).round();
    final color = rate >= 0.8
        ? context.rhythm.success
        : (rate >= 0.5 ? context.rhythm.warning : context.rhythm.danger);

    return Row(
      key: const ValueKey('completion-row'),
      children: [
        Icon(Icons.check_circle_outline, size: 16, color: color),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            'Finished the job $pct% of the time '
            '(${agent.completedRuns} finished, ${agent.escalatedRuns} needed help)',
            style: TextStyle(fontSize: 13, color: context.rhythm.textPrimary),
          ),
        ),
      ],
    );
  }
}

class _WasteRow extends StatelessWidget {
  const _WasteRow({required this.agent});

  final AgentRunQuality agent;

  @override
  Widget build(BuildContext context) {
    final wastePct = agent.wastePercentOfSpend;
    final label = wastePct == null
        ? 'No usage data yet to check for wasted effort'
        : 'Wasted ${(wastePct * 100).round()}% of its usage on runs that '
              "didn't pan out";
    final color = wastePct == null
        ? context.rhythm.textMuted
        : (wastePct >= 0.3
              ? context.rhythm.danger
              : (wastePct > 0
                    ? context.rhythm.warning
                    : context.rhythm.success));

    return Row(
      key: const ValueKey('waste-row'),
      children: [
        Icon(Icons.hourglass_bottom, size: 16, color: color),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            label,
            style: TextStyle(fontSize: 13, color: context.rhythm.textPrimary),
          ),
        ),
      ],
    );
  }
}

class _CorrectionsRow extends StatelessWidget {
  const _CorrectionsRow({required this.agent});

  final AgentRunQuality agent;

  @override
  Widget build(BuildContext context) {
    final avg = agent.avgCorrectionsPerRun ?? 0;
    final color = avg <= 0.2
        ? context.rhythm.success
        : (avg <= 1 ? context.rhythm.warning : context.rhythm.danger);

    return Row(
      key: const ValueKey('corrections-row'),
      children: [
        Icon(Icons.forum_outlined, size: 16, color: color),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            avg == 0
                ? 'You rarely had to step back in and redirect it'
                : 'You had to step back in and redirect it about '
                      '${avg.toStringAsFixed(1)} time${avg == 1 ? '' : 's'} per run',
            style: TextStyle(fontSize: 13, color: context.rhythm.textPrimary),
          ),
        ),
      ],
    );
  }
}

class _RepeatedMistakesBlock extends StatelessWidget {
  const _RepeatedMistakesBlock({required this.agent});

  final AgentRunQuality agent;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('repeated-mistakes-block'),
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: context.rhythm.danger.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        border: Border.all(color: context.rhythm.danger.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.repeat, size: 15, color: context.rhythm.danger),
              const SizedBox(width: 6),
              Text(
                'Keeps making the same mistake',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: context.rhythm.danger,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          for (final mistake in agent.repeatedMistakes)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Text(
                '${mistake.message} (${mistake.count}×)',
                style: TextStyle(
                  fontSize: 12,
                  color: context.rhythm.textPrimary,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
