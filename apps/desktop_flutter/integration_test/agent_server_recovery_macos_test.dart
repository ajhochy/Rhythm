// Safe real-macOS owned-process recovery smoke.
//
// This test launches only a short-lived /bin/sh helper. It never runs app.main,
// binds an API/engine port, reads a live database, or starts api_server:
//   flutter test integration_test/agent_server_recovery_macos_test.dart -d macos
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';

class _HelperProcessApiServerService extends ApiServerService {
  _HelperProcessApiServerService({required super.diagnosticsLog});

  int startCalls = 0;

  @override
  int? get currentOwnedProcessGeneration => startCalls;

  @override
  Future<AgentServerStartResult> start() async {
    startCalls++;
    return (ok: true, reason: null, stderrTail: null, failureMessage: null);
  }

  @override
  Future<bool> checkHealth(String baseUrl) async => true;

  @override
  void stop() {}

  @override
  Future<void> stopGracefully() async {}
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'real helper exit drives controller recovery and durable diagnostics',
    (tester) async {
      final temp =
          await Directory.systemTemp.createTemp('rhythm-recovery-macos-');
      addTearDown(() => temp.delete(recursive: true));
      final logFile = File('${temp.path}/agent-server-crash.log');
      final service = _HelperProcessApiServerService(
        diagnosticsLog: AgentServerDiagnosticsLog(
          file: logFile,
          maxBytes: 4096,
        ),
      );
      final controller = AgentServerController(
        service,
        recoveryBackoff: (_) => Duration.zero,
        capabilitiesRequest: (_) async => http.Response('{}', 200),
      );
      addTearDown(controller.dispose);

      await controller.initialize();
      expect(controller.status, AgentServerStatus.ready);
      expect(service.startCalls, 1);

      final child = await Process.start('/bin/sh', [
        '-c',
        "printf 'native-macos-final-no-newline' >&2; exit 17",
      ]);
      await service.superviseOwnedProcessForTesting(child);
      await tester.pump();
      await tester.pump();

      expect(service.startCalls, 2);
      expect(controller.status, AgentServerStatus.ready);
      expect(await logFile.readAsString(),
          contains('native-macos-final-no-newline'));
    },
  );
}
