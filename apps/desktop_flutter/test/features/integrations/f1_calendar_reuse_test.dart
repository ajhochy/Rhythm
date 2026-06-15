import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/integrations/models/integration_account.dart';

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
}
