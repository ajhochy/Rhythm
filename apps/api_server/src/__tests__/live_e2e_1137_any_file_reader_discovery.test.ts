/**
 * Live behavioral gate for #1137 — arbitrary local file reader discovery.
 *
 * This test drives the real Flutter entry shape through the running
 * api_server WebSocket and the standalone fork engine. It proves that an
 * unsupported binary is not rejected or forwarded to the model as opaque
 * bytes: native paths and browser data URLs both reach real Read, the
 * persisted user turn surfaces an actually-installed matching reader skill,
 * and traversal/symlink input is rejected before any prompt is sent.
 *
 * Run against an isolated sandbox built from this branch:
 *   RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:5098 \
 *   DB_PATH=/tmp/rhythm-dev-sandbox-1137/rhythm.db \
 *   npx vitest run src/__tests__/live_e2e_1137_any_file_reader_discovery.test.ts
 */
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:5098';
const describeLive = LIVE ? describe : describe.skip;

const createdAgentIds: string[] = [];
const createdSessionIds: string[] = [];
const scratchDirs: string[] = [];

interface StructuredMessage {
  role?: string;
  rawText?: string;
  parts?: unknown[];
}

interface DocxReaderProof {
  skillInputName: 'document-creation';
  bashCommand: string;
  assistantText: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function completedToolInput(
  part: unknown,
  tool: string,
): Record<string, unknown> | null {
  const partRecord = asRecord(part);
  if (partRecord?.type !== 'tool' || partRecord.tool !== tool) return null;
  const state = asRecord(partRecord.state);
  if (state?.status !== 'completed') return null;
  return asRecord(state.input);
}

function findDocxReaderProof(
  messages: StructuredMessage[],
  marker: string,
): DocxReaderProof | null {
  let skillInputName: 'document-creation' | null = null;
  let bashCommand: string | null = null;
  let bashMessageIndex = -1;

  for (const [messageIndex, message] of messages.entries()) {
    if (message.role !== 'output') continue;

    for (const part of message.parts ?? []) {
      const skillInput = completedToolInput(part, 'skill');
      if (skillInputName === null && skillInput?.name === 'document-creation') {
        skillInputName = 'document-creation';
        continue;
      }

      const bashInput = completedToolInput(part, 'bash');
      const command = bashInput?.command;
      if (
        skillInputName !== null &&
        bashCommand === null &&
        typeof command === 'string' &&
        command.includes('read_office_docs.py')
      ) {
        bashCommand = command;
        bashMessageIndex = messageIndex;
      }
    }

    if (
      skillInputName !== null &&
      bashCommand !== null &&
      messageIndex > bashMessageIndex &&
      message.rawText?.includes(marker)
    ) {
      return {
        skillInputName,
        bashCommand,
        assistantText: message.rawText,
      };
    }
  }

  return null;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function poll<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  intervalMs = 400,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
    }
  }
  throw new Error(`poll timed out after ${timeoutMs}ms; last=${String(lastError)}`);
}

async function openWs(): Promise<WebSocket> {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/agents');
  await new Promise<void>((resolvePromise, reject) => {
    ws.once('open', resolvePromise);
    ws.once('error', reject);
  });
  return ws;
}

function createMinimalDocx(root: string, marker: string): string {
  const source = resolve(root, 'docx-source');
  const output = resolve(root, 'reader-proof.docx');
  mkdirSync(resolve(source, '_rels'), { recursive: true });
  mkdirSync(resolve(source, 'word'), { recursive: true });
  writeFileSync(
    resolve(source, '[Content_Types].xml'),
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '</Types>',
    ].join(''),
  );
  writeFileSync(
    resolve(source, '_rels/.rels'),
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
      '</Relationships>',
    ].join(''),
  );
  writeFileSync(
    resolve(source, 'word/document.xml'),
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      `<w:body><w:p><w:r><w:t>${marker}</w:t></w:r></w:p><w:sectPr/></w:body>`,
      '</w:document>',
    ].join(''),
  );
  execFileSync('zip', ['-q', '-r', output, '.'], { cwd: source });
  return output;
}

describe('issue #1137 structured DOCX reader proof', () => {
  const marker = 'DOCX_READER_PROOF_STRUCTURED';

  it('rejects serialized mentions without completed skill and bash tool parts', () => {
    expect(
      findDocxReaderProof(
        [
          {
            role: 'output',
            rawText: [
              'I should call document-creation and read_office_docs.py.',
              marker,
            ].join(' '),
            parts: [
              {
                type: 'text',
                text: 'document-creation read_office_docs.py',
              },
            ],
          },
        ],
        marker,
      ),
    ).toBeNull();
  });

  it('requires completed exact tool inputs before the assistant marker', () => {
    const valid: StructuredMessage[] = [
      {
        role: 'output',
        parts: [
          {
            type: 'tool',
            tool: 'skill',
            state: {
              status: 'completed',
              input: { name: 'document-creation' },
            },
          },
        ],
      },
      {
        role: 'output',
        parts: [
          {
            type: 'tool',
            tool: 'bash',
            state: {
              status: 'completed',
              input: {
                command:
                  '/opt/rhythm/python /opt/rhythm/scripts/read_office_docs.py reader-proof.docx',
              },
            },
          },
        ],
      },
      {
        role: 'output',
        rawText: marker,
        parts: [{ type: 'text', text: marker }],
      },
    ];

    expect(findDocxReaderProof(valid, marker)).toEqual({
      skillInputName: 'document-creation',
      bashCommand:
        '/opt/rhythm/python /opt/rhythm/scripts/read_office_docs.py reader-proof.docx',
      assistantText: marker,
    });

    const markerBeforeTools = [valid[2], valid[0], valid[1]];
    expect(findDocxReaderProof(markerBeforeTools, marker)).toBeNull();

    const runningBash = structuredClone(valid);
    (
      runningBash[1].parts?.[0] as {
        state: { status: string };
      }
    ).state.status = 'running';
    expect(findDocxReaderProof(runningBash, marker)).toBeNull();

    const wrongSkill = structuredClone(valid);
    (
      wrongSkill[0].parts?.[0] as {
        state: { input: { name: string } };
      }
    ).state.input.name = 'document-creation-mentioned';
    expect(findDocxReaderProof(wrongSkill, marker)).toBeNull();
  });
});

afterEach(async () => {
  for (const id of createdSessionIds.splice(0)) {
    await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => undefined);
  }
  for (const id of createdAgentIds.splice(0)) {
    await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describeLive('live E2E — #1137 arbitrary file reader discovery', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    if (BASE.includes(':4001') || BASE.includes(':4096')) {
      throw new Error('refusing to run #1137 against the installed app; use an isolated sandbox');
    }
    const health = await api('/health');
    if (!health.ok) throw new Error(`sandbox server is not reachable at ${BASE}`);
    const engine = await apiJson<{ status: string }>('/opencode/health');
    if (engine.status !== 'ready') throw new Error(`fork engine is not ready: ${engine.status}`);
  });

  it(
    'consumes native/browser binaries, surfaces an installed reader, and rejects a symlink escape before prompt',
    async () => {
      const suffix = randomUUID().slice(0, 8);
      const agentId = `live1137reader${suffix}`;
      const agent = await apiJson<{ id: string }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          id: agentId,
          label: `Live 1137 reader ${suffix}`,
          isAgent: true,
          modelProvider: process.env.RHYTHM_LIVE_MODEL_PROVIDER || 'google',
          modelId: process.env.RHYTHM_LIVE_MODEL_ID || 'gemini-2.5-pro',
          systemPrompt: 'Follow attachment reader discovery instructions before answering.',
        }),
      });
      createdAgentIds.push(agent.id);

      const cwd = mkdtempSync(join(tmpdir(), 'rhythm-live-1137-'));
      scratchDirs.push(cwd);
      const fixture = resolve(cwd, 'fixture.rhythmfixture');
      writeFileSync(fixture, Buffer.from([0x00, 0xff, 0x52, 0x48, 0x59, 0x54, 0x48, 0x4d]));
      const skillDir = resolve(cwd, '.opencode/skills/rhythmfixture-reader');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        resolve(skillDir, 'SKILL.md'),
        [
          '---',
          'name: rhythmfixture-reader',
          'description: Reads and validates .rhythmfixture binary attachments.',
          '---',
          'Use the bundled reader for .rhythmfixture files.',
        ].join('\n'),
      );
      const outside = mkdtempSync(join(tmpdir(), 'rhythm-live-1137-outside-'));
      scratchDirs.push(outside);
      writeFileSync(resolve(outside, 'secret.rhythmfixture'), Buffer.from([0x00, 0xff, 0x01, 0x02]));
      symlinkSync(outside, resolve(cwd, 'escape'));

      const session = await apiJson<{ id: string }>('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({
          agentId,
          name: `Live 1137 reader ${suffix}`,
          cwd,
        }),
      });
      createdSessionIds.push(session.id);

      const escaped = await api(
        `/agent-sessions/${session.id}/files/content?path=${encodeURIComponent('escape/secret.rhythmfixture')}`,
      );
      expect(escaped.status).toBe(400);

      const ws = await openWs();
      try {
        ws.send(
          JSON.stringify({
            v: 1,
            type: 'session.input',
            id: session.id,
            parts: [
              { type: 'text', text: 'Inspect the attached file and report what reader you use.' },
              {
                type: 'file',
                mime: 'application/x-rhythm-fixture',
                filename: 'fixture.rhythmfixture',
                url: pathToFileURL(fixture).href,
              },
              {
                type: 'file',
                mime: 'application/x-rhythm-fixture',
                filename: 'browser-fixture.rhythmfixture',
                url: 'data:application/x-rhythm-fixture;base64,AP9SSFlUSE0=',
              },
            ],
          }),
        );

        const transcript = await poll(async () => {
          const snapshot = await apiJson<{ messages: unknown[] }>(`/agent-sessions/${session.id}`);
          const serialized = JSON.stringify(snapshot.messages);
          if (!serialized.includes('Attachment reader discovery required')) {
            throw new Error('reader-discovery task has not reached the persisted transcript');
          }
          return serialized;
        }, 60_000);

        expect(transcript).toContain(fixture);
        expect(transcript).toContain('application/x-rhythm-fixture');
        expect(transcript).toContain('.rhythmfixture');
        expect(transcript).toContain('available skills');
        expect(transcript).toContain('available MCP tools and servers');
        expect(transcript).toContain('web search');
        expect(transcript).toContain('Do not ignore or reject this attachment');
        expect(transcript).toContain('Compatible skills already available');
        expect(transcript).toContain('rhythmfixture-reader');
        expect(transcript).toContain('Reads and validates .rhythmfixture');
        expect(transcript).toContain('browser-fixture.rhythmfixture');
      } finally {
        ws.close();
      }
    },
    90_000,
  );

  it(
    'extracts a known marker from a valid DOCX through the existing document reader',
    async () => {
      const suffix = randomUUID().slice(0, 8);
      const marker = `DOCX_READER_PROOF_${randomUUID().replaceAll('-', '')}`;
      const cwd = mkdtempSync(join(tmpdir(), 'rhythm-live-1137-docx-'));
      scratchDirs.push(cwd);
      const docx = createMinimalDocx(cwd, marker);
      const agentId = `live1137docx${suffix}`;
      const agent = await apiJson<{ id: string }>('/agent-configs', {
        method: 'POST',
        body: JSON.stringify({
          id: agentId,
          label: `Live 1137 DOCX reader ${suffix}`,
          isAgent: true,
          modelProvider: process.env.RHYTHM_LIVE_MODEL_PROVIDER || 'google',
          modelId: process.env.RHYTHM_LIVE_MODEL_ID || 'gemini-2.5-pro',
          allowedSkillsJson: JSON.stringify(['document-creation']),
          corePermissionsJson: JSON.stringify({
            bash: 'allow',
            read: 'allow',
            skill: 'allow',
          }),
          systemPrompt: [
            'When a DOCX is attached, invoke the installed document-creation skill.',
            'Use its existing scripts/read_office_docs.py reader with its pinned Python environment.',
            'Do not inspect ZIP/XML directly and do not guess.',
            'Reply with only the exact text extracted by that reader.',
          ].join(' '),
        }),
      });
      createdAgentIds.push(agent.id);
      const session = await apiJson<{ id: string }>('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({
          agentId,
          name: `Live 1137 DOCX ${suffix}`,
          cwd,
        }),
      });
      createdSessionIds.push(session.id);

      const ws = await openWs();
      try {
        ws.send(
          JSON.stringify({
            v: 1,
            type: 'session.input',
            id: session.id,
            parts: [
              {
                type: 'text',
                text: 'Use the existing document skill and reader to extract this DOCX. Return only its exact body text.',
              },
              {
                type: 'file',
                mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                filename: 'reader-proof.docx',
                url: pathToFileURL(docx).href,
              },
            ],
          }),
        );

        const proof = await poll(async () => {
          const snapshot = await apiJson<{
            messages: StructuredMessage[];
          }>(`/agent-sessions/${session.id}`);
          const structuredProof = findDocxReaderProof(snapshot.messages, marker);
          if (!structuredProof) {
            throw new Error(
              'completed document skill + reader command + later assistant marker not yet present',
            );
          }
          return structuredProof;
        }, 120_000);

        expect(proof.skillInputName).toBe('document-creation');
        expect(proof.bashCommand).toContain('read_office_docs.py');
        expect(proof.assistantText).toContain(marker);
      } finally {
        ws.close();
      }
    },
    150_000,
  );
});
