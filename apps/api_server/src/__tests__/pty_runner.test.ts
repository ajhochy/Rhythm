import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { shlexSplit, spawn, resume } from '../services/pty_runner';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

// ─── shlex splitter unit tests ────────────────────────────────────────────────

describe('shlexSplit', () => {
  it('splits a simple command with no args', () => {
    expect(shlexSplit('claude')).toEqual(['claude']);
  });

  it('splits a command with multiple args', () => {
    expect(shlexSplit('claude --dangerously-skip-permissions')).toEqual([
      'claude',
      '--dangerously-skip-permissions',
    ]);
  });

  it('splits multiple args', () => {
    expect(shlexSplit('echo hello world')).toEqual(['echo', 'hello', 'world']);
  });

  it('handles double-quoted strings', () => {
    expect(shlexSplit('echo "hello world"')).toEqual(['echo', 'hello world']);
  });

  it('handles single-quoted strings', () => {
    expect(shlexSplit("echo 'hello world'")).toEqual(['echo', 'hello world']);
  });

  it('handles backslash escape outside quotes', () => {
    expect(shlexSplit('echo hello\\ world')).toEqual(['echo', 'hello world']);
  });

  it('handles backslash escape inside double quotes', () => {
    expect(shlexSplit('echo "hello\\" world"')).toEqual(['echo', 'hello" world']);
  });

  it('returns empty array for blank string', () => {
    expect(shlexSplit('')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(shlexSplit('   ')).toEqual([]);
  });

  it('handles tabs as token separators', () => {
    expect(shlexSplit('echo\thello')).toEqual(['echo', 'hello']);
  });

  it('handles adjacent quoted sections', () => {
    expect(shlexSplit("ec'ho'")).toEqual(['echo']);
  });

  it('preserves spaces inside quotes', () => {
    expect(shlexSplit('"hello   world"')).toEqual(['hello   world']);
  });

  it('handles resume command with placeholder intact', () => {
    expect(shlexSplit('claude --resume {{sessionId}}')).toEqual([
      'claude',
      '--resume',
      '{{sessionId}}',
    ]);
  });
});

// ─── Config-driven spawn / resume tests ──────────────────────────────────────

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/**
 * These tests exercise the config-lookup and shlex-parsing logic in spawn/resume
 * without needing to invoke a real PTY binary.  The tests verify:
 *   1. Config must exist and be enabled (error paths) — no pty involvement.
 *   2. Resume fails with a clear error for non-resumable configs.
 *   3. Resume fails when session token is missing.
 *   4. The shlexSplit integration with config.command produces correct [binary, ...args].
 */

describe('pty_runner config-driven spawn', () => {
  beforeEach(() => {
    setDb(makeDb());
  });

  it('throws 400-friendly error when config is missing', () => {
    // spawn imported at top of file

    const session = {
      id: 'sess-2',
      agentKind: 'nonexistent-agent' as never,
      cwd: '/tmp',
      sessionToken: null,
      taskId: null,
      taskTitle: null,
      status: 'starting' as const,
      name: 'Missing',
      lastPreview: null,
      lastActivityAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => spawn({ session })).toThrow("No agent config found for id 'nonexistent-agent'");
  });

  it('throws when config is disabled', () => {
    const configRepo = new AgentConfigsRepository();
    configRepo.insert({
      id: 'disabled-agent',
      label: 'Disabled',
      icon: 'icon.png',
      command: 'echo',
      enabled: false,
      isAgent: false,
      canResume: false,
    });

    // spawn imported at top of file

    const session = {
      id: 'sess-3',
      agentKind: 'disabled-agent' as never,
      cwd: '/tmp',
      sessionToken: null,
      taskId: null,
      taskTitle: null,
      status: 'starting' as const,
      name: 'Disabled',
      lastPreview: null,
      lastActivityAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => spawn({ session })).toThrow("Agent 'disabled-agent' is disabled");
  });

  it('throws when config has empty command', () => {
    const configRepo = new AgentConfigsRepository();
    configRepo.insert({
      id: 'empty-cmd',
      label: 'Empty Command',
      icon: 'icon.png',
      command: '   ', // all whitespace → shlexSplit returns []
      enabled: true,
      isAgent: false,
      canResume: false,
    });

    // spawn imported at top of file

    const session = {
      id: 'sess-empty',
      agentKind: 'empty-cmd' as never,
      cwd: '/tmp',
      sessionToken: null,
      taskId: null,
      taskTitle: null,
      status: 'starting' as const,
      name: 'Empty',
      lastPreview: null,
      lastActivityAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => spawn({ session })).toThrow("Agent 'empty-cmd' has an empty command");
  });
});

describe('pty_runner resume', () => {
  beforeEach(() => {
    setDb(makeDb());
  });

  it('throws for non-resumable agents (codex)', () => {
    // resume imported at top of file

    const dbSession = {
      id: 'sess-codex',
      agentKind: 'codex' as const,
      cwd: '/tmp',
      sessionToken: 'some-token',
      taskId: null,
      taskTitle: null,
      status: 'resumable' as const,
      name: 'Codex',
      lastPreview: null,
      lastActivityAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => resume('sess-codex', dbSession)).toThrow(
      "resume not supported for this agent ('codex')",
    );
  });

  it('throws when session token is missing', () => {
    // resume imported at top of file

    const dbSession = {
      id: 'sess-claude',
      agentKind: 'claude-code' as const,
      cwd: '/tmp',
      sessionToken: null,
      taskId: null,
      taskTitle: null,
      status: 'resumable' as const,
      name: 'Claude',
      lastPreview: null,
      lastActivityAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => resume('sess-claude', dbSession)).toThrow(
      'Session token missing — cannot resume',
    );
  });

  it('throws for a config with canResume=false', () => {
    const configRepo = new AgentConfigsRepository();
    configRepo.insert({
      id: 'no-resume-agent',
      label: 'No Resume',
      icon: 'icon.png',
      command: 'myagent',
      enabled: true,
      isAgent: true,
      canResume: false,
      resumeCommand: null,
    });

    // resume imported at top of file

    const dbSession = {
      id: 'sess-no-resume',
      agentKind: 'no-resume-agent' as never,
      cwd: '/tmp',
      sessionToken: 'tok-abc',
      taskId: null,
      taskTitle: null,
      status: 'resumable' as const,
      name: 'No Resume Agent',
      lastPreview: null,
      lastActivityAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => resume('sess-no-resume', dbSession)).toThrow(
      "resume not supported for this agent ('no-resume-agent')",
    );
  });
});
