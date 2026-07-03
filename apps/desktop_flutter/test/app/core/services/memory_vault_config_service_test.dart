import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:rhythm_desktop/app/core/services/memory_vault_config_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('expandHome', () {
    test('expands a bare tilde', () {
      expect(expandHome('~', homeDir: '/Users/alice'), '/Users/alice');
    });

    test('expands a tilde-prefixed path', () {
      expect(
        expandHome('~/Documents/Memory-Vault', homeDir: '/Users/alice'),
        '/Users/alice/Documents/Memory-Vault',
      );
    });

    test('leaves an absolute path unchanged', () {
      expect(
        expandHome('/Volumes/External/Vault', homeDir: '/Users/alice'),
        '/Volumes/External/Vault',
      );
    });
  });

  group('autoDetectDefault', () {
    test('prefers the Obsidian AGENT-MEMORY vault when it exists', () {
      final result = autoDetectDefault(
        directoryExists: (path) =>
            path == '/Users/alice/Documents/Obsidian Vault/AGENT-MEMORY',
        homeDir: '/Users/alice',
      );

      expect(result.path, MemoryVaultConfigService.obsidianVaultPath);
      expect(result.subdir, MemoryVaultConfigService.cleanLayoutSubdir);
    });

    test('falls back to the legacy Memory-Vault when Obsidian vault is absent',
        () {
      final result = autoDetectDefault(
        directoryExists: (_) => false,
        homeDir: '/Users/alice',
      );

      expect(result.path, MemoryVaultConfigService.legacyDefaultPath);
      expect(result.subdir, MemoryVaultConfigService.legacyDefaultSubdir);
    });
  });

  group('MemoryVaultConfigService.load', () {
    test('auto-detects the Obsidian vault as default when no setting saved',
        () async {
      final svc = MemoryVaultConfigService(
        directoryExists: (path) => path.endsWith('AGENT-MEMORY'),
      );
      await svc.load();

      expect(svc.path, MemoryVaultConfigService.obsidianVaultPath);
      expect(svc.subdir, MemoryVaultConfigService.cleanLayoutSubdir);
    });

    test('auto-detects the legacy vault as default when Obsidian vault missing',
        () async {
      final svc = MemoryVaultConfigService(directoryExists: (_) => false);
      await svc.load();

      expect(svc.path, MemoryVaultConfigService.legacyDefaultPath);
      expect(svc.subdir, MemoryVaultConfigService.legacyDefaultSubdir);
    });

    test('a previously saved setting overrides auto-detection', () async {
      SharedPreferences.setMockInitialValues({
        'memory_vault_path': '/custom/vault',
        'memory_vault_subdir': 'notes',
      });
      final svc = MemoryVaultConfigService(directoryExists: (_) => true);
      await svc.load();

      expect(svc.path, '/custom/vault');
      expect(svc.subdir, 'notes');
    });
  });

  group('MemoryVaultConfigService.save', () {
    test('persists the path and subdir and updates getters', () async {
      final svc = MemoryVaultConfigService(directoryExists: (_) => false);
      await svc.load();

      await svc.save('/new/vault', subdir: 'memory');

      expect(svc.path, '/new/vault');
      expect(svc.subdir, 'memory');

      // A freshly constructed service should read the persisted value back.
      final reloaded = MemoryVaultConfigService(directoryExists: (_) => false);
      await reloaded.load();
      expect(reloaded.path, '/new/vault');
      expect(reloaded.subdir, 'memory');
    });

    test('ignores an empty path', () async {
      final svc = MemoryVaultConfigService(directoryExists: (_) => false);
      await svc.load();
      final before = svc.path;

      await svc.save('   ');

      expect(svc.path, before);
    });
  });
}
