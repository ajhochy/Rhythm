/// Acceptance contract for issue #630
/// "Follow-up #622: opencode SDK does not emit 'question' tool events on this build"
///
/// CONTRACT:
///   c1: QuestionToolCard is displayed when part.toolName == 'AskUserQuestion'
///       (the name the opencode SDK actually uses). The dispatch in agents_view.dart
///       must match both 'question' and 'askuserquestion' (case-insensitive).
///
///   c2: QuestionToolCard renders option buttons when options are Map objects
///       ({label, description}) as emitted by the Claude Code SDK — not only
///       when options are bare strings. _parseQuestions must extract 'label'
///       from Map-typed entries.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/views/_question_tool_card.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build a standalone QuestionToolCard with the given toolArgs.
Widget _buildCard({
  required Map<String, dynamic> toolArgs,
  String toolName = 'AskUserQuestion',
}) {
  final part = ChatPart(
    id: 'part-001',
    messageId: 'msg-001',
    type: 'tool',
    toolName: toolName,
    toolArgs: toolArgs,
    toolStatus: 'pending',
  );
  return MaterialApp(
    home: Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: QuestionToolCard(part: part, sessionId: 'sid-test'),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  // -------------------------------------------------------------------------
  // c1 — UNIT: QuestionToolCard._parseQuestions handles AskUserQuestion name
  //
  // The dispatch in agents_view.dart checks part.toolName?.toLowerCase() == 'question'.
  // This test verifies _parseQuestions can parse the args and return non-empty
  // questions when called from a QuestionToolCard with toolName='AskUserQuestion'.
  //
  // The card itself renders if _parseQuestions returns questions — so we test
  // that the card renders its question text (not the "Waiting for question…"
  // placeholder) when the tool args are valid and toolName is 'AskUserQuestion'.
  // -------------------------------------------------------------------------
  group(
    'issue-630-c1: QuestionToolCard dispatched for AskUserQuestion tool name',
    () {
      testWidgets('card renders question text when toolName is AskUserQuestion', (
        tester,
      ) async {
        // This test validates that the agents_view.dart dispatch was broadened
        // to include 'askuserquestion'. Since we can't import agents_view.dart's
        // private dispatch here, we verify the card itself works with the
        // AskUserQuestion args format so that once the dispatch is broadened,
        // the card renders correctly.
        final args = {
          'questions': [
            {
              'header': 'Approach',
              'question': 'Which approach should I use?',
              'options': ['Option A', 'Option B'],
            },
          ],
        };

        await tester.pumpWidget(_buildCard(toolArgs: args));
        await tester.pump();

        // The card must render the question text, not the placeholder.
        expect(
          find.text('Which approach should I use?'),
          findsOneWidget,
          reason:
              'QuestionToolCard must parse and render the question when '
              'toolArgs contains a valid questions array. This confirms the '
              'card is ready to receive AskUserQuestion events once '
              'agents_view.dart broadens its dispatch condition.',
        );

        // Option buttons must also be present.
        expect(
          find.text('Option A'),
          findsOneWidget,
          reason: 'String options must render as buttons.',
        );
      });
    },
  );

  // -------------------------------------------------------------------------
  // c2 — UNIT (STRICT: FAILS today, PASSES after _parseQuestions Map fix)
  //
  // The Claude Code SDK emits options as {label, description} objects, not
  // bare strings. _parseQuestions currently does `if (o is String)` and
  // silently drops Map-typed options. After the fix it must also handle
  // `if (o is Map) options.add(o['label'] as String? ?? '')`.
  // -------------------------------------------------------------------------
  group(
    'issue-630-c2: QuestionToolCard renders object options (label/description maps)',
    () {
      testWidgets(
        'option buttons render when options are {label, description} objects',
        (tester) async {
          final args = {
            'questions': [
              {
                'header': 'Library',
                'question': 'Which library should we use?',
                'options': [
                  {
                    'label': 'Provider',
                    'description': 'Simple and widely used state management',
                  },
                  {
                    'label': 'Riverpod',
                    'description': 'Type-safe and more powerful',
                  },
                ],
              },
            ],
          };

          await tester.pumpWidget(_buildCard(toolArgs: args));
          await tester.pump();

          // THE FAILING ASSERTION (today):
          // _parseQuestions checks `if (o is String)` only. Map options are
          // silently skipped, so options = [] → the Wrap is empty → no buttons.
          //
          // AFTER FIX (`if (o is Map) options.add(o['label'] as String? ?? '')`):
          // Both 'Provider' and 'Riverpod' labels are extracted and rendered.
          expect(
            find.text('Provider'),
            findsOneWidget,
            reason:
                'The "Provider" label must be extracted from {label, description} '
                'option object. Today _parseQuestions only handles String options '
                '(issue #630).',
          );

          expect(
            find.text('Riverpod'),
            findsOneWidget,
            reason:
                'The "Riverpod" label must be extracted from {label, description} '
                'option object.',
          );
        },
      );
    },
  );
}
