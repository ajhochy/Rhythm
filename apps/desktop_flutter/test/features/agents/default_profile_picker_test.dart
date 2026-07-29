/// Widget test for the "Default profile" picker (#890) shown at the top of
/// [AgentProfilesManagerSheet] (`showAgentProfilesManagerSheet`).
///
/// Verifies the user-visible contract: a real tap opens the dropdown, a real
/// tap on an item selects it, and the selection is persisted through
/// [DefaultAgentProfileService] (asserted via a freshly-constructed service
/// re-reading shared_preferences — the same surface a user's next app launch
/// would read).
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:rhythm_desktop/app/core/services/default_agent_profile_service.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_agent_profile_sheet.dart';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class _FakeAgentConfigsDataSource extends AgentConfigsDataSource {
  final List<AgentConfig> _configs;

  _FakeAgentConfigsDataSource(this._configs);

  @override
  Future<List<AgentConfig>> list() async => _configs;

  @override
  Future<AgentConfig> update(String id, Map<String, dynamic> patch) async {
    throw UnimplementedError();
  }

  @override
  Future<AgentConfig> create(Map<String, dynamic> input) async {
    throw UnimplementedError();
  }

  @override
  Future<void> delete(String id) async {}
}

AgentConfig _makeConfig({
  required String id,
  required String label,
  required String ocAgent,
}) =>
    AgentConfig(
      id: id,
      label: label,
      icon: 'terminal',
      enabled: true,
      isAgent: true,
      sortOrder: 0,
      ocAgent: ocAgent,
      sessionSelectable: true,
    );

Widget _buildManagerSheet({
  required AgentConfigsController configsController,
  required DefaultAgentProfileService defaultService,
}) {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentConfigsController>.value(
        value: configsController,
      ),
      ChangeNotifierProvider<DefaultAgentProfileService>.value(
        value: defaultService,
      ),
    ],
    child: MaterialApp(
      home: Scaffold(
        body: SizedBox(
          height: 900,
          width: 800,
          child: const AgentProfilesManagerSheet(),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('Default profile picker (#890)', () {
    testWidgets(
      'lists selectable profiles plus the Secretary(default) fallback item',
      (tester) async {
        final configsController = AgentConfigsController(
          AgentConfigsRepository(_FakeAgentConfigsDataSource([
            _makeConfig(
                id: 'secretary', label: 'Secretary', ocAgent: 'secretary'),
            _makeConfig(
                id: 'theologian', label: 'Theologian', ocAgent: 'theologian'),
          ])),
        );
        await configsController.refresh();
        final defaultService = DefaultAgentProfileService();
        await defaultService.load();

        await tester.pumpWidget(_buildManagerSheet(
          configsController: configsController,
          defaultService: defaultService,
        ));
        await tester.pumpAndSettle();

        expect(find.text('Default profile'), findsOneWidget);
        expect(find.text('Secretary (default)'), findsOneWidget);

        // Real user input event: tap the dropdown to open it.
        await tester.tap(find.byType(DropdownButton<String?>));
        await tester.pumpAndSettle();

        // Both profiles should be offered as options in the opened menu.
        // (DropdownButton renders each item once off-screen for sizing and
        // once in the open menu overlay, so widgets — not exactly one — is
        // the correct cardinality here.)
        expect(find.text('Secretary'), findsWidgets);
        expect(find.text('Theologian'), findsWidgets);
      },
    );

    testWidgets(
      'selecting a profile persists it via DefaultAgentProfileService '
      '(user-visible outcome: re-reading prefs on a fresh service instance)',
      (tester) async {
        final configsController = AgentConfigsController(
          AgentConfigsRepository(_FakeAgentConfigsDataSource([
            _makeConfig(
                id: 'secretary', label: 'Secretary', ocAgent: 'secretary'),
            _makeConfig(
                id: 'theologian', label: 'Theologian', ocAgent: 'theologian'),
          ])),
        );
        await configsController.refresh();
        final defaultService = DefaultAgentProfileService();
        await defaultService.load();

        await tester.pumpWidget(_buildManagerSheet(
          configsController: configsController,
          defaultService: defaultService,
        ));
        await tester.pumpAndSettle();

        // Control: before selection, the service reports unset (Secretary
        // fallback) — establishes the pre-change baseline.
        expect(defaultService.defaultOcAgent, isNull);

        // Real tap to open the dropdown, real tap to select "Theologian".
        await tester.tap(find.byType(DropdownButton<String?>));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Theologian').last);
        await tester.pumpAndSettle();

        // User-visible outcome #1: the service's in-memory getter updated.
        expect(defaultService.defaultOcAgent, equals('theologian'));

        // User-visible outcome #2 (the real contract — persistence, not just
        // in-memory state): a FRESH service instance reading the same
        // shared_preferences store sees the selection too.
        final reloaded = DefaultAgentProfileService();
        await reloaded.load();
        expect(reloaded.defaultOcAgent, equals('theologian'));

        // The dropdown itself now visibly reflects the new selection (the
        // menu is closed after selection, so this is the button's current
        // display text — but DropdownButton still keeps an off-screen sizing
        // copy of the selected item, hence widgets not exactly one).
        expect(find.text('Theologian'), findsWidgets);
      },
    );

    testWidgets(
      'a persisted override for a since-removed profile renders as unset '
      'rather than a dangling selection',
      (tester) async {
        SharedPreferences.setMockInitialValues({
          'default_agent_ocagent': 'ghost-agent',
        });
        final configsController = AgentConfigsController(
          AgentConfigsRepository(_FakeAgentConfigsDataSource([
            _makeConfig(
                id: 'secretary', label: 'Secretary', ocAgent: 'secretary'),
          ])),
        );
        await configsController.refresh();
        final defaultService = DefaultAgentProfileService();
        await defaultService.load();

        await tester.pumpWidget(_buildManagerSheet(
          configsController: configsController,
          defaultService: defaultService,
        ));
        await tester.pumpAndSettle();

        // Falls back to showing the unset/default label rather than crashing
        // or showing a blank dropdown value.
        expect(find.text('Secretary (default)'), findsOneWidget);
      },
    );
  });
}
