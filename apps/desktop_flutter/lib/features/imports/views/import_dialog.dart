import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../projects/controllers/project_template_controller.dart';
import '../../rhythms/controllers/rhythms_controller.dart';
import '../../tasks/controllers/tasks_controller.dart';

class ImportDialog extends StatefulWidget {
  const ImportDialog({super.key});

  @override
  State<ImportDialog> createState() => _ImportDialogState();
}

class _ImportDialogState extends State<ImportDialog>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  final _jsonController = TextEditingController();
  bool _copied = false;
  bool _isImporting = false;
  String? _importError;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabs.dispose();
    _jsonController.dispose();
    super.dispose();
  }

  static const _aiPrompt = '''
You are helping import data into Rhythm, a personal task and project management tool.

Please output a JSON array of objects. Each object represents one item. Supported types:

---
TASK (one-off):
{
  "type": "task",
  "title": "string (required)",
  "notes": "string (optional)",
  "dueDate": "YYYY-MM-DD (optional)"
}

RECURRING RULE:
{
  "type": "recurring_rule",
  "title": "string (required)",
  "frequency": "weekly | monthly | annual",
  "dayOfWeek": 0-6 (0=Sun, optional, for weekly),
  "dayOfMonth": 1-31 (optional, for monthly),
  "month": 1-12 (optional, for annual)
}

PROJECT TEMPLATE:
{
  "type": "project_template",
  "name": "string (required)",
  "description": "string (optional)",
  "steps": [
    {
      "title": "string (required)",
      "offsetDays": integer (days before anchor, negative = before, positive = after),
      "offsetDescription": "string (optional, e.g. '2 weeks before')"
    }
  ]
}
---

Return ONLY the JSON array, no explanation or markdown fences.

Example:
[
  { "type": "task", "title": "Call dentist", "dueDate": "2026-04-01" },
  { "type": "recurring_rule", "title": "Weekly review", "frequency": "weekly", "dayOfWeek": 1 },
  {
    "type": "project_template",
    "name": "Conference Prep",
    "steps": [
      { "title": "Book travel", "offsetDays": -30, "offsetDescription": "30 days before" },
      { "title": "Prepare slides", "offsetDays": -7, "offsetDescription": "1 week before" }
    ]
  }
]
''';

  Future<void> _copyPrompt() async {
    await Clipboard.setData(const ClipboardData(text: _aiPrompt));
    setState(() => _copied = true);
    await Future.delayed(const Duration(seconds: 2));
    if (mounted) setState(() => _copied = false);
  }

  Future<void> _runImport() async {
    final raw = _jsonController.text.trim();
    if (raw.isEmpty) {
      setState(() => _importError = 'Paste the JSON array first.');
      return;
    }

    setState(() {
      _isImporting = true;
      _importError = null;
    });

    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) {
        throw const FormatException('Expected a JSON array.');
      }

      final tasksCtrl = context.read<TasksController>();
      final rhythmsCtrl = context.read<RhythmsController>();
      final projectsCtrl = context.read<ProjectTemplateController>();

      int tasks = 0, rules = 0, templates = 0;

      for (final entry in decoded) {
        final item = entry as Map<String, dynamic>;
        switch (item['type'] as String?) {
          case 'task':
            await tasksCtrl.createTask(
              item['title'] as String,
              notes: item['notes'] as String?,
              dueDate: item['dueDate'] as String?,
            );
            tasks++;

          case 'recurring_rule':
            await rhythmsCtrl.createRule(
              title: item['title'] as String,
              frequency: item['frequency'] as String,
              dayOfWeek: item['dayOfWeek'] as int?,
              dayOfMonth: item['dayOfMonth'] as int?,
              month: item['month'] as int?,
            );
            rules++;

          case 'project_template':
            await projectsCtrl.createTemplate(
              item['name'] as String,
              description: item['description'] as String?,
            );
            final templateId = projectsCtrl.templates.last.id;
            final steps = (item['steps'] as List?) ?? [];
            for (var i = 0; i < steps.length; i++) {
              final step = steps[i] as Map<String, dynamic>;
              await projectsCtrl.addStep(
                templateId,
                title: step['title'] as String,
                offsetDays: step['offsetDays'] as int,
                offsetDescription: step['offsetDescription'] as String?,
                sortOrder: i,
              );
            }
            templates++;

          default:
            break; // Unknown type — skip silently.
        }
      }

      if (!mounted) return;

      final parts = [
        if (tasks > 0) '$tasks task${tasks == 1 ? '' : 's'}',
        if (rules > 0) '$rules rhythm${rules == 1 ? '' : 's'}',
        if (templates > 0) '$templates template${templates == 1 ? '' : 's'}',
      ];
      final summary = parts.isEmpty ? 'Nothing to import.' : parts.join(', ');
      Navigator.pop(context);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Imported: $summary')));
    } on FormatException catch (e) {
      setState(() {
        _isImporting = false;
        _importError = 'Invalid JSON: ${e.message}';
      });
    } catch (e) {
      setState(() {
        _isImporting = false;
        _importError = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      child: SizedBox(
        width: 680,
        height: 560,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _DialogHeader(tabs: _tabs),
            Expanded(
              child: TabBarView(
                controller: _tabs,
                children: [
                  _PromptTab(
                    prompt: _aiPrompt,
                    copied: _copied,
                    onCopy: _copyPrompt,
                  ),
                  _ImportTab(
                    controller: _jsonController,
                    errorMessage: _importError,
                  ),
                ],
              ),
            ),
            _DialogFooter(
              tabs: _tabs,
              isImporting: _isImporting,
              onClose: () => Navigator.pop(context),
              onImport: _runImport,
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

class _DialogHeader extends StatelessWidget {
  const _DialogHeader({required this.tabs});
  final TabController tabs;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 4),
          child: Row(
            children: [
              const Icon(Icons.smart_toy_outlined, size: 20),
              const SizedBox(width: 8),
              Text(
                'AI Import',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
              ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.close, size: 18),
                onPressed: () => Navigator.pop(context),
              ),
            ],
          ),
        ),
        TabBar(
          controller: tabs,
          tabs: const [
            Tab(text: '1. Copy prompt'),
            Tab(text: '2. Paste & import'),
          ],
          labelStyle: const TextStyle(fontWeight: FontWeight.w600),
        ),
        const Divider(height: 1),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Tab 1: prompt
// ---------------------------------------------------------------------------

class _PromptTab extends StatelessWidget {
  const _PromptTab({
    required this.prompt,
    required this.copied,
    required this.onCopy,
  });

  final String prompt;
  final bool copied;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Copy this prompt into ChatGPT, Claude, or any AI. '
            "Then paste the AI's JSON output in the next tab.",
            style: TextStyle(color: Colors.grey[700], fontSize: 13),
          ),
          const SizedBox(height: 12),
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                color: const Color(0xFFF8F9FA),
                border: Border.all(color: const Color(0xFFE5E7EB)),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Stack(
                children: [
                  SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: SelectableText(
                      prompt.trim(),
                      style: const TextStyle(
                          fontFamily: 'monospace', fontSize: 12),
                    ),
                  ),
                  Positioned(
                    top: 8,
                    right: 8,
                    child: FilledButton.icon(
                      onPressed: onCopy,
                      icon: Icon(copied ? Icons.check : Icons.copy, size: 16),
                      label: Text(copied ? 'Copied!' : 'Copy prompt'),
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 8),
                        textStyle: const TextStyle(fontSize: 13),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Tab 2: paste & import
// ---------------------------------------------------------------------------

class _ImportTab extends StatelessWidget {
  const _ImportTab({required this.controller, this.errorMessage});

  final TextEditingController controller;
  final String? errorMessage;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Paste the JSON array returned by the AI below, then press Import.',
            style: TextStyle(color: Colors.grey[700], fontSize: 13),
          ),
          const SizedBox(height: 12),
          Expanded(
            child: TextField(
              controller: controller,
              maxLines: null,
              expands: true,
              textAlignVertical: TextAlignVertical.top,
              decoration: InputDecoration(
                hintText: '[\n  { "type": "task", "title": "..." }\n]',
                border: const OutlineInputBorder(),
                contentPadding: const EdgeInsets.all(12),
                errorText: errorMessage,
              ),
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Footer with tab-aware action buttons
// ---------------------------------------------------------------------------

class _DialogFooter extends StatefulWidget {
  const _DialogFooter({
    required this.tabs,
    required this.isImporting,
    required this.onClose,
    required this.onImport,
  });

  final TabController tabs;
  final bool isImporting;
  final VoidCallback onClose;
  final VoidCallback onImport;

  @override
  State<_DialogFooter> createState() => _DialogFooterState();
}

class _DialogFooterState extends State<_DialogFooter> {
  @override
  void initState() {
    super.initState();
    widget.tabs.addListener(_onTabChange);
  }

  @override
  void didUpdateWidget(_DialogFooter old) {
    super.didUpdateWidget(old);
    if (old.tabs != widget.tabs) {
      old.tabs.removeListener(_onTabChange);
      widget.tabs.addListener(_onTabChange);
    }
  }

  @override
  void dispose() {
    widget.tabs.removeListener(_onTabChange);
    super.dispose();
  }

  void _onTabChange() => setState(() {});

  @override
  Widget build(BuildContext context) {
    final onPasteTab = widget.tabs.index == 1;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Divider(height: 1),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(
                onPressed: widget.onClose,
                child: const Text('Cancel'),
              ),
              const SizedBox(width: 8),
              if (!onPasteTab)
                FilledButton(
                  onPressed: () => widget.tabs.animateTo(1),
                  child: const Text('Next →'),
                )
              else
                FilledButton.icon(
                  onPressed: widget.isImporting ? null : widget.onImport,
                  icon: widget.isImporting
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.download_rounded, size: 16),
                  label: Text(widget.isImporting ? 'Importing…' : 'Import'),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
