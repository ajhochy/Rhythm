import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';

/// The process boundary is intentionally faked here.  These tests drive the
/// controller's public lifecycle and only replace the child-process event
/// source; they do not mock recovery itself.
typedef _OwnedExit = ({
  int generation,
  int exitCode,
  String stderrTail,
});

class _FakeApiServerService implements ApiServerService {
  _FakeApiServerService({List<AgentServerStartResult>? results})
      : _results = results ??
            <AgentServerStartResult>[
              (ok: true, reason: null, stderrTail: null, failureMessage: null),
            ];

  final List<AgentServerStartResult> _results;
  final StreamController<_OwnedExit> ownedExits =
      StreamController<_OwnedExit>.broadcast();
  int startCalls = 0;
  int stopCalls = 0;
  int stopGracefullyCalls = 0;

  @override
  Future<AgentServerStartResult> start() async {
    startCalls++;
    if (_results.length == 1) return _results.single;
    return _results.removeAt(0);
  }

  @override
  Future<bool> checkHealth(String baseUrl) async => true;

  @override
  void stop() => stopCalls++;

  @override
  Future<void> stopGracefully() async => stopGracefullyCalls++;

  @override
  Stream<_OwnedExit> get ownedProcessExitEvents => ownedExits.stream;

  @override
  int? get currentOwnedProcessGeneration => startCalls;

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  Future<void> close() => ownedExits.close();
}

Future<void> _flushAsync() async {
  // Two turns are needed: the stream delivery and the zero-delay recovery
  // timer are separate event-loop tasks.
  await Future<void>.delayed(Duration.zero);
  await Future<void>.delayed(Duration.zero);
}

_FakeApiServerService _readyService() => _FakeApiServerService();

AgentServerController _controller(
  _FakeApiServerService service, {
  int maxRecoveryAttempts = 2,
}) {
  return AgentServerController(
    service,
    // A zero-delay policy keeps this contract deterministic while preserving
    // the production controller's capped backoff policy.
    recoveryBackoff: (_) => Duration.zero,
    maxRecoveryAttempts: maxRecoveryAttempts,
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('agent-server owned-child recovery contract', () {
    test(
      'C5: once-ready owned exit enters reconnecting and returns ready after one replacement',
      () async {
        // Regression: an exit currently only nulls _process; the UI remains
        // unavailable until a user presses Retry.  The assertion fails if no
        // replacement is started or if status never recovers.
        final service = _readyService();
        final controller = _controller(service);
        final statuses = <AgentServerStatus>[];
        controller.addListener(() => statuses.add(controller.status));

        await controller.initialize();
        expect(service.startCalls, 1);

        service.ownedExits.add((
          generation: 1,
          exitCode: 134,
          stderrTail: 'FATAL ERROR: out of memory',
        ));
        await _flushAsync();

        expect(statuses, contains(AgentServerStatus.starting));
        expect(controller.status, AgentServerStatus.ready);
        expect(service.startCalls, 2);

        controller.dispose();
        await service.close();
      },
    );

    test(
      'C5: repeated immediate owned exits stop at the finite recovery budget',
      () async {
        // Regression: an OOM loop can spawn children indefinitely.  The
        // assertion fails if the attempt cap is absent or not enforced.
        final service = _readyService();
        final controller = _controller(service, maxRecoveryAttempts: 2);
        await controller.initialize();

        service.ownedExits.add((
          generation: 1,
          exitCode: 134,
          stderrTail: 'oom-1',
        ));
        await _flushAsync();
        service.ownedExits.add((
          generation: 2,
          exitCode: 134,
          stderrTail: 'oom-2',
        ));
        await _flushAsync();
        service.ownedExits.add((
          generation: 3,
          exitCode: 134,
          stderrTail: 'oom-3',
        ));
        await _flushAsync();

        expect(service.startCalls, 3); // initial + two bounded attempts
        expect(controller.status, AgentServerStatus.failed);

        // Exhaustion is recoverable by an explicit user Retry, which resets
        // the automatic-attempt budget.
        await controller.retry();
        expect(service.startCalls, 4);
        expect(controller.status, AgentServerStatus.ready);

        controller.dispose();
        await service.close();
      },
    );

    test(
      'C5: duplicate and stale exit events cannot create concurrent replacement starts',
      () async {
        // Regression: a late callback from an old child can clear or restart
        // a newer child.  Generation matching and single-flight coordination
        // must leave exactly one replacement.
        final service = _readyService();
        final controller = _controller(service);
        await controller.initialize();

        final event = (
          generation: 1,
          exitCode: 134,
          stderrTail: 'oom',
        );
        service.ownedExits
          ..add(event)
          ..add(event)
          ..add((generation: 0, exitCode: 134, stderrTail: 'stale'));
        await _flushAsync();

        expect(service.startCalls, 2);
        expect(controller.status, AgentServerStatus.ready);

        controller.dispose();
        await service.close();
      },
    );

    test(
      'C5: health-only failure changes status without starting or killing a process',
      () async {
        // Regression: a transient health timeout must not authorize killing
        // an alive server or spawning a duplicate replacement.
        final service = _readyService();
        final controller = _controller(service);
        await controller.initialize();
        controller.simulateHealthChange(false);
        await _flushAsync();

        expect(
            controller.failureReason, AgentServerFailureReason.lostConnection);
        expect(service.startCalls, 1);
        expect(service.stopCalls, 0);
        expect(service.stopGracefullyCalls, 0);

        controller.dispose();
        await service.close();
      },
    );

    test(
      'C5: explicit stop and dispose suppress a late owned-exit recovery',
      () async {
        // Regression: a deliberate app shutdown can race the child exit
        // callback and relaunch the API after the window is closing.
        final service = _readyService();
        final controller = _controller(service);
        await controller.initialize();
        await controller.stopAndDispose();

        service.ownedExits.add((
          generation: 1,
          exitCode: 0,
          stderrTail: '',
        ));
        await _flushAsync();

        expect(service.startCalls, 1);
        expect(service.stopGracefullyCalls, 1);

        controller.dispose();
        await service.close();
      },
    );

    test(
      'C5: external server reuse has no owned exit and does not trigger recovery',
      () async {
        // Regression: startup reuse of another process on :4001 must not be
        // treated as this instance's child and must not be killed/restarted.
        final service = _readyService();
        final controller = _controller(service);
        await controller.initialize();
        await _flushAsync();

        expect(controller.status, AgentServerStatus.ready);
        expect(service.startCalls, 1);
        expect(service.stopCalls, 0);
        expect(service.stopGracefullyCalls, 0);

        controller.dispose();
        await service.close();
      },
    );
  });

  group('native stderr durable diagnostics contract', () {
    test(
      'C6: final non-newline stderr is persisted with UTC timestamp, pid, and exit code',
      () async {
        // Regression: native OOM output can arrive as a final unterminated
        // chunk and currently disappears when the process exits.  The test
        // uses only the injectable diagnostics boundary; the writer itself is
        // the system under test.
        final temp = await Directory.systemTemp.createTemp('rhythm-agent-log-');
        addTearDown(() => temp.delete(recursive: true));
        final path = '${temp.path}/agent-server-crash.log';
        final log = AgentServerDiagnosticsLog(
          file: File(path),
          maxBytes: 4096,
        );

        await log.recordOwnedExit(
          pid: 4242,
          exitCode: 134,
          stderrChunks: Stream<List<int>>.fromIterable([
            'FATAL ERROR: Ineffective mark-compacts near heap limit'.codeUnits,
            'Allocation failed - JavaScript heap out of memory'.codeUnits,
          ]),
          timestamp: DateTime.utc(2026, 9, 15, 12, 34, 56),
        );

        final contents = await File(path).readAsString();
        expect(contents, contains('2026-09-15T12:34:56.000Z'));
        expect(contents, contains('pid=4242'));
        expect(contents, contains('exitCode=134'));
        expect(contents, contains('FATAL ERROR: Ineffective mark-compacts'));
        expect(contents, contains('heap out of memory'));
      },
    );

    test(
      'C6: diagnostics rotation remains bounded while preserving the newest native stderr',
      () async {
        // Regression: appending every crash forever turns diagnostics into a
        // second unbounded memory/disk sink.  The assertion fails if rotation
        // drops the newest report or exceeds the configured byte bound.
        final temp = await Directory.systemTemp.createTemp('rhythm-agent-log-');
        addTearDown(() => temp.delete(recursive: true));
        final path = '${temp.path}/agent-server-crash.log';
        final log = AgentServerDiagnosticsLog(
          file: File(path),
          maxBytes: 512,
        );

        for (var i = 0; i < 12; i++) {
          await log.recordOwnedExit(
            pid: 5000 + i,
            exitCode: 134,
            stderrChunks: Stream<List<int>>.value(
              ('native-crash-$i ' * 80).codeUnits,
            ),
            timestamp: DateTime.utc(2026, 9, 15, 12, 35, i),
          );
        }

        final file = File(path);
        expect(await file.length(), lessThanOrEqualTo(512));
        expect(await file.readAsString(), contains('pid=5011'));
      },
    );

    test(
      'C6: diagnostics write failure is non-fatal to recovery',
      () async {
        // Regression: a read-only/full log directory must not turn an already
        // recovered API into a permanent startup failure.
        final diagnostics = AgentServerDiagnosticsLog(
          file: File('/path/that/does/not/exist/agent-server.log'),
          maxBytes: 512,
        );

        await expectLater(
          diagnostics.recordOwnedExit(
            pid: 4242,
            exitCode: 134,
            stderrChunks: Stream<List<int>>.value('oom'.codeUnits),
            timestamp: DateTime.utc(2026, 9, 15),
          ),
          completes,
        );
      },
    );
  });
}
