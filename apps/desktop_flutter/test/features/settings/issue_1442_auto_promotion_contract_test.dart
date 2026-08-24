import 'dart:io';
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:rhythm_desktop/features/settings/controllers/settings_controller.dart';
import 'package:rhythm_desktop/features/settings/data/settings_data_source.dart';
import 'package:rhythm_desktop/features/settings/models/auto_promotion_settings_state.dart';
import 'package:rhythm_desktop/features/settings/repositories/settings_repository.dart';
import 'package:rhythm_desktop/features/settings/widgets/auto_promotion_settings_section.dart';

class _FakeSettingsRepository extends SettingsRepository {
  _FakeSettingsRepository(this.current) : super(SettingsDataSource());

  AutoPromotionSettingsState current;
  Object? loadError;
  Completer<void>? loadCompleter;
  Object? saveError;
  Completer<void>? saveCompleter;
  int fetchCalls = 0;
  int saveCalls = 0;
  bool? requestedEnabled;

  @override
  Future<AutoPromotionSettingsState> fetchAutoPromotionState() async {
    fetchCalls++;
    if (loadCompleter != null) await loadCompleter!.future;
    if (loadError != null) throw loadError!;
    return current;
  }

  @override
  Future<AutoPromotionSettingsState> setAutoPromotionEnabled(
      bool enabled) async {
    saveCalls++;
    requestedEnabled = enabled;
    if (saveCompleter != null) await saveCompleter!.future;
    if (saveError != null) throw saveError!;
    current = AutoPromotionSettingsState(
      availability: current.availability,
      autoPromotionEnabled: enabled,
      enabledAt: enabled ? '2026-08-21T12:00:00.000Z' : null,
      autoPromotionEligible: current.autoPromotionEligible,
      totalVerified: current.totalVerified,
      totalRegressions: current.totalRegressions,
      trustThreshold: current.trustThreshold,
    );
    return current;
  }
}

const _eligibleOff = AutoPromotionSettingsState(
  availability: true,
  autoPromotionEnabled: false,
  enabledAt: null,
  autoPromotionEligible: true,
  totalVerified: 10,
  totalRegressions: 0,
  trustThreshold: 10,
);

Widget _wrap(SettingsController controller) => MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: AutoPromotionSettingsSection(controller: controller),
        ),
      ),
    );

void main() {
  final settingsSource =
      File('lib/features/settings/views/settings_view.dart').readAsStringSync();
  final sectionSource = File(
    'lib/features/settings/widgets/auto_promotion_settings_section.dart',
  ).readAsStringSync();

  test(
      'issue-1442-c6-red: Settings mounts an accessible auto-promotion control',
      () {
    // Regression caught: the desktop app has a backend opt-in but gives the
    // shipping Settings surface no way to read, explain, or change it.
    expect(sectionSource, contains('Auto-promote verified changes'));
    expect(sectionSource, contains('auto-promotion-toggle'));
    expect(settingsSource, contains('AutoPromotionSettingsSection'));
  });

  test(
    'issue-1442-c7: data source sends the exact code-owned confirmation header',
    () async {
      final client = MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/optimizer/auto-promotion');
        expect(
          request.headers['x-rhythm-auto-promotion-confirmation'],
          'enable-auto-promotion',
        );
        expect(request.body, jsonEncode({'enabled': true}));
        return http.Response(
          jsonEncode({
            'availability': true,
            'state': {
              'autoPromotionEnabled': true,
              'enabledAt': '2026-08-21T12:00:00.000Z',
              'autoPromotionEligible': true,
              'totalVerified': 10,
              'totalRegressions': 0,
              'trustThreshold': 10,
            },
          }),
          200,
        );
      });

      await http.runWithClient(
        () => SettingsDataSource(baseUrl: 'http://settings.test')
            .setAutoPromotionEnabled(true),
        () => client,
      );
    },
  );

  testWidgets(
      'issue-1442-c8: loading state is visible until the durable GET returns',
      (tester) async {
    final repository = _FakeSettingsRepository(_eligibleOff)
      ..loadCompleter = Completer<void>();
    final controller = SettingsController(repository);
    final pending = controller.refreshAutoPromotionState();
    await tester.pumpWidget(_wrap(controller));

    expect(find.byKey(const Key('auto-promotion-loading')), findsOneWidget);
    repository.loadCompleter!.complete();
    await pending;
    await tester.pump();
    expect(find.byKey(const Key('auto-promotion-toggle')), findsOneWidget);
  });

  testWidgets('issue-1442-c9: error state explains and retry recovers',
      (tester) async {
    final repository = _FakeSettingsRepository(_eligibleOff)
      ..loadError = StateError('server refused');
    final controller = SettingsController(repository);
    await controller.refreshAutoPromotionState();
    await tester.pumpWidget(_wrap(controller));

    expect(find.byKey(const Key('auto-promotion-error')), findsOneWidget);
    expect(find.byKey(const Key('auto-promotion-retry')), findsOneWidget);

    repository.loadError = null;
    await tester.tap(find.byKey(const Key('auto-promotion-retry')));
    await tester.pump();
    await tester.pump();
    expect(find.byKey(const Key('auto-promotion-toggle')), findsOneWidget);
    expect(repository.fetchCalls, 2);
  });

  testWidgets(
    'issue-1442-c10: enable requires warning confirmation; cancel does not mutate',
    (tester) async {
      final repository = _FakeSettingsRepository(_eligibleOff);
      final controller = SettingsController(repository);
      await controller.refreshAutoPromotionState();
      await tester.pumpWidget(_wrap(controller));

      await tester.tap(find.byKey(const Key('auto-promotion-toggle')));
      await tester.pumpAndSettle();
      expect(find.text('Enable auto-promotion?'), findsOneWidget);
      await tester.tap(find.byKey(const Key('auto-promotion-confirm-cancel')));
      await tester.pumpAndSettle();

      expect(repository.saveCalls, 0);
      expect(controller.autoPromotionState!.autoPromotionEnabled, isFalse);
    },
  );

  testWidgets(
    'issue-1442-c11: no optimistic state; success refreshes durable state and feedback',
    (tester) async {
      final repository = _FakeSettingsRepository(_eligibleOff)
        ..saveCompleter = Completer<void>();
      final controller = SettingsController(repository);
      await controller.refreshAutoPromotionState();
      await tester.pumpWidget(_wrap(controller));

      await tester.tap(find.byKey(const Key('auto-promotion-toggle')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('auto-promotion-confirm-enable')));
      await tester.pump();
      expect(controller.autoPromotionState!.autoPromotionEnabled, isFalse,
          reason: 'the switch must wait for the durable server refresh');
      expect(repository.saveCalls, 1);

      repository.saveCompleter!.complete();
      await tester.pumpAndSettle();
      expect(controller.autoPromotionState!.autoPromotionEnabled, isTrue);
      expect(repository.fetchCalls, 2,
          reason: 'mutation must be followed by a durable GET refresh');
      expect(find.text('Auto-promotion enabled.'), findsOneWidget);
    },
  );

  testWidgets(
      'issue-1442-c12: server refusal refreshes durable state and shows failure',
      (tester) async {
    final repository = _FakeSettingsRepository(_eligibleOff)
      ..saveError = StateError('Auto-promotion is unavailable on this server');
    final controller = SettingsController(repository);
    await controller.refreshAutoPromotionState();
    await tester.pumpWidget(_wrap(controller));

    await tester.tap(find.byKey(const Key('auto-promotion-toggle')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('auto-promotion-confirm-enable')));
    await tester.pumpAndSettle();

    expect(controller.autoPromotionState!.autoPromotionEnabled, isFalse);
    expect(repository.fetchCalls, 2);
    expect(
        find.textContaining('Failed to update auto-promotion'), findsOneWidget);
  });

  testWidgets(
      'issue-1442-c13: emergency disable remains available when unavailable',
      (tester) async {
    final repository = _FakeSettingsRepository(const AutoPromotionSettingsState(
      availability: false,
      autoPromotionEnabled: true,
      enabledAt: '2026-08-21T12:00:00.000Z',
      autoPromotionEligible: false,
      totalVerified: 10,
      totalRegressions: 1,
      trustThreshold: 10,
    ));
    final controller = SettingsController(repository);
    await controller.refreshAutoPromotionState();
    await tester.pumpWidget(_wrap(controller));

    expect(
        find.byKey(const Key('auto-promotion-availability')), findsOneWidget);
    await tester.tap(find.byKey(const Key('auto-promotion-toggle')));
    await tester.pumpAndSettle();

    expect(repository.requestedEnabled, isFalse);
    expect(controller.autoPromotionState!.autoPromotionEnabled, isFalse);
    expect(find.text('Auto-promotion disabled.'), findsOneWidget);
  });

  testWidgets(
    'issue-1442-c14: toggle exposes its semantic label and keyboard opens the warning',
    (tester) async {
      final semantics = tester.ensureSemantics();
      final repository = _FakeSettingsRepository(_eligibleOff);
      final controller = SettingsController(repository);
      await controller.refreshAutoPromotionState();
      await tester.pumpWidget(_wrap(controller));

      expect(
        tester.getSemantics(find.byKey(const Key('auto-promotion-toggle'))),
        isSemantics(hasEnabledState: true, isToggled: false),
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pumpAndSettle();
      expect(find.text('Enable auto-promotion?'), findsOneWidget);
      semantics.dispose();
    },
  );

  testWidgets(
    'issue-1442-c15: desktop settings surface has a stable verified opt-in visual',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(760, 560));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final repository = _FakeSettingsRepository(_eligibleOff);
      final controller = SettingsController(repository);
      await controller.refreshAutoPromotionState();
      await tester.pumpWidget(_wrap(controller));

      await expectLater(
        find.byType(AutoPromotionSettingsSection),
        matchesGoldenFile('goldens/issue_1442_auto_promotion_ready.png'),
      );
    },
  );

  testWidgets(
    'issue-1442-c16: enable warning dialog has a stable desktop visual',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(760, 560));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final repository = _FakeSettingsRepository(_eligibleOff);
      final controller = SettingsController(repository);
      await controller.refreshAutoPromotionState();
      await tester.pumpWidget(_wrap(controller));
      await tester.tap(find.byKey(const Key('auto-promotion-toggle')));
      await tester.pumpAndSettle();

      await expectLater(
        find.byType(AlertDialog),
        matchesGoldenFile('goldens/issue_1442_auto_promotion_warning.png'),
      );
    },
  );
}
