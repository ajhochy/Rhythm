import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const enabled =
  process.env.RHYTHM_LIVE_E2E === "1" &&
  process.env.RHYTHM_SANDBOX_LIFECYCLE_E2E === "1";
const describeLive = enabled ? describe : describe.skip;
const repoRoot = resolve(__dirname, "../../../..");
const sandboxScript = join(repoRoot, "tools/dev/sandbox.sh");
const sandbox = mkdtempSync(join(tmpdir(), "rhythm-1186-live-"));
const launchEnv = {
  ...process.env,
  RHYTHM_SANDBOX_DIR: sandbox,
};

let foreground: ReturnType<typeof spawn> | null = null;
let unrelated: ReturnType<typeof spawn> | null = null;
let launcherOutput = "";
let ownedEnginePid: number | null = null;

type CommandResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

function runSandbox(args: string[], env = launchEnv): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn("bash", [sandboxScript, ...args], {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
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
      resolveResult({ code, signal, stdout, stderr });
    });
  });
}

function listenerPids(port: number): string[] {
  const result = spawnSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`lsof failed for :${port}: ${result.stderr}`);
  }
  return result.stdout.trim().split(/\s+/).filter(Boolean).sort();
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  description: string,
  check: () => boolean | Promise<boolean>,
  timeoutMs = 480_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    if (
      foreground &&
      (foreground.exitCode !== null || foreground.signalCode !== null)
    ) {
      throw new Error(
        `foreground launcher exited before ${description}\n${launcherOutput.slice(-8_000)}`,
      );
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(
    `timed out waiting for ${description}\n${launcherOutput.slice(-8_000)}`,
  );
}

async function endpointHealthy(path: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:4098${path}`);
    return response.ok;
  } catch {
    return false;
  }
}

function waitForChildExit(
  child: ReturnType<typeof spawn>,
): Promise<CommandResult> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({
      code: child.exitCode,
      signal: child.signalCode,
      stdout: launcherOutput,
      stderr: "",
    });
  }
  return new Promise((resolveResult) => {
    child.once("exit", (code, signal) => {
      resolveResult({ code, signal, stdout: launcherOutput, stderr: "" });
    });
  });
}

afterAll(async () => {
  if (!enabled) {
    rmSync(sandbox, { recursive: true, force: true });
    return;
  }
  if (existsSync(join(sandbox, "api_server.pid"))) {
    await runSandbox(["down"]).catch(() => undefined);
  }
  if (foreground && foreground.exitCode === null) foreground.kill("SIGKILL");
  if (
    ownedEnginePid &&
    listenerPids(4097).join(",") === String(ownedEnginePid)
  ) {
    process.kill(ownedEnginePid, "SIGKILL");
  }
  if (unrelated && unrelated.exitCode === null) unrelated.kill("SIGKILL");
  rmSync(sandbox, { recursive: true, force: true });
});

describeLive("live E2E — #1186 automation-stable foreground sandbox", () => {
  it("holds real API/engine health, preserves protected listeners, refuses unrelated PIDs, and tears down", async () => {
    expect(listenerPids(4098), "sandbox API port must start free").toEqual([]);
    expect(listenerPids(4097), "sandbox engine port must start free").toEqual(
      [],
    );
    const protectedBefore = {
      api: listenerPids(4001),
      engine: listenerPids(4096),
    };

    foreground = spawn(
      "bash",
      ["--noprofile", "--norc", sandboxScript, "up", "--foreground"],
      {
        cwd: repoRoot,
        env: launchEnv,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    foreground.stdout!.on("data", (chunk) => {
      launcherOutput += String(chunk);
    });
    foreground.stderr!.on("data", (chunk) => {
      launcherOutput += String(chunk);
    });

    await waitFor(
      "foreground readiness output and both health endpoints",
      async () =>
        launcherOutput.includes("Sandbox foreground hold active") &&
        (await endpointHealthy("/health")) &&
        (await endpointHealthy("/opencode/health")),
    );

    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
    expect(foreground.exitCode, launcherOutput.slice(-8_000)).toBeNull();
    const apiPid = Number(
      readFileSync(join(sandbox, "api_server.pid"), "utf8").trim(),
    );
    ownedEnginePid = Number(
      readFileSync(join(sandbox, "opencode_engine.pid"), "utf8").trim(),
    );
    expect(
      isAlive(apiPid),
      "recorded API PID remains alive after readiness",
    ).toBe(true);
    expect(
      listenerPids(4098).length,
      "API :4098 remains bound",
    ).toBeGreaterThan(0);
    expect(
      listenerPids(4097).length,
      "engine :4097 remains bound",
    ).toBeGreaterThan(0);
    expect(listenerPids(4097)).toEqual([String(ownedEnginePid)]);
    expect(await endpointHealthy("/health")).toBe(true);
    expect(await endpointHealthy("/opencode/health")).toBe(true);
    expect(
      listenerPids(4001),
      "protected API listener changed during run",
    ).toEqual(protectedBefore.api);
    expect(
      listenerPids(4096),
      "protected engine listener changed during run",
    ).toEqual(protectedBefore.engine);

    const status = await runSandbox(["status"]);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain(`api :4098 listener: ${apiPid}`);
    expect(status.stdout).toMatch(/engine :4097 listener: \d+/);

    const down = await runSandbox(["down"]);
    expect(down.code, down.stderr).toBe(0);
    const foregroundResult = await waitForChildExit(foreground);
    expect(foregroundResult.code, launcherOutput.slice(-8_000)).toBe(0);
    expect(existsSync(sandbox)).toBe(false);
    expect(listenerPids(4098)).toEqual([]);
    expect(listenerPids(4097)).toEqual([]);
    expect(
      listenerPids(4001),
      "protected API listener changed after down",
    ).toEqual(protectedBefore.api);
    expect(
      listenerPids(4096),
      "protected engine listener changed after down",
    ).toEqual(protectedBefore.engine);

    foreground = null;
    launcherOutput = "";
    const backgroundUp = await runSandbox(["up"]);
    expect(backgroundUp.code, backgroundUp.stderr).toBe(0);
    const forcedApiPid = Number(
      readFileSync(join(sandbox, "api_server.pid"), "utf8").trim(),
    );
    ownedEnginePid = Number(
      readFileSync(join(sandbox, "opencode_engine.pid"), "utf8").trim(),
    );
    expect(listenerPids(4098)).toEqual([String(forcedApiPid)]);
    expect(listenerPids(4097)).toEqual([String(ownedEnginePid)]);

    process.kill(forcedApiPid, "SIGKILL");
    await waitFor(
      "forced API exit while its engine remains orphaned",
      () =>
        listenerPids(4098).length === 0 &&
        listenerPids(4097).join(",") === String(ownedEnginePid),
      10_000,
    );

    const orphanDown = await runSandbox(["down"]);
    expect(orphanDown.code, orphanDown.stderr).toBe(0);
    expect(existsSync(sandbox)).toBe(false);
    expect(listenerPids(4098)).toEqual([]);
    expect(listenerPids(4097)).toEqual([]);
    expect(
      listenerPids(4001),
      "protected API listener changed after orphan cleanup",
    ).toEqual(protectedBefore.api);
    expect(
      listenerPids(4096),
      "protected engine listener changed after orphan cleanup",
    ).toEqual(protectedBefore.engine);
    ownedEnginePid = null;

    const unrelatedSandbox = mkdtempSync(
      join(tmpdir(), "rhythm-1186-unrelated-"),
    );
    try {
      unrelated = spawn("/bin/sleep", ["60"], { stdio: "ignore" });
      expect(unrelated.pid).toBeDefined();
      mkdirSync(unrelatedSandbox, { recursive: true });
      writeFileSync(
        join(unrelatedSandbox, "api_server.pid"),
        `${unrelated.pid}\n`,
      );
      const refused = await runSandbox(["down"], {
        ...process.env,
        RHYTHM_SANDBOX_DIR: unrelatedSandbox,
      });
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain(
        "no longer belongs to this sandbox; refusing to kill it",
      );
      expect(isAlive(unrelated.pid!), "unrelated PID must remain alive").toBe(
        true,
      );
    } finally {
      if (unrelated && unrelated.exitCode === null) unrelated.kill("SIGTERM");
      rmSync(unrelatedSandbox, { recursive: true, force: true });
    }
  }, 900_000);
});
