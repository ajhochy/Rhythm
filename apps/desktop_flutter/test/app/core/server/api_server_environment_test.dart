import 'package:flutter_test/flutter_test.dart';

import 'package:rhythm_desktop/app/core/server/api_server_service.dart';

void main() {
  group('buildApiServerEnvironment', () {
    test('injects MEMORY_VAULT_PATH and MEMORY_VAULT_SUBDIR from the setting',
        () {
      final env = buildApiServerEnvironment(
        baseEnv: const {'HOME': '/Users/alice'},
        port: '4001',
        dbPath: '/db/rhythm.db',
        memoryVaultPath: '/Users/alice/Documents/Obsidian Vault/AGENT-MEMORY',
        memoryVaultSubdir: '',
      );

      expect(
        env['MEMORY_VAULT_PATH'],
        '/Users/alice/Documents/Obsidian Vault/AGENT-MEMORY',
      );
      expect(env['MEMORY_VAULT_SUBDIR'], '');
      expect(env['PORT'], '4001');
      expect(env['DB_PATH'], '/db/rhythm.db');
      expect(env['AGENT_LOCAL'], 'true');
      // Base env is preserved.
      expect(env['HOME'], '/Users/alice');
    });

    test(
        'an explicit MEMORY_VAULT_PATH already in baseEnv wins over the setting',
        () {
      final env = buildApiServerEnvironment(
        baseEnv: const {'MEMORY_VAULT_PATH': '/explicit/override'},
        port: '4001',
        dbPath: '/db/rhythm.db',
        memoryVaultPath: '/from/setting',
        memoryVaultSubdir: '',
      );

      expect(env['MEMORY_VAULT_PATH'], '/explicit/override');
    });

    test(
        'an explicit MEMORY_VAULT_SUBDIR already in baseEnv wins over the setting',
        () {
      final env = buildApiServerEnvironment(
        baseEnv: const {'MEMORY_VAULT_SUBDIR': 'explicit-sub'},
        port: '4001',
        dbPath: '/db/rhythm.db',
        memoryVaultPath: '/from/setting',
        memoryVaultSubdir: 'setting-sub',
      );

      expect(env['MEMORY_VAULT_SUBDIR'], 'explicit-sub');
      // Path setting still applies since only subdir was overridden.
      expect(env['MEMORY_VAULT_PATH'], '/from/setting');
    });

    test(
        'omits MEMORY_VAULT_PATH/SUBDIR entirely when the setting is null '
        '(back-compat: api_server falls back to its own default)', () {
      final env = buildApiServerEnvironment(
        baseEnv: const {},
        port: '4001',
        dbPath: '/db/rhythm.db',
      );

      expect(env.containsKey('MEMORY_VAULT_PATH'), isFalse);
      expect(env.containsKey('MEMORY_VAULT_SUBDIR'), isFalse);
    });

    test('always sets PORT, DB_PATH, AGENT_LOCAL regardless of vault settings',
        () {
      final env = buildApiServerEnvironment(
        baseEnv: const {},
        port: '4002',
        dbPath: '/other/db.sqlite',
      );

      expect(env['PORT'], '4002');
      expect(env['DB_PATH'], '/other/db.sqlite');
      expect(env['AGENT_LOCAL'], 'true');
    });
  });
}
