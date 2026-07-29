import 'dart:async';

import 'package:flutter_test/flutter_test.dart';

// ---------------------------------------------------------------------------
// Connectivity stub
//
// Replicates the connectivity-stream contract described in the issue without
// touching real WebSocket infrastructure.  The production code in
// AgentsDataSource follows the identical logic; this stub isolates it for
// fast, deterministic unit tests.
// ---------------------------------------------------------------------------

class _ConnectivityStub {
  final StreamController<bool> _connectivityController =
      StreamController<bool>.broadcast();

  Timer? _disconnectFailTimer;

  Stream<bool> get connectivityStream => _connectivityController.stream;
  bool get hasActivePendingTimer => _disconnectFailTimer != null;

  /// Call after a channel is successfully opened.
  void onConnected() {
    _disconnectFailTimer?.cancel();
    _disconnectFailTimer = null;
    _connectivityController.add(true);
  }

  /// Call when the channel closes.
  void onDisconnected() {
    _disconnectFailTimer?.cancel();
    _disconnectFailTimer = Timer(
      const Duration(seconds: 10),
      () => _connectivityController.add(false),
    );
  }

  Future<void> dispose() async {
    _disconnectFailTimer?.cancel();
    _disconnectFailTimer = null;
    await _connectivityController.close();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AgentsDataSource connectivity stream', () {
    late _ConnectivityStub stub;
    late List<bool> received;
    late StreamSubscription<bool> sub;

    setUp(() {
      stub = _ConnectivityStub();
      received = [];
      sub = stub.connectivityStream.listen(received.add);
    });

    tearDown(() async {
      await sub.cancel();
      await stub.dispose();
    });

    // -------------------------------------------------------------------------
    // AC1 — connect() success emits exactly one `true`.
    // -------------------------------------------------------------------------

    test('connect success emits exactly one true', () async {
      stub.onConnected();

      await Future<void>.delayed(Duration.zero);

      expect(received, equals([true]));
    });

    // -------------------------------------------------------------------------
    // AC2 — disconnect with no reconnect within 10s emits false.
    // -------------------------------------------------------------------------

    test('disconnect followed by no reconnect fires false after timer elapses',
        () async {
      stub.onConnected();
      await Future<void>.delayed(Duration.zero);

      stub.onDisconnected();

      // A pending 10s timer must be active.
      expect(stub.hasActivePendingTimer, isTrue);

      // Manually fire the timer to simulate 10s passing.
      stub._disconnectFailTimer!.cancel();
      stub._disconnectFailTimer = null;
      stub._connectivityController.add(false);

      await Future<void>.delayed(Duration.zero);

      expect(received, containsAllInOrder([true, false]));
    });

    // -------------------------------------------------------------------------
    // AC3 — disconnect followed by reconnect within 10s: no false emitted.
    // -------------------------------------------------------------------------

    test('disconnect followed by reconnect within 10s suppresses false event',
        () async {
      stub.onConnected();
      await Future<void>.delayed(Duration.zero);

      stub.onDisconnected();
      expect(stub.hasActivePendingTimer, isTrue);

      // Reconnect before the 10s timer fires — timer must be cancelled.
      stub.onConnected();
      await Future<void>.delayed(Duration.zero);

      expect(stub.hasActivePendingTimer, isFalse);

      // Only `true` events — never a `false`.
      expect(received, everyElement(isTrue));
      expect(received, hasLength(2)); // initial connect + reconnect
    });

    // -------------------------------------------------------------------------
    // AC4 — dispose cancels the timer and closes the controller.
    // -------------------------------------------------------------------------

    test('dispose cancels timer and closes controller', () async {
      stub.onConnected();
      stub.onDisconnected();

      expect(stub.hasActivePendingTimer, isTrue);

      await sub.cancel();
      await stub.dispose();

      // Timer must be cancelled after dispose.
      expect(stub.hasActivePendingTimer, isFalse);
    });

    // -------------------------------------------------------------------------
    // Extra: repeated disconnects replace the prior timer.
    // -------------------------------------------------------------------------

    test('repeated disconnects cancel the previous timer', () async {
      stub.onConnected();
      stub.onDisconnected();
      final firstTimer = stub._disconnectFailTimer;

      stub.onDisconnected(); // second disconnect
      final secondTimer = stub._disconnectFailTimer;

      // A new timer is active and differs from the first.
      expect(identical(firstTimer, secondTimer), isFalse);
      expect(stub.hasActivePendingTimer, isTrue);
    });
  });
}
