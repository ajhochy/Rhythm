import { defineConfig } from 'vitest/config';

// Run only under managed-mcp-regression.sb: private files/in-memory SQLite,
// actual Dayflow producer and canonical sync/resolver, no engine or provider.
export default defineConfig({ envDir: false, test: {
  pool: 'threads', maxWorkers: 1, fileParallelism: false,
  include: ['src/__tests__/qualification_dayflow_vault_survival.spec.ts'],
} });
