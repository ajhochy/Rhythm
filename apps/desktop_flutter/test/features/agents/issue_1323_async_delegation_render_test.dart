import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';

void main() {
  testWidgets(
      'issue-1323-c1: async wake renders as a delegation event rather than a user bubble',
      (tester) async {
    final message = ChatMessage(
      id: 'wake-1',
      sessionId: 'parent-1',
      role: 'user',
      createdAt: DateTime.utc(2026, 8, 10),
    );
    final part = ChatPart(
      id: 'wake-part-1',
      messageId: message.id,
      type: 'text',
      text: '[Async delegation update]\n'
          '- @planning-agent (delegated child session child-1) finished:\nOK\n\n'
          'Incorporate these results into the conversation.\n'
          '<!-- rhythm-async-delegation:msg_rhythm_async_abc123 -->',
    );

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ChatBubbleTestHarness(
          message: message,
          parts: [part],
          sessionId: 'parent-1',
        ),
      ),
    ));

    expect(
        find.byKey(const ValueKey('async-delegation-event')), findsOneWidget);
    expect(find.byKey(const ValueKey('user-message-bubble')), findsNothing);
    expect(find.textContaining('planning-agent'), findsOneWidget);
  });

  testWidgets('issue-1323-c2: async wake hides the internal idempotency marker',
      (tester) async {
    final message = ChatMessage(
      id: 'wake-2',
      sessionId: 'parent-1',
      role: 'user',
      createdAt: DateTime.utc(2026, 8, 10),
    );
    final part = ChatPart(
      id: 'wake-part-2',
      messageId: message.id,
      type: 'text',
      text: '[Async delegation update]\nDone\n'
          '<!-- rhythm-async-delegation:msg_rhythm_async_def456 -->',
    );

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ChatBubbleTestHarness(
          message: message,
          parts: [part],
          sessionId: 'parent-1',
        ),
      ),
    ));

    expect(find.textContaining('rhythm-async-delegation'), findsNothing);
    expect(find.textContaining('Done'), findsOneWidget);
  });
}
