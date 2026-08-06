/**
 * Contract for per-item salvage of flagged first-party LIST payloads.
 *
 * Measured 2026-08-04 against the live agent server: `rhythm_list_memories`
 * returned 50 rows, exactly 2 of which mentioned `.env` (pattern
 * `secrets-dotenv`). The all-or-nothing scanner withheld all 50, so the Memory
 * Consolidation agent read nothing and reported "captured: 0" while the run was
 * recorded as a success.
 *
 * Safety property under test: flagged bytes still never reach the model. Only
 * the collateral is removed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanContextContentAndRecordExternalContentTaint } from '../security/external_content_boundary.js';
import { UNTRUSTED_FENCE_OPEN } from '../untrusted_context.js';

const CONTEXT = {
  sdkSessionId: 'sdk-1',
  turnId: 'turn-1',
  agentName: 'librarian',
  toolCallId: 'call-1',
} as never;

// `secrets-dotenv` requires a FILE-looking `.env` reference (not `process.env.X`).
const POISON = 'see the .env file for the key';

function noNetwork() {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith('/agent-approvals/external-content/taint')) {
      return new Response(JSON.stringify({ taintId: 't1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

function memoriesPayload(total: number, poisoned: number) {
  return JSON.stringify({
    memories: Array.from({ length: total }, (_, i) => ({
      id: `mem-${i}`,
      text: i < poisoned ? POISON : `benign note ${i}`,
    })),
  });
}

async function readFirstParty(rawContent: string) {
  vi.stubGlobal('fetch', noNetwork());
  return scanContextContentAndRecordExternalContentTaint({
    agentUrl: 'http://agent',
    context: CONTEXT,
    source: 'memory.list',
    label: 'user-authored agent memories',
    rawContent,
  });
}

describe('per-item salvage for first-party list payloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the exact live case: 2 poisoned of 50 no longer withholds all 50', async () => {
    const res = await readFirstParty(memoriesPayload(50, 2));

    expect(res.blocked).toBe(false);
    expect(res.text).toContain(UNTRUSTED_FENCE_OPEN);
    // The 48 benign rows are present.
    expect(res.text).toContain('benign note 49');
    expect(res.text).toContain('mem-49');
    // The 2 flagged rows are NOT — this is the safety property.
    // Quoted so `mem-1` does not accidentally match `mem-10`..`mem-19`.
    expect(res.text).not.toContain(POISON);
    expect(res.text).not.toContain('"mem-0"');
    expect(res.text).not.toContain('"mem-1"');
    // And the partial view is declared.
    expect(res.text).toContain('2 of 50');
    expect(res.text).toContain('withheld');
  });

  it('a fully clean payload is returned verbatim with no note', async () => {
    const res = await readFirstParty(memoriesPayload(5, 0));
    expect(res.blocked).toBe(false);
    expect(res.text).toContain('benign note 0');
    expect(res.text).not.toContain('withheld');
  });

  it('still blocks when EVERY item is flagged (nothing to salvage)', async () => {
    const res = await readFirstParty(memoriesPayload(4, 4));
    expect(res.blocked).toBe(true);
    expect(res.text).toContain('[BLOCKED:');
    expect(res.text).not.toContain(POISON);
  });

  it('salvages a bare top-level array too', async () => {
    const res = await readFirstParty(
      JSON.stringify([
        { id: 'a', text: POISON },
        { id: 'b', text: 'fine' },
      ]),
    );
    expect(res.blocked).toBe(false);
    expect(res.text).toContain('"b"');
    expect(res.text).not.toContain(POISON);
    expect(res.text).toContain('1 of 2');
  });

  it('falls back to blocking when the payload is not list-shaped', async () => {
    const res = await readFirstParty(JSON.stringify({ note: POISON }));
    expect(res.blocked).toBe(true);
    expect(res.text).toContain('[BLOCKED:');
  });

  it('falls back to blocking when the payload is not JSON', async () => {
    const res = await readFirstParty(`plain text mentioning ${POISON}`);
    expect(res.blocked).toBe(true);
    expect(res.text).toContain('[BLOCKED:');
  });

  it('falls back to blocking on an ambiguous multi-array object', async () => {
    const res = await readFirstParty(
      JSON.stringify({ a: [{ t: POISON }], b: [{ t: 'fine' }] }),
    );
    expect(res.blocked).toBe(true);
  });

  it('does NOT salvage genuinely external list payloads', async () => {
    // Third-party batches stay all-or-nothing — an attack can be split across
    // rows, and the taint record already asserted blocked for the whole payload.
    vi.stubGlobal('fetch', noNetwork());
    const res = await scanContextContentAndRecordExternalContentTaint({
      agentUrl: 'http://agent',
      context: CONTEXT,
      source: 'gmail.search',
      label: 'gmail search results',
      rawContent: JSON.stringify({
        messages: [
          { id: 'm1', body: POISON },
          { id: 'm2', body: 'benign' },
        ],
      }),
    });
    expect(res.blocked).toBe(true);
    expect(res.text).toContain('[BLOCKED:');
  });

  it('preserves sibling envelope keys when salvaging', async () => {
    const res = await readFirstParty(
      JSON.stringify({
        total: 3,
        memories: [
          { id: 'a', text: POISON },
          { id: 'b', text: 'fine' },
          { id: 'c', text: 'also fine' },
        ],
      }),
    );
    expect(res.blocked).toBe(false);
    expect(res.text).toContain('"total": 3');
    expect(res.text).toContain('"c"');
    expect(res.text).not.toContain(POISON);
  });
});
