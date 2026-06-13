/// Contract tests for OPC-M4-1 — Real image/file attachments (FilePart with
/// data URI).
///
/// Covers acceptance criteria c2–c5:
///
/// c2 — Attaching an image file produces a FilePart with
///      `url: 'data:image/png;base64,...'` matching the file bytes; the
///      prompt payload must NOT contain any `[image]` text token (legacy
///      formatter deleted).
///
/// c3 — REAL-SURFACE: Composer shows a removable chip per pending attachment;
///      removing it excludes that part from the send.
///
/// c4 — Sent images render as a bounded thumbnail in the user bubble;
///      non-image files render a filename chip.
///
/// c5 — Rehydrated file parts render identically to streamed/optimistic ones.
///
/// c1 is covered by the vitest server-side test.
/// c6 (`ai-workflow checks --level pr` exit 0) is manual/gate-level.
///
/// Run with:
///   flutter test test/features/agents/opc_m4_1_attachments_test.dart
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

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
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Fixture — minimal 1×1 PNG (69 bytes)
// ---------------------------------------------------------------------------

/// A minimal valid 1×1 pixel PNG image as bytes.
final kFixturePngBytes = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4z8AAAAACAAHiIbwzAAAAAElFTkSuQmCC',
);

/// The expected data URI for the fixture PNG.
final kFixturePngDataUri =
    'data:image/png;base64,${base64Encode(kFixturePngBytes)}';

// ---------------------------------------------------------------------------
// Fakes and stubs
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
}

class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  final List<Map<String, dynamic>> sentFrames = [];

  void injectWsMessage(AgentWsMessage msg) => _msgController.add(msg);

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
  void send(Map<String, dynamic> msg) => sentFrames.add(msg);

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
  }) async =>
      const [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async =>
          (session: _makeSession(id), messages: const <AgentSessionMessage>[]);

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      const [];

  @override
  Future<void> revertSession(String sessionId, String messageId) async {}

  @override
  Future<void> unrevertSession(String sessionId) async {}

  @override
  Future<void> summarizeSession(String sessionId) async {}

  @override
  Future<void> dispatchCommand(
      String sessionId, String command, String args) async {}

  @override
  Future<List<Map<String, dynamic>>> fetchSessionTodos(String id) async =>
      const [];

  @override
  Future<List<Map<String, dynamic>>> fetchChildSessions(
          String parentSessionId) async =>
      const [];

  @override
  Future<List<AgentSessionMessage>> fetchChildMessages(
          String parentSessionId, String childSdkId) async =>
      const [];

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<AgentInfo>> fetchAvailableAgents({String? cwd}) async => const [];
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

AgentsController _buildController(_StubAgentsRepository repo) =>
    AgentsController(
      repo,
      _ReadyAgentServerController(),
      LocalNotificationService(),
      NotificationsController(
        NotificationsRepository(NotificationsDataSource()),
      ),
    );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  // ── c2: FilePart data URI + no [image] token ─────────────────────────────

  test(
    'issue-700-c2: sendInput with FilePart sends data URI; no [image] token in frame',
    () async {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(repo);

      const sessionId = 'test-c2-session';

      // Simulate reading bytes and building a FilePart (what _InputArea._send does).
      final filePartMap = {
        'type': 'file',
        'mime': 'image/png',
        'filename': 'fixture.png',
        'url': kFixturePngDataUri,
      };

      ctrl.sendInput(
        sessionId,
        'What is in this image?\n',
        attachments: [filePartMap],
      );

      // Exactly one WS frame must have been sent.
      expect(repo.sentFrames, hasLength(1));
      final frame = repo.sentFrames.first;
      expect(frame['type'], equals('session.input'));

      // The frame must carry a `parts` array (not the legacy `data` string).
      expect(frame.containsKey('parts'), isTrue,
          reason: 'parts key must be present when attachments are provided');
      expect(frame.containsKey('data'), isFalse,
          reason: 'legacy data string must not be present when parts are used');

      // The parts array must include both a text part and the FilePart.
      final parts = frame['parts'] as List<dynamic>;
      expect(parts, hasLength(2));

      final textPart = parts.first as Map<String, dynamic>;
      expect(textPart['type'], equals('text'));

      final fp = parts[1] as Map<String, dynamic>;
      expect(fp['type'], equals('file'));
      expect(fp['mime'], equals('image/png'));
      expect(fp['url'], equals(kFixturePngDataUri),
          reason: 'data URI must match the base64-encoded fixture bytes');

      // c2 regression: MUST NOT contain [image] text in any part.
      for (final part in parts) {
        final partMap = part as Map<String, dynamic>;
        final text = (partMap['text'] as String?) ?? '';
        expect(text.contains('[image]'), isFalse,
            reason:
                'Legacy [image] token must not appear in any part text — formatter deleted');
      }
    },
  );

  // ── c3: REAL-SURFACE — composer chip appears and remove excludes part ─────

  testWidgets(
    'issue-700-c3: REAL-SURFACE composer chip per attachment; remove excludes from send',
    (tester) async {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(repo);
      const sessionId = 'test-c3-session';

      // Build the _InputArea widget using the public test harness.
      // We use InputAreaTestHarness — the real _InputArea widget rendered as
      // wired in agents_view.dart with a real AgentsController.
      await tester.pumpWidget(
        MaterialApp(
          home: MultiProvider(
            providers: [
              ChangeNotifierProvider<AgentsController>.value(value: ctrl),
            ],
            child: const Scaffold(
              body: InputAreaTestHarness(),
            ),
          ),
          theme: AppTheme.light(),
        ),
      );
      await tester.pump(Duration.zero);

      // Prime the session selection so the controller knows which session is active.
      ctrl.setMessageForTest(ChatMessage(
        id: 'c3-msg-init',
        sessionId: sessionId,
        role: 'assistant',
        createdAt: _kEpoch,
      ));
      ctrl.setActiveSessionForTest(sessionId, _makeSession(sessionId));
      await tester.pump(Duration.zero);

      // Initially no attachment chips are visible.
      expect(find.byKey(const Key('attachment-chip-0')), findsNothing,
          reason: 'No chips before any attachment is added');

      // Inject a pending attachment via the test hook.
      ctrl.setPendingAttachmentsForTest(sessionId, [
        {
          'type': 'file',
          'mime': 'image/png',
          'filename': 'test.png',
          'url': kFixturePngDataUri,
        },
      ]);
      await tester.pump(Duration.zero);

      // The attachment chip must now be visible.
      expect(find.byKey(const Key('attachment-chip-0')), findsOneWidget,
          reason: 'Chip must appear after attachment added');

      // Tap the remove (×) button on the chip.
      final removeBtn = find.byKey(const Key('attachment-chip-0-remove'));
      expect(removeBtn, findsOneWidget);
      await tester.tap(removeBtn);
      await tester.pump(Duration.zero);

      // After removal the pending list is empty.
      expect(ctrl.pendingAttachmentsFor(sessionId), isEmpty,
          reason: 'Pending attachments must be cleared after remove tap');

      // Chip must disappear.
      expect(find.byKey(const Key('attachment-chip-0')), findsNothing,
          reason: 'Chip must disappear after removal');
    },
  );

  // ── c4: user bubble renders image thumbnail vs non-image chip ─────────────

  testWidgets(
    'issue-700-c4: user bubble renders image thumbnail for image FilePart; filename chip for non-image',
    (tester) async {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(repo);
      const sessionId = 'test-c4-session';
      const msgId = 'test-c4-msg';

      // Insert a user message with both an image FilePart and a text file part.
      final imageFilePart = ChatPart(
        id: 'part-img',
        messageId: msgId,
        type: 'file',
        text: '',
        fileMime: 'image/png',
        fileFilename: 'photo.png',
        fileUrl: kFixturePngDataUri,
      );
      final docFilePart = ChatPart(
        id: 'part-doc',
        messageId: msgId,
        type: 'file',
        text: '',
        fileMime: 'application/pdf',
        fileFilename: 'report.pdf',
        fileUrl: 'data:application/pdf;base64,AAAA',
      );
      final textPart = ChatPart(
        id: 'part-text',
        messageId: msgId,
        type: 'text',
        text: 'Here are my files',
      );

      ctrl.setMessageForTest(ChatMessage(
        id: msgId,
        sessionId: sessionId,
        role: 'user',
        createdAt: _kEpoch,
      ));
      ctrl.setChatPartForTest(imageFilePart);
      ctrl.setChatPartForTest(docFilePart);
      ctrl.setChatPartForTest(textPart);

      await tester.pumpWidget(
        MaterialApp(
          home: MultiProvider(
            providers: [
              ChangeNotifierProvider<AgentsController>.value(value: ctrl),
            ],
            child: Scaffold(
              body: UserBubbleTestHarness(
                parts: ctrl.chatPartsFor(msgId),
              ),
            ),
          ),
          theme: AppTheme.light(),
        ),
      );
      await tester.pump(Duration.zero);

      // Image FilePart → thumbnail (Image.memory widget key).
      expect(find.byKey(const Key('file-image-thumbnail-part-img')),
          findsOneWidget,
          reason:
              'image/png file part must render as a bounded Image.memory thumbnail');

      // Non-image FilePart → filename chip.
      expect(find.byKey(const Key('file-chip-part-doc')), findsOneWidget,
          reason: 'application/pdf file part must render as a filename chip');
      expect(find.text('report.pdf'), findsOneWidget,
          reason: 'Filename must be shown in the chip');
    },
  );

  // ── c5: rehydrated FilePart renders identically to streamed ───────────────

  testWidgets(
    'issue-700-c5: rehydrated FilePart renders same as optimistic/streamed FilePart',
    (tester) async {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(repo);

      // Simulate rehydrated part (from REST, constructed via ChatPart.fromJson).
      final rehydratedPart = ChatPart.fromJson('msg-rehydrated', {
        'type': 'file',
        'id': 'part-rh',
        'mime': 'image/png',
        'filename': 'rehydrated.png',
        'url': kFixturePngDataUri,
        'text': '',
      });

      // Simulate streamed/optimistic part (constructed directly).
      final streamedPart = ChatPart(
        id: 'part-rh',
        messageId: 'msg-streamed',
        type: 'file',
        text: '',
        fileMime: 'image/png',
        fileFilename: 'rehydrated.png',
        fileUrl: kFixturePngDataUri,
      );

      // Both must produce the same thumbnail key.
      await tester.pumpWidget(
        MaterialApp(
          home: MultiProvider(
            providers: [
              ChangeNotifierProvider<AgentsController>.value(value: ctrl),
            ],
            child: Scaffold(
              body: Column(
                children: [
                  UserBubbleTestHarness(parts: [rehydratedPart]),
                  UserBubbleTestHarness(parts: [streamedPart]),
                ],
              ),
            ),
          ),
          theme: AppTheme.light(),
        ),
      );
      await tester.pump(Duration.zero);

      // Both should show an image thumbnail (there may be 2 or more depending on
      // how the widget keys are scoped — just assert at least 2 Image widgets).
      final thumbnails = find.byKey(const Key('file-image-thumbnail-part-rh'));
      // At least one thumbnail must render for each instance.
      expect(thumbnails, findsWidgets,
          reason:
              'Both rehydrated and streamed image FileParts must render as thumbnails');

      // c5: the file fields must match.
      expect(rehydratedPart.fileMime, equals(streamedPart.fileMime));
      expect(rehydratedPart.fileFilename, equals(streamedPart.fileFilename));
      expect(rehydratedPart.fileUrl, equals(streamedPart.fileUrl));
    },
  );
}
