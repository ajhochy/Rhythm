import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agents_controller.dart';
import '../models/chat_models.dart';

/// Renders a `question` (AskUserQuestion) tool call as an interactive answer
/// selector.
///
/// The opencode SDK emits a tool part with `toolName == 'question'` and
/// `toolArgs == { "questions": [ { "header": "...", "question": "...",
/// "options": [...] }, ... ] }`.
///
/// Each question is rendered as a header + question text + one FilledButton
/// per option.  Multi-select questions (more than one question in the array)
/// are handled by collecting each individual answer before submitting.
///
/// Submitting answers the question through opencode's dedicated Question API
/// (`AgentsController.replyQuestion`, keyed by the tool `callId`), NOT via a
/// `session.input` prompt — a plain prompt never completes the pending
/// `question` tool, so the agent would hang forever (#622 root cause). A
/// Dismiss affordance calls `rejectQuestion` so a question can always be
/// escaped; either path unblocks the agent.
///
/// If the tool is already answered (toolStatus == 'completed') the card renders
/// a compact "Answered: <label>" stub instead.
class QuestionToolCard extends StatefulWidget {
  const QuestionToolCard({
    super.key,
    required this.part,
    required this.sessionId,
  });

  final ChatPart part;
  final String sessionId;

  @override
  State<QuestionToolCard> createState() => _QuestionToolCardState();
}

class _QuestionToolCardState extends State<QuestionToolCard> {
  // null = unanswered; non-null = the submitted answer label(s).
  List<String>? _answers;

  // Parsed question list — filled once in [_parseQuestions].
  List<_Question> _questions = const [];

  // For multi-question single-select flows: track the selected option per
  // question index before submitting the whole batch.
  final Map<int, String> _pending = {};

  // OCU-06: for `multiple` (multi-select) questions, the staged set of chosen
  // option labels per question index.
  final Map<int, Set<String>> _multiSelected = {};

  // OCU-06: for `custom` (free-text) questions, the typed answer per question
  // index (empty/absent when the user hasn't opened/typed the "Other…" field).
  final Map<int, TextEditingController> _customControllers = {};

  // OCU-06: which question indices currently show their "Other…" text field.
  final Set<int> _customOpen = {};

  @override
  void dispose() {
    for (final c in _customControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  void initState() {
    super.initState();
    _questions = _parseQuestions(widget.part.toolArgs);
    // If already completed (e.g. restored from history), show the output.
    if (widget.part.toolStatus == 'completed' &&
        widget.part.toolOutput != null &&
        widget.part.toolOutput!.isNotEmpty) {
      _answers = [widget.part.toolOutput!];
    }
  }

  @override
  void didUpdateWidget(QuestionToolCard old) {
    super.didUpdateWidget(old);
    // Re-parse if args changed (streaming fill-in).
    if (old.part.toolArgs != widget.part.toolArgs) {
      setState(() => _questions = _parseQuestions(widget.part.toolArgs));
    }
    // Auto-mark answered when the SDK finalises the tool.
    if (_answers == null &&
        widget.part.toolStatus == 'completed' &&
        widget.part.toolOutput != null &&
        widget.part.toolOutput!.isNotEmpty) {
      setState(() => _answers = [widget.part.toolOutput!]);
    }
  }

  static List<_Question> _parseQuestions(Map<String, dynamic>? args) {
    if (args == null) return const [];
    return _parseQuestionList(args['questions']);
  }

  static List<_Question> _parseQuestionList(dynamic raw) {
    if (raw is! List) return const [];
    final out = <_Question>[];
    for (final item in raw) {
      if (item is! Map) continue;
      final header = item['header'] as String? ?? '';
      final question = item['question'] as String? ?? '';
      final optionsRaw = item['options'];
      final options = <String>[];
      if (optionsRaw is List) {
        for (final o in optionsRaw) {
          if (o is String) {
            options.add(o);
          } else if (o is Map) {
            final label = o['label'] as String?;
            if (label != null && label.isNotEmpty) options.add(label);
          }
        }
      }
      // OCU-06: `multiple` (multi-select) defaults false; `custom` (free-text
      // allowed) defaults true per the engine question schema.
      final multiple = item['multiple'] == true;
      final custom = item['custom'] as bool? ?? true;
      if (question.isNotEmpty) {
        out.add(
          _Question(
            header: header,
            question: question,
            options: options,
            multiple: multiple,
            custom: custom,
          ),
        );
      }
    }
    return out;
  }

  /// OCU-06: the fast single-tap path applies only to a lone single-select
  /// question. Multi-select (`multiple`) or multi-question flows stage their
  /// selections behind an explicit Submit; free-text (`custom`) alone does NOT
  /// disable the fast path — tapping an option is still a complete answer.
  bool get _isFastSingleSelect =>
      _questions.length == 1 && !_questions.first.multiple;

  void _selectOption(int qIdx, String option) {
    if (_isFastSingleSelect) {
      // Single single-select question — submit immediately on tap (unchanged).
      _submit(
        [
          [option],
        ],
        displayLabels: [option],
      );
      return;
    }
    if (_questions[qIdx].multiple) {
      // Multi-select — toggle the option in the staged set.
      setState(() {
        final set = _multiSelected.putIfAbsent(qIdx, () => <String>{});
        if (!set.remove(option)) set.add(option);
      });
    } else {
      // Multi-question single-select — stage the selection.
      setState(() => _pending[qIdx] = option);
    }
  }

  /// OCU-06: staged answers for one question index — selected options plus any
  /// typed custom string. Multi-select unions options + custom; single-select
  /// uses the staged option (or the custom text when no option is chosen).
  List<String> _answersFor(int qIdx) {
    final q = _questions[qIdx];
    final custom = _customControllers[qIdx]?.text.trim() ?? '';
    if (q.multiple) {
      final out = <String>[...?_multiSelected[qIdx]];
      if (q.custom && custom.isNotEmpty) out.add(custom);
      return out;
    }
    final opt = _pending[qIdx];
    if (opt != null && opt.isNotEmpty) return [opt];
    if (q.custom && custom.isNotEmpty) return [custom];
    return const [];
  }

  /// Every question has at least one staged answer (option or custom text).
  bool get _allStaged =>
      _questions.isNotEmpty &&
      List.generate(
        _questions.length,
        (i) => i,
      ).every((i) => _answersFor(i).isNotEmpty);

  String _submitLabel() {
    if (_questions.length <= 1) return 'Submit';
    final staged = List.generate(
      _questions.length,
      (i) => i,
    ).where((i) => _answersFor(i).isNotEmpty).length;
    return 'Submit ($staged/${_questions.length})';
  }

  void _submitFromPending() {
    final answers = <List<String>>[
      for (var i = 0; i < _questions.length; i++) _answersFor(i),
    ];
    final display = <String>[
      for (var i = 0; i < _questions.length; i++)
        '${_questions[i].header.isNotEmpty ? "${_questions[i].header}: " : ""}'
            '${_answersFor(i).join(", ")}',
    ];
    _submit(answers, displayLabels: display);
  }

  /// Resolve the [AgentsController] from the tree, or null when none is
  /// provided (e.g. isolated widget tests). The card still renders and the
  /// answer affordance is a safe no-op without a controller.
  AgentsController? _controller(BuildContext context, {required bool listen}) {
    try {
      return listen
          ? context.watch<AgentsController>()
          : context.read<AgentsController>();
    } on Object {
      return null;
    }
  }

  /// Answer the question via opencode's Question API (NOT `session.input`).
  /// A plain prompt never completes the pending `question` tool, so the agent
  /// would hang forever (#622 root cause). [answers] is one `List<String>` per
  /// question — opencode's QuestionAnswer is an array of selected labels.
  void _submit(
    List<List<String>> answers, {
    required List<String> displayLabels,
  }) {
    final callId = widget.part.toolCallId;
    if (callId != null && callId.isNotEmpty) {
      _controller(
        context,
        listen: false,
      )?.replyQuestion(widget.sessionId, callId, answers);
    }
    setState(() => _answers = displayLabels);
  }

  /// Dismiss the question without answering — also unblocks the agent so the
  /// session can never get stuck on an unanswered question.
  void _dismiss() {
    final callId = widget.part.toolCallId;
    if (callId != null && callId.isNotEmpty) {
      _controller(
        context,
        listen: false,
      )?.rejectQuestion(widget.sessionId, callId);
    }
    setState(() => _answers = ['Dismissed']);
  }

  @override
  Widget build(BuildContext context) {
    final r = context.rhythm;
    // Already answered locally — show compact stub.
    if (_answers != null) {
      return _AnsweredStub(answers: _answers!);
    }

    final controller = _controller(context, listen: true);
    final callId = widget.part.toolCallId;

    // Resolved by another client or by the agent — stop offering an answer.
    if (controller != null &&
        callId != null &&
        callId.isNotEmpty &&
        controller.isQuestionResolved(widget.sessionId, callId)) {
      return const _AnsweredStub(answers: ['Resolved']);
    }

    // Prefer the tool-part input; fall back to the authoritative `question.asked`
    // payload the controller captured (the tool input can stream in slowly, or
    // arrive after the card first rendered — this kept the card stuck on the
    // "Waiting for question…" placeholder).
    if (_questions.isEmpty &&
        controller != null &&
        callId != null &&
        callId.isNotEmpty) {
      final fallback = controller.questionsForCallId(widget.sessionId, callId);
      if (fallback != null) {
        _questions = _parseQuestionList(fallback);
      }
    }

    // No questions parsed yet (args still streaming) — show placeholder, but
    // always offer a Dismiss escape so the agent can never be stuck waiting.
    if (_questions.isEmpty) {
      return Container(
        margin: const EdgeInsets.symmetric(vertical: 6),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          border: Border.all(color: r.accent.withValues(alpha: 0.4)),
          borderRadius: BorderRadius.circular(6),
          color: r.surface,
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                'Waiting for question…',
                style: TextStyle(fontSize: 12, color: r.textMuted),
              ),
            ),
            TextButton(
              onPressed: _dismiss,
              style: TextButton.styleFrom(
                foregroundColor: r.textMuted,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                textStyle: const TextStyle(fontSize: 11),
                minimumSize: const Size(0, 28),
              ),
              child: const Text('Dismiss'),
            ),
          ],
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      decoration: BoxDecoration(
        border: Border.all(color: r.accent.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(8),
        color: r.surface,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header bar
          Container(
            padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
            decoration: BoxDecoration(
              color: r.accentMuted, // primary tint
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(7),
              ),
            ),
            child: Row(
              children: [
                Icon(Icons.help_outline, size: 14, color: r.accent),
                const SizedBox(width: 6),
                Text(
                  'Question',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: r.accent,
                  ),
                ),
              ],
            ),
          ),
          // Question sections
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 10, 10, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var i = 0; i < _questions.length; i++) ...[
                  if (i > 0) const SizedBox(height: 14),
                  _QuestionSection(
                    question: _questions[i],
                    selectedOption: _pending[i],
                    multiSelected: _multiSelected[i] ?? const {},
                    onSelect: (opt) => _selectOption(i, opt),
                    customOpen: _customOpen.contains(i),
                    customController: _questions[i].custom
                        ? _customControllers.putIfAbsent(
                            i,
                            () => TextEditingController(),
                          )
                        : null,
                    onOpenCustom: () => setState(() => _customOpen.add(i)),
                    onCustomChanged: (_) => setState(() {}),
                  ),
                ],
                // Action row: Dismiss (always) + multi-question Submit.
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: _dismiss,
                      style: TextButton.styleFrom(
                        foregroundColor: context.rhythm.textMuted,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        textStyle: const TextStyle(fontSize: 12),
                        minimumSize: const Size(0, 30),
                      ),
                      child: const Text('Dismiss'),
                    ),
                    // Staged submit — shown for multi-select / multi-question /
                    // custom flows (the lone single-select fast path submits on
                    // tap and needs no button, UNTIL its "Other…" field opens,
                    // since typed text has no tap-to-submit). Enabled once every
                    // question has at least one staged answer (option or text).
                    if (!_isFastSingleSelect || _customOpen.isNotEmpty) ...[
                      const SizedBox(width: 8),
                      FilledButton(
                        onPressed: _allStaged ? _submitFromPending : null,
                        style: FilledButton.styleFrom(
                          backgroundColor: r.accent,
                          foregroundColor: r.surface,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 6,
                          ),
                          textStyle: const TextStyle(fontSize: 12),
                        ),
                        child: Text(_submitLabel()),
                      ),
                    ],
                  ],
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
// Sub-widgets
// ---------------------------------------------------------------------------

class _QuestionSection extends StatelessWidget {
  const _QuestionSection({
    required this.question,
    required this.selectedOption,
    required this.multiSelected,
    required this.onSelect,
    required this.customOpen,
    required this.customController,
    required this.onOpenCustom,
    required this.onCustomChanged,
  });

  final _Question question;
  final String? selectedOption;

  /// OCU-06: staged option labels for a multi-select question.
  final Set<String> multiSelected;
  final ValueChanged<String> onSelect;

  /// OCU-06: free-text (`custom`) affordance state.
  final bool customOpen;
  final TextEditingController? customController;
  final VoidCallback onOpenCustom;
  final ValueChanged<String> onCustomChanged;

  bool _isSelected(String option) => question.multiple
      ? multiSelected.contains(option)
      : selectedOption == option;

  @override
  Widget build(BuildContext context) {
    final r = context.rhythm;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (question.header.isNotEmpty) ...[
          Text(
            question.header,
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: r.textMuted,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 4),
        ],
        Text(
          question.question,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w500,
            color: r.textPrimary,
            height: 1.4,
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final option in question.options)
              _OptionButton(
                label: option,
                selected: _isSelected(option),
                onTap: () => onSelect(option),
              ),
            // OCU-06: `custom` free-text affordance — an "Other…" chip that
            // expands into a text field. Hidden entirely when custom=false.
            if (question.custom && !customOpen)
              _OptionButton(
                key: const ValueKey('question-other-chip'),
                label: 'Other…',
                selected: false,
                onTap: onOpenCustom,
              ),
          ],
        ),
        if (question.custom && customOpen) ...[
          const SizedBox(height: 8),
          TextField(
            key: const ValueKey('question-custom-field'),
            controller: customController,
            onChanged: onCustomChanged,
            autofocus: true,
            style: TextStyle(fontSize: 13, color: r.textPrimary),
            decoration: InputDecoration(
              isDense: true,
              hintText: 'Type your answer…',
              hintStyle: TextStyle(fontSize: 13, color: r.textMuted),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 10,
                vertical: 8,
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(6),
                borderSide: BorderSide(color: r.border),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(6),
                borderSide: BorderSide(color: r.border),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _OptionButton extends StatelessWidget {
  const _OptionButton({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final r = context.rhythm;
    if (selected) {
      return FilledButton(
        onPressed: onTap,
        style: FilledButton.styleFrom(
          backgroundColor: r.accent,
          foregroundColor: r.surface,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          textStyle: const TextStyle(fontSize: 12),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        ),
        child: Text(label),
      );
    }
    return OutlinedButton(
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        foregroundColor: r.accent,
        side: BorderSide(color: r.border),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        textStyle: const TextStyle(fontSize: 12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        backgroundColor: r.surface,
      ),
      child: Text(label),
    );
  }
}

class _AnsweredStub extends StatelessWidget {
  const _AnsweredStub({required this.answers});

  final List<String> answers;

  @override
  Widget build(BuildContext context) {
    final r = context.rhythm;
    final display = answers.join(', ');
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: r.accentMuted,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: r.accent.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.check_circle_outline, size: 13, color: r.accent),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Answered: $display',
              style: TextStyle(fontSize: 12, color: r.accent),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Data class
// ---------------------------------------------------------------------------

class _Question {
  const _Question({
    required this.header,
    required this.question,
    required this.options,
    this.multiple = false,
    this.custom = true,
  });

  final String header;
  final String question;
  final List<String> options;

  /// OCU-06: multi-select — 0..n options may be chosen before submitting.
  final bool multiple;

  /// OCU-06: free-text allowed — renders an "Other…" affordance. Default true.
  final bool custom;
}
