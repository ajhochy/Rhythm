/** Explicit opt-in: this preflight never starts a sandbox or contacts a model. */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(__dirname, "../../../..");
const live = process.env.RHYTHM_LIVE_E2E === "1";
const execute = process.env.RHYTHM_COORDINATOR_REAL_MODEL_EXECUTE === "1";
const suite = live ? describe.sequential : describe.skip;
let parent = "";

async function helper(args: string[]) {
  const child = spawn(
    process.execPath,
    [join(root, "tools/dev/coordinator-real-model-harness.mjs"), ...args],
    { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  return { code, output: output.slice(-2_000) };
}

suite("Coordinator real-model acceptance", () => {
  afterAll(async () => {
    if (parent) await rm(parent, { recursive: true, force: true });
  });
  it("preflights profile metadata only", async () => {
    parent = await mkdtemp(join(tmpdir(), "rhythm-coordinator-real-receipt-"));
    const out = join(parent, "preflight");
    const result = await helper(["--out", out]);
    expect(result.code, result.output).toBe(0);
    const receipt = JSON.parse(
      await readFile(join(out, "receipt.json"), "utf8"),
    );
    expect(receipt.status).toBe("prepared_no_sandbox_or_provider_call");
    expect(receipt.model).toMatchObject({
      profileDefault: "claude-sonnet-5-5",
      sessionOverride: "claude-opus-5-5",
    });
    expect(receipt.humanApprovalExecuted).toBe(false);
  }, 60_000);

  it.skipIf(!execute)(
    "captures actual model/tool evidence but never approves a card",
    async () => {
      const out = join(parent, "executed");
      const result = await helper(["--out", out, "--execute"]);
      expect(result.code, result.output).toBe(0);
      const receipt = JSON.parse(
        await readFile(join(out, "receipt.json"), "utf8"),
      );
      expect(receipt.status).toBe("captured_for_independent_review");
      expect(receipt.humanApprovalExecuted).toBe(false);
      expect(receipt.turns).toHaveLength(4);
      expect(
        new Set(
          receipt.turns.map(
            (turn: { userMessage: string }) => turn.userMessage,
          ),
        ).size,
      ).toBe(4);
      expect(
        receipt.turns.every(
          (turn: { engineMessages: unknown[]; apiMirrorAfter: unknown[] }) =>
            turn.engineMessages.length > 0 && turn.apiMirrorAfter.length > 0,
        ),
      ).toBe(true);
      expect(receipt.criteria.c1.state).toBe("captured_for_review");
      expect(receipt.criteria.c2.state).toBe("captured_for_review");
      expect(receipt.criteria.c3.state).toBe("captured_for_review");
      expect(receipt.observations[0].pendingRootCards).toHaveLength(1);
      expect(receipt.turns[0].approvalCardsAfterTurn).toHaveLength(1);
      expect(receipt.turns[1].approvalCardsAfterTurn).toHaveLength(2);
      expect(receipt.criteria.c4.state).toBe("not_run");
      expect(receipt.criteria.c6.state).toBe("not_run");
    },
    960_000,
  );
});
