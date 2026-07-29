// Regression test for issue #726: startup gate must NOT require Gmail.
// Gmail is opt-in via step-up consent ("Enable Google tools").
// The gate should resolve to "ready" when Calendar is connected with
// calendar.readonly scope — regardless of whether any gmail account exists.
//
// Implementation note: the readiness predicate was extracted to a top-level
// pure function `googleAccessReady(List<IntegrationAccount>)` in app_shell.dart
// so it can be tested without the full widget harness.

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/layout/app_shell.dart';
import 'package:rhythm_desktop/features/integrations/models/integration_account.dart';

void main() {
  group('googleAccessReady (issue #726)', () {
    const calendarScope = 'https://www.googleapis.com/auth/calendar.readonly';
    const gmailScope = 'https://www.googleapis.com/auth/gmail.readonly';

    IntegrationAccount calendarAccount({
      bool connected = true,
      String? scope = calendarScope,
    }) =>
        IntegrationAccount(
          id: 'google_calendar',
          provider: 'google_calendar',
          status: connected ? 'connected' : 'disconnected',
          connected: connected,
          scope: scope,
        );

    IntegrationAccount gmailAccount({
      bool connected = true,
      String? scope = gmailScope,
    }) =>
        IntegrationAccount(
          id: 'gmail',
          provider: 'gmail',
          status: connected ? 'connected' : 'disconnected',
          connected: connected,
          scope: scope,
        );

    // -----------------------------------------------------------------------
    // Key regression case — calendar only, NO gmail
    test(
      'calendar-only (no gmail account) → ready',
      () {
        final accounts = [calendarAccount()];
        expect(googleAccessReady(accounts), isTrue);
      },
    );

    test(
      'calendar connected + gmail disconnected/no-scope → ready',
      () {
        final accounts = [
          calendarAccount(),
          gmailAccount(connected: false, scope: null),
        ];
        expect(googleAccessReady(accounts), isTrue);
      },
    );

    // -----------------------------------------------------------------------
    // Calendar requirements still hold
    test(
      'no accounts → not ready',
      () {
        expect(googleAccessReady([]), isFalse);
      },
    );

    test(
      'calendar disconnected → not ready',
      () {
        final accounts = [calendarAccount(connected: false)];
        expect(googleAccessReady(accounts), isFalse);
      },
    );

    test(
      'calendar connected but wrong/missing scope → not ready',
      () {
        final accounts = [calendarAccount(scope: null)];
        expect(googleAccessReady(accounts), isFalse);
      },
    );

    // -----------------------------------------------------------------------
    // Gmail present but not required
    test(
      'calendar connected + gmail connected → ready (gmail does not block)',
      () {
        final accounts = [calendarAccount(), gmailAccount()];
        expect(googleAccessReady(accounts), isTrue);
      },
    );
  });
}
