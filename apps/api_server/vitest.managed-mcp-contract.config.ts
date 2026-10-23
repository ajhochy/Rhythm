import { defineConfig } from 'vitest/config';

// MUST run under the independently verified managed-mcp-regression.sb profile.
// Bounded private-file unit regressions only. No .env load, servers or models.
export default defineConfig({ envDir: false, test: {
  pool: 'threads', maxWorkers: 1, fileParallelism: false,
  restoreMocks: false, // Each afterEach restores the native os spy explicitly.
  testTimeout: 2000, hookTimeout: 15000,
  include: ['src/__tests__/opc_rhythm_mcp_managed_contract.spec.ts'],
} });
