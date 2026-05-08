import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';

void main() {
  // --------------------------------------------------------------------------
  // AgentSession — JSON round-trip
  // --------------------------------------------------------------------------

  group('AgentSession', () {
    const jsonFull = <String, dynamic>{
      'id': 'sess-1',
      'taskId': 'task-42',
      'agentKind': 'claude-code',
      'status': 'working',
      'sessionToken': 'tok-abc',
      'cwd': '/home/user/project',
      'name': 'My Session',
      'lastPreview': 'Running tests...',
      'lastActivityAt': '2026-01-01T10:00:00.000Z',
      'createdAt': '2026-01-01T09:00:00.000Z',
      'updatedAt': '2026-01-01T10:00:00.000Z',
    };

    test('fromJson populates all fields', () {
      final session = AgentSession.fromJson(jsonFull);
      expect(session.id, 'sess-1');
      expect(session.taskId, 'task-42');
      expect(session.agentId, 'claude-code');
      expect(session.status, AgentSessionStatus.working);
      expect(session.sessionToken, 'tok-abc');
      expect(session.cwd, '/home/user/project');
      expect(session.name, 'My Session');
      expect(session.lastPreview, 'Running tests...');
      expect(session.lastActivityAt, isNotNull);
      expect(session.createdAt.year, 2026);
    });

    test('toJson round-trips all fields', () {
      final session = AgentSession.fromJson(jsonFull);
      final out = session.toJson();
      expect(out['id'], 'sess-1');
      expect(out['taskId'], 'task-42');
      expect(out['agent_id'], 'claude-code');
      expect(out['status'], 'working');
      expect(out['sessionToken'], 'tok-abc');
      expect(out['cwd'], '/home/user/project');
      expect(out['name'], 'My Session');
      expect(out['lastPreview'], 'Running tests...');
      expect(out['lastActivityAt'], isNotNull);
      expect(out['createdAt'], isNotNull);
      expect(out['updatedAt'], isNotNull);
    });

    test('fromJson handles missing optional fields', () {
      const minimal = <String, dynamic>{
        'id': 'sess-2',
        'agentKind': 'codex',
        'status': 'idle',
        'cwd': '/tmp',
        'name': 'Minimal',
        'createdAt': '2026-01-01T09:00:00.000Z',
        'updatedAt': '2026-01-01T09:00:00.000Z',
      };
      final session = AgentSession.fromJson(minimal);
      expect(session.taskId, isNull);
      expect(session.sessionToken, isNull);
      expect(session.lastPreview, isNull);
      expect(session.lastActivityAt, isNull);
      expect(session.agentId, 'codex');
    });

    test('fromJson preserves unknown agentId as-is', () {
      final session = AgentSession.fromJson({
        'id': 'x',
        'agent_id': 'some-future-agent',
        'status': 'closed',
        'cwd': '/',
        'name': 'X',
        'createdAt': '2026-01-01T00:00:00.000Z',
        'updatedAt': '2026-01-01T00:00:00.000Z',
      });
      expect(session.agentId, 'some-future-agent');
    });

    test('fromJson falls back to closed for unknown status', () {
      final session = AgentSession.fromJson({
        'id': 'x',
        'agentKind': 'claude-code',
        'status': 'mystery',
        'cwd': '/',
        'name': 'X',
        'createdAt': '2026-01-01T00:00:00.000Z',
        'updatedAt': '2026-01-01T00:00:00.000Z',
      });
      expect(session.status, AgentSessionStatus.closed);
    });

    test('copyWith replaces only specified fields', () {
      final session = AgentSession.fromJson(jsonFull);
      final updated = session.copyWith(status: AgentSessionStatus.idle);
      expect(updated.status, AgentSessionStatus.idle);
      expect(updated.id, session.id);
      expect(updated.name, session.name);
    });

    test('copyWith can null out optional fields', () {
      final session = AgentSession.fromJson(jsonFull);
      final updated = session.copyWith(taskId: null, lastPreview: null);
      expect(updated.taskId, isNull);
      expect(updated.lastPreview, isNull);
    });
  });

  // --------------------------------------------------------------------------
  // AgentSessionMessage — JSON round-trip
  // --------------------------------------------------------------------------

  group('AgentSessionMessage', () {
    const jsonMsg = <String, dynamic>{
      'id': 101,
      'sessionId': 'sess-1',
      'role': 'output',
      'rawText': '\x1b[32mHello\x1b[0m',
      'strippedText': 'Hello',
      'createdAt': '2026-01-01T10:05:00.000Z',
    };

    test('fromJson populates all fields', () {
      final msg = AgentSessionMessage.fromJson(jsonMsg);
      expect(msg.id, 101);
      expect(msg.sessionId, 'sess-1');
      expect(msg.role, 'output');
      expect(msg.rawText, '\x1b[32mHello\x1b[0m');
      expect(msg.strippedText, 'Hello');
      expect(msg.createdAt.year, 2026);
    });

    test('toJson round-trips all fields', () {
      final msg = AgentSessionMessage.fromJson(jsonMsg);
      final out = msg.toJson();
      expect(out['id'], 101);
      expect(out['sessionId'], 'sess-1');
      expect(out['role'], 'output');
      expect(out['rawText'], '\x1b[32mHello\x1b[0m');
      expect(out['strippedText'], 'Hello');
      expect(out['createdAt'], isNotNull);
    });

    test('fromJson defaults gracefully on missing fields', () {
      final msg = AgentSessionMessage.fromJson(const {});
      expect(msg.id, 0);
      expect(msg.sessionId, '');
      expect(msg.role, 'output');
      expect(msg.rawText, '');
      expect(msg.strippedText, '');
    });
  });

  // --------------------------------------------------------------------------
  // AgentWsMessage.parse — each known type
  // --------------------------------------------------------------------------

  group('AgentWsMessage.parse', () {
    test('sessions.list parses active and resumable sessions', () {
      final msg = AgentWsMessage.parse({
        'type': 'sessions.list',
        'sessions': [
          {
            'id': 's1',
            'agentKind': 'claude-code',
            'status': 'working',
            'cwd': '/proj',
            'name': 'S1',
            'createdAt': '2026-01-01T00:00:00.000Z',
            'updatedAt': '2026-01-01T00:00:00.000Z',
          },
        ],
        'resumable': [],
      });
      expect(msg, isA<SessionsListMessage>());
      final m = msg as SessionsListMessage;
      expect(m.sessions, hasLength(1));
      expect(m.sessions.first.id, 's1');
      expect(m.resumable, isEmpty);
    });

    test('session.created parses session', () {
      final msg = AgentWsMessage.parse({
        'type': 'session.created',
        'session': {
          'id': 's2',
          'agentKind': 'codex',
          'status': 'starting',
          'cwd': '/tmp',
          'name': 'New',
          'createdAt': '2026-01-01T00:00:00.000Z',
          'updatedAt': '2026-01-01T00:00:00.000Z',
        },
      });
      expect(msg, isA<SessionCreatedMessage>());
      expect((msg as SessionCreatedMessage).session.id, 's2');
    });

    test('session.closed parses id and resumable flag', () {
      final msg = AgentWsMessage.parse({
        'type': 'session.closed',
        'id': 's3',
        'resumable': true,
      });
      expect(msg, isA<SessionClosedMessage>());
      final m = msg as SessionClosedMessage;
      expect(m.id, 's3');
      expect(m.resumable, isTrue);
    });

    test('session.status parses working and source', () {
      final msg = AgentWsMessage.parse({
        'type': 'session.status',
        'id': 's4',
        'working': true,
        'source': 'agent',
      });
      expect(msg, isA<SessionStatusMessage>());
      final m = msg as SessionStatusMessage;
      expect(m.id, 's4');
      expect(m.working, isTrue);
      expect(m.source, 'agent');
    });

    test('output parses data and replay flag', () {
      final msg = AgentWsMessage.parse({
        'type': 'output',
        'id': 's5',
        'data': 'stdout line\n',
        'replay': false,
      });
      expect(msg, isA<OutputMessage>());
      final m = msg as OutputMessage;
      expect(m.id, 's5');
      expect(m.data, 'stdout line\n');
      expect(m.replay, isFalse);
    });

    test('transcript.append parses role and text', () {
      final msg = AgentWsMessage.parse({
        'type': 'transcript.append',
        'id': 's6',
        'role': 'input',
        'text': 'user typed something',
      });
      expect(msg, isA<TranscriptAppendMessage>());
      final m = msg as TranscriptAppendMessage;
      expect(m.id, 's6');
      expect(m.role, 'input');
      expect(m.text, 'user typed something');
    });

    test('trigger.fired parses taskId, taskTitle, and optional userId', () {
      final msg = AgentWsMessage.parse({
        'type': 'trigger.fired',
        'taskId': 'task-99',
        'taskTitle': 'Build the thing',
        'triggeredByUserId': 7,
      });
      expect(msg, isA<TriggerFiredMessage>());
      final m = msg as TriggerFiredMessage;
      expect(m.taskId, 'task-99');
      expect(m.taskTitle, 'Build the thing');
      expect(m.triggeredByUserId, 7);
    });

    test('trigger.fired handles missing triggeredByUserId', () {
      final msg = AgentWsMessage.parse({
        'type': 'trigger.fired',
        'taskId': 'task-1',
        'taskTitle': 'Automated',
      });
      expect(msg, isA<TriggerFiredMessage>());
      expect((msg as TriggerFiredMessage).triggeredByUserId, isNull);
    });

    test('error parses message', () {
      final msg = AgentWsMessage.parse({
        'type': 'error',
        'message': 'Something went wrong',
      });
      expect(msg, isA<WsErrorMessage>());
      expect((msg as WsErrorMessage).message, 'Something went wrong');
    });

    test('unknown type returns UnknownWsMessage with rawType', () {
      final msg = AgentWsMessage.parse({'type': 'some.future.type'});
      expect(msg, isA<UnknownWsMessage>());
      expect((msg as UnknownWsMessage).rawType, 'some.future.type');
    });

    test('missing type returns UnknownWsMessage with empty string', () {
      final msg = AgentWsMessage.parse({});
      expect(msg, isA<UnknownWsMessage>());
      expect((msg as UnknownWsMessage).rawType, '');
    });
  });
}
