import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:rhythm_mobile/app/core/auth/auth_session_store.dart';
import 'package:rhythm_mobile/app/core/ui/tokens/rhythm_theme.dart';
import 'package:rhythm_mobile/features/tasks/controllers/tasks_controller.dart';
import 'package:rhythm_mobile/features/tasks/data/tasks_data_source.dart';
import 'package:rhythm_mobile/features/tasks/repositories/tasks_repository.dart';
import 'package:rhythm_mobile/features/tasks/views/quick_add_view.dart';

const _liveEnabled = bool.fromEnvironment('RHYTHM_LIVE_E2E');
const _isolated = bool.fromEnvironment('RHYTHM_LIVE_E2E_ISOLATED');
const _liveUrl = String.fromEnvironment('RHYTHM_LIVE_URL');
const _sessionToken = String.fromEnvironment('RHYTHM_LIVE_SESSION_TOKEN');

class _MutableClock {
  _MutableClock(this.value);

  DateTime value;

  DateTime call() => value;
}

/// Restores the real dart:io client that flutter_test replaces with a
/// synthetic HTTP-400 client by default.
class _LiveHttpOverrides extends HttpOverrides {}

void main() {
  testWidgets(
    'Quick Add persists the rolled-over due date through the live sandbox API',
    (tester) async {
      expect(_isolated, isTrue,
          reason: 'live Quick Add verification requires the isolated sandbox');
      final baseUri = Uri.parse(_liveUrl);
      expect(baseUri.scheme, 'http');
      expect(baseUri.host, anyOf('127.0.0.1', 'localhost'));
      expect(baseUri.port, 4098);
      expect(_sessionToken, isNotEmpty);

      final previousHttpOverrides = HttpOverrides.current;
      HttpOverrides.global = _LiveHttpOverrides();
      AuthSessionStore.setSessionToken(_sessionToken);
      final controller = TasksController(
        TasksRepository(TasksDataSource(baseUrl: _liveUrl)),
      );
      final clock = _MutableClock(DateTime(2026, 5, 5, 23, 59));
      final title =
          'quick-add-rollover-${DateTime.now().microsecondsSinceEpoch}';
      var taskCreatedCallbacks = 0;
      String? createdTaskId;

      addTearDown(() async {
        if (createdTaskId != null) {
          await http.delete(
            Uri.parse('$_liveUrl/tasks/$createdTaskId'),
            headers: AuthSessionStore.headers(),
          );
        }
        AuthSessionStore.setSessionToken(null);
        HttpOverrides.global = previousHttpOverrides;
        controller.dispose();
      });

      late http.Response healthResponse;
      late http.Response authResponse;
      await tester.runAsync(() async {
        healthResponse = await http.get(Uri.parse('$_liveUrl/health'));
        authResponse = await http.get(
          Uri.parse('$_liveUrl/auth/me'),
          headers: AuthSessionStore.headers(),
        );
      });
      expect(healthResponse.statusCode, 200, reason: healthResponse.body);
      expect(authResponse.statusCode, 200, reason: authResponse.body);

      await tester.pumpWidget(
        ChangeNotifierProvider<TasksController>.value(
          value: controller,
          child: MaterialApp(
            theme: ThemeData(
              extensions: const <ThemeExtension<dynamic>>[
                RhythmColorRoles.light,
              ],
            ),
            home: QuickAddView(
              now: clock.call,
              onTaskCreated: () => taskCreatedCallbacks++,
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('May 5, 2026'), findsOneWidget);

      clock.value = DateTime(2026, 5, 6, 0, 1);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(find.text('May 6, 2026'), findsOneWidget);

      await tester.enterText(find.byType(TextField).first, title);
      await tester.pump();
      final saveButton = tester.widget<TextButton>(
        find.widgetWithText(TextButton, 'Save'),
      );
      expect(saveButton.onPressed, isNotNull);
      await tester.runAsync(() async {
        saveButton.onPressed!.call();
        final deadline = DateTime.now().add(const Duration(seconds: 10));
        while (controller.tasks.isEmpty &&
            controller.errorMessage == null &&
            DateTime.now().isBefore(deadline)) {
          await Future<void>.delayed(const Duration(milliseconds: 50));
        }
      });
      await tester.pump();

      expect(
        controller.errorMessage,
        isNull,
        reason: 'Quick Add live create failed: ${controller.errorMessage}',
      );
      expect(controller.tasks, hasLength(1));
      expect(controller.tasks.single.dueDate, '2026-05-06');
      createdTaskId = controller.tasks.single.id;

      for (var frame = 0; frame < 20 && taskCreatedCallbacks == 0; frame++) {
        await tester.pump(const Duration(milliseconds: 10));
      }
      expect(taskCreatedCallbacks, 1);

      late http.Response response;
      await tester.runAsync(() async {
        response = await http.get(
          Uri.parse(
            '$_liveUrl/tasks?status=all&search=${Uri.encodeQueryComponent(title)}',
          ),
          headers: AuthSessionStore.headers(),
        );
      });
      expect(response.statusCode, 200, reason: response.body);
      final rows = (jsonDecode(response.body) as List<dynamic>)
          .cast<Map<String, dynamic>>();
      final persisted = rows.singleWhere((row) => row['id'] == createdTaskId);
      expect(persisted['title'], title);
      expect(persisted['dueDate'], '2026-05-06');
    },
    skip: !_liveEnabled,
  );
}
