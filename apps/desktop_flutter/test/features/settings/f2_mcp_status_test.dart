/// F2 — Rhythm MCP install status indicator in the MCP section.
///
/// When opencode's listed MCP servers include one named 'rhythm', the section
/// renders a status row keyed ValueKey('rhythm-mcp-installed') containing
/// "installed". When the list does not include 'rhythm', that key is absent.
///
/// Mirrors the harness from opc_m4_3_mcp_section_test.dart: pumps the real
/// McpSection inside a ChangeNotifierProvider<McpController> backed by a fake
/// data source whose listServers() returns the injected server list.
///
/// Run with:
///   flutter test test/features/settings/f2_mcp_status_test.dart
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/settings/controllers/mcp_controller.dart';
import 'package:rhythm_desktop/features/settings/data/mcp_data_source.dart';
import 'package:rhythm_desktop/features/settings/widgets/mcp_section.dart';

// ---------------------------------------------------------------------------
// Fake data source — returns the injected server list from listServers().
// ---------------------------------------------------------------------------

class _FakeMcpDataSource implements McpDataSource {
  _FakeMcpDataSource({this.listResult = const []});

  final List<McpServerEntry> listResult;

  @override
  Future<List<McpServerEntry>> listServers() async => listResult;

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
  Future<String> oauthStatus(String name) async => 'unknown';

  @override
  Future<void> disconnectServer(String name) async {}

  @override
  Future<void> removeServer(String name) async {}

  @override
  Future<void> setCredentials(
    String name,
    Map<String, String> environment,
  ) async {}
}

Widget _wrap(Widget child, McpController ctrl) {
  return MaterialApp(
    theme: AppTheme.light(),
    home: Scaffold(
      body: ChangeNotifierProvider<McpController>.value(
        value: ctrl,
        child: SingleChildScrollView(child: child),
      ),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'f2: server list including "rhythm" renders installed status indicator',
    (tester) async {
      final ds = _FakeMcpDataSource(
        listResult: const [
          McpServerEntry(name: 'rhythm', status: 'connected'),
          McpServerEntry(name: 'other-mcp', status: 'connected'),
        ],
      );
      final ctrl = McpController(ds);
      await ctrl.refresh();

      await tester.pumpWidget(_wrap(const McpSection(), ctrl));
      await tester.pump();

      final indicator = find.byKey(const ValueKey('rhythm-mcp-installed'));
      expect(indicator, findsOneWidget,
          reason: 'installed status indicator must render when "rhythm" '
              'is in the listed servers');
      final indicatorText = tester.widget<Text>(indicator);
      expect(indicatorText.data, contains('installed'),
          reason: 'indicator text must contain "installed"');
    },
  );

  testWidgets(
    'f2: server list without "rhythm" omits the installed status indicator',
    (tester) async {
      final ds = _FakeMcpDataSource(
        listResult: const [
          McpServerEntry(name: 'other-mcp', status: 'connected'),
        ],
      );
      final ctrl = McpController(ds);
      await ctrl.refresh();

      await tester.pumpWidget(_wrap(const McpSection(), ctrl));
      await tester.pump();

      expect(
        find.byKey(const ValueKey('rhythm-mcp-installed')),
        findsNothing,
        reason: 'installed indicator must be absent when "rhythm" is not '
            'in the listed servers',
      );
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // MCP-4 — surface installed-but-uncredentialed servers
  // ─────────────────────────────────────────────────────────────────────────

  testWidgets(
    'mcp-4 c1: key-based server missing required env renders a '
    '"Needs credentials" badge; credentialed server does not',
    (tester) async {
      final ds = _FakeMcpDataSource(
        listResult: const [
          // Curated key-based server with an empty required env value →
          // backend sets needsCredentials: true (MCP-1).
          McpServerEntry(
            name: 'weather-mcp',
            status: 'disconnected',
            needsCredentials: true,
            environment: {'API_KEY': '***'},
          ),
          // Fully credentialed, connected server.
          McpServerEntry(
            name: 'github-mcp',
            status: 'connected',
            needsCredentials: false,
            environment: {'TOKEN': '***'},
          ),
        ],
      );
      final ctrl = McpController(ds);
      await ctrl.refresh();

      await tester.pumpWidget(_wrap(const McpSection(), ctrl));
      await tester.pump();

      expect(
        find.byKey(const Key('mcp-needs-credentials-weather-mcp')),
        findsOneWidget,
        reason: 'uncredentialed key-based server must show the badge',
      );
      expect(
        find.text('Needs credentials'),
        findsOneWidget,
        reason: 'badge label must read "Needs credentials"',
      );
      expect(
        find.byKey(const Key('mcp-needs-credentials-github-mcp')),
        findsNothing,
        reason: 'credentialed server must NOT show the badge',
      );
    },
  );

  testWidgets(
    'mcp-4 c2: remote server with status needs_auth renders a distinct '
    '"Sign-in required" badge (not "Needs credentials")',
    (tester) async {
      final ds = _FakeMcpDataSource(
        listResult: const [
          McpServerEntry(
            name: 'remote-mcp',
            status: 'needs_auth',
            needsCredentials: true,
          ),
        ],
      );
      final ctrl = McpController(ds);
      await ctrl.refresh();

      await tester.pumpWidget(_wrap(const McpSection(), ctrl));
      await tester.pump();

      expect(
        find.byKey(const Key('mcp-needs-signin-remote-mcp')),
        findsOneWidget,
        reason: 'needs_auth server must show the sign-in badge',
      );
      expect(find.text('Sign-in required'), findsOneWidget);
      // Distinct from the credentials badge.
      expect(
        find.byKey(const Key('mcp-needs-credentials-remote-mcp')),
        findsNothing,
        reason: 'needs_auth must not surface as "Needs credentials"',
      );
      expect(find.text('Needs credentials'), findsNothing);
    },
  );

  testWidgets(
    'mcp-4 c3: connected server shows the normal connected badge with no '
    'false-positive "Needs credentials"',
    (tester) async {
      final ds = _FakeMcpDataSource(
        listResult: const [
          McpServerEntry(
            name: 'github-mcp',
            status: 'connected',
            needsCredentials: false,
          ),
        ],
      );
      final ctrl = McpController(ds);
      await ctrl.refresh();

      await tester.pumpWidget(_wrap(const McpSection(), ctrl));
      await tester.pump();

      expect(
        find.byKey(const Key('mcp-badge-github-mcp')),
        findsOneWidget,
        reason: 'connected server must show the normal status badge',
      );
      expect(find.text('Needs credentials'), findsNothing);
      expect(find.text('Sign-in required'), findsNothing);
    },
  );

  testWidgets(
    'mcp-4 c4: tapping the "Needs credentials" badge opens the secrets dialog '
    'pre-filled with the server name',
    (tester) async {
      final ds = _FakeMcpDataSource(
        listResult: const [
          McpServerEntry(
            name: 'weather-mcp',
            status: 'disconnected',
            needsCredentials: true,
            environment: {'API_KEY': '***'},
          ),
        ],
      );
      final ctrl = McpController(ds);
      await ctrl.refresh();

      await tester.pumpWidget(_wrap(const McpSection(), ctrl));
      await tester.pump();

      await tester.tap(
        find.byKey(const Key('mcp-needs-credentials-weather-mcp')),
      );
      await tester.pumpAndSettle();

      // Dialog is open.
      final nameField = find.byKey(const Key('mcp-dialog-name-field'));
      expect(nameField, findsOneWidget, reason: 'secrets dialog must open');

      // Name pre-filled so the user does not retype it.
      final textField = tester.widget<TextField>(
        find.descendant(
          of: nameField,
          matching: find.byType(TextField),
        ),
      );
      expect(
        textField.controller?.text,
        'weather-mcp',
        reason: 'name field must be pre-filled with the server name',
      );
    },
  );
}
