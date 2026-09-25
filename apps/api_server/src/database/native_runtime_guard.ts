export type NativeRuntimeVerdict = 'ok' | 'refuse';

function semverParts(version: string): [number, number, number] | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Node 24.19.0+ backported ObjectWrap cleanup hooks without the addon cleanup
 * registry. better-sqlite3 12.x still uses ObjectWrap and can abort during GC.
 */
export function nativeRuntimeVerdict(
  nodeVersion: string,
  betterSqliteVersion: string,
): NativeRuntimeVerdict {
  const node = semverParts(nodeVersion);
  const betterSqlite = semverParts(betterSqliteVersion);
  if (!node || !betterSqlite) return 'ok';

  const affectedNode = node[0] === 24 && (node[1] > 19 || (node[1] === 19 && node[2] >= 0));
  if (affectedNode && betterSqlite[0] < 13) return 'refuse';
  return 'ok';
}

/** Fail before constructing a SQLite Database or Statement on an unsafe ABI pair. */
export function assertSafeNativeRuntime(
  nodeVersion = process.versions.node,
  betterSqliteVersion = (require('better-sqlite3/package.json') as { version: string }).version,
): void {
  if (nativeRuntimeVerdict(nodeVersion, betterSqliteVersion) === 'ok') return;
  throw new Error(
    `Unsafe native SQLite runtime: Node ${nodeVersion} with better-sqlite3 ${betterSqliteVersion} ` +
      `can abort during GC due to nodejs/node#65446. Use Node 24.18.1 or earlier, ` +
      `or upgrade better-sqlite3 to 13.0.3 or later.`,
  );
}
