import {
  chmodSync as nodeChmodSync,
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
  renameSync as nodeRenameSync,
  writeFileSync as nodeWriteFileSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * #872 — merges new KEY=VALUE pairs into existing dotenv content, updating
 * an existing key in place (no duplicate lines) and appending genuinely new
 * keys. Comments and unrelated keys are preserved verbatim.
 */
export function mergeDotenvContent(
  existingContent: string,
  values: Record<string, string>,
): string {
  const lines = existingContent.length > 0 ? existingContent.split('\n') : [];
  const remaining = { ...values };

  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (key in remaining) {
      const value = remaining[key];
      delete remaining[key];
      return `${key}=${value}`;
    }
    return line;
  });

  // Drop a single trailing empty line so appended keys don't leave a blank
  // gap, then re-add exactly one trailing newline at the end.
  while (updatedLines.length > 0 && updatedLines[updatedLines.length - 1] === '') {
    updatedLines.pop();
  }

  for (const [key, value] of Object.entries(remaining)) {
    updatedLines.push(`${key}=${value}`);
  }

  return `${updatedLines.join('\n')}\n`;
}

export interface WriteEnvConfigDeps {
  path: string;
  existsSync: (path: string) => boolean;
  readFileSync: (path: string) => string;
  writeFileSync: (path: string, content: string) => void;
  renameSync: (from: string, to: string) => void;
  chmodSync: (path: string, mode: number) => void;
}

const DEFAULT_DEPS: Omit<WriteEnvConfigDeps, 'path'> = {
  existsSync: nodeExistsSync,
  readFileSync: (path: string) => nodeReadFileSync(path, 'utf8'),
  writeFileSync: (path: string, content: string) => nodeWriteFileSync(path, content),
  renameSync: nodeRenameSync,
  chmodSync: nodeChmodSync,
};

/**
 * #872 — writes secret values to the target `.env` file (default: `.env` in
 * cwd, the documented config location). Secrets get `0600` permissions.
 *
 * Interruption-safety (Ctrl+C mid-flow must not corrupt the file):
 *  1. Read existing content (or '' if the file doesn't exist yet).
 *  2. Merge in-memory (no disk write yet).
 *  3. Write the FULL merged content to a temp file in the same directory.
 *  4. chmod the temp file to 0600.
 *  5. Atomically rename the temp file over the real path.
 *
 * Steps 3-5 are the only steps that touch disk, and `rename` is atomic on
 * POSIX filesystems — a process killed at any point before the rename
 * leaves the original file completely untouched; a kill after the rename
 * leaves the fully-written new file. There is no window where a
 * partially-written file is visible at `path`.
 */
export async function writeEnvConfig(
  values: Record<string, string>,
  deps: WriteEnvConfigDeps,
): Promise<void> {
  const merged = deps.readFileSync as (path: string) => string;
  const existingContent = deps.existsSync(deps.path) ? merged(deps.path) : '';
  const newContent = mergeDotenvContent(existingContent, values);

  const tempPath = join(
    deps.path.slice(0, deps.path.lastIndexOf('/') + 1) || '.',
    `.${deps.path.split('/').pop()}.rhythm-setup-tmp-${process.pid}-${Date.now()}`,
  );

  deps.writeFileSync(tempPath, newContent);
  deps.chmodSync(tempPath, 0o600);
  deps.renameSync(tempPath, deps.path);
}

export function defaultEnvPath(cwd: string = process.cwd()): string {
  return join(cwd, '.env');
}

export function defaultWriteEnvConfigDeps(path: string): WriteEnvConfigDeps {
  return { path, ...DEFAULT_DEPS };
}
