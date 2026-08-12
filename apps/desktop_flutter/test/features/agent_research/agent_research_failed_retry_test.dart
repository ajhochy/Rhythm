import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/ui/tokens/rhythm_theme.dart';
import 'package:rhythm_desktop/features/agent_research/controllers/agent_research_controller.dart';
import 'package:rhythm_desktop/features/agent_research/data/agent_research_data_source.dart';
import 'package:rhythm_desktop/features/agent_research/repositories/agent_research_repository.dart';
import 'package:rhythm_desktop/features/agent_research/views/agent_research_view.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const failedJob = {
    'id': 'research-1',
    'query': 'Why did this research fail?',
    'status': 'error',
    'sourcesJson': '[]',
    'error': 'Provider unavailable. Connect it and retry.',
    'canRetry': true,
    'createdAt': '2026-01-01T00:00:00.000Z',
    'updatedAt': '2026-01-01T00:00:00.000Z',
  };

  testWidgets(
      'failed research shows its error and retries through the controller',
      (tester) async {
    final requests = <http.BaseRequest>[];
    final controller = AgentResearchController(
      AgentResearchRepository(AgentResearchDataSource()),
    );
    await http.runWithClient(() async {
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: controller,
          child: MaterialApp(
            theme: ThemeData(extensions: const [RhythmColorRoles.light]),
            home: const AgentResearchView(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Failed'), findsOneWidget);
      expect(find.text('Provider unavailable. Connect it and retry.'),
          findsOneWidget);
      expect(find.widgetWithText(TextButton, 'Retry'), findsOneWidget);

      await tester.tap(find.widgetWithText(TextButton, 'Retry'));
      await tester.pump();
      expect(
          requests.any((request) =>
              request.method == 'POST' &&
              request.url.path.endsWith('/agent-research/research-1/retry')),
          isTrue);
    },
        () => MockClient((request) async {
              requests.add(request);
              if (request.url.path.endsWith('/agent-research/projects')) {
                return http.Response(
                  jsonEncode({
                    'error': {'message': 'not found'}
                  }),
                  404,
                );
              }
              if (request.method == 'POST') {
                return http.Response(
                    jsonEncode(
                        {...failedJob, 'status': 'pending', 'error': null}),
                    202);
              }
              return http.Response(jsonEncode([failedJob]), 200);
            }));
    controller.dispose();
  });
}
