// Outbound-frame durability.
//
// Reported live 2026-08-05: two messages typed into "Encompass Session 2" appeared
// in the transcript and were never answered. Neither existed in the api_server DB —
// the last persisted message predated them by four minutes. The agent never ran.
//
// Cause: `AgentsDataSource.send` was
//
//     void send(Map<String, dynamic> msg) {
//       final ch = _channel;
//       if (ch == null) return;              // silent discard
//       ch.sink.add(jsonEncode({...}));      // no try/catch on a closing socket
//     }
//
// A frame sent while the socket was down vanished with no error, and because the
// UI renders the user's message optimistically it looked delivered. A lost
// `session.input` is a lost user message, which is the one thing that must never
// fail quietly.
//
// These tests exercise the queue/flush contract against a fake socket rather than
// a live server, so they run in CI.
import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';

/// Mirrors the data source's queue/flush contract. The real class builds its own
/// WebSocketChannel in `connect()`, so the logic is restated here against a fake
/// sink; keep the two in step.
class _Outbox {
  _Outbox({this.maxQueued = 50});

  final int maxQueued;
  final List<Map<String, dynamic>> pending = [];
  final List<String> delivered = [];
  final List<String> failures = [];

  bool connected = false;
  bool throwOnAdd = false;

  bool send(Map<String, dynamic> msg) {
    if (!connected) {
      _queue(msg);
      return false;
    }
    try {
      if (throwOnAdd) throw StateError('sink closed');
      delivered.add(jsonEncode({'v': 1, ...msg}));
      return true;
    } catch (_) {
      _queue(msg);
      connected = false;
      return false;
    }
  }

  void _queue(Map<String, dynamic> msg) {
    if (pending.length >= maxQueued) {
      pending.removeAt(0);
      failures.add('dropped oldest');
    }
    pending.add(msg);
  }

  void onConnect() {
    connected = true;
    if (pending.isEmpty) return;
    final queued = List<Map<String, dynamic>>.from(pending);
    pending.clear();
    for (var i = 0; i < queued.length; i++) {
      try {
        if (throwOnAdd) throw StateError('sink closed');
        delivered.add(jsonEncode({'v': 1, ...queued[i]}));
      } catch (_) {
        pending.addAll(queued.sublist(i));
        connected = false;
        return;
      }
    }
  }
}

Map<String, dynamic> input(String text) => {
      'type': 'session.input',
      'id': 's1',
      'data': text,
    };

void main() {
  group('outbound send durability', () {
    test('a message typed while disconnected is QUEUED, not discarded', () {
      final box = _Outbox()..connected = false;
      expect(box.send(input('what is the subbasin filter supposed to show?')),
          isFalse);
      expect(box.send(input('hello?')), isFalse);
      expect(box.delivered, isEmpty);
      expect(box.pending.length, 2, reason: 'both must survive the outage');
    });

    test('reconnect flushes the queue in order', () {
      final box = _Outbox()..connected = false;
      box.send(input('first'));
      box.send(input('second'));
      box.onConnect();
      expect(box.pending, isEmpty);
      expect(box.delivered.length, 2);
      expect(box.delivered[0], contains('first'));
      expect(box.delivered[1], contains('second'));
    });

    test(
        'a socket that looked open but was closing re-queues instead of losing it',
        () {
      final box = _Outbox()
        ..connected = true
        ..throwOnAdd = true;
      expect(box.send(input('lost?')), isFalse);
      expect(box.delivered, isEmpty);
      expect(box.pending.length, 1);
      expect(box.connected, isFalse, reason: 'should mark itself disconnected');

      box.throwOnAdd = false;
      box.onConnect();
      expect(box.delivered.single, contains('lost?'));
    });

    test('a partial flush preserves order and loses nothing', () {
      final box = _Outbox()..connected = false;
      for (final t in ['a', 'b', 'c']) {
        box.send(input(t));
      }
      box.throwOnAdd = true;
      box.onConnect(); // fails on the first frame
      expect(box.delivered, isEmpty);
      expect(box.pending.length, 3,
          reason: 'all three re-queued, still in order');

      box.throwOnAdd = false;
      box.onConnect();
      expect(box.delivered.map((d) => jsonDecode(d)['data']), ['a', 'b', 'c']);
    });

    test('the queue is bounded and reports what it drops', () {
      final box = _Outbox(maxQueued: 3)..connected = false;
      for (final t in ['1', '2', '3', '4']) {
        box.send(input(t));
      }
      expect(box.pending.length, 3);
      expect(box.failures.length, 1,
          reason: 'a silent drop is the original bug');
      // Oldest dropped, newest kept.
      expect(box.pending.map((m) => m['data']), ['2', '3', '4']);
    });

    test('normal connected sends report success and never queue', () {
      final box = _Outbox()..connected = true;
      expect(box.send(input('hi')), isTrue);
      expect(box.pending, isEmpty);
      expect(box.delivered.single, contains('hi'));
    });
  });
}
