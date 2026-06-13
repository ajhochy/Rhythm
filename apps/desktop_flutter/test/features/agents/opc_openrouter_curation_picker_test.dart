/// END-TO-END curation → picker test (replaces the source-grep regression test
/// opc_openrouter_curation_refresh_test.dart).
///
/// The old test merely asserted the SOURCE STRING `refreshCatalog(` appeared in
/// the section file — it pumped no widgets, made no HTTP call, and never
/// confirmed a curated model actually reaches the picker. It would pass on a
/// renamed-but-broken call, a wrong argument, or a dead `refreshCatalog()`.
///
/// This test drives the REAL behavior the bug was about:
///
///   tap the visibility checkbox in the REAL OpenRouterModelsSection
///     -> AgentModelVisibilityDataSource PATCH /agent-models/visibility   (real)
///     -> AgentsController.refreshCatalog()                                (real)
///         -> AgentModelsDataSource GET /agents/models/catalog             (real)
///     -> AgentsController.catalog updated -> notifyListeners
///   open the REAL UnifiedAgentModelPicker
///     -> the curated OpenRouter model is now an entry in the popup
///
/// The ONLY fake is one shared http.Client standing in for the agent backend,
/// routed by path+method and holding a `curated` flag the PATCH flips — exactly
/// like the server-side test's fake SDK client. A regression (curation not
/// refreshing the catalog the picker reads — the original #639 bug) fails here
/// as a missing popup entry, not a green source grep.
///
/// Run with:
///   flutter test test/features/agents/opc_openrouter_curation_picker_test.dart
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/data/agent_model_visibility_data_source.dart';
import 'package:rhythm_desktop/features/agents/data/agent_models_data_source.dart';
import 'package:rhythm_desktop/features/agents/data/agents_data_source.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_open_router_models_section.dart';
import 'package:rhythm_desktop/features/agents/views/_unified_agent_model_picker.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Scaffolding (not the boundary under test).
// ---------------------------------------------------------------------------

class _FakeApiServerService extends ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: true, reason: null, stderrTail: null, failureMessage: null);

  @override
  void stop() {}

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _ReadyAgentServerController extends AgentServerController {
  _ReadyAgentServerController() : super(_FakeApiServerService());

  @override
  AgentServerStatus get status => AgentServerStatus.ready;

  @override
  bool get isReady => true;

  @override
  bool get hasAnyAgent => true;
}

// ---------------------------------------------------------------------------
// A single in-memory fake backend, routed by path + method, holding the
// curation state the PATCH flips. Both data sources share this one client.
// ---------------------------------------------------------------------------

const _kAnthropicEntry = {
  'agent': 'claude-code',
  'provider': 'anthropic',
  'modelId': 'claude-sonnet-4-6',
  'displayName': 'claude-sonnet-4-6',
  'route': 'direct',
  'authorized': true,
  'authProvider': 'anthropic',
};

const _kCuratedOpenRouterEntry = {
  'agent': 'opencode',
  'provider': 'openrouter',
  'modelId': 'zephyr-7b',
  'displayName': 'Zephyr 7B',
  'route': 'aggregator',
  'authorized': true,
  'authProvider': 'openrouter',
};

class _FakeBackend {
  /// Flipped true once the user curates (PATCH /agent-models/visibility).
  bool curated = false;
  int patchCount = 0;

  http.Client build() => MockClient((req) async {
        final path = req.url.path;
        final method = req.method;

        // Catalog the picker reads. Curated model appears only after the PATCH.
        if (method == 'GET' && path == '/agents/models/catalog') {
          final entries = [
            _kAnthropicEntry,
            if (curated) _kCuratedOpenRouterEntry,
          ];
          return http.Response(jsonEncode(entries), 200,
              headers: {'content-type': 'application/json'});
        }

        // Per-session routes (refreshModelRoutes); not exercised here, but safe.
        if (method == 'GET' && path == '/agents/models') {
          return http.Response('[]', 200,
              headers: {'content-type': 'application/json'});
        }

        // Existing visibility rows — none yet, so the model starts unchecked.
        if (method == 'GET' && path == '/agent-models/visibility') {
          return http.Response('[]', 200,
              headers: {'content-type': 'application/json'});
        }

        // The curation write: flip the catalog the picker will re-fetch.
        if (method == 'PATCH' && path == '/agent-models/visibility') {
          patchCount++;
          curated = true;
          return http.Response('{}', 200,
              headers: {'content-type': 'application/json'});
        }

        // OpenRouter public catalog the section lists for curation.
        if (method == 'GET' && path == '/opencode/models') {
          return http.Response(
            jsonEncode([
              {'id': 'zephyr-7b', 'name': 'Zephyr 7B', 'context_length': 8192},
            ]),
            200,
            headers: {'content-type': 'application/json'},
          );
        }

        return http.Response('not found', 404);
      });
}

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0);

AgentSession _session() => AgentSession(
      id: 'sess-picker-1',
      agentId: 'claude-code',
      name: 'Picker Test',
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );

bool _catalogHasOpenRouter(AgentsController c) =>
    c.catalog.any((e) => e.provider == 'openrouter');

void main() {
  late _FakeBackend backend;
  late http.Client client;
  late AgentsController controller;
  late AgentModelVisibilityDataSource visibilityDs;

  setUp(() {
    backend = _FakeBackend();
    client = backend.build();
    controller = AgentsController(
      AgentsRepository(AgentsDataSource(client: client)),
      _ReadyAgentServerController(),
      LocalNotificationService(),
      NotificationsController(
        NotificationsRepository(NotificationsDataSource()),
      ),
      modelsDataSource: AgentModelsDataSource(client: client),
    );
    visibilityDs = AgentModelVisibilityDataSource(client: client);
  });

  tearDown(() => controller.dispose());

  Widget wrap() => ChangeNotifierProvider<AgentsController>.value(
        value: controller,
        child: MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(
            body: SizedBox(
              width: 1200,
              height: 1600,
              child: Column(
                children: [
                  OpenRouterModelsSection(dataSource: visibilityDs),
                  const SizedBox(height: 24),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: UnifiedAgentModelPicker(session: _session()),
                  ),
                ],
              ),
            ),
          ),
        ),
      );

  testWidgets(
    'negative control: with no curation the picker popup has no OpenRouter '
    'entry',
    (tester) async {
      await controller.refreshCatalog(); // loads catalog A (anthropic only)
      await tester.pumpWidget(wrap());
      await tester.pumpAndSettle();

      expect(_catalogHasOpenRouter(controller), isFalse);

      // Open the real picker popup.
      await tester.tap(find.byType(UnifiedAgentModelPicker));
      await tester.pumpAndSettle();

      // The connected direct model is there; the aggregator tag is not.
      expect(find.text('claude-sonnet-4-6'), findsWidgets);
      expect(
        find.text('via OpenRouter'),
        findsNothing,
        reason: 'no curated OpenRouter model should appear before curation',
      );
    },
  );

  testWidgets(
    'curating a model in the section makes it appear in the picker popup '
    '(guards the #639 catalog-refresh regression end-to-end)',
    (tester) async {
      await controller.refreshCatalog(); // catalog A
      await tester.pumpWidget(wrap());
      await tester.pumpAndSettle();

      // Precondition: the curated model is absent from the picker's source.
      expect(_catalogHasOpenRouter(controller), isFalse);

      // Expand the curation section -> loads the OpenRouter catalog.
      await tester.tap(find.text('Browse & curate OpenRouter models'));
      await tester.pumpAndSettle();
      expect(find.text('zephyr-7b'), findsOneWidget); // the section row

      // Curate it: tap the visibility checkbox. This is the real button that
      // writes visibility AND must refresh the catalog the picker reads.
      await tester.tap(find.byType(Checkbox));
      await tester.pumpAndSettle(const Duration(milliseconds: 200));

      // The write happened and the catalog the picker reads was refreshed.
      expect(backend.patchCount, 1);
      expect(
        _catalogHasOpenRouter(controller),
        isTrue,
        reason: 'refreshCatalog() must repopulate controller.catalog — the '
            'exact gap the #639 bug lived in',
      );

      // Open the real picker popup and confirm the curated model is now an
      // entry (the aggregator tag is rendered only by the picker, not the
      // section, so it is an unambiguous picker-presence signal).
      await tester.tap(find.byType(UnifiedAgentModelPicker));
      await tester.pumpAndSettle();
      expect(find.text('via OpenRouter'), findsOneWidget);
      expect(find.text('Zephyr 7B'), findsWidgets);
    },
  );
}
