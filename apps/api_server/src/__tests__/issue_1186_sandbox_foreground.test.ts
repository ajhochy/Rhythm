import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../../..");
const sandboxScript = join(repoRoot, "tools/dev/sandbox.sh");
const liveChildren = new Set<ReturnType<typeof spawn>>();
const tempRoots = new Set<string>();
const reliabilityIterations = positiveIntegerEnv(
  "RHYTHM_RELIABILITY_ITERATIONS",
  5,
);
const iterationDeadlineMs = 10_000;

type CommandResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

function positiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    liveChildren.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      liveChildren.delete(child);
      resolveResult({ code, signal, stdout, stderr });
    });
  });
}

function fakeSandboxEnv(): {
  env: NodeJS.ProcessEnv;
  root: string;
  sandbox: string;
} {
  const root = mkdtempSync(join(tmpdir(), "rhythm-1186-unit-"));
  tempRoots.add(root);
  const fakeBin = join(root, "bin");
  const fakeHome = join(root, "home");
  const sandbox = join(root, "sandbox");
  const liveDb = join(root, "live.db");
  const opencodeConfigDir = join(root, "opencode-config");
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(fakeHome, { recursive: true });
  mkdirSync(opencodeConfigDir, { recursive: true });
  writeFileSync(liveDb, "");
  chmodSync(liveDb, 0o400);
  // C6 item 6 — validate_copied_data_inputs requires an approved fixture
  // root, a read-only sanitized opencode config (non-empty mcp map, shadow
  // optimizer mode if declared at all), and both source paths read-only.
  writeFileSync(
    join(opencodeConfigDir, "opencode.json"),
    JSON.stringify({ mcp: { local: { type: "local" } } }),
  );
  chmodSync(join(opencodeConfigDir, "opencode.json"), 0o400);

  const writeExecutable = (name: string, body: string) => {
    const path = join(fakeBin, name);
    writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(path, 0o755);
  };

  for (const command of ["bun", "npm"]) {
    writeExecutable(command, "exit 0");
  }
  writeExecutable(
    "sqlite3",
    '[[ "$*" == *"SELECT token FROM sessions"* ]] && printf "sandbox-test-token\\n"; exit 0',
  );
  writeExecutable(
    "curl",
    [
      'pid_file="$RHYTHM_SANDBOX_DIR/fake_engine.pid"',
      "for _ in {1..100}; do",
      '  if [[ -f "$pid_file" ]] && kill -0 "$(<"$pid_file")" 2>/dev/null; then',
      "    exit 0",
      "  fi",
      "  sleep 0.01",
      "done",
      "exit 1",
    ].join("\n"),
  );
  writeExecutable(
    "lsof",
    [
      'if [[ "$*" == *"-tiTCP:4097"* ]]; then',
      '  pid_file="$RHYTHM_SANDBOX_DIR/fake_engine.pid"',
      'elif [[ "$*" == *"-tiTCP:4098"* ]]; then',
      '  pid_file="$RHYTHM_SANDBOX_DIR/api_server.pid"',
      'elif [[ "$*" == *"-d txt"* ]]; then',
      '  printf "p%s\\nftxt\\nn%s\\n" "${RHYTHM_TEST_ENGINE_PID:-0}" "$RHYTHM_TEST_ENGINE_EXECUTABLE"',
      "  exit 0",
      "else",
      "  exit 1",
      "fi",
      '[[ -f "$pid_file" ]] || exit 1',
      'pid="$(<"$pid_file")"',
      'kill -0 "$pid" 2>/dev/null || exit 1',
      'printf "%s\\n" "$pid"',
    ].join("\n"),
  );
  writeExecutable(
    "node",
    [
      "(",
      "  trap 'exit 0' TERM INT HUP",
      "  while true; do sleep 0.1; done",
      ") &",
      'engine_pid="$!"',
      'printf "%s\\n" "$engine_pid" >"$RHYTHM_SANDBOX_DIR/fake_engine.pid"',
      'if [[ -n "${RHYTHM_TEST_NODE_EXIT:-}" ]]; then',
      "  sleep 0.2",
      '  exit "$RHYTHM_TEST_NODE_EXIT"',
      "fi",
      "cleanup() {",
      '  if [[ "${RHYTHM_TEST_ORPHAN_ENGINE:-0}" != 1 ]]; then',
      '    kill "$engine_pid" 2>/dev/null || true',
      "  fi",
      "  exit 0",
      "}",
      "trap cleanup TERM INT HUP",
      "while true; do sleep 0.1; done",
    ].join("\n"),
  );

  return {
    root,
    sandbox,
    env: {
      ...process.env,
      HOME: fakeHome,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      RHYTHM_APPROVED_FIXTURE_ROOT: root,
      RHYTHM_LIVE_DB_PATH: liveDb,
      RHYTHM_SANDBOX_OPENCODE_CONFIG: opencodeConfigDir,
      RHYTHM_SANDBOX_DIR: sandbox,
      RHYTHM_SANDBOX_ENGINE_PORT: "4097",
      RHYTHM_SANDBOX_API_PORT: "4098",
      RHYTHM_SANDBOX_GATEWAY_PORT: "4099",
      RHYTHM_TEST_ENGINE_EXECUTABLE: join(
        repoRoot,
        "apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin/opencode",
      ),
    },
  };
}

async function waitForOutput(
  child: ReturnType<typeof spawn>,
  output: () => string,
  expected: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (output().includes(expected)) return;
    if (child.exitCode !== null) {
      throw new Error(
        `process exited ${child.exitCode} before output contained ${expected}`,
      );
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`timed out waiting for output: ${expected}\n${output()}`);
}

function waitForExit(
  child: ReturnType<typeof spawn>,
  stdout: string,
): Promise<CommandResult> {
  if (child.exitCode !== null || child.signalCode !== null) {
    liveChildren.delete(child);
    return Promise.resolve({
      code: child.exitCode,
      signal: child.signalCode,
      stdout,
      stderr: "",
    });
  }
  return new Promise((resolveResult) => {
    child.once("exit", (code, signal) => {
      liveChildren.delete(child);
      resolveResult({ code, signal, stdout, stderr: "" });
    });
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  for (const child of liveChildren) {
    child.kill("SIGKILL");
  }
  liveChildren.clear();
  for (const root of tempRoots) {
    const enginePidFile = join(root, "sandbox", "fake_engine.pid");
    if (existsSync(enginePidFile)) {
      try {
        process.kill(
          Number(readFileSync(enginePidFile, "utf8").trim()),
          "SIGKILL",
        );
      } catch {
        // Already stopped by the sandbox lifecycle.
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

describe("tools/dev/sandbox.sh foreground lifecycle (#1186)", () => {
  it("is valid Bash and rejects unsupported up options before doing work", async () => {
    const syntax = await run("bash", ["-n", sandboxScript], process.env);
    expect(syntax.code).toBe(0);

    const invalid = await run(
      "bash",
      [sandboxScript, "up", "--unknown"],
      process.env,
    );
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain("up [--foreground]");
  });

  it("preserves plain up as a returning background launch", async () => {
    const { env, sandbox } = fakeSandboxEnv();
    const result = await run("bash", [sandboxScript, "up"], env);

    expect(result.code, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Sandbox ready:");
    expect(result.stdout).not.toContain("foreground hold active");

    const pid = Number(
      readFileSync(join(sandbox, "api_server.pid"), "utf8").trim(),
    );
    expect(isAlive(pid)).toBe(true);

    const status = await run("bash", [sandboxScript, "status"], env);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain("api :4098 listener:");
    expect(status.stdout).toContain("engine :4097 listener:");

    const down = await run("bash", [sandboxScript, "down"], env);
    expect(down.code).toBe(0);
    expect(existsSync(sandbox)).toBe(false);
  });

  it("reliably keeps the launcher alive until down completes its acknowledged stop", async () => {
    const { env, sandbox } = fakeSandboxEnv();
    for (let iteration = 0; iteration < reliabilityIterations; iteration += 1) {
      const startedAt = performance.now();
      await withDeadline(
        (async () => {
          const foreground = spawn(
            "bash",
            [sandboxScript, "up", "--foreground"],
            {
              cwd: repoRoot,
              env,
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          liveChildren.add(foreground);
          let output = "";
          foreground.stdout.on("data", (chunk) => {
            output += String(chunk);
          });
          foreground.stderr.on("data", (chunk) => {
            output += String(chunk);
          });

          await waitForOutput(
            foreground,
            () => output,
            "foreground hold active",
          );
          expect(foreground.exitCode, `iteration ${iteration}`).toBeNull();
          const apiPid = Number(
            readFileSync(join(sandbox, "api_server.pid"), "utf8").trim(),
          );
          expect(isAlive(apiPid), `iteration ${iteration}`).toBe(true);

          const down = await run("bash", [sandboxScript, "down"], env);
          expect(down.code, `iteration ${iteration}: ${down.stderr}`).toBe(0);
          const foregroundResult = await waitForExit(foreground, output);
          expect(
            foregroundResult.code,
            `foreground iteration ${iteration}: ${output}`,
          ).toBe(0);
          expect(existsSync(sandbox), `iteration ${iteration}`).toBe(false);
        })(),
        iterationDeadlineMs,
        `iteration ${iteration} exceeded ${iterationDeadlineMs}ms`,
      );
      if (process.env.RHYTHM_RELIABILITY_TIMINGS === "1") {
        console.info(
          `RHYTHM_RELIABILITY_TIMING iteration=${iteration} duration_ms=${(
            performance.now() - startedAt
          ).toFixed(1)}`,
        );
      }
    }
  }, reliabilityIterations * iterationDeadlineMs + 5_000);

  it("propagates an unexpected foreground API exit", async () => {
    const { env } = fakeSandboxEnv();
    const result = await run("bash", [sandboxScript, "up", "--foreground"], {
      ...env,
      RHYTHM_TEST_NODE_EXIT: "23",
    });
    expect(result.code).toBe(23);
    expect((await run("bash", [sandboxScript, "down"], env)).code).toBe(0);
  });

  it("refuses to stop a PID that does not belong to the sandbox", async () => {
    const { env, sandbox } = fakeSandboxEnv();
    mkdirSync(sandbox, { recursive: true });
    const unrelated = spawn("/bin/sleep", ["60"], { stdio: "ignore" });
    liveChildren.add(unrelated);
    expect(unrelated.pid).toBeDefined();
    writeFileSync(join(sandbox, "api_server.pid"), `${unrelated.pid}\n`);

    const down = await run("bash", [sandboxScript, "down"], env);
    expect(down.code).toBe(1);
    expect(down.stderr).toContain(
      "no longer belongs to this sandbox; refusing to kill it",
    );
    expect(isAlive(unrelated.pid!)).toBe(true);

    unrelated.kill("SIGTERM");
  });

  it("refuses an engine listener whose PID differs from the recorded engine", async () => {
    const { env, sandbox } = fakeSandboxEnv();
    mkdirSync(sandbox, { recursive: true });
    const listener = spawn("/bin/sleep", ["60"], { stdio: "ignore" });
    const recorded = spawn("/bin/sleep", ["60"], { stdio: "ignore" });
    liveChildren.add(listener);
    liveChildren.add(recorded);
    expect(listener.pid).toBeDefined();
    expect(recorded.pid).toBeDefined();
    writeFileSync(join(sandbox, "fake_engine.pid"), `${listener.pid}\n`);
    writeFileSync(
      join(sandbox, "opencode_engine.pid"),
      `${recorded.pid}\n`,
    );

    const down = await run("bash", [sandboxScript, "down"], env);
    expect(down.code).toBe(1);
    expect(down.stderr).toContain(
      `sandbox: sandbox engine port :4097 is now PID ${listener.pid}, not recorded PID ${recorded.pid}; refusing to kill it`,
    );
    expect(isAlive(listener.pid!)).toBe(true);
    expect(isAlive(recorded.pid!)).toBe(true);

    listener.kill("SIGTERM");
    recorded.kill("SIGTERM");
  });

  it("refuses a recorded engine PID whose executable is not the built fork", async () => {
    const { env, sandbox } = fakeSandboxEnv();
    mkdirSync(sandbox, { recursive: true });
    const unrelated = spawn("/bin/sleep", ["60"], { stdio: "ignore" });
    liveChildren.add(unrelated);
    expect(unrelated.pid).toBeDefined();
    writeFileSync(join(sandbox, "fake_engine.pid"), `${unrelated.pid}\n`);
    writeFileSync(join(sandbox, "opencode_engine.pid"), `${unrelated.pid}\n`);

    const down = await run("bash", [sandboxScript, "down"], {
      ...env,
      RHYTHM_TEST_ENGINE_EXECUTABLE: join(sandbox, "foreign-opencode"),
    });
    expect(down.code).toBe(1);
    expect(down.stderr).toContain(
      "no longer uses this sandbox's built fork; refusing to kill it",
    );
    expect(isAlive(unrelated.pid!)).toBe(true);

    unrelated.kill("SIGTERM");
  });
});
