import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import * as loggerModule from '../utils/logger';
import { requireLoopbackDevLogs } from '../routes/dev_logs_routes';

type PersistentLoggerApi = {
  installPersistentConsoleLogging(options: {
    logPath: string;
    maxBytes: number;
    maxFiles: number;
  }): () => void;
  isLoopbackAddress(address: string | undefined): boolean;
  readApiLogTail(logPath: string, lines: number): string[];
};

const api = loggerModule as unknown as PersistentLoggerApi;

describe('issue #1326 durable api_server logging contract', () => {
  it('issue-1326-c1: console output is teed to a bounded rotating log', () => {
    // Regression caught: Flutter receives child stdout, but an incident leaves
    // no durable server-side record after the terminal/app process disappears.
    expect(typeof api.installPersistentConsoleLogging).toBe('function');
    const dir = mkdtempSync(join(tmpdir(), 'rhythm-log-contract-'));
    const logPath = join(dir, 'api_server.log');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const restore = api.installPersistentConsoleLogging({
      logPath,
      maxBytes: 180,
      maxFiles: 2,
    });
    try {
      for (let index = 0; index < 12; index += 1) {
        console.log('durable-line-%d %s', index, 'x'.repeat(24));
      }
    } finally {
      restore();
      consoleSpy.mockRestore();
    }

    expect(existsSync(logPath)).toBe(true);
    expect(existsSync(`${logPath}.1`)).toBe(true);
    const combined = [logPath, `${logPath}.1`, `${logPath}.2`]
      .filter(existsSync)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(combined).toContain('durable-line-11');
  });

  it('issue-1326-c2: log tail is bounded and loopback-only', () => {
    // Regression caught: diagnostics either expose the whole file remotely or
    // return an unbounded incident log to the in-app caller.
    expect(typeof api.isLoopbackAddress).toBe('function');
    expect(typeof api.readApiLogTail).toBe('function');
    expect(api.isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(api.isLoopbackAddress('::1')).toBe(true);
    expect(api.isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(api.isLoopbackAddress('192.168.1.10')).toBe(false);

    const next = vi.fn();
    const responseState = { status: 200, body: null as unknown };
    const response = {
      status(code: number) {
        responseState.status = code;
        return this;
      },
      json(body: unknown) {
        responseState.body = body;
        return this;
      },
    } as unknown as Response;
    requireLoopbackDevLogs(
      { socket: { remoteAddress: '192.168.1.10' } } as unknown as Request,
      response,
      next as NextFunction,
    );
    expect(next).not.toHaveBeenCalled();
    expect(responseState).toEqual({
      status: 403,
      body: { error: 'LOOPBACK_ONLY' },
    });

    const dir = mkdtempSync(join(tmpdir(), 'rhythm-tail-contract-'));
    const logPath = join(dir, 'api_server.log');
    const writeFileSync = require('fs').writeFileSync as typeof import('fs').writeFileSync;
    writeFileSync(logPath, 'one\ntwo\nthree\nfour\n', 'utf8');
    expect(api.readApiLogTail(logPath, 2)).toEqual(['three', 'four']);
  });

  it('issue-1326-c3: desktop dev launcher prints the durable log path', () => {
    // Regression caught: a durable log exists but operators still reproduce
    // incidents because the launcher never tells them where to find it.
    const launcher = readFileSync(
      resolve(__dirname, '../../../../tools/dev/launch_desktop_current.sh'),
      'utf8',
    );
    expect(launcher).toContain('~/Library/Logs/Rhythm/api_server.log');
  });
});
