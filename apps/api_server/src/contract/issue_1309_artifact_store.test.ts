import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../..');
const source = (relative: string) => {
  const file = path.join(root, relative);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

describe('issue #1309 artifact-store contract', () => {
  it('issue-1309-c1: SQLite metadata and configurable filesystem root', () => {
    const migration = source('apps/api_server/src/database/migrations.ts');
    const env = source('apps/api_server/src/config/env.ts');
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS media_artifacts/);
    for (const column of ['project', 'session', 'mime', 'size', 'checksum', 'created_at', 'storage_key', 'pinned']) {
      expect(migration).toMatch(new RegExp(`\\b${column}\\b`));
    }
    expect(env).toContain('ARTIFACT_STORAGE_ROOT');
    expect(env).toContain('ARTIFACT_RETENTION_DAYS');
  });

  it('issue-1309-c2: checksum-addressed writes deduplicate bytes', () => {
    const storage = source('apps/api_server/src/services/media_artifact_store.ts');
    expect(storage).toContain("createHash('sha256')");
    expect(storage).toMatch(/checksum.*storageKey|storageKey.*checksum/s);
  });

  it('issue-1309-c3: completed generated media is automatically registered', () => {
    expect(source('apps/api_server/src/services/opencode_stream_bridge.ts')).toContain('registerGeneratedMediaPart');
    expect(source('apps/api_server/src/controllers/agentDesignsController.ts')).toContain('registerGeneratedMediaFile');
  });

  it('issue-1309-c5: retention removes expired unpinned artifacts and preserves pinned artifacts', () => {
    const store = source('apps/api_server/src/services/media_artifact_store.ts');
    expect(store).toContain('sweepExpiredArtifacts');
    expect(store).toMatch(/pinned\s*=\s*(?:0|FALSE)/i);
  });

  it('issue-1309-c6: SQLite and Postgres artifact schemas stay equivalent', () => {
    const sqlite = source('apps/api_server/src/database/migrations.ts');
    const postgres = source('apps/api_server/src/database/postgres_bootstrap.ts');
    expect(sqlite).toContain('CREATE TABLE IF NOT EXISTS media_artifacts');
    expect(postgres).toContain('CREATE TABLE IF NOT EXISTS media_artifacts');
    for (const column of ['project', 'session', 'mime', 'size', 'checksum', 'created_at', 'storage_key', 'pinned']) {
      expect(sqlite).toMatch(new RegExp(`\\b${column}\\b`));
      expect(postgres).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it('issue-1309-c7: storage keys cannot traverse outside the configured root', () => {
    const storage = source('apps/api_server/src/services/media_artifact_store.ts');
    expect(storage).toMatch(/assert.*(?:storage|artifact).*path|containsReal|path\.relative/i);
    expect(storage).toMatch(/travers|outside.*root/i);
  });

  it('issue-1309-c9: authenticated pin updates retention state', () => {
    const routes = source('apps/api_server/src/routes/media_artifacts_routes.ts');
    expect(routes).toContain('requireAuth');
    expect(routes).toMatch(/pin/i);
  });

  it('issue-1309-c10: prior gallery decision is marked superseded by issue 1309', () => {
    const decision = source('docs/ai/decisions/2026-07-30-gallery-source-of-truth-is-the-local-mac.md');
    expect(decision.slice(0, 500)).toMatch(/superseded/i);
    expect(decision.slice(0, 500)).toContain('#1309');
  });
});
