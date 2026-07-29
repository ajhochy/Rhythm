import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:rhythm_desktop/app/core/constants/app_constants.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/settings/controllers/semantic_memory_controller.dart';
import 'package:rhythm_desktop/features/settings/data/semantic_memory_data_source.dart';
import 'package:rhythm_desktop/features/settings/widgets/semantic_memory_section.dart';

class _FakeSemanticMemoryDataSource implements SemanticMemoryDataSource {
  _FakeSemanticMemoryDataSource({
    SemanticMemoryStatus? status,
    this.candidates = const [],
  }) : currentStatus = status ??
            const SemanticMemoryStatus(
              enabled: false,
              state: 'disabled',
              hasExecutable: false,
            );

  SemanticMemoryStatus currentStatus;
  List<SemanticMemoryStatus> queuedStatuses = [];
  List<SemanticMemoryCandidate> candidates;
  SemanticMemoryHealth health = const SemanticMemoryHealth(
    ok: true,
    latencyMs: 12,
  );
  String? chosenPath;
  int enableCalls = 0;
  int disableCalls = 0;
  int healthCalls = 0;
  int retryCalls = 0;
  int rebuildCalls = 0;

  @override
  String get baseUrlForTest => AppConstants.agentLocalBaseUrl;

  @override
  Future<SemanticMemoryStatus> getStatus() async {
    if (queuedStatuses.isNotEmpty) {
      currentStatus = queuedStatuses.removeAt(0);
    }
    return currentStatus;
  }

  @override
  Future<List<SemanticMemoryCandidate>> discover() async => candidates;

  @override
  Future<void> chooseBinary(String path) async {
    chosenPath = path;
    currentStatus = const SemanticMemoryStatus(
      enabled: false,
      state: 'discovering',
      hasExecutable: true,
      discoverySource: 'user-selected',
    );
  }

  @override
  Future<void> enable() async {
    enableCalls++;
  }

  @override
  Future<void> disable() async {
    disableCalls++;
    currentStatus = const SemanticMemoryStatus(
      enabled: false,
      state: 'disabled',
      hasExecutable: true,
    );
  }

  @override
  Future<SemanticMemoryHealth> checkHealth() async {
    healthCalls++;
    return health;
  }

  @override
  Future<void> retry() async {
    retryCalls++;
  }

  @override
  Future<void> rebuild() async {
    rebuildCalls++;
  }
}

Widget _wrap(
  SemanticMemoryController controller, {
  Future<String?> Function()? binaryPicker,
  Future<bool> Function(Uri)? installGuideLauncher,
}) {
  return MaterialApp(
    theme: AppTheme.light(),
    home: Scaffold(
      body: SingleChildScrollView(
        child: SemanticMemorySection(
          key: ValueKey(controller),
          controller: controller,
          binaryPicker: binaryPicker ?? () async => null,
          installGuideLauncher: installGuideLauncher ?? (uri) async => true,
        ),
      ),
    ),
  );
}

Future<void> _pump(
  WidgetTester tester,
  _FakeSemanticMemoryDataSource dataSource, {
  Future<String?> Function()? binaryPicker,
  Future<bool> Function(Uri)? installGuideLauncher,
}) async {
  final controller = SemanticMemoryController(
    dataSource,
    pollDelay: Duration.zero,
    maxPollAttempts: 4,
  );
  await tester.pumpWidget(
    _wrap(
      controller,
      binaryPicker: binaryPicker,
      installGuideLauncher: installGuideLauncher,
    ),
  );
  await tester.pump();
}

List<String> _visibleText(WidgetTester tester) {
  return tester
      .widgetList<Text>(find.byType(Text))
      .map((widget) => widget.data ?? '')
      .where((value) => value.isNotEmpty)
      .toList(growable: false);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'issue-1096-c12: Settings presents Semantic Memory as optional local and fail-safe',
    (tester) async {
      final dataSource = _FakeSemanticMemoryDataSource();
      await _pump(tester, dataSource);

      expect(find.text('Semantic Memory'), findsOneWidget);
      expect(find.textContaining('Optional, private search'), findsOneWidget);
      expect(find.textContaining('on this Mac'), findsOneWidget);
      expect(
        find.textContaining('standard memory search remains active'),
        findsWidgets,
      );

      final settingsSource = File(
        'lib/features/settings/views/settings_view.dart',
      ).readAsStringSync();
      expect(
        settingsSource,
        contains('const SemanticMemorySection()'),
        reason: 'the real Settings surface must mount the section',
      );
    },
  );

  testWidgets(
    'issue-1096-c13: every supported semantic-memory action is exposed',
    (tester) async {
      final offDataSource = _FakeSemanticMemoryDataSource(
        candidates: const [
          SemanticMemoryCandidate(
              path: '/opt/homebrew/bin/engraph', source: 'homebrew'),
        ],
      );
      Uri? launchedUri;
      await _pump(
        tester,
        offDataSource,
        installGuideLauncher: (uri) async {
          launchedUri = uri;
          return true;
        },
      );

      expect(find.text('Use detected Engraph'), findsOneWidget);
      expect(find.text('Choose Engraph'), findsOneWidget);
      expect(find.text('Install guide'), findsOneWidget);
      await tester.tap(find.byKey(const Key('semantic-memory-install-guide')));
      await tester.pump();
      expect(launchedUri, Uri.parse('https://github.com/devwhodevs/engraph'));

      final readyDataSource = _FakeSemanticMemoryDataSource(
        status: const SemanticMemoryStatus(
          enabled: true,
          state: 'ready',
          hasExecutable: true,
        ),
      );
      await _pump(tester, readyDataSource);
      expect(find.text('Disable'), findsOneWidget);
      expect(find.text('Check health'), findsOneWidget);
      expect(find.text('Rebuild index'), findsOneWidget);

      await tester.tap(find.byKey(const Key('semantic-memory-health')));
      await tester.pump();
      expect(readyDataSource.healthCalls, 1);

      final failedDataSource = _FakeSemanticMemoryDataSource(
        status: const SemanticMemoryStatus(
          enabled: true,
          state: 'error',
          hasExecutable: true,
          failureCategory: 'health_check_failed',
        ),
      );
      failedDataSource.queuedStatuses = [
        failedDataSource.currentStatus,
        const SemanticMemoryStatus(
          enabled: true,
          state: 'ready',
          hasExecutable: true,
        ),
      ];
      await _pump(tester, failedDataSource);
      await tester.tap(find.byKey(const Key('semantic-memory-retry')));
      await tester.pump();
      expect(failedDataSource.retryCalls, 1);
    },
  );

  testWidgets(
    'issue-1096-c14: backend lifecycle states render without blocking the UI',
    (tester) async {
      for (final state in [
        'disabled',
        'discovering',
        'indexing',
        'starting',
        'ready',
        'error',
      ]) {
        final dataSource = _FakeSemanticMemoryDataSource(
          status: SemanticMemoryStatus(
            enabled: state != 'disabled',
            state: state,
            hasExecutable: state != 'disabled',
            failureCategory: state == 'error' ? 'timeout' : null,
          ),
        );
        await _pump(tester, dataSource);
        expect(
          find.byKey(Key('semantic-memory-state-$state')),
          findsOneWidget,
          reason: 'missing backend state: $state',
        );
        if (state == 'discovering' ||
            state == 'indexing' ||
            state == 'starting') {
          expect(find.byType(CircularProgressIndicator), findsOneWidget);
          expect(find.textContaining('You can keep working'), findsOneWidget);
        }
      }
    },
  );

  testWidgets(
    'issue-1096-c15: setup guidance never asks staff for developer configuration',
    (tester) async {
      final dataSource = _FakeSemanticMemoryDataSource();
      await _pump(tester, dataSource);

      final copy = _visibleText(tester).join(' ').toLowerCase();
      for (final forbidden in [
        'environment variable',
        'shell configuration',
        'port',
        'token',
        '~/.engraph',
      ]) {
        expect(copy, isNot(contains(forbidden)));
      }
    },
  );

  testWidgets(
    'issue-1096-c16: selected binary is validated by the backend before enablement',
    (tester) async {
      final dataSource = _FakeSemanticMemoryDataSource();
      await _pump(
        tester,
        dataSource,
        binaryPicker: () async => '/private/tmp/engraph',
      );

      await tester.tap(find.byKey(const Key('semantic-memory-choose')));
      await tester.pump();

      expect(dataSource.chosenPath, '/private/tmp/engraph');
      expect(dataSource.enableCalls, 0);
      expect(dataSource.currentStatus.state, 'discovering');
      expect(
        dataSource.currentStatus.state,
        isNot('ready'),
        reason: 'selecting a local file never proves service health',
      );
    },
  );

  testWidgets(
    'issue-1096-c17: failure view is actionable accessible sanitized and reassuring',
    (tester) async {
      final dataSource = _FakeSemanticMemoryDataSource(
        status: const SemanticMemoryStatus(
          enabled: true,
          state: 'ready',
          hasExecutable: true,
        ),
      );
      dataSource.health = const SemanticMemoryHealth(
        ok: false,
        category: 'timeout',
      );
      await _pump(tester, dataSource);
      await tester.tap(find.byKey(const Key('semantic-memory-health')));
      await tester.pump();

      expect(find.textContaining('did not pass its local health check'),
          findsOneWidget);
      expect(find.textContaining('Standard memory search remains active'),
          findsOneWidget);
      expect(find.byKey(const Key('semantic-memory-retry')), findsOneWidget);
      expect(
        find.bySemanticsLabel(RegExp('Semantic Memory status:')),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'issue-1096-c18: macOS security guidance preserves system protection',
    (tester) async {
      final dataSource = _FakeSemanticMemoryDataSource(
        status: const SemanticMemoryStatus(
          enabled: true,
          state: 'error',
          hasExecutable: true,
          failureCategory: 'permission_denied',
        ),
      );
      await _pump(tester, dataSource);

      expect(find.textContaining('macOS blocked Engraph'), findsOneWidget);
      expect(find.textContaining('Privacy & Security in System Settings'),
          findsOneWidget);
      expect(find.textContaining('Do not bypass macOS protection'),
          findsOneWidget);
    },
  );

  testWidgets(
    "issue-1096-c19: rebuild confirmation scopes deletion to Rhythm's private index",
    (tester) async {
      final dataSource = _FakeSemanticMemoryDataSource(
        status: const SemanticMemoryStatus(
          enabled: true,
          state: 'ready',
          hasExecutable: true,
        ),
      );
      await _pump(tester, dataSource);

      await tester.tap(find.byKey(const Key('semantic-memory-rebuild')));
      await tester.pumpAndSettle();
      expect(
        find.textContaining("only Rhythm's private Application Support index"),
        findsOneWidget,
      );
      expect(
        find.textContaining(
            'Your memory notes and any other Engraph setup are not changed'),
        findsOneWidget,
      );
      expect(dataSource.rebuildCalls, 0);

      await tester
          .tap(find.byKey(const Key('semantic-memory-confirm-rebuild')));
      await tester.pumpAndSettle();
      expect(dataSource.rebuildCalls, 1);
    },
  );

  testWidgets(
    'issue-1096-c20: UI uses category guidance instead of backend sensitive fields',
    (tester) async {
      const secret = 'eg_deadbeef';
      const query = 'private staff query';
      const path = '/Users/example/secret/AGENT-MEMORY';
      final client = MockClient((request) async {
        expect(request.url.origin, AppConstants.agentLocalBaseUrl);
        return http.Response(
          jsonEncode({
            'enabled': true,
            'state': 'error',
            'executablePath': '/private/bin/engraph',
            'discoverySource': 'user-selected',
            'version': '1.7.2',
            'approvedMemoryRoot': path,
            'engraphHomeDir': '/Users/example/.engraph',
            'lastHealthyAt': null,
            'lastFailureCategory': 'permission_denied',
            'lastFailureMessage': 'failed $path $secret $query',
          }),
          200,
        );
      });
      final dataSource = SemanticMemoryDataSource(client: client);
      final controller = SemanticMemoryController(dataSource);
      await tester.pumpWidget(_wrap(controller));
      await tester.pump();

      final copy = _visibleText(tester).join(' ');
      expect(copy, isNot(contains(secret)));
      expect(copy, isNot(contains(query)));
      expect(copy, isNot(contains(path)));
      expect(copy, isNot(contains('/private/bin/engraph')));
      expect(copy, isNot(contains('/Users/example/.engraph')));
      expect(copy, contains('Standard memory search remains active'));
      expect(dataSource.baseUrlForTest, AppConstants.agentLocalBaseUrl);
    },
  );

  testWidgets(
    'visual smoke: Semantic Memory ready indexing and macOS permission states',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(920, 560));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final states = <String, SemanticMemoryStatus>{
        'ready': const SemanticMemoryStatus(
          enabled: true,
          state: 'ready',
          hasExecutable: true,
          version: '1.7.2',
        ),
        'indexing': const SemanticMemoryStatus(
          enabled: true,
          state: 'indexing',
          hasExecutable: true,
        ),
        'permission_error': const SemanticMemoryStatus(
          enabled: true,
          state: 'error',
          hasExecutable: true,
          failureCategory: 'permission_denied',
        ),
      };

      for (final entry in states.entries) {
        await _pump(
          tester,
          _FakeSemanticMemoryDataSource(status: entry.value),
        );
        await expectLater(
          find.byKey(const Key('semantic-memory-section')),
          matchesGoldenFile(
            'goldens/issue_1096_semantic_memory_${entry.key}.png',
          ),
        );
      }
    },
  );
}
