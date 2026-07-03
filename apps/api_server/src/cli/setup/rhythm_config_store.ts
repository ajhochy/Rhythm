import {
  existsSync as nodeExistsSync,
  mkdirSync as nodeMkdirSync,
  readFileSync as nodeReadFileSync,
  writeFileSync as nodeWriteFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { RhythmConfig } from '../../config/rhythm_config';

/**
 * #879 — persistence for the Rhythm-owned capabilities config. Deliberately
 * a SEPARATE file from opencode.json (`rhythm-capabilities.json`, colocated
 * in the same `~/.config/opencode/` directory as the engine's own config) so
 * writing/merging capability toggles can never corrupt the engine's config
 * shape. `rhythm doctor` and `rhythm setup` both read/write through this
 * module rather than touching the file directly.
 */
export function defaultRhythmConfigPath(): string {
  return join(homedir(), '.config', 'opencode', 'rhythm-capabilities.json');
}

export function emptyRhythmConfig(): RhythmConfig {
  return { capabilities: {}, disabledMcpServers: [], enabledSkills: null };
}

export interface LoadRhythmConfigDeps {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string) => string;
  path?: string;
}

export function loadRhythmConfig(deps: LoadRhythmConfigDeps): RhythmConfig {
  const path = deps.path ?? defaultRhythmConfigPath();
  if (!deps.existsSync(path)) return emptyRhythmConfig();

  try {
    const parsed = JSON.parse(deps.readFileSync(path)) as Partial<RhythmConfig>;
    return {
      capabilities: parsed.capabilities ?? {},
      disabledMcpServers: parsed.disabledMcpServers ?? [],
      enabledSkills: parsed.enabledSkills ?? null,
    };
  } catch {
    return emptyRhythmConfig();
  }
}

export interface SaveRhythmConfigDeps {
  writeFileSync: (path: string, content: string) => void;
  path?: string;
}

export function saveRhythmConfig(config: RhythmConfig, deps: SaveRhythmConfigDeps): void {
  const path = deps.path ?? defaultRhythmConfigPath();
  deps.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

export function defaultLoadDeps(): Omit<LoadRhythmConfigDeps, 'path'> {
  return { existsSync: nodeExistsSync, readFileSync: (p: string) => nodeReadFileSync(p, 'utf8') };
}

export function defaultSaveDeps(): Omit<SaveRhythmConfigDeps, 'path'> {
  return {
    writeFileSync: (p: string, c: string) => {
      // A truly fresh machine may not have ~/.config/opencode/ yet (e.g. the
      // opencode engine has never run). Blank Slate mode must be usable as a
      // first-run experience, so create the parent directory on demand.
      nodeMkdirSync(dirname(p), { recursive: true });
      nodeWriteFileSync(p, c);
    },
  };
}
