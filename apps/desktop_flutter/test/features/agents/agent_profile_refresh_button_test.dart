/// Follow-up to #911: profiles created outside the manager sheet (e.g. by
/// the Rhythm Setup onboarding agent calling rhythm_create_agent_profile
/// directly against the backend) don't appear in an already-running app,
/// since AgentConfigsController.refresh() previously only ran once at app
/// launch. Adds a manual refresh button to the manager sheet header.
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

class _FakeAgentConfigsDataSource extends AgentConfigsDataSource {
  final List<AgentConfig> configs = [];

  @override
  Future<List<AgentConfig>> list() async => List.of(configs);

  @override
  Future<AgentConfig> update(String id, Map<String, dynamic> patch) async =>
      throw UnimplementedError();

  @override
  Future<AgentConfig> create(Map<String, dynamic> input) async =>
      throw UnimplementedError();

  @override
  Future<void> delete(String id) async {}
}

AgentConfig _makeConfig({required String id, required String label}) =>
    AgentConfig(
      id: id,
      label: label,
      icon: 'terminal',
      enabled: true,
      isAgent: true,
      sortOrder: 0,
      ocAgent: id,
      sessionSelectable: true,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
    'refresh button re-fetches profiles added outside the sheet (e.g. by an MCP tool)',
    (tester) async {
      final dataSource = _FakeAgentConfigsDataSource()
        ..configs.add(_makeConfig(id: 'p1', label: 'Existing Profile'));
      final configsController = AgentConfigsController(
        AgentConfigsRepository(dataSource),
      );
      await configsController.refresh();
      final defaultService = DefaultAgentProfileService();
      await defaultService.load();

      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AgentConfigsController>.value(
              value: configsController,
            ),
            ChangeNotifierProvider<DefaultAgentProfileService>.value(
              value: defaultService,
            ),
          ],
          child: const MaterialApp(
            home: Scaffold(
              body: SizedBox(
                height: 900,
                width: 800,
                child: AgentProfilesManagerSheet(),
              ),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Existing Profile'), findsOneWidget);
      expect(find.text('New From Setup'), findsNothing);

      // Simulate the backend gaining a new profile out-of-band (e.g. the
      // Rhythm Setup agent calling rhythm_create_agent_profile).
      dataSource.configs.add(_makeConfig(id: 'p2', label: 'New From Setup'));

      await tester.tap(find.byKey(const ValueKey('profile-refresh-button')));
      await tester.pumpAndSettle();

      expect(find.text('New From Setup'), findsOneWidget);

      configsController.dispose();
    },
  );
}
