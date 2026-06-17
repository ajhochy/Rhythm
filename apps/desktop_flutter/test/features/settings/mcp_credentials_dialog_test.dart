/// Focused "Enter credentials" dialog for curated key-based MCP servers
/// (stripe / mailchimp).
///
/// Backend contract (already on this branch):
///   - GET /opencode/mcp entries include `requiredEnv: string[]` (the curated
///     server's required env-var names; `[]` if not curated).
///   - POST /opencode/mcp/:name/credentials with body
///     `{ "environment": { "STRIPE_SECRET_KEY": "sk_..." } }` → merges the key
///     into the curated server's known command and reconnects; returns the
///     updated status map. Errors mirror other routes:
///     `{ error: { code, message } }`.
///
/// UI behavior under test:
///   - A server with needsCredentials:true + requiredEnv renders a tappable
///     "Needs credentials" badge.
///   - Tapping it opens a FOCUSED dialog asking ONLY for the required key(s) —
///     one obscured field per requiredEnv entry, NO command field.
///   - Submit → ctrl.setCredentials(name, {KEY: value}) → on success pops.
///
/// Run with:
///   flutter test test/features/settings/mcp_credentials_dialog_test.dart
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';

import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/settings/controllers/mcp_controller.dart';
import 'package:rhythm_desktop/features/settings/data/mcp_data_source.dart';
import 'package:rhythm_desktop/features/settings/widgets/mcp_section.dart';

// ---------------------------------------------------------------------------
// Fake data source
// ---------------------------------------------------------------------------

class _FakeMcpDataSource implements McpDataSource {
  _FakeMcpDataSource({
    this.listResult = const [],
    this.setCredentialsShouldFail = false,
    this.setCredentialsError = 'invalid key',
  });

  List<McpServerEntry> listResult;
  final bool setCredentialsShouldFail;
  final String setCredentialsError;

  int setCredentialsCallCount = 0;
  String? lastSetCredentialsName;
  Map<String, String>? lastSetCredentialsEnv;

  int listCallCount = 0;

  @override
  Future<List<McpServerEntry>> listServers() async {
    listCallCount++;
    return listResult;
  }

  @override
  Future<void> addServer({
    required String name,
    String? command,
    String? url,
    Map<String, String>? environment,
  }) async {}

  @override
  Future<String?> connectServer(String name) async => null;

  @override
  Future<String?> startOAuth(String name) async => null;

  @override
  Future<String> oauthStatus(String name) async => 'connected';

  @override
  Future<void> setCredentials(
    String name,
    Map<String, String> environment,
  ) async {
    setCredentialsCallCount++;
    lastSetCredentialsName = name;
    lastSetCredentialsEnv = environment;
    if (setCredentialsShouldFail) throw Exception(setCredentialsError);
  }

  @override
  Future<void> disconnectServer(String name) async {}

  @override
  Future<void> removeServer(String name) async {}
}

Widget _wrap(Widget child, {required McpController mcpController}) {
  return MaterialApp(
    theme: AppTheme.light(),
    home: Scaffold(
      body: ChangeNotifierProvider<McpController>.value(
        value: mcpController,
        child: child,
      ),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // ── Model: requiredEnv parsing ───────────────────────────────────────────

  group('McpServerEntry.requiredEnv', () {
    test('parses a list of strings from json', () {
      final entry = McpServerEntry.fromJson(const {
        'name': 'stripe',
        'status': 'disconnected',
        'needsCredentials': true,
        'requiredEnv': ['STRIPE_SECRET_KEY'],
      });
      expect(entry.requiredEnv, equals(['STRIPE_SECRET_KEY']));
    });

    test('defaults to empty list when missing or null', () {
      final missing = McpServerEntry.fromJson(const {
        'name': 'x',
        'status': 'connected',
      });
      expect(missing.requiredEnv, isEmpty);

      final nullValue = McpServerEntry.fromJson(const {
        'name': 'x',
        'status': 'connected',
        'requiredEnv': null,
      });
      expect(nullValue.requiredEnv, isEmpty);
    });

    test('default ctor value is const empty list', () {
      const entry = McpServerEntry(name: 'x', status: 'connected');
      expect(entry.requiredEnv, isEmpty);
    });
  });

  // ── Data source: setCredentials ──────────────────────────────────────────

  group('McpDataSource.setCredentials', () {
    test('POSTs {environment:{...}} to the credentials endpoint', () async {
      late Uri capturedUri;
      late String capturedMethod;
      late Map<String, dynamic> capturedBody;

      final client = MockClient((req) async {
        capturedUri = req.url;
        capturedMethod = req.method;
        capturedBody = jsonDecode(req.body) as Map<String, dynamic>;
        return http.Response('{}', 200);
      });

      await http.runWithClient(
        () async {
          await McpDataSource().setCredentials(
            'stripe',
            const {'STRIPE_SECRET_KEY': 'sk_test_123'},
          );
        },
        () => client,
      );

      expect(capturedMethod, 'POST');
      expect(capturedUri.path, '/opencode/mcp/stripe/credentials');
      expect(
        capturedBody['environment'],
        equals({'STRIPE_SECRET_KEY': 'sk_test_123'}),
      );
    });

    test('throws the parsed error message on a non-2xx response', () async {
      final client = MockClient((req) async {
        return http.Response(
          jsonEncode({
            'error': {'code': 'MISSING_CREDENTIALS', 'message': 'key required'},
          }),
          400,
        );
      });

      await http.runWithClient(
        () async {
          expect(
            () => McpDataSource()
                .setCredentials('stripe', const {'STRIPE_SECRET_KEY': ''}),
            throwsA(
              isA<Exception>().having(
                (e) => e.toString(),
                'message',
                contains('key required'),
              ),
            ),
          );
        },
        () => client,
      );
    });
  });

  // ── Controller: setCredentials ───────────────────────────────────────────

  group('McpController.setCredentials', () {
    test('success → calls data source then refreshes and clears error',
        () async {
      final ds = _FakeMcpDataSource(
        listResult: [
          const McpServerEntry(name: 'stripe', status: 'connected'),
        ],
      );
      final ctrl = McpController(ds);
      await ctrl.refresh();
      final listBefore = ds.listCallCount;

      await ctrl.setCredentials(
        'stripe',
        const {'STRIPE_SECRET_KEY': 'sk_test_123'},
      );

      expect(ds.setCredentialsCallCount, 1);
      expect(ds.lastSetCredentialsName, 'stripe');
      expect(
        ds.lastSetCredentialsEnv,
        equals({'STRIPE_SECRET_KEY': 'sk_test_123'}),
      );
      expect(ds.listCallCount, greaterThan(listBefore),
          reason: 'a refresh must follow a successful credentials submit');
      expect(ctrl.errorFor('stripe'), isNull);
    });

    test('failure → surfaces inline error, not silence', () async {
      final ds = _FakeMcpDataSource(
        setCredentialsShouldFail: true,
        setCredentialsError: 'invalid stripe key',
      );
      final ctrl = McpController(ds);

      await ctrl.setCredentials(
        'stripe',
        const {'STRIPE_SECRET_KEY': 'bad'},
      );

      final err = ctrl.errorFor('stripe');
      expect(err, isNotNull);
      expect(err, contains('invalid stripe key'));
    });
  });

  // ── Widget: focused credentials dialog ───────────────────────────────────

  testWidgets(
    'needs-credentials badge renders for a curated key-based server',
    (tester) async {
      final ds = _FakeMcpDataSource(
        listResult: [
          const McpServerEntry(
            name: 'stripe',
            status: 'disconnected',
            needsCredentials: true,
            requiredEnv: ['STRIPE_SECRET_KEY'],
          ),
        ],
      );
      final ctrl = McpController(ds);
      await ctrl.refresh();

      await tester.pumpWidget(_wrap(const McpSection(), mcpController: ctrl));
      await tester.pump();

      expect(
        find.byKey(const Key('mcp-needs-credentials-stripe')),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'tapping the badge opens a focused dialog with a field per requiredEnv '
    'and NO command field',
    (tester) async {
      final ds = _FakeMcpDataSource(
        listResult: [
          const McpServerEntry(
            name: 'stripe',
            status: 'disconnected',
            needsCredentials: true,
            requiredEnv: ['STRIPE_SECRET_KEY'],
          ),
        ],
      );
      final ctrl = McpController(ds);
      await ctrl.refresh();

      await tester.pumpWidget(_wrap(const McpSection(), mcpController: ctrl));
      await tester.pump();

      await tester.tap(find.byKey(const Key('mcp-needs-credentials-stripe')));
      await tester.pumpAndSettle();

      // A field for the required key is present…
      expect(
        find.byKey(const Key('mcp-cred-field-STRIPE_SECRET_KEY')),
        findsOneWidget,
      );
      // …and the submit button is present.
      expect(find.byKey(const Key('mcp-cred-submit')), findsOneWidget);
      // The generic Add dialog's command field must NOT be present.
      expect(
        find.widgetWithText(TextFormField, 'Command (local server)'),
        findsNothing,
      );
    },
  );

  testWidgets(
    'entering a value + submit calls setCredentials with the key/value map '
    'and pops the dialog',
    (tester) async {
      final ds = _FakeMcpDataSource(
        listResult: [
          const McpServerEntry(
            name: 'stripe',
            status: 'disconnected',
            needsCredentials: true,
            requiredEnv: ['STRIPE_SECRET_KEY'],
          ),
        ],
      );
      final ctrl = McpController(ds);
      await ctrl.refresh();

      await tester.pumpWidget(_wrap(const McpSection(), mcpController: ctrl));
      await tester.pump();

      await tester.tap(find.byKey(const Key('mcp-needs-credentials-stripe')));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byKey(const Key('mcp-cred-field-STRIPE_SECRET_KEY')),
        'sk_test_abc',
      );
      await tester.tap(find.byKey(const Key('mcp-cred-submit')));
      await tester.pumpAndSettle();

      expect(ds.setCredentialsCallCount, 1);
      expect(ds.lastSetCredentialsName, 'stripe');
      expect(
        ds.lastSetCredentialsEnv,
        equals({'STRIPE_SECRET_KEY': 'sk_test_abc'}),
      );
      // Dialog popped.
      expect(find.byKey(const Key('mcp-cred-submit')), findsNothing);
    },
  );

  testWidgets(
    'submit with an empty field does not call setCredentials and keeps the '
    'dialog open',
    (tester) async {
      final ds = _FakeMcpDataSource(
        listResult: [
          const McpServerEntry(
            name: 'stripe',
            status: 'disconnected',
            needsCredentials: true,
            requiredEnv: ['STRIPE_SECRET_KEY'],
          ),
        ],
      );
      final ctrl = McpController(ds);
      await ctrl.refresh();

      await tester.pumpWidget(_wrap(const McpSection(), mcpController: ctrl));
      await tester.pump();

      await tester.tap(find.byKey(const Key('mcp-needs-credentials-stripe')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('mcp-cred-submit')));
      await tester.pumpAndSettle();

      expect(ds.setCredentialsCallCount, 0);
      expect(find.byKey(const Key('mcp-cred-submit')), findsOneWidget);
    },
  );

  testWidgets(
    'multiple requiredEnv keys render multiple obscured fields',
    (tester) async {
      final ds = _FakeMcpDataSource(
        listResult: [
          const McpServerEntry(
            name: 'mailchimp',
            status: 'disconnected',
            needsCredentials: true,
            requiredEnv: ['MAILCHIMP_API_KEY', 'MAILCHIMP_SERVER_PREFIX'],
          ),
        ],
      );
      final ctrl = McpController(ds);
      await ctrl.refresh();

      await tester.pumpWidget(_wrap(const McpSection(), mcpController: ctrl));
      await tester.pump();

      await tester
          .tap(find.byKey(const Key('mcp-needs-credentials-mailchimp')));
      await tester.pumpAndSettle();

      expect(
        find.byKey(const Key('mcp-cred-field-MAILCHIMP_API_KEY')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('mcp-cred-field-MAILCHIMP_SERVER_PREFIX')),
        findsOneWidget,
      );

      // Fill both and submit.
      await tester.enterText(
        find.byKey(const Key('mcp-cred-field-MAILCHIMP_API_KEY')),
        'abc-us1',
      );
      await tester.enterText(
        find.byKey(const Key('mcp-cred-field-MAILCHIMP_SERVER_PREFIX')),
        'us1',
      );
      await tester.tap(find.byKey(const Key('mcp-cred-submit')));
      await tester.pumpAndSettle();

      expect(
        ds.lastSetCredentialsEnv,
        equals({
          'MAILCHIMP_API_KEY': 'abc-us1',
          'MAILCHIMP_SERVER_PREFIX': 'us1',
        }),
      );
    },
  );
}
