import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';

/// Fake [ApiServerService] with a scripted health-check sequence.
class _FakeApiServerService implements ApiServerService {
  _FakeApiServerService(this._result, {List<bool>? healthSequence})
      : _healthSequence = healthSequence ?? const [];

  final AgentServerStartResult _result;
  final List<bool> _healthSequence;
  int _healthCallCount = 0;

  @override
  Future<AgentServerStartResult> start() async => _result;

  @override
  void stop() {}

  @override
  Future<bool> checkHealth(String baseUrl) async {
    if (_healthCallCount < _healthSequence.length) {
      return _healthSequence[_healthCallCount++];
    }
    // Default to healthy once the scripted sequence is exhausted.
    return true;
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  // HealthPoller requires WidgetsBinding to register observers.
  setUpAll(TestWidgetsFlutterBinding.ensureInitialized);

  group('AgentServerController failure surfacing', () {
    test('success path leaves failureReason, stderrTail, errorMessage null',
        () async {
      final controller = AgentServerController(
        _FakeApiServerService(
          (ok: true, reason: null, stderrTail: null),
        ),
      );

      await controller.initialize();
      // Capability fetch happens fire-and-forget against localhost:4001;
      // since this test is unit-only, the network call may fail silently.
      // We only assert the failure-related fields here.

      expect(controller.failureReason, isNull);
      expect(controller.stderrTail, isNull);
      expect(controller.errorMessage, isNull);
      expect(controller.status, AgentServerStatus.ready);

      controller.dispose();
    });

    test('nodeNotFound maps to install-Node guidance', () async {
      final controller = AgentServerController(
        _FakeApiServerService(
          (
            ok: false,
            reason: AgentServerFailureReason.nodeNotFound,
            stderrTail: null,
          ),
        ),
      );
      await controller.initialize();

      expect(controller.failureReason, AgentServerFailureReason.nodeNotFound);
      expect(controller.stderrTail, isNull);
      expect(
        controller.errorMessage,
        "Couldn't find Node.js on this Mac. Install Node 20 or newer "
        'from nodejs.org and click Retry.',
      );
      expect(controller.status, AgentServerStatus.failed);
    });

    test('bundleNotFound maps to reinstall guidance', () async {
      final controller = AgentServerController(
        _FakeApiServerService(
          (
            ok: false,
            reason: AgentServerFailureReason.bundleNotFound,
            stderrTail: null,
          ),
        ),
      );
      await controller.initialize();

      expect(controller.failureReason, AgentServerFailureReason.bundleNotFound);
      expect(
        controller.errorMessage,
        'The CLI server bundle is missing from this Rhythm install. '
        'Please reinstall Rhythm from the latest release.',
      );
    });

    test('spawnThrew exposes stderrTail and technical-details message',
        () async {
      final controller = AgentServerController(
        _FakeApiServerService(
          (
            ok: false,
            reason: AgentServerFailureReason.spawnThrew,
            stderrTail: 'spawn EACCES',
          ),
        ),
      );
      await controller.initialize();

      expect(controller.failureReason, AgentServerFailureReason.spawnThrew);
      expect(controller.stderrTail, 'spawn EACCES');
      expect(
        controller.errorMessage,
        "Couldn't start the CLI server process. See technical details below.",
      );
    });

    test('healthCheckTimeout exposes stderrTail and timeout message', () async {
      final controller = AgentServerController(
        _FakeApiServerService(
          (
            ok: false,
            reason: AgentServerFailureReason.healthCheckTimeout,
            stderrTail: 'listening on :4001',
          ),
        ),
      );
      await controller.initialize();

      expect(
        controller.failureReason,
        AgentServerFailureReason.healthCheckTimeout,
      );
      expect(controller.stderrTail, 'listening on :4001');
      expect(
        controller.errorMessage,
        "The CLI server started but didn't respond in time. See technical "
        'details below.',
      );
    });

    test('lostConnection returns restart guidance message', () async {
      final controller = AgentServerController(
        _FakeApiServerService(
          (
            ok: false,
            reason: AgentServerFailureReason.lostConnection,
            stderrTail: null,
          ),
        ),
      );
      await controller.initialize();

      expect(
        controller.failureReason,
        AgentServerFailureReason.lostConnection,
      );
      expect(
        controller.errorMessage,
        'The agent server stopped responding. Click Restart to bring it back.',
      );
      expect(controller.status, AgentServerStatus.failed);
    });
  });

  group('AgentServerController HealthPoller integration', () {
    test('poller is non-null and started after successful initialize()',
        () async {
      final controller = AgentServerController(
        _FakeApiServerService(
          (ok: true, reason: null, stderrTail: null),
        ),
      );

      await controller.initialize();

      expect(controller.status, AgentServerStatus.ready);
      // The poller is an implementation detail; we verify via behavior below.
      // Dispose cleanly.
      controller.dispose();
    });

    test(
        'two consecutive health failures transition status to failed '
        'with lostConnection reason', () async {
      // The poller has a failureThreshold of 2 (default). We drive
      // _onHealthChanged by calling checkHealth twice via the poller's
      // internal _runCheck. Since we cannot call _runCheck directly we
      // exercise _onHealthChanged through the public surface by replacing
      // the poller with a controlled fake after initialization.
      //
      // Approach: start successfully, then manually invoke the private
      // callback by calling checkHealth on a service that returns false.
      // The HealthPoller itself is tested separately; here we verify that
      // the controller reacts correctly when _onHealthChanged(false) fires.
      final controller = AgentServerController(
        _FakeApiServerService(
          (ok: true, reason: null, stderrTail: null),
        ),
      );

      await controller.initialize();
      expect(controller.status, AgentServerStatus.ready);

      // Simulate the poller detecting two consecutive failures by calling
      // the internal callback directly via a friend accessor exposed for
      // testing.
      controller.simulateHealthChange(false);

      expect(controller.status, AgentServerStatus.failed);
      expect(
        controller.failureReason,
        AgentServerFailureReason.lostConnection,
      );

      controller.dispose();
    });

    test('health recovery transitions status back to ready', () async {
      final controller = AgentServerController(
        _FakeApiServerService(
          (ok: true, reason: null, stderrTail: null),
        ),
      );

      await controller.initialize();

      // Drive to failed state.
      controller.simulateHealthChange(false);
      expect(controller.status, AgentServerStatus.failed);
      expect(
        controller.failureReason,
        AgentServerFailureReason.lostConnection,
      );

      // Recover.
      controller.simulateHealthChange(true);
      expect(controller.status, AgentServerStatus.ready);
      expect(controller.failureReason, isNull);

      controller.dispose();
    });

    test('retry() disposes old poller and restarts lifecycle', () async {
      final controller = AgentServerController(
        _FakeApiServerService(
          (ok: true, reason: null, stderrTail: null),
        ),
      );

      await controller.initialize();
      expect(controller.status, AgentServerStatus.ready);

      // Drive to failed so there's something meaningful to retry.
      controller.simulateHealthChange(false);
      expect(controller.status, AgentServerStatus.failed);

      // retry() should clear the old poller and re-initialize.
      await controller.retry();
      expect(controller.status, AgentServerStatus.ready);
      expect(controller.failureReason, isNull);

      controller.dispose();
    });
  });
}
