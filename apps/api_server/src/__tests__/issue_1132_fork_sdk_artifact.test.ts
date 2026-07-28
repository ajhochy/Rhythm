/**
 * Acceptance contract for #1132.
 *
 * This deliberately tests the distributable artifact, not the fork source.
 * A source-only SDK can look complete while the API and release bundle still
 * install the incomplete npm package—the exact false-green #1132 eliminates.
 */
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const API_ROOT = resolve(__dirname, '../..');
const REPO_ROOT = resolve(API_ROOT, '../..');
const VENDOR_ROOT = resolve(API_ROOT, 'vendor/opencode-ai-sdk');
const SDK_ROOT = resolve(REPO_ROOT, 'apps/opencode_fork/packages/sdk/js');
const SERVICE_FILE = resolve(API_ROOT, 'src/services/opencode_client_service.ts');
const AMBIENT_FILE = resolve(API_ROOT, 'src/@types/opencode-ai-sdk.d.ts');

function text(path: string): string {
  return readFileSync(path, 'utf8');
}

function methodBody(source: string, name: string, nextName: string): string {
  const start = source.indexOf(`async ${name}(`);
  const end = source.indexOf(`async ${nextName}(`, start + 1);
  expect(start, `missing ${name}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing boundary ${nextName}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('#1132 fork SDK artifact contract', () => {
  it('fork-generated SDK exposes Rhythm custom events and compatibility aliases', () => {
    const generated = text(resolve(VENDOR_ROOT, 'v2/gen/types.gen.d.ts'));
    const compatibility = text(resolve(VENDOR_ROOT, 'rhythm.d.ts'));

    for (const name of [
      'EventMessagePartDelta',
      'EventPermissionAsked',
      'EventQuestionAsked',
      'EventQuestionReplied',
      'EventQuestionRejected',
    ]) {
      expect(generated).toContain(`export type ${name}`);
    }
    expect(generated).toMatch(/mcpAllowlist\?:[\s\S]*?\| null/);
    expect(generated).toMatch(/skillAllowlist\?:[\s\S]*?\| null/);
    for (const name of [
      'RhythmEvent',
      'SdkAgent',
      'McpStatusEntry',
      'PartInput',
      'McpLocalConfigInput',
      'McpRemoteConfigInput',
    ]) {
      expect(compatibility).toContain(name);
    }
  });

  it('fork SDK one-command build emits an importable vendor package', () => {
    const forkPackage = JSON.parse(text(resolve(SDK_ROOT, 'package.json'))) as {
      scripts?: Record<string, string>;
    };
    expect(forkPackage.scripts?.['build:rhythm']).toBeTruthy();

    const vendorPackage = JSON.parse(text(resolve(VENDOR_ROOT, 'package.json'))) as {
      exports?: Record<string, { import?: string; types?: string }>;
    };
    for (const key of ['.', './client', './v2', './v2/client', './rhythm']) {
      expect(vendorPackage.exports?.[key]?.import, `${key} import export`).toMatch(/\.js$/);
      expect(vendorPackage.exports?.[key]?.types, `${key} types export`).toMatch(/\.d\.ts$/);
    }
    expect(existsSync(resolve(VENDOR_ROOT, 'index.js'))).toBe(true);
    expect(existsSync(resolve(VENDOR_ROOT, 'index.d.ts'))).toBe(true);
    expect(existsSync(resolve(VENDOR_ROOT, 'v2/gen/types.gen.d.ts'))).toBe(true);
  });

  it('api_server consumes only the generated fork package', () => {
    const pkg = JSON.parse(text(resolve(API_ROOT, 'package.json'))) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@opencode-ai/sdk']).toBe('file:vendor/opencode-ai-sdk');
    if (existsSync(AMBIENT_FILE)) {
      const ambient = text(AMBIENT_FILE)
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim();
      expect(ambient).toMatch(/^export\s+\{?\s*\}?\s*;?$/);
    }
  });

  it('generated package loads through its published runtime export', async () => {
    const sdk = (await import(pathToFileURL(resolve(VENDOR_ROOT, 'index.js')).href)) as {
      createOpencode?: unknown;
      createOpencodeClient?: unknown;
    };
    expect(sdk.createOpencode).toBeTypeOf('function');
    expect(sdk.createOpencodeClient).toBeTypeOf('function');
  });

  it('four SDK-covered operations contain no raw fetch fallback', () => {
    const source = text(SERVICE_FILE);
    const allowlist = methodBody(source, 'updateSessionAllowlist', 'updateSessionSkillAllowlist');
    const skills = methodBody(source, 'updateSessionSkillAllowlist', 'listSkills');
    const reloadSkills = methodBody(source, 'reloadSkills', 'reloadConfig');
    const reloadConfig = methodBody(source, 'reloadConfig', 'prompt');

    for (const body of [allowlist, skills, reloadSkills, reloadConfig]) {
      expect(body).not.toContain('fetch(');
    }
    expect(allowlist).toContain('client.session.update');
    expect(skills).toContain('client.session.update');
    expect(reloadSkills).toContain('client.app.skills2.reload');
    expect(reloadConfig).toContain('client.app.config.reload');
  });
});
