import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// #885 — Persists the local Memory Vault path/subdir the desktop app injects
/// into the spawned api_server's environment as `MEMORY_VAULT_PATH` /
/// `MEMORY_VAULT_SUBDIR`.
///
/// Without this setting the spawned api_server falls back to its own
/// `resolveMemoryVaultPath()` default (`~/Documents/Memory-Vault`, the OLD
/// pre-#801/#860 location), so the app's Agent Memory view silently reads a
/// stale, near-empty vault instead of the intended Obsidian `AGENT-MEMORY`
/// vault.
///
/// Mirrors [ServerConfigService]'s persisted-setting shape but is
/// intentionally a separate setting/class: this must never be coupled to
/// `serverConfigService.url` (the agent server always stays on
/// `localhost:4001`; see CLAUDE.md "Rule: do not couple agent traffic to
/// serverConfigService.url").
class MemoryVaultConfigService extends ChangeNotifier {
  MemoryVaultConfigService({bool Function(String path)? directoryExists})
      : _directoryExists =
            directoryExists ?? ((path) => Directory(path).existsSync());

  static const _pathKey = 'memory_vault_path';
  static const _subdirKey = 'memory_vault_subdir';

  /// Legacy default (pre-#801/#860): used only when neither an explicit
  /// setting nor the auto-detected Obsidian vault is present.
  static const legacyDefaultPath = '~/Documents/Memory-Vault';

  /// #801/#860 single-source-of-truth vault: preferred whenever it exists on
  /// disk at first-run auto-detect time.
  static const obsidianVaultPath = '~/Documents/Obsidian Vault/AGENT-MEMORY';

  /// Clean layout (#860): notes live directly under [obsidianVaultPath] as
  /// `<kind>/<slug>.md`, so the subdir is empty for the auto-detected default.
  static const cleanLayoutSubdir = '';

  /// Back-compat subdir used with [legacyDefaultPath] (mirrors api_server's
  /// own `resolveMemoryDirPath()` default of `memory`).
  static const legacyDefaultSubdir = 'memory';

  final bool Function(String path) _directoryExists;

  String _path = legacyDefaultPath;
  String _subdir = legacyDefaultSubdir;

  String get path => _path;
  String get subdir => _subdir;

  /// The path expanded with `~` resolved against $HOME, for display purposes.
  String get resolvedPath => expandHome(_path);

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final savedPath = prefs.getString(_pathKey);
    final savedSubdir = prefs.getString(_subdirKey);

    if (savedPath != null) {
      _path = savedPath;
      _subdir = savedSubdir ?? cleanLayoutSubdir;
    } else {
      final detected = autoDetectDefault(directoryExists: _directoryExists);
      _path = detected.path;
      _subdir = detected.subdir;
    }
    notifyListeners();
  }

  Future<void> save(String path, {String subdir = cleanLayoutSubdir}) async {
    final prefs = await SharedPreferences.getInstance();
    final cleaned = path.trim();
    if (cleaned.isEmpty) return;
    await prefs.setString(_pathKey, cleaned);
    await prefs.setString(_subdirKey, subdir);
    _path = cleaned;
    _subdir = subdir;
    notifyListeners();
  }
}

/// Result of [autoDetectDefault]: the vault path/subdir to use before any
/// user override is saved.
typedef MemoryVaultDefault = ({String path, String subdir});

/// Pure auto-detect logic (issue #885 acceptance criterion): prefers the
/// Obsidian `AGENT-MEMORY` vault when it exists on disk, else falls back to
/// the legacy `~/Documents/Memory-Vault` location. Takes an injectable
/// [directoryExists] seam so this is testable without touching real disk.
MemoryVaultDefault autoDetectDefault({
  required bool Function(String path) directoryExists,
  String? homeDir,
}) {
  final obsidianExpanded = expandHome(
    MemoryVaultConfigService.obsidianVaultPath,
    homeDir: homeDir,
  );
  if (directoryExists(obsidianExpanded)) {
    return (
      path: MemoryVaultConfigService.obsidianVaultPath,
      subdir: MemoryVaultConfigService.cleanLayoutSubdir,
    );
  }
  return (
    path: MemoryVaultConfigService.legacyDefaultPath,
    subdir: MemoryVaultConfigService.legacyDefaultSubdir,
  );
}

/// Expands a leading `~` (or `~/`) against [homeDir] (falls back to
/// `Platform.environment['HOME']` when null, then `.` as a last resort).
/// Mirrors api_server's `expandHome()` in `src/config/env.ts` so the two
/// sides agree on path semantics.
String expandHome(String p, {String? homeDir}) {
  final home = homeDir ?? Platform.environment['HOME'] ?? '.';
  if (p == '~') return home;
  if (p.startsWith('~/')) return '$home/${p.substring(2)}';
  return p;
}
