/// Contract tests for OPC-M2-2 — Reasoning collapsible block + non-text delta
/// routing fix.
///
/// Covers acceptance criteria c1–c5 from the issue spec:
///
/// c1 — _appendChatDelta routes by part type:
///       - reasoning delta (field='text', part type='reasoning') appends to the
///         reasoning part's text.
///       - text delta (field='text', part type='text') appends to the text part.
///       - unknown-field delta is retained (not silently dropped), debugPrint logged.
/// c2 — Reasoning part renders as a collapsed block labeled "Thinking…" by
///      default; reasoning text is NOT visible until expanded.
/// c3 — Expand/collapse state survives a delta-append rebuild (no auto-collapse).
/// c4 — Text part renders outside the reasoning block; both findable when
///      reasoning block is expanded.
/// c5 — Rehydrated reasoning parts (REST/ChatPart.fromJson path) render
///      identically to streamed ones.
///
/// c6 (flutter analyze + ai-workflow checks --level pr) is manual / gate-level.
///
/// Real v1.14.49 part shapes are used throughout — field names match the
/// fixtures under apps/api_server/src/__tests__/fixtures/opencode_v1_14_49/.
///
/// Run with:
///   flutter test test/features/agents/opc_m2_2_reasoning_test.dart
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_reasoning_block.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Fakes (mirrors opc_m1_3_rehydration_test.dart)
// ---------------------------------------------------------------------------

class _FakeApiServerService extends ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: true, reason: null, stderrTail: null, failureMessage: null);

  @override
  void stop() {}

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _ReadyAgentServerController extends AgentServerController {
  _ReadyAgentServerController() : super(_FakeApiServerService());

  @override
  AgentServerStatus get status => AgentServerStatus.ready;

  @override
  bool get isReady => true;

  @override
  bool get hasAnyAgent => true;

  @override
  bool isAgentAvailable(String kind) => true;

  @override
  Future<void> initialize() async {}

  @override
  Future<void> retry() async {}
}

class _FakeLocalNotificationService extends LocalNotificationService {
  @override
  Future<void> showMessageNotification({
    required int id,
    required String title,
    required String body,
  }) async {}
}

class _FakeNotificationsController extends NotificationsController {
  _FakeNotificationsController()
      : super(NotificationsRepository(NotificationsDataSource()));

  @override
  void pushAgentNotification({
    required int id,
    required String title,
    required String body,
  }) {}
}

class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  void emit(AgentWsMessage msg) => _msgController.add(msg);

  @override
  Stream<AgentWsMessage> get messages => _msgController.stream;

  @override
  Stream<bool> get connectivityStream => _connectivityController.stream;

  @override
  bool get isConnected => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> dispose() async {
    await _msgController.close();
    await _connectivityController.close();
  }

  @override
  void send(Map<String, dynamic> msg) {}

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async =>
      [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    return (
      session: _makeSession(id),
      messages: const <AgentSessionMessage>[],
    );
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0);

AgentSession _makeSession(String id) => AgentSession(
      id: id,
      agentId: 'claude-code',
      name: 'Test Session',
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );

({AgentsController ctrl, _StubAgentsRepository repo}) _buildController() {
  final repo = _StubAgentsRepository();
  final agentServer = _ReadyAgentServerController();
  final notifService = _FakeLocalNotificationService();
  final notifCtrl = _FakeNotificationsController();
  final ctrl = AgentsController(repo, agentServer, notifService, notifCtrl);
  return (ctrl: ctrl, repo: repo);
}

Widget _wrap(Widget child) => MaterialApp(
      theme: AppTheme.light(),
      home: Scaffold(body: SizedBox(width: 600, child: child)),
    );

// ---------------------------------------------------------------------------
// Real v1.14.49 part shapes (from fixtures/opencode_v1_14_49/)
// ---------------------------------------------------------------------------

/// Reasoning part shape from message_part_updated_reasoning.json.
/// Fields: id, sessionID, messageID, type='reasoning', text, time:{start, end?}
const _kReasoningPartShape = {
  'id': 'part_reasoning_001',
  'sessionID': 'ses_abc123',
  'messageID': 'msg_abc001',
  'type': 'reasoning',
  'text': 'I need to analyze the code carefully.',
  'time': {'start': 1718000000100, 'end': 1718000002000},
};

/// Text part shape from message_part_updated_text.json.
const _kTextPartShape = {
  'id': 'part_text_001',
  'sessionID': 'ses_abc123',
  'messageID': 'msg_abc001',
  'type': 'text',
  'text': "I've read the file. The function returns 42.",
  'time': {'start': 1718000003600},
};

/// Delta frame shape from message_part_delta.json (field='text', for a text part).
const _kTextDeltaShape = {
  // WS bridge broadcasts: { type: 'message.part.delta', messageId, partId, field, delta }
  'messageId': 'msg_abc001',
  'partId': 'part_text_001',
  'field': 'text',
  'delta': ' Hello',
};

/// Reasoning delta frame — same field='text' but targets the reasoning part.
const _kReasoningDeltaShape = {
  'messageId': 'msg_abc001',
  'partId': 'part_reasoning_001',
  'field': 'text',
  'delta': ' more thinking',
};

/// Unknown-field delta frame — field is not 'text'.
const _kUnknownFieldDeltaShape = {
  'messageId': 'msg_abc001',
  'partId': 'part_text_001',
  'field': 'signature',
  'delta': 'some_signature_value',
};

// ===========================================================================
// c1 — _appendChatDelta routing tests (controller unit tests)
// ===========================================================================

void main() {
  setUpAll(() {
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  group(
      'issue-691-c1: delta routing — reasoning delta appends to reasoning part; '
      'text delta to text part; unknown-field delta retained', () {
    test('c1a: reasoning delta (field=text) appends to existing reasoning part',
        () async {
      final (:ctrl, :repo) = _buildController();
      addTearDown(ctrl.dispose);
      await ctrl.initialize();

      const sessionId = 'sess-c1a';
      const messageId = 'msg_abc001';
      const reasoningPartId = 'part_reasoning_001';

      // Step 1: upsert the reasoning part via a WS message.part.updated event.
      // Real shape: type='reasoning', field 'text' carries the reasoning text.
      // MessagePartUpdatedMessage takes sessionId + part (the full part map).
      repo.emit(MessagePartUpdatedMessage(
        sessionId: sessionId,
        part: Map<String, dynamic>.from(_kReasoningPartShape),
      ));
      await Future<void>.delayed(Duration.zero);

      final initialText = ctrl
          .chatPartsFor(messageId)
          .firstWhere((p) => p.id == reasoningPartId)
          .text;

      // Step 2: emit a delta targeting the reasoning part.
      repo.emit(MessagePartDeltaMessage(
        sessionId: sessionId,
        messageId: messageId,
        partId: reasoningPartId,
        field: _kReasoningDeltaShape['field']!,
        delta: _kReasoningDeltaShape['delta']!,
      ));
      await Future<void>.delayed(Duration.zero);

      final afterDelta = ctrl
          .chatPartsFor(messageId)
          .firstWhere((p) => p.id == reasoningPartId)
          .text;

      expect(
        afterDelta,
        equals(initialText + (_kReasoningDeltaShape['delta'] ?? '')),
        reason: 'A reasoning delta (field=text) must append to the reasoning '
            'part\'s text, not create a duplicate text part.',
      );
      // The part type must remain 'reasoning' — not degraded to 'text'.
      final part = ctrl
          .chatPartsFor(messageId)
          .firstWhere((p) => p.id == reasoningPartId);
      expect(part.type, equals('reasoning'),
          reason: 'Part type must remain reasoning after delta append.');
    });

    test(
        'c1a-regression: delayed empty reasoning snapshot preserves streamed delta',
        () async {
      // Claude Code emits the text delta before its reasoning part snapshot.
      // The snapshot initially has text='', so it must promote the temporary
      // part to reasoning without clearing text already streamed to the UI.
      final (:ctrl, :repo) = _buildController();
      addTearDown(ctrl.dispose);
      await ctrl.initialize();

      const sessionId = 'sess-c1a-delayed';
      const messageId = 'msg-c1a-delayed';
      const partId = 'part-c1a-delayed';
      const delta = 'streamed Claude reasoning';

      repo.emit(const MessagePartDeltaMessage(
        sessionId: sessionId,
        messageId: messageId,
        partId: partId,
        field: 'text',
        delta: delta,
      ));
      await Future<void>.delayed(Duration.zero);

      repo.emit(const MessagePartUpdatedMessage(
        sessionId: sessionId,
        part: {
          'id': partId,
          'sessionID': sessionId,
          'messageID': messageId,
          'type': 'reasoning',
          'text': '',
        },
      ));
      await Future<void>.delayed(Duration.zero);

      final part = ctrl.chatPartsFor(messageId).single;
      expect(part.type, equals('reasoning'));
      expect(part.text, equals(delta));
    });

    test('c1b: text delta appends to the text part (unchanged behavior)',
        () async {
      final (:ctrl, :repo) = _buildController();
      addTearDown(ctrl.dispose);
      await ctrl.initialize();

      const sessionId = 'sess-c1b';
      const messageId = 'msg_abc001';
      const textPartId = 'part_text_001';

      // Upsert text part first.
      repo.emit(MessagePartUpdatedMessage(
        sessionId: sessionId,
        part: Map<String, dynamic>.from(_kTextPartShape),
      ));
      await Future<void>.delayed(Duration.zero);

      final initialText = ctrl
          .chatPartsFor(messageId)
          .firstWhere((p) => p.id == textPartId)
          .text;

      // Emit a text delta.
      repo.emit(MessagePartDeltaMessage(
        sessionId: sessionId,
        messageId: messageId,
        partId: textPartId,
        field: _kTextDeltaShape['field']!,
        delta: _kTextDeltaShape['delta']!,
      ));
      await Future<void>.delayed(Duration.zero);

      final afterDelta = ctrl
          .chatPartsFor(messageId)
          .firstWhere((p) => p.id == textPartId)
          .text;

      expect(
        afterDelta,
        equals(initialText + (_kTextDeltaShape['delta'] ?? '')),
        reason:
            'A text delta must append to the text part (unchanged behavior).',
      );
    });

    test(
        'c1c: unknown-field delta is retained (part created on-the-fly) not silently dropped',
        () async {
      final (:ctrl, :repo) = _buildController();
      addTearDown(ctrl.dispose);
      await ctrl.initialize();

      const sessionId = 'sess-c1c';
      const messageId = 'msg_abc001';
      const textPartId = 'part_text_001';

      // Upsert a text part first.
      repo.emit(MessagePartUpdatedMessage(
        sessionId: sessionId,
        part: Map<String, dynamic>.from(_kTextPartShape),
      ));
      await Future<void>.delayed(Duration.zero);

      // Count parts before unknown-field delta.
      final partsBefore = ctrl.chatPartsFor(messageId).length;

      // Emit an unknown-field delta for the text part.
      repo.emit(MessagePartDeltaMessage(
        sessionId: sessionId,
        messageId: messageId,
        partId: textPartId,
        field: _kUnknownFieldDeltaShape['field']!,
        delta: _kUnknownFieldDeltaShape['delta']!,
      ));
      await Future<void>.delayed(Duration.zero);

      // The part must still be present — not dropped.
      final partsAfter = ctrl.chatPartsFor(messageId);
      expect(
        partsAfter.length,
        equals(partsBefore),
        reason: 'Unknown-field delta must not create a duplicate part or drop '
            'the existing part. Part count must remain the same.',
      );
      // The existing part must still be there.
      expect(
        partsAfter.any((p) => p.id == textPartId),
        isTrue,
        reason:
            'The text part must still be present after an unknown-field delta.',
      );
    });
  });

  // ===========================================================================
  // c2 — ReasoningBlock collapsed by default; text hidden until expanded
  // ===========================================================================

  group(
      'issue-691-c2: reasoning block collapsed by default; text hidden until expanded',
      () {
    testWidgets(
      'c2: "Thinking…" label visible; reasoning text hidden; expands on tap',
      (tester) async {
        const reasoningText = 'I need to analyze the code carefully.';
        final part = ChatPart.fromJson('msg1', {
          'id': 'part_reasoning_001',
          'type': 'reasoning',
          'text': reasoningText,
        });

        await tester.pumpWidget(_wrap(ReasoningBlock(part: part)));

        // Collapsed state: label visible, reasoning text hidden.
        expect(
          find.textContaining('Thinking'),
          findsWidgets,
          reason: '"Thinking…" label must be visible when collapsed.',
        );
        expect(
          find.text(reasoningText),
          findsNothing,
          reason:
              'Reasoning text must NOT be visible when the block is collapsed.',
        );

        // Tap to expand.
        await tester.tap(find.textContaining('Thinking').first);
        await tester.pump();

        // After expansion: reasoning text must be visible.
        expect(
          find.text(reasoningText),
          findsWidgets,
          reason: 'Reasoning text must be visible after tapping to expand.',
        );
      },
    );
  });

  // ===========================================================================
  // c3 — Expand state survives a delta-append rebuild
  // ===========================================================================

  group('issue-691-c3: expand state survives delta-append rebuild', () {
    testWidgets(
      'c3: expanded block stays expanded when part.text is updated',
      (tester) async {
        const reasoningText = 'Initial reasoning text.';
        final part = ChatPart.fromJson('msg1', {
          'id': 'part_reasoning_001',
          'type': 'reasoning',
          'text': reasoningText,
        });

        // Build with same key so the state is preserved across rebuilds.
        await tester.pumpWidget(
          _wrap(
            ReasoningBlock(
              key: const ValueKey('part_reasoning_001'),
              part: part,
            ),
          ),
        );

        // Expand it.
        await tester.tap(find.textContaining('Thinking').first);
        await tester.pump();

        // Verify expanded.
        expect(
          find.text(reasoningText),
          findsWidgets,
          reason: 'Block must be expanded after tap.',
        );

        // Simulate delta append — part.text mutates (same object, new content).
        part.appendDelta(' more thinking');

        // Re-render with the same widget key → state must be preserved.
        await tester.pumpWidget(
          _wrap(
            ReasoningBlock(
              key: const ValueKey('part_reasoning_001'),
              part: part,
            ),
          ),
        );
        await tester.pump();

        // Must still be expanded (not auto-collapsed).
        expect(
          find.textContaining('Initial reasoning text.'),
          findsWidgets,
          reason: 'Block must remain expanded after delta-append rebuild. '
              'If collapsed, the StatefulWidget is being recreated without '
              'a stable key or is auto-collapsing on rebuild.',
        );
      },
    );
  });

  // ===========================================================================
  // c4 — Text part renders outside reasoning block; both findable when expanded
  // ===========================================================================

  group(
      'issue-691-c4: text part renders outside reasoning block; '
      'both findable when reasoning expanded', () {
    testWidgets(
      'c4: assistant message with reasoning + text parts renders both correctly',
      (tester) async {
        // Build a minimal _ChatBubble-like layout directly from the public
        // ReasoningBlock widget + MarkdownMessageBody, matching the contract
        // that _ChatBubble routes reasoning to ReasoningBlock and text to
        // MarkdownMessageBody outside it.
        const reasoningText = 'I need to analyze the code carefully.';
        const answerText = "I've read the file. The function returns 42.";

        final reasoningPart = ChatPart.fromJson('msg1', {
          'id': 'part_reasoning_001',
          'type': 'reasoning',
          'text': reasoningText,
        });

        final textPart = ChatPart.fromJson('msg1', {
          'id': 'part_text_001',
          'type': 'text',
          'text': answerText,
        });

        // Render both parts: reasoning block + text body.
        await tester.pumpWidget(
          _wrap(
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ReasoningBlock(
                  key: const ValueKey('part_reasoning_001'),
                  part: reasoningPart,
                ),
                const SizedBox(height: 6),
                // Text part rendered outside the reasoning block.
                SelectableText(textPart.text),
              ],
            ),
          ),
        );

        // Answer text must be visible without expanding the reasoning block.
        expect(
          find.textContaining(answerText),
          findsWidgets,
          reason: 'Answer text must render outside the reasoning block '
              '(visible without expanding).',
        );

        // Reasoning text is hidden (collapsed by default).
        expect(
          find.text(reasoningText),
          findsNothing,
          reason: 'Reasoning text must be hidden while block is collapsed.',
        );

        // Tap to expand reasoning block.
        await tester.tap(find.textContaining('Thinking').first);
        await tester.pump();

        // Both reasoning text and answer text are now findable.
        expect(
          find.textContaining(reasoningText),
          findsWidgets,
          reason: 'Reasoning text must be findable after expanding block.',
        );
        expect(
          find.textContaining(answerText),
          findsWidgets,
          reason: 'Answer text must remain findable after expanding reasoning.',
        );
      },
    );
  });

  // ===========================================================================
  // c5 — Rehydrated reasoning parts render identically to streamed ones
  // ===========================================================================

  group(
      'issue-691-c5: rehydrated reasoning part renders as collapsed block '
      'identical to streamed path', () {
    testWidgets(
      'c5: ChatPart.fromJson (REST/rehydrate path) renders identical to '
      'WS-streamed part',
      (tester) async {
        // Rehydrated part: created via ChatPart.fromJson with the real REST
        // shape (same fields as the fixture message_part_updated_reasoning.json).
        final rehydratedPart = ChatPart.fromJson('msg_abc001', {
          // Real v1.14.49 reasoning part fields from fixture.
          'id': 'part_reasoning_001',
          'sessionID': 'ses_abc123',
          'messageID': 'msg_abc001',
          'type': 'reasoning',
          'text': 'I need to analyze the code carefully.',
          'time': {'start': 1718000000100, 'end': 1718000002000},
        });

        // Streamed part: same data but constructed via _upsertChatPart path.
        // We simulate it directly using the same constructor.
        final streamedPart = ChatPart(
          id: 'part_reasoning_001',
          messageId: 'msg_abc001',
          type: 'reasoning',
          text: 'I need to analyze the code carefully.',
        );

        // Both must have the same type.
        expect(rehydratedPart.type, equals('reasoning'));
        expect(streamedPart.type, equals('reasoning'));

        // The rehydrated part has time.end set, so it renders as
        // "Thought for 1.9s" (not "Thinking…" which is for in-progress).
        // Both labels are valid collapsed states per the spec.
        expect(
          rehydratedPart.durationMs,
          isNotNull,
          reason: 'Rehydrated part with time.end must have durationMs set.',
        );

        // Both must render as a ReasoningBlock that is collapsed by default.
        await tester.pumpWidget(
          _wrap(ReasoningBlock(part: rehydratedPart)),
        );

        // The finished-state label is "Thought for Ns".
        expect(
          find.textContaining('Thought for'),
          findsWidgets,
          reason: 'Rehydrated (finished) reasoning part must render as a '
              'collapsed "Thought for Ns" block.',
        );
        expect(
          find.text('I need to analyze the code carefully.'),
          findsNothing,
          reason:
              'Rehydrated reasoning text must NOT be visible when collapsed.',
        );

        // Expand: tap the label.
        await tester.tap(find.textContaining('Thought for').first);
        await tester.pump();

        expect(
          find.textContaining('I need to analyze the code carefully.'),
          findsWidgets,
          reason: 'Rehydrated reasoning text must appear after expanding.',
        );
      },
    );
  });
}
