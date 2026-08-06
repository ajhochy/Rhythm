// Outbound-frame durability, against a REAL WebSocket.
//
// `ws_send_queue_test.dart` covers the same contract with a fake sink, and it
// passed the whole time the shipped implementation had a hole — because the fake
// modelled `connected` as an explicit flag while the real class inferred it from
// `_channel != null`. The fake was right and the code was wrong, and no fake
// could have shown that. Hence this file: it drives the actual
// `AgentsDataSource` against a real `HttpServer`.
//
// The defect: `WebSocketChannel.connect()` is LAZY. It returns a channel object
// immediately and connects in the background, and `sink.add` on a channel whose
// handshake has not completed buffers into it rather than throwing. So between
// `connect()` being called and `channel.ready` completing, `_channel` was
// non-null, `send()` took its success path, and the frame was swallowed with no
// error — the same silent loss of a user message the queue was built to stop.
// Worse, `_flushPendingSends()` would drain the whole queue into that channel.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agents/data/agents_data_source.dart';

/// A minimal `/ws/agents` stand-in that records every frame it receives.
class _FakeGateway {
  _FakeGateway(this._server, this.port) {
    _server.transform(WebSocketTransformer()).listen((socket) {
      _sockets.add(socket);
      socket.listen(
        (frame) => received.add(frame as String),
        onDone: () => _sockets.remove(socket),
        onError: (_) => _sockets.remove(socket),
      );
    });
  }

  static Future<_FakeGateway> bind([int port = 0]) async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, port);
    return _FakeGateway(server, server.port);
  }

  final HttpServer _server;
  final int port;
  final List<WebSocket> _sockets = [];
  final List<String> received = [];

  String get wsUrl => 'ws://127.0.0.1:$port';

  /// Decoded `data` field of every frame received, in arrival order.
  List<String> get payloads => received
      .map((f) => (jsonDecode(f) as Map<String, dynamic>)['data'] as String)
      .toList();

  Future<void> close() async {
    for (final s in List<WebSocket>.from(_sockets)) {
      await s.close();
    }
    _sockets.clear();
    await _server.close(force: true);
  }
}

Map<String, dynamic> input(String text) => {
      'type': 'session.input',
      'id': 's1',
      'data': text,
    };

/// Pump real time — these tests exercise actual socket I/O, not fake_async.
Future<void> settle([int ms = 120]) =>
    Future<void>.delayed(Duration(milliseconds: ms));

/// Poll until [condition] holds, so the tests do not depend on a fixed sleep.
Future<bool> waitFor(bool Function() condition, {int timeoutMs = 4000}) async {
  final deadline = DateTime.now().add(Duration(milliseconds: timeoutMs));
  while (DateTime.now().isBefore(deadline)) {
    if (condition()) return true;
    await settle(50);
  }
  return condition();
}

void main() {
  test('a live socket delivers immediately and queues nothing', () async {
    final gw = await _FakeGateway.bind();
    final ds = AgentsDataSource(wsUrl: gw.wsUrl);
    addTearDown(() async {
      await ds.dispose();
      await gw.close();
    });

    await ds.connect();
    expect(ds.isConnected, isTrue);
    expect(ds.send(input('hello')), isTrue);
    expect(ds.pendingSendCount, 0);
    expect(await waitFor(() => gw.payloads.contains('hello')), isTrue);
  });

  test(
      'REGRESSION: a send while the handshake is still in flight is QUEUED, '
      'not swallowed by the lazy channel', () async {
    // The precise defect. `connect()` sets `_channel` synchronously before its
    // first await, so a send issued before `ready` completes used to see a
    // non-null channel and report success while the frame went nowhere.
    final gw = await _FakeGateway.bind();
    final ds = AgentsDataSource(wsUrl: gw.wsUrl);
    addTearDown(() async {
      await ds.dispose();
      await gw.close();
    });

    final connecting = ds.connect(); // deliberately NOT awaited
    expect(ds.isConnected, isFalse,
        reason: 'a channel exists but the socket is not live yet');
    expect(ds.send(input('mid-handshake')), isFalse,
        reason: 'must not claim success on an unready channel');
    expect(ds.pendingSendCount, 1, reason: 'the frame must be held, not lost');

    await connecting;
    // The flush on ready delivers it.
    expect(await waitFor(() => gw.payloads.contains('mid-handshake')), isTrue,
        reason: 'the queued frame must arrive once the socket is live');
    expect(ds.pendingSendCount, 0);
  });

  test('REGRESSION: a failed connect attempt does not consume the queue',
      () async {
    // Nothing is listening, so `ready` throws. Pre-fix, `_flushPendingSends`
    // ran on a non-null channel and drained every queued frame into a socket
    // that never came up.
    final dead = await _FakeGateway.bind();
    final deadUrl = dead.wsUrl;
    await dead.close(); // port is now closed

    final ds = AgentsDataSource(wsUrl: deadUrl);
    addTearDown(() async => ds.dispose());

    expect(ds.send(input('survive me')), isFalse);
    expect(ds.pendingSendCount, 1);

    await ds.connect(); // fails
    expect(ds.isConnected, isFalse);
    expect(ds.pendingSendCount, 1,
        reason: 'a failed attempt must leave the queue intact');
  });

  test('a message typed during a real outage survives and flushes on reconnect',
      () async {
    // End-to-end shape of the live incident and of smoke item K2.
    final gw = await _FakeGateway.bind();
    final port = gw.port;
    final ds = AgentsDataSource(wsUrl: gw.wsUrl);
    addTearDown(() async => ds.dispose());

    await ds.connect();
    expect(ds.send(input('before outage')), isTrue);
    expect(await waitFor(() => gw.payloads.contains('before outage')), isTrue);

    // Server goes away; the client notices via onDone/onError.
    await gw.close();
    expect(await waitFor(() => !ds.isConnected), isTrue,
        reason: 'the client must observe the drop');

    // Typed while there is nothing to send to.
    expect(ds.send(input('during outage')), isFalse);
    expect(ds.pendingSendCount, 1);

    // Same port comes back, as the app's respawn does.
    final gw2 = await _FakeGateway.bind(port);
    addTearDown(() async => gw2.close());

    // The reconnect timer (250ms backoff, capped at 30s) reconnects and flushes
    // without any further send() call.
    expect(await waitFor(() => gw2.payloads.contains('during outage')), isTrue,
        reason:
            'the frame typed during the outage must arrive after reconnect');
    expect(ds.pendingSendCount, 0);
  });

  test('queued frames flush in the order they were typed', () async {
    final gw = await _FakeGateway.bind();
    final port = gw.port;
    final ds = AgentsDataSource(wsUrl: gw.wsUrl);
    addTearDown(() async => ds.dispose());

    await ds.connect();
    await gw.close();
    expect(await waitFor(() => !ds.isConnected), isTrue);

    for (final t in ['first', 'second', 'third']) {
      expect(ds.send(input(t)), isFalse);
    }
    expect(ds.pendingSendCount, 3);

    final gw2 = await _FakeGateway.bind(port);
    addTearDown(() async => gw2.close());

    expect(await waitFor(() => gw2.payloads.length >= 3), isTrue);
    expect(gw2.payloads.take(3), ['first', 'second', 'third'],
        reason: 'a lost ordering is a garbled conversation');
  });
}
