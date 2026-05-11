import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/agents/health_poller.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /// Creates a [HealthPoller] with a very short interval so tests don't wait
  /// real seconds, and with [failureThreshold] defaulting to 2.
  HealthPoller makePoller({
    required Future<bool> Function() checkFn,
    required void Function(bool) onHealthChanged,
    int failureThreshold = 2,
  }) {
    return HealthPoller(
      checkFn: checkFn,
      onHealthChanged: onHealthChanged,
      // Use a tiny interval so the periodic timer fires fast in tests.
      interval: const Duration(milliseconds: 50),
      failureThreshold: failureThreshold,
    );
  }

  // ---------------------------------------------------------------------------
  // Callback fires only on transitions
  // ---------------------------------------------------------------------------

  group('onHealthChanged fires only on transitions', () {
    test('does not fire when health stays true across ticks', () async {
      final calls = <bool>[];
      final poller = makePoller(
        checkFn: () async => true,
        onHealthChanged: calls.add,
      );

      poller.start();
      // Wait long enough for several ticks.
      await Future<void>.delayed(const Duration(milliseconds: 200));
      poller.dispose();

      // No transitions ever happened — callback must not have been called.
      expect(calls, isEmpty);
    });

    test('fires false then true on healthy→unhealthy→healthy', () async {
      var healthy = true;
      final calls = <bool>[];
      final poller = makePoller(
        checkFn: () async => healthy,
        onHealthChanged: calls.add,
        failureThreshold: 1,
      );

      poller.start();
      // Allow initial check (healthy) to complete.
      await Future<void>.delayed(const Duration(milliseconds: 20));

      // Flip unhealthy — one failure should suffice (threshold = 1).
      healthy = false;
      await Future<void>.delayed(const Duration(milliseconds: 150));

      // Flip back healthy.
      healthy = true;
      await Future<void>.delayed(const Duration(milliseconds: 150));

      poller.dispose();

      // Exactly one false then one true.
      expect(calls, [false, true]);
    });

    test('does not fire redundant false when already unhealthy', () async {
      var callCount = 0;
      final poller = makePoller(
        checkFn: () async => false,
        onHealthChanged: (_) => callCount++,
        failureThreshold: 1,
      );

      poller.start();
      await Future<void>.delayed(const Duration(milliseconds: 300));
      poller.dispose();

      // Should only have fired once despite many failing ticks.
      expect(callCount, 1);
    });
  });

  // ---------------------------------------------------------------------------
  // 2 consecutive failures required before signalling false
  // ---------------------------------------------------------------------------

  group('failureThreshold guard', () {
    test('does not signal false after only 1 failure with threshold=2',
        () async {
      int failCount = 0;
      final calls = <bool>[];
      final poller = makePoller(
        checkFn: () async {
          // Fail once, then succeed forever.
          if (failCount == 0) {
            failCount++;
            return false;
          }
          return true;
        },
        onHealthChanged: calls.add,
        failureThreshold: 2,
      );

      poller.start();
      await Future<void>.delayed(const Duration(milliseconds: 300));
      poller.dispose();

      // Only 1 failure → should never have fired false.
      expect(calls, isEmpty);
    });

    test('signals false after exactly failureThreshold consecutive failures',
        () async {
      int checkCallCount = 0;
      final calls = <bool>[];

      final poller = makePoller(
        checkFn: () async {
          checkCallCount++;
          // Always fail.
          return false;
        },
        onHealthChanged: calls.add,
        failureThreshold: 2,
      );

      poller.start();
      // Wait for at least 2 ticks plus a bit of slack.
      await Future<void>.delayed(const Duration(milliseconds: 300));
      poller.dispose();

      // At least 2 checks happened and false was signalled exactly once.
      expect(checkCallCount, greaterThanOrEqualTo(2));
      expect(calls, [false]);
    });
  });

  // ---------------------------------------------------------------------------
  // Lifecycle: backgrounding pauses the timer
  // ---------------------------------------------------------------------------

  group('lifecycle pause / resume', () {
    test('stops ticking when app is paused', () async {
      int checkCount = 0;
      final poller = makePoller(
        checkFn: () async {
          checkCount++;
          return true;
        },
        onHealthChanged: (_) {},
      );

      poller.start();
      // Let a few ticks happen.
      await Future<void>.delayed(const Duration(milliseconds: 150));
      final countBeforePause = checkCount;

      // Simulate app going to background.
      poller.didChangeAppLifecycleState(AppLifecycleState.paused);

      // Wait another stretch — no more ticks should occur.
      await Future<void>.delayed(const Duration(milliseconds: 200));
      final countAfterPause = checkCount;

      poller.dispose();

      expect(countAfterPause, equals(countBeforePause));
    });

    test('resumes ticking with an immediate check on resume', () async {
      int checkCount = 0;
      final poller = makePoller(
        checkFn: () async {
          checkCount++;
          return true;
        },
        onHealthChanged: (_) {},
      );

      poller.start();
      await Future<void>.delayed(const Duration(milliseconds: 50));

      // Pause.
      poller.didChangeAppLifecycleState(AppLifecycleState.paused);
      final countAtPause = checkCount;

      // Resume.
      poller.didChangeAppLifecycleState(AppLifecycleState.resumed);
      // Give the immediate check and at least one periodic tick time to fire.
      await Future<void>.delayed(const Duration(milliseconds: 200));

      poller.dispose();

      // At least one check fired immediately on resume.
      expect(checkCount, greaterThan(countAtPause));
    });
  });

  // ---------------------------------------------------------------------------
  // dispose() is idempotent
  // ---------------------------------------------------------------------------

  group('dispose', () {
    test('calling dispose() twice does not throw', () {
      final poller = makePoller(
        checkFn: () async => true,
        onHealthChanged: (_) {},
      );

      poller.start();
      // Double-dispose must not throw.
      expect(() {
        poller.dispose();
        poller.dispose();
      }, returnsNormally);
    });

    test('no callbacks fire after dispose()', () async {
      var healthy = true;
      final calls = <bool>[];
      final poller = makePoller(
        checkFn: () async => healthy,
        onHealthChanged: calls.add,
        failureThreshold: 1,
      );

      poller.start();
      await Future<void>.delayed(const Duration(milliseconds: 50));

      poller.dispose();
      final countAtDispose = calls.length;

      // Flip health after dispose — nothing should fire.
      healthy = false;
      await Future<void>.delayed(const Duration(milliseconds: 200));

      expect(calls.length, equals(countAtDispose));
    });
  });
}
