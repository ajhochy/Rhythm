import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/integrations/controllers/integrations_controller.dart';
import 'package:rhythm_desktop/features/integrations/data/integrations_data_source.dart';
import 'package:rhythm_desktop/features/integrations/models/integration_account.dart';
import 'package:rhythm_desktop/features/integrations/repositories/integrations_repository.dart';
import 'package:rhythm_desktop/features/integrations/views/integrations_view.dart';

void main() {
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
