import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

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
                  _ImportTab(controller: _jsonController),
                ],
              ),
            ),
            _DialogFooter(
              tabs: _tabs,
              jsonController: _jsonController,
              onClose: () => Navigator.pop(context),
            ),
          ],
        ),
      ),
    );
  }
}

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
              Text('AI Import',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      )),
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
            'Then paste the AI\'s JSON output in the next tab.',
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

class _ImportTab extends StatelessWidget {
  const _ImportTab({required this.controller});
  final TextEditingController controller;

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
              decoration: const InputDecoration(
                hintText: '[\n  { "type": "task", "title": "..." }\n]',
                border: OutlineInputBorder(),
                contentPadding: EdgeInsets.all(12),
              ),
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}

class _DialogFooter extends StatelessWidget {
  const _DialogFooter({
    required this.tabs,
    required this.jsonController,
    required this.onClose,
  });

  final TabController tabs;
  final TextEditingController jsonController;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return const Divider(height: 1);
  }
}
