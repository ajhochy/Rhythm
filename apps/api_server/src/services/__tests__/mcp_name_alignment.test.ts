/**
 * #789 (mcp-unify-05; subsumes #781) — name-drift reconciliation for the
 * pure MCP name alignment helper.
 *
 * The helper resolves a *candidate* MCP server name (a derived/default name, or
 * a user-entered one) against the LIVE engine id set (the names from
 * `GET /opencode/mcp` / `listMcp()`). It is the single documented place where
 * the hyphen/underscore + `-mcp` display-vs-id drift (#781) is reconciled:
 *
 *   exact match  →  the live id unchanged
 *   else canonical match (lowercase, strip [-_] separators, drop a trailing
 *        "mcp" token) → the matching live id
 *   ambiguous (canonical matches >1 live id) → unresolved (do NOT guess)
 *   no match → unresolved (surfaced as stale; never invented into a real scope)
 *
 * Pure data: no I/O, no DB, no HTTP — mirrors mcp_allowlist_expander.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  alignMcpName,
  normalizeDerivedAllowedMcps,
} from '../mcp_name_alignment';

const LIVE = new Set(['rhythm', 'ableton-mcp', 'nfl_mcp']);

describe('alignMcpName — single-name resolution (#789 / #781)', () => {
  it('AC#1a: exact live id resolves to itself', () => {
    expect(alignMcpName('rhythm', LIVE)).toEqual({
      resolved: 'rhythm',
      matched: true,
    });
  });

  it('AC#1a: stale display name `ableton` resolves to live id `ableton-mcp`', () => {
    expect(alignMcpName('ableton', LIVE)).toEqual({
      resolved: 'ableton-mcp',
      matched: true,
    });
  });

  it('AC#1b: `nfl-mcp` (hyphen) resolves to live id `nfl_mcp` (underscore)', () => {
    expect(alignMcpName('nfl-mcp', LIVE)).toEqual({
      resolved: 'nfl_mcp',
      matched: true,
    });
  });

  it('AC#3 boundary: `foo` matches no live id and stays unresolved', () => {
    expect(alignMcpName('foo', LIVE)).toEqual({
      resolved: 'foo',
      matched: false,
    });
  });

  it('exact match wins over canonical normalization', () => {
    // Both `nfl_mcp` and a hypothetical `nfl-mcp` could canonicalize the same,
    // but an exact live id must always return itself unchanged.
    expect(alignMcpName('nfl_mcp', LIVE)).toEqual({
      resolved: 'nfl_mcp',
      matched: true,
    });
  });

  it('ambiguous canonical match does NOT guess (left unresolved)', () => {
    // Two live ids canonicalize to the same form — the helper must refuse to
    // pick one and leave the candidate unresolved.
    const ambiguous = new Set(['ableton', 'ableton-mcp']);
    expect(alignMcpName('ableton_mcp', ambiguous)).toEqual({
      resolved: 'ableton_mcp',
      matched: false,
    });
  });

  it('empty live set: nothing resolves (engine unavailable — never invent)', () => {
    expect(alignMcpName('ableton', new Set())).toEqual({
      resolved: 'ableton',
      matched: false,
    });
  });
});

describe('normalizeDerivedAllowedMcps — derived/default JSON normalization (#789)', () => {
  it('AC#1: normalizes a derived array to live ids before use', () => {
    const out = normalizeDerivedAllowedMcps(
      JSON.stringify(['ableton', 'nfl-mcp', 'rhythm']),
      LIVE,
    );
    // ableton → ableton-mcp, nfl-mcp → nfl_mcp, rhythm exact.
    expect(JSON.parse(out!) as string[]).toEqual([
      'ableton-mcp',
      'nfl_mcp',
      'rhythm',
    ]);
  });

  it('AC#3: a derived `foo` is dropped — never normalized into a real scope', () => {
    const out = normalizeDerivedAllowedMcps(
      JSON.stringify(['rhythm', 'foo']),
      LIVE,
    );
    expect(JSON.parse(out!) as string[]).toEqual(['rhythm']);
  });

  it('the importer default `["rhythm"]` is unchanged (rhythm is a live id)', () => {
    const out = normalizeDerivedAllowedMcps(JSON.stringify(['rhythm']), LIVE);
    expect(JSON.parse(out!) as string[]).toEqual(['rhythm']);
  });

  it('empty live set: derived JSON passes through untouched (fail-safe)', () => {
    const input = JSON.stringify(['ableton', 'rhythm']);
    expect(normalizeDerivedAllowedMcps(input, new Set())).toBe(input);
  });

  it('null input → null (fail-open, unchanged)', () => {
    expect(normalizeDerivedAllowedMcps(null, LIVE)).toBeNull();
  });

  it('invalid JSON → returned unchanged (never crash scoping)', () => {
    expect(normalizeDerivedAllowedMcps('{not json', LIVE)).toBe('{not json');
  });

  it('all-derived-names-dead collapses to an empty array (not null)', () => {
    // Distinct from the skill path: an empty MCP scope is a valid #765 scope
    // (scopes to nothing). We only drop dead derived names; we do not fail-open.
    const out = normalizeDerivedAllowedMcps(JSON.stringify(['foo']), LIVE);
    expect(JSON.parse(out!) as string[]).toEqual([]);
  });

  it('de-duplicates after normalization (ableton + ableton-mcp → one id)', () => {
    const out = normalizeDerivedAllowedMcps(
      JSON.stringify(['ableton', 'ableton-mcp']),
      LIVE,
    );
    expect(JSON.parse(out!) as string[]).toEqual(['ableton-mcp']);
  });
});
