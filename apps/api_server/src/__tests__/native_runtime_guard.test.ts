import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeRuntimeVerdict } from '../database/native_runtime_guard';

const { databaseConstructorSpy } = vi.hoisted(() => ({
  databaseConstructorSpy: vi.fn(),
}));

vi.mock('better-sqlite3', () => ({ default: databaseConstructorSpy }));

describe('1505:1505-C-native-runtime-guard:1 affected runtime predicate', () => {
  it.each([
    ['24.19.0', '12.8.0'],
    ['24.21.0', '12.9.0'],
  ])('refuses Node %s with better-sqlite3 %s', (nodeVersion, betterSqliteVersion) => {
    expect(nativeRuntimeVerdict(nodeVersion, betterSqliteVersion)).toBe('refuse');
  });

  it.each([
    ['24.18.1', '12.8.0'],
    ['22.19.0', '12.8.0'],
    ['24.21.0', '13.0.3'],
  ])('allows Node %s with better-sqlite3 %s', (nodeVersion, betterSqliteVersion) => {
    expect(nativeRuntimeVerdict(nodeVersion, betterSqliteVersion)).toBe('ok');
  });
});

describe('1505:1505-C-native-runtime-guard:2 DB init fails before native construction', () => {
  const originalNodeVersion = process.versions.node;

  afterEach(() => {
    Object.defineProperty(process.versions, 'node', { value: originalNodeVersion });
    databaseConstructorSpy.mockClear();
    vi.resetModules();
  });

  it('names nodejs/node#65446 and the upgrade/pin remedy before opening SQLite', async () => {
    Object.defineProperty(process.versions, 'node', { value: '24.21.0' });
    const { initDb } = await import('../database/db');

    await expect(initDb()).rejects.toThrow(/nodejs\/node#65446/);
    await expect(initDb()).rejects.toThrow(/better-sqlite3.*13|Node.*24\.18\.1/i);
    expect(databaseConstructorSpy).not.toHaveBeenCalled();
  });
});
