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

  // For multi-question flows: track the selected option per question index
  // before submitting the whole batch.
  final Map<int, String> _pending = {};

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
      if (question.isNotEmpty) {
        out.add(
            _Question(header: header, question: question, options: options));
      }
    }
    return out;
  }

  void _selectOption(int qIdx, String option) {
    if (_questions.length == 1) {
      // Single question — submit immediately on tap.
      _submit([
        [option]
      ], displayLabels: [
        option
      ]);
    } else {
      // Multi-question — stage the selection; submit when all answered.
      setState(() {
        _pending[qIdx] = option;
        if (_pending.length == _questions.length) {
          _submitFromPending();
        }
      });
    }
  }

  void _submitFromPending() {
    final answers = <List<String>>[
      for (var i = 0; i < _questions.length; i++) [_pending[i] ?? ''],
    ];
    final display = <String>[
      for (var i = 0; i < _questions.length; i++)
        '${_questions[i].header.isNotEmpty ? "${_questions[i].header}: " : ""}'
            '${_pending[i] ?? ""}',
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
      _controller(context, listen: false)
          ?.replyQuestion(widget.sessionId, callId, answers);
    }
    setState(() => _answers = displayLabels);
  }

  /// Dismiss the question without answering — also unblocks the agent so the
  /// session can never get stuck on an unanswered question.
  void _dismiss() {
    final callId = widget.part.toolCallId;
    if (callId != null && callId.isNotEmpty) {
      _controller(context, listen: false)
          ?.rejectQuestion(widget.sessionId, callId);
    }
    setState(() => _answers = ['Dismissed']);
  }

  @override
  Widget build(BuildContext context) {
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
          border:
              Border.all(color: const Color(0xFF4F6AF5).withValues(alpha: 0.4)),
          borderRadius: BorderRadius.circular(6),
          color: Colors.white,
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                'Waiting for question…',
                style: TextStyle(fontSize: 12, color: context.rhythm.textMuted),
              ),
            ),
            TextButton(
              onPressed: _dismiss,
              style: TextButton.styleFrom(
                foregroundColor: context.rhythm.textMuted,
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
        border:
            Border.all(color: const Color(0xFF4F6AF5).withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(8),
        color: Colors.white,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header bar
          Container(
            padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
            decoration: const BoxDecoration(
              color: Color(0x144F6AF5), // primary tint
              borderRadius: BorderRadius.vertical(top: Radius.circular(7)),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.help_outline,
                  size: 14,
                  color: Color(0xFF4F6AF5),
                ),
                const SizedBox(width: 6),
                Text(
                  'Question',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: Color(0xFF4F6AF5),
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
                    onSelect: (opt) => _selectOption(i, opt),
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
                    // Multi-question submit — enabled once every question has a
                    // staged selection.
                    if (_questions.length > 1) ...[
                      const SizedBox(width: 8),
                      FilledButton(
                        onPressed: _pending.length == _questions.length
                            ? _submitFromPending
                            : null,
                        style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFF4F6AF5),
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(
                              horizontal: 14, vertical: 6),
                          textStyle: const TextStyle(fontSize: 12),
                        ),
                        child: Text(
                          'Submit (${_pending.length}/${_questions.length})',
                        ),
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
    required this.onSelect,
  });

  final _Question question;
  final String? selectedOption;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (question.header.isNotEmpty) ...[
          Text(
            question.header,
            style: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: Color(0xFF9CA3AF), // textMuted
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 4),
        ],
        Text(
          question.question,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w500,
            color: Color(0xFF111827), // textPrimary
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
                selected: selectedOption == option,
                onTap: () => onSelect(option),
              ),
          ],
        ),
      ],
    );
  }
}

class _OptionButton extends StatelessWidget {
  const _OptionButton({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    if (selected) {
      return FilledButton(
        onPressed: onTap,
        style: FilledButton.styleFrom(
          backgroundColor: const Color(0xFF4F6AF5),
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          textStyle: const TextStyle(fontSize: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(6),
          ),
        ),
        child: Text(label),
      );
    }
    return OutlinedButton(
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        foregroundColor: const Color(0xFF4F6AF5),
        side: const BorderSide(color: Color(0xFFE5E7EB)),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        textStyle: const TextStyle(fontSize: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(6),
        ),
        backgroundColor: Colors.white,
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
    final display = answers.join(', ');
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0x144F6AF5),
        borderRadius: BorderRadius.circular(6),
        border:
            Border.all(color: const Color(0xFF4F6AF5).withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.check_circle_outline,
            size: 13,
            color: Color(0xFF4F6AF5),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Answered: $display',
              style: const TextStyle(
                fontSize: 12,
                color: Color(0xFF4F6AF5),
              ),
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
  });

  final String header;
  final String question;
  final List<String> options;
}
