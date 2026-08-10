import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/live_artifacts/controllers/live_artifacts_controller.dart';
import 'package:rhythm_desktop/features/live_artifacts/data/live_artifacts_data_source.dart';
import 'package:rhythm_desktop/features/live_artifacts/models/live_artifact.dart';
import 'package:rhythm_desktop/features/live_artifacts/services/live_artifact_bridge.dart';
import 'package:rhythm_desktop/features/live_artifacts/widgets/dashboard_artifact_tabs.dart';
import 'package:rhythm_desktop/features/live_artifacts/widgets/live_artifact_view.dart';
import 'package:rhythm_desktop/features/settings/data/user_preferences_data_source.dart';

void main() {
  testWidgets('AV-06-c1: selected artifact has a secure viewer and reload',
      (tester) async {
    // Regression: a selected artifact remains the AV-04 placeholder instead of
    // exposing its isolated runtime and an observable reload action.
    final controller = LiveArtifactsController(
      LiveArtifactsDataSource(baseUrl: 'http://localhost'),
      UserPreferencesDataSource(baseUrl: 'http://localhost'),
    );
    controller.debugSetForTest(tabs: [
      LiveArtifactTab(
        id: 'artifact-id',
        status: LiveArtifactTabStatus.ready,
        artifact: LiveArtifact(
          id: 'artifact-id',
          title: 'Worship Calendar',
          updatedAt: DateTime(2026, 8, 9),
        ),
      ),
    ]);
    controller.select('artifact-id');

    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: controller,
      child: MaterialApp(
        home: Scaffold(
          body: DashboardArtifactWorkspace(
            workspaceId: 1,
            dashboard: const SizedBox.expand(),
            controller: controller,
            manageAuthLifecycle: false,
            enableNativeRuntime: false,
          ),
        ),
      ),
    ));

    expect(find.byTooltip('Reload artifact'), findsOneWidget);
    expect(find.text('Worship Calendar'), findsWidgets);
  });

  testWidgets('AV-06-review-c2: toolbar uses safe human provenance',
      (tester) async {
    // Regression: the viewer leaks a raw user ID or an unformatted timestamp
    // instead of the display-safe metadata a collaborator can understand.
    final controller = LiveArtifactsController(
      LiveArtifactsDataSource(baseUrl: 'http://localhost'),
      UserPreferencesDataSource(baseUrl: 'http://localhost'),
    );
    controller.debugSetForTest(tabs: [
      LiveArtifactTab(
        id: 'artifact-id',
        status: LiveArtifactTabStatus.ready,
        artifact: LiveArtifact(
          id: 'artifact-id',
          title: 'Worship Calendar',
          updatedAt: DateTime(2026, 8, 9),
          updatedByDisplayName: 'Jane Smith',
          currentBundleRevision: 1,
          currentStateRevision: 2,
        ),
      ),
    ]);
    controller.select('artifact-id');

    await tester.pumpWidget(ChangeNotifierProvider.value(
      value: controller,
      child: const MaterialApp(
        home: Scaffold(body: _ContractWorkspace()),
      ),
    ));

    expect(
      find.text('Updated Aug 9, 2026 by Jane Smith · Bundle 1 · State 2'),
      findsOneWidget,
    );
    expect(find.textContaining('updatedByUserId'), findsNothing);
  });

  testWidgets(
      'AV-06-review-c3: reload maps unavailable states without disclosure',
      (tester) async {
    // Regression: every reload error becomes the generic retry panel, exposing
    // recovery controls for unavailable tabs or hiding the deleted-tab action.
    for (final status in [403, 404]) {
      final fixture = _ViewerHttpFixture([status]);
      var removed = 0;
      await _pumpViewer(tester, fixture, onRemove: () => removed++);
      expect(find.text('This artifact is unavailable.'), findsOneWidget);
      expect(find.text('Refresh artifact'), findsNothing);
      expect(find.text('Retry artifact'), findsNothing);
      expect(find.text('Remove tab'), findsNothing);
      expect(fixture.getCalls, 1);
      expect(removed, 0);
    }
  });

  testWidgets('AV-06-review-c3: deleted reload offers only Remove tab',
      (tester) async {
    final fixture = _ViewerHttpFixture([410]);
    var removed = 0;
    await _pumpViewer(tester, fixture, onRemove: () => removed++);
    expect(find.text('This artifact was deleted.'), findsOneWidget);
    expect(find.text('Remove tab'), findsOneWidget);
    expect(find.text('Refresh artifact'), findsNothing);
    await tester.tap(find.text('Remove tab'));
    expect(removed, 1);
    expect(fixture.getCalls, 1);
  });

  testWidgets('AV-06-review-c3: conflict reload exposes Refresh artifact',
      (tester) async {
    // Regression: a second detail read after conflict exhausted the fixture
    // statuses and crashed the test harness before it could prove recovery.
    final fixture = _ViewerHttpFixture([409, 200]);
    await _pumpViewer(tester, fixture);
    expect(find.text('This artifact changed elsewhere. Refresh and try again.'),
        findsOneWidget);
    expect(find.text('Refresh artifact'), findsOneWidget);
    expect(find.text('Retry artifact'), findsNothing);
    tester
        .widget<TextButton>(find.widgetWithText(TextButton, 'Refresh artifact'))
        .onPressed!();
    await tester
        .runAsync(() => Future<void>.delayed(const Duration(milliseconds: 1)));
    await tester.pump();
    await tester.pumpAndSettle();
    expect(fixture.getCalls, 2);
    expect(fixture.renderCalls, 1);
    expect(find.text('This artifact changed elsewhere. Refresh and try again.'),
        findsNothing);
  });

  testWidgets('AV-06-review-c3: first load renders the toolbar once',
      (tester) async {
    // Regression: a successful initial detail load does not render the viewer
    // toolbar or requests the assembled document more than once.
    final fixture = _ViewerHttpFixture([200]);
    await _pumpViewer(tester, fixture);
    expect(find.byTooltip('Reload artifact'), findsOneWidget);
    expect(find.text('Secure native viewer is available on macOS.'),
        findsOneWidget);
    expect(fixture.getCalls, 1);
    expect(fixture.renderCalls, 1);
  });

  testWidgets('AV-06-review-c3: exhausted fixture repeats its last status',
      (tester) async {
    // Regression: a second GET indexed statuses at -1 and threw RangeError.
    final fixture = _ViewerHttpFixture([200]);
    final source =
        LiveArtifactsDataSource(baseUrl: 'http://viewer.test', client: fixture);
    await source.get('artifact-id');
    await source.get('artifact-id');
    expect(fixture.getCalls, 2);
    expect(fixture.renderCalls, 0);
  });

  testWidgets('AV-06-review-c3: generic reload uses Retry and recovers',
      (tester) async {
    final fixture = _ViewerHttpFixture([500, 200]);
    await _pumpViewer(tester, fixture);
    expect(find.text('Could not load this artifact.'), findsOneWidget);
    expect(find.text('Retry artifact'), findsOneWidget);
    expect(find.text('Refresh artifact'), findsNothing);
    await tester.tap(find.text('Retry artifact'));
    await tester.pumpAndSettle();
    expect(find.text('Could not load this artifact.'), findsNothing);
    expect(find.text('Secure native viewer is available on macOS.'),
        findsOneWidget);
    expect(fixture.getCalls, 2);
    expect(fixture.renderCalls, 1);
  });

  group('AV-06-c3: LiveArtifactBridge host.blocked', () {
    test('accepts only the five nonce-bearing blocked reasons', () async {
      // Regression: malformed bridge input could show host feedback or invoke a
      // data-source action instead of the closed host.blocked allowlist.
      final source = _RecordingLiveArtifactsDataSource();
      final blocked = <String>[];
      final bridge = _bridge(source, blocked.add);

      for (final reason in [
        'navigation',
        'form',
        'download',
        'file',
        'media'
      ]) {
        final response = await bridge.handle(jsonEncode({
          'id': 'blocked-$reason',
          'method': 'host.blocked',
          'params': reason,
          'nonce': 'native-nonce',
        }));
        expect(response, contains('"ok":true'));
      }

      expect(blocked, ['navigation', 'form', 'download', 'file', 'media']);
      expect(source.calls, isZero);
    });

    test('rejects unknown, nonce-less, and non-string blocked requests',
        () async {
      // Regression: nearby invalid payloads accidentally become user-visible
      // feedback or reach the hosted data source.
      final source = _RecordingLiveArtifactsDataSource();
      final blocked = <String>[];
      final bridge = _bridge(source, blocked.add);

      final unknown = await bridge.handle(jsonEncode({
        'id': 'unknown',
        'method': 'host.blocked',
        'params': 'unknown',
        'nonce': 'native-nonce',
      }));
      final omittedNonce = await bridge.handle(jsonEncode({
        'id': 'missing-nonce',
        'method': 'host.blocked',
        'params': 'form',
      }));
      final nonStringParams = await bridge.handle(jsonEncode({
        'id': 'non-string',
        'method': 'host.blocked',
        'params': {'reason': 'form'},
        'nonce': 'native-nonce',
      }));

      expect(unknown, contains('"code":"request_failed"'));
      expect(omittedNonce, contains('"code":"malformed_request"'));
      expect(nonStringParams, contains('"code":"request_failed"'));
      expect(blocked, isEmpty);
      expect(source.calls, isZero);
    });
  });

  group('AV-06-c3/c8: LiveArtifactBridge deterministic boundary', () {
    test('accepts bounded IDs and rejects invalid IDs before data calls',
        () async {
      // Regression: a malformed page-controlled ID reaches a hosted operation.
      final source = _BridgeSource();
      final bridge = _testBridge(source);
      for (final id in ['a', 'a' * 64]) {
        expect(_response(await bridge.handle(_request(id, 'state.get')))['ok'],
            true);
      }
      for (final id in ['', 'a' * 65]) {
        expect(_errorCode(await bridge.handle(_request(id, 'state.get'))),
            'unsupported_request');
      }
      expect(
          _errorCode(await bridge.handle(jsonEncode({
            'id': 1,
            'method': 'state.get',
            'nonce': 'n',
          }))),
          'malformed_request');
      expect(source.calls, isZero);
    });

    test('rejects malformed shapes and payloads over but not at 64KiB',
        () async {
      // Regression: parser/size failures dispatch an operation or reject a
      // request precisely at the documented size ceiling.
      final source = _BridgeSource();
      final bridge = _testBridge(source);
      for (final raw in [
        'not json',
        '[]',
        jsonEncode(
            {'id': 'x', 'method': 'state.get', 'nonce': 'n', 'extra': 1}),
        jsonEncode(
            {'id': 'x', 'method': 'state.update', 'params': [], 'nonce': 'n'}),
        jsonEncode({'id': 'x', 'method': 'nope', 'nonce': 'n'}),
      ]) {
        expect(_response(await bridge.handle(raw))['ok'], false);
      }
      final base = _request('boundary', 'state.get', nonce: '');
      final exact = _request('boundary', 'state.get',
          nonce: 'n' *
              (LiveArtifactBridge.maxRequestBytes - utf8.encode(base).length));
      expect(utf8.encode(exact).length, LiveArtifactBridge.maxRequestBytes);
      expect(_response(await bridge.handle(exact))['ok'], true);
      expect(_errorCode(await bridge.handle('$exact ')), 'request_too_large');
      expect(source.calls, isZero);
    });

    test('permits only exact state and PCO request bodies', () async {
      // Regression: page-supplied URL/header/token/process fields are forwarded
      // through the bridge instead of rejected before the data source.
      final source = _BridgeSource();
      final bridge = _testBridge(source, capabilities: ['pco.services.read']);
      final get = _response(await bridge.handle(_request('get', 'state.get')));
      expect(get['data'], {
        'state': {'title': 'before'},
        'stateRevision': 1
      });
      await bridge.handle(_request('pco', 'pco.services.read', params: {
        'operation': 'list_plans',
        'serviceTypeId': 'svc',
        'filter': 'future',
      }));
      expect(source.pcoRequests.single.$1, 'artifact-id');
      expect(source.pcoRequests.single.$2, {
        'operation': 'list_plans',
        'serviceTypeId': 'svc',
        'filter': 'future',
      });
      expect(
          _errorCode(await bridge
              .handle(_request('smuggle', 'pco.services.read', params: {
            'operation': 'list_service_types',
            'url': 'https://evil.test',
            'headers': {'Authorization': 'x'},
          }))),
          'request_failed');
      expect(source.pcoRequests, hasLength(1));
      await bridge.handle(_request('update', 'state.update', params: {
        'expectedStateRevision': 1,
        'state': {'title': 'after'},
      }));
      expect(source.updateRequests.single.$1, 'artifact-id');
      expect(source.updateRequests.single.$2, 1);
      expect(source.updateRequests.single.$3, {'title': 'after'});
    });

    test('rejects a duplicate pending ID without a second call', () async {
      final source = _DeferredBridgeSource();
      final bridge = _testBridge(source, capabilities: ['pco.services.read']);
      final first = bridge.handle(_request('same', 'pco.services.read',
          params: {'operation': 'list_service_types'}));
      expect(source.pcoCalls, 1);
      expect(
          _errorCode(await bridge.handle(_request('same', 'pco.services.read',
              params: {'operation': 'list_service_types'}))),
          'duplicate_request');
      expect(source.pcoCalls, 1);
      source.pcoCompleters.single.complete({'order': 1});
      expect(_response(await first)['ok'], true);
    });

    test(
        'enforces eight pending requests, then releases capacity on completion',
        () async {
      final source = _DeferredBridgeSource();
      final bridge = _testBridge(source, capabilities: ['pco.services.read']);
      final pending = <Future<String>>[];
      for (var i = 0; i < 8; i++) {
        pending.add(bridge.handle(_request('id-$i', 'pco.services.read',
            params: {'operation': 'list_service_types'})));
      }
      expect(source.pcoCalls, 8);
      final ninth = bridge.handle(_request('ninth', 'pco.services.read',
          params: {'operation': 'list_service_types'}));
      expect(source.pcoCalls, 8);
      expect(_errorCode(await ninth), 'too_many_requests');
      source.pcoCompleters.first.complete({'released': true});
      await pending.first;
      pending.add(bridge.handle(_request('after-release', 'pco.services.read',
          params: {'operation': 'list_service_types'})));
      expect(source.pcoCalls, 9);
      for (final completer in source.pcoCompleters.skip(1)) {
        if (!completer.isCompleted) completer.complete({});
      }
      await Future.wait(pending);
    });

    test('matches reverse-completed responses to their request IDs', () async {
      final source = _DeferredBridgeSource();
      final bridge = _testBridge(source, capabilities: ['pco.services.read']);
      final first = bridge.handle(_request('first', 'pco.services.read',
          params: {'operation': 'list_service_types'}));
      final second = bridge.handle(_request('second', 'pco.services.read',
          params: {'operation': 'list_service_types'}));
      source.pcoCompleters[1].complete({'order': 'second'});
      expect(_response(await second), containsPair('id', 'second'));
      source.pcoCompleters[0].complete({'order': 'first'});
      expect(_response(await first), containsPair('id', 'first'));
    });

    test('discards updates completed after every lifecycle identity change',
        () async {
      // Regression: a disposed, user-switched, or artifact-switched bridge
      // mutates current state or emits a response after replacement.
      for (final (index, lifecycle)
          in ['dispose', 'user switch', 'artifact switch'].indexed) {
        final source = _DeferredBridgeSource();
        var current = true;
        final bridge = _testBridge(source, isCurrent: (_) => current);
        final pending =
            bridge.handle(_request('stale-$index', 'state.update', params: {
          'expectedStateRevision': 1,
          'state': {'title': 'stale'},
        }));
        current = false;
        source.updateCompleters.single
            .complete(_artifactWith(state: {'title': 'stale'}, revision: 2));
        expect(await pending, isEmpty, reason: lifecycle);
        expect(bridge.artifact.state, {'title': 'before'}, reason: lifecycle);
        expect(bridge.artifact.currentStateRevision, 1, reason: lifecycle);
      }
    });
  });
}

Future<void> _pumpViewer(WidgetTester tester, _ViewerHttpFixture fixture,
    {VoidCallback? onRemove}) async {
  await tester.pumpWidget(MaterialApp(
      home: Scaffold(
          body: LiveArtifactView(
              key: ValueKey(fixture),
              artifact: _artifact,
              source: LiveArtifactsDataSource(
                  baseUrl: 'http://viewer.test', client: fixture),
              enableNativeRuntime: false,
              onRemove: onRemove))));
  await tester.pumpAndSettle();
}

final _artifact = LiveArtifact(
    id: 'artifact-id', title: 'Worship Calendar', updatedAt: DateTime(2026));

class _ViewerHttpFixture extends http.BaseClient {
  _ViewerHttpFixture(this._statuses);

  final List<int> _statuses;
  int getCalls = 0;
  int renderCalls = 0;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request.url.path.endsWith('/render')) {
      renderCalls++;
      return http.StreamedResponse(
          Stream.value(utf8.encode('<main>loaded</main>')), 200);
    }
    final status = _statuses[getCalls.clamp(0, _statuses.length - 1)];
    getCalls++;
    final body = status == 200
        ? jsonEncode({
            'id': 'artifact-id',
            'title': 'Worship Calendar',
            'updatedAt': '2026-08-09T00:00:00.000Z'
          })
        : jsonEncode({
            'error': {'code': 'fixture', 'message': 'hidden'}
          });
    return http.StreamedResponse(Stream.value(utf8.encode(body)), status,
        headers: {'content-type': 'application/json'});
  }
}

class _ContractWorkspace extends StatelessWidget {
  const _ContractWorkspace();

  @override
  Widget build(BuildContext context) => DashboardArtifactWorkspace(
        workspaceId: 1,
        dashboard: const SizedBox.expand(),
        controller: context.read<LiveArtifactsController>(),
        manageAuthLifecycle: false,
        enableNativeRuntime: false,
      );
}

LiveArtifactBridge _bridge(
    _RecordingLiveArtifactsDataSource source, void Function(String) onBlocked) {
  return LiveArtifactBridge(
    artifactId: 'artifact-id',
    userId: 1,
    generation: 1,
    source: source,
    artifact: _artifact,
    isCurrent: (_) => true,
    onBlocked: onBlocked,
  );
}

LiveArtifactBridge _testBridge(LiveArtifactsDataSource source,
    {List<String> capabilities = const [],
    bool Function(int generation)? isCurrent}) {
  return LiveArtifactBridge(
    artifactId: 'artifact-id',
    userId: 1,
    generation: 1,
    source: source,
    artifact: _artifactWith(capabilities: capabilities),
    isCurrent: isCurrent ?? (_) => true,
  );
}

LiveArtifact _artifactWith(
        {Object? state,
        int revision = 1,
        List<String> capabilities = const []}) =>
    LiveArtifact(
      id: 'artifact-id',
      title: 'Worship Calendar',
      updatedAt: DateTime(2026),
      state: state ?? {'title': 'before'},
      currentStateRevision: revision,
      declaredCapabilities: capabilities,
    );

String _request(String id, String method,
        {Object? params, String nonce = 'n'}) =>
    jsonEncode({
      'id': id,
      'method': method,
      if (params != null) 'params': params,
      'nonce': nonce,
    });

Map<String, dynamic> _response(String script) {
  const prefix = 'window.__rhythmHostResponse(';
  return jsonDecode(script.substring(prefix.length, script.length - 2))
      as Map<String, dynamic>;
}

String _errorCode(String script) =>
    (_response(script)['error'] as Map<String, dynamic>)['code'] as String;

class _RecordingLiveArtifactsDataSource extends LiveArtifactsDataSource {
  _RecordingLiveArtifactsDataSource() : super(baseUrl: 'http://bridge.test');

  int calls = 0;

  @override
  Future<LiveArtifact> updateState(String id,
      {required int expectedStateRevision, required Object? state}) {
    calls++;
    throw UnimplementedError();
  }

  @override
  Future<Object?> readPcoServices(String id, Object? request) {
    calls++;
    throw UnimplementedError();
  }
}

class _BridgeSource extends LiveArtifactsDataSource {
  _BridgeSource() : super(baseUrl: 'http://bridge.test');

  int calls = 0;
  final updateRequests = <(String, int, Object?)>[];
  final pcoRequests = <(String, Object?)>[];

  @override
  Future<LiveArtifact> updateState(String id,
      {required int expectedStateRevision, required Object? state}) async {
    calls++;
    updateRequests.add((id, expectedStateRevision, state));
    return _artifactWith(state: state, revision: expectedStateRevision + 1);
  }

  @override
  Future<Object?> readPcoServices(String id, Object? request) async {
    calls++;
    pcoRequests.add((id, request));
    return {'allowed': true};
  }
}

class _DeferredBridgeSource extends LiveArtifactsDataSource {
  _DeferredBridgeSource() : super(baseUrl: 'http://bridge.test');

  int pcoCalls = 0;
  final pcoCompleters = <Completer<Object?>>[];
  final updateCompleters = <Completer<LiveArtifact>>[];

  @override
  Future<LiveArtifact> updateState(String id,
      {required int expectedStateRevision, required Object? state}) {
    final completer = Completer<LiveArtifact>();
    updateCompleters.add(completer);
    return completer.future;
  }

  @override
  Future<Object?> readPcoServices(String id, Object? request) {
    pcoCalls++;
    final completer = Completer<Object?>();
    pcoCompleters.add(completer);
    return completer.future;
  }
}
