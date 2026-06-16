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
  Future<void> connectServer(String name) async {}

  @override
  Future<void> disconnectServer(String name) async {}

  @override
  Future<void> removeServer(String name) async {}
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
}
