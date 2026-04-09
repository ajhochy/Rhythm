import 'dart:io';

import 'package:http/http.dart' as http;

/// Manages the lifecycle of the local Node.js API server process.
class ApiServerService {
  Process? _process;

  bool get isRunning => _process != null;

  /// Finds the node binary, starts the server process, and waits for it to
  /// become healthy. Returns true if the server started successfully.
  Future<bool> start() async {
    final existing = await _isServerReady();
    if (existing) {
      stdout.writeln('[ApiServerService] Reusing existing server on :4000.');
      return true;
    }

    final node = await _findNode();
    if (node == null) {
      stderr.writeln('[ApiServerService] Could not find node binary.');
      return false;
    }

    final serverInfo = await _findServer(node);
    if (serverInfo == null) {
      stderr.writeln('[ApiServerService] Could not locate api_server.');
      return false;
    }

    final dbPath = _dbPath();
    stdout.writeln(
        '[ApiServerService] Starting: ${serverInfo.executable} ${serverInfo.args.join(' ')}');
    stdout.writeln('[ApiServerService] DB path: $dbPath');

    _process = await Process.start(
      serverInfo.executable,
      serverInfo.args,
      workingDirectory: serverInfo.workingDir,
      environment: {
        ...Platform.environment,
        'PORT': '4000',
        'DB_PATH': dbPath,
      },
    );

    _process!.stdout
        .transform(const SystemEncoding().decoder)
        .listen((line) => stdout.write('[api_server] $line'));
    _process!.stderr
        .transform(const SystemEncoding().decoder)
        .listen((line) => stderr.write('[api_server] $line'));

    _process!.exitCode.then((code) {
      stdout.writeln('[ApiServerService] Server exited with code $code');
      _process = null;
    });

    return _waitForReady();
  }

  /// Terminates the server process.
  void stop() {
    _process?.kill(ProcessSignal.sigterm);
    _process = null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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
    final uri = Uri.parse('http://localhost:4000/health');
    try {
      final response = await http.get(uri).timeout(const Duration(seconds: 1));
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<String?> _findNode() async {
    // Prefer architecture-matching Homebrew installs first so native modules
    // line up with the user's primary local Node toolchain.
    const preferredCandidates = [
      '/usr/local/bin/node', // Intel Homebrew / legacy install
      '/opt/homebrew/bin/node', // Apple Silicon Homebrew
      '/usr/bin/node',
    ];
    for (final path in preferredCandidates) {
      if (File(path).existsSync()) return path;
    }

    // GUI apps on macOS launch with a minimal PATH (/usr/bin:/bin:...) so
    // plain `which node` misses Homebrew and nvm. Use a login shell so that
    // ~/.zprofile / ~/.bash_profile are sourced and the full PATH is available.
    for (final shell in ['/bin/zsh', '/bin/bash']) {
      if (!File(shell).existsSync()) continue;
      try {
        final result = await Process.run(shell, ['-l', '-c', 'which node']);
        if (result.exitCode == 0) {
          final path = (result.stdout as String).trim();
          if (path.isNotEmpty && File(path).existsSync()) return path;
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
