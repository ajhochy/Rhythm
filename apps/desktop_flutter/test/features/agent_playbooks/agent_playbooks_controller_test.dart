/// Controller unit tests for #1051 (OCU-10) — Playbooks manager.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agent_playbooks/controllers/agent_playbooks_controller.dart';
import 'package:rhythm_desktop/features/agent_playbooks/data/agent_playbooks_data_source.dart';

class _FakeDataSource implements AgentPlaybooksDataSource {
  List<PlaybookEntry> listResult = [];
  String? deleteError;
  final List<String> deletedNames = [];

  @override
  Future<List<PlaybookEntry>> list() async => listResult;

  @override
  Future<void> delete(String name) async {
    if (deleteError != null) throw Exception(deleteError);
    deletedNames.add(name);
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  group('#1051 — AgentPlaybooksController', () {
    test('loadPlaybooks populates the list and flips status to idle', () async {
      final ds = _FakeDataSource()
        ..listResult = const [
          PlaybookEntry(
            name: 'deploy-notes',
            description: 'Draft deploy notes',
            source: 'command',
            managed: true,
          ),
        ];
      final controller = AgentPlaybooksController(ds);

      expect(controller.status, AgentPlaybooksStatus.idle);
      await controller.loadPlaybooks();

      expect(controller.status, AgentPlaybooksStatus.idle);
      expect(controller.playbooks, hasLength(1));
      expect(controller.playbooks.first.name, 'deploy-notes');
      expect(controller.playbookNames, {'deploy-notes'});
    });

    test('loadPlaybooks surfaces an error and keeps the list empty', () async {
      final throwingDs = _ThrowingListDataSource();
      final controller = AgentPlaybooksController(throwingDs);
      await controller.loadPlaybooks();

      expect(controller.status, AgentPlaybooksStatus.error);
      expect(controller.playbooks, isEmpty);
      expect(controller.error, isNotNull);
    });

    test('deletePlaybook removes a managed playbook and reloads', () async {
      final ds = _FakeDataSource()
        ..listResult = const [
          PlaybookEntry(
            name: 'to-delete',
            description: null,
            source: 'command',
            managed: true,
          ),
        ];
      final controller = AgentPlaybooksController(ds);
      await controller.loadPlaybooks();

      // Simulate the server-side removal on the next list() call.
      ds.listResult = const [];
      final ok = await controller.deletePlaybook('to-delete');

      expect(ok, isTrue);
      expect(ds.deletedNames, ['to-delete']);
      expect(controller.playbooks, isEmpty);
    });

    test('deletePlaybook surfaces an error and returns false', () async {
      final ds = _FakeDataSource()..deleteError = 'not managed';
      final controller = AgentPlaybooksController(ds);

      final ok = await controller.deletePlaybook('built-in');

      expect(ok, isFalse);
      expect(controller.error, contains('not managed'));
    });
  });
}

class _ThrowingListDataSource implements AgentPlaybooksDataSource {
  @override
  Future<List<PlaybookEntry>> list() async => throw Exception('boom');

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
