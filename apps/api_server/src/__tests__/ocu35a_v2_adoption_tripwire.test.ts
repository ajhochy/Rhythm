import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');
const sessionPath = resolve(
  repoRoot,
  'apps/opencode_fork/packages/opencode/src/v2/session.ts',
);
const groupsPath = resolve(
  repoRoot,
  'apps/opencode_fork/packages/opencode/src/server/routes/instance/httpapi/groups/v2.ts',
);
const auditMessage =
  'OpenCode v2 lifecycle changed: re-run the #1176 audit and update the compatibility matrix';

function auditedSessionSource(): string {
  const source = readFileSync(sessionPath, 'utf8');
  if (process.env.OCU35A_SIMULATE_REAL_CREATE !== '1') return source;
  // Fixture copy for proving the tripwire goes RED when create becomes real.
  return source.replace(
    'return {} as any',
    'return fromRow(Database.use((db) => db.insert(SessionTable).values(_input).returning().get()))',
  );
}

function implementation(source: string, operation: string): string {
  return source.match(
    new RegExp(
      `${operation}: Effect\\.fn\\("V2Session\\.${operation}"\\)\\(function\\* \\([^)]*\\) \\{[\\s\\S]*?\\n      \\}\\),`,
    ),
  )?.[0] ?? '';
}

describe('#1176 OpenCode v2 adoption tripwire', () => {
  it('keeps adoption blocked until every audited lifecycle placeholder changes together', () => {
    const source = auditedSessionSource();
    const groups = readFileSync(groupsPath, 'utf8');

    expect(implementation(source, 'create'), auditMessage).toMatch(/return \{\} as any/);
    expect(implementation(source, 'prompt'), auditMessage).toMatch(/return \{\} as any/);
    for (const operation of ['shell', 'compact', 'wait']) {
      expect(source, auditMessage).toMatch(
        new RegExp(`${operation}: Effect\\.fn\\("V2Session\\.${operation}"\\)\\(function\\* \\([^)]*\\) \\{\\}\\)`),
      );
    }
    expect(source, auditMessage).not.toMatch(/readonly abort\b|\babort:\s*Effect\.fn/);
    expect(groups, auditMessage).not.toMatch(/EventGroup|\.add\([^)]*Event/);
  });
});
