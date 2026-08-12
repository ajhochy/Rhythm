// Real-macOS Session Inspector artifact lifecycle smoke.
//
// Run only against tools/dev/sandbox.sh:
//   flutter test integration_test/session_inspector_artifacts_macos_test.dart \
//     -d macos --dart-define=RHYTHM_INSPECTOR_E2E=true \
//     --dart-define=RHYTHM_INSPECTOR_API_URL=http://localhost:4098 \
//     --dart-define=RHYTHM_INSPECTOR_TOKEN=... \
//     --dart-define=RHYTHM_INSPECTOR_SESSION_ID=... \
//     --dart-define=RHYTHM_INSPECTOR_ARTIFACT_ID=... \
//     --dart-define=RHYTHM_INSPECTOR_CREATE_PROMPT=... \
//     --dart-define=RHYTHM_INSPECTOR_UPDATE_PROMPT=...
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:integration_test/integration_test.dart';
import 'package:rhythm_desktop/app/core/auth/auth_session_store.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/transcript_artifact_extractor.dart';
import 'package:rhythm_desktop/features/agents/views/_artifacts_tab.dart';
import 'package:rhythm_desktop/features/live_artifacts/controllers/live_artifacts_controller.dart';
import 'package:rhythm_desktop/features/live_artifacts/data/live_artifacts_data_source.dart';
import 'package:rhythm_desktop/features/live_artifacts/widgets/dashboard_artifact_tabs.dart';
import 'package:rhythm_desktop/features/settings/data/user_preferences_data_source.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:webview_flutter/webview_flutter.dart';

const _enabled = bool.fromEnvironment('RHYTHM_INSPECTOR_E2E');
const _base = String.fromEnvironment('RHYTHM_INSPECTOR_API_URL');
const _token = String.fromEnvironment('RHYTHM_INSPECTOR_TOKEN');
const _sessionId = String.fromEnvironment('RHYTHM_INSPECTOR_SESSION_ID');
const _artifactId = String.fromEnvironment('RHYTHM_INSPECTOR_ARTIFACT_ID');
const _createPrompt = String.fromEnvironment('RHYTHM_INSPECTOR_CREATE_PROMPT');
const _updatePrompt = String.fromEnvironment('RHYTHM_INSPECTOR_UPDATE_PROMPT');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'session inspector mutation, native preview, reload, and stable Dashboard handoff',
    (tester) async {
      for (final entry in {
        'RHYTHM_INSPECTOR_API_URL': _base,
        'RHYTHM_INSPECTOR_TOKEN': _token,
        'RHYTHM_INSPECTOR_SESSION_ID': _sessionId,
        'RHYTHM_INSPECTOR_ARTIFACT_ID': _artifactId,
        'RHYTHM_INSPECTOR_CREATE_PROMPT': _createPrompt,
        'RHYTHM_INSPECTOR_UPDATE_PROMPT': _updatePrompt,
      }.entries) {
        expect(entry.value, isNotEmpty, reason: '${entry.key} is required');
      }
      AuthSessionStore.setSessionToken(_token);
      final source = LiveArtifactsDataSource(baseUrl: _base);
      final dashboardController = LiveArtifactsController(
        source,
        UserPreferencesDataSource(baseUrl: _base),
      );
      addTearDown(dashboardController.dispose);

      final ws = WebSocketChannel.connect(
        Uri.parse('${_base.replaceFirst(RegExp(r'^http'), 'ws')}/ws/agents'),
      );
      await ws.ready;
      addTearDown(() => ws.sink.close());

      ws.sink.add(jsonEncode({
        'v': 1,
        'type': 'session.input',
        'id': _sessionId,
        'data': _createPrompt,
      }));
      var messages = await _waitForMutation(afterMessageId: null);
      final created = extractTranscriptArtifactReferences(
        sessionId: _sessionId,
        messages: messages,
      ).firstWhere((reference) => reference.artifactId == _artifactId);

      WebViewController? nativeController;
      var nativeReadyCount = 0;
      var inspectorDisposed = 0;
      var dashboardShown = false;
      late StateSetter updateHost;
      Widget host() => MaterialApp(
            home: Scaffold(
              body: StatefulBuilder(
                builder: (context, setState) {
                  updateHost = setState;
                  if (dashboardShown) {
                    return DashboardArtifactWorkspace(
                      workspaceId: 1,
                      dashboard: const Center(child: Text('Dashboard home')),
                      controller: dashboardController,
                      baseUrl: _base,
                      manageAuthLifecycle: false,
                    );
                  }
                  return ArtifactsTab(
                    key: const ValueKey('native-session-inspector'),
                    sessionId: _sessionId,
                    userId: 1,
                    initialMessages: messages,
                    dataSource: source,
                    dashboardController: dashboardController,
                    onNavigateToDashboard: () {
                      updateHost(() => dashboardShown = true);
                    },
                    debugOnNativeReady: (controller, inspectableDisabled) {
                      expect(inspectableDisabled, isTrue);
                      nativeController = controller;
                      nativeReadyCount++;
                    },
                    debugOnViewerDisposed: () => inspectorDisposed++,
                  );
                },
              ),
            ),
          );

      await tester.pumpWidget(host());
      await tester.pumpAndSettle(const Duration(seconds: 2));
      expect(nativeController, isNotNull);
      expect(nativeReadyCount, 1);
      expect(find.byKey(const ValueKey('artifact-preview-$_artifactId')),
          findsOneWidget);
      await nativeController!.runJavaScript('window.inspectorProof="kept"');

      await tester.binding.setSurfaceSize(const Size(420, 700));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pump();
      expect(nativeReadyCount, 1, reason: 'resize must retain the WKWebView');
      expect(
        '${await nativeController!.runJavaScriptReturningResult('window.inspectorProof')}',
        contains('kept'),
      );

      ws.sink.add(jsonEncode({
        'v': 1,
        'type': 'session.input',
        'id': _sessionId,
        'data': _updatePrompt,
      }));
      messages = await _waitForMutation(afterMessageId: created.messageId);
      updateHost(() {});
      await tester.pumpAndSettle(const Duration(seconds: 2));
      expect(nativeReadyCount, 1,
          reason: 'mutation reload must reuse the stable WKWebView');
      expect(find.byKey(const ValueKey('artifact-preview-$_artifactId')),
          findsOneWidget);

      await tester.tap(
        find.byKey(const ValueKey('artifact-open-dashboard-button')),
      );
      await tester.pumpAndSettle(const Duration(seconds: 2));
      expect(dashboardController.selectedId, _artifactId);
      expect(
        dashboardController.tabs.where((tab) => tab.id == _artifactId),
        hasLength(1),
      );
      expect(inspectorDisposed, 1);
      expect(find.byType(DashboardArtifactWorkspace), findsOneWidget);
    },
    skip: !_enabled,
  );
}

Future<List<AgentSessionMessage>> _waitForMutation(
    {int? afterMessageId}) async {
  final deadline = DateTime.now().add(const Duration(minutes: 2));
  while (DateTime.now().isBefore(deadline)) {
    final response = await http.get(
      Uri.parse('$_base/agent-sessions/$_sessionId/messages?limit=100'),
      headers: AuthSessionStore.headers(),
    );
    expect(response.statusCode, 200);
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final messages = (body['messages'] as List<dynamic>? ?? const [])
        .map(
          (item) => AgentSessionMessage.fromStructuredJson(
            item as Map<String, dynamic>,
          ),
        )
        .toList();
    final references = extractTranscriptArtifactReferences(
      sessionId: _sessionId,
      messages: messages,
    );
    if (references.any(
      (reference) =>
          reference.artifactId == _artifactId &&
          (afterMessageId == null || reference.messageId != afterMessageId),
    )) {
      return messages;
    }
    await Future<void>.delayed(const Duration(milliseconds: 500));
  }
  fail('Timed out waiting for artifact mutation $_artifactId in $_sessionId');
}
