import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agent_projects/controllers/agent_projects_controller.dart';
import 'package:rhythm_desktop/features/agent_projects/data/agent_projects_remote_data_source.dart';
import 'package:rhythm_desktop/features/agent_projects/models/agent_project.dart';
import 'package:rhythm_desktop/features/agent_projects/repositories/agent_projects_repository.dart';

class _FakeRemote extends AgentProjectsRemoteDataSource {
  _FakeRemote() : super();

  final List<AgentProject> store = [];
  bool failNextList = false;

  AgentProject _build({
    required String id,
    required String name,
    String cwd = '/tmp/x',
    String? icon,
    String? vcsRoot,
    String? vcsBranch,
    bool vcsDirty = false,
    DateTime? archivedAt,
  }) =>
      AgentProject(
        id: id,
        name: name,
        cwd: cwd,
        icon: icon,
        vcsRoot: vcsRoot,
        vcsBranch: vcsBranch,
        vcsDirty: vcsDirty,
        vcsCheckedAt: DateTime.utc(2026),
        createdAt: DateTime.utc(2026),
        archivedAt: archivedAt,
      );

  @override
  Future<List<AgentProject>> list({bool includeArchived = false}) async {
    if (failNextList) {
      failNextList = false;
      throw Exception('boom');
    }
    if (includeArchived) return List.of(store);
    return store.where((p) => p.archivedAt == null).toList();
  }

  @override
  Future<AgentProject> create({
    required String name,
    required String cwd,
    String? icon,
  }) async {
    final p =
        _build(id: 'id-${store.length}', name: name, cwd: cwd, icon: icon);
    store.add(p);
    return p;
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
    final idx = store.indexWhere((p) => p.id == id);
    final cur = store[idx];
    final next = _build(
      id: id,
      name: name ?? cur.name,
      cwd: cwd ?? cur.cwd,
      icon: icon ?? cur.icon,
      vcsRoot: cur.vcsRoot,
      vcsBranch: cur.vcsBranch,
      vcsDirty: cur.vcsDirty,
      archivedAt: clearArchivedAt ? null : (archivedAt ?? cur.archivedAt),
    );
    store[idx] = next;
    return next;
  }

  @override
  Future<void> delete(String id) async {
    store.removeWhere((p) => p.id == id);
  }

  @override
  Future<AgentProject> refreshVcs(String id) async {
    final idx = store.indexWhere((p) => p.id == id);
    final cur = store[idx];
    final next = _build(
      id: id,
      name: cur.name,
      cwd: cur.cwd,
      vcsRoot: '/refreshed',
      vcsBranch: 'main',
      vcsDirty: true,
    );
    store[idx] = next;
    return next;
  }
}

void main() {
  late _FakeRemote remote;
  late AgentProjectsController controller;

  setUp(() {
    remote = _FakeRemote();
    controller = AgentProjectsController(AgentProjectsRepository(remote));
  });

  test('load() populates projects on success', () async {
    remote.store.add(AgentProject(
      id: 'a',
      name: 'A',
      cwd: '/x',
      createdAt: DateTime.utc(2026),
    ));
    await controller.load();
    expect(controller.status, AgentProjectsLoadStatus.idle);
    expect(controller.projects.single.id, 'a');
  });

  test('load() sets error on failure', () async {
    remote.failNextList = true;
    await controller.load();
    expect(controller.status, AgentProjectsLoadStatus.error);
    expect(controller.error, isNotNull);
  });

  test('create() appends to in-memory list and notifies', () async {
    var notified = 0;
    controller.addListener(() => notified++);
    final p = await controller.create(name: 'New', cwd: '/tmp/n');
    expect(controller.projects, contains(p));
    expect(notified, greaterThan(0));
  });

  test('update() replaces matching project by id', () async {
    final p = await controller.create(name: 'Old', cwd: '/tmp/u');
    final updated = await controller.update(p.id, name: 'New');
    expect(updated.name, 'New');
    expect(controller.projects.single.name, 'New');
  });

  test('archive() removes from visible list and notifies', () async {
    final p = await controller.create(name: 'Bye', cwd: '/tmp/a');
    controller.select(p.id);
    await controller.archive(p.id);
    expect(controller.projects.where((q) => q.id == p.id), isEmpty);
    expect(controller.selectedProjectId, isNull);
  });

  test('delete() removes from list and notifies', () async {
    final p = await controller.create(name: 'Doomed', cwd: '/tmp/d');
    await controller.delete(p.id);
    expect(controller.projects.where((q) => q.id == p.id), isEmpty);
  });

  test('refreshVcs() updates VCS fields in place', () async {
    final p = await controller.create(name: 'V', cwd: '/tmp/v');
    final refreshed = await controller.refreshVcs(p.id);
    expect(refreshed.vcsRoot, '/refreshed');
    expect(controller.projects.single.vcsBranch, 'main');
  });

  test('select() updates selectedProjectId and notifies; null switches to All',
      () {
    var notified = 0;
    controller.addListener(() => notified++);
    controller.select('abc');
    expect(controller.selectedProjectId, 'abc');
    expect(notified, 1);
    controller.select(null);
    expect(controller.selectedProjectId, isNull);
    expect(notified, 2);
  });

  test('AgentProject.fromJson round-trips nullable VCS fields', () {
    final p = AgentProject.fromJson({
      'id': 'x',
      'name': 'n',
      'cwd': '/a',
      'icon': null,
      'vcsRoot': null,
      'vcsBranch': null,
      'vcsDirty': false,
      'vcsCheckedAt': null,
      'createdAt': '2026-05-14T00:00:00.000Z',
      'archivedAt': null,
    });
    expect(p.vcsRoot, isNull);
    expect(p.vcsBranch, isNull);
    expect(p.vcsDirty, isFalse);
  });
}
