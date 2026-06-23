/// Widget tests for AgentCookbookView.
///
/// Asserts:
///   1. Recipe list renders recipe title from a fake controller.
///   2. Empty-state widget renders when the recipe list is empty.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/agent_cookbook/controllers/agent_cookbook_controller.dart';
import 'package:rhythm_desktop/features/agent_cookbook/models/cookbook_recipe.dart';
import 'package:rhythm_desktop/features/agent_cookbook/repositories/agent_cookbook_repository.dart';
import 'package:rhythm_desktop/features/agent_cookbook/data/agent_cookbook_data_source.dart';
import 'package:rhythm_desktop/features/agent_cookbook/views/agent_cookbook_view.dart';

// ---------------------------------------------------------------------------
// Fake data source
// ---------------------------------------------------------------------------

class _FakeCookbookDataSource extends AgentCookbookDataSource {
  _FakeCookbookDataSource(this._recipes);

  final List<CookbookRecipe> _recipes;

  @override
  Future<List<CookbookRecipe>> list() async => _recipes;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0).toIso8601String();

CookbookRecipe _makeRecipe(String id, String title) => CookbookRecipe(
      id: id,
      title: title,
      description: 'Test description',
      stepsJson: '[]',
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );

Future<Widget> _buildApp(AgentCookbookController controller) async {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentCookbookController>.value(
        value: controller,
      ),
    ],
    child: const MaterialApp(home: AgentCookbookView()),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AgentCookbookView', () {
    testWidgets('renders recipe titles from controller', (tester) async {
      final recipes = [
        _makeRecipe('r1', 'Alpha Recipe'),
        _makeRecipe('r2', 'Beta Recipe'),
      ];
      final dataSource = _FakeCookbookDataSource(recipes);
      final controller = AgentCookbookController(
        AgentCookbookRepository(dataSource),
      );
      // Pre-load recipes so the view doesn't need to call loadRecipes()
      // (which would try to hit the network).
      await controller.loadRecipes();

      await tester.pumpWidget(await _buildApp(controller));
      await tester.pump();

      expect(
        find.text('Alpha Recipe'),
        findsOneWidget,
        reason: 'Alpha Recipe title should render',
      );
      expect(
        find.text('Beta Recipe'),
        findsOneWidget,
        reason: 'Beta Recipe title should render',
      );

      controller.dispose();
    });

    testWidgets('renders empty state when recipe list is empty',
        (tester) async {
      final dataSource = _FakeCookbookDataSource([]);
      final controller = AgentCookbookController(
        AgentCookbookRepository(dataSource),
      );
      await controller.loadRecipes();

      await tester.pumpWidget(await _buildApp(controller));
      await tester.pump();

      expect(
        find.byKey(const ValueKey('cookbook-empty-state')),
        findsOneWidget,
        reason: 'Empty state should render when recipes list is empty',
      );

      controller.dispose();
    });
  });
}
