import { execFile } from 'node:child_process';

import type { CheckResult } from './types';

/**
 * #871 — minimum supported Python version. Some MCP servers / skills shell
 * out to a Python interpreter (e.g. `pco-mcp`'s fastmcp server); this is the
 * floor Rhythm has verified against.
 */
export const MIN_PYTHON_MAJOR = 3;
export const MIN_PYTHON_MINOR = 10;

export interface PythonVersion {
  major: number;
  minor: number;
  patch: number;
}

/** Parses `Python X.Y.Z` (the format both `python3 --version` and `python --version` emit). */
export function parsePythonVersionOutput(output: string): PythonVersion | null {
  const match = output.trim().match(/Python\s+(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function meetsMinimum(version: PythonVersion): boolean {
  if (version.major !== MIN_PYTHON_MAJOR) return version.major > MIN_PYTHON_MAJOR;
  return version.minor >= MIN_PYTHON_MINOR;
}

export interface RunCommandResult {
  stdout: string;
  ok: boolean;
}

export interface CheckPythonVersionDeps {
  /** Injectable for tests; defaults to actually shelling out to `python3 --version`. */
  runCommand: (command: string, args: string[]) => Promise<RunCommandResult>;
}

const DEFAULT_DEPS: CheckPythonVersionDeps = {
  runCommand: (command, args) =>
    new Promise((resolve) => {
      execFile(command, args, (error, stdout, stderr) => {
        // `python --version` historically prints to stderr on Python 2; check both streams.
        resolve({ stdout: `${stdout}${stderr}`, ok: !error });
      });
    }),
};

export async function checkPythonVersion(
  deps: CheckPythonVersionDeps = DEFAULT_DEPS,
): Promise<CheckResult> {
  const label = 'Python version';
  const requiredRange = `>= ${MIN_PYTHON_MAJOR}.${MIN_PYTHON_MINOR}`;

  let outcome: RunCommandResult;
  try {
    outcome = await deps.runCommand('python3', ['--version']);
  } catch {
    outcome = { stdout: '', ok: false };
  }

  if (!outcome.ok) {
    return {
      label,
      pass: false,
      remediation: `python3 was not found. Install Python ${requiredRange} and ensure it is on your PATH.`,
    };
  }

  const version = parsePythonVersionOutput(outcome.stdout);
  if (!version) {
    return {
      label,
      pass: false,
      remediation: `Could not determine your Python version. Install Python ${requiredRange}.`,
    };
  }

  if (!meetsMinimum(version)) {
    return {
      label,
      pass: false,
      remediation: `Python ${version.major}.${version.minor}.${version.patch} is installed, but Rhythm requires ${requiredRange}. Upgrade Python.`,
    };
  }

  return { label, pass: true };
}
