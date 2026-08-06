// Server-timestamp parsing.
//
// Reported live 2026-08-05: "the transcript is showing up, it's just out of order"
// — content present, sequence wrong. This survived BOTH earlier transcript fixes
// because it is the primary sort key, not the tiebreaker.
//
// The api_server returns SQLite `datetime('now')` output: `2026-08-05 22:18:21`
// — UTC, with no trailing Z and no offset. Dart reads a designator-less string as
// LOCAL time, so it parsed to 22:18 local: seven hours in the future on PDT.
// Streamed messages use DateTime.now().toUtc() and are correct, so every
// REST-loaded message sorted AFTER every live one.
//
// Measured: parse('2026-08-05 22:18:21') -> 2026-08-06 05:18:21Z
//           parse('2026-08-05 22:18:21Z') -> 2026-08-05 22:18:21Z
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';

AgentSessionMessage fromApi(String createdAt) => AgentSessionMessage.fromJson({
      'id': 1,
      'sessionId': 's1',
      'role': 'output',
      'rawText': 'x',
      'strippedText': 'x',
      'createdAt': createdAt,
    });

void main() {
  group('api_server timestamp parsing', () {
    test('a designator-less timestamp is read as UTC, not local', () {
      final m = fromApi('2026-08-05 22:18:21');
      expect(m.createdAt.isUtc, isTrue);
      expect(m.createdAt.toIso8601String(), '2026-08-05T22:18:21.000Z');
    });

    test('it does NOT drift by the local offset', () {
      final m = fromApi('2026-08-05 22:18:21');
      final correct = DateTime.utc(2026, 8, 5, 22, 18, 21);
      expect(m.createdAt.difference(correct), Duration.zero,
          reason: 'was off by the local UTC offset (7h on PDT)');
    });

    test('a REST message sorts BEFORE a later streamed message', () {
      // The exact failure: REST at 22:18:21Z, stream at 22:20:00Z.
      final rest = fromApi('2026-08-05 22:18:21').createdAt;
      final streamed = DateTime.utc(2026, 8, 5, 22, 20, 0);
      expect(rest.compareTo(streamed), lessThan(0),
          reason: 'before the fix the REST row sorted 7h AFTER the stream');
    });

    test('an explicit Z is respected', () {
      expect(fromApi('2026-08-05T22:18:21Z').createdAt.toIso8601String(),
          '2026-08-05T22:18:21.000Z');
    });

    test('an explicit offset is respected, not double-shifted', () {
      // 22:18:21-07:00 == 05:18:21Z the next day.
      expect(fromApi('2026-08-05T22:18:21-07:00').createdAt.toIso8601String(),
          '2026-08-06T05:18:21.000Z');
    });

    test('the date hyphens are not mistaken for a negative offset', () {
      // Guards the zone sniffing: '2026-08-05' contains '-'.
      expect(fromApi('2026-08-05 00:00:00').createdAt.toIso8601String(),
          '2026-08-05T00:00:00.000Z');
    });

    test('a junk or empty timestamp yields a UTC epoch, not a local one', () {
      expect(fromApi('').createdAt.isUtc, isTrue);
      expect(fromApi('not-a-date').createdAt.isUtc, isTrue);
    });
  });
}
