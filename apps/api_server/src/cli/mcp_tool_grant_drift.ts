import { isAbsolute } from 'node:path';

import Database from 'better-sqlite3';

import { setDb } from '../database/db';
import { reportMcpToolGrantDrift } from '../services/org_audit_service';

function parseEngineUrl(args: string[]): string {
  if (args.length === 2 && args[0] === '--engine-url' && args[1]) return args[1];
  if (args.length === 0 && process.env.RHYTHM_LIVE_ENGINE_URL) {
    return process.env.RHYTHM_LIVE_ENGINE_URL;
  }
  throw new Error('Usage: rhythm mcp-tool-grant-drift --engine-url http://127.0.0.1:<port>');
}

export async function runMcpToolGrantDriftCli(args: string[]): Promise<void> {
  if ((process.env.DB_CLIENT ?? 'sqlite') !== 'sqlite') {
    throw new Error('mcp-tool-grant-drift requires DB_CLIENT=sqlite');
  }
  const dbPath = process.env.DB_PATH;
  if (!dbPath || !isAbsolute(dbPath)) {
    throw new Error('mcp-tool-grant-drift requires an explicit absolute DB_PATH');
  }
  const engineUrl = parseEngineUrl(args);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    setDb(db);
    const report = await reportMcpToolGrantDrift(engineUrl);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    db.close();
  }
}
