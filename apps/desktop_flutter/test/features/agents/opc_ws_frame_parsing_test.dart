/// WS frame parsing — the Flutter half of the false-green-proof suite.
///
/// `AgentsDataSource._onRaw` runs exactly two steps on every WebSocket frame:
///   final json = jsonDecode(raw as String) as Map<String, dynamic>;
///   _msgController.add(AgentWsMessage.parse(json));
///
/// So the data flow's correctness lives in `AgentWsMessage.parse`. These tests
/// feed the EXACT frame shapes the api_server `opencode_stream_bridge`
/// broadcasts (JSON-encoded, then decoded — mirroring `_onRaw`) and assert each
/// decodes into the right typed message with the right fields. No repository or
/// data-source stub is asserted; this drives the real parser the app runs.
///
/// Covers the brief's specific concerns:
///   - realistic bridge payloads (message.part.delta/updated, session.status,
///     session.diff, todo.updated, permission.*),
///   - unknown event types degrade to UnknownWsMessage (never throw),
///   - a no-authed-model / SDK error surfaces as a VISIBLE WsErrorMessage with
///     its message intact — not a silent drop, not UnknownWsMessage.
///
/// Run with:
///   cd apps/desktop_flutter && flutter test test/features/agents/opc_ws_frame_parsing_test.dart
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';

/// Mirror `_onRaw`: JSON-encode the bridge frame, decode it back, and run the
/// real parser. Encoding+decoding catches any shape that survives a Dart map
/// literal but not a real wire round-trip.
AgentWsMessage parseFrame(Map<String, dynamic> bridgeFrame) {
  final raw = jsonEncode(bridgeFrame);
  final decoded = jsonDecode(raw) as Map<String, dynamic>;
  return AgentWsMessage.parse(decoded);
}

void main() {
  group('streaming text frames', () {
    test('message.part.delta -> MessagePartDeltaMessage with delta + ids', () {
      final msg = parseFrame({
        'v': 1,
        'type': 'message.part.delta',
        'id': 'local-session-1',
        'messageId': 'sdk-msg-1',
        'partId': 'part-1',
        'field': 'text',
        'delta': 'Hello, ',
      });
      expect(msg, isA<MessagePartDeltaMessage>());
      final d = msg as MessagePartDeltaMessage;
      expect(d.sessionId, 'local-session-1');
      expect(d.messageId, 'sdk-msg-1');
      expect(d.partId, 'part-1');
      expect(d.field, 'text');
      expect(d.delta, 'Hello, ');
    });

    test(
        'message.part.updated -> MessagePartUpdatedMessage exposes part fields',
        () {
      final msg = parseFrame({
        'v': 1,
        'type': 'message.part.updated',
        'id': 'local-session-1',
        'part': {
          'id': 'part-1',
          'messageID': 'sdk-msg-1',
          'sessionID': 'sdk-session-1',
          'type': 'text',
          'text': 'Hello, world',
        },
      });
      expect(msg, isA<MessagePartUpdatedMessage>());
      final p = msg as MessagePartUpdatedMessage;
      expect(p.sessionId, 'local-session-1');
      expect(p.partId, 'part-1');
      expect(p.messageId, 'sdk-msg-1');
      expect(p.partType, 'text');
      expect(p.text, 'Hello, world');
    });

    test('message.updated -> MessageUpdatedMessage exposes cost + tokens', () {
      final msg = parseFrame({
        'v': 1,
        'type': 'message.updated',
        'id': 'local-session-1',
        'info': {
          'id': 'sdk-msg-1',
          'role': 'assistant',
          'cost': 0.0123,
          'tokens': {
            'input': 100,
            'output': 50,
            'reasoning': 0,
            'cache': {'read': 0, 'write': 0}
          },
        },
      });
      expect(msg, isA<MessageUpdatedMessage>());
      final m = msg as MessageUpdatedMessage;
      expect(m.messageId, 'sdk-msg-1');
      expect(m.role, 'assistant');
      expect(m.cost, closeTo(0.0123, 1e-9));
      expect(m.tokens?['input'], 100);
    });

    test('transcript.append -> TranscriptAppendMessage carries finalized text',
        () {
      final msg = parseFrame({
        'v': 1,
        'type': 'transcript.append',
        'id': 'local-session-1',
        'role': 'output',
        'text': 'final answer',
      });
      expect(msg, isA<TranscriptAppendMessage>());
      final t = msg as TranscriptAppendMessage;
      expect(t.id, 'local-session-1');
      expect(t.role, 'output');
      expect(t.text, 'final answer');
    });
  });

  group('session status frames', () {
    test('session.status busy -> working true', () {
      final msg = parseFrame({
        'v': 1,
        'type': 'session.status',
        'id': 'local-session-1',
        'working': true,
        'status': 'busy',
      });
      final s = msg as SessionStatusMessage;
      expect(s.working, isTrue);
      expect(s.status, 'busy');
      expect(s.isRetrying, isFalse);
    });

    test('session.idle relayed as session.status working:false', () {
      // The bridge maps SDK session.idle -> { type: session.status, working:false }.
      final msg = parseFrame({
        'v': 1,
        'type': 'session.status',
        'id': 'local-session-1',
        'working': false,
      });
      final s = msg as SessionStatusMessage;
      expect(s.working, isFalse);
    });

    test(
        'session.status retrying -> isRetrying with attempt + reason (OPC-M2-4)',
        () {
      final msg = parseFrame({
        'v': 1,
        'type': 'session.status',
        'id': 'local-session-1',
        'working': true,
        'status': 'retrying',
        'attempt': 2,
        'reason': 'rate limit',
      });
      final s = msg as SessionStatusMessage;
      expect(s.isRetrying, isTrue);
      expect(s.attempt, 2);
      expect(s.reason, 'rate limit');
    });

    test('session.diff -> SessionDiffMessage (id only; client refetches REST)',
        () {
      final msg =
          parseFrame({'v': 1, 'type': 'session.diff', 'id': 'local-session-1'});
      expect(msg, isA<SessionDiffMessage>());
      expect((msg as SessionDiffMessage).id, 'local-session-1');
    });

    test('todo.updated -> SessionTodoUpdatedMessage carries the full todo list',
        () {
      final msg = parseFrame({
        'v': 1,
        'type': 'todo.updated',
        'id': 'local-session-1',
        'todos': [
          {
            'id': 't1',
            'content': 'do thing',
            'status': 'pending',
            'priority': 'high'
          },
        ],
      });
      expect(msg, isA<SessionTodoUpdatedMessage>());
      final t = msg as SessionTodoUpdatedMessage;
      expect(t.sessionId, 'local-session-1');
      expect(t.todos, hasLength(1));
      expect(t.todos.first['content'], 'do thing');
    });
  });

  group('permission frames', () {
    test(
        'permission.asked -> PermissionAskedMessage with tool + args + summary',
        () {
      final msg = parseFrame({
        'v': 1,
        'type': 'permission.asked',
        'sessionId': 'local-session-1',
        'permissionId': 'perm-42',
        'toolName': 'bash',
        'args': {'command': 'rm -rf build'},
        'summary': 'Run bash: rm -rf build',
      });
      expect(msg, isA<PermissionAskedMessage>());
      final p = msg as PermissionAskedMessage;
      expect(p.sessionId, 'local-session-1');
      expect(p.permissionId, 'perm-42');
      expect(p.toolName, 'bash');
      expect(p.args['command'], 'rm -rf build');
      expect(p.summary, 'Run bash: rm -rf build');
    });

    test('permission.resolved -> PermissionResolvedMessage with decision', () {
      final msg = parseFrame({
        'v': 1,
        'type': 'permission.resolved',
        'sessionId': 'local-session-1',
        'permissionId': 'perm-42',
        'decision': 'accept',
      });
      expect(msg, isA<PermissionResolvedMessage>());
      final p = msg as PermissionResolvedMessage;
      expect(p.permissionId, 'perm-42');
      expect(p.decision, 'accept');
    });
  });

  group('error + unknown frames (must never silently vanish)', () {
    test('error frame (no-authed-model / SDK error) -> VISIBLE WsErrorMessage',
        () {
      // The bridge relays SDK session.error as { type: error, id, message }.
      // A model/auth failure must surface as a readable error line, not a drop.
      const errText =
          "Cannot run shell command: no authed model found for agent 'claude-code'";
      final msg = parseFrame({
        'v': 1,
        'type': 'error',
        'id': 'local-session-1',
        'message': errText,
      });
      expect(msg, isA<WsErrorMessage>());
      final e = msg as WsErrorMessage;
      expect(e.id, 'local-session-1');
      // The message is preserved verbatim so the UI can show it inline.
      expect(e.message, errText);
      expect(e.message, isNotEmpty);
    });

    test('unrecognized bridge "event" frame -> UnknownWsMessage, no throw', () {
      // The bridge default branch wraps unknown SDK events as { type: event,
      // eventType: <real>, ... }. parse() has no 'event' case -> UnknownWsMessage.
      final msg = parseFrame({
        'v': 1,
        'type': 'event',
        'id': 'local-session-1',
        'eventType': 'some.future.sdk.event',
        'properties': {'foo': 'bar'},
      });
      expect(msg, isA<UnknownWsMessage>());
      expect((msg as UnknownWsMessage).rawType, 'event');
    });

    test('a brand-new top-level type degrades to UnknownWsMessage', () {
      final msg =
          parseFrame({'v': 1, 'type': 'totally.new.type.v2', 'id': 'x'});
      expect(msg, isA<UnknownWsMessage>());
      expect((msg as UnknownWsMessage).rawType, 'totally.new.type.v2');
    });

    test('a frame with no type degrades to UnknownWsMessage with empty rawType',
        () {
      final msg = parseFrame({'v': 1, 'id': 'x'});
      expect(msg, isA<UnknownWsMessage>());
      expect((msg as UnknownWsMessage).rawType, '');
    });
  });
}
