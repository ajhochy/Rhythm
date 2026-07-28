import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import {
  installHumanApprovalTestCredentials,
  signHumanApprovalDecision,
} from './helpers/human_approval_test_credentials';

// RHYTHM_LIVE_E2E=1 drives the real built API. It proves IPv4 127.0.0.1
// succeeds while IPv6 ::1 and a networkInterfaces non-loopback address fail.
const runLive = process.env.RHYTHM_LIVE_E2E === '1' ? describe : describe.skip;
const forbiddenPorts = new Set([4001, 4096, 4097, 4098]);
const protectedPorts = [...forbiddenPorts];
const publicGeneratorPoint =
  'BGsX0fLhLEJH+Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT+NC4v4af5uO5+tKfA+eFivOM1drMV7Oy7ZAaDe/UfU=';

function listenersOnProtectedPorts(): Record<string, string[]> {
  return Object.fromEntries(
    protectedPorts.map((port) => {
      try {
        const output = execFileSync(
          '/usr/sbin/lsof',
          ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
          { encoding: 'utf8' },
        );
        return [
          String(port),
          output
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .sort(),
        ];
      } catch {
        return [String(port), []];
      }
    }),
  );
}

async function unusedPort(): Promise<number> {
  while (true) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          server.close();
          reject(new Error('ephemeral listener has no numeric port'));
          return;
        }
        server.close((error) =>
          error ? reject(error) : resolve(address.port),
        );
      });
    });
    if (!forbiddenPorts.has(port)) return port;
  }
}

async function cannotFetch(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    await fetch(url, { signal: controller.signal });
    return false;
  } catch {
    return true;
  } finally {
    clearTimeout(timeout);
  }
}

function nonLoopbackIpv4(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address;
      }
    }
  }
  // TEST-NET-1 is never assigned locally, which still proves the listener
  // cannot be reached through a non-loopback destination on a networkless CI.
  return '192.0.2.1';
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
        resolve();
      }, 5_000),
    ),
  ]);
}

runLive('#1175 AGENT_LOCAL primary listener', () => {
  const children: ChildProcessWithoutNullStreams[] = [];
  const tempPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(children.map(stopChild));
    for (const tempPath of tempPaths) {
      rmSync(tempPath, { recursive: true, force: true });
    }
  });

  it('binds only IPv4 loopback and leaves foreign protected listeners untouched', async () => {
    const serverEntry = join(__dirname, '..', '..', 'dist', 'server.js');
    if (!existsSync(serverEntry)) {
      throw new Error('Build apps/api_server before RHYTHM_LIVE_E2E=1');
    }
    const protectedBefore = listenersOnProtectedPorts();
    const port = await unusedPort();
    const stateDir = mkdtempSync(join(tmpdir(), 'rhythm-1175-listener-'));
    tempPaths.push(stateDir);

    const child = spawn(process.execPath, [
      serverEntry,
      `--parent-pid=${process.pid}`,
    ], {
      cwd: join(__dirname, '..', '..'),
      env: {
        ...process.env,
        PORT: String(port),
        API_BIND_HOST: '127.0.0.1',
        AGENT_LOCAL: 'true',
        RHYTHM_ROLE: 'cloud',
        DB_CLIENT: 'sqlite',
        DB_PATH: join(stateDir, 'rhythm.db'),
        MEMORY_VAULT_PATH: join(stateDir, 'memory'),
        HUMAN_APPROVAL_CAPABILITY_SHA256: '0'.repeat(64),
        HUMAN_APPROVAL_PUBLIC_KEY: publicGeneratorPoint,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(child);

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });

    const ipv4Url = `http://127.0.0.1:${port}/health`;
    let response: Response | null = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) {
        throw new Error(`built API exited before ready:\n${output}`);
      }
      try {
        response = await fetch(ipv4Url);
        if (response.ok) break;
      } catch {
        // Startup still in progress.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(response?.status, output).toBe(200);
    expect(await cannotFetch(`http://[::1]:${port}/health`)).toBe(true);
    expect(
      await cannotFetch(`http://${nonLoopbackIpv4()}:${port}/health`),
    ).toBe(true);

    await stopChild(child);
    expect(listenersOnProtectedPorts()).toEqual(protectedBefore);
  });

  it('refuses a non-loopback bind override before opening a listener', async () => {
    const serverEntry = join(__dirname, '..', '..', 'dist', 'server.js');
    const port = await unusedPort();
    const stateDir = mkdtempSync(join(tmpdir(), 'rhythm-1175-refusal-'));
    tempPaths.push(stateDir);
    const child = spawn(process.execPath, [serverEntry], {
      cwd: join(__dirname, '..', '..'),
      env: {
        ...process.env,
        PORT: String(port),
        API_BIND_HOST: '0.0.0.0',
        AGENT_LOCAL: 'true',
        RHYTHM_ROLE: 'cloud',
        DB_CLIENT: 'sqlite',
        DB_PATH: join(stateDir, 'rhythm.db'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(child);
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    const exitCode = await new Promise<number | null>((resolve) =>
      child.once('exit', (code) => resolve(code)),
    );
    expect(exitCode).not.toBe(0);
    expect(output).toMatch(/AGENT_LOCAL.*127\.0\.0\.1|non-loopback/i);
    expect(await cannotFetch(`http://127.0.0.1:${port}/health`)).toBe(true);
  });

  it('accepts one exact signed human decision on the real local API', async () => {
    const serverEntry = join(__dirname, '..', '..', 'dist', 'server.js');
    const protectedBefore = listenersOnProtectedPorts();
    const [port, enginePort, mobilePort] = await Promise.all([
      unusedPort(),
      unusedPort(),
      unusedPort(),
    ]);
    expect(new Set([port, enginePort, mobilePort]).size).toBe(3);

    const stateDir = mkdtempSync(join(tmpdir(), 'rhythm-1175-approval-'));
    tempPaths.push(stateDir);
    const dbPath = join(stateDir, 'rhythm.db');
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const user = new UsersRepository().create({
      name: 'Live human approver',
      email: 'live-human@example.com',
    });
    const authSession = new SessionsRepository().create(user.id);
    const agentSession = new AgentSessionsRepository().insert({
      agentKind: 'claude-code',
      taskId: null,
      cwd: stateDir,
      name: 'Live approval session',
      mcpRole: 'church-admin',
    });
    const sdkSessionId = 'sdk-live-approval-1175';
    new AgentSessionsRepository().setSdkSessionId(
      agentSession.id,
      sdkSessionId,
    );
    const context = {
      sdkSessionId,
      turnId: 'turn-live-external-read',
      agentName: 'church-admin',
      toolCallId: 'call-live-calendar',
    };
    const taintEventId = randomUUID();
    const taintId = randomUUID();
    const taintedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO agent_external_content_events
        (id, session_id, sdk_session_id, turn_id, agent_name, tool_call_id,
         source, content_digest, blocked, diagnostics_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '[]', ?)`,
    ).run(
      taintEventId,
      agentSession.id,
      sdkSessionId,
      context.turnId,
      context.agentName,
      context.toolCallId,
      'calendar.events',
      'a'.repeat(64),
      taintedAt,
    );
    db.prepare(
      `INSERT INTO agent_external_taint_state
        (session_id, sdk_session_id, taint_id, latest_event_id, tainted_turn_id,
         tainted_agent, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      agentSession.id,
      sdkSessionId,
      taintId,
      taintEventId,
      context.turnId,
      context.agentName,
      'calendar.events',
      taintedAt,
    );
    db.close();

    const credentials = installHumanApprovalTestCredentials();
    const child = spawn(
      process.execPath,
      [serverEntry, `--parent-pid=${process.pid}`],
      {
        cwd: join(__dirname, '..', '..'),
        env: {
          ...process.env,
          PATH: '/usr/bin:/bin',
          PORT: String(port),
          API_BIND_HOST: '127.0.0.1',
          AGENT_LOCAL: 'true',
          RHYTHM_ROLE: 'local',
          DB_CLIENT: 'sqlite',
          DB_PATH: dbPath,
          MEMORY_VAULT_PATH: join(stateDir, 'memory'),
          RHYTHM_OPENCODE_BIN_DIR: join(stateDir, 'empty-bin'),
          RHYTHM_OPENCODE_ENGINE_PORT: String(enginePort),
          RHYTHM_MOBILE_GATEWAY_PORT: String(mobilePort),
          HUMAN_APPROVAL_CAPABILITY_SHA256:
            createHash('sha256')
              .update(credentials.capability)
              .digest('hex'),
          HUMAN_APPROVAL_PUBLIC_KEY: credentials.publicKey,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    children.push(child);
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    let healthy = false;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      if (child.exitCode !== null) {
        throw new Error(`built local API exited before ready:\n${output}`);
      }
      try {
        healthy = (await fetch(`${baseUrl}/health`)).ok;
        if (healthy) break;
      } catch {
        // Startup still in progress.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(healthy, output).toBe(true);

    const internalHeaders = { 'Content-Type': 'application/json' };
    const taint = await fetch(
      `${baseUrl}/agent-approvals/external-content/taint`,
      {
        method: 'POST',
        headers: internalHeaders,
        body: JSON.stringify({
          context,
          source: 'calendar.events',
          contentDigest: 'a'.repeat(64),
          blocked: true,
          diagnostics: [
            {
              patternId: 'override-ignore-previous',
              class: 'override-instruction',
            },
          ],
        }),
      },
    );
    expect(taint.status, output).toBe(403);

    const payload = {
      calendarId: 'primary',
      summary: 'Human-reviewed meeting',
      start: '2026-07-26T09:00:00-07:00',
      end: '2026-07-26T10:00:00-07:00',
    };
    const created = await fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({
        action: 'Create reviewed meeting',
        security: {
          context,
          action: 'calendar.create',
          payload,
        },
      }),
    });
    expect(created.status).toBe(201);
    const approval = (await created.json()) as {
      id: string;
      decisionNonce: string;
      payloadDigest: string | null;
    };
    const humanHeaders = {
      Authorization: `Bearer ${authSession.token}`,
      'X-Rhythm-Human-Approval': credentials.capability,
      'Content-Type': 'application/json',
    };
    const listed = await fetch(
      `${baseUrl}/agent-approvals?status=pending`,
      { headers: humanHeaders },
    );
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([
      expect.objectContaining({ id: approval.id }),
    ]);

    const forged = await fetch(
      `${baseUrl}/agent-approvals/${approval.id}`,
      {
        method: 'PATCH',
        headers: humanHeaders,
        body: JSON.stringify({
          status: 'approved',
          signature: Buffer.from('forged').toString('base64'),
        }),
      },
    );
    expect(forged.status).toBe(403);

    const signature = signHumanApprovalDecision(
      credentials,
      approval,
      'approved',
    );
    const signed = await fetch(
      `${baseUrl}/agent-approvals/${approval.id}`,
      {
        method: 'PATCH',
        headers: humanHeaders,
        body: JSON.stringify({ status: 'approved', signature }),
      },
    );
    expect(signed.status).toBe(200);
    expect(await signed.json()).toMatchObject({
      status: 'approved',
      actor: `user:${user.id}`,
    });

    const consumed = await fetch(`${baseUrl}/agent-approvals/consume`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({
        context,
        approvalId: approval.id,
        action: 'calendar.create',
        payload,
      }),
    });
    expect(consumed.status).toBe(403);

    await stopChild(child);
    expect(listenersOnProtectedPorts()).toEqual(protectedBefore);
  });
});
