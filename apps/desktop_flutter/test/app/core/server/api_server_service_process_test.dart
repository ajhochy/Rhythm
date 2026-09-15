import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';

void main() {
  test('diagnostics stays bounded even below the metadata header size',
      () async {
    final temp = await Directory.systemTemp.createTemp('rhythm-api-tiny-log-');
    addTearDown(() => temp.delete(recursive: true));
    final file = File('${temp.path}/agent-server-crash.log');
    final diagnostics = AgentServerDiagnosticsLog(file: file, maxBytes: 16);

    await diagnostics.recordOwnedExit(
      pid: 42,
      exitCode: 134,
      stderrChunks: Stream<List<int>>.value(List<int>.filled(256, 65)),
      timestamp: DateTime.utc(2026, 9, 15),
    );

    expect(await file.length(), lessThanOrEqualTo(16));
  });

  test(
    'real owned child exit drains final stderr, persists it, and emits once',
    () async {
      final temp =
          await Directory.systemTemp.createTemp('rhythm-api-child-log-');
      addTearDown(() => temp.delete(recursive: true));
      final file = File('${temp.path}/agent-server-crash.log');
      final service = ApiServerService(
        diagnosticsLog: AgentServerDiagnosticsLog(
          file: file,
          maxBytes: 1024,
        ),
      );

      final exitEvent = service.ownedProcessExitEvents.first;
      final child = await Process.start('/bin/sh', [
        '-c',
        "printf 'native-final-no-newline' >&2; exit 7",
      ]);
      await service.superviseOwnedProcessForTesting(child);
      final event = await exitEvent;

      final contents = await file.readAsString();
      expect(event.generation, 1);
      expect(event.exitCode, 7);
      expect(event.stderrTail, contains('native-final-no-newline'));
      expect(contents, contains('pid=${child.pid}'));
      expect(contents, contains('exitCode=7'));
      expect(contents, contains('native-final-no-newline'));
      expect(await file.length(), lessThanOrEqualTo(1024));
      if (!Platform.isWindows) {
        expect((await file.stat()).mode & 0x1ff, 0x180); // 0600
      }
    },
    skip: Platform.isWindows ? 'requires /bin/sh' : false,
  );

  test(
    'intentional stop drains a real child without emitting recovery',
    () async {
      final temp =
          await Directory.systemTemp.createTemp('rhythm-api-child-stop-');
      addTearDown(() => temp.delete(recursive: true));
      final file = File('${temp.path}/agent-server-crash.log');
      final service = ApiServerService(
        diagnosticsLog: AgentServerDiagnosticsLog(
          file: file,
          maxBytes: 1024,
        ),
      );
      var exitEvents = 0;
      final subscription = service.ownedProcessExitEvents.listen((_) {
        exitEvents++;
      });
      addTearDown(subscription.cancel);

      final child = await Process.start('/bin/sh', [
        '-c',
        "printf 'intentional-final-no-newline' >&2; sleep 30",
      ]);
      final drained = service.superviseOwnedProcessForTesting(child);
      await service.stopGracefully();
      await drained;
      await Future<void>.delayed(Duration.zero);

      expect(exitEvents, 0);
      expect(await file.exists(), isFalse);
    },
    skip: Platform.isWindows ? 'requires /bin/sh' : false,
  );

  test(
    'inherited stderr pipe cannot delay an owned exit indefinitely',
    () async {
      final temp =
          await Directory.systemTemp.createTemp('rhythm-api-child-pipe-');
      addTearDown(() => temp.delete(recursive: true));
      final file = File('${temp.path}/agent-server-crash.log');
      final service = ApiServerService(
        diagnosticsLog: AgentServerDiagnosticsLog(
          file: file,
          maxBytes: 1024,
        ),
        processDrainTimeout: const Duration(milliseconds: 50),
      );
      final eventFuture = service.ownedProcessExitEvents.first;
      final stopwatch = Stopwatch()..start();
      final child = await Process.start('/bin/sh', [
        '-c',
        "sleep 2 >&2 & printf 'stderr-before-parent-exit' >&2; exit 9",
      ]);

      await service.superviseOwnedProcessForTesting(child);
      final event = await eventFuture;
      stopwatch.stop();

      expect(stopwatch.elapsed, lessThan(const Duration(seconds: 1)));
      expect(event.exitCode, 9);
      expect(event.stderrTail, contains('stderr-before-parent-exit'));
      expect(await file.readAsString(), contains('stderr-before-parent-exit'));
    },
    skip: Platform.isWindows ? 'requires /bin/sh' : false,
  );
}
