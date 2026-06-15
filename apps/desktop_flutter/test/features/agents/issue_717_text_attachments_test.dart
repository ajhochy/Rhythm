/// Issue #717 — Text file attachments must be sent as readable text parts.
///
/// Acceptance criteria:
///   c1 — Text-like attachments (type='text' with filename + text content)
///        are sent in the WS parts array as text parts (type='text') so the
///        model can read their content.
///   c2 — The optimistic user bubble shows a filename chip (type='file' with
///        no url) for text-type attachments, NOT prose.
///   c3 — Image attachments still produce a FilePart with a data URI.
///   c4 — The filename is preserved in the text attachment map and in the
///        optimistic ChatPart so the chip shows the correct name.
library;

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';

import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Stubs (mirrors those in opc_m4_1_attachments_test.dart)
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
  // ── c1: text attachment is forwarded as a text part in the WS frame ────────
  test(
    'issue-717-c1: text-type attachment is included in parts array as type=text',
    () {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(repo);
      const sessionId = 'test-717-c1';

      final textAttachment = {
        'type': 'text',
        'filename': 'server.log',
        'mime': 'text/plain',
        'text': '2026-06-01 ERROR: Connection refused\n',
      };

      ctrl.sendInput(
        sessionId,
        'Can you check this log?\n',
        attachments: [textAttachment],
      );

      expect(repo.sentFrames, hasLength(1));
      final frame = repo.sentFrames.first;
      expect(frame['type'], equals('session.input'));

      // Must use parts array (not legacy data string).
      expect(frame.containsKey('parts'), isTrue,
          reason: 'parts key required when attachments are present');
      expect(frame.containsKey('data'), isFalse,
          reason: 'legacy data key must be absent when parts are used');

      final parts = frame['parts'] as List<dynamic>;
      // Text part from the user message + the text attachment.
      expect(parts.length, greaterThanOrEqualTo(2));

      // The text attachment must appear with type='text' and the file content.
      final matchingParts = parts
          .cast<Map<String, dynamic>>()
          .where((p) =>
              p['type'] == 'text' &&
              (p['text'] as String?)?.contains('Connection refused') == true)
          .toList();
      expect(matchingParts, isNotEmpty,
          reason: 'WS frame must include the file content as a text part');
      expect(
          (matchingParts.first['text'] as String)
              .contains('Connection refused'),
          isTrue);

      // No FilePart with application/octet-stream in the frame.
      for (final p in parts) {
        final partMap = p as Map<String, dynamic>;
        expect(partMap['mime'], isNot(equals('application/octet-stream')),
            reason: 'octet-stream must never reach the model');
      }
    },
  );

  // ── c2: optimistic user bubble shows filename chip, not prose ─────────────
  test(
    'issue-717-c2: optimistic ChatPart for text attachment has type=file with no url',
    () {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(repo);
      const sessionId = 'test-717-c2';

      ctrl.setActiveSessionForTest(sessionId, _makeSession(sessionId));

      final textAttachment = {
        'type': 'text',
        'filename': 'debug.log',
        'mime': 'text/plain',
        'text': 'INFO: startup complete\n',
      };

      ctrl.sendInput(
        sessionId,
        'Here is the log:\n',
        attachments: [textAttachment],
      );

      // Find the optimistic message.
      final messages = ctrl.chatMessagesFor(sessionId);
      expect(messages, isNotEmpty);
      final lastMsg = messages.last;
      expect(lastMsg.role, equals('user'));

      final parts = ctrl.chatPartsFor(lastMsg.id);
      // Should have a text part (user prose) + a file chip for the attachment.
      final fileParts = parts.where((p) => p.type == 'file').toList();
      expect(fileParts, hasLength(1),
          reason:
              'One filename chip must appear in the optimistic user bubble');

      final chip = fileParts.first;
      expect(chip.fileFilename, equals('debug.log'),
          reason: 'Filename must be preserved in the optimistic chip');
      expect(chip.fileUrl, isNull,
          reason: 'Text attachments must not produce a data URI in the chip — '
              'the model reads the text content from the parts array');
    },
  );

  // ── c3: image attachment still produces a FilePart with data URI ──────────
  test(
    'issue-717-c3: image attachment still sends type=file with data URI',
    () {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(repo);
      const sessionId = 'test-717-c3';

      const dataUri = 'data:image/png;base64,iVBORw0KGgo=';
      final imageAttachment = {
        'type': 'file',
        'mime': 'image/png',
        'filename': 'screenshot.png',
        'url': dataUri,
      };

      ctrl.sendInput(
        sessionId,
        'What is in this image?\n',
        attachments: [imageAttachment],
      );

      final frame = repo.sentFrames.first;
      final parts = frame['parts'] as List<dynamic>;
      final fileParts = parts
          .cast<Map<String, dynamic>>()
          .where((p) => p['type'] == 'file')
          .toList();
      expect(fileParts, isNotEmpty,
          reason: 'Image attachment must produce a file part');
      final filePart = fileParts.first;
      expect(filePart['mime'], equals('image/png'));
      expect(filePart['url'], equals(dataUri),
          reason: 'Image data URI must be forwarded verbatim');
    },
  );

  // ── c4: filename is preserved in pending attachment round-trip ─────────────
  test(
    'issue-717-c4: filename is preserved through the text attachment round-trip',
    () {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(repo);
      const sessionId = 'test-717-c4';

      ctrl.setPendingAttachmentsForTest(sessionId, [
        {
          'type': 'text',
          'filename': 'output.log',
          'mime': 'text/plain',
          'text': 'WARN: disk usage 90%\n',
        },
      ]);

      ctrl.sendInput(sessionId, 'Check this.\n');

      // Pending attachments cleared after send.
      expect(ctrl.pendingAttachmentsFor(sessionId), isEmpty);

      // WS frame includes the text content.
      final frame = repo.sentFrames.first;
      final parts = frame['parts'] as List<dynamic>;
      final textParts = parts
          .cast<Map<String, dynamic>>()
          .where((p) => p['type'] == 'text')
          .toList();
      // The file content text part must contain the log line.
      final hasLogContent = textParts.any(
        (p) => (p['text'] as String?)?.contains('disk usage') == true,
      );
      expect(hasLogContent, isTrue,
          reason: 'File content must appear in the WS parts array');
    },
  );
}
