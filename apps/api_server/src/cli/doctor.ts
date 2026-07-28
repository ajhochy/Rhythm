import type { RhythmConfig } from '../config/rhythm_config';
import { checkApiKeys } from './checks/api_keys';
import { checkCapabilityStatus } from './checks/capability_status';
import { checkConfigValidity, defaultConfigPaths } from './checks/config_validity';
import { loadConfiguredMcpServers } from './checks/load_mcp_servers';
import { checkMcpReachability } from './checks/mcp_reachability';
import {
  liveMcpStatusResults,
  readLiveMcpStatus,
  type LiveMcpFetch,
  type LiveMcpStatus,
} from './checks/live_mcp_status';
import { checkNodeVersion } from './checks/node_version';
import { checkPythonVersion } from './checks/python_version';
import type { CheckResult } from './checks/types';
import { defaultLoadDeps, loadRhythmConfig } from './setup/rhythm_config_store';

export interface RunDoctorOptions {
  env?: NodeJS.ProcessEnv;
  /** Injectable for tests — skips real network/process calls end to end. */
  deps?: {
    apiKeys?: () => CheckResult[];
    nodeVersion?: () => CheckResult;
    pythonVersion?: () => Promise<CheckResult>;
    configValidity?: () => Promise<CheckResult[]>;
    mcpServers?: () => Awaited<ReturnType<typeof loadConfiguredMcpServers>>;
    mcpReachability?: (
      servers: ReturnType<typeof loadConfiguredMcpServers>,
    ) => Promise<CheckResult[]>;
    mcpLiveStatus?: () => Promise<LiveMcpStatus>;
    fetchImpl?: LiveMcpFetch;
    /** #879 — loads the Rhythm capabilities config (Blank Slate awareness). Defaults to reading rhythm-capabilities.json; an all-unconfigured config on a normal (non-Blank-Slate) install. */
    rhythmConfig?: () => RhythmConfig;
  };
}

export interface DoctorReport {
  results: CheckResult[];
  passCount: number;
  failCount: number;
  /** 0 when every check passed, 1 when any failed — matches process exit code semantics. */
  exitCode: 0 | 1;
}

/**
 * #871 — runs every `rhythm doctor` check and aggregates the results. This
 * function has NO side-effectful import of `server.ts` / the Express app —
 * every check module here only touches `fs`, `child_process`, and `fetch`.
 * Read-only: no writes, no config mutations, no auto-fixes (explicitly out
 * of scope for this issue).
 */
export async function runDoctor(options: RunDoctorOptions = {}): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const deps = options.deps ?? {};

  const apiKeyResults = (deps.apiKeys ?? (() => checkApiKeys(env)))();
  const nodeResult = (deps.nodeVersion ?? (() => checkNodeVersion()))();
  const pythonResult = await (deps.pythonVersion ?? checkPythonVersion)();

  const defaultConfigValidity = async (): Promise<CheckResult[]> => {
    const fs = await import('node:fs');
    return checkConfigValidity({
      existsSync: fs.existsSync,
      readFileSync: (p: string) => fs.readFileSync(p, 'utf8'),
      paths: defaultConfigPaths(),
    });
  };
  const configResults = await (deps.configValidity ?? defaultConfigValidity)();

  const servers = (deps.mcpServers ?? loadConfiguredMcpServers)();
  const apiUrl = env.RHYTHM_API_URL ?? `http://127.0.0.1:${env.PORT ?? '4001'}`;
  const configuredTimeout = Number(env.RHYTHM_DOCTOR_MCP_TIMEOUT_MS ?? 1500);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : 1500;
  const liveStatus = await (
    deps.mcpLiveStatus ??
    (() => readLiveMcpStatus({ apiUrl, fetchImpl: deps.fetchImpl, timeoutMs }))
  )();
  const mcpResults =
    liveStatus.source === 'live'
      ? liveMcpStatusResults(liveStatus)
      : [
          ...liveMcpStatusResults(liveStatus),
          ...await (
            deps.mcpReachability ??
            ((s) => checkMcpReachability({ servers: s }))
          )(servers),
        ];

  const defaultRhythmConfig = (): RhythmConfig => loadRhythmConfig(defaultLoadDeps());
  const rhythmConfig = (deps.rhythmConfig ?? defaultRhythmConfig)();
  const capabilityResults = checkCapabilityStatus(rhythmConfig);

  const results: CheckResult[] = [
    ...apiKeyResults,
    nodeResult,
    pythonResult,
    ...configResults,
    ...mcpResults,
    ...capabilityResults,
  ];

  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;

  return {
    results,
    passCount,
    failCount,
    exitCode: failCount > 0 ? 1 : 0,
  };
}

/** Renders a `DoctorReport` as the plain-English CLI output described in #871. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];

  for (const result of report.results) {
    if (result.pass) {
      const suffix =
        result.status === 'unconfigured'
          ? ' (not configured)'
          : result.status === 'disabled'
            ? ' (disabled — intentional)'
            : '';
      lines.push(`✅ ${result.label}${suffix}`);
    } else {
      lines.push(`❌ ${result.label}`);
      if (result.remediation) {
        lines.push(`   → ${result.remediation}`);
      }
    }
  }

  lines.push('');
  lines.push(`${report.passCount} checks passed, ${report.failCount} need attention`);

  return lines.join('\n');
}

/** CLI entry point for `rhythm doctor`. Not invoked when this module is only imported for testing. */
export async function runDoctorCli(): Promise<void> {
  const report = await runDoctor();
  // eslint-disable-next-line no-console
  console.log(formatDoctorReport(report));
  process.exitCode = report.exitCode;
}
