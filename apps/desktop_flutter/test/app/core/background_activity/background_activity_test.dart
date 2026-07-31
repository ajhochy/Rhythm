/// Tests for the BackgroundActivity feature — #747.
///
/// Covers:
///   1. BackgroundStatus.fromJson parses correctly
///   2. BackgroundActivityController idle/running state transitions
///   3. BackgroundActivityIndicator renders idle state (no activity)
///   4. BackgroundActivityIndicator renders active state (loops running)
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/background_activity/background_activity_controller.dart';
import 'package:rhythm_desktop/app/core/background_activity/background_status_data_source.dart';
import 'package:rhythm_desktop/app/core/background_activity/background_status_model.dart';
import 'package:rhythm_desktop/app/core/layout/background_activity_indicator.dart';

// ---------------------------------------------------------------------------
// Fake data source
// ---------------------------------------------------------------------------

/// Controls what fetch() returns.
class _FakeDataSource extends BackgroundStatusDataSource {
  _FakeDataSource(this._status);

  BackgroundStatus _status;

  set status(BackgroundStatus value) => _status = value;

  @override
  Future<BackgroundStatus> fetch() async => _status;
}

BackgroundStatus _makeStatus(
    {int activeCount = 0, List<Map<String, dynamic>>? loops}) {
  final defaultLoops = [
    {
      'name': 'skill_harvester',
      'state': 'idle',
      'lastRunAt': null,
      'nextRunAt': null
    },
    {
      'name': 'skill_improver',
      'state': 'idle',
      'lastRunAt': null,
      'nextRunAt': null
    },
    {'name': 'memory', 'state': 'idle', 'lastRunAt': null, 'nextRunAt': null},
    {
      'name': 'scheduler',
      'state': 'idle',
      'lastRunAt': null,
      'nextRunAt': null
    },
    {
      'name': 'integrations_sync',
      'state': 'idle',
      'lastRunAt': null,
      'nextRunAt': null
    },
  ];
  return BackgroundStatus.fromJson({
    'loops': loops ?? defaultLoops,
    'activeCount': activeCount,
    'curator': {'state': 'idle', 'lastRunAt': null},
  });
}

BackgroundStatus _makeRunningStatus() {
  return BackgroundStatus.fromJson({
    'loops': [
      {
        'name': 'skill_harvester',
        'state': 'running',
        'lastRunAt': '2026-06-25T10:00:00.000Z',
        'nextRunAt': null,
      },
      {
        'name': 'skill_improver',
        'state': 'idle',
        'lastRunAt': null,
        'nextRunAt': null
      },
      {
        'name': 'memory',
        'state': 'idle',
        'lastRunAt': '2026-06-25T02:00:00.000Z',
        'nextRunAt': '2026-06-26T02:00:00.000Z',
      },
      {
        'name': 'scheduler',
        'state': 'running',
        'lastRunAt': '2026-06-25T09:00:00.000Z',
        'nextRunAt': null,
        'currentItem': '2 task(s) running',
      },
      {
        'name': 'integrations_sync',
        'state': 'idle',
        'lastRunAt': null,
        'nextRunAt': null
      },
    ],
    'activeCount': 2,
    'curator': {'state': 'running', 'lastRunAt': '2026-06-25T10:00:00.000Z'},
  });
}

// ---------------------------------------------------------------------------
// 1. Model parsing
// ---------------------------------------------------------------------------

void main() {
  group('BackgroundStatus.fromJson', () {
    test('parses idle status correctly', () {
      final s = _makeStatus();
      expect(s.activeCount, 0);
      expect(s.hasActivity, false);
      expect(s.loops, hasLength(5));
      expect(s.loops.first.name, 'skill_harvester');
      expect(s.loops.first.isRunning, false);
    });

    test('parses active status with running loops', () {
      final s = _makeRunningStatus();
      expect(s.activeCount, 2);
      expect(s.hasActivity, true);
      expect(s.loops.first.isRunning, true);

      final scheduler = s.loops.firstWhere((l) => l.name == 'scheduler');
      expect(scheduler.isRunning, true);
      expect(scheduler.currentItem, '2 task(s) running');

      final memory = s.loops.firstWhere((l) => l.name == 'memory');
      expect(memory.isRunning, false);
      expect(memory.nextRunAt, '2026-06-26T02:00:00.000Z');
    });

    test('displayName maps correctly', () {
      final loop = BackgroundLoopStatus.fromJson({
        'name': 'memory',
        'state': 'idle',
        'lastRunAt': null,
        'nextRunAt': null,
      });
      expect(loop.displayName, 'Memory consolidation');
    });

    test('unknown loop name returns raw name as displayName', () {
      final loop = BackgroundLoopStatus.fromJson({
        'name': 'custom_loop',
        'state': 'idle',
        'lastRunAt': null,
        'nextRunAt': null,
      });
      expect(loop.displayName, 'custom_loop');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Controller state transitions
  // ---------------------------------------------------------------------------

  group('BackgroundActivityController', () {
    test('starts with null status and hasActivity=false', () {
      final ctrl = BackgroundActivityController(
        _FakeDataSource(_makeStatus()),
        pollInterval: const Duration(hours: 1), // don't auto-poll in test
      );
      expect(ctrl.status, isNull);
      expect(ctrl.hasActivity, false);
      expect(ctrl.activeCount, 0);
      expect(ctrl.loops, isEmpty);
      ctrl.dispose();
    });

    test('startPolling() fetches and notifies listeners', () async {
      final ctrl = BackgroundActivityController(
        _FakeDataSource(_makeStatus(activeCount: 0)),
        pollInterval: const Duration(hours: 1),
      );
      bool notified = false;
      ctrl.addListener(() => notified = true);

      ctrl.startPolling();
      // Wait for the first fetch.
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(ctrl.status, isNotNull);
      expect(ctrl.hasActivity, false);
      expect(notified, true);
      ctrl.dispose();
    });

    test('reflects running loops in hasActivity and activeCount', () async {
      final ctrl = BackgroundActivityController(
        _FakeDataSource(_makeRunningStatus()),
        pollInterval: const Duration(hours: 1),
      );
      ctrl.startPolling();
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(ctrl.hasActivity, true);
      expect(ctrl.activeCount, 2);
      expect(ctrl.loops, hasLength(5));
      ctrl.dispose();
    });

    test('startPolling() is idempotent — second call is a no-op', () async {
      final ctrl = BackgroundActivityController(
        _FakeDataSource(_makeStatus()),
        pollInterval: const Duration(hours: 1),
      );
      ctrl.startPolling();
      ctrl.startPolling(); // should not start a second timer
      await Future<void>.delayed(const Duration(milliseconds: 50));
      ctrl.dispose(); // must not throw
    });

    test('dispose() stops timer and no fetch happens after', () async {
      final ctrl = BackgroundActivityController(
        _FakeDataSource(_makeStatus()),
        pollInterval: const Duration(milliseconds: 20),
      );
      ctrl.startPolling();
      await Future<void>.delayed(const Duration(milliseconds: 30));
      ctrl.dispose();

      // Wait longer — no crash, no further state change.
      await Future<void>.delayed(const Duration(milliseconds: 60));
    });
  });

  // ---------------------------------------------------------------------------
  // 3 & 4. Widget tests
  // ---------------------------------------------------------------------------

  Widget _buildTestWidget(BackgroundActivityController ctrl) {
    return MaterialApp(
      home: ChangeNotifierProvider<BackgroundActivityController>.value(
        value: ctrl,
        child: const Scaffold(
          body: Center(child: BackgroundActivityIndicator()),
        ),
      ),
    );
  }

  group('BackgroundActivityIndicator', () {
    testWidgets('renders in idle state (no activity)', (tester) async {
      final ctrl = BackgroundActivityController(
        _FakeDataSource(_makeStatus()),
        pollInterval: const Duration(hours: 1),
      );

      // Mount the widget first so tester owns the ticker/vsync,
      // then trigger the fetch and advance fake time.
      await tester.pumpWidget(_buildTestWidget(ctrl));
      ctrl.startPolling();
      // One pump lets the async fetch (which resolves immediately) complete.
      await tester.pump();

      // In idle state there is no count text — only the dot.
      expect(find.byType(BackgroundActivityIndicator), findsOneWidget);
      // No count text when idle.
      expect(find.text('0'), findsNothing);
      // GestureDetector wraps the dot for tap-to-open-popover.
      expect(find.byType(GestureDetector), findsWidgets);

      ctrl.dispose();
    });

    testWidgets('idle does not schedule repeating animation frames',
        (tester) async {
      final ctrl = BackgroundActivityController(
        _FakeDataSource(_makeStatus()),
        pollInterval: const Duration(hours: 1),
      );

      await tester.pumpWidget(_buildTestWidget(ctrl));
      ctrl.startPolling();
      await tester.pump();
      await tester.pump();

      expect(ctrl.hasActivity, isFalse);
      expect(tester.binding.hasScheduledFrame, isFalse);

      ctrl.dispose();
    });

    testWidgets('renders active count when loops are running', (tester) async {
      final ctrl = BackgroundActivityController(
        _FakeDataSource(_makeRunningStatus()),
        pollInterval: const Duration(hours: 1),
      );

      await tester.pumpWidget(_buildTestWidget(ctrl));
      ctrl.startPolling();
      await tester.pump();

      // Active count '2' should appear.
      expect(find.text('2'), findsOneWidget);

      ctrl.dispose();
    });

    testWidgets('active-to-idle-to-active restarts the pulse', (tester) async {
      final source = _FakeDataSource(_makeRunningStatus());
      final ctrl = BackgroundActivityController(
        source,
        pollInterval: const Duration(milliseconds: 10),
      );

      await tester.pumpWidget(_buildTestWidget(ctrl));
      ctrl.startPolling();
      await tester.pump();
      expect(ctrl.hasActivity, isTrue);
      expect(tester.binding.hasScheduledFrame, isTrue);

      source.status = _makeStatus();
      await tester.pump(const Duration(milliseconds: 11));
      await tester.pump();
      expect(ctrl.hasActivity, isFalse);
      expect(tester.binding.hasScheduledFrame, isFalse);

      source.status = _makeRunningStatus();
      await tester.pump(const Duration(milliseconds: 11));
      await tester.pump();
      expect(ctrl.hasActivity, isTrue);
      expect(tester.binding.hasScheduledFrame, isTrue);

      final before = tester.widget<Opacity>(find.byType(Opacity)).opacity;
      await tester.pump(const Duration(milliseconds: 300));
      final after = tester.widget<Opacity>(find.byType(Opacity)).opacity;
      expect(after, isNot(before));

      ctrl.dispose();
    });

    testWidgets('renders idle state when controller has no data yet',
        (tester) async {
      final ctrl = BackgroundActivityController(
        _FakeDataSource(_makeStatus()),
        pollInterval: const Duration(hours: 1),
        // Don't call startPolling — status stays null.
      );

      await tester.pumpWidget(_buildTestWidget(ctrl));
      // One pump to let the widget settle without triggering any fetch.
      await tester.pump();

      // Should render the idle dot, no crash.
      expect(find.byType(BackgroundActivityIndicator), findsOneWidget);

      ctrl.dispose();
    });
  });
}
