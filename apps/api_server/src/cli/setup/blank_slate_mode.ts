import { blankSlateConfig, type RhythmConfig } from '../../config/rhythm_config';
import type { DetectedConfig } from './detect_existing_config';
import type { PromptIO } from './prompts';
import { saveRhythmConfig as realSaveRhythmConfig, defaultSaveDeps } from './rhythm_config_store';
import { writeEnvConfig as realWriteEnvConfig, defaultEnvPath, defaultWriteEnvConfigDeps } from './write_env_config';

export interface RunBlankSlateModeOptions {
  io: PromptIO;
  detected: DetectedConfig;
  /** MCP server ids currently present in opencode.json's `mcp` block (any transport). All are explicitly disabled in Blank Slate mode. */
  configuredMcpServerIds: string[];
  saveRhythmConfig?: (config: RhythmConfig, deps: ReturnType<typeof defaultSaveDeps> & { path?: string }) => void;
  writeEnvConfig?: typeof realWriteEnvConfig;
}

export interface RunBlankSlateModeResult {
  config: RhythmConfig;
  valuesWritten: Record<string, string>;
}

/**
 * #879 — Blank Slate mode: minimal, fully-user-controlled deployment. Only
 * the AI provider is collected (the one core requirement shared with Quick
 * mode); File Ops and Terminal are enabled by config default, not by asking
 * the user anything. Every other capability — web search, browser
 * automation, code execution sandbox, memory capture, all MCP servers
 * (including curated defaults), messaging integrations, and any skill not
 * explicitly enabled — is written as an explicit `false`/disabled entry via
 * `blankSlateConfig()`, never merely left absent. This function does not
 * accept any parameter that could re-enable a disabled capability — the
 * blank-slate contract is enforced by construction (`blankSlateConfig()` is
 * always the base), not by a flag callers could get wrong.
 */
export async function runBlankSlateMode(
  options: RunBlankSlateModeOptions,
): Promise<RunBlankSlateModeResult> {
  const { io, detected, configuredMcpServerIds } = options;
  const saveRhythmConfigFn = options.saveRhythmConfig ?? realSaveRhythmConfig;
  const writeEnvConfigFn = options.writeEnvConfig ?? realWriteEnvConfig;

  const valuesWritten: Record<string, string> = {};

  if (detected.ANTHROPIC_API_KEY.configured || detected.OPENAI_API_KEY.configured) {
    io.info('Already set: ✅ AI provider');
  } else {
    io.info(
      'Blank Slate mode starts with only the core AI provider, File Ops, and Terminal enabled. Everything else is explicitly turned off until you add it.',
    );
    const key = await io.askSecret('Paste your Anthropic API key:');
    valuesWritten.ANTHROPIC_API_KEY = key;
  }

  if (Object.keys(valuesWritten).length > 0) {
    await writeEnvConfigFn(valuesWritten, defaultWriteEnvConfigDeps(defaultEnvPath()));
    // Make the value visible to THIS process immediately so the doctor
    // verification step run right after (see runBlankSlateCli) doesn't see
    // stale process.env — mirrors the same fix in run_setup.ts.
    for (const [key, value] of Object.entries(valuesWritten)) {
      process.env[key] = value;
    }
  }

  const config = blankSlateConfig();
  config.disabledMcpServers = Array.from(new Set(configuredMcpServerIds));

  saveRhythmConfigFn(config, defaultSaveDeps());
  io.info('Blank Slate config written. All non-core capabilities are explicitly disabled.');

  return { config, valuesWritten };
}

/** Wires `runBlankSlateMode` to the real filesystem + doctor for `rhythm setup --blank-slate`. */
export async function runBlankSlateCli(io: PromptIO): Promise<void> {
  const { DEFAULT_DETECT_DEPS, detectExistingConfig } = await import('./detect_existing_config');
  const { loadConfiguredMcpServers } = await import('../checks/load_mcp_servers');
  const { runDoctor } = await import('../doctor');
  const { formatDoctorReport } = await import('../doctor');

  const detected = detectExistingConfig({ env: process.env, ...DEFAULT_DETECT_DEPS });
  const configuredMcpServerIds = loadConfiguredMcpServers().map((s) => s.id);

  await runBlankSlateMode({ io, detected, configuredMcpServerIds });

  io.info('');
  io.info('Running `rhythm doctor` to confirm everything is working...');
  const report = await runDoctor();
  io.info(formatDoctorReport(report));
  process.exitCode = report.exitCode;
}
