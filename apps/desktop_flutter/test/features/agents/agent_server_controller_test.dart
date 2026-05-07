import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';

/// Fake [ApiServerService] that returns a pre-canned [AgentServerStartResult].
class _FakeApiServerService implements ApiServerService {
  _FakeApiServerService(this._result);

  final AgentServerStartResult _result;

  @override
  Future<AgentServerStartResult> start() async => _result;

  @override
  void stop() {}

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
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
  });
}
