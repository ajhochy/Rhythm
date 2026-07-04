import { describe, expect, it, vi } from 'vitest';

import { runDoctor } from '../doctor';
import { runSetup } from './run_setup';
import { ScriptedPromptIO } from './prompts';

const baseDetectDeps = {
  env: {},
  existsSync: () => false,
  readFileSync: () => '',
};

describe('runSetup', () => {
  it('quick mode: collects the AI provider key, writes it, then runs doctor', async () => {
    const io = new ScriptedPromptIO(['sk-anthropic']);
    const writeEnvConfig = vi.fn().mockResolvedValue(undefined);
    const runDoctor = vi.fn().mockResolvedValue({ results: [], passCount: 1, failCount: 0, exitCode: 0 });

    const result = await runSetup({
      mode: 'quick',
      io,
      detectDeps: baseDetectDeps,
      writeEnvConfig,
      runDoctor,
    });

    expect(writeEnvConfig).toHaveBeenCalledWith(
      { ANTHROPIC_API_KEY: 'sk-anthropic' },
      expect.anything(),
    );
    expect(runDoctor).toHaveBeenCalledTimes(1);
    expect(result.doctorReport?.exitCode).toBe(0);
  });

  it('full mode: walks every integration and writes all collected values', async () => {
    const io = new ScriptedPromptIO(['sk-anthropic', 'n', 'n', 'n', 'n']);
    const writeEnvConfig = vi.fn().mockResolvedValue(undefined);
    const runDoctor = vi.fn().mockResolvedValue({ results: [], passCount: 1, failCount: 0, exitCode: 0 });

    await runSetup({
      mode: 'full',
      io,
      detectDeps: baseDetectDeps,
      writeEnvConfig,
      runDoctor,
    });

    expect(writeEnvConfig).toHaveBeenCalledWith({ ANTHROPIC_API_KEY: 'sk-anthropic' }, expect.anything());
  });

  it('does not write anything when the collection step throws (Ctrl+C simulation)', async () => {
    const io = new ScriptedPromptIO([]); // throws on first ask -> simulates interruption
    const writeEnvConfig = vi.fn().mockResolvedValue(undefined);
    const runDoctor = vi.fn();

    await expect(
      runSetup({ mode: 'quick', io, detectDeps: baseDetectDeps, writeEnvConfig, runDoctor }),
    ).rejects.toThrow();

    expect(writeEnvConfig).not.toHaveBeenCalled();
    expect(runDoctor).not.toHaveBeenCalled();
  });

  it('skips the write step entirely when there is nothing new to write (all pre-configured)', async () => {
    const io = new ScriptedPromptIO([]);
    const writeEnvConfig = vi.fn().mockResolvedValue(undefined);
    const runDoctor = vi.fn().mockResolvedValue({ results: [], passCount: 1, failCount: 0, exitCode: 0 });

    await runSetup({
      mode: 'quick',
      io,
      detectDeps: {
        env: { ANTHROPIC_API_KEY: 'already-set' },
        existsSync: () => false,
        readFileSync: () => '',
      },
      writeEnvConfig,
      runDoctor,
    });

    expect(writeEnvConfig).not.toHaveBeenCalled();
    expect(runDoctor).toHaveBeenCalledTimes(1);
  });

  it('setup -> doctor round-trip: a fixture empty config produces an all-green doctor report after quick setup', async () => {
    const io = new ScriptedPromptIO(['sk-anthropic-round-trip']);
    const writeEnvConfig = vi.fn().mockResolvedValue(undefined);

    // Real `runDoctor`, fed the SAME values quick mode just collected — this
    // is the round-trip the issue's acceptance criterion asks for ("`rhythm
    // doctor` passes automatically after a successful `rhythm setup`").
    const doctorAfterSetup = () =>
      runDoctor({
        env: { ANTHROPIC_API_KEY: 'sk-anthropic-round-trip' },
        deps: {
          nodeVersion: () => ({ label: 'Node.js version', pass: true }),
          pythonVersion: async () => ({ label: 'Python version', pass: true }),
          configValidity: async () => [],
          mcpServers: () => [],
          mcpReachability: async () => [],
        },
      });

    const result = await runSetup({
      mode: 'quick',
      io,
      detectDeps: baseDetectDeps,
      writeEnvConfig,
      runDoctor: doctorAfterSetup,
    });

    expect(result.doctorReport?.exitCode).toBe(0);
    expect(result.doctorReport?.failCount).toBe(0);
  });
});
