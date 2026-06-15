import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/integrations/controllers/integrations_controller.dart';
import 'package:rhythm_desktop/features/integrations/data/integrations_data_source.dart';
import 'package:rhythm_desktop/features/integrations/models/integration_account.dart';
import 'package:rhythm_desktop/features/integrations/repositories/integrations_repository.dart';
import 'package:rhythm_desktop/features/integrations/views/integrations_view.dart';

// ---------------------------------------------------------------------------
// Counting stub for maybeAutoSyncCalendar tests
// ---------------------------------------------------------------------------

class _CountingRepository extends _FakeIntegrationsRepository {
  _CountingRepository({required super.accounts});

  int syncGoogleCalendarCallCount = 0;

  @override
  Future<void> syncGoogleCalendar() async {
    syncGoogleCalendarCallCount++;
  }
}

void main() {
  // -------------------------------------------------------------------------
  group('maybeAutoSyncCalendar', () {
    test(
      'triggers exactly one sync when account is connected + never synced, '
      'and is idempotent on second call',
      () async {
        final repo = _CountingRepository(
          accounts: [
            IntegrationAccount(
              id: 'google_calendar',
              provider: 'google_calendar',
              status: 'connected',
              connected: true,
              lastSyncedAt: null,
            ),
          ],
        );
        final controller = IntegrationsController(repo);

        // Populate _accounts without triggering the auto-sync via load(),
        // then call maybeAutoSyncCalendar directly.
        await controller.load();
        // Reset count — load() itself may have called maybeAutoSyncCalendar.
        final afterLoad = repo.syncGoogleCalendarCallCount;

        // First explicit call should sync once more (or, if load already did
        // it, the flag is set and this is a no-op).
        await controller.maybeAutoSyncCalendar();
        final afterFirst = repo.syncGoogleCalendarCallCount;

        // Second call must be idempotent.
        await controller.maybeAutoSyncCalendar();
        final afterSecond = repo.syncGoogleCalendarCallCount;

        // Total syncs triggered (from load + first explicit call) == 1.
        expect(afterLoad + (afterFirst - afterLoad), 1,
            reason: 'Expected exactly one sync across load + first call');
        // Second call adds zero.
        expect(afterSecond, afterFirst, reason: 'Second call must be a no-op');
      },
    );

    test(
      'triggers zero syncs when account status is needs_reauth',
      () async {
        final repo = _CountingRepository(
          accounts: [
            IntegrationAccount(
              id: 'google_calendar',
              provider: 'google_calendar',
              status: 'needs_reauth',
              connected: false,
              needsReauth: true,
              lastSyncedAt: null,
            ),
          ],
        );
        final controller = IntegrationsController(repo);
        await controller.load();
        repo.syncGoogleCalendarCallCount = 0; // reset any load-time calls

        await controller.maybeAutoSyncCalendar();
        expect(repo.syncGoogleCalendarCallCount, 0,
            reason: 'needs_reauth account must not trigger sync');
      },
    );

    test(
      'triggers zero syncs when account has already been synced',
      () async {
        final repo = _CountingRepository(
          accounts: [
            IntegrationAccount(
              id: 'google_calendar',
              provider: 'google_calendar',
              status: 'connected',
              connected: true,
              lastSyncedAt: '2024-01-01T00:00:00Z',
            ),
          ],
        );
        final controller = IntegrationsController(repo);
        await controller.load();
        repo.syncGoogleCalendarCallCount = 0; // reset any load-time calls

        await controller.maybeAutoSyncCalendar();
        expect(repo.syncGoogleCalendarCallCount, 0,
            reason: 'already-synced account must not trigger auto-sync');
      },
    );
  });
  // -------------------------------------------------------------------------
  group('IntegrationAccount.fromJson', () {
    test('parses needsReauth and status', () {
      final a = IntegrationAccount.fromJson(const {
        'id': 'google_calendar',
        'provider': 'google_calendar',
        'providerDisplayName': 'Google Calendar',
        'status': 'needs_reauth',
        'needsReauth': true,
      });
      expect(a.status, 'needs_reauth');
      expect(a.needsReauth, true);
    });

    test('defaults needsReauth to false when absent', () {
      final a = IntegrationAccount.fromJson(const {
        'id': 'google_calendar',
        'provider': 'google_calendar',
        'providerDisplayName': 'Google Calendar',
        'status': 'connected',
      });
      expect(a.needsReauth, false);
    });
  });

  group('Google Calendar card', () {
    testWidgets(
      'connected status shows Sync button and no Reconnect button',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(1400, 1200));
        addTearDown(() => tester.binding.setSurfaceSize(null));

        final repository = _FakeIntegrationsRepository(
          accounts: [
            IntegrationAccount(
              id: 'google_calendar',
              provider: 'google_calendar',
              status: 'connected',
              connected: true,
            ),
          ],
        );

        await _pumpIntegrationsView(tester, repository);

        expect(
          find.byKey(const ValueKey('integration-google_calendar-sync')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('integration-google_calendar-reconnect')),
          findsNothing,
        );
      },
    );

    testWidgets(
      'needs_reauth status shows Reconnect button and no Sync button',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(1400, 1200));
        addTearDown(() => tester.binding.setSurfaceSize(null));

        final repository = _FakeIntegrationsRepository(
          accounts: [
            IntegrationAccount(
              id: 'google_calendar',
              provider: 'google_calendar',
              status: 'needs_reauth',
              connected: false,
              needsReauth: true,
            ),
          ],
        );

        await _pumpIntegrationsView(tester, repository);

        expect(
          find.byKey(const ValueKey('integration-google_calendar-reconnect')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('integration-google_calendar-sync')),
          findsNothing,
        );
      },
    );
  });
}

Future<void> _pumpIntegrationsView(
  WidgetTester tester,
  _FakeIntegrationsRepository repository,
) async {
  await tester.pumpWidget(
    ChangeNotifierProvider(
      create: (_) => IntegrationsController(repository),
      child: const MaterialApp(home: Scaffold(body: IntegrationsView())),
    ),
  );
  await tester.pumpAndSettle();
}

class _FakeIntegrationsRepository extends IntegrationsRepository {
  _FakeIntegrationsRepository({required this.accounts})
      : super(IntegrationsDataSource(baseUrl: 'http://example.invalid'));

  final List<IntegrationAccount> accounts;

  @override
  Future<List<IntegrationAccount>> getAccounts() async => accounts;

  @override
  Uri googleBeginUri() => Uri.parse('http://example.invalid/google/begin');
}
