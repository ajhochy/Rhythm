import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/agent_projects/controllers/agent_projects_controller.dart';
import 'package:rhythm_desktop/features/agent_projects/data/agent_projects_remote_data_source.dart';
import 'package:rhythm_desktop/features/agent_projects/models/agent_project.dart';
import 'package:rhythm_desktop/features/agent_projects/repositories/agent_projects_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_projects_rail.dart';

class _StubRemote extends AgentProjectsRemoteDataSource {
  _StubRemote(this.initial) : super();
  final List<AgentProject> initial;
  @override
  Future<List<AgentProject>> list({bool includeArchived = false}) async =>
      initial;
}

AgentProject _proj(String id, String name) => AgentProject(
      id: id,
      name: name,
      cwd: '/tmp/$id',
      createdAt: DateTime.utc(2026),
    );

Widget _wrap(Widget child, AgentProjectsController controller) {
  return ChangeNotifierProvider<AgentProjectsController>.value(
    value: controller,
    child: MaterialApp(home: Scaffold(body: child)),
  );
}

void main() {
  testWidgets('renders one icon per project plus All-sessions + add button',
      (tester) async {
    final controller = AgentProjectsController(
      AgentProjectsRepository(_StubRemote([_proj('a', 'A'), _proj('b', 'B')])),
    );
    await controller.load();

    await tester.pumpWidget(_wrap(const ProjectsRail(), controller));
    await tester.pump();

    // Tooltips: All sessions + each project name + New project.
    expect(find.byTooltip('All sessions'), findsOneWidget);
    expect(find.byTooltip('A'), findsOneWidget);
    expect(find.byTooltip('B'), findsOneWidget);
    expect(find.byTooltip('New project'), findsOneWidget);
  });

  testWidgets('tapping a project icon selects it', (tester) async {
    final controller = AgentProjectsController(
      AgentProjectsRepository(_StubRemote([_proj('a', 'A')])),
    );
    await controller.load();
    await tester.pumpWidget(_wrap(const ProjectsRail(), controller));
    await tester.pump();

    await tester.tap(find.byTooltip('A'));
    await tester.pump();

    expect(controller.selectedProjectId, 'a');
  });

  testWidgets('tapping All-sessions calls select(null)', (tester) async {
    final controller = AgentProjectsController(
      AgentProjectsRepository(_StubRemote([_proj('a', 'A')])),
    );
    await controller.load();
    controller.select('a');
    await tester.pumpWidget(_wrap(const ProjectsRail(), controller));
    await tester.pump();

    await tester.tap(find.byTooltip('All sessions'));
    await tester.pump();

    expect(controller.selectedProjectId, isNull);
  });

  testWidgets('add button invokes onAddProject callback', (tester) async {
    final controller = AgentProjectsController(
      AgentProjectsRepository(_StubRemote(const [])),
    );
    var clicked = 0;
    await tester.pumpWidget(_wrap(
      ProjectsRail(onAddProject: () => clicked++),
      controller,
    ));
    await tester.tap(find.byTooltip('New project'));
    await tester.pump();
    expect(clicked, 1);
  });
}
