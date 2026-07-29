import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/services/server_config_service.dart';
import 'package:rhythm_desktop/app/core/ui/tokens/rhythm_theme.dart';
import 'package:rhythm_desktop/app/core/workspace/workspace_controller.dart';
import 'package:rhythm_desktop/app/core/workspace/workspace_data_source.dart';
import 'package:rhythm_desktop/app/core/workspace/workspace_repository.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/projects/controllers/project_template_controller.dart';
import 'package:rhythm_desktop/features/projects/data/projects_local_data_source.dart';
import 'package:rhythm_desktop/features/projects/repositories/projects_repository.dart';
import 'package:rhythm_desktop/features/projects/views/projects_view.dart';

void main() {
  testWidgets(
    'issue-1038-c1: both Projects panes follow light and dark themes with readable headers',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1200, 800));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      // CONTRACT REGRESSION: a hard-coded cream gradient in dark mode makes the
      // Projects header unreadable. The luminance/contrast assertions below
      // must fail if either composing pane reintroduces that light background.
      for (final brightness in Brightness.values) {
        await _pumpProjects(tester, brightness: brightness);
        _expectThemeAndHeaderContrast(
          tester,
          brightness,
          pane: 'Active Projects',
        );
        await expectLater(
          find.byType(ProjectsView),
          matchesGoldenFile(
            'goldens/issue_1038_${brightness.name}_active_projects.png',
          ),
        );

        await tester.tap(find.text('Templates'));
        await tester.pumpAndSettle();
        _expectThemeAndHeaderContrast(tester, brightness, pane: 'Templates');
        await expectLater(
          find.byType(ProjectsView),
          matchesGoldenFile(
            'goldens/issue_1038_${brightness.name}_templates.png',
          ),
        );
      }
    },
  );
}

Future<void> _pumpProjects(
  WidgetTester tester, {
  required Brightness brightness,
}) async {
  final projectsController = _NoopProjectTemplateController(
    ProjectsRepository(ProjectsLocalDataSource(baseUrl: 'http://127.0.0.1:1')),
  );
  final workspaceController = _NoopWorkspaceController(
    WorkspaceRepository(WorkspaceDataSource(baseUrl: 'http://127.0.0.1:1')),
  );

  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<ProjectTemplateController>.value(
          value: projectsController,
        ),
        ChangeNotifierProvider<WorkspaceController>.value(
          value: workspaceController,
        ),
        ChangeNotifierProvider(create: (_) => ServerConfigService()),
      ],
      child: MaterialApp(
        key: ValueKey(brightness),
        theme: AppTheme.light(),
        darkTheme: AppTheme.dark(),
        themeMode: brightness == Brightness.dark
            ? ThemeMode.dark
            : ThemeMode.light,
        home: const Scaffold(body: ProjectsView()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void _expectThemeAndHeaderContrast(
  WidgetTester tester,
  Brightness brightness, {
  required String pane,
}) {
  expect(
    find.text('Projects'),
    findsOneWidget,
    reason: '$pane header is mounted',
  );

  final gradients = tester
      .widgetList<Container>(find.byType(Container))
      .map((widget) => widget.decoration)
      .whereType<BoxDecoration>()
      .map((decoration) => decoration.gradient)
      .whereType<LinearGradient>()
      .toList();
  expect(
    gradients,
    hasLength(1),
    reason: '$pane must use the composed Projects screen background',
  );

  final roles = brightness == Brightness.dark
      ? RhythmColorRoles.dark
      : RhythmColorRoles.light;
  final effectiveStops = gradients.single.colors
      .map((color) => Color.alphaBlend(color, roles.canvas))
      .toList();

  expect(
    effectiveStops.first,
    roles.canvas,
    reason: '$pane background must start from the active theme canvas',
  );
  for (final background in effectiveStops) {
    final luminance = background.computeLuminance();
    if (brightness == Brightness.dark) {
      expect(
        luminance,
        lessThan(0.15),
        reason: '$pane contains a light/cream stop in dark mode: $background',
      );
    } else {
      expect(
        luminance,
        greaterThan(0.65),
        reason: '$pane contains a dark stop in light mode: $background',
      );
    }

    expect(
      _contrastRatio(roles.textPrimary, background),
      greaterThanOrEqualTo(4.5),
      reason: '$pane Projects header must meet WCAG AA contrast on $background',
    );
  }
}

double _contrastRatio(Color foreground, Color background) {
  final foregroundLuminance = foreground.computeLuminance();
  final backgroundLuminance = background.computeLuminance();
  final lighter = foregroundLuminance > backgroundLuminance
      ? foregroundLuminance
      : backgroundLuminance;
  final darker = foregroundLuminance > backgroundLuminance
      ? backgroundLuminance
      : foregroundLuminance;
  return (lighter + 0.05) / (darker + 0.05);
}

class _NoopProjectTemplateController extends ProjectTemplateController {
  _NoopProjectTemplateController(super.repository);

  @override
  Future<void> load() async {}
}

class _NoopWorkspaceController extends WorkspaceController {
  _NoopWorkspaceController(super.repository);

  @override
  Future<void> loadMembers() async {}
}
