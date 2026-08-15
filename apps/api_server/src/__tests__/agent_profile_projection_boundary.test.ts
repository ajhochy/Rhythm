/**
 * W1 package C — the projection boundary must be the ONLY way a profile
 * reaches disk.
 *
 * `writeAgentProfileFile` takes a complete config row. Any caller holding such
 * a row across an await has a possibly-stale copy, and writing it silently
 * overwrites a newer operator edit in the file the OpenCode engine loads.
 * `projectLatestAgentProfile` exists precisely so callers state an INTENT
 * (profile id + the revision they believe they are projecting) and the
 * boundary re-reads the latest row itself.
 *
 * The guard is on the IMPORT, not on the call form. A first version matched
 * the call token and 5 of 8 evasions walked through it — an alias import, an
 * indirect binding, a destructured dynamic import, a re-export hop and a
 * namespace alias. A module that never imports the renderer cannot call it by
 * any name, so that is the property worth enforcing. The evasion table below
 * pins it, because a guard nobody has attacked is not a guard.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/** Files allowed to reach the low-level renderer directly. */
const ALLOWED = new Set([
  // The renderer itself.
  join(SRC, 'services', 'opencode_agent_writer.ts'),
  // The boundary — the one legitimate caller.
  join(SRC, 'services', 'agent_profile_projection_service.ts'),
]);

const RENDERER = /\bwriteAgentProfileFile\b|\bsyncAgentProfileFileForState\b/;

/**
 * Every way a module can get hold of the renderer, reported as a list of
 * reasons. Empty means the module provably cannot reach it.
 */
export function rendererAccessReasons(source: string): string[] {
  const reasons: string[] = [];

  const staticImports = source.matchAll(
    /import\s+([\s\S]*?)\s+from\s+['"][^'"]*opencode_agent_writer['"]/g,
  );
  for (const match of staticImports) {
    const clause = match[1];
    if (/\*\s+as\s+/.test(clause)) reasons.push('namespace import');
    else if (RENDERER.test(clause)) reasons.push('named import');
  }

  // A bare dynamic import or require exposes the whole module, renderer
  // included — the destructuring that follows can rename it to anything.
  if (/import\s*\(\s*['"][^'"]*opencode_agent_writer['"]\s*\)/.test(source)) {
    reasons.push('dynamic import');
  }
  if (/require\s*\(\s*['"][^'"]*opencode_agent_writer['"]\s*\)/.test(source)) {
    reasons.push('require');
  }
  // A computed specifier hides the module name from every pattern above. Only
  // CODE counts here — several modules name the renderer in prose while doing
  // an unrelated dynamic import, and flagging those would make the guard noise.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const concatenated = code.replace(/['"`]\s*\+\s*['"`]/g, '');
  if (
    /import\s*\(|require\s*\(/.test(code) &&
    /opencode_agent_writer/.test(concatenated) &&
    !/['"][^'"]*opencode_agent_writer['"]/.test(code)
  ) {
    reasons.push('computed module specifier');
  }

  // A re-export hands the renderer to modules that never import it directly.
  if (/export\s+[\s\S]{0,200}?\bwriteAgentProfileFile\b[\s\S]{0,200}?from\s+['"]/.test(source)) {
    reasons.push('re-export');
  }
  // A barrel is the same hop with no token to match: `export * from '...'`
  // carries the renderer onward, and the consumer's specifier no longer names
  // the writer module at all, so BOTH halves of the guard would miss it.
  if (/export\s+\*\s+(?:as\s+\w+\s+)?from\s+['"][^'"]*opencode_agent_writer['"]/.test(source)) {
    reasons.push('barrel re-export');
  }

  // And the plain call, for a module that somehow has it in scope already.
  for (const raw of source.split('\n')) {
    const code = raw.replace(/^\s*(\/\/|\*).*$/, '');
    if (/\bwriteAgentProfileFile\s*\(/.test(code) || /\bsyncAgentProfileFileForState\s*\(/.test(code)) {
      reasons.push('direct call');
      break;
    }
  }

  return reasons;
}

function productionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'contract' || entry === 'node_modules') continue;
      productionFiles(full, out);
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || entry.endsWith('.d.ts')) continue;
    out.push(full);
  }
  return out;
}

describe('W1 package C: profile projection has exactly one boundary', () => {
  it.each([
    ['direct call', "import { writeAgentProfileFile } from './opencode_agent_writer';\nwriteAgentProfileFile(config);"],
    ['alias import', "import { writeAgentProfileFile as render } from './opencode_agent_writer';\nrender(config);"],
    ['indirect binding', "import { writeAgentProfileFile } from './opencode_agent_writer';\nconst r = writeAgentProfileFile;\nr(config);"],
    ['namespace alias', "import * as writer from './opencode_agent_writer';\nwriter.writeAgentProfileFile(config);"],
    ['dynamic import + rename', "const { writeAgentProfileFile: r } = await import('./opencode_agent_writer');\nr(config);"],
    ['require', "const w = require('./opencode_agent_writer');\nw.writeAgentProfileFile(config);"],
    ['re-export hop', "export { writeAgentProfileFile } from './opencode_agent_writer';"],
    ['state-aware alias', "import { syncAgentProfileFileForState as sync } from './opencode_agent_writer';\nsync(config);"],
    ['barrel re-export', "export * from './opencode_agent_writer';"],
    ['barrel namespace re-export', "export * as writer from './opencode_agent_writer';"],
    ['computed specifier', "const m = './opencode' + '_agent_writer';\nconst r = await import(m);\nr.writeAgentProfileFile(config);"],
  ])('detects the %s evasion', (_label, source) => {
    expect(rendererAccessReasons(source)).not.toEqual([]);
  });

  it('does not flag a module that only mentions the renderer in prose', () => {
    const source = [
      '// writeAgentProfileFile is the low-level renderer; go through the boundary.',
      "import { projectLatestAgentProfile } from './agent_profile_projection_service';",
      'projectLatestAgentProfile({ profileId: id, expectedRevision: 0, cause: "sync" });',
    ].join('\n');
    expect(rendererAccessReasons(source)).toEqual([]);
  });

  it('no production module can reach the low-level row writer', () => {
    const offenders: string[] = [];
    for (const file of productionFiles(SRC)) {
      if (ALLOWED.has(file)) continue;
      const reasons = rendererAccessReasons(readFileSync(file, 'utf8'));
      if (reasons.length > 0) {
        offenders.push(`${file.slice(SRC.length + 1)} (${[...new Set(reasons)].join(', ')})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
