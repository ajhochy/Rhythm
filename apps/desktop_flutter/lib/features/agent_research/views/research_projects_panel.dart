import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../agents/views/_markdown_message_body.dart';
import '../controllers/agent_research_controller.dart';
import '../models/agent_research_job.dart';
import '../models/research_project.dart';

class ResearchProjectsPanel extends StatelessWidget {
  const ResearchProjectsPanel({super.key, required this.controller});
  final AgentResearchController controller;

  @override
  Widget build(BuildContext context) {
    return Column(children: [
      if (controller.error != null) _ErrorStrip(message: controller.error!),
      if (controller.capabilities.expand((item) => item.warnings).isNotEmpty)
        _CapabilityStrip(capabilities: controller.capabilities),
      Expanded(child: LayoutBuilder(builder: (context, constraints) {
        if (constraints.maxWidth < 820) {
          return controller.selectedProject == null
              ? _ProjectRail(controller: controller)
              : _ProjectDetail(controller: controller, compact: true);
        }
        return Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          SizedBox(width: 292, child: _ProjectRail(controller: controller)),
          VerticalDivider(width: 1, color: context.rhythm.border),
          Expanded(child: _ProjectDetail(controller: controller)),
        ]);
      })),
    ]);
  }
}

class _ErrorStrip extends StatelessWidget {
  const _ErrorStrip({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) => Container(
      width: double.infinity,
      color: context.rhythm.danger.withValues(alpha: .12),
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 9),
      child: Text('$message Try again.',
          style: TextStyle(color: context.rhythm.danger, fontSize: 12)));
}

class _CapabilityStrip extends StatelessWidget {
  const _CapabilityStrip({required this.capabilities});
  final List<ResearchCapabilityWarning> capabilities;
  @override
  Widget build(BuildContext context) {
    final warnings =
        capabilities.expand((item) => item.warnings).toSet().toList();
    return Container(
        key: const ValueKey('research-capability-warning'),
        width: double.infinity,
        color: context.rhythm.warning.withValues(alpha: .13),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
        child: Row(children: [
          Icon(Icons.warning_amber_rounded,
              size: 18, color: context.rhythm.warning),
          const SizedBox(width: 10),
          Expanded(
              child: Text(warnings.join(' · '),
                  style: TextStyle(
                      color: context.rhythm.textPrimary, fontSize: 12))),
          Text('Runs will use available fallbacks',
              style:
                  TextStyle(color: context.rhythm.textSecondary, fontSize: 11)),
        ]));
  }
}

class _ProjectRail extends StatelessWidget {
  const _ProjectRail({required this.controller});
  final AgentResearchController controller;
  @override
  Widget build(BuildContext context) => ColoredBox(
      color: context.rhythm.surfaceMuted,
      child: Column(children: [
        Padding(
            padding: const EdgeInsets.all(16),
            child: Row(children: [
              Expanded(
                  child: Text('Projects',
                      style: TextStyle(
                          color: context.rhythm.textPrimary,
                          fontSize: 16,
                          fontWeight: FontWeight.w700))),
              FilledButton.icon(
                  key: const ValueKey('new-research-project'),
                  onPressed: () => _showProjectEditor(context, controller),
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('New')),
            ])),
        Expanded(
            child: controller.projects.isEmpty
                ? _ProjectEmpty(
                    onCreate: () => _showProjectEditor(context, controller))
                : ListView.builder(
                    padding: const EdgeInsets.fromLTRB(10, 0, 10, 12),
                    itemCount: controller.projects.length,
                    itemBuilder: (context, index) {
                      final project = controller.projects[index];
                      final selected =
                          project.id == controller.selectedProject?.id;
                      return Padding(
                          padding: const EdgeInsets.only(bottom: 6),
                          child: Material(
                              color: selected
                                  ? context.rhythm.accentMuted
                                  : Colors.transparent,
                              borderRadius:
                                  BorderRadius.circular(RhythmRadius.md),
                              child: InkWell(
                                  borderRadius:
                                      BorderRadius.circular(RhythmRadius.md),
                                  onTap: () =>
                                      controller.selectProject(project),
                                  child: Padding(
                                      padding: const EdgeInsets.all(12),
                                      child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text(project.name,
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                                style: TextStyle(
                                                    color: selected
                                                        ? context.rhythm.accent
                                                        : context
                                                            .rhythm.textPrimary,
                                                    fontWeight:
                                                        FontWeight.w600)),
                                            const SizedBox(height: 4),
                                            Text(project.question,
                                                maxLines: 2,
                                                overflow: TextOverflow.ellipsis,
                                                style: TextStyle(
                                                    color: context
                                                        .rhythm.textSecondary,
                                                    fontSize: 12,
                                                    height: 1.35)),
                                            const SizedBox(height: 8),
                                            Row(children: [
                                              Icon(Icons.account_tree_outlined,
                                                  size: 13,
                                                  color:
                                                      context.rhythm.textMuted),
                                              const SizedBox(width: 4),
                                              Text(
                                                  '${project.passConfig.length} passes',
                                                  style: TextStyle(
                                                      color: context
                                                          .rhythm.textMuted,
                                                      fontSize: 11)),
                                              if (project.scheduleRef !=
                                                  null) ...[
                                                const Spacer(),
                                                Icon(Icons.schedule,
                                                    size: 13,
                                                    color: context
                                                        .rhythm.textMuted)
                                              ]
                                            ])
                                          ])))));
                    })),
        Divider(height: 1, color: context.rhythm.border),
        ListTile(
            leading: const Icon(Icons.history, size: 18),
            title: Text('Legacy Research',
                style: TextStyle(
                    color: context.rhythm.textSecondary,
                    fontSize: 13,
                    fontWeight: FontWeight.w600)),
            subtitle: Text(
                '${controller.jobs.length} job${controller.jobs.length == 1 ? '' : 's'}',
                style:
                    TextStyle(color: context.rhythm.textMuted, fontSize: 11)),
            trailing: const Icon(Icons.chevron_right, size: 18),
            onTap: () => _showLegacyResearch(context, controller))
      ]));
}

class _ProjectEmpty extends StatelessWidget {
  const _ProjectEmpty({required this.onCreate});
  final VoidCallback onCreate;
  @override
  Widget build(BuildContext context) => Center(
      key: const ValueKey('research-project-empty'),
      child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.travel_explore,
                size: 42, color: context.rhythm.textMuted),
            const SizedBox(height: 12),
            Text('Build a repeatable research brief',
                textAlign: TextAlign.center,
                style: TextStyle(
                    color: context.rhythm.textPrimary,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Text(
                'Coordinate independent passes, review disagreements, and keep one canonical synthesis.',
                textAlign: TextAlign.center,
                style: TextStyle(
                    color: context.rhythm.textSecondary,
                    fontSize: 12,
                    height: 1.4)),
            const SizedBox(height: 16),
            OutlinedButton(
                onPressed: onCreate, child: const Text('Create project'))
          ])));
}

class _ProjectDetail extends StatelessWidget {
  const _ProjectDetail({required this.controller, this.compact = false});
  final AgentResearchController controller;
  final bool compact;
  @override
  Widget build(BuildContext context) {
    final project = controller.selectedProject;
    if (project == null) {
      return Center(
          child: Text('Choose a project to inspect its evidence.',
              style: TextStyle(color: context.rhythm.textMuted)));
    }
    final run = controller.selectedRun;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Container(
          color: context.rhythm.surface,
          padding: const EdgeInsets.fromLTRB(20, 16, 12, 14),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (compact)
              IconButton(
                  onPressed: controller.clearProjectSelection,
                  tooltip: 'Back to projects',
                  icon: const Icon(Icons.arrow_back)),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text(project.name,
                      style: TextStyle(
                          color: context.rhythm.textPrimary,
                          fontSize: 20,
                          fontWeight: FontWeight.w700)),
                  const SizedBox(height: 4),
                  Text(project.question,
                      style: TextStyle(
                          color: context.rhythm.textSecondary, fontSize: 13))
                ])),
            IconButton(
                tooltip: 'Edit project',
                onPressed: () =>
                    _showProjectEditor(context, controller, project: project),
                icon: const Icon(Icons.tune)),
            IconButton(
                tooltip: 'Archive project',
                onPressed: () => _confirmArchive(context, controller, project),
                icon: const Icon(Icons.archive_outlined)),
            const SizedBox(width: 4),
            FilledButton.icon(
                onPressed: controller.startProjectRun,
                icon: const Icon(Icons.play_arrow, size: 18),
                label: const Text('Run project')),
          ])),
      Divider(height: 1, color: context.rhythm.border),
      Expanded(
          child: run == null
              ? _RunEmpty(project: project, onRun: controller.startProjectRun)
              : _RunWorkspace(
                  controller: controller, project: project, run: run)),
    ]);
  }
}

class _RunEmpty extends StatelessWidget {
  const _RunEmpty({required this.project, required this.onRun});
  final ResearchProject project;
  final VoidCallback onRun;
  @override
  Widget build(BuildContext context) => Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.route_outlined, size: 46, color: context.rhythm.textMuted),
        const SizedBox(height: 12),
        Text('No runs yet',
            style: TextStyle(
                color: context.rhythm.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w600)),
        const SizedBox(height: 6),
        Text(
            'Preflight: ${project.passConfig.length} passes · ${project.criticConfig['enabled'] == true ? 'critic on' : 'critic off'} · ${project.synthesisConfig['enabled'] == true ? 'synthesis on' : 'synthesis off'}',
            style:
                TextStyle(color: context.rhythm.textSecondary, fontSize: 12)),
        const SizedBox(height: 16),
        FilledButton.icon(
            onPressed: onRun,
            icon: const Icon(Icons.play_arrow),
            label: const Text('Run project'))
      ]));
}

class _RunWorkspace extends StatelessWidget {
  const _RunWorkspace(
      {required this.controller, required this.project, required this.run});
  final AgentResearchController controller;
  final ResearchProject project;
  final ResearchProjectRun run;
  @override
  Widget build(BuildContext context) => DefaultTabController(
      length: 5,
      child: Column(children: [
        _RunSummary(controller: controller, project: project, run: run),
        TabBar(isScrollable: true, tabs: const [
          Tab(text: 'Synthesis'),
          Tab(text: 'Passes'),
          Tab(text: 'Contrarian Review'),
          Tab(text: 'Sources'),
          Tab(text: 'Statistics')
        ]),
        Expanded(
            child: TabBarView(children: [
          _MarkdownEvidence(
              text: run.synthesis?.report,
              empty:
                  'Canonical synthesis will appear after the synthesis stage completes.',
              artifact: run.canonicalArtifact,
              artifacts: run.artifacts),
          _PassEvidence(
              stages:
                  run.stages.where((stage) => stage.ordinal < 1000).toList()),
          _MarkdownEvidence(
              text: _stageReport(run.stages, 'critic'),
              empty: 'No contrarian review is available for this run.'),
          _SourcesList(sources: run.sources),
          _Statistics(run: run),
        ])),
      ]));
}

class _RunSummary extends StatelessWidget {
  const _RunSummary(
      {required this.controller, required this.project, required this.run});
  final AgentResearchController controller;
  final ResearchProject project;
  final ResearchProjectRun run;
  @override
  Widget build(BuildContext context) {
    final maxTokens = project.budget['maxTokens'];
    final maxCost = project.budget['maxCostUsd'];
    return Container(
        color: context.rhythm.surfaceMuted,
        padding: const EdgeInsets.fromLTRB(20, 12, 16, 14),
        child: Column(children: [
          Row(children: [
            Expanded(
                child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                  _StateChip(status: run.status),
                  Text(
                      '${_number(run.usage.tokens)} / ${maxTokens is num ? _number(maxTokens.toInt()) : '—'} tokens',
                      style: TextStyle(
                          color: context.rhythm.textSecondary, fontSize: 12)),
                  Text(
                      '\$${run.usage.costUsd.toStringAsFixed(2)} / ${maxCost is num ? '\$${maxCost.toStringAsFixed(2)}' : '—'}',
                      style: TextStyle(
                          color: context.rhythm.textSecondary, fontSize: 12)),
                  Text(
                      '${run.progress['artifactCount'] ?? run.artifacts.length} artifacts · ${run.progress['sourceCount'] ?? run.sources.length} sources',
                      style: TextStyle(
                          color: context.rhythm.textSecondary, fontSize: 12))
                ])),
            if (controller.runs.length > 1)
              DropdownButtonHideUnderline(
                  child: DropdownButton<ResearchProjectRun>(
                      value: controller.runs.any((item) => item.id == run.id)
                          ? controller.runs
                              .firstWhere((item) => item.id == run.id)
                          : null,
                      hint: const Text('Run history'),
                      items: [
                        for (final item in controller.runs)
                          DropdownMenuItem(
                              value: item,
                              child: Text(
                                  '${item.status} · ${item.startedAt ?? item.id}',
                                  overflow: TextOverflow.ellipsis))
                      ],
                      onChanged: (value) {
                        if (value != null) controller.selectRun(value);
                      })),
            if (const ['pending', 'running'].contains(run.status))
              TextButton.icon(
                  onPressed: () => controller.runAction('cancel'),
                  icon: const Icon(Icons.stop_circle_outlined, size: 16),
                  label: const Text('Cancel')),
            if (const [
              'cancelled',
              'interrupted',
              'resumable',
              'degraded',
              'error'
            ].contains(run.status))
              TextButton.icon(
                  onPressed: () => controller.runAction('resume'),
                  icon: const Icon(Icons.replay, size: 16),
                  label: const Text('Resume')),
          ]),
          if (run.synthesis?.report?.isNotEmpty == true)
            Align(
                alignment: Alignment.centerRight,
                child: Wrap(spacing: 4, children: [
                  TextButton.icon(
                      onPressed: () => _open(controller.magazineUri()),
                      icon: const Icon(Icons.auto_stories_outlined, size: 16),
                      label: const Text('Open magazine')),
                  TextButton.icon(
                      onPressed: () => _open(controller.magazineUri()),
                      icon: const Icon(Icons.print_outlined, size: 16),
                      label: const Text('Print / Save PDF')),
                  PopupMenuButton<String>(
                      tooltip: 'Export report',
                      onSelected: (format) =>
                          _open(controller.exportUri(format)),
                      itemBuilder: (_) => const [
                            PopupMenuItem(
                                value: 'html', child: Text('Export HTML')),
                            PopupMenuItem(
                                value: 'markdown',
                                child: Text('Export Markdown'))
                          ],
                      icon: const Icon(Icons.download_outlined, size: 20))
                ])),
          const SizedBox(height: 12),
          _Timeline(controller: controller, run: run),
        ]));
  }

  Future<void> _open(Uri? uri) async {
    if (uri != null) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }
}

class _Timeline extends StatelessWidget {
  const _Timeline({required this.controller, required this.run});
  final AgentResearchController controller;
  final ResearchProjectRun run;
  @override
  Widget build(BuildContext context) => SizedBox(
      height: 72,
      child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: run.stages.length,
          separatorBuilder: (_, __) => Container(
              width: 28,
              height: 1,
              margin: const EdgeInsets.only(top: 18),
              color: context.rhythm.border),
          itemBuilder: (context, index) {
            final stage = run.stages[index];
            final color = _statusColor(context, stage.status);
            return SizedBox(
                width: 132,
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        Container(
                            width: 10,
                            height: 10,
                            decoration: BoxDecoration(
                                color: color, shape: BoxShape.circle)),
                        const SizedBox(width: 6),
                        Expanded(
                            child: Text(stage.role,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                    color: context.rhythm.textPrimary,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600)))
                      ]),
                      const SizedBox(height: 5),
                      Text(
                          [stage.profileId, stage.model]
                              .whereType<String>()
                              .join(' · '),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              color: context.rhythm.textMuted, fontSize: 10)),
                      Text(stage.status.replaceAll('_', ' '),
                          style: TextStyle(
                              color: color,
                              fontSize: 10,
                              fontWeight: FontWeight.w600)),
                      if (stage.status == 'error' ||
                          stage.status == 'cancelled')
                        InkWell(
                            onTap: () => controller.passAction(stage, 'retry'),
                            child: Text('Retry',
                                style: TextStyle(
                                    color: context.rhythm.accent,
                                    fontSize: 11)))
                    ]));
          }));
}

class _MarkdownEvidence extends StatelessWidget {
  const _MarkdownEvidence(
      {required this.text,
      required this.empty,
      this.artifact,
      this.artifacts = const []});
  final String? text;
  final String empty;
  final Map<String, dynamic>? artifact;
  final List<Map<String, dynamic>> artifacts;
  @override
  Widget build(BuildContext context) =>
      ListView(padding: const EdgeInsets.all(22), children: [
        if (artifact?['vault_path'] != null)
          Row(children: [
            Icon(Icons.description_outlined,
                size: 16, color: context.rhythm.accent),
            const SizedBox(width: 8),
            Expanded(
                child: Text('Canonical artifact · ${artifact!['vault_path']}',
                    style: TextStyle(
                        color: context.rhythm.textSecondary, fontSize: 12)))
          ]),
        if (artifact?['vault_path'] != null) const SizedBox(height: 16),
        if (artifacts.isNotEmpty) ...[
          Text('Artifacts',
              style: TextStyle(
                  color: context.rhythm.textPrimary,
                  fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          for (final item in artifacts)
            ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                leading: Icon(Icons.description_outlined,
                    size: 17, color: context.rhythm.accent),
                title: SelectableText(
                    item['vault_path']?.toString() ?? 'Registered artifact',
                    style: TextStyle(
                        color: context.rhythm.textSecondary, fontSize: 12)),
                subtitle: Text(
                    item['artifact_role']?.toString() ?? 'supporting',
                    style: TextStyle(
                        color: context.rhythm.textMuted, fontSize: 10))),
          const SizedBox(height: 12),
        ],
        if (text?.trim().isNotEmpty == true)
          MarkdownMessageBody(text: text!)
        else
          Text(empty, style: TextStyle(color: context.rhythm.textMuted))
      ]);
}

class _PassEvidence extends StatelessWidget {
  const _PassEvidence({required this.stages});
  final List<ResearchStage> stages;
  @override
  Widget build(BuildContext context) => stages.isEmpty
      ? Center(
          child: Text('No pass evidence yet.',
              style: TextStyle(color: context.rhythm.textMuted)))
      : ListView.separated(
          padding: const EdgeInsets.all(20),
          itemCount: stages.length,
          separatorBuilder: (_, __) => const SizedBox(height: 18),
          itemBuilder: (context, index) {
            final stage = stages[index];
            return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Expanded(
                        child: Text(stage.role,
                            style: TextStyle(
                                color: context.rhythm.textPrimary,
                                fontWeight: FontWeight.w700))),
                    _StateChip(status: stage.status)
                  ]),
                  const SizedBox(height: 8),
                  MarkdownMessageBody(
                      text: stage.report?.trim().isNotEmpty == true
                          ? stage.report!
                          : 'No persisted report for this pass.')
                ]);
          });
}

class _SourcesList extends StatelessWidget {
  const _SourcesList({required this.sources});
  final List<Map<String, dynamic>> sources;
  @override
  Widget build(BuildContext context) => sources.isEmpty
      ? Center(
          child: Text('No curated sources yet.',
              style: TextStyle(color: context.rhythm.textMuted)))
      : ListView.separated(
          padding: const EdgeInsets.all(20),
          itemCount: sources.length,
          separatorBuilder: (_, __) =>
              Divider(color: context.rhythm.borderSubtle),
          itemBuilder: (context, index) {
            final source = sources[index];
            final url = source['canonical_url']?.toString() ?? '';
            return ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(Icons.link, color: context.rhythm.accent),
                title: Text(url,
                    style: TextStyle(
                        color: context.rhythm.textPrimary, fontSize: 13)),
                subtitle: Text(
                    source['capture_status']?.toString() ?? 'unknown',
                    style: TextStyle(
                        color: context.rhythm.textMuted, fontSize: 11)),
                trailing: const Icon(Icons.open_in_new, size: 16),
                onTap: () {
                  final uri = Uri.tryParse(url);
                  if (uri != null) launchUrl(uri);
                });
          });
}

class _Statistics extends StatelessWidget {
  const _Statistics({required this.run});
  final ResearchProjectRun run;
  @override
  Widget build(BuildContext context) =>
      ListView(padding: const EdgeInsets.all(22), children: [
        _StatRow(
            label: 'Persisted progress',
            value:
                '${run.progress['completedJobs'] ?? 0} of ${run.progress['totalJobs'] ?? run.stages.length} stages complete'),
        _StatRow(
            label: 'Usage',
            value:
                '${_number(run.usage.tokens)} tokens · \$${run.usage.costUsd.toStringAsFixed(2)}'),
        _StatRow(
            label: 'Evidence',
            value:
                '${run.artifacts.length} artifacts · ${run.sources.length} curated sources'),
        _StatRow(
            label: 'Diagnostics',
            value: run.diagnostics.isEmpty
                ? 'No diagnostics'
                : run.diagnostics.entries
                    .map((entry) => '${entry.key}: ${entry.value}')
                    .join(' · '))
      ]);
}

class _StatRow extends StatelessWidget {
  const _StatRow({required this.label, required this.value});
  final String label, value;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label,
            style: TextStyle(
                color: context.rhythm.textMuted,
                fontSize: 11,
                fontWeight: FontWeight.w600)),
        const SizedBox(height: 4),
        Text(value,
            style: TextStyle(color: context.rhythm.textPrimary, fontSize: 14))
      ]));
}

class _StateChip extends StatelessWidget {
  const _StateChip({required this.status});
  final String status;
  @override
  Widget build(BuildContext context) {
    final color = _statusColor(context, status);
    return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
            color: color.withValues(alpha: .14),
            borderRadius: BorderRadius.circular(RhythmRadius.pill)),
        child: Text(status.replaceAll('_', ' '),
            style: TextStyle(
                color: color, fontSize: 11, fontWeight: FontWeight.w600)));
  }
}

Color _statusColor(BuildContext context, String status) => switch (status) {
      'done' || 'complete' || 'passes_complete' => context.rhythm.success,
      'error' || 'degraded' => context.rhythm.danger,
      'cancelled' || 'interrupted' => context.rhythm.warning,
      _ => context.rhythm.accent
    };
String _number(int value) => value
    .toString()
    .replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (match) => ',');
String? _stageReport(List<ResearchStage> stages, String role) {
  for (final stage in stages) {
    if (stage.role == role) return stage.report;
  }
  return null;
}

Future<void> _showLegacyReport(
    BuildContext context, AgentResearchJob job) async {
  await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
              title: Text(job.displayTitle),
              content: SizedBox(
                  width: 620,
                  child: SingleChildScrollView(
                      child:
                          MarkdownMessageBody(
                              text: job.report ??
                                  job.error ??
                                  'No report content.'))),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Close'))
              ]));
}

Future<void> _showLegacyResearch(
    BuildContext context, AgentResearchController controller) async {
  await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
              title: const Text('Legacy Research'),
              content: SizedBox(
                  width: 640,
                  height: 480,
                  child: controller.jobs.isEmpty
                      ? Center(
                          child: Text('No legacy jobs.',
                              style:
                                  TextStyle(color: context.rhythm.textMuted)))
                      : ListView.separated(
                          itemCount: controller.jobs.length,
                          separatorBuilder: (_, __) =>
                              Divider(color: context.rhythm.borderSubtle),
                          itemBuilder: (context, index) {
                            final job = controller.jobs[index];
                            return ListTile(
                                title: Text(job.displayTitle,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis),
                                subtitle: Text(job.error ?? job.statusLabel,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis),
                                trailing: job.canRetry
                                    ? TextButton.icon(
                                        onPressed: () =>
                                            controller.retry(job.id),
                                        icon:
                                            const Icon(Icons.refresh, size: 16),
                                        label: const Text('Retry'))
                                    : const Icon(Icons.chevron_right),
                                onTap: () => _showLegacyReport(context, job));
                          })),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(dialogContext),
                    child: const Text('Close'))
              ]));
}

Future<void> _confirmArchive(BuildContext context,
    AgentResearchController controller, ResearchProject project) async {
  final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
              title: const Text('Archive research project?'),
              content: Text(
                  '${project.name} will leave the active list. Its runs and artifacts remain preserved.'),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: const Text('Keep project')),
                FilledButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: const Text('Archive'))
              ]));
  if (confirmed != true) return;
  final success = await controller.archiveProject(project.id);
  if (!success && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(controller.error ?? 'Could not archive project.')));
  }
}

Future<void> _showProjectEditor(
    BuildContext context, AgentResearchController controller,
    {ResearchProject? project}) async {
  final name = TextEditingController(text: project?.name);
  final question = TextEditingController(text: project?.question);
  final goals = TextEditingController(text: project?.goals.join('\n') ?? '');
  final domain = TextEditingController(text: project?.domain ?? 'general');
  final roles = TextEditingController(
      text: project?.passConfig
              .map((item) => item['role'])
              .whereType<String>()
              .join(', ') ??
          'source analyst, practitioner');
  final profile = TextEditingController(text: project?.profileId ?? 'research');
  final model = TextEditingController(
      text: project?.modelPolicy['model']?.toString() ?? '');
  final schedule = TextEditingController(text: project?.scheduleRef ?? '');
  final tokens = TextEditingController(
      text: project?.budget['maxTokens']?.toString() ?? '50000');
  final cost = TextEditingController(
      text: project?.budget['maxCostUsd']?.toString() ?? '10');
  bool critic = project?.criticConfig['enabled'] != false;
  bool synthesis = project?.synthesisConfig['enabled'] != false;
  bool submitting = false;
  await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
          builder: (context, setState) => AlertDialog(
                  title: Text(project == null
                      ? 'Create research project'
                      : 'Edit research project'),
                  content: SizedBox(
                      width: 560,
                      child: SingleChildScrollView(
                          child:
                              Column(mainAxisSize: MainAxisSize.min, children: [
                        TextField(
                            controller: name,
                            decoration: const InputDecoration(
                                labelText: 'Project name')),
                        TextField(
                            controller: question,
                            maxLines: 3,
                            decoration: const InputDecoration(
                                labelText: 'Research question')),
                        TextField(
                            controller: goals,
                            maxLines: 3,
                            decoration: const InputDecoration(
                                labelText: 'Goals (one per line)')),
                        TextField(
                            controller: domain,
                            decoration:
                                const InputDecoration(labelText: 'Domain')),
                        TextField(
                            controller: roles,
                            decoration: const InputDecoration(
                                labelText: 'Pass roles (comma separated)')),
                        Row(children: [
                          Expanded(
                              child: TextField(
                                  controller: profile,
                                  decoration: const InputDecoration(
                                      labelText: 'Agent profile'))),
                          const SizedBox(width: 12),
                          Expanded(
                              child: TextField(
                                  controller: model,
                                  decoration: const InputDecoration(
                                      labelText: 'Model override (optional)')))
                        ]),
                        SwitchListTile(
                            contentPadding: EdgeInsets.zero,
                            title: const Text('Contrarian review'),
                            value: critic,
                            onChanged: (value) =>
                                setState(() => critic = value)),
                        SwitchListTile(
                            contentPadding: EdgeInsets.zero,
                            title: const Text('Canonical synthesis'),
                            value: synthesis,
                            onChanged: (value) =>
                                setState(() => synthesis = value)),
                        TextField(
                            controller: schedule,
                            decoration: const InputDecoration(
                                labelText: 'Schedule ID (optional)')),
                        Row(children: [
                          Expanded(
                              child: TextField(
                                  controller: tokens,
                                  keyboardType: TextInputType.number,
                                  decoration: const InputDecoration(
                                      labelText: 'Token budget'))),
                          const SizedBox(width: 12),
                          Expanded(
                              child: TextField(
                                  controller: cost,
                                  keyboardType: TextInputType.number,
                                  decoration: const InputDecoration(
                                      labelText: 'Cost budget (USD)')))
                        ])
                      ]))),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(dialogContext),
                        child: const Text('Cancel')),
                    FilledButton(
                        onPressed: submitting
                            ? null
                            : () async {
                                if (name.text.trim().isEmpty ||
                                    question.text.trim().isEmpty) return;
                                setState(() => submitting = true);
                                final roleValues = roles.text
                                    .split(',')
                                    .map((value) => value.trim())
                                    .where((value) => value.isNotEmpty)
                                    .toList();
                                final input = <String, dynamic>{
                                  'name': name.text.trim(),
                                  'question': question.text.trim(),
                                  'goals': goals.text
                                      .split('\n')
                                      .map((value) => value.trim())
                                      .where((value) => value.isNotEmpty)
                                      .toList(),
                                  'domain': domain.text.trim(),
                                  'profileId': profile.text.trim(),
                                  'passConfig': [
                                    for (final entry in roleValues.indexed)
                                      {
                                        if (project != null &&
                                            entry.$1 <
                                                project.passConfig.length)
                                          ...project.passConfig[entry.$1],
                                        'role': entry.$2,
                                        'profileId': profile.text.trim(),
                                        if (model.text.trim().isNotEmpty)
                                          'model': model.text.trim()
                                      }
                                  ],
                                  'modelPolicy': {
                                    ...?project?.modelPolicy,
                                    'model': model.text.trim()
                                  },
                                  'criticConfig': {
                                    ...?project?.criticConfig,
                                    'enabled': critic,
                                    'profileId': profile.text.trim()
                                  },
                                  'synthesisConfig': {
                                    ...?project?.synthesisConfig,
                                    'enabled': synthesis,
                                    'profileId': profile.text.trim()
                                  },
                                  'scheduleRef': schedule.text.trim().isEmpty
                                      ? null
                                      : schedule.text.trim(),
                                  'budget': {
                                    ...?project?.budget,
                                    'maxTokens': int.tryParse(tokens.text),
                                    'maxCostUsd': double.tryParse(cost.text)
                                  }
                                };
                                final success = project == null
                                    ? await controller.createProject(input) !=
                                        null
                                    : await controller.updateProject(
                                        project.id, input);
                                if (!dialogContext.mounted) return;
                                if (success) {
                                  Navigator.pop(dialogContext);
                                } else {
                                  setState(() => submitting = false);
                                  ScaffoldMessenger.of(dialogContext)
                                      .showSnackBar(SnackBar(
                                          content: Text(controller.error ??
                                              'Could not save project.')));
                                }
                              },
                        child: submitting
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2))
                            : Text(project == null
                                ? 'Create project'
                                : 'Save changes'))
                  ])));
  for (final item in [
    name,
    question,
    goals,
    domain,
    roles,
    profile,
    model,
    schedule,
    tokens,
    cost
  ]) {
    item.dispose();
  }
}
