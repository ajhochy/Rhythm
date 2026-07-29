/// Unit tests for AgentMemoryController's edit-in-place support (#862).
///
/// Asserts:
///   1. update() replaces the edited entry in-place in the controller's
///      entry list (persists after a "refresh" of controller state, i.e.
///      the caller doesn't need a full list reload to see the edit).
///   2. update() returns false and sets `error` on a data-source failure —
///      the entry list is left untouched (no silent drop of the edit).
///   3. delete() still works after update() is added (no regression).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agent_memory/controllers/agent_memory_controller.dart';
import 'package:rhythm_desktop/features/agent_memory/data/agent_memory_data_source.dart';
import 'package:rhythm_desktop/features/agent_memory/models/agent_memory_entry.dart';
import 'package:rhythm_desktop/features/agent_memory/repositories/agent_memory_repository.dart';

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0).toIso8601String();

AgentMemoryEntry _makeEntry(
  String id,
  String content, {
  String kind = 'fact',
}) =>
    AgentMemoryEntry(
      id: id,
      kind: kind,
      content: content,
      tags: const [],
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );

/// Fake data source: list() returns a fixed seed; update()/delete() operate
/// on an in-memory map so tests can control success/failure per call.
class _FakeMemoryDataSource extends AgentMemoryDataSource {
  _FakeMemoryDataSource(List<AgentMemoryEntry> seed) {
    for (final e in seed) {
      _byId[e.id] = e;
    }
  }

  final Map<String, AgentMemoryEntry> _byId = {};
  bool failNextUpdate = false;

  @override
  Future<List<AgentMemoryEntry>> list() async => _byId.values.toList();

  @override
  Future<List<AgentMemoryEntry>> search(String q) async =>
      _byId.values.where((e) => e.content.contains(q)).toList();

  @override
  Future<AgentMemoryEntry> update(String id, Map<String, dynamic> patch) async {
    if (failNextUpdate) {
      failNextUpdate = false;
      throw Exception('simulated update failure');
    }
    final existing = _byId[id];
    if (existing == null) throw Exception('not found');
    final updated = _makeEntry(
      id,
      patch['content'] as String? ?? existing.content,
      kind: patch['kind'] as String? ?? existing.kind,
    );
    _byId[id] = updated;
    return updated;
  }

  @override
  Future<void> delete(String id) async {
    _byId.remove(id);
  }
}

void main() {
  group('AgentMemoryController.update (#862)', () {
    test('replaces the entry in-place on success', () async {
      final dataSource = _FakeMemoryDataSource([
        _makeEntry('mem-1', 'Original content'),
        _makeEntry('mem-2', 'Unrelated entry'),
      ]);
      final controller = AgentMemoryController(
        AgentMemoryRepository(dataSource),
      );
      await controller.refresh();
      expect(controller.entries.length, 2);

      final ok = await controller.update('mem-1', {
        'content': 'Edited content',
      });

      expect(ok, isTrue);
      expect(controller.error, isNull);
      final edited = controller.entries.firstWhere((e) => e.id == 'mem-1');
      expect(edited.content, 'Edited content');
      // The unrelated entry is untouched.
      final other = controller.entries.firstWhere((e) => e.id == 'mem-2');
      expect(other.content, 'Unrelated entry');
    });

    test(
      'a failed update sets an error and leaves the entry untouched (no silent drop)',
      () async {
        final dataSource = _FakeMemoryDataSource([
          _makeEntry('mem-1', 'Original content'),
        ]);
        dataSource.failNextUpdate = true;
        final controller = AgentMemoryController(
          AgentMemoryRepository(dataSource),
        );
        await controller.refresh();

        final ok = await controller.update('mem-1', {
          'content': 'Should not stick',
        });

        expect(ok, isFalse);
        expect(controller.error, isNotNull);
        final entry = controller.entries.firstWhere((e) => e.id == 'mem-1');
        expect(entry.content, 'Original content');
      },
    );

    test('delete still works after update is added (no regression)', () async {
      final dataSource = _FakeMemoryDataSource([
        _makeEntry('mem-1', 'Delete me'),
      ]);
      final controller = AgentMemoryController(
        AgentMemoryRepository(dataSource),
      );
      await controller.refresh();
      expect(controller.entries.length, 1);

      final deleted = await controller.delete('mem-1');

      expect(deleted, isTrue);
      expect(controller.entries, isEmpty);
    });
  });
}
