// CONTRACT TEST — agent-server-health-flap-c3.
//
// Bug this catches: the local API child (owned by this app, alive, PID
// intact) blocks its event loop for 15–30 s during a post-turn history scan.
// With a 15 s poll interval, a 2 s request timeout and a threshold of TWO
// consecutive failures, the controller flipped a live process to
// `AgentServerStatus.failed` after ~17 s of slowness and the Agents view
// replaced the chat with "Agent server unavailable" + Retry (2026-09-17
// disconnect triage). The assertion that fails on the old constants: status
// is still `ready` after the second consecutive failed poll.
import 'dart:async';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';

class _SlowHealthService implements ApiServerService {
  int healthCalls = 0;

  @override
  Future<AgentServerStartResult> start() async =>
      (ok: true, reason: null, stderrTail: null, failureMessage: null);

  /// The process boundary is the only thing faked: every poll after start
  /// reports "not healthy" (the real client times out against a blocked loop).
  @override
  Future<bool> checkHealth(String baseUrl) async {
    healthCalls++;
    return false;
  }

  @override
  void stop() {}

  @override
  Future<void> stopGracefully() async {}

  @override
  Stream<OwnedProcessExitEvent> get ownedProcessExitEvents =>
      const Stream<OwnedProcessExitEvent>.empty();

  @override
  int? get currentOwnedProcessGeneration => 1;

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
      'agent-server-health-flap-c3: two slow polls keep a live owned server '
      'ready; the third flips it', () {
    fakeAsync((async) {
      final service = _SlowHealthService();
      final controller = AgentServerController(
        service,
        capabilitiesRequest: (_) async => throw StateError('offline'),
      );
      controller.initialize();
      async.flushMicrotasks();
      expect(controller.status, AgentServerStatus.ready);
      // Poll 1 fires immediately on start(); poll 2 on the first interval.
      async.elapse(const Duration(seconds: 16));
      expect(service.healthCalls, greaterThanOrEqualTo(2));
      expect(controller.status, AgentServerStatus.ready,
          reason: 'two consecutive slow polls must not mark a live owned '
              'process as lost');
      // Poll 3 on the second interval: now the server is genuinely gone.
      async.elapse(const Duration(seconds: 15));
      expect(controller.status, AgentServerStatus.failed);
      expect(controller.failureReason, AgentServerFailureReason.lostConnection);
      controller.dispose();
    });
  });
}
