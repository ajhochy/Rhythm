import 'package:flutter_test/flutter_test.dart';

import 'package:rhythm_desktop/app/core/server/api_server_service.dart';

const _approvalDigest =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _approvalPublicKey = 'test-public-key';

void main() {
  group('buildApiServerEnvironment', () {
    test(
      'injects MEMORY_VAULT_PATH and MEMORY_VAULT_SUBDIR from the setting',
      () {
        final env = buildApiServerEnvironment(
          baseEnv: const {'HOME': '/Users/alice'},
          port: '4001',
          dbPath: '/db/rhythm.db',
          memoryVaultPath: '/Users/alice/Documents/Obsidian Vault/AGENT-MEMORY',
          memoryVaultSubdir: '',
          humanApprovalCapabilitySha256: _approvalDigest,
          humanApprovalPublicKey: _approvalPublicKey,
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
      },
    );

    test(
      'an explicit MEMORY_VAULT_PATH already in baseEnv wins over the setting',
      () {
        final env = buildApiServerEnvironment(
          baseEnv: const {'MEMORY_VAULT_PATH': '/explicit/override'},
          port: '4001',
          dbPath: '/db/rhythm.db',
          memoryVaultPath: '/from/setting',
          memoryVaultSubdir: '',
          humanApprovalCapabilitySha256: _approvalDigest,
          humanApprovalPublicKey: _approvalPublicKey,
        );

        expect(env['MEMORY_VAULT_PATH'], '/explicit/override');
      },
    );

    test(
      'an explicit MEMORY_VAULT_SUBDIR already in baseEnv wins over the setting',
      () {
        final env = buildApiServerEnvironment(
          baseEnv: const {'MEMORY_VAULT_SUBDIR': 'explicit-sub'},
          port: '4001',
          dbPath: '/db/rhythm.db',
          memoryVaultPath: '/from/setting',
          memoryVaultSubdir: 'setting-sub',
          humanApprovalCapabilitySha256: _approvalDigest,
          humanApprovalPublicKey: _approvalPublicKey,
        );

        expect(env['MEMORY_VAULT_SUBDIR'], 'explicit-sub');
        // Path setting still applies since only subdir was overridden.
        expect(env['MEMORY_VAULT_PATH'], '/from/setting');
      },
    );

    test(
        'omits MEMORY_VAULT_PATH/SUBDIR entirely when the setting is null '
        '(back-compat: api_server falls back to its own default)', () {
      final env = buildApiServerEnvironment(
        baseEnv: const {},
        port: '4001',
        dbPath: '/db/rhythm.db',
        humanApprovalCapabilitySha256: _approvalDigest,
        humanApprovalPublicKey: _approvalPublicKey,
      );

      expect(env.containsKey('MEMORY_VAULT_PATH'), isFalse);
      expect(env.containsKey('MEMORY_VAULT_SUBDIR'), isFalse);
    });

    test(
      'always sets PORT, DB_PATH, AGENT_LOCAL regardless of vault settings',
      () {
        final env = buildApiServerEnvironment(
          baseEnv: const {},
          port: '4002',
          dbPath: '/other/db.sqlite',
          humanApprovalCapabilitySha256: _approvalDigest,
          humanApprovalPublicKey: _approvalPublicKey,
        );

        expect(env['PORT'], '4002');
        expect(env['DB_PATH'], '/other/db.sqlite');
        expect(env['AGENT_LOCAL'], 'true');
      },
    );

    // #1154 — MCP_ROLES_DIR wiring for the bundled app (mcpRole "Unknown
    // mcpRole" 400s in the shipped .app because nothing pointed the server
    // at the bundled .mcp-roles/ dir).
    test('injects MCP_ROLES_DIR when provided (bundled app path)', () {
      final env = buildApiServerEnvironment(
        baseEnv: const {},
        port: '4001',
        dbPath: '/db/rhythm.db',
        mcpRolesDir: '/Applications/Rhythm.app/Contents/Resources/.mcp-roles',
        humanApprovalCapabilitySha256: _approvalDigest,
        humanApprovalPublicKey: _approvalPublicKey,
      );

      expect(
        env['MCP_ROLES_DIR'],
        '/Applications/Rhythm.app/Contents/Resources/.mcp-roles',
      );
    });

    test(
        'an explicit MCP_ROLES_DIR already in baseEnv wins over the bundled '
        'default', () {
      final env = buildApiServerEnvironment(
        baseEnv: const {'MCP_ROLES_DIR': '/explicit/override/.mcp-roles'},
        port: '4001',
        dbPath: '/db/rhythm.db',
        mcpRolesDir: '/Applications/Rhythm.app/Contents/Resources/.mcp-roles',
        humanApprovalCapabilitySha256: _approvalDigest,
        humanApprovalPublicKey: _approvalPublicKey,
      );

      expect(env['MCP_ROLES_DIR'], '/explicit/override/.mcp-roles');
    });

    test(
        'omits MCP_ROLES_DIR entirely when null (dev: server falls back to '
        'its own repo-root-relative default)', () {
      final env = buildApiServerEnvironment(
        baseEnv: const {},
        port: '4001',
        dbPath: '/db/rhythm.db',
        humanApprovalCapabilitySha256: _approvalDigest,
        humanApprovalPublicKey: _approvalPublicKey,
      );

      expect(env.containsKey('MCP_ROLES_DIR'), isFalse);
    });

    test('strips raw approval secrets and injects only digest/public key', () {
      final env = buildApiServerEnvironment(
        baseEnv: const {
          'HUMAN_APPROVAL_CAPABILITY': 'must-not-cross-process',
          'HUMAN_APPROVAL_PRIVATE_KEY': 'must-not-cross-process',
        },
        port: '4001',
        dbPath: '/db/rhythm.db',
        humanApprovalCapabilitySha256: _approvalDigest,
        humanApprovalPublicKey: _approvalPublicKey,
      );

      expect(env['HUMAN_APPROVAL_CAPABILITY_SHA256'], _approvalDigest);
      expect(env['HUMAN_APPROVAL_PUBLIC_KEY'], _approvalPublicKey);
      expect(env.containsKey('HUMAN_APPROVAL_CAPABILITY'), isFalse);
      expect(env.containsKey('HUMAN_APPROVAL_PRIVATE_KEY'), isFalse);
    });

    test('seeds RHYTHM_RELAY_BEARER from the persisted session token', () {
      final env = buildApiServerEnvironment(
        baseEnv: const {},
        port: '4001',
        dbPath: '/db/rhythm.db',
        relaySessionToken: 'persisted-token',
        humanApprovalCapabilitySha256: _approvalDigest,
        humanApprovalPublicKey: _approvalPublicKey,
      );

      expect(env['RHYTHM_RELAY_BEARER'], 'persisted-token');
    });

    test('an explicit RHYTHM_RELAY_BEARER env override wins', () {
      final env = buildApiServerEnvironment(
        baseEnv: const {'RHYTHM_RELAY_BEARER': 'dev-override'},
        port: '4001',
        dbPath: '/db/rhythm.db',
        relaySessionToken: 'persisted-token',
        humanApprovalCapabilitySha256: _approvalDigest,
        humanApprovalPublicKey: _approvalPublicKey,
      );

      expect(env['RHYTHM_RELAY_BEARER'], 'dev-override');
    });

    test('leaves RHYTHM_RELAY_BEARER unset without a token', () {
      final env = buildApiServerEnvironment(
        baseEnv: const {},
        port: '4001',
        dbPath: '/db/rhythm.db',
        humanApprovalCapabilitySha256: _approvalDigest,
        humanApprovalPublicKey: _approvalPublicKey,
      );

      expect(env.containsKey('RHYTHM_RELAY_BEARER'), isFalse);
    });
  });
}
