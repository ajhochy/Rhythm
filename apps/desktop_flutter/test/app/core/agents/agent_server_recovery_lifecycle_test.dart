import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/agents/curated_mcp_auto_installer.dart';
import 'package:rhythm_desktop/app/core/agents/rhythm_mcp_auto_installer.dart';
import 'package:rhythm_desktop/app/core/auth/auth_session_store.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';

class _DeferredApiServerService implements ApiServerService {
  final StreamController<OwnedProcessExitEvent> exits =
      StreamController<OwnedProcessExitEvent>.broadcast();
  Completer<AgentServerStartResult>? nextStart;
  Completer<void>? nextStop;
  int startCalls = 0;
  int stopCalls = 0;
  int stopGracefullyCalls = 0;
  int _generationCounter = 0;
  int? _generation;
  bool startCalledBeforeDeferredStop = false;

  @override
  Stream<OwnedProcessExitEvent> get ownedProcessExitEvents => exits.stream;

  @override
  int? get currentOwnedProcessGeneration => _generation;

  @override
  Future<AgentServerStartResult> start() async {
    startCalls++;
    if (nextStop != null && !nextStop!.isCompleted) {
      startCalledBeforeDeferredStop = true;
    }
    final deferred = nextStart;
    nextStart = null;
    final result = await (deferred?.future ??
        Future<AgentServerStartResult>.value(
          (ok: true, reason: null, stderrTail: null, failureMessage: null),
        ));
    _generation = result.ok ? ++_generationCounter : null;
    return result;
  }

  @override
  Future<bool> checkHealth(String baseUrl) async => true;

  @override
  void stop() => stopCalls++;

  @override
  Future<void> stopGracefully() async {
    stopGracefullyCalls++;
    final deferred = nextStop;
    if (deferred != null) await deferred.future;
    _generation = null;
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _RealOwnedRetryService extends ApiServerService {
  _RealOwnedRetryService(AgentServerDiagnosticsLog diagnosticsLog)
      : super(
          diagnosticsLog: diagnosticsLog,
          processDrainTimeout: const Duration(milliseconds: 100),
        );

  int startCalls = 0;
  bool replacementStartedWhileOwned = false;

  @override
  Future<AgentServerStartResult> start() async {
    startCalls++;
    if (startCalls > 1 && currentOwnedProcessGeneration != null) {
      replacementStartedWhileOwned = true;
    }
    return _ready;
  }

  @override
  Future<bool> checkHealth(String baseUrl) async => true;
}

class _ScriptedGenerationService implements ApiServerService {
  _ScriptedGenerationService(this.results, this.generations);

  final List<AgentServerStartResult> results;
  final List<int?> generations;
  final StreamController<OwnedProcessExitEvent> exits =
      StreamController<OwnedProcessExitEvent>.broadcast();
  int startCalls = 0;
  int stopGracefullyCalls = 0;
  int? _generation;

  @override
  Stream<OwnedProcessExitEvent> get ownedProcessExitEvents => exits.stream;

  @override
  int? get currentOwnedProcessGeneration => _generation;

  @override
  Future<AgentServerStartResult> start() async {
    startCalls++;
    _generation = generations.removeAt(0);
    return results.removeAt(0);
  }

  @override
  Future<bool> checkHealth(String baseUrl) async => true;

  @override
  void stop() {}

  @override
  Future<void> stopGracefully() async => stopGracefullyCalls++;

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _DeferredRhythmInstaller extends RhythmMcpAutoInstaller {
  final List<Completer<bool>> attempts = <Completer<bool>>[];

  @override
  Future<bool> ensure({
    required String apiToken,
    required String apiUrl,
  }) {
    final attempt = Completer<bool>();
    attempts.add(attempt);
    return attempt.future;
  }
}

class _DeferredCuratedInstaller extends CuratedMcpAutoInstaller {
  final List<Completer<bool>> attempts = <Completer<bool>>[];

  @override
  Future<bool> ensure({
    required String apiToken,
    required String apiUrl,
  }) {
    final attempt = Completer<bool>();
    attempts.add(attempt);
    return attempt.future;
  }
}

class _NoopCuratedInstaller extends CuratedMcpAutoInstaller {
  @override
  Future<bool> ensure({
    required String apiToken,
    required String apiUrl,
  }) async =>
      false;
}

const _ready = (
  ok: true,
  reason: null,
  stderrTail: null,
  failureMessage: null,
);

const _spawnFailed = (
  ok: false,
  reason: AgentServerFailureReason.spawnThrew,
  stderrTail: 'spawn failed',
  failureMessage: null,
);

Future<void> _flushRecovery() async {
  for (var i = 0; i < 5; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

Future<void> _waitUntil(bool Function() condition) async {
  final deadline = DateTime.now().add(const Duration(seconds: 1));
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) {
      fail('Timed out waiting for asynchronous lifecycle work');
    }
    await Future<void>.delayed(const Duration(milliseconds: 1));
  }
}

AgentServerController _controller(_DeferredApiServerService service) =>
    AgentServerController(
      service,
      recoveryBackoff: (_) => Duration.zero,
      capabilitiesRequest: (_) async => http.Response('{}', 200),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('concurrent manual retries join one replacement start', () async {
    final service = _DeferredApiServerService();
    final controller = _controller(service);
    addTearDown(controller.dispose);
    addTearDown(service.exits.close);
    await controller.initialize();
    controller.simulateHealthChange(false);

    final deferred = Completer<AgentServerStartResult>();
    service.nextStart = deferred;
    final first = controller.retry();
    final second = controller.retry();
    await Future<void>.delayed(Duration.zero);

    expect(service.startCalls, 2);
    deferred.complete(
      (ok: true, reason: null, stderrTail: null, failureMessage: null),
    );
    await Future.wait<void>([first, second]);
    expect(service.startCalls, 2);
    expect(controller.status, AgentServerStatus.ready);
  });

  test('manual retry waits for owned child shutdown before replacement',
      () async {
    final service = _DeferredApiServerService();
    final controller = _controller(service);
    addTearDown(controller.dispose);
    addTearDown(service.exits.close);
    await controller.initialize();
    controller.simulateHealthChange(false);

    final deferredStop = Completer<void>();
    service.nextStop = deferredStop;
    final retry = controller.retry();
    await _flushRecovery();

    expect(service.stopGracefullyCalls, 1);
    expect(service.startCalls, 1);
    service.exits.add((generation: 1, exitCode: 1, stderrTail: 'late'));
    await _flushRecovery();
    expect(service.startCalls, 1);

    deferredStop.complete();
    await retry;
    expect(service.startCalls, 2);
    expect(service.startCalledBeforeDeferredStop, isFalse);
    expect(controller.status, AgentServerStatus.ready);
  });

  test('manual retry stops a real owned helper before replacement', () async {
    if (Platform.isWindows) return;
    final tempDir = await Directory.systemTemp.createTemp('rhythm-retry-');
    addTearDown(() => tempDir.delete(recursive: true));
    final service = _RealOwnedRetryService(
      AgentServerDiagnosticsLog(
        file: File('${tempDir.path}/agent-server-crash.log'),
        maxBytes: 1024,
      ),
    );
    final controller = AgentServerController(
      service,
      recoveryBackoff: (_) => Duration.zero,
      capabilitiesRequest: (_) async => http.Response('{}', 200),
    );
    addTearDown(controller.dispose);
    await controller.initialize();
    final child = await Process.start(
      '/bin/sh',
      <String>['-c', "printf 'retry-owned-child' >&2; exec sleep 30"],
    );
    final exitDrain = service.superviseOwnedProcessForTesting(child);
    controller.simulateHealthChange(false);

    await controller.retry();
    await exitDrain;

    expect(service.startCalls, 2);
    expect(service.replacementStartedWhileOwned, isFalse);
    expect(service.currentOwnedProcessGeneration, isNull);
  });

  test('stop invalidates a late start result and prevents revival', () async {
    final service = _DeferredApiServerService();
    final controller = _controller(service);
    addTearDown(controller.dispose);
    addTearDown(service.exits.close);
    await controller.initialize();
    controller.simulateHealthChange(false);

    final deferred = Completer<AgentServerStartResult>();
    service.nextStart = deferred;
    final retry = controller.retry();
    await Future<void>.delayed(Duration.zero);
    final stop = controller.stopAndDispose();
    var notificationsAfterStop = 0;
    controller.addListener(() => notificationsAfterStop++);

    deferred.complete(
      (ok: true, reason: null, stderrTail: null, failureMessage: null),
    );
    await Future.wait<void>([retry, stop]);
    service.exits.add((generation: 1, exitCode: 0, stderrTail: 'late'));
    await Future<void>.delayed(Duration.zero);

    expect(service.startCalls, 2);
    expect(service.stopGracefullyCalls, 3);
    expect(notificationsAfterStop, 0);
  });

  test('failed recovery startup can skip a generation without losing exits',
      () async {
    final service = _ScriptedGenerationService(
      <AgentServerStartResult>[_ready, _spawnFailed, _ready, _ready],
      <int?>[1, null, 3, 4],
    );
    final controller = AgentServerController(
      service,
      recoveryBackoff: (_) => Duration.zero,
      capabilitiesRequest: (_) async => http.Response('{}', 200),
    );
    addTearDown(controller.dispose);
    addTearDown(service.exits.close);

    await controller.initialize();
    service.exits.add((generation: 1, exitCode: 134, stderrTail: 'oom-1'));
    await _flushRecovery();
    expect(service.startCalls, 3);
    expect(controller.status, AgentServerStatus.ready);

    service.exits.add((generation: 3, exitCode: 134, stderrTail: 'oom-3'));
    await _flushRecovery();
    expect(service.startCalls, 4);
    expect(controller.status, AgentServerStatus.ready);
  });

  test('manual retry uses its actual generation for the next crash', () async {
    final service = _ScriptedGenerationService(
      <AgentServerStartResult>[_spawnFailed, _ready, _ready],
      <int?>[null, 2, 3],
    );
    final controller = AgentServerController(
      service,
      recoveryBackoff: (_) => Duration.zero,
      capabilitiesRequest: (_) async => http.Response('{}', 200),
    );
    addTearDown(controller.dispose);
    addTearDown(service.exits.close);

    await controller.initialize();
    await controller.retry();
    expect(controller.status, AgentServerStatus.ready);

    service.exits.add((generation: 2, exitCode: 134, stderrTail: 'oom-2'));
    await _flushRecovery();
    expect(service.startCalls, 3);
    expect(controller.status, AgentServerStatus.ready);
  });

  test('manual retry never stops a reused external server', () async {
    final service = _ScriptedGenerationService(
      <AgentServerStartResult>[_ready, _ready],
      <int?>[null, null],
    );
    final controller = AgentServerController(
      service,
      recoveryBackoff: (_) => Duration.zero,
      capabilitiesRequest: (_) async => http.Response('{}', 200),
    );
    addTearDown(controller.dispose);
    addTearDown(service.exits.close);

    await controller.initialize();
    controller.simulateHealthChange(false);
    await controller.retry();

    expect(service.startCalls, 2);
    expect(service.stopGracefullyCalls, 0);
    expect(controller.status, AgentServerStatus.ready);
  });

  test('owned manual restart reinstalls both MCPs for the same token',
      () async {
    AuthSessionStore.setSessionToken('tok-manual-restart');
    addTearDown(() => AuthSessionStore.setSessionToken(null));
    final service = _DeferredApiServerService();
    final rhythmInstaller = _DeferredRhythmInstaller();
    final curatedInstaller = _DeferredCuratedInstaller();
    final controller = AgentServerController(
      service,
      autoInstaller: rhythmInstaller,
      curatedAutoInstaller: curatedInstaller,
      recoveryBackoff: (_) => Duration.zero,
      capabilitiesRequest: (_) async => http.Response('{}', 200),
    );
    addTearDown(controller.dispose);
    addTearDown(service.exits.close);

    await controller.initialize();
    await _waitUntil(
      () =>
          rhythmInstaller.attempts.length == 1 &&
          curatedInstaller.attempts.length == 1,
    );
    expect(rhythmInstaller.attempts, hasLength(1));
    expect(curatedInstaller.attempts, hasLength(1));
    rhythmInstaller.attempts.single.complete(true);
    curatedInstaller.attempts.single.complete(true);
    await _flushRecovery();

    controller.simulateHealthChange(false);
    await controller.retry();
    await _waitUntil(
      () =>
          rhythmInstaller.attempts.length == 2 &&
          curatedInstaller.attempts.length == 2,
    );

    expect(service.stopGracefullyCalls, 1);
    expect(rhythmInstaller.attempts, hasLength(2));
    expect(curatedInstaller.attempts, hasLength(2));
    rhythmInstaller.attempts.last.complete(false);
    curatedInstaller.attempts.last.complete(false);
  });

  test('capability response from an exited generation is ignored', () async {
    final service = _ScriptedGenerationService(
      <AgentServerStartResult>[_ready, _ready],
      <int?>[1, 2],
    );
    final requests = <Completer<http.Response>>[];
    final controller = AgentServerController(
      service,
      recoveryBackoff: (_) => Duration.zero,
      capabilitiesRequest: (_) {
        final request = Completer<http.Response>();
        requests.add(request);
        return request.future;
      },
    );
    addTearDown(controller.dispose);
    addTearDown(service.exits.close);

    await controller.initialize();
    expect(requests, hasLength(1));
    service.exits.add((generation: 1, exitCode: 134, stderrTail: 'oom'));
    await _flushRecovery();
    expect(requests, hasLength(2));

    requests.first.complete(http.Response('{"codex":true}', 200));
    await _flushRecovery();
    expect(controller.capabilities, isEmpty);

    requests.last.complete(http.Response('{"codex":false}', 200));
    await _flushRecovery();
    expect(controller.capabilities['codex'], isFalse);
  });

  test('installer completion from an exited generation cannot re-dedupe token',
      () async {
    AuthSessionStore.setSessionToken('tok-recovery');
    addTearDown(() => AuthSessionStore.setSessionToken(null));
    final service = _ScriptedGenerationService(
      <AgentServerStartResult>[_ready, _ready],
      <int?>[1, 2],
    );
    final installer = _DeferredRhythmInstaller();
    final controller = AgentServerController(
      service,
      autoInstaller: installer,
      curatedAutoInstaller: _NoopCuratedInstaller(),
      recoveryBackoff: (_) => Duration.zero,
      capabilitiesRequest: (_) async => http.Response('{}', 200),
    );
    addTearDown(controller.dispose);
    addTearDown(service.exits.close);

    await controller.initialize();
    await _flushRecovery();
    expect(installer.attempts, hasLength(1));

    service.exits.add((generation: 1, exitCode: 134, stderrTail: 'oom'));
    await _flushRecovery();
    expect(installer.attempts, hasLength(2));

    installer.attempts[0].complete(true);
    installer.attempts[1].complete(false);
    await _flushRecovery();
    controller.onAuthChanged();
    await _flushRecovery();

    expect(installer.attempts, hasLength(3));
    installer.attempts[2].complete(false);
  });
}
