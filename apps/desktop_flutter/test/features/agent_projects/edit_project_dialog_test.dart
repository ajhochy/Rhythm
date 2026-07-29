import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/agent_projects/controllers/agent_projects_controller.dart';
import 'package:rhythm_desktop/features/agent_projects/data/agent_projects_remote_data_source.dart';
import 'package:rhythm_desktop/features/agent_projects/models/agent_project.dart';
import 'package:rhythm_desktop/features/agent_projects/repositories/agent_projects_repository.dart';
import 'package:rhythm_desktop/features/agent_projects/views/edit_project_dialog.dart';

class _Remote extends AgentProjectsRemoteDataSource {
  _Remote() : super();

  bool failNextWrite = false;
  String? createdWith;
  String? updatedId;
  String? archivedId;
  bool returnGit = true;

  AgentProject _make({
    String id = 'new-id',
    String name = 'P',
    String cwd = '/tmp/p',
    String? icon,
    bool git = true,
    DateTime? archivedAt,
  }) =>
      AgentProject(
        id: id,
        name: name,
        cwd: cwd,
        icon: icon,
        vcsRoot: git ? '/tmp/p' : null,
        vcsBranch: git ? 'main' : null,
        vcsDirty: false,
        vcsCheckedAt: DateTime.utc(2026),
        createdAt: DateTime.utc(2026),
        archivedAt: archivedAt,
      );

  @override
  Future<List<AgentProject>> list({bool includeArchived = false}) async =>
      const [];

  @override
  Future<AgentProject> create({
    required String name,
    required String cwd,
    String? icon,
  }) async {
    if (failNextWrite) {
      failNextWrite = false;
      throw Exception('server boom');
    }
    createdWith = '$name|$cwd|$icon';
    return _make(name: name, cwd: cwd, icon: icon, git: returnGit);
  }

  @override
  Future<AgentProject> update(
    String id, {
    String? name,
    String? cwd,
    String? icon,
    DateTime? archivedAt,
    bool clearArchivedAt = false,
  }) async {
    if (archivedAt != null) {
      archivedId = id;
      return _make(id: id, archivedAt: archivedAt);
    }
    updatedId = id;
    return _make(id: id, name: name ?? 'X', cwd: cwd ?? '/x', icon: icon);
  }

  @override
  Future<void> delete(String id) async {}

  @override
  Future<AgentProject> refreshVcs(String id) async => _make(id: id);
}

AgentProject _existing() => AgentProject(
      id: 'existing-1',
      name: 'Existing',
      cwd: '/tmp/existing',
      icon: '🛠',
      createdAt: DateTime.utc(2026),
    );

Widget _harness(AgentProjectsController controller) {
  return ChangeNotifierProvider<AgentProjectsController>.value(
    value: controller,
    child: MaterialApp(
      home: Builder(
        builder: (ctx) => Scaffold(
          body: Center(
            child: ElevatedButton(
              onPressed: () => showEditProjectDialog(ctx),
              child: const Text('open-create'),
            ),
          ),
        ),
      ),
    ),
  );
}

Widget _harnessEdit(AgentProjectsController controller, AgentProject existing) {
  return ChangeNotifierProvider<AgentProjectsController>.value(
    value: controller,
    child: MaterialApp(
      home: Builder(
        builder: (ctx) => Scaffold(
          body: Center(
            child: ElevatedButton(
              onPressed: () => showEditProjectDialog(ctx, existing: existing),
              child: const Text('open-edit'),
            ),
          ),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('create mode renders with empty fields + Save disabled',
      (tester) async {
    final remote = _Remote();
    final controller = AgentProjectsController(AgentProjectsRepository(remote));

    await tester.pumpWidget(_harness(controller));
    await tester.tap(find.text('open-create'));
    await tester.pumpAndSettle();

    expect(find.text('New project'), findsOneWidget);
    final saveBtn =
        tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Save'));
    expect(saveBtn.onPressed, isNull);
  });

  testWidgets('edit mode pre-fills + Archive button present', (tester) async {
    final remote = _Remote();
    final controller = AgentProjectsController(AgentProjectsRepository(remote));

    await tester.pumpWidget(_harnessEdit(controller, _existing()));
    await tester.tap(find.text('open-edit'));
    await tester.pumpAndSettle();

    expect(find.text('Edit project'), findsOneWidget);
    expect(find.text('Existing'), findsOneWidget);
    expect(find.text('/tmp/existing'), findsOneWidget);
    expect(find.text('Archive'), findsOneWidget);
  });

  testWidgets('Save in create mode calls controller.create and shows git line',
      (tester) async {
    final remote = _Remote()..returnGit = true;
    final controller = AgentProjectsController(AgentProjectsRepository(remote));

    await tester.pumpWidget(_harness(controller));
    await tester.tap(find.text('open-create'));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextField, 'Name'), 'Hello');
    await tester.enterText(
      find.widgetWithText(TextField, 'Folder (absolute path)'),
      '/tmp/hello',
    );
    await tester.pump();

    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    for (var i = 0; i < 5; i++) {
      await tester.pump();
    }

    expect(remote.createdWith, startsWith('Hello|/tmp/hello|'));
    expect(find.textContaining('Detected git branch'), findsOneWidget);

    await tester.pump(const Duration(milliseconds: 900));
    await tester.pumpAndSettle();
    // Dialog auto-dismisses after the 800ms hold.
    expect(find.text('New project'), findsNothing);
  });

  testWidgets('non-git folder shows fallback line', (tester) async {
    final remote = _Remote()..returnGit = false;
    final controller = AgentProjectsController(AgentProjectsRepository(remote));

    await tester.pumpWidget(_harness(controller));
    await tester.tap(find.text('open-create'));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextField, 'Name'), 'NG');
    await tester.enterText(
      find.widgetWithText(TextField, 'Folder (absolute path)'),
      '/tmp/ng',
    );
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    for (var i = 0; i < 5; i++) {
      await tester.pump();
    }
    expect(find.text('No git repository at this path'), findsOneWidget);
    // Drain the 800ms hold timer so the dialog auto-dismisses cleanly.
    await tester.pump(const Duration(milliseconds: 900));
    await tester.pumpAndSettle();
  });

  testWidgets('server error keeps dialog open and shows the message',
      (tester) async {
    final remote = _Remote()..failNextWrite = true;
    final controller = AgentProjectsController(AgentProjectsRepository(remote));

    await tester.pumpWidget(_harness(controller));
    await tester.tap(find.text('open-create'));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextField, 'Name'), 'X');
    await tester.enterText(
      find.widgetWithText(TextField, 'Folder (absolute path)'),
      '/tmp/x',
    );
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    for (var i = 0; i < 5; i++) {
      await tester.pump();
    }
    expect(find.text('New project'), findsOneWidget);
    expect(find.textContaining('server boom'), findsOneWidget);
  });

  testWidgets('Archive button in edit mode calls controller.archive',
      (tester) async {
    final remote = _Remote();
    final controller = AgentProjectsController(AgentProjectsRepository(remote));

    await tester.pumpWidget(_harnessEdit(controller, _existing()));
    await tester.tap(find.text('open-edit'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Archive'));
    await tester.pumpAndSettle();
    expect(remote.archivedId, 'existing-1');
  });
}
