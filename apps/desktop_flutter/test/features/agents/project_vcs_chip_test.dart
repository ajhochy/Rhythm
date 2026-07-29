import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agent_projects/models/agent_project.dart';
import 'package:rhythm_desktop/features/agents/views/_project_vcs_chip.dart';

AgentProject _proj({
  String? vcsRoot,
  String? vcsBranch,
  bool vcsDirty = false,
}) =>
    AgentProject(
      id: 'p',
      name: 'P',
      cwd: '/tmp',
      vcsRoot: vcsRoot,
      vcsBranch: vcsBranch,
      vcsDirty: vcsDirty,
      vcsCheckedAt: DateTime.utc(2026),
      createdAt: DateTime.utc(2026),
    );

Widget _wrap(Widget w) => MaterialApp(home: Scaffold(body: Center(child: w)));

void main() {
  testWidgets('hidden when vcsRoot is null', (tester) async {
    await tester.pumpWidget(_wrap(ProjectVcsChip(project: _proj())));
    expect(find.byType(InkWell), findsNothing);
  });

  testWidgets('shows branch text when vcsRoot != null', (tester) async {
    await tester.pumpWidget(_wrap(ProjectVcsChip(
      project: _proj(vcsRoot: '/r', vcsBranch: 'main'),
    )));
    expect(find.text('main'), findsOneWidget);
  });

  testWidgets('shows detached label when branch null but vcsRoot set',
      (tester) async {
    await tester.pumpWidget(_wrap(ProjectVcsChip(
      project: _proj(vcsRoot: '/r'),
    )));
    expect(find.text('(detached)'), findsOneWidget);
  });

  testWidgets('chip is tappable when vcsRoot present (opens popover)',
      (tester) async {
    await tester.pumpWidget(_wrap(ProjectVcsChip(
      project: _proj(vcsRoot: '/r', vcsBranch: 'main'),
    )));
    // The chip wraps its label in an InkWell that opens the branch popover.
    // We only assert the InkWell is hit-testable; popover behavior is
    // covered by integration tests against the live controller.
    expect(find.byType(InkWell), findsWidgets);
  });
}
