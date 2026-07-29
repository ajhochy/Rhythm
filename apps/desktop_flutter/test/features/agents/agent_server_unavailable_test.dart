import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';

/// Fake [ApiServerService] used to construct an [AgentServerController]
/// without spawning real processes.
class _FakeApiServerService implements ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: false, reason: null, stderrTail: null, failureMessage: null);

  @override
  void stop() {}

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Subclass of [AgentServerController] that lets tests drive `status` and
/// counts calls to `retry()` without going through `initialize()`'s real
/// network/process work.
class _FakeAgentServerController extends AgentServerController {
  _FakeAgentServerController(super.service, AgentServerStatus initialStatus)
      : _fakeStatus = initialStatus;

  AgentServerStatus _fakeStatus;
  int retryCalls = 0;

  @override
  AgentServerStatus get status => _fakeStatus;

  void setStatus(AgentServerStatus next) {
    _fakeStatus = next;
    notifyListeners();
  }

  @override
  Future<void> retry() async {
    retryCalls += 1;
    setStatus(AgentServerStatus.starting);
  }

  @override
  void dispose() {
    // Skip super.dispose() — it would call _service.stop(), which is fine
    // for the fake but we also avoid touching the real teardown path.
    super.dispose();
  }
}

Widget _wrap(AgentServerController controller) {
  return ChangeNotifierProvider<AgentServerController>.value(
    value: controller,
    child: const MaterialApp(home: AgentServerUnavailable()),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AgentServerUnavailable', () {
    testWidgets('renders Retry button and check-Settings copy', (tester) async {
      final controller = _FakeAgentServerController(
        _FakeApiServerService(),
        AgentServerStatus.failed,
      );
      await tester.pumpWidget(_wrap(controller));

      expect(find.text('Agent server unavailable'), findsOneWidget);
      expect(
        find.textContaining('Settings'),
        findsOneWidget,
      );
      expect(find.text('Retry'), findsOneWidget);
      // Copy diagnostics belongs to Settings; must NOT appear here.
      expect(find.text('Copy diagnostics'), findsNothing);
    });

    testWidgets('tapping Retry invokes controller.retry()', (tester) async {
      final controller = _FakeAgentServerController(
        _FakeApiServerService(),
        AgentServerStatus.failed,
      );
      await tester.pumpWidget(_wrap(controller));

      expect(controller.retryCalls, 0);
      await tester.tap(find.text('Retry'));
      await tester.pump();

      expect(controller.retryCalls, 1);
    });

    testWidgets('disables button and shows spinner during starting',
        (tester) async {
      final controller = _FakeAgentServerController(
        _FakeApiServerService(),
        AgentServerStatus.starting,
      );
      await tester.pumpWidget(_wrap(controller));

      // Spinner is present.
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      // Button is disabled — onPressed is null.
      final button = tester.widget<OutlinedButton>(find.byType(OutlinedButton));
      expect(button.onPressed, isNull);
    });

    testWidgets('reactively transitions when controller status changes',
        (tester) async {
      final controller = _FakeAgentServerController(
        _FakeApiServerService(),
        AgentServerStatus.failed,
      );
      await tester.pumpWidget(_wrap(controller));

      // Initially failed — button is enabled, no spinner.
      expect(find.byType(CircularProgressIndicator), findsNothing);
      var button = tester.widget<OutlinedButton>(find.byType(OutlinedButton));
      expect(button.onPressed, isNotNull);

      // Flip to starting.
      controller.setStatus(AgentServerStatus.starting);
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      button = tester.widget<OutlinedButton>(find.byType(OutlinedButton));
      expect(button.onPressed, isNull);
    });
  });
}
