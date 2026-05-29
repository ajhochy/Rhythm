/// Acceptance contract for issue #656 — composer-draft consume must be
/// build-safe (must NOT call notifyListeners during build).
///
/// ROOT CAUSE
/// ----------
/// #654 added `_TranscriptPanelState._maybeConsumeComposerDraft`, called from
/// `build()`. It invoked `AgentsController.consumeComposerDraft(id)`, which
/// called `notifyListeners()`. Calling notifyListeners() synchronously during
/// build marks the building widget dirty mid-build — illegal. In debug it
/// throws; in release the assert is stripped and it silently corrupts the
/// transcript panel's rebuild scheduling, so clicks/streaming/optimistic
/// input stop reliably updating the view.
///
/// CONTRACT
/// --------
/// `consumeComposerDraft` is a one-shot read invoked during build. It must
/// return + clear the staged draft WITHOUT firing listeners. `setComposerDraft`
/// (called outside build, before selectSession which notifies) likewise does
/// not need to notify, but the load-bearing invariant for the regression is
/// the consume path.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

class _FakeApiServerService extends ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: true, reason: null, stderrTail: null, failureMessage: null);
  @override
  Future<void> stop() async {}
}

class _FakeAgentServerController extends AgentServerController {
  _FakeAgentServerController() : super(_FakeApiServerService());
  @override
  bool get isReady => true;
  @override
  bool get hasAnyAgent => true;
  @override
  Future<void> initialize() async {}
}

class _FakeLocalNotificationService extends LocalNotificationService {
  @override
  Future<void> initialize() async {}
}

class _FakeNotificationsController extends NotificationsController {
  _FakeNotificationsController()
      : super(NotificationsRepository(
            NotificationsDataSource(baseUrl: 'http://x')));
  @override
  void startPolling() {}
  @override
  void stopPolling() {}
}

class _FakeAgentsRepository implements AgentsRepository {
  @override
  Future<void> connect() async {}
  @override
  Stream<AgentWsMessage> get messages => const Stream.empty();
  @override
  Stream<bool> get connectivityStream => const Stream.empty();
  @override
  bool get isConnected => true;
  @override
  void send(Map<String, dynamic> msg) {}
  @override
  Future<void> dispose() async {}
  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late AgentsController controller;

  setUp(() {
    controller = AgentsController(
      _FakeAgentsRepository(),
      _FakeAgentServerController(),
      _FakeLocalNotificationService(),
      _FakeNotificationsController(),
    );
  });

  tearDown(() => controller.dispose());

  test(
      'issue-656-c1: consumeComposerDraft returns the draft WITHOUT firing '
      'listeners (safe to call during build)', () {
    controller.setComposerDraft('s1', 'Add Annette Rip and Nate Rip');

    var notified = 0;
    controller.addListener(() => notified++);

    final draft = controller.consumeComposerDraft('s1');

    expect(draft, 'Add Annette Rip and Nate Rip');
    expect(
      notified,
      0,
      reason:
          'consumeComposerDraft is invoked during _TranscriptPanel.build(); '
          'firing notifyListeners() there marks the building widget dirty '
          'mid-build and corrupts transcript reactivity (#656).',
    );

    // One-shot: a second consume returns null and still does not notify.
    expect(controller.consumeComposerDraft('s1'), isNull);
    expect(notified, 0);
  });

  test(
      'issue-656-c1b: hasComposerDraft reflects staged state, consume clears it',
      () {
    expect(controller.hasComposerDraft('s2'), isFalse);
    controller.setComposerDraft('s2', 'hello');
    expect(controller.hasComposerDraft('s2'), isTrue);
    controller.consumeComposerDraft('s2');
    expect(controller.hasComposerDraft('s2'), isFalse);
  });
}
