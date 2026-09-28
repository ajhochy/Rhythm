import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../../..');

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function workflowNodeVersions(path: string): string[] {
  return [...readRepoFile(path).matchAll(/node-version:\s*['"]?([^'"\s#]+)['"]?/g)]
    .map((match) => match[1]);
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

describe('1505:1505-B-node-pin-consistency:1 exact api_server Node pins', () => {
  it('pins every api_server-installing workflow to an exact x.y.z runtime', () => {
    const workflows = [
      '.github/workflows/server_ci.yml',
      '.github/workflows/api_deploy_synology.yml',
      '.github/workflows/desktop_release.yml',
      '.github/workflows/electron_release.yml',
    ];

    for (const workflow of workflows) {
      const versions = workflowNodeVersions(workflow);
      expect(versions.length, `${workflow} must declare a Node version`).toBeGreaterThan(0);
      for (const version of versions) {
        expect(version, `${workflow} must use an exact x.y.z Node pin`).toMatch(/^\d+\.\d+\.\d+$/);
      }
    }
  });

  it('keeps Node 24 below 24.19.0 while better-sqlite3 is older than 13', () => {
    const packageJson = JSON.parse(readRepoFile('apps/api_server/package.json')) as {
      dependencies: Record<string, string>;
    };
    const betterSqliteMajor = Number(
      packageJson.dependencies['better-sqlite3'].match(/(\d+)/)?.[1],
    );
    if (betterSqliteMajor >= 13) return;

    const node24Pins = [
      ...workflowNodeVersions('.github/workflows/server_ci.yml'),
      ...workflowNodeVersions('.github/workflows/api_deploy_synology.yml'),
      ...workflowNodeVersions('.github/workflows/desktop_release.yml'),
      ...workflowNodeVersions('.github/workflows/electron_release.yml'),
      readRepoFile('apps/api_server/Dockerfile').match(/^FROM node:(\d+\.\d+\.\d+)-/m)?.[1] ?? '',
    ].filter((version) => version.startsWith('24.'));

    for (const version of node24Pins) {
      expect(
        compareVersions(version, '24.19.0'),
        `Node ${version} is affected by nodejs/node#65446 with better-sqlite3 ${packageJson.dependencies['better-sqlite3']}`,
      ).toBeLessThan(0);
    }
  });
});

describe('1505:1505-B-node-pin-consistency:2 deploy test/runtime parity', () => {
  it('runs api_deploy_synology verification on the Dockerfile runtime Node', () => {
    const dockerVersion = readRepoFile('apps/api_server/Dockerfile')
      .match(/^FROM node:(\d+\.\d+\.\d+)-/m)?.[1];
    const deployVersions = workflowNodeVersions('.github/workflows/api_deploy_synology.yml');

    expect(dockerVersion).toBeDefined();
    expect(deployVersions).toEqual([dockerVersion]);
  });
});

describe('1547:c12-ci Postgres 16 production parity', () => {
  it('runs Google desktop Postgres coverage in the PG16 bootstrap job', () => {
    const workflow = readRepoFile('.github/workflows/server_ci.yml');
    const livePostgresJob = workflow.match(/  live-postgres-bootstrap:[\s\S]*$/)?.[0];

    expect(livePostgresJob).toContain('image: postgres:16');
    expect(livePostgresJob).toContain('src/__tests__/live_postgres_bootstrap.test.ts');
    expect(livePostgresJob).toContain('src/__tests__/google_desktop_postgres.test.ts');
  });
});
