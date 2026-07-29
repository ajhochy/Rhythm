import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/settings/views/settings_view.dart';

class _FakeApiServerService implements ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: false, reason: null, stderrTail: null, failureMessage: null);

  @override
  void stop() {}

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _StatusController extends AgentServerController {
  _StatusController(this.value) : super(_FakeApiServerService());

  final AgentServerStatus value;

  @override
  AgentServerStatus get status => value;
}

Widget wrap(AgentServerStatus status, {VoidCallback? onOpen}) =>
    ChangeNotifierProvider<AgentServerController>(
      create: (_) => _StatusController(status),
      child: MaterialApp(
        home: Scaffold(body: MobileAccessSettingsSection(onOpen: onOpen)),
      ),
    );

void main() {
  final settingsSource = File(
    'lib/features/settings/views/settings_view.dart',
  ).readAsStringSync();

  test('issue-1239-c1: Mobile Access is a persistent Settings destination', () {
    // Regression caught: the only entry point lives inside
    // _AgentServerReady and disappears while the server starts or fails.
    expect(settingsSource, contains("Key('mobile-access-settings-item')"));
  });

  testWidgets(
    'issue-1239-c1-widget: destination renders outside Agent Server ready row',
    (tester) async {
      await tester.pumpWidget(wrap(AgentServerStatus.failed));

      expect(
        find.byKey(const Key('mobile-access-settings-item')),
        findsOneWidget,
      );
      expect(find.text('MOBILE ACCESS'), findsOneWidget);
      expect(find.text('Manage Mobile Access'), findsOneWidget);
    },
  );

  test(
    'issue-1239-c2: degraded agent-server states keep Mobile Access reachable',
    () {
      // Regression caught: starting/failed states offer no route to the
      // pairing and revocation surface.
      expect(
        settingsSource,
        contains("Key('mobile-access-agent-server-degraded')"),
      );
    },
  );

  testWidgets(
    'issue-1239-c2-widget: starting and failed states explain prerequisites',
    (tester) async {
      for (final status in [
        AgentServerStatus.starting,
        AgentServerStatus.failed,
      ]) {
        await tester.pumpWidget(wrap(status));
        expect(
          find.byKey(const Key('mobile-access-agent-server-degraded')),
          findsOneWidget,
        );
        expect(
          find.byKey(const Key('manage-mobile-access-button')),
          findsOneWidget,
        );
      }
    },
  );

  test(
    'issue-1239-c3: revocation remains reachable from the persistent item',
    () {
      // Regression caught: Settings labels the action as enable-only, hiding
      // the fact that existing paired credentials can be inspected/revoked.
      expect(settingsSource, contains("Text('Manage Mobile Access')"));
    },
  );

  testWidgets(
    'issue-1239-c6: entry point is visible in every Agent Server state',
    (tester) async {
      for (final status in AgentServerStatus.values) {
        await tester.pumpWidget(wrap(status));
        expect(
          find.byKey(const Key('mobile-access-settings-item')),
          findsOneWidget,
          reason: 'Mobile Access disappeared for ${status.name}',
        );
        expect(
          find.byKey(const Key('manage-mobile-access-button')),
          findsOneWidget,
          reason: 'Manage action disappeared for ${status.name}',
        );
      }
    },
  );

  testWidgets(
    'issue-1239-c3-widget: persistent destination reaches device management',
    (tester) async {
      var opened = false;
      await tester.pumpWidget(
        wrap(AgentServerStatus.failed, onOpen: () => opened = true),
      );

      await tester.tap(find.byKey(const Key('manage-mobile-access-button')));

      expect(opened, isTrue);
    },
  );
}
