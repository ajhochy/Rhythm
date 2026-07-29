import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:package_info_plus/package_info_plus.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/settings/views/settings_view.dart';

Widget _wrap(Widget child) {
  return MaterialApp(home: Scaffold(body: child));
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  PackageInfo.setMockInitialValues(
    appName: 'Rhythm',
    packageName: 'com.example.rhythm',
    version: '1.2.3',
    buildNumber: '42',
    buildSignature: '',
  );

  group('AgentServerFailed widget', () {
    testWidgets('renders header and message with no failure reason',
        (tester) async {
      await tester.pumpWidget(_wrap(
        AgentServerFailed(
          errorMessage: 'Generic failure',
          onRetry: () {},
        ),
      ));

      expect(find.text('Agent server failed to start'), findsOneWidget);
      expect(find.text('Generic failure'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      expect(find.text('Copy diagnostics'), findsOneWidget);
      expect(find.text('Show technical details'), findsNothing);
    });

    for (final reason in AgentServerFailureReason.values) {
      testWidgets('renders for reason ${reason.name}', (tester) async {
        final hasTail = reason == AgentServerFailureReason.healthCheckTimeout ||
            reason == AgentServerFailureReason.spawnThrew;
        await tester.pumpWidget(_wrap(
          AgentServerFailed(
            errorMessage: 'msg-${reason.name}',
            failureReason: reason,
            stderrTail: hasTail ? 'STDERR_TAIL_FOR_${reason.name}' : null,
            onRetry: () {},
          ),
        ));

        expect(find.text('Agent server failed to start'), findsOneWidget);
        expect(find.text('msg-${reason.name}'), findsOneWidget);
        expect(find.text('Retry'), findsOneWidget);
        expect(find.text('Copy diagnostics'), findsOneWidget);

        if (hasTail) {
          expect(find.text('Show technical details'), findsOneWidget);
          // Default collapsed: stderr text should not be visible yet.
          expect(find.text('STDERR_TAIL_FOR_${reason.name}'), findsNothing);
          await tester.tap(find.text('Show technical details'));
          await tester.pumpAndSettle();
          expect(find.text('STDERR_TAIL_FOR_${reason.name}'), findsOneWidget);
        } else {
          expect(find.text('Show technical details'), findsNothing);
        }
      });
    }

    testWidgets('Copy diagnostics writes documented multi-line block',
        (tester) async {
      String? captured;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') {
          captured = (call.arguments as Map)['text'] as String?;
        }
        return null;
      });

      await tester.pumpWidget(_wrap(
        AgentServerFailed(
          errorMessage: 'health check timeout',
          failureReason: AgentServerFailureReason.healthCheckTimeout,
          stderrTail: 'EADDRINUSE :4001',
          onRetry: () {},
        ),
      ));

      await tester.tap(find.text('Copy diagnostics'));
      await tester.pumpAndSettle();

      expect(captured, isNotNull);
      final text = captured!;
      expect(text, contains('Rhythm CLI server diagnostics'));
      expect(text, contains('----------------------------'));
      expect(text, contains('Reason: healthCheckTimeout'));
      expect(text, contains('Message: health check timeout'));
      expect(text, contains('App version: '));
      expect(text, contains('macOS: '));
      expect(text, contains('Time: '));
      expect(text, contains('Stderr tail:'));
      expect(text, contains('EADDRINUSE :4001'));

      // Snackbar appears.
      expect(find.text('Diagnostics copied to clipboard'), findsOneWidget);

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null);
    });

    testWidgets('Copy diagnostics writes "(none)" when stderr is null',
        (tester) async {
      String? captured;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') {
          captured = (call.arguments as Map)['text'] as String?;
        }
        return null;
      });

      await tester.pumpWidget(_wrap(
        AgentServerFailed(
          errorMessage: 'bundle missing',
          failureReason: AgentServerFailureReason.bundleNotFound,
          stderrTail: null,
          onRetry: () {},
        ),
      ));

      await tester.tap(find.text('Copy diagnostics'));
      await tester.pumpAndSettle();

      expect(captured, isNotNull);
      expect(captured!, contains('Reason: bundleNotFound'));
      expect(captured!, contains('Stderr tail:'));
      expect(captured!, contains('(none)'));

      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null);
    });
  });
}
