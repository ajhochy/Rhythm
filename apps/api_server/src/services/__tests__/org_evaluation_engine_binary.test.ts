import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveEvaluationEngineBinary } from '../org_evaluation_engine_binary';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync('/private/tmp/rhythm-evaluation-bin-'); roots.push(root);
  const resources = join(root, 'Rhythm.app', 'Contents', 'Resources');
  const services = join(resources, 'api_server', 'dist', 'services');
  const binary = join(resources, 'opencode_bin', 'opencode');
  mkdirSync(services, { recursive: true }); mkdirSync(join(resources, 'opencode_bin'));
  writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o500 });
  return { root, services, binary };
}
describe('bounded Reviewer packaged engine lookup', () => {
  it('finds the actual packaged engine without developer environment variables', () => {
    const f = fixture();
    expect(resolveEvaluationEngineBinary({ servicesDirectory: f.services, environment: {} })).toBe(f.binary);
  });
  it('honors an explicit pinned developer binary or directory and never searches stock PATH', () => {
    const f = fixture();
    const dev = join(f.root, 'developer', 'opencode'); mkdirSync(join(f.root, 'developer'));
    writeFileSync(dev, '#!/bin/sh\nexit 0\n', { mode: 0o500 });
    expect(resolveEvaluationEngineBinary({ servicesDirectory: f.services, environment: { RHYTHM_OPENCODE_BIN: dev } })).toBe(dev);
    expect(resolveEvaluationEngineBinary({ servicesDirectory: f.services, environment: { RHYTHM_OPENCODE_BIN_DIR: join(f.root, 'developer') } })).toBe(dev);
    rmSync(f.binary);
    expect(() => resolveEvaluationEngineBinary({ servicesDirectory: f.services, environment: { PATH: join(f.root, 'developer') } })).toThrow(/pinned/);
  });
  it('refuses a missing/non-executable explicit override instead of silently choosing another engine', () => {
    const f = fixture();
    expect(() => resolveEvaluationEngineBinary({ servicesDirectory: f.services,
      environment: { RHYTHM_OPENCODE_BIN: join(f.root, 'missing') } })).toThrow(/pinned/);
    chmodSync(f.binary, 0o400);
    expect(() => resolveEvaluationEngineBinary({ servicesDirectory: f.services, environment: {} })).toThrow(/pinned/);
  });
});
