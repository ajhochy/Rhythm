import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { freshDayflowConfig, validateDayflowConfig } from './config_validation';
import type { DayflowConfig } from './types';

export class DayflowConfigStore {
  constructor(private readonly path?: string) {}
  read(): DayflowConfig {
    return this.readWithState().config;
  }
  readWithState(): { config: DayflowConfig; persisted: boolean } {
    if (!this.path || !existsSync(this.path)) {
      return { config: freshDayflowConfig(), persisted: false };
    }
    // Additive internal fields (such as the selected journal path) receive
    // safe defaults when reading a prior local config. Unknown fields still
    // fail closed in the shared validator.
    try { return { config: validateDayflowConfig(JSON.parse(readFileSync(this.path, 'utf8')), true), persisted: true }; }
    catch { throw new Error('Dayflow configuration is unreadable; import is blocked.'); }
  }
  write(config: DayflowConfig) {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.path);
    try { chmodSync(this.path, 0o600); } catch { /* non-posix */ }
  }
}
