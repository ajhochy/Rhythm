/**
 * Contract for SOURCES_EXEMPT_FROM_APPROVAL_GATE (#1302, widened 2026-08-04).
 *
 * The membership rule is "did this content arrive from OUTSIDE Rhythm?", not
 * "is this content sensitive?". Reading Rhythm's own database must not arm the
 * outbound-write approval gate; reading email/calendar/PCO/web must.
 *
 * Why this is load-bearing: with the gate armed by a first-party read, an
 * autonomous scheduled job could never write. Memory Consolidation reads
 * `memory.list` in order to consolidate, that read armed the gate, and the
 * `memory.remember` that followed then demanded a human at 02:30. Measured
 * 2026-08-04: it reported success having captured 0, for days.
 *
 * Both tables below are the contract. A source moving between them is a
 * deliberate security decision, not a refactor.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  scanContextContentAndRecordExternalContentTaint,
  type ExternalContentSource,
} from '../security/external_content_boundary.js';
import {
  UNTRUSTED_FENCE_CLOSE,
  UNTRUSTED_FENCE_OPEN,
} from '../untrusted_context.js';

const CONTEXT = {
  sdkSessionId: 'sdk-1',
  turnId: 'turn-1',
  agentName: 'librarian',
  toolCallId: 'call-1',
} as never;

/** Sources authored inside Rhythm — must NOT arm the gate. */
const FIRST_PARTY: ExternalContentSource[] = [
  'agent-session.list',
  'memory.list',
  'memory.search',
  'task.list',
  'scheduled-task.list',
  'rhythm.list',
  'project-template.list',
  'project-instance.list',
  'facility.list',
  'automation.list',
  'automation.get',
  'automation.preview',
  'automation-catalog.triggers',
  'automation-catalog.actions',
  'automation-catalog.providers',
  'agent-profile.permissions.list',
  'agent-profile.permissions.get',
];

/** Genuine third-party ingress — MUST keep arming the gate. */
const EXTERNAL: ExternalContentSource[] = [
  'gmail.search',
  'gmail.message',
  'calendar.events',
  'message-thread.list',
  'message-thread.task',
  'dashboard.message-preview',
  'trigger.list',
  'pco.plans',
  'pco.plan-items',
  'pco.service-types',
  'pco.needed-positions',
  'feedback.email-sent',
  'feedback.pco-staffing',
  'feedback.task-complete',
  // A research job's stored result is fetched web content — its own label
  // says "external research job result". It is deliberately NOT exempt.
  'research.job',
];

function taintSpy() {
  const taintCalls: string[] = [];
  const fn = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith('/agent-approvals/external-content/taint')) {
      taintCalls.push(url);
      return new Response(JSON.stringify({ taintId: 't1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return { fn, taintCalls };
}

describe('first-party sources are exempt from the outbound-write approval gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(FIRST_PARTY)('%s records NO taint', async (source) => {
    const { fn, taintCalls } = taintSpy();
    vi.stubGlobal('fetch', fn);

    const res = await scanContextContentAndRecordExternalContentTaint({
      agentUrl: 'http://agent',
      context: CONTEXT,
      source,
      label: 'first-party payload',
      rawContent: JSON.stringify({ items: [{ id: 1, note: 'benign' }] }),
    });

    expect(taintCalls).toHaveLength(0);
    expect(res.blocked).toBe(false);
    // Defense in depth is unchanged: still fenced as data, not instructions.
    expect(res.text).toContain(UNTRUSTED_FENCE_OPEN);
    expect(res.text).toContain(UNTRUSTED_FENCE_CLOSE);
  });

  it.each(EXTERNAL)('%s still records a taint', async (source) => {
    const { fn, taintCalls } = taintSpy();
    vi.stubGlobal('fetch', fn);

    const res = await scanContextContentAndRecordExternalContentTaint({
      agentUrl: 'http://agent',
      context: CONTEXT,
      source,
      label: 'external payload',
      rawContent: JSON.stringify({ items: [{ id: 1, note: 'benign' }] }),
    });

    expect(taintCalls).toHaveLength(1);
    expect(res.blocked).toBe(false);
    expect(res.text).toContain(UNTRUSTED_FENCE_OPEN);
  });

  it('the two tables are disjoint', () => {
    const overlap = FIRST_PARTY.filter((s) =>
      (EXTERNAL as string[]).includes(s),
    );
    expect(overlap).toEqual([]);
  });

  it('fails closed when trusted session metadata is missing', async () => {
    vi.stubGlobal('fetch', taintSpy().fn);
    await expect(
      scanContextContentAndRecordExternalContentTaint({
        agentUrl: 'http://agent',
        context: null,
        source: 'memory.list',
        label: 'first-party payload',
        rawContent: '{}',
      }),
    ).rejects.toThrow(/trusted Rhythm session\/turn metadata is unavailable/);
  });
});
