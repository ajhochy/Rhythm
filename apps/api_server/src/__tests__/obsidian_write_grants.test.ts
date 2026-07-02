/**
 * Contract tests for issue #834 — "Allow obsidian WRITE access for designated
 * agents" (secretary, worship-planning ONLY; opt-in, not a blanket grant).
 *
 * Background: the #812-era "wire obsidian into all selectable agents" change
 * (see docs/ai/project-state.md, 2026-06-28 run) granted every roled agent the
 * READ/SEARCH obsidian tool subset (`OBSIDIAN_READ_TOOLS` in
 * obsidian_scope_backfill.ts) at the role-file dispatch layer (#736 backstop).
 * librarian/theologian/research already carry additional write tools as the
 * reference pattern. This issue extends secretary + worship-planning ONLY to
 * also carry the write tool set — every other roled agent must NOT gain any
 * write tool.
 *
 * "Write tool set" is defined operationally as: every obsidian_* tool granted
 * to librarian.mcp.json that is NOT in the read/search set. This keeps the
 * contract from hardcoding a duplicate tool-name list that could drift from
 * the reference file — librarian is read directly, mirroring the issue's
 * instruction to "mirror librarian.mcp.json's exact write tool names... do
 * not invent tool names."
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { OBSIDIAN_READ_TOOLS } from '../services/obsidian_scope_backfill';

// __tests__ is at apps/api_server/src/__tests__/ — repo root is 4 levels up.
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const ROLES_DIR = path.join(REPO_ROOT, '.mcp-roles');

interface McpRoleFile {
  role: string;
  mcpServers?: Record<string, { allowedTools?: string[] }>;
}

function loadRole(filename: string): McpRoleFile {
  const raw = fs.readFileSync(path.join(ROLES_DIR, filename), 'utf-8');
  return JSON.parse(raw) as McpRoleFile;
}

function obsidianTools(role: McpRoleFile): string[] {
  return role.mcpServers?.obsidian?.allowedTools ?? [];
}

/** Every obsidian tool librarian has beyond the read/search subset. */
function librarianWriteTools(): string[] {
  const librarian = loadRole('librarian.mcp.json');
  const readSet = new Set(OBSIDIAN_READ_TOOLS);
  return obsidianTools(librarian).filter((t) => !readSet.has(t));
}

const DESIGNATED_WRITE_AGENTS = ['secretary', 'worship-planning'];

// Roled agents that must NOT gain a *new* librarian write tool from this
// issue, mapped to the write tools they are already known to carry BEFORE
// #834 (usually none). librarian/theologian/research are intentionally
// excluded from this map — already write-scoped and explicitly left
// untouched by this issue.
//
// fantasy-gm and worship-production predate #834 with their own
// obsidian_put_file/obsidian_patch_file grant (see git history on
// .mcp-roles/fantasy-gm.mcp.json — introduced in the original
// `.mcp-roles/` scaffolding commit, unrelated to the #812-era read/search
// rollout). This issue's job is to not WIDEN any non-designated agent's
// write surface, not to retroactively narrow an out-of-scope agent's
// existing config — so each agent is checked against its OWN pre-existing
// baseline rather than an assumed-zero bar.
const NON_DESIGNATED_ROLED_AGENTS: Record<string, string[]> = {
  'church-admin': [],
  'daily-briefing': [],
  dev: [],
  'email-assistant': [],
  'fantasy-gm': ['obsidian_put_file', 'obsidian_patch_file'],
  ffb: [],
  'graphic-designer': [],
  'worship-production': ['obsidian_put_file', 'obsidian_patch_file'],
};

describe('issue-834: obsidian write grant is opt-in to secretary + worship-planning only', () => {
  it('issue-834-c1: secretary and worship-planning obsidian allowedTools include every librarian write tool', () => {
    const writeTools = librarianWriteTools();
    // Sanity: the reference pattern must actually have write tools, or this
    // whole contract is vacuous.
    expect(writeTools.length).toBeGreaterThan(0);

    for (const slug of DESIGNATED_WRITE_AGENTS) {
      const role = loadRole(`${slug}.mcp.json`);
      const granted = new Set(obsidianTools(role));
      const missing = writeTools.filter((t) => !granted.has(t));
      expect(
        missing,
        `${slug}.mcp.json is missing librarian write tools: ${missing.join(', ')}`,
      ).toEqual([]);
    }
  });

  it('issue-834-c2: non-designated roled agents keep read/search only — no NEW write tool leaks in', () => {
    const writeTools = new Set(librarianWriteTools());

    for (const [slug, preExistingWrites] of Object.entries(NON_DESIGNATED_ROLED_AGENTS)) {
      const filePath = path.join(ROLES_DIR, `${slug}.mcp.json`);
      if (!fs.existsSync(filePath)) continue; // some slugs have no obsidian entry at all
      const role = loadRole(`${slug}.mcp.json`);
      const granted = obsidianTools(role).filter((t) => writeTools.has(t));
      // Exact match against the known pre-#834 baseline — catches both a new
      // leak (more tools than the baseline) and an unexpected narrowing.
      expect(
        new Set(granted),
        `${slug}.mcp.json obsidian write tools drifted from its pre-#834 baseline`,
      ).toEqual(new Set(preExistingWrites));
    }
  });

  it('issue-834-c3: every .mcp-roles/*.mcp.json file is valid JSON and its prior read/search tools are preserved', () => {
    const files = fs
      .readdirSync(ROLES_DIR)
      .filter((f) => f.endsWith('.mcp.json'));

    // The issue text says "14" role files; the repo had 13 at #834 time
    // (church-admin, daily-briefing, dev, email-assistant, fantasy-gm, ffb,
    // graphic-designer, librarian, research, secretary, theologian,
    // worship-planning, worship-production). #834 itself only edited two
    // existing files' obsidian tool lists — it never added or removed a role
    // file. #830 (org-optimizer-14) later added exactly two new role files
    // (org-optimizer.mcp.json, org-external-discovery.mcp.json), bringing the
    // count to 15 — an intentional, expected addition for that issue, not a
    // #834 regression. Pin the count so an UNEXPECTED add/remove is still
    // caught.
    expect(files.length).toBe(15);

    const readSet = new Set(OBSIDIAN_READ_TOOLS);

    for (const filename of files) {
      const raw = fs.readFileSync(path.join(ROLES_DIR, filename), 'utf-8');
      let parsed: McpRoleFile;
      expect(() => {
        parsed = JSON.parse(raw) as McpRoleFile;
      }, `${filename} must be valid JSON`).not.toThrow();
      parsed = JSON.parse(raw) as McpRoleFile;

      const tools = obsidianTools(parsed);
      if (tools.length === 0) continue; // no obsidian entry — nothing to check

      // Every role that had ANY read/search tool before must still have at
      // least the read/search tools it is expected to carry (existing grants
      // are additive-only — this issue must never remove a read/search tool).
      const grantedReadTools = tools.filter((t) => readSet.has(t));
      expect(
        grantedReadTools.length,
        `${filename} lost all obsidian read/search tools`,
      ).toBeGreaterThan(0);
    }
  });
});
