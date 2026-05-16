import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

/// Distinct failure modes for [ApiServerService.start].
enum AgentServerFailureReason {
  nodeNotFound,
  bundleNotFound,
  spawnThrew,
  healthCheckTimeout,
  lostConnection,
}

/// Result of attempting to start the local agent server.
typedef AgentServerStartResult = ({
  bool ok,
  AgentServerFailureReason? reason,
  String? stderrTail,

  /// Human-readable rich failure message (may include rebuild command).
  String? failureMessage,
});

/// Manages the lifecycle of the local Node.js API server process.
class ApiServerService {
  Process? _process;

  /// Rolling buffer of recent stderr lines from the spawned server process.
  /// Capped at 20 lines x 200 chars (~4 KB) to bound memory.
  static const int _stderrBufferMaxLines = 20;
  static const int _stderrBufferMaxLineChars = 200;
  final List<String> _stderrBuffer = <String>[];

  bool get isRunning => _process != null;

  // ---------------------------------------------------------------------------
  // #614 — Graceful shutdown
  // ---------------------------------------------------------------------------

  /// Terminates the server process gracefully: SIGTERM → 2 s grace → SIGKILL.
  Future<void> stopGracefully() async {
    final proc = _process;
    if (proc == null) return;
    _process = null;
    proc.kill(ProcessSignal.sigterm);
    // Wait up to 2 s for the process to exit; escalate if still alive.
    final done = Completer<void>();
    proc.exitCode.then((_) {
      if (!done.isCompleted) done.complete();
    });
    await Future.any([
      done.future,
      Future<void>.delayed(const Duration(seconds: 2)),
    ]);
    if (!done.isCompleted) {
      proc.kill(ProcessSignal.sigkill);
    }
  }

  void _appendStderr(String line) {
    final trimmed =
        line.endsWith('\n') ? line.substring(0, line.length - 1) : line;
    final capped = trimmed.length > _stderrBufferMaxLineChars
        ? trimmed.substring(0, _stderrBufferMaxLineChars)
        : trimmed;
    _stderrBuffer.add(capped);
    if (_stderrBuffer.length > _stderrBufferMaxLines) {
      _stderrBuffer.removeRange(
        0,
        _stderrBuffer.length - _stderrBufferMaxLines,
      );
    }
  }

  String _stderrTail() => _stderrBuffer.join('\n');

  Future<bool> checkHealth(String baseUrl) async {
    final normalized = baseUrl.trimRight().replaceAll(RegExp(r'/$'), '');
    if (normalized.isEmpty) return false;
    try {
      final response = await http
          .get(Uri.parse('$normalized/health'))
          .timeout(const Duration(seconds: 2));
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Finds the node binary, starts the server process, and waits for it to
  /// become healthy. Returns a structured result describing success or the
  /// specific failure mode encountered.
  Future<AgentServerStartResult> start() async {
    _stderrBuffer.clear();

    // #614 — Startup orphan self-heal: if port 4001 is already held by a node
    // process whose parent PID is 1 (orphaned from a previous Rhythm quit),
    // kill it so we can bind the port cleanly.
    await _killOrphanIfPresent();

    final existing = await _isServerReady();
    if (existing) {
      stdout.writeln('[ApiServerService] Reusing existing server on :4001.');
      return (ok: true, reason: null, stderrTail: null, failureMessage: null);
    }

    // #615 — ABI-aware node discovery.
    final nodeResult = await _findNodeWithAbi();
    final node = nodeResult.nodePath;
    if (node == null) {
      stderr.writeln('[ApiServerService] Could not find node binary.');
      final msg = nodeResult.failureMessage;
      return (
        ok: false,
        reason: AgentServerFailureReason.nodeNotFound,
        stderrTail: null,
        failureMessage: msg,
      );
    }

    final serverInfo = await _findServer(node);
    if (serverInfo == null) {
      stderr.writeln('[ApiServerService] Could not locate api_server.');
      return (
        ok: false,
        reason: AgentServerFailureReason.bundleNotFound,
        stderrTail: null,
        failureMessage: null,
      );
    }

    final dbPath = _dbPath();
    stdout.writeln(
      '[ApiServerService] Starting: ${serverInfo.executable} ${serverInfo.args.join(' ')}',
    );
    stdout.writeln('[ApiServerService] DB path: $dbPath');

    try {
      _process = await Process.start(
        serverInfo.executable,
        serverInfo.args,
        workingDirectory: serverInfo.workingDir,
        environment: {
          ...Platform.environment,
          'PORT': '4001',
          'DB_PATH': dbPath,
          'AGENT_LOCAL': 'true',
        },
      );
    } catch (e) {
      stderr.writeln('[ApiServerService] Process.start threw: $e');
      return (
        ok: false,
        reason: AgentServerFailureReason.spawnThrew,
        stderrTail: e.toString(),
        failureMessage: null,
      );
    }

    _process!.stdout
        .transform(const SystemEncoding().decoder)
        .listen((line) => stdout.write('[api_server] $line'));
    _process!.stderr.transform(const SystemEncoding().decoder).listen((line) {
      stderr.write('[api_server] $line');
      _appendStderr(line);
    });

    _process!.exitCode.then((code) {
      stdout.writeln('[ApiServerService] Server exited with code $code');
      _process = null;
    });

    final ready = await _waitForReady();
    if (ready) {
      return (ok: true, reason: null, stderrTail: null, failureMessage: null);
    }
    return (
      ok: false,
      reason: AgentServerFailureReason.healthCheckTimeout,
      stderrTail: _stderrTail(),
      failureMessage: null,
    );
  }

  /// Terminates the server process.
  void stop() {
    _process?.kill(ProcessSignal.sigterm);
    _process = null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /// #614 — Startup orphan self-heal.
  ///
  /// If port 4001 is already held by a node process whose PPID is 1 (orphaned
  /// from a previous Rhythm quit that didn't clean up), kill it so we can
  /// bind the port on a fresh start.
  Future<void> _killOrphanIfPresent() async {
    try {
      // Find whatever process (if any) is listening on TCP :4001.
      final lsofResult = await Process.run('lsof', [
        '-iTCP:4001',
        '-sTCP:LISTEN',
        '-n',
        '-P',
      ]);
      if (lsofResult.exitCode != 0) return;
      final lines = (lsofResult.stdout as String).split('\n');
      for (final line in lines) {
        // lsof output columns: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
        final parts = line.trim().split(RegExp(r'\s+'));
        if (parts.length < 2) continue;
        final command = parts[0].toLowerCase();
        final pidStr = parts[1];
        if (!command.contains('node')) continue;
        final pid = int.tryParse(pidStr);
        if (pid == null || pid <= 0) continue;

        // Check the PPID.
        final psResult = await Process.run('ps', ['-o', 'ppid=', '-p', '$pid']);
        if (psResult.exitCode != 0) continue;
        final ppid = int.tryParse((psResult.stdout as String).trim());
        if (ppid != 1) continue;

        // It's an orphan — kill it.
        stdout.writeln(
          '[ApiServerService] killed orphan PID $pid to reclaim :4001',
        );
        try {
          Process.killPid(pid, ProcessSignal.sigterm);
          // Give it a moment to exit before we try to bind the port.
          await Future<void>.delayed(const Duration(milliseconds: 500));
        } catch (_) {
          // If SIGTERM fails (process already gone), that's fine.
        }
        break;
      }
    } catch (_) {
      // Orphan cleanup is best-effort; never block startup.
    }
  }

  Future<bool> _waitForReady() async {
    const maxAttempts = 40; // up to ~8 seconds
    const delay = Duration(milliseconds: 200);

    for (var i = 0; i < maxAttempts; i++) {
      await Future<void>.delayed(delay);
      if (await _isServerReady()) {
        stdout.writeln('[ApiServerService] Server is ready.');
        return true;
      }
    }

    stderr.writeln('[ApiServerService] Server did not become ready in time.');
    return false;
  }

  Future<bool> _isServerReady() async {
    return checkHealth('http://localhost:4001');
  }

  /// Result of [_findNodeWithAbi]: the resolved node path and an optional
  /// rich failure message (e.g. a copy-paste rebuild command).
  Future<({String? nodePath, String? failureMessage})>
      _findNodeWithAbi() async {
    // #615: Read sentinel from dev path OR bundled path.
    final sentinel = await _readRuntimeSentinelFull();
    final sentinelNodePath = sentinel?['nodePath'];
    final sentinelAbi = sentinel?['abi'];
    final sentinelVersion = sentinel?['nodeVersion'];

    // (1) Use sentinel nodePath if it exists on disk.
    if (sentinelNodePath is String && File(sentinelNodePath).existsSync()) {
      stdout.writeln(
        '[ApiServerService] Using install-time Node: $sentinelNodePath '
        '(version=$sentinelVersion, abi=$sentinelAbi).',
      );
      return (nodePath: sentinelNodePath, failureMessage: null);
    }

    // (2) If sentinel has an ABI, try to find a candidate whose ABI matches.
    if (sentinelAbi is String) {
      final targetAbi = int.tryParse(sentinelAbi);
      if (targetAbi != null) {
        final matched = await _findAbiMatchedNode(targetAbi);
        if (matched != null) {
          stdout.writeln(
            '[ApiServerService] ABI-matched Node: $matched (ABI=$targetAbi).',
          );
          return (nodePath: matched, failureMessage: null);
        }
        // No ABI match — surface a rich error with rebuild command.
        final bundledApiDir = await _bundledApiServerDir();
        final rebuildCmd = bundledApiDir != null
            ? 'cd "$bundledApiDir" && npm rebuild better-sqlite3 --build-from-source'
            : 'cd <api_server dir> && npm rebuild better-sqlite3 --build-from-source';
        final msg =
            'No Node.js binary with ABI $targetAbi (Node $sentinelVersion) found. '
            'To fix: $rebuildCmd';
        stderr.writeln('[ApiServerService] $msg');
        return (nodePath: null, failureMessage: msg);
      }
    }

    // (3) Fall back to common install paths. Apple Silicon Homebrew lives at
    //     /opt/homebrew and is the default on modern Macs, so try it first.
    const preferredCandidates = [
      '/opt/homebrew/bin/node', // Apple Silicon Homebrew (default on M-series)
      '/usr/local/bin/node', // Intel Homebrew / legacy install
      '/usr/bin/node',
    ];
    for (final path in preferredCandidates) {
      if (File(path).existsSync()) {
        return (nodePath: path, failureMessage: null);
      }
    }

    // GUI apps on macOS launch with a minimal PATH (/usr/bin:/bin:...) so
    // plain `which node` misses Homebrew and nvm. Use a login shell so that
    // ~/.zprofile / ~/.bash_profile are sourced and the full PATH is available.
    for (final shell in ['/bin/zsh', '/bin/bash']) {
      if (!File(shell).existsSync()) continue;
      try {
        final result = await Process.run(shell, ['-l', '-c', 'which node']);
        if (result.exitCode == 0) {
          final p = (result.stdout as String).trim();
          if (p.isNotEmpty && File(p).existsSync()) {
            return (nodePath: p, failureMessage: null);
          }
        }
      } catch (_) {}
    }

    return (nodePath: null, failureMessage: null);
  }

  /// Scan candidate node paths and return the first whose ABI matches
  /// [targetAbi]. Runs `node -e 'console.log(process.versions.modules)'`
  /// synchronously on each candidate.
  Future<String?> _findAbiMatchedNode(int targetAbi) async {
    final candidates = <String>[
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
      '/usr/bin/node',
    ];

    // Also try `which node` via login shell.
    for (final shell in ['/bin/zsh', '/bin/bash']) {
      if (!File(shell).existsSync()) continue;
      try {
        final result = await Process.run(shell, ['-l', '-c', 'which node']);
        if (result.exitCode == 0) {
          final p = (result.stdout as String).trim();
          if (p.isNotEmpty && !candidates.contains(p)) {
            candidates.add(p);
          }
        }
      } catch (_) {}
      break;
    }

    for (final candidate in candidates) {
      if (!File(candidate).existsSync()) continue;
      try {
        final result = await Process.run(
          candidate,
          ['-e', "process.stdout.write(process.versions.modules)"],
        );
        if (result.exitCode == 0) {
          final abiStr = (result.stdout as String).trim();
          final abi = int.tryParse(abiStr);
          if (abi == targetAbi) return candidate;
        }
      } catch (_) {}
    }
    return null;
  }

  Future<_ServerInfo?> _findServer(String nodePath) async {
    final exe = Platform.resolvedExecutable;
    // exe = .../Rhythm.app/Contents/MacOS/Rhythm

    // 1. Production: dist/server.js bundled inside the .app Resources folder.
    final resourcesDir = '${_dirname(_dirname(exe))}/Resources';
    final bundledScript = '$resourcesDir/api_server/dist/server.js';
    if (File(bundledScript).existsSync()) {
      return _ServerInfo(
        executable: nodePath,
        args: [bundledScript],
        workingDir: '$resourcesDir/api_server',
      );
    }

    // 2. Development: walk up from the executable to find the workspace root.
    //    exe lives deep inside build/macos/Build/Products/*/Rhythm.app/...
    var dir = _dirname(exe);
    for (var i = 0; i < 12; i++) {
      final candidate = '$dir/apps/api_server';
      if (Directory(candidate).existsSync()) {
        // Prefer a pre-built dist if available.
        final distScript = '$candidate/dist/server.js';
        if (File(distScript).existsSync()) {
          return _ServerInfo(
            executable: nodePath,
            args: [distScript],
            workingDir: candidate,
          );
        }
        // Fall back to npx tsx (dev convenience — no build step needed).
        final npx = await _findNpx(nodePath);
        return _ServerInfo(
          executable: npx,
          args: ['tsx', 'src/server.ts'],
          workingDir: candidate,
        );
      }
      final parent = _dirname(dir);
      if (parent == dir) break;
      dir = parent;
    }

    return null;
  }

  /// #615 — Read `.node-runtime.json` from dev path first, then bundled path.
  /// Returns the parsed JSON map, or null if not found / malformed.
  /// Validates that `nodePath` exists on disk before returning it trusted.
  Future<Map<String, dynamic>?> _readRuntimeSentinelFull() async {
    final exe = Platform.resolvedExecutable;

    // 1. Dev path: walk up from the executable to find
    //    `apps/api_server/.node-runtime.json`.
    var dir = _dirname(exe);
    for (var i = 0; i < 12; i++) {
      final sentinel = File('$dir/apps/api_server/.node-runtime.json');
      if (sentinel.existsSync()) {
        try {
          final data = jsonDecode(await sentinel.readAsString());
          if (data is Map<String, dynamic>) return data;
        } catch (_) {
          // Malformed — fall through.
        }
        break;
      }
      final parent = _dirname(dir);
      if (parent == dir) break;
      dir = parent;
    }

    // 2. Bundled path:
    //    <exe>/../../../Resources/api_server/.node-runtime.json
    //    i.e. Rhythm.app/Contents/Resources/api_server/.node-runtime.json
    final resourcesDir = '${_dirname(_dirname(exe))}/Resources';
    final bundledSentinel = File('$resourcesDir/api_server/.node-runtime.json');
    if (bundledSentinel.existsSync()) {
      try {
        final data = jsonDecode(await bundledSentinel.readAsString());
        if (data is Map<String, dynamic>) return data;
      } catch (_) {
        // Malformed bundled sentinel — ignore.
      }
    }

    return null;
  }

  /// Returns the bundled api_server directory path if it exists.
  Future<String?> _bundledApiServerDir() async {
    final exe = Platform.resolvedExecutable;
    final resourcesDir = '${_dirname(_dirname(exe))}/Resources';
    final dir = '$resourcesDir/api_server';
    if (Directory(dir).existsSync()) return dir;
    return null;
  }

  Future<String> _findNpx(String nodePath) async {
    // npx lives next to node.
    final nodeDir = _dirname(nodePath);
    final candidate = '$nodeDir/npx';
    if (File(candidate).existsSync()) return candidate;
    // Fallback: let the shell find it.
    return 'npx';
  }

  String _dbPath() {
    final home = Platform.environment['HOME'] ?? '.';
    final supportDir = '$home/Library/Application Support/Rhythm';
    Directory(supportDir).createSync(recursive: true);
    return '$supportDir/rhythm.db';
  }

  String _dirname(String path) {
    final idx = path.lastIndexOf('/');
    return idx > 0 ? path.substring(0, idx) : '/';
  }
}

class _ServerInfo {
  /// The executable to invoke (node path, or the npx path).
  final String executable;
  final List<String> args;
  final String workingDir;

  const _ServerInfo({
    required this.executable,
    required this.args,
    required this.workingDir,
  });
}
