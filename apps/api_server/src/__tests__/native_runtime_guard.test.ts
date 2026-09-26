import { afterEach, describe, expect, it, vi } from 'vitest';
import * as nativeRuntimeGuard from '../database/native_runtime_guard';

const { assertSafeNativeRuntime, nativeRuntimeVerdict } = nativeRuntimeGuard;

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
    ['22.19.0', '13.0.3'],
    ['24.19.0', '13.0.3'],
    ['24.21.0', '13.1.0'],
    ['25.0.0', '13.0.3'],
  ])('allows Node %s with better-sqlite3 %s', (nodeVersion, betterSqliteVersion) => {
    expect(nativeRuntimeVerdict(nodeVersion, betterSqliteVersion)).toBe('ok');
  });
});

describe('1505:1505-C-native-runtime-guard:2 injectable installed-version guard', () => {
  it.each([
    ['24.19.0', '12.8.0'],
    ['24.21.0', '12.9.0'],
  ])('names nodejs/node#65446 and the remedy for Node %s with better-sqlite3 %s', (nodeVersion, betterSqliteVersion) => {
    expect(() => assertSafeNativeRuntime(nodeVersion, betterSqliteVersion)).toThrow(
      /nodejs\/node#65446/,
    );
    expect(() => assertSafeNativeRuntime(nodeVersion, betterSqliteVersion)).toThrow(
      /better-sqlite3.*13|Node.*24\.18\.1/i,
    );
  });

  it('loads the exported installed package version and permits better-sqlite3 13.x', () => {
    expect(() => assertSafeNativeRuntime('24.21.0')).not.toThrow();
  });
});

describe('1505:1505-C-native-runtime-guard:3 DB init fails before native construction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    databaseConstructorSpy.mockClear();
    vi.resetModules();
  });

  // Regression coverage for the guard being wired into initDb() itself, not
  // just its standalone predicate: spy on the real assertSafeNativeRuntime
  // (rather than pinning to a specific installed better-sqlite3 version,
  // which this slice deliberately bumped past the affected 12.x range) so
  // the test survives future version bumps and still proves ordering.
  it('calls assertSafeNativeRuntime before constructing Database, and a refusal blocks construction', async () => {
    vi.spyOn(nativeRuntimeGuard, 'assertSafeNativeRuntime').mockImplementation(() => {
      throw new Error('Unsafe native SQLite runtime (synthetic refusal for this test)');
    });

    const { initDb } = await import('../database/db');

    await expect(initDb()).rejects.toThrow(/synthetic refusal for this test/);
    expect(databaseConstructorSpy).not.toHaveBeenCalled();
  });
});
