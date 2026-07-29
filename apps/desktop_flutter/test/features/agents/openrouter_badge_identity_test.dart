/// Widget tests for the model-family-aware agent badge through the REAL
/// _AgentKindBadge surface (via AgentKindBadgeTestHarness).
///
/// BUG: OpenRouter (aggregator) sessions showed "Claude Code" + the claude
/// icon for non-Claude models. providerId='openrouter' is intentionally absent
/// from providerToAgentKind, so resolution fell back to the creation agentId
/// (default 'claude-code'). A Llama/DeepSeek model must now read "OpenRouter".
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';

final _allConfigs = [
  AgentConfig(
    id: 'claude-code',
    label: 'Claude Code',
    icon: 'terminal',
    enabled: true,
    isAgent: true,
    sortOrder: 0,
  ),
  AgentConfig(
    id: 'codex',
    label: 'Codex',
    icon: 'terminal',
    enabled: true,
    isAgent: true,
    sortOrder: 1,
  ),
  AgentConfig(
    id: 'gemini-cli',
    label: 'Gemini CLI',
    icon: 'terminal',
    enabled: true,
    isAgent: true,
    sortOrder: 2,
  ),
];

class _FakeAgentConfigsDataSource extends AgentConfigsDataSource {
  _FakeAgentConfigsDataSource(this._configs);
  final List<AgentConfig> _configs;

  @override
  Future<List<AgentConfig>> list() async => _configs;
}

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

  @override
  bool isAgentAvailable(String kind) => true;

  @override
  Future<void> initialize() async {}

  @override
  Future<void> retry() async {}
}

Future<AgentConfigsController> _makeConfigsController() async {
  final ctrl = AgentConfigsController(
    AgentConfigsRepository(_FakeAgentConfigsDataSource(_allConfigs)),
  );
  await ctrl.refresh();
  return ctrl;
}

Widget _wrap({
  required AgentConfigsController configsCtrl,
  required AgentServerController serverCtrl,
  required Widget child,
}) {
  return MaterialApp(
    theme: AppTheme.light(),
    home: Scaffold(
      body: MultiProvider(
        providers: [
          ChangeNotifierProvider<AgentConfigsController>.value(
            value: configsCtrl,
          ),
          ChangeNotifierProvider<AgentServerController>.value(
            value: serverCtrl,
          ),
        ],
        child: Center(child: child),
      ),
    ),
  );
}

void main() {
  testWidgets(
    'OpenRouter + Llama model renders "OpenRouter", NOT "Claude Code"',
    (tester) async {
      final configsCtrl = await _makeConfigsController();
      addTearDown(configsCtrl.dispose);
      final serverCtrl = _ReadyAgentServerController();
      addTearDown(serverCtrl.dispose);

      await tester.pumpWidget(
        _wrap(
          configsCtrl: configsCtrl,
          serverCtrl: serverCtrl,
          child: const AgentKindBadgeTestHarness(
            agentId: 'claude-code', // server default — the bug source
            providerId: 'openrouter', // aggregator, unmapped
            modelId: 'meta-llama/llama-3.1-70b',
          ),
        ),
      );
      await tester.pump();

      expect(
        find.text('OpenRouter'),
        findsOneWidget,
        reason: 'A non-Claude model via OpenRouter must read "OpenRouter".',
      );
      expect(
        find.text('Claude Code'),
        findsNothing,
        reason: 'Must NOT mislabel a Llama model as Claude Code.',
      );
      expect(
        find.byIcon(Icons.alt_route),
        findsOneWidget,
        reason: 'OpenRouter identity uses a neutral Material icon.',
      );
    },
  );

  testWidgets('OpenRouter + Claude model still renders "Claude Code"', (
    tester,
  ) async {
    final configsCtrl = await _makeConfigsController();
    addTearDown(configsCtrl.dispose);
    final serverCtrl = _ReadyAgentServerController();
    addTearDown(serverCtrl.dispose);

    await tester.pumpWidget(
      _wrap(
        configsCtrl: configsCtrl,
        serverCtrl: serverCtrl,
        child: const AgentKindBadgeTestHarness(
          agentId: 'claude-code',
          providerId: 'openrouter',
          modelId: 'anthropic/claude-opus-4.7',
        ),
      ),
    );
    await tester.pump();

    expect(
      find.text('Claude Code'),
      findsOneWidget,
      reason: 'A Claude model via OpenRouter is correctly Claude Code.',
    );
    expect(find.text('OpenRouter'), findsNothing);
    expect(find.byIcon(Icons.alt_route), findsNothing);
  });

  testWidgets('OpenRouter + GPT model renders "Codex"', (tester) async {
    final configsCtrl = await _makeConfigsController();
    addTearDown(configsCtrl.dispose);
    final serverCtrl = _ReadyAgentServerController();
    addTearDown(serverCtrl.dispose);

    await tester.pumpWidget(
      _wrap(
        configsCtrl: configsCtrl,
        serverCtrl: serverCtrl,
        child: const AgentKindBadgeTestHarness(
          agentId: 'claude-code',
          providerId: 'openrouter',
          modelId: 'openai/gpt-4o',
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Codex'), findsOneWidget);
    expect(find.text('Claude Code'), findsNothing);
  });
}
