import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { format } from 'util';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 4;
let restorePersistentConsole: (() => void) | null = null;

export function apiServerLogPath(): string {
  return process.env.RHYTHM_API_LOG_PATH ??
    join(homedir(), 'Library', 'Logs', 'Rhythm', 'api_server.log');
}

function rotateIfNeeded(
  logPath: string,
  incomingBytes: number,
  maxBytes: number,
  maxFiles: number,
): void {
  const currentBytes = existsSync(logPath) ? statSync(logPath).size : 0;
  if (currentBytes + incomingBytes <= maxBytes) return;
  for (let index = maxFiles; index >= 1; index -= 1) {
    const source = index === 1 ? logPath : `${logPath}.${index - 1}`;
    const target = `${logPath}.${index}`;
    if (!existsSync(source)) continue;
    if (existsSync(target)) unlinkSync(target);
    renameSync(source, target);
  }
}

function appendLogLine(
  logPath: string,
  level: string,
  args: unknown[],
  maxBytes: number,
  maxFiles: number,
): void {
  const line = `${new Date().toISOString()} [${level}] ${format(...args)}\n`;
  mkdirSync(dirname(logPath), { recursive: true });
  rotateIfNeeded(logPath, Buffer.byteLength(line), maxBytes, maxFiles);
  appendFileSync(logPath, line, 'utf8');
}

/**
 * Tee console output to the durable rotating api_server log.
 *
 * Returns a restore callback for tests. Production installs once for the
 * process lifetime; repeated installation is idempotent.
 */
export function installPersistentConsoleLogging(
  options: {
    logPath?: string;
    maxBytes?: number;
    maxFiles?: number;
  } = {},
): () => void {
  if (restorePersistentConsole) return restorePersistentConsole;
  const logPath = options.logPath ?? apiServerLogPath();
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const wrap = (
    level: 'stdout' | 'stderr',
    original: (...args: unknown[]) => void,
  ) => (...args: unknown[]): void => {
    try {
      appendLogLine(logPath, level, args, maxBytes, maxFiles);
    } catch (err) {
      original(`[api_server logger] durable write failed: ${String(err)}`);
    }
    original(...args);
  };
  console.log = wrap('stdout', originals.log);
  console.info = wrap('stdout', originals.info);
  console.warn = wrap('stderr', originals.warn);
  console.error = wrap('stderr', originals.error);

  restorePersistentConsole = () => {
    console.log = originals.log;
    console.info = originals.info;
    console.warn = originals.warn;
    console.error = originals.error;
    restorePersistentConsole = null;
  };
  return restorePersistentConsole;
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return address === '::1' ||
    address === '127.0.0.1' ||
    address.startsWith('127.') ||
    address.startsWith('::ffff:127.');
}

export function readApiLogTail(logPath: string, lines: number): string[] {
  if (!existsSync(logPath)) return [];
  const boundedLines = Math.max(1, Math.min(1_000, Math.trunc(lines)));
  return readFileSync(logPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(-boundedLines);
}

export const logger = {
  info(message: string, ...args: unknown[]) {
    // eslint-disable-next-line no-console
    console.log(`[INFO] ${message}`, ...args);
  },
  warn(message: string, ...args: unknown[]) {
    // eslint-disable-next-line no-console
    console.warn(`[WARN] ${message}`, ...args);
  },
  error(message: string, ...args: unknown[]) {
    // eslint-disable-next-line no-console
    console.error(`[ERROR] ${message}`, ...args);
  },
};
