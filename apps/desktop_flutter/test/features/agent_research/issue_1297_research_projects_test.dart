import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/ui/tokens/rhythm_theme.dart';
import 'package:rhythm_desktop/features/agent_research/controllers/agent_research_controller.dart';
import 'package:rhythm_desktop/features/agent_research/data/agent_research_data_source.dart';
import 'package:rhythm_desktop/features/agent_research/models/research_project.dart';
import 'package:rhythm_desktop/features/agent_research/repositories/agent_research_repository.dart';
import 'package:rhythm_desktop/features/agent_research/views/agent_research_view.dart';

const projectJson = {
  'id': 'project-1',
  'ownerUserId': 7,
  'name': 'Theology daily',
  'question': 'What changed?',
  'goals': [],
  'domain': 'theological',
  'profileId': 'research',
  'passConfig': [],
  'modelPolicy': {},
  'criticConfig': {'enabled': true},
  'synthesisConfig': {'enabled': true},
  'scheduleRef': null,
  'budget': {'maxTokens': 1000, 'maxCostUsd': 2},
  'archivedAt': null,
  'createdAt': '2026-07-27T00:00:00Z',
  'updatedAt': '2026-07-27T00:00:00Z'
};
const runJson = {
  'id': 'run-1',
  'projectId': 'project-1',
  'ownerUserId': 7,
  'triggerType': 'manual',
  'configSnapshot': {
    'budget': {'maxTokens': 1000, 'maxCostUsd': 2}
  },
  'status': 'degraded',
  'progress': {
    'totalJobs': 3,
    'completedJobs': 2,
    'failedJobs': 1,
    'artifactCount': 1,
    'sourceCount': 1,
    'stages': [
      {
        'id': 'pass-1',
        'role': 'primary',
        'ordinal': 0,
        'status': 'done',
        'profileId': 'research',
        'model': 'openai/gpt-5',
        'report': '# Pass evidence'
      },
      {
        'id': 'critic',
        'role': 'critic',
        'ordinal': 1000,
        'status': 'error',
        'profileId': 'research',
        'model': null,
        'report': null
      },
      {
        'id': 'synthesis',
        'role': 'synthesis',
        'ordinal': 1001,
        'status': 'done',
        'profileId': 'research',
        'model': null,
        'report': '# Canonical synthesis\n\nQualified finding.'
      }
    ]
  },
  'diagnostics': {'degraded': true},
  'startedAt': '2026-07-27T01:00:00Z',
  'completedAt': '2026-07-27T01:05:00Z',
  'createdAt': '2026-07-27T01:00:00Z',
  'canonicalArtifact': {'id': 'artifact-1', 'vault_path': 'Research/day.md'},
  'artifacts': [
    {
      'id': 'artifact-1',
      'artifact_role': 'canonical',
      'vault_path': 'Research/day.md'
    }
  ],
  'sources': [
    {
      'id': 'source-1',
      'canonical_url': 'https://example.com',
      'capture_status': 'complete'
    }
  ],
  'usage': {'tokens': 250, 'costUsd': 0.42}
};

AgentResearchController controller() =>
    AgentResearchController(AgentResearchRepository(AgentResearchDataSource()));

Future<void> pump(WidgetTester tester, AgentResearchController value) =>
    tester.pumpWidget(ChangeNotifierProvider.value(
        value: value,
        child: MaterialApp(
            theme: ThemeData(extensions: const [RhythmColorRoles.light]),
            home: const AgentResearchView())));

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('issue-1297-c2: parses factual persisted timeline states', () {
    final run = ResearchProjectRun.fromJson(runJson);
    expect(run.stages.map((stage) => stage.status), ['done', 'error', 'done']);
    expect(run.status, 'degraded');
    expect(run.usage.tokens, 250);
    expect(run.progressPercent, closeTo(2 / 3, .001));
    for (final state in [
      'pending',
      'running',
      'degraded',
      'error',
      'cancelled',
      'complete'
    ]) {
      expect(ResearchProjectRun.fromJson({...runJson, 'status': state}).status,
          state);
    }
  });

  test(
      'issue-1298-c6: magazine and deterministic export actions use owned run routes',
      () {
    final source = AgentResearchDataSource();
    expect(source.magazineUri('project-1', 'run-1').path,
        endsWith('/agent-research/projects/project-1/runs/run-1/magazine'));
    expect(source.exportUri('project-1', 'run-1', 'html').queryParameters,
        {'format': 'html'});
    expect(source.exportUri('project-1', 'run-1', 'markdown').queryParameters,
        {'format': 'markdown'});
  });

  testWidgets('issue-1297-c1: project CRUD and run controls call owned APIs',
      (tester) async {
    final requests = <http.BaseRequest>[];
    final value = controller();
    await http.runWithClient(() async {
      await pump(tester, value);
      await tester.pumpAndSettle();
      expect(find.text('Theology daily'), findsWidgets);
      await tester.tap(find.text('Run project'));
      await tester.pump();
      await value.updateProject('project-1', {'name': 'Edited'});
      await value.runAction('cancel');
      await value.runAction('resume');
      await value.passAction(value.selectedRun!.stages[1], 'retry');
      expect(await value.startDiscussion(const []), 'discussion-1');
      await value.archiveProject('project-1');
      expect(
          requests.any((r) =>
              r.method == 'POST' &&
              r.url.path.endsWith('/projects/project-1/runs')),
          isTrue);
      expect(
          requests.any((r) =>
              r.method == 'PATCH' &&
              r.url.path.endsWith('/projects/project-1')),
          isTrue);
      expect(requests.any((r) => r.url.path.endsWith('/runs/run-1/cancel')),
          isTrue);
      expect(requests.any((r) => r.url.path.endsWith('/runs/run-1/resume')),
          isTrue);
      expect(requests.any((r) => r.url.path.endsWith('/passes/critic/retry')),
          isTrue);
      expect(
          requests
              .any((r) => r.url.path.endsWith('/projects/project-1/archive')),
          isTrue);
      expect(
          requests.any((r) =>
              r.method == 'POST' &&
              r.url.path.endsWith('/runs/run-1/discussions')),
          isTrue);
    },
        () => MockClient((request) async {
              requests.add(request);
              final p = request.url.path;
              if (p.endsWith('/skill-wiring'))
                return http.Response(
                    jsonEncode({'capabilityDiagnostics': []}), 200);
              if (p.endsWith('/projects') && request.method == 'GET') {
                return http.Response(jsonEncode([projectJson]), 200);
              }
              if (p.endsWith('/projects') && request.method == 'POST') {
                return http.Response(jsonEncode(projectJson), 201);
              }
              if (p.endsWith('/projects/project-1') &&
                  request.method == 'PATCH') {
                return http.Response(
                    jsonEncode({...projectJson, 'name': 'Edited'}), 200);
              }
              if (p.endsWith('/projects/project-1/archive')) {
                return http.Response(
                    jsonEncode(
                        {...projectJson, 'archivedAt': '2026-07-28T00:00:00Z'}),
                    200);
              }
              if (p.endsWith('/projects/project-1/runs') &&
                  request.method == 'GET')
                return http.Response(jsonEncode([runJson]), 200);
              if (p.endsWith('/projects/project-1/runs') &&
                  request.method == 'POST')
                return http.Response(jsonEncode(runJson), 201);
              if (p.contains('/passes/')) return http.Response('{}', 200);
              if (p.endsWith('/runs/run-1/discussions')) {
                return http.Response(
                    jsonEncode({'sessionId': 'discussion-1'}), 202);
              }
              if (p.endsWith('/cancel') || p.endsWith('/resume')) {
                return http.Response(jsonEncode(runJson), 200);
              }
              if (p.endsWith('/runs/run-1'))
                return http.Response(jsonEncode(runJson), 200);
              return http.Response(jsonEncode([]), 200);
            }));
    value.dispose();
  });

  testWidgets('issue-1297-c3: renders synthesis markdown and source tabs',
      (tester) async {
    final value = controller();
    await http.runWithClient(() async {
      await pump(tester, value);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Theology daily').first);
      await tester.pumpAndSettle();
      expect(find.text('Synthesis'), findsWidgets);
      expect(find.textContaining('Canonical synthesis'), findsOneWidget);
      expect(find.text('Resume'), findsOneWidget);
      expect(find.text('Discuss report'), findsOneWidget);
      expect(find.text('Cancel'), findsNothing);
      expect(find.text('error'), findsOneWidget);
      await tester.tap(find.text('Sources'));
      await tester.pumpAndSettle();
      expect(find.text('https://example.com'), findsOneWidget);
    },
        () => MockClient((r) async {
              if (r.url.path.endsWith('/skill-wiring'))
                return http.Response(
                    jsonEncode({'capabilityDiagnostics': []}), 200);
              if (r.url.path.endsWith('/projects'))
                return http.Response(jsonEncode([projectJson]), 200);
              if (r.url.path.endsWith('/runs'))
                return http.Response(jsonEncode([runJson]), 200);
              return http.Response(jsonEncode(runJson), 200);
            }));
    value.dispose();
  });

  testWidgets('issue-1297-c4: shows capability warnings and budget usage',
      (tester) async {
    final value = controller();
    await http.runWithClient(() async {
      await pump(tester, value);
      await tester.pumpAndSettle();
      expect(find.textContaining('Gmail unavailable'), findsOneWidget);
      await tester.tap(find.text('Theology daily').first);
      await tester.pumpAndSettle();
      expect(find.textContaining('250 / 1,000 tokens'), findsOneWidget);
      expect(find.textContaining(r'$0.42 / $2.00'), findsOneWidget);
    },
        () => MockClient((r) async {
              if (r.url.path.endsWith('/skill-wiring'))
                return http.Response(
                    jsonEncode({
                      'capabilityDiagnostics': [
                        {
                          'agentId': 'research',
                          'warnings': ['Gmail unavailable'],
                          'channels': {}
                        }
                      ]
                    }),
                    200);
              if (r.url.path.endsWith('/projects'))
                return http.Response(jsonEncode([projectJson]), 200);
              if (r.url.path.endsWith('/runs'))
                return http.Response(jsonEncode([runJson]), 200);
              return http.Response(jsonEncode(runJson), 200);
            }));
    value.dispose();
  });

  testWidgets(
      'issue-1297-c5: falls back to Legacy Research when projects return 404',
      (tester) async {
    final value = controller();
    await http.runWithClient(() async {
      await pump(tester, value);
      await tester.pumpAndSettle();
      expect(find.text('Legacy Research'), findsOneWidget);
      expect(find.text('Legacy finding'), findsOneWidget);
    },
        () => MockClient((r) async {
              if (r.url.path.endsWith('/projects'))
                return http.Response(
                    jsonEncode({
                      'error': {'message': 'not found'}
                    }),
                    404);
              return http.Response(
                  jsonEncode([
                    {
                      'id': 'legacy',
                      'query': 'Legacy finding',
                      'status': 'done',
                      'sourcesJson': '[]',
                      'createdAt': '2026-01-01',
                      'updatedAt': '2026-01-01'
                    }
                  ]),
                  200);
            }));
    value.dispose();
  });
}
