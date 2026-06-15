/**
 * OPC-M4-1 — Real image/file attachments (FilePart with data URI).
 * Issue #700, criterion c1.
 *
 * c1a — `session.input` with a parts array containing a FilePart forwards
 *        the full parts array verbatim to promptAsync (data URI intact).
 * c1b — Legacy `data: string` path still works after the refactor (regression).
 * c1c — Oversized WS payload → clear error frame sent to client, not a
 *        silent drop. Test at the 20 MB limit boundary.
 *
 * Run with:
 *   cd apps/api_server && npx vitest run src/__tests__/opc_m4_1_file_attachments.test.ts
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import os from 'os';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// ---------------------------------------------------------------------------
// Shared mocks (hoisted so vi.mock factories can use them)
// ---------------------------------------------------------------------------

const {
  promptAsyncSpy,
  sessionMap,
  wsSendMock,
} = vi.hoisted(() => ({
  promptAsyncSpy: vi.fn().mockResolvedValue(true),
  sessionMap: new Map<string, string>(),
  wsSendMock: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    promptAsync: promptAsyncSpy,
    createSession: vi.fn().mockResolvedValue(null),
    getSession: vi.fn().mockResolvedValue(null),
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    dispatchCommand: vi.fn().mockResolvedValue(null),
  },
  opencodeSessionMap: sessionMap,
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: {
    streamSession: vi.fn(),
    stopStream: vi.fn(),
    clearErrorStatus: vi.fn(),
    getPendingPermission: vi.fn(),
    clearPendingPermission: vi.fn(),
  },
}));

vi.mock('./agent_model_resolver', () => ({
  resolveModelForSessionTurn: vi.fn().mockResolvedValue({
    providerID: 'anthropic',
    modelID: 'claude-sonnet-4-5',
  }),
}));

vi.mock('../services/agent_model_resolver', () => ({
  resolveModelForSessionTurn: vi.fn().mockResolvedValue({
    providerID: 'anthropic',
    modelID: 'claude-sonnet-4-5',
  }),
}));

// ---------------------------------------------------------------------------
// Import the handler under test (after mocks are set up)
// ---------------------------------------------------------------------------

import { handleInputFrame } from '../services/ws_gateway';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  return db;
}

function makeFakeWs() {
  return {
    send: wsSendMock,
    readyState: 1, /* OPEN */
  } as unknown as import('ws').WebSocket;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('issue-700-c1: session.input FilePart forwarding contracts', () => {
  let sessionsRepo: AgentSessionsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMap.clear();
    makeDb();
    sessionsRepo = new AgentSessionsRepository();
  });

  // ── c1a: FilePart forwarded verbatim ───────────────────────────────────────

  it('issue-700-c1a: session.input with FilePart forwards parts array verbatim to promptAsync', async () => {
    const sdkId = 'sdk-m4-1-abc';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'AttachmentTest',
    });
    sessionMap.set(session.id, sdkId);

    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const filePart = {
      type: 'file',
      mime: 'image/png',
      filename: 'fixture.png',
      url: dataUri,
    };

    const ws = makeFakeWs();
    await handleInputFrame(ws, {
      v: 1,
      type: 'session.input',
      id: session.id,
      parts: [
        { type: 'text', text: 'What is in this image?\n' },
        filePart,
      ],
    });

    // promptAsync must have been called
    expect(promptAsyncSpy).toHaveBeenCalledOnce();
    const [calledSdkId, calledText, , , , calledParts] = promptAsyncSpy.mock.calls[0] as [
      string,
      string,
      unknown,
      unknown,
      unknown,
      Array<Record<string, unknown>> | undefined,
    ];

    // The SDK session ID is correct
    expect(calledSdkId).toBe(sdkId);

    // Text argument carries the text part content
    expect(calledText).toContain('What is in this image?');

    // The parts array is forwarded verbatim including the FilePart
    expect(calledParts).toBeDefined();
    expect(Array.isArray(calledParts)).toBe(true);
    const fp = calledParts!.find((p) => p.type === 'file');
    expect(fp).toBeDefined();
    expect(fp!.url).toBe(dataUri);
    expect(fp!.mime).toBe('image/png');
    expect(fp!.filename).toBe('fixture.png');

    // No error frame sent
    const errorCalls = (wsSendMock as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => JSON.parse(c[0] as string) as { type: string })
      .filter((m) => m.type === 'error');
    expect(errorCalls).toHaveLength(0);
  });

  // ── c1b: legacy `data` path regression ────────────────────────────────────

  it('issue-700-c1b: session.input with legacy data string still calls promptAsync with the text', async () => {
    const sdkId = 'sdk-m4-1-legacy';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'LegacyTextTest',
    });
    sessionMap.set(session.id, sdkId);

    const ws = makeFakeWs();
    await handleInputFrame(ws, {
      v: 1,
      type: 'session.input',
      id: session.id,
      data: 'Hello from legacy path\n',
    });

    expect(promptAsyncSpy).toHaveBeenCalledOnce();
    const [calledSdkId, calledText] = promptAsyncSpy.mock.calls[0] as [string, string];
    expect(calledSdkId).toBe(sdkId);
    expect(calledText).toContain('Hello from legacy path');

    // No error frame
    const errorCalls = (wsSendMock as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => JSON.parse(c[0] as string) as { type: string })
      .filter((m) => m.type === 'error');
    expect(errorCalls).toHaveLength(0);
  });

  // ── c1c: oversized payload → clear error frame ────────────────────────────

  it('issue-700-c1c: oversized parts payload (>20MB data URI) sends clear error frame, not silent drop', async () => {
    const sdkId = 'sdk-m4-1-oversized';
    const session = sessionsRepo.insert({
      agentKind: 'claude-code',
      taskId: null,
      taskTitle: null,
      cwd: os.homedir(),
      name: 'OversizedTest',
    });
    sessionMap.set(session.id, sdkId);

    // Build a data URI that exceeds the 20 MB limit.
    // 20 MB = 20 * 1024 * 1024 bytes = 20971520 bytes.
    // Base64 overhead: each 3 bytes → 4 chars, so 20MB binary → ~27MB base64.
    // We use a string of repeated 'A' chars to simulate this cheaply.
    const kMaxBytes = 20 * 1024 * 1024;
    const oversizedBase64 = 'A'.repeat(kMaxBytes + 1);
    const oversizedUri = `data:image/png;base64,${oversizedBase64}`;

    const ws = makeFakeWs();
    await handleInputFrame(ws, {
      v: 1,
      type: 'session.input',
      id: session.id,
      parts: [
        { type: 'text', text: 'process this\n' },
        {
          type: 'file',
          mime: 'image/png',
          filename: 'huge.png',
          url: oversizedUri,
        },
      ],
    });

    // promptAsync must NOT have been called for oversized payload
    expect(promptAsyncSpy).not.toHaveBeenCalled();

    // An error frame must have been sent
    expect(wsSendMock).toHaveBeenCalledOnce();
    const sent = JSON.parse(
      (wsSendMock as ReturnType<typeof vi.fn>).mock.calls[0][0] as string,
    ) as { type: string; id: string; message: string };
    expect(sent.type).toBe('error');
    expect(sent.id).toBe(session.id);
    expect(sent.message).toMatch(/too large|size limit|exceeds/i);
  });
});
