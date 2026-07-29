/// Widget test for issue #1043 (OCU-02) — PermissionCard "Always allow"
/// button + deny-with-reason field, on both the standard inline card and the
/// destructive-tool modal dialog.
///
/// Pumps the real production `PermissionCard` widget (not a reimplemented
/// stand-in) wired to a real `AgentsController` backed by a fake repository,
/// per the "agents-inspector orphan" lesson (docs/ai/current-plan-mega-1042-1108.md
/// §6): isolated re-creations of a widget's UI don't prove the actual surface
/// works.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_permission_card.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';
import 'package:rhythm_desktop/features/settings/services/destructive_modal_service.dart';

// ---------------------------------------------------------------------------
// Minimal fakes — same pattern as issue_626_chip_status_flip_test.dart.
// ---------------------------------------------------------------------------

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

class _RecordingAgentsRepository implements AgentsRepository {
  _RecordingAgentsRepository()
    : _msgController = StreamController.broadcast(),
      _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  /// Records every respondPermission call as (decision, message).
  final List<(String, String?)> calls = [];

  void emit(AgentWsMessage msg) => _msgController.add(msg);

  @override
  Stream<AgentWsMessage> get messages => _msgController.stream;

  @override
  Stream<bool> get connectivityStream => _connectivityController.stream;

  @override
  bool get isConnected => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> dispose() async {
    await _msgController.close();
    await _connectivityController.close();
  }

  @override
  void send(Map<String, dynamic> msg) {}

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async => [];

  @override
  Future<void> respondPermission(
    String sessionId,
    String permissionId,
    String decision, {
    String? message,
  }) async {
    calls.add((decision, message));
  }

  // Everything else is unused by this test.
  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeLocalNotificationService extends LocalNotificationService {
  @override
  Future<void> showMessageNotification({
    required int id,
    required String title,
    required String body,
  }) async {}
}

class _FakeNotificationsController extends NotificationsController {
  _FakeNotificationsController()
    : super(NotificationsRepository(NotificationsDataSource()));

  @override
  void pushAgentNotification({
    required int id,
    required String title,
    required String body,
  }) {}
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

Widget _harness({
  required AgentsController controller,
  required DestructiveModalService destructiveModal,
  required String toolName,
}) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentsController>.value(value: controller),
      ChangeNotifierProvider<DestructiveModalService>.value(
        value: destructiveModal,
      ),
    ],
    child: MaterialApp(
      home: Scaffold(
        body: PermissionCard(
          sessionId: 'sess-1',
          permissionId: 'perm-1',
          title: 'Allow $toolName?',
          toolName: toolName,
          description: 'test permission',
        ),
      ),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _RecordingAgentsRepository repo;
  late AgentsController controller;
  late DestructiveModalService destructiveModal;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    repo = _RecordingAgentsRepository();
    controller = AgentsController(
      repo,
      _FakeAgentServerController(),
      _FakeLocalNotificationService(),
      _FakeNotificationsController(),
    );
    await controller.initialize();
    destructiveModal = DestructiveModalService();
  });

  tearDown(() {
    controller.dispose();
  });

  group('#1043 — standard PermissionCard', () {
    testWidgets('shows Always allow and calls alwaysAllowPermission', (
      tester,
    ) async {
      await tester.pumpWidget(
        _harness(
          controller: controller,
          destructiveModal: destructiveModal,
          toolName: 'read',
        ),
      );
      await tester.pump();

      expect(find.text('Always allow'), findsOneWidget);

      await tester.tap(find.byKey(const Key('permission_always_allow')));
      await tester.pump();

      expect(repo.calls, contains(('always', null)));
    });

    testWidgets('Deny reveals a reason field; submit sends the reason', (
      tester,
    ) async {
      await tester.pumpWidget(
        _harness(
          controller: controller,
          destructiveModal: destructiveModal,
          toolName: 'read',
        ),
      );
      await tester.pump();

      await tester.tap(find.text('Deny'));
      await tester.pump();

      final field = find.byType(TextField);
      expect(field, findsOneWidget);
      await tester.enterText(field, 'not needed right now');
      await tester.tap(find.text('Submit'));
      await tester.pump();

      expect(repo.calls, contains(('deny', 'not needed right now')));
    });

    testWidgets('Deny with an empty reason still submits (skippable)', (
      tester,
    ) async {
      await tester.pumpWidget(
        _harness(
          controller: controller,
          destructiveModal: destructiveModal,
          toolName: 'read',
        ),
      );
      await tester.pump();

      await tester.tap(find.text('Deny'));
      await tester.pump();
      await tester.tap(find.text('Submit'));
      await tester.pump();

      expect(repo.calls, contains(('deny', null)));
    });

    testWidgets('Accept still works', (tester) async {
      await tester.pumpWidget(
        _harness(
          controller: controller,
          destructiveModal: destructiveModal,
          toolName: 'read',
        ),
      );
      await tester.pump();

      await tester.tap(find.text('Accept'));
      await tester.pump();

      expect(repo.calls, contains(('accept', null)));
    });
  });

  group('#1043 — destructive-modal PermissionCard', () {
    setUp(() async {
      await destructiveModal.setEnabled(true);
    });

    testWidgets('modal shows Always allow and calls alwaysAllowPermission', (
      tester,
    ) async {
      await tester.pumpWidget(
        _harness(
          controller: controller,
          destructiveModal: destructiveModal,
          toolName: 'bash',
        ),
      );
      await tester.pump();
      await tester.pump();

      expect(find.text('Always allow'), findsOneWidget);
      await tester.tap(find.text('Always allow'));
      await tester.pumpAndSettle();

      expect(repo.calls, contains(('always', null)));
    });

    testWidgets('modal Deny reveals reason field and submits reason', (
      tester,
    ) async {
      await tester.pumpWidget(
        _harness(
          controller: controller,
          destructiveModal: destructiveModal,
          toolName: 'bash',
        ),
      );
      await tester.pump();
      await tester.pump();

      await tester.tap(find.text('Deny'));
      await tester.pump();

      final field = find.byType(TextField);
      expect(field, findsOneWidget);
      await tester.enterText(field, 'too risky');
      await tester.tap(find.text('Submit'));
      await tester.pumpAndSettle();

      expect(repo.calls, contains(('deny', 'too risky')));
    });
  });
}
