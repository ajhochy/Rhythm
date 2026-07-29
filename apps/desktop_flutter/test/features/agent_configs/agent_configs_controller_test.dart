import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';

/// Returns a production-shaped catalog with TWO manager profiles — the dev
/// `workflow-orchestrator` FIRST, then `secretary` — plus a specialist. This
/// mirrors the real `/agent-configs` payload that broke the #888 smoke: the
/// data model assumes exactly one manager, but installs carry both.
class _TwoManagerDataSource extends AgentConfigsDataSource {
  @override
  Future<List<AgentConfig>> list() async => [
    AgentConfig(
      id: 'workflow-orchestrator',
      label: 'Workflow Orchestrator',
      icon: '',
      enabled: true,
      isAgent: true,
      sortOrder: 0,
      isManager: true,
      ocAgent: 'workflow-orchestrator',
    ),
    AgentConfig(
      id: 'secretary',
      label: 'Secretary',
      icon: '',
      enabled: true,
      isAgent: true,
      sortOrder: 1,
      isManager: true,
      ocAgent: 'secretary',
    ),
    AgentConfig(
      id: 'theologian',
      label: 'Theologian',
      icon: '',
      enabled: true,
      isAgent: true,
      sortOrder: 2,
      ocAgent: 'theologian',
    ),
  ];
}

/// A catalog with no Secretary profile at all, to prove `secretaryAgent`
/// returns null (so the caller's `?? 'secretary'` slug fallback engages).
class _NoSecretaryDataSource extends AgentConfigsDataSource {
  @override
  Future<List<AgentConfig>> list() async => [
    AgentConfig(
      id: 'workflow-orchestrator',
      label: 'Workflow Orchestrator',
      icon: '',
      enabled: true,
      isAgent: true,
      sortOrder: 0,
      isManager: true,
      ocAgent: 'workflow-orchestrator',
    ),
  ];
}

void main() {
  group('AgentConfigsController.secretaryAgent (#888)', () {
    test(
      'resolves Secretary by slug even when another manager sorts first',
      () async {
        final controller = AgentConfigsController(
          AgentConfigsRepository(_TwoManagerDataSource()),
        );
        await controller.refresh();

        // managerAgent is ambiguous with two managers — it returns the first
        // (workflow-orchestrator). This is the exact bug the #888 smoke hit.
        expect(
          controller.managerAgent?.ocAgent,
          equals('workflow-orchestrator'),
        );

        // secretaryAgent must resolve Secretary specifically, NOT the first
        // manager. If this ever returns 'workflow-orchestrator', quick actions
        // spawn the wrong agent again.
        expect(controller.secretaryAgent?.ocAgent, equals('secretary'));
        expect(controller.secretaryAgent?.id, equals('secretary'));
      },
    );

    test(
      'returns null when no Secretary profile exists (slug fallback path)',
      () async {
        final controller = AgentConfigsController(
          AgentConfigsRepository(_NoSecretaryDataSource()),
        );
        await controller.refresh();

        expect(controller.secretaryAgent, isNull);
      },
    );
  });
}
