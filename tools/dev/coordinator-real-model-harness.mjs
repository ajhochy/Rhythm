#!/usr/bin/env node
/**
 * Opt-in bounded real-model evidence harness. It uses only stock sandbox.sh,
 * the actual engine/MCP route, and a one-account ephemeral provider fixture.
 * It never makes an approval decision. A read-only card list supports receipt
 * linkage; the receipt is review evidence, never an automatic acceptance verdict.
 */
import { createECDH, createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "../..");
const getArg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const boundedIntegerArg = (name, fallback, min, max) => {
  const raw = getArg(name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (value < min || value > max)
    throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
};
const outArg = getArg("--out");
if (!outArg || outArg.startsWith("-"))
  throw new Error("--out <empty receipt directory> is required");
const OUT = resolve(outArg),
  execute = process.argv.includes("--execute");
const scheduledLive = process.argv.includes("--scheduled-live"),
  retainSandbox = process.argv.includes("--retain-sandbox"),
  openaiOnlyPrepare = process.argv.includes("--openai-only-prepare");
const live = process.env.RHYTHM_LIVE_E2E === "1",
  go = process.env.RHYTHM_COORDINATOR_REAL_MODEL_GO === "1";
const sourceSha = process.env.RHYTHM_LIVE_SOURCE_SHA ?? null;
const token = "e02-synthetic-session-not-a-secret";
const ports = { api: 4398, engine: 4397, gateway: 4399 };
const nativeMemorySourceId = "memory/fact/coordinator-rehearsal.md";
const nativeMemoryQuery = "synthetic rehearsal brief fixture task summary UTC";
const nativeMemoryNote = [
  "---",
  "kind: fact",
  "status: stable",
  "title: Synthetic coordinator rehearsal reference",
  "---",
  "Synthetic rehearsal brief: implement a fixture-only task-summary function that returns the title Synthetic rehearsal brief and UTC start/end range 2026-10-07T12:00:00Z through 2026-10-07T12:30:00Z, with one focused test.",
  "",
].join("\n");
const realEngraphBinary = join(homedir(), ".local", "bin", "engraph");
const maxRootTurns = 4,
  maxEngineRequests = 24,
  maxOutputTokens = 5_000,
  perRequestMs = boundedIntegerArg("--per-request-seconds", 180, 30, 180) * 1_000,
  totalMs = boundedIntegerArg("--total-minutes", 15, 5, 15) * 60_000;
const protectedPorts = [4001, 4002, 4096, 49333];
let activeDeadline = 0;
const boundedTimeoutMs = (cap = perRequestMs) => {
  const remaining = activeDeadline - Date.now();
  if (activeDeadline && remaining <= 0)
    throw new Error("total harness timeout exceeded");
  return activeDeadline ? Math.min(cap, remaining) : cap;
};
const callerHome = process.env.HOME;
if (typeof callerHome !== "string" || !callerHome.startsWith("/"))
  throw new Error(
    "a nonempty absolute caller HOME is required for stock sandbox validation",
  );
const sha = (v) =>
  createHash("sha256")
    .update(Buffer.isBuffer(v) ? v : String(v))
    .digest("hex");
const opaque = (v) => (typeof v === "string" ? sha(v).slice(0, 16) : null);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
if (!live) throw new Error("RHYTHM_LIVE_E2E=1 is required");
if (sourceSha && !/^[0-9a-f]{40}$/.test(sourceSha))
  throw new Error("RHYTHM_LIVE_SOURCE_SHA must be a full SHA");
if ((scheduledLive || retainSandbox) && !execute)
  throw new Error("--scheduled-live and --retain-sandbox require --execute");
if (openaiOnlyPrepare && (!execute || !retainSandbox))
  throw new Error("--openai-only-prepare requires --execute --retain-sandbox");

async function run(
  command,
  args,
  { env = process.env, timeout = 240_000, cwd = root } = {},
) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  const term = setTimeout(() => child.kill("SIGTERM"), timeout),
    kill = setTimeout(() => child.kill("SIGKILL"), timeout + 5_000);
  try {
    return {
      code: await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      }),
      output: output.slice(-2_000),
    };
  } finally {
    clearTimeout(term);
    clearTimeout(kill);
  }
}
async function listeners(portList) {
  const result = {};
  for (const port of portList) {
    const r = await run(
      "/usr/sbin/lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"],
      { timeout: 15_000 },
    );
    if (![0, 1].includes(r.code))
      throw new Error(`listener inspection failed for ${port}`);
    result[port] = r.output.trim().split("\n").filter(Boolean);
  }
  return result;
}
async function commandDigest(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const digest = createHash("sha256");
  child.stdout.on("data", (chunk) => digest.update(chunk));
  child.stderr.on("data", (chunk) => digest.update(chunk));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`source digest command failed: ${command}`);
  return digest.digest("hex");
}
async function sourceIdentity() {
  const head = await run("git", ["rev-parse", "HEAD"], { timeout: 15_000 });
  if (head.code !== 0 || !/^[0-9a-f]{40}$/m.test(head.output.trim()))
    throw new Error("cannot resolve source git HEAD");
  const dirtySha256 = await commandDigest("git", [
    "diff",
    "--binary",
    "HEAD",
    "--",
    "apps/api_server",
    "apps/mcp_server",
    "apps/opencode_fork",
    "tools/dev",
  ]);
  const statusSha256 = await commandDigest("git", ["status", "--porcelain=v1"]);
  const headSha = head.output.trim();
  if (sourceSha && sourceSha !== headSha)
    throw new Error("RHYTHM_LIVE_SOURCE_SHA does not match current HEAD");
  const engine = join(
    root,
    "apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin/opencode",
  );
  if (!existsSync(engine)) throw new Error("prebuilt fork engine is missing");
  const version = await run(engine, ["--version"], { timeout: 15_000 });
  if (version.code !== 0)
    throw new Error("prebuilt fork engine version probe failed");
  return {
    headSha,
    dirtySha256,
    statusSha256,
    harnessSha256: sha(await readFile(import.meta.filename)),
    engineBinarySha256: sha(await readFile(engine)),
    engineVersion: safe(version.output.trim()),
  };
}
function sources() {
  return {
    anthropicAccounts: join(
      homedir(),
      "Library/Application Support/Rhythm/anthropic-accounts.json",
    ),
    db: join(
      homedir(),
      "Library/Application Support/Rhythm Electron/rhythm.db",
    ),
  };
}
const profileSelect =
  "SELECT id,label,icon,command,is_agent,enabled,is_manager,system_prompt,model_provider,model_id,oc_agent,allowed_mcps_json,allowed_skills_json,allowed_delegates_json,core_permissions_json,reasoning_effort,locked,revision FROM agent_configs WHERE id=?";
function sourceProfiles() {
  const require = createRequire(join(root, "apps/api_server/package.json")),
    Database = require("better-sqlite3");
  const db = new Database(sources().db, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const secretary = db.prepare(profileSelect).get("secretary");
    if (
      !secretary ||
      secretary.model_provider !== "anthropic" ||
      secretary.model_id !== "claude-sonnet-5-5"
    )
      throw new Error("Secretary default is not anthropic/claude-sonnet-5-5");
    const find = db.prepare(profileSelect);
    const parseDelegates = (profile, label) => {
      let delegates;
      try {
        delegates = JSON.parse(profile.allowed_delegates_json ?? "[]");
      } catch {
        throw new Error(`${label} delegate allowlist is malformed`);
      }
      if (!Array.isArray(delegates) || !delegates.every((id) => typeof id === "string"))
        throw new Error(`${label} delegate allowlist is not a string array`);
      return delegates;
    };
    // The proposal lane needs this exact configured edge, plus the manager's
    // actual reviewer dependency. Do not copy the whole profile catalog or
    // synthesize a replacement profile in the fixture.
    const secretaryDelegates = parseDelegates(secretary, "Secretary");
    if (!secretaryDelegates.includes("workflow-orchestrator"))
      throw new Error("Secretary does not delegate to Workflow Orchestrator");
    const workflow = find.get("workflow-orchestrator");
    if (!workflow?.enabled)
      throw new Error("Workflow Orchestrator is not an enabled source profile");
    const workflowDelegates = parseDelegates(workflow, "Workflow Orchestrator");
    if (!workflowDelegates.includes("verification-gate"))
      throw new Error("Workflow Orchestrator does not delegate to Verification Gate");
    const reviewer = find.get("verification-gate");
    if (!reviewer?.enabled)
      throw new Error("Verification Gate is not an enabled source profile");
    const rows = [secretary, workflow, reviewer];
    const scheduled = find.get("opencode");
    if (!scheduled?.enabled)
      throw new Error(
        "active source opencode profile is required for scheduled live test",
      );
    return { coordinator: rows, scheduled };
  } finally {
    db.close();
  }
}
function skillSlug(name) {
  if (typeof name !== "string" || !name || /[\\/]|\.\./.test(name))
    throw new Error("Coding Agent skill name is unsafe");
  return name.replace(/[^a-zA-Z0-9_-]+/g, "__");
}
function sourceCodingProfile() {
  const require = createRequire(join(root, "apps/api_server/package.json"));
  const Database = require("better-sqlite3");
  const db = new Database(sources().db, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const profile = db.prepare(profileSelect).get("coding-agent");
    if (
      !profile ||
      profile.enabled !== 1 ||
      profile.model_provider !== "openai" ||
      profile.model_id !== "gpt-6.1-sol"
    )
      throw new Error(
        "Coding Agent is not the active openai/gpt-6.1-sol profile",
      );
    let skills;
    try {
      skills = JSON.parse(profile.allowed_skills_json ?? "[]");
    } catch {
      throw new Error("Coding Agent skill allowlist is malformed");
    }
    if (
      !Array.isArray(skills) ||
      !skills.every((skill) => typeof skill === "string")
    )
      throw new Error("Coding Agent skill allowlist is not a string array");
    const rootDir = join(homedir(), ".config", "opencode", "skills");
    return {
      profile,
      skills: skills.map((name) => ({
        name,
        source: join(rootDir, skillSlug(name), "SKILL.md"),
      })),
    };
  } finally {
    db.close();
  }
}
async function sourceOpenAIAccount() {
  const file = join(
    homedir(),
    "Library/Application Support/Rhythm/openai-accounts.json",
  );
  const store = JSON.parse(await readFile(file, "utf8"));
  const accounts = Array.isArray(store?.accounts) ? store.accounts : [];
  const account = accounts.find((item) => item?.id === store?.defaultAccountId);
  if (
    !account ||
    account.status !== "ok" ||
    typeof account.access !== "string" ||
    account.access.length < 20 ||
    !Number.isFinite(Number(account.expires)) ||
    Number(account.expires) - Date.now() <= 20 * 60_000
  )
    throw new Error("default OpenAI account is unavailable or too near expiry");
  const accessFingerprint = opaque(account.access);
  const accessShape =
    account.access.split(".").length === 3 ? "jwt_three_segments" : "other";
  if (accessShape !== "jwt_three_segments")
    throw new Error("default OpenAI account access is not JWT-shaped");
  // The codex account plugin only reads these fields for a fresh account.
  // Do not copy a refresh token into a disposable real-model fixture.
  return {
    account: {
      id: account.id,
      access: account.access,
      expires: Number(account.expires),
      status: "ok",
      ...(typeof account.chatgptAccountId === "string"
        ? { chatgptAccountId: account.chatgptAccountId }
        : {}),
    },
    defaultAccountId: account.id,
    accessFingerprint,
    accessShape,
  };
}
async function sourceAccess() {
  const store = JSON.parse(
    await readFile(sources().anthropicAccounts, "utf8"),
  );
  const account = Array.isArray(store?.accounts)
    ? store.accounts.find((entry) => entry?.id === store.defaultAccountId)
    : null;
  if (
    !account ||
    account.status !== "ok" ||
    typeof account.access !== "string" ||
    account.access.length < 20
  )
    throw new Error("active Anthropic default account is unavailable");
  // The API refreshes Anthropic accounts at startup when they expire within
  // 20 minutes. This fixture intentionally has no usable refresh token, so
  // reject before startup unless it covers both that server margin and the
  // bounded test interval.
  const requiredLifetimeMs = Math.max(
    20 * 60_000,
    totalMs + 2 * 60_000,
  );
  if (
    !Number.isFinite(Number(account.expires)) ||
    Number(account.expires) - Date.now() <= requiredLifetimeMs
  )
    throw new Error(
      "active Anthropic default cannot cover the bounded run without refresh",
    );
  return {
    access: account.access,
    expires: Number(account.expires),
    accessFingerprint: opaque(account.access),
  };
}
async function accountFixtureSnapshot(path) {
  const store = JSON.parse(await readFile(path, "utf8"));
  const account = Array.isArray(store?.accounts)
    ? store.accounts.find((entry) => entry?.id === store.defaultAccountId)
    : null;
  if (!account || typeof account.access !== "string")
    throw new Error("OpenAI fixture has no selected default account");
  return {
    selectedDefault: opaque(account.id),
    status: account.status ?? null,
    accessFingerprint: opaque(account.access),
    accessShape:
      account.access.split(".").length === 3 ? "jwt_three_segments" : "other",
    refreshPresent: typeof account.refresh === "string",
    expiresAt: Number.isFinite(Number(account.expires))
      ? Number(account.expires)
      : null,
  };
}
const normalizeSkillBody = (source) =>
  String(source)
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .trim();
const cleanEnv = (values) => ({
  PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
  LANG: "en_US.UTF-8",
  // sandbox.sh reads the caller HOME while rejecting live DB paths, then
  // replaces HOME with its own isolated home before either process starts.
  HOME: callerHome,
  ...values,
});
async function until(read, label, timeout = perRequestMs) {
  const end = Math.min(Date.now() + timeout, activeDeadline || Infinity);
  while (Date.now() < end) {
    const value = await read();
    if (value) return value;
    await sleep(400);
  }
  throw new Error(`${label} timed out`);
}
async function engineProviderModels(providerId) {
  boundedTimeoutMs();
  const response = await fetch(
    `http://127.0.0.1:${ports.engine}/config/providers?directory=${encodeURIComponent(root)}`,
    { signal: AbortSignal.timeout(boundedTimeoutMs()) },
  );
  const payload = await response.text();
  if (!response.ok)
    throw new Error(
      `engine provider catalog returned ${response.status}: ${safe(payload).slice(0, 1_200)}`,
    );
  const providers = JSON.parse(payload)?.providers;
  const provider = Array.isArray(providers)
    ? providers.find((candidate) => candidate?.id === providerId)
    : null;
  const models = provider?.models;
  if (Array.isArray(models))
    return models
      .map((model) => model?.id)
      .filter((id) => typeof id === "string");
  if (models && typeof models === "object")
    return Object.entries(models).map(([id, model]) =>
      typeof model?.id === "string" ? model.id : id,
    );
  return [];
}
function text(message) {
  return (message?.parts ?? [])
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}
function transportTool(part) {
  return part?.tool ?? part?.name ?? null;
}
function toolAction(part) {
  const input = part?.state?.input ?? part?.input ?? {};
  return typeof input?.action === "string" ? input.action : null;
}
function targetTool(part) {
  const input = part?.state?.input ?? part?.input ?? {};
  const candidates = [
    input?.name,
    input?.toolName,
    input?.tool,
    input?.input?.name,
    input?.input?.tool,
    input?.arguments?.name,
    input?.arguments?.tool,
  ];
  return (
    candidates.find(
      (candidate) =>
        typeof candidate === "string" &&
        candidate.length > 0 &&
        candidate !== "mcp",
    ) ?? null
  );
}
function name(part) {
  const transport = transportTool(part);
  // `mcp` is only a transport wrapper. A catalog describe/list can mention a
  // tool name without invoking it, so only an execute action qualifies. The
  // current engine labels this wrapper `mcp_dispatch`; keep both observed
  // transport spellings explicit rather than treating ordinary tool arguments
  // as tool calls.
  if (
    (transport === "mcp" || transport === "mcp_dispatch") &&
    toolAction(part) === "execute"
  )
    return targetTool(part) ?? transport;
  return transport;
}
function safe(value) {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? null);
  const redacted = raw
    .replace(
      /(?:Bearer\s+|sk-ant-|sk-[A-Za-z0-9_-]{8,})[^\s",}]+/giu,
      "[redacted]",
    )
    .replace(/\/Users\/[^\s",}]+/gu, "[local-path]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, "[email]");
  return redacted.length <= 12_000
    ? redacted
    : `${redacted.slice(0, 12_000)}…[truncated]`;
}
function sanitized(messages) {
  return messages.map((m) => ({
    message: opaque(m?.info?.id ?? m?.id),
    parent: opaque(m?.info?.parentID ?? m?.parentID),
    role: m?.info?.role ?? m?.role ?? null,
    providerId: m?.info?.providerID ?? null,
    modelId: m?.info?.modelID ?? null,
    agent: m?.info?.agent ?? m?.info?.agentName ?? null,
    completed: Boolean(m?.info?.time?.completed),
    error: Boolean(m?.info?.error ?? m?.error),
    text: safe(text(m)),
    tools: (m?.parts ?? [])
      .filter((p) => p?.type === "tool")
      .map((p) => ({
        transportTool: transportTool(p),
        action: toolAction(p),
        targetTool: targetTool(p),
        name: name(p),
        input: safe(p?.state?.input ?? p?.input ?? null),
        output: safe(p?.state?.output ?? p?.output ?? null),
        error: safe(p?.state?.error ?? p?.error ?? null),
      })),
  }));
}
function mirrorSummary(messages) {
  return messages.map((message, index) => ({
    order: index + 1,
    message: opaque(message?.id ?? message?.info?.id),
    role: message?.role ?? message?.info?.role ?? null,
    rawText: safe(message?.rawText ?? message?.strippedText ?? ""),
  }));
}
function approvalSummary(approval) {
  return {
    approval: opaque(approval?.id),
    session: opaque(approval?.sessionId),
    status: approval?.status ?? null,
    action: safe(approval?.action ?? ""),
    securityAction: approval?.securityAction ?? null,
    preview: safe(approval?.preview ?? ""),
    consequence: safe(approval?.consequence ?? ""),
    payloadDigest: approval?.payloadDigest ?? null,
    createdAt: approval?.createdAt ?? null,
    expiresAt: approval?.expiresAt ?? null,
    lane: approval?.lane ?? null,
    laneReason: approval?.laneReason ?? null,
  };
}
function calls(messages) {
  return messages.flatMap((message) =>
    (message?.parts ?? [])
      .filter((part) => part?.type === "tool")
      .map((part) => ({
        message: opaque(message?.info?.id ?? message?.id),
        transportTool: transportTool(part),
        action: toolAction(part),
        targetTool: targetTool(part),
        name: name(part),
        input: safe(part?.state?.input ?? part?.input ?? null),
        output: safe(part?.state?.output ?? part?.output ?? null),
        error: safe(part?.state?.error ?? part?.error ?? null),
      })),
  );
}
function terminal(messages, user) {
  const userId = user?.info?.id ?? user?.id,
    tree = new Set([userId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of messages) {
      const parent = m?.info?.parentID ?? m?.parentID,
        messageId = m?.info?.id ?? m?.id;
      if (tree.has(parent) && !tree.has(messageId)) {
        tree.add(messageId);
        changed = true;
      }
    }
  }
  const assistants = messages.filter(
    (m) =>
      tree.has(m?.info?.id ?? m?.id) &&
      (m?.info?.role ?? m?.role) === "assistant",
  );
  if (assistants.some((m) => m?.info?.error ?? m?.error))
    throw new Error("engine reported an assistant/provider error");
  const done = assistants
    .filter(
      (m) =>
        Boolean(m?.info?.time?.completed) &&
        (m?.info?.finish === "stop" || m?.info?.finish === "end_turn"),
    )
    .at(-1);
  return done ? { done, assistants } : null;
}

const receipt = {
  kind: "coordinator-real-model-acceptance",
  startedAt: new Date().toISOString(),
  sourceSha,
  ports,
  model: {
    provider: "anthropic",
    profileDefault: "claude-sonnet-5-5",
    sessionOverride: "claude-opus-5-5",
    sdkSessionCreationDefault: "anthropic/claude-sonnet-5-5",
    foregroundPromptOverride: "anthropic/claude-opus-5-5",
  },
  bounds: {
    rootUserTurns: maxRootTurns,
    postTurnAssistantMessageAbortThreshold: maxEngineRequests,
    testOnlyAgentStepsPerTurn: 12,
    enforcedOutputTokensPerProviderCall: maxOutputTokens,
    perRequestSeconds: perRequestMs / 1_000,
    totalMinutes: totalMs / 60_000,
    agentStepsScope: "per staged agent and rooted user turn",
    providerRequestTotal:
      "not hard-capped by the harness; engine retries, title, and compaction calls are recorded as observed only",
  },
  scriptedModel: false,
  humanApprovalExecuted: false,
  criteria: {},
  turns: [],
  observations: [],
};

async function main() {
  await mkdir(OUT, { recursive: false, mode: 0o700 });
  const save = () =>
    writeFile(
      join(OUT, "receipt.json"),
      JSON.stringify(receipt, null, 2) + "\n",
      { mode: 0o600 },
  );
  receipt.source = await sourceIdentity();
  const coding = sourceCodingProfile();
  const sourceProfilesResult = openaiOnlyPrepare ? null : sourceProfiles();
  const coordinatorProfiles = sourceProfilesResult?.coordinator ?? [];
  const profiles = openaiOnlyPrepare
    ? [coding.profile]
    : [
        ...new Map(
          [
            ...coordinatorProfiles,
            sourceProfilesResult.scheduled,
            coding.profile,
          ].map((profile) => [profile.id, profile]),
        ).values(),
      ];
  receipt.profileProjection = {
    source:
      "read-only source SQLite Secretary -> Workflow Orchestrator -> Verification Gate dependency copy, then existing fixture projection endpoint",
    profiles: profiles.map((p) => ({
      id: p.id,
      promptSha256: sha(p.system_prompt ?? ""),
      revision: p.revision,
    })),
    delegateProfileCount: openaiOnlyPrepare ? 0 : coordinatorProfiles.length - 1,
  };
  receipt.codingProfile = {
    source: "read-only active Electron profile metadata",
    id: coding.profile.id,
    revision: coding.profile.revision,
    model: `${coding.profile.model_provider}/${coding.profile.model_id}`,
    promptSha256: sha(coding.profile.system_prompt ?? ""),
    requestedSkills: coding.skills.map((skill) => skill.name),
  };
  if (!openaiOnlyPrepare) {
    receipt.scheduledProfile = {
      source: "read-only active Electron profile metadata",
      id: sourceProfilesResult.scheduled.id,
      revision: sourceProfilesResult.scheduled.revision,
      ocAgent: sourceProfilesResult.scheduled.oc_agent ?? null,
    };
  }
  if (!execute) {
    receipt.status = "prepared_no_sandbox_or_provider_call";
    receipt.criteria = Object.fromEntries(
      ["c1", "c2", "c3", "c5", "c7", "c8"].map((c) => [c, "not_run"]),
    );
    receipt.criteria.c4 = "not_run_requires_human_approval";
    receipt.criteria.c6 = "not_run_requires_human_approval";
    await save();
    return;
  }
  if (!go)
    throw new Error("--execute requires RHYTHM_COORDINATOR_REAL_MODEL_GO=1");
  const nonce = randomUUID(),
    fixtureRoot = `/private/tmp/rhythm-coordinator-real-fixture-${nonce}`,
    sandbox = `/private/tmp/rhythm-coordinator-real-sandbox-${nonce}`,
    configDir = join(fixtureRoot, "opencode-config"),
    accountPath = join(fixtureRoot, "anthropic-accounts.json"),
    openaiAccountPath = join(fixtureRoot, "openai-accounts.json"),
    humanCapabilityPath = join(fixtureRoot, ".human-approval-read.capability"),
    dbPath = join(fixtureRoot, "rhythm.db"),
    journal = join(fixtureRoot, "dayflow-journal.sqlite"),
    sandboxAuthPath = join(sandbox, "home/.local/share/opencode/auth.json");
  const humanCapability = `${randomUUID()}${randomUUID()}`;
  const humanCapabilitySha256 = sha(humanCapability);
  const approvalKey = createECDH("prime256v1");
  approvalKey.generateKeys();
  const humanApprovalPublicKey = approvalKey.getPublicKey().toString("base64");
  let anthropicAccount,
    openaiAccount,
    env,
    adapter,
    attemptedUp = false,
    completedForHandoff = false,
    sandboxAuthRemoved = false,
    primaryOperationError = null,
    ownedForegroundSessionId = null;
  receipt.normalRuntimeListenersBefore = await listeners(protectedPorts);
  const deadline = Date.now() + totalMs;
  activeDeadline = deadline;
  try {
    const occupied = await listeners(Object.values(ports));
    if (Object.values(occupied).some((rows) => rows.length))
      throw new Error("real-model sandbox ports are occupied");
    const seeded = await run(process.execPath, [
      join(root, "tools/dev/sandbox_fixture.mjs"),
      fixtureRoot,
    ]);
    if (seeded.code !== 0)
      throw new Error("stock synthetic fixture generation failed");
    // Retained runs may attach a read-only evidence helper after this process
    // exits. Keep the synthetic capability in the private fixture only: it is
    // never included in receipts, output, or an approval-mutating route.
    await writeFile(humanCapabilityPath, humanCapability, { mode: 0o400 });
    await chmod(dbPath, 0o600);
    if (openaiOnlyPrepare) {
      openaiAccount = await sourceOpenAIAccount();
    } else {
      anthropicAccount = await sourceAccess();
      receipt.anthropicFixture = {
        source: "read-only active Anthropic accounts store default",
        selectedDefaultAccessFingerprint: anthropicAccount.accessFingerprint,
        expiresAt: anthropicAccount.expires,
        refresh: "omitted from fixture",
      };
      if (retainSandbox) openaiAccount = await sourceOpenAIAccount();
    }
    const require = createRequire(join(root, "apps/api_server/package.json")),
      Database = require("better-sqlite3"),
      db = new Database(dbPath);
    try {
      db.prepare("UPDATE agent_configs SET enabled=0").run();
      const insert = db.prepare(
        `INSERT INTO agent_configs(id,label,icon,command,is_agent,enabled,is_manager,system_prompt,model_provider,model_id,oc_agent,allowed_mcps_json,allowed_skills_json,allowed_delegates_json,core_permissions_json,reasoning_effort,locked,revision) VALUES(@id,@label,@icon,@command,@is_agent,1,@is_manager,@system_prompt,@model_provider,@model_id,@oc_agent,@allowed_mcps_json,@allowed_skills_json,@allowed_delegates_json,@core_permissions_json,@reasoning_effort,0,@revision)`,
      );
      for (const profile of profiles) {
        db.prepare("DELETE FROM agent_configs WHERE id=?").run(profile.id);
        insert.run(profile);
      }
      db.prepare("UPDATE agent_scheduled_tasks SET enabled=0").run();
    } finally {
      db.close();
    }
    await chmod(dbPath, 0o400);
    if (!openaiOnlyPrepare) {
      const flow = new Database(journal);
      try {
        flow.exec(
          "CREATE TABLE timeline_cards (id INTEGER PRIMARY KEY,start_ts INTEGER,end_ts INTEGER,title TEXT,summary TEXT,detailed_summary TEXT,category TEXT,subcategory TEXT,metadata TEXT,is_deleted INTEGER);",
        );
        flow
          .prepare("INSERT INTO timeline_cards VALUES(1,?,?,?,?,?,?,?, ?,0)")
          .run(
            Math.floor(Date.parse("2026-10-07T12:00:00Z") / 1000),
            Math.floor(Date.parse("2026-10-07T12:30:00Z") / 1000),
            "Synthetic rehearsal brief",
            "Synthetic approved Dayflow fixture for bounded Coordinator evidence.",
            "",
            "work",
            "",
            "{}",
          );
      } finally {
        flow.close();
      }
      await chmod(journal, 0o400);
    }
    await mkdir(configDir, { recursive: true, mode: 0o700 });
    const skillsDir = join(configDir, "skills");
    const availableCodingSkills = [];
    const unavailableCodingSkills = [];
    for (const skill of coding.skills) {
      if (!existsSync(skill.source)) {
        unavailableCodingSkills.push(skill.name);
        continue;
      }
      const target = join(skillsDir, skillSlug(skill.name), "SKILL.md");
      await mkdir(join(skillsDir, skillSlug(skill.name)), {
        recursive: true,
        mode: 0o700,
      });
      await writeFile(target, await readFile(skill.source), { mode: 0o400 });
      availableCodingSkills.push({
        name: skill.name,
        sha256: sha(await readFile(skill.source)),
      });
    }
    receipt.codingProfile.skills = {
      stagedManaged: availableCodingSkills,
      unavailableDraftOrMissing: unavailableCodingSkills,
    };
    // Stage the reviewed Workflow Orchestrator candidate only in this owned
    // fixture. The host skill must match the reviewed base before its narrow
    // patch is applied, and the result must match the independently reviewed
    // candidate digests before the engine starts.
    const workflowSource = join(
      homedir(),
      ".config",
      "opencode",
      "skills",
      "workflow-orchestrator",
      "SKILL.md",
    );
    const workflowPatch = join(
      root,
      "tools/dev/fixtures/approval-scope/workflow-orchestrator.approved-scope.patch",
    );
    const workflowSourceSha256 =
      "605394cfdae5aab82997a28bd06c9a5a79b3e996f2293766cf9673e34d65d791";
    const workflowCandidateSha256 =
      "82e69ad3850e7e4cd80c2f2c8200b58bffa5d132a52b0e11eab1d643f7ea67a1";
    const workflowCandidateBodySha256 =
      "c4bb6a0c376de4699265ef66b7c363d733f17070541c90884daa55ff0d31e984";
    const workflowFixtureDir = join(skillsDir, "workflow-orchestrator");
    const workflowFixtureSkill = join(workflowFixtureDir, "SKILL.md");
    const workflowHostBody = await readFile(workflowSource);
    if (sha(workflowHostBody) !== workflowSourceSha256)
      throw new Error("Workflow Orchestrator source digest changed before staging");
    await mkdir(workflowFixtureDir, { recursive: true, mode: 0o700 });
    await writeFile(workflowFixtureSkill, workflowHostBody, { mode: 0o600 });
    const workflowPatchResult = await run(
      "/usr/bin/patch",
      ["--batch", "--forward", "-p1", "-i", workflowPatch],
      { cwd: skillsDir, timeout: 15_000 },
    );
    if (workflowPatchResult.code !== 0)
      throw new Error("Workflow Orchestrator fixture patch failed");
    const workflowCandidate = await readFile(workflowFixtureSkill);
    if (
      sha(workflowCandidate) !== workflowCandidateSha256 ||
      sha(normalizeSkillBody(workflowCandidate)) !== workflowCandidateBodySha256
    )
      throw new Error("Workflow Orchestrator fixture digest did not match review");
    await chmod(workflowFixtureSkill, 0o400);
    receipt.workflowOrchestratorFixture = {
      source: "host skill copied and patched only in the owned fixture",
      sourceSha256: workflowSourceSha256,
      patchSha256: sha(await readFile(workflowPatch)),
      candidateSha256: workflowCandidateSha256,
      normalizedBodySha256: workflowCandidateBodySha256,
    };
    const plugin = join(fixtureRoot, "fixture-env-plugin");
    await mkdir(plugin, { recursive: true, mode: 0o700 });
    await writeFile(
      join(plugin, "package.json"),
      JSON.stringify({ type: "module", main: "./index.js" }),
      { mode: 0o400 },
    );
    await writeFile(
      join(plugin, "index.js"),
      `${openaiOnlyPrepare ? "" : `process.env.RHYTHM_ACCOUNTS_FILE=${JSON.stringify(accountPath)};`}${openaiAccount ? ` process.env.RHYTHM_OPENAI_ACCOUNTS_FILE=${JSON.stringify(openaiAccountPath)};` : ""} export default async()=>({});\n`,
      { mode: 0o400 },
    );
    await writeFile(
      join(configDir, "opencode.json"),
      JSON.stringify({
        model: openaiOnlyPrepare
          ? "openai/gpt-6.1-sol"
          : "anthropic/claude-opus-5-5",
        small_model: openaiOnlyPrepare
          ? "openai/gpt-6.1-sol"
          : "anthropic/claude-opus-5-5",
        agent: Object.fromEntries(
          profiles.map((profile) => [
            profile.oc_agent || profile.id,
            { steps: 12 },
          ]),
        ),
        plugin: [
          plugin,
          ...(!openaiOnlyPrepare
            ? [
                join(
                  root,
                  "apps/api_server/opencode_plugins/rhythm-anthropic-accounts",
                ),
              ]
            : []),
        ],
        mcp: {
          rhythm: {
            type: "local",
            timeout: 600000,
            command: [
              process.execPath,
              join(root, "apps/mcp_server/dist/index.js"),
            ],
            environment: {
              RHYTHM_API_URL: `http://127.0.0.1:${ports.api}`,
              RHYTHM_AGENT_URL: `http://127.0.0.1:${ports.api}`,
              RHYTHM_API_TOKEN: token,
            },
          },
        },
      }),
      { mode: 0o400 },
    );
    await writeFile(
      join(configDir, "auth.json"),
      JSON.stringify({
        ...(!openaiOnlyPrepare
          ? {
              // The engine requires a schema-complete entry to activate the
              // Anthropic catalog/auth loader. The accounts plugin resolves
              // real access from the 0400 fixture.
              anthropic: {
                type: "oauth",
                access: "fixture-marker-not-a-credential",
                refresh: "fixture-marker-not-a-credential",
                expires: anthropicAccount.expires,
              },
            }
          : {}),
        ...(openaiAccount
          ? {
              openai: {
                type: "oauth",
                access: "fixture-marker-not-a-credential",
                refresh: "fixture-marker-not-a-credential",
                // The engine needs a schema-complete OAuth entry. Expiry zero
                // is deliberately older than the protected account-store entry,
                // preventing API startup from adopting this synthetic marker.
                expires: 0,
              },
            }
          : {}),
      }),
      { mode: 0o400 },
    );
    if (anthropicAccount) {
      await writeFile(
        accountPath,
        JSON.stringify({
          version: 1,
          accounts: [
            {
              id: "fixture",
              label: "Fixture",
              access: anthropicAccount.access,
              refresh: "fixture-marker-not-a-credential",
              expires: anthropicAccount.expires,
              status: "ok",
            },
          ],
          defaultAccountId: "fixture",
          routing: {},
        }),
        { mode: 0o400 },
      );
    }
    if (openaiAccount) {
      await writeFile(
        openaiAccountPath,
        JSON.stringify({
          version: 1,
          accounts: [openaiAccount.account],
          defaultAccountId: openaiAccount.defaultAccountId,
          routing: {},
        }),
        { mode: 0o600 },
      );
      receipt.codingProfile.openaiFixture = {
        beforeStartup: await accountFixtureSnapshot(openaiAccountPath),
        routingStore:
          "single-account fixture; writable only for sandbox session routing",
        engineAuthSentinel: {
          accessShape: "synthetic_marker",
          refreshShape: "synthetic_marker",
          expiresAt: 0,
        },
      };
    }
    anthropicAccount = undefined;
    adapter = join(fixtureRoot, "sandbox-node.py");
    const server = join(root, "apps/api_server/dist/server.js");
    const nativeMemoryPath = join(sandbox, "vault", nativeMemorySourceId);
    receipt.nativeMemoryFixture = openaiOnlyPrepare
      ? { state: "not_staged_openai_only_prepare" }
      : {
          state: "staged_before_stock_api_start",
          sourceId: nativeMemorySourceId,
          noteSha256: sha(nativeMemoryNote),
        };
    const adapterLines = [
      "#!/usr/bin/python3 -B",
      "import os,sys",
      `node=${JSON.stringify(process.execPath)}`,
      `server=${JSON.stringify(server)}`,
      "if sys.argv[1:2]==['-e']: os.execv(node,[node,*sys.argv[1:]])",
      `if sys.argv[1:] != [server,'--parent-pid=1','--rhythm-sandbox='+${JSON.stringify(sandbox)}]: raise SystemExit('unexpected sandbox node invocation')`,
      ...(openaiOnlyPrepare
        ? []
        : [
            `native_memory_path=${JSON.stringify(nativeMemoryPath)}`,
            `native_memory_bytes=${JSON.stringify(nativeMemoryNote)}.encode('utf-8')`,
            "if os.path.lexists(native_memory_path):",
            "    stat=os.stat(native_memory_path)",
            "    if os.path.islink(native_memory_path) or not os.path.isfile(native_memory_path) or open(native_memory_path,'rb').read()!=native_memory_bytes or stat.st_mode & 0o222: raise SystemExit('synthetic native memory fixture drifted')",
            "else:",
            "    os.makedirs(os.path.dirname(native_memory_path),mode=0o700,exist_ok=True)",
            "    with open(native_memory_path,'wb') as stream: stream.write(native_memory_bytes)",
            "    os.chmod(native_memory_path,0o400)",
            `os.environ['RHYTHM_ACCOUNTS_FILE']=${JSON.stringify(accountPath)}`,
          ]),
      ...(openaiAccount
        ? [`os.environ['RHYTHM_OPENAI_ACCOUNTS_FILE']=${JSON.stringify(openaiAccountPath)}`]
        : []),
      "os.environ['RHYTHM_WORKSTREAMS_ENABLED']='true'",
      "os.environ['RHYTHM_MANAGED_CONTEXT_EXPORTS']='1'",
      `os.environ['HUMAN_APPROVAL_CAPABILITY_SHA256']=${JSON.stringify(humanCapabilitySha256)}`,
      `os.environ['HUMAN_APPROVAL_PUBLIC_KEY']=${JSON.stringify(humanApprovalPublicKey)}`,
      "os.environ['OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX']='5000'",
      "# Retained stock sandboxes need their API process outside the helper's process group.",
      "os.setsid()",
      "os.execv(node,[node,*sys.argv[1:]])",
      "",
    ];
    await writeFile(
      adapter,
      adapterLines.join("\n"),
      { mode: 0o700 },
    );
    env = cleanEnv({
      RHYTHM_APPROVED_FIXTURE_ROOT: fixtureRoot,
      RHYTHM_LIVE_DB_PATH: dbPath,
      RHYTHM_SANDBOX_OPENCODE_CONFIG: configDir,
      RHYTHM_SANDBOX_DIR: sandbox,
      RHYTHM_SANDBOX_API_PORT: String(ports.api),
      RHYTHM_SANDBOX_ENGINE_PORT: String(ports.engine),
      RHYTHM_SANDBOX_GATEWAY_PORT: String(ports.gateway),
      RHYTHM_SANDBOX_NODE_BIN: adapter,
      RHYTHM_SANDBOX_SKIP_ENGINE_BUILD: "1",
      RHYTHM_OPTIMIZER_MODE: "shadow",
      RHYTHM_NUMBAT_MONITORING_DISABLED: "1",
    });
    attemptedUp = true;
    const sandboxUp = await run(join(root, "tools/dev/sandbox.sh"), ["up"], {
      env,
      timeout: boundedTimeoutMs(300_000),
    });
    receipt.sandboxStartup = {
      code: sandboxUp.code,
      output: safe(sandboxUp.output),
    };
    if (sandboxUp.code !== 0) throw new Error("stock sandbox up failed");
    if (openaiAccount) {
      const before = receipt.codingProfile.openaiFixture.beforeStartup;
      const after = await accountFixtureSnapshot(openaiAccountPath);
      receipt.codingProfile.openaiFixture.afterStartup = after;
      if (
        before.status !== "ok" ||
        before.accessShape !== "jwt_three_segments" ||
        after.status !== "ok" ||
        after.accessShape !== "jwt_three_segments" ||
        before.accessFingerprint !== after.accessFingerprint
      )
        throw new Error(
          "sandbox startup changed the protected OpenAI fixture account",
        );
    }
    const api = async (
      route,
      body,
      method = body === undefined ? "GET" : "POST",
      extraHeaders = {},
    ) => {
      boundedTimeoutMs();
      const response = await fetch(`http://127.0.0.1:${ports.api}${route}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          origin: "rhythm://app",
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(boundedTimeoutMs()),
      });
      const payload = await response.text();
      if (!response.ok)
        throw new Error(
          `sandbox API ${route} returned ${response.status}: ${safe(payload).slice(0, 1_200)}`,
        );
      return payload ? JSON.parse(payload) : null;
    };
    await until(
      async () => (await api("/opencode/health"))?.status === "ready",
      "engine readiness",
      60_000,
    );
    const requiredProvider = openaiOnlyPrepare ? "openai" : "anthropic";
    const requiredModel = openaiOnlyPrepare
      ? "gpt-6.1-sol"
      : "claude-opus-5-5";
    const providerModels = await engineProviderModels(requiredProvider);
    receipt.engineProviderCatalog = {
      provider: requiredProvider,
      requiredModel,
      modelCount: providerModels.length,
      requiredModelPresent: providerModels.includes(requiredModel),
    };
    if (!receipt.engineProviderCatalog.requiredModelPresent)
      throw new Error(`engine ${requiredProvider} catalog lacks ${requiredModel}`);
    const openaiProviderModels = await engineProviderModels("openai");
    receipt.openaiHandoffCatalog = {
      modelCount: openaiProviderModels.length,
      gpt61SolPresent: openaiProviderModels.includes("gpt-6.1-sol"),
      gpt6LunaPresent: openaiProviderModels.includes("gpt-6-luna"),
      gpt56SolPresent: openaiProviderModels.includes("gpt-5.6-sol"),
    };
    for (const profile of profiles)
      await api(
        `/agent-configs/${encodeURIComponent(profile.id)}/resync-agent-file`,
        {},
      );
    if (!openaiOnlyPrepare) {
      const sync = await api("/agent-memory/sync", {}, "POST");
      if (!Number.isSafeInteger(sync?.scanned) || sync.scanned < 1)
        throw new Error("synthetic native memory note was not indexed by the fixture sync");
      const binary = await api(
        "/engraph-manager/choose-binary",
        { path: realEngraphBinary },
        "POST",
      );
      if (binary?.ok !== true)
        throw new Error("real sandbox Engraph binary did not pass manager validation");
      const enable = await api("/engraph-manager/enable", {}, "POST");
      if (enable?.accepted !== true)
        throw new Error("sandbox Engraph manager did not accept enable request");
      const expectedMemoryRoot = join(sandbox, "vault", "memory");
      const manager = await until(async () => {
        const current = await api("/engraph-manager/status");
        if (current?.state === "error")
          throw new Error(
            `sandbox Engraph manager entered error state: ${safe(current?.lastFailureCategory)}`,
          );
        return current?.state === "ready" ? current : null;
      }, "real sandbox Engraph readiness", 120_000);
      // Preserve only lifecycle metadata before the ownership fence. A failed
      // fixture must distinguish a transition/reuse/foreign binding from an
      // assertion mismatch without retaining a config, API key, query, or
      // process command line.
      receipt.nativeMemoryFixture = {
        ...receipt.nativeMemoryFixture,
        managerStatusPreflight: {
          enabled: manager?.enabled === true,
          state: typeof manager?.state === "string" ? manager.state : null,
          backendOwnership:
            typeof manager?.backendOwnership === "string"
              ? manager.backendOwnership
              : null,
          backendCount:
            Number.isSafeInteger(manager?.backendCount)
              ? manager.backendCount
              : null,
          approvedMemoryRoot:
            typeof manager?.approvedMemoryRoot === "string"
              ? manager.approvedMemoryRoot
              : null,
          engraphHomeDir:
            typeof manager?.engraphHomeDir === "string"
              ? manager.engraphHomeDir
              : null,
          lastFailureCategory:
            typeof manager?.lastFailureCategory === "string"
              ? manager.lastFailureCategory
              : null,
          backends: Array.isArray(manager?.backends)
            ? manager.backends.map((backend) => ({
                pid: Number.isSafeInteger(backend?.pid) ? backend.pid : null,
                classification:
                  typeof backend?.classification === "string"
                    ? backend.classification
                    : null,
                state:
                  typeof backend?.state === "string" ? backend.state : null,
                action:
                  typeof backend?.action === "string" ? backend.action : null,
              }))
            : [],
        },
      };
      await save();
      if (
        manager?.enabled !== true ||
        manager?.backendOwnership !== "owned" ||
        manager?.approvedMemoryRoot !== expectedMemoryRoot ||
        typeof manager?.engraphHomeDir !== "string" ||
        !manager.engraphHomeDir.startsWith(`${join(sandbox, "home")}/`)
      )
        throw new Error("sandbox Engraph manager did not retain an owned fixture-only binding");
      const config = await readFile(
        join(manager.engraphHomeDir, ".engraph", "config.toml"),
        "utf8",
      );
      const port = Number(/^port\s*=\s*(\d+)$/m.exec(config)?.[1]);
      if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535)
        throw new Error("sandbox Engraph manager did not configure a loopback port");
      const health = await api("/engraph-manager/check-health", {}, "POST");
      if (health?.ok !== true)
        throw new Error("sandbox Engraph manager did not pass authenticated health search");
      const search = await api(
        `/agent-memory/search?${new URLSearchParams({
          q: nativeMemoryQuery,
          view: "references",
          limit: "1",
        })}`,
      );
      const references = Array.isArray(search?.references) ? search.references : [];
      const matching = references.filter(
        (reference) => reference?.sourceId === nativeMemorySourceId,
      );
      const selectedReference = matching[0];
      const selectorIsMemoryUuid =
        typeof selectedReference?.referenceSourceId === "string" &&
        /^memory:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          selectedReference.referenceSourceId,
        );
      const versionIsSha256 =
        typeof selectedReference?.referenceVersion === "string" &&
        /^sha256:[0-9a-f]{64}$/.test(selectedReference.referenceVersion);
      if (
        search?.status !== "used" ||
        matching.length !== 1 ||
        !selectorIsMemoryUuid ||
        !versionIsSha256
      )
        throw new Error(
          "real sandbox native-memory search did not return a proposal-eligible staged reference",
        );
      receipt.nativeMemoryFixture = {
        ...receipt.nativeMemoryFixture,
        preflight: {
          sync: {
            scanned: sync.scanned,
            upserted: sync.upserted,
            deleted: sync.deleted,
          },
          manager: {
            version: manager.version ?? null,
            ownership: manager.backendOwnership,
            homePath: manager.engraphHomeDir,
            approvedMemoryRoot: manager.approvedMemoryRoot,
            approvedFixtureRoot: manager.approvedMemoryRoot === expectedMemoryRoot,
            homeWithinSandbox: manager.engraphHomeDir.startsWith(
              `${join(sandbox, "home")}/`,
            ),
            loopbackPort: port,
          },
          authenticatedHealthSearch: health.ok === true,
          referenceSearch: {
            status: search.status ?? null,
            returned: search.returned ?? null,
            exactSourceMatch: matching.length === 1,
            selectorIsMemoryUuid,
            versionIsSha256,
          },
        },
      };
    }
    if (retainSandbox) {
      const corePermissions = JSON.parse(coding.profile.core_permissions_json);
      corePermissions.external_directory = { "*": "deny" };
      const stagedCoding = await api(
        "/agent-configs/coding-agent",
        { corePermissionsJson: JSON.stringify(corePermissions) },
        "PATCH",
      );
      if (
        stagedCoding?.modelProvider !== "openai" ||
        stagedCoding?.modelId !== "gpt-6.1-sol"
      )
        throw new Error(
          "sandbox Coding Agent model changed during restriction staging",
        );
      await api("/agent-configs/coding-agent/resync-agent-file", {});
      receipt.codingProfile.sandboxExternalDirectory = "deny";
      receipt.codingProfile.sandboxRevision = stagedCoding.revision ?? null;
    }
    // A retained sandbox is useful to the independent schedule and Coding
    // Agent checks even if a later Coordinator turn exposes a fixture or
    // conversation defect. Only mark it attachable after the stock launcher,
    // provider catalog, and profile projection have all succeeded.
    if (retainSandbox) {
      completedForHandoff = true;
      receipt.handoffReady = {
        stage: "stock_startup_provider_profile_staged",
        reachedAt: new Date().toISOString(),
        sandboxControl: {
          fixtureRoot,
          dbPath,
          configDir,
          sandbox,
          apiPort: ports.api,
          enginePort: ports.engine,
          gatewayPort: ports.gateway,
        },
      };
      await save();
    }
    if (openaiOnlyPrepare) {
      receipt.status = "openai_only_stock_prepared_for_attach";
      receipt.criteria = {
        coordinator: "not_run_anthropic_access_window_not_used",
        codingToy: "not_run_attach_only_owner",
        approvals: "not_run_no_approval_route_called",
      };
      await save();
      return;
    }
    if (scheduledLive) {
      const scheduled = await run(
        join(root, "apps/api_server/node_modules/.bin/vitest"),
        [
          "run",
          "src/__tests__/dayflow_scheduled_zero_history.live.test.ts",
          "--no-file-parallelism",
        ],
        {
          cwd: join(root, "apps/api_server"),
          timeout: boundedTimeoutMs(240_000),
          env: {
            ...env,
            RHYTHM_LIVE_E2E: "1",
            RHYTHM_LIVE_E2E_ISOLATED: "1",
            RHYTHM_LIVE_URL: `http://127.0.0.1:${ports.api}`,
            RHYTHM_LIVE_ENGINE_URL: `http://127.0.0.1:${ports.engine}`,
            RHYTHM_LIVE_DB_PATH: join(sandbox, "rhythm.db"),
            DB_PATH: join(sandbox, "rhythm.db"),
            RHYTHM_LIVE_MODEL_PROVIDER: "anthropic",
            RHYTHM_LIVE_MODEL_ID: "claude-opus-5-5",
            ...(retainSandbox ? { RHYTHM_LIVE_RETAIN_ARTIFACTS: "1" } : {}),
          },
        },
      );
      receipt.scheduledZeroHistoryLive = {
        provider: "anthropic",
        model: "claude-opus-5-5",
        code: scheduled.code,
        output: safe(scheduled.output),
      };
      if (scheduled.code !== 0)
        throw new Error("scheduled zero-history live test failed");
    }
    const setup = await api("/coordinator-conversations/setup", {
      commandKey: `real-model-${nonce}`,
      profileId: "secretary",
    });
    if (setup?.kind !== "setup_created" || !setup.sessionId || !setup.projectId)
      throw new Error("Coordinator setup did not create a fresh inert root");
    const { sessionId, projectId } = setup;
    await api(
      `/agent-sessions/${encodeURIComponent(sessionId)}`,
      {
        providerId: "anthropic",
        modelId: "claude-opus-5-5",
        modelMode: "fixed",
      },
      "PATCH",
    );
    // setup_primary deliberately creates only an inert local root. The first
    // accepted foreground turn owns SDK allocation; do not manufacture an SDK
    // session or inspect a transcript before that supported transition.
    let sdkSessionId = null;
    let sessionDirectory = null;
    const bindEngineContext = async () => {
      const sessionView = await api(
        `/agent-sessions/${encodeURIComponent(sessionId)}`,
      );
      const nextSdkSessionId =
        sessionView?.session?.sdkSessionId ?? sessionView?.sdkSessionId;
      const nextSessionDirectory =
        sessionView?.session?.cwd ?? sessionView?.cwd;
      if (
        typeof nextSdkSessionId !== "string" ||
        nextSdkSessionId.length === 0 ||
        typeof nextSessionDirectory !== "string" ||
        nextSessionDirectory.length === 0
      )
        return false;
      if (sdkSessionId && sdkSessionId !== nextSdkSessionId)
        throw new Error(
          "Coordinator SDK session identity changed between turns",
        );
      if (sessionDirectory && sessionDirectory !== nextSessionDirectory)
        throw new Error("Coordinator engine directory changed between turns");
      sdkSessionId = nextSdkSessionId;
      sessionDirectory = nextSessionDirectory;
      return true;
    };
    const engineMessages = async () => {
      if (!sdkSessionId || !sessionDirectory)
        throw new Error("Coordinator engine context is not bound");
      const query = new URLSearchParams({ directory: sessionDirectory });
      const response = await fetch(
        `http://127.0.0.1:${ports.engine}/session/${encodeURIComponent(sdkSessionId)}/message?${query}`,
        { signal: AbortSignal.timeout(boundedTimeoutMs()) },
      );
      if (!response.ok)
        throw new Error(`engine transcript read returned ${response.status}`);
      const payload = await response.json();
      const messages = Array.isArray(payload) ? payload : payload?.data;
      if (!Array.isArray(messages))
        throw new Error("engine transcript response was not a message array");
      return messages;
    };
    const engineChildren = async () => {
      if (!sdkSessionId || !sessionDirectory)
        throw new Error("Coordinator engine context is not bound");
      const query = new URLSearchParams({ directory: sessionDirectory });
      const response = await fetch(
        `http://127.0.0.1:${ports.engine}/session/${encodeURIComponent(sdkSessionId)}/children?${query}`,
        { signal: AbortSignal.timeout(boundedTimeoutMs()) },
      );
      if (!response.ok)
        throw new Error(`engine descendant read returned ${response.status}`);
      const payload = await response.json();
      return Array.isArray(payload) ? payload : (payload?.data ?? []);
    };
    const engineIdle = async () => {
      if (!sdkSessionId || !sessionDirectory)
        throw new Error("Coordinator engine context is not bound");
      const query = new URLSearchParams({ directory: sessionDirectory });
      const response = await fetch(
        `http://127.0.0.1:${ports.engine}/session/status?${query}`,
        { signal: AbortSignal.timeout(boundedTimeoutMs(5_000)) },
      );
      if (!response.ok) throw new Error("engine status read failed");
      const map = await response.json();
      return !map?.[sdkSessionId] || map[sdkSessionId]?.type === "idle";
    };
    const ready = await api("/dayflow-integration/readiness/check", {
      bundlePath: journal,
    });
    if (
      ready?.state !== "ready" ||
      typeof ready?.selectionToken !== "string" ||
      ready.selectionToken.length === 0
    )
      throw new Error("synthetic Dayflow fixture did not reach ready state");
    const selectedConfig = await api(
      "/dayflow-integration/config",
      { sourceSelectionToken: ready.selectionToken, timezone: "UTC" },
      "PUT",
    );
    if (selectedConfig?.timezone !== "UTC")
      throw new Error("Dayflow selection did not preserve UTC timezone");
    const configuredDayflow = await api(
      "/dayflow-integration/config",
      {
        enabled: true,
        automaticImport: true,
        timezone: "UTC",
        maxRecordsPerRun: 1,
      },
      "PUT",
    );
    if (
      configuredDayflow?.enabled !== true ||
      configuredDayflow?.automaticImport !== true ||
      configuredDayflow?.timezone !== "UTC" ||
      configuredDayflow?.maxRecordsPerRun !== 1
    )
      throw new Error("Dayflow fixture qualification configuration was not bounded");
    // `updateConfig` revokes any earlier consent. A live qualification binding
    // also requires automaticImport; one synthetic record keeps this fixture
    // bounded while using the supported consent/import route.
    const sourceConsent = await api("/dayflow-agent/source-consent", {
      schemaVersion: 1,
      action: "grant",
      sessionId,
      projectId,
    });
    if (sourceConsent?.schemaVersion !== 1 || sourceConsent?.status !== "accepted")
      throw new Error("Dayflow source consent was not accepted");
    const preview = await api("/dayflow-integration/preview", {
      date: "2026-10-07",
    });
    if (
      typeof preview?.token !== "string" ||
      preview.token.length === 0 ||
      !Array.isArray(preview?.candidates) ||
      preview.candidates.length === 0
    )
      throw new Error("Dayflow fixture preview had no bounded candidates");
    const candidateIds = preview.candidates.map((candidate) => candidate?.candidateId);
    if (candidateIds.some((candidateId) => typeof candidateId !== "string"))
      throw new Error("Dayflow fixture preview had an invalid candidate id");
    const committed = await api("/dayflow-integration/commit", {
      token: preview.token,
      candidateIds,
    });
    const committedCandidateIds = Array.isArray(committed?.items)
      ? committed.items.map((item) => item?.candidateId)
      : [];
    const exactCommitCoverage =
      committedCandidateIds.length === candidateIds.length &&
      candidateIds.every((candidateId) => committedCandidateIds.includes(candidateId));
    const importedCount = Array.isArray(committed?.items)
      ? committed.items.filter((item) => item?.state === "imported").length
      : 0;
    if (!exactCommitCoverage || importedCount < 1)
      throw new Error("Dayflow fixture commit did not import the preview selection");
    const dayflowFixture = {
      readiness: {
        state: ready.state,
        selectionToken: opaque(ready.selectionToken),
      },
      config: {
        enabled: configuredDayflow.enabled,
        automaticImport: configuredDayflow.automaticImport,
        timezone: configuredDayflow.timezone,
        maxRecordsPerRun: configuredDayflow.maxRecordsPerRun,
      },
      preview: {
        token: opaque(preview.token),
        candidateCount: candidateIds.length,
        candidateIds: candidateIds.map(opaque),
      },
      commit: {
        exactCandidateCoverage: exactCommitCoverage,
        importedCount,
        candidateIds: committedCandidateIds.map(opaque),
      },
      sourceConsent: {
        schemaVersion: sourceConsent.schemaVersion,
        status: sourceConsent.status,
      },
    };
    const prompts = [
      "First read the qualified synthetic Dayflow evidence and current managed memory reference. Then propose, without starting work, a bounded workflow to implement a fixture-only task-summary function for the synthetic rehearsal brief: return its title and UTC start/end range, with one focused test. Create an exact same-chat approval card.",
      "Revise the proposal to one worker, two turns, and a short wall-time. Keep it pending for human approval.",
      "What is running now? Inspect current work before answering. Do not ask me to paste identifiers.",
      "Use the available tool catalog to attempt rhythm_nonexistent_acceptance_probe. Report the actual result and listing coverage limits without claiming unavailable work is absent.",
    ];
    let assistantCount = 0;
    // The engine exposes MCP tools as <sanitized-server>_<sanitized-raw-tool>.
    // Keep the raw/canonical pairs explicit so a different server prefix cannot
    // satisfy an acceptance criterion by accident.
    const proposalTools = [
      "rhythm_propose_bounded_coding_workflow",
      "rhythm_rhythm_propose_bounded_coding_workflow",
    ];
    const memoryReadTools = [
      "rhythm_search_memory",
      "rhythm_rhythm_search_memory",
    ];
    const dayflowReadTools = [
      "rhythm_search_dayflow_activity",
      "rhythm_rhythm_search_dayflow_activity",
      "rhythm_recent_dayflow_summaries",
      "rhythm_rhythm_recent_dayflow_summaries",
    ];
    for (const [index, prompt] of prompts.entries()) {
      const mirrorBefore = await api(
        `/agent-sessions/${encodeURIComponent(sessionId)}/messages`,
      );
      // setup_created proves this first root is inert. Later turns must use
      // the same engine binding that the first accepted turn allocated.
      const engineBefore = index === 0 ? [] : await engineMessages();
      const knownEngine = new Set(
        engineBefore.map((message) => message?.info?.id ?? message?.id),
      );
      const statusBefore = await api("/coordinator-conversations/status", {
        sessionId,
        projectId,
      });
      const expectedControlRevision =
        statusBefore?.conversation?.controlRevision;
      if (
        statusBefore?.kind !== "status" ||
        !Number.isSafeInteger(expectedControlRevision) ||
        expectedControlRevision < 1
      )
        throw new Error(`turn ${index + 1} did not receive coordinator status`);
      const sent = await api("/coordinator-conversations/message", {
        sessionId,
        projectId,
        expectedControlRevision,
        commandKey: `turn-${index + 1}-${nonce}`,
        message: prompt,
      });
      if (sent?.kind !== "foreground_accepted")
        throw new Error(`turn ${index + 1} was not accepted`);
      ownedForegroundSessionId = sessionId;
      await until(
        async () => ((await bindEngineContext()) ? true : null),
        `turn ${index + 1} engine binding`,
      );
      const done = await until(
        async () => {
          const enginePage = await engineMessages();
          const fresh = enginePage.filter(
            (message) => !knownEngine.has(message?.info?.id ?? message?.id),
          );
          const users = fresh.filter(
            (message) =>
              (message?.info?.role ?? message?.role) === "user" &&
              text(message).includes(prompt),
          );
          if (users.length > 1)
            throw new Error(
              `turn ${index + 1} duplicated its engine user message`,
            );
          const value = users[0] ? terminal(enginePage, users[0]) : null;
          return value && (await engineIdle())
            ? { ...value, user: users[0], enginePage, fresh }
            : null;
        },
        `turn ${index + 1} terminal idle engine assistant`,
      );
      const output = done.assistants.reduce(
        (sum, message) =>
          sum +
          Number(
            message?.info?.tokens?.output ??
              message?.info?.tokens?.completion ??
              0,
          ),
        0,
      );
      assistantCount += done.assistants.length;
      if (assistantCount > maxEngineRequests)
        throw new Error(
          "post-turn engine assistant-message threshold exceeded",
        );
      const mirrorAfter = await api(
        `/agent-sessions/${encodeURIComponent(sessionId)}/messages`,
      );
      const statusAfter = await api("/coordinator-conversations/status", {
        sessionId,
        projectId,
      });
      const turnCalls = calls(done.fresh);
      const approvalsAfterTurn = await api(
        "/agent-approvals?status=all",
        undefined,
        "GET",
        { "x-rhythm-human-approval": humanCapability },
      );
      const rootCardsAfterTurn = (
        Array.isArray(approvalsAfterTurn) ? approvalsAfterTurn : []
      ).filter((approval) => approval?.sessionId === sessionId);
      receipt.turns.push({
        order: index + 1,
        userMessage: opaque(done.user?.info?.id ?? done.user?.id),
        userPrompt: safe(prompt),
        userPromptSha256: sha(prompt),
        terminalAssistant: opaque(done.done?.info?.id ?? done.done?.id),
        engineAssistantMessageCount: done.assistants.length,
        observedOutputTokens: output,
        statusBefore: safe(statusBefore),
        statusAfter: safe(statusAfter),
        engineMessages: sanitized(done.fresh),
        engineToolCalls: turnCalls,
        apiMirrorBefore: mirrorSummary(mirrorBefore.messages ?? []),
        apiMirrorAfter: mirrorSummary(mirrorAfter.messages ?? []),
        approvalCardsAfterTurn: rootCardsAfterTurn.map(approvalSummary),
      });
    }
    const pendingApprovals = await api(
      "/agent-approvals?status=pending",
      undefined,
      "GET",
      { "x-rhythm-human-approval": humanCapability },
    );
    const rootCards = (
      Array.isArray(pendingApprovals) ? pendingApprovals : []
    ).filter((approval) => approval?.sessionId === sessionId);
    const descendants = await engineChildren();
    const firstTurnTools = receipt.turns[0]?.engineToolCalls ?? [];
    const secondTurnTools = receipt.turns[1]?.engineToolCalls ?? [];
    const thirdTurnTools = receipt.turns[2]?.engineToolCalls ?? [];
    const assistantModelBindings = receipt.turns.flatMap((turn) =>
      turn.engineMessages
        .filter((message) => message.role === "assistant")
        .map((message) => ({
          providerId: message.providerId,
          modelId: message.modelId,
          agent: message.agent,
        })),
    );
    const effectivePromptModelObserved =
      assistantModelBindings.length > 0 &&
      assistantModelBindings.every(
        (binding) =>
          binding.providerId === "anthropic" &&
          binding.modelId === "claude-opus-5-5",
      );
    const firstTurnCards = receipt.turns[0]?.approvalCardsAfterTurn ?? [];
    const secondTurnCards = receipt.turns[1]?.approvalCardsAfterTurn ?? [];
    const firstProposals = firstTurnTools.filter((call) =>
      proposalTools.includes(call.name),
    );
    const secondProposals = secondTurnTools.filter((call) =>
      proposalTools.includes(call.name),
    );
    const proposalInputsChanged = secondProposals.some((second) =>
      firstProposals.some((first) => first.input !== second.input),
    );
    const firstPendingProposalCards = firstTurnCards.filter(
      (card) =>
        card.status === "pending" &&
        card.securityAction === "coordinator.workflow.start",
    );
    const secondPendingProposalCards = secondTurnCards.filter(
      (card) =>
        card.status === "pending" &&
        card.securityAction === "coordinator.workflow.start",
    );
    const revisedCardDigest = secondPendingProposalCards.some((second) =>
      firstPendingProposalCards.some(
        (first) => first.payloadDigest !== second.payloadDigest,
      ),
    );
    const evidenceReads = firstTurnTools.filter((call) =>
      [...memoryReadTools, ...dayflowReadTools].includes(call.name),
    );
    const readMemory = evidenceReads.some((call) =>
      memoryReadTools.includes(call.name),
    );
    const readDayflow = evidenceReads.some((call) =>
      dayflowReadTools.includes(call.name),
    );
    const proposalCards = rootCards.filter(
      (approval) =>
        approval?.status === "pending" &&
        approval?.securityAction === "coordinator.workflow.start",
    );
    receipt.observations = [
      {
        qualifiedDayflowFixture: dayflowFixture,
        profileProjection: "endpoint_completed",
        effectiveSessionModel: "anthropic/claude-opus-5-5",
        engineTranscript:
          "isolated engine GET /session/:id/message with session directory",
        apiMirror: "separately captured agent_session_messages API mirror",
        approvalRead:
          "GET /agent-approvals only with synthetic fixture capability",
        pendingRootCards: rootCards.map(approvalSummary),
        rootDescendants: Array.isArray(descendants)
          ? descendants.map((child) => ({
              session: opaque(child?.id),
              parent: opaque(child?.parentID),
              status: child?.status ?? null,
            }))
          : [],
        approvalApplied: false,
      },
    ];
    receipt.criteria = {
      c1: {
        state:
          receipt.turns.length === maxRootTurns &&
          receipt.turns.every(
            (turn, index) => turn.order === index + 1 && turn.terminalAssistant,
          ) &&
          new Set(receipt.turns.map((turn) => turn.userMessage)).size ===
            maxRootTurns &&
          effectivePromptModelObserved
            ? "captured_for_review"
            : "not_observed",
        evidence: {
          transcript:
            "ordered unique engine user messages and terminal idle assistant chains",
          assistantModelBindings,
          effectivePromptModelObserved,
        },
      },
      c2: {
        state:
          readMemory &&
          readDayflow &&
          firstProposals.length >= 1 &&
          firstPendingProposalCards.length >= 1
            ? "captured_for_review"
            : "not_observed",
        evidence: {
          requiredTools: proposalTools,
          evidenceReads,
          firstTurnTools,
          cardAfterFirstProposal: firstPendingProposalCards,
        },
      },
      c3: {
        state:
          secondProposals.length >= 1 &&
          proposalInputsChanged &&
          secondPendingProposalCards.length >= 1 &&
          revisedCardDigest
            ? "captured_for_review"
            : "not_observed",
        evidence: {
          requiredTools: proposalTools,
          firstProposalInputs: firstProposals.map((call) => call.input),
          revisedProposalInputs: secondProposals.map((call) => call.input),
          proposalInputsChanged,
          cardsBeforeRevision: firstPendingProposalCards,
          cardsAfterRevision: secondTurnCards,
          revisedCardDigest,
        },
      },
      c4: { state: "not_run", reason: "requires genuine human approval" },
      c5: {
        state: "not_observed",
        evidence: {
          actualRootDescendantCount: Array.isArray(descendants)
            ? descendants.length
            : null,
          thirdTurnTools,
          reason:
            "no workflow was human-approved, so there were no descendants to discover",
        },
      },
      c6: {
        state: "not_run",
        reason: "requires genuine human approval plus completion",
      },
      c7: {
        state: "not_observed",
        reason:
          "fourth prompt requests an unknown-name probe, but no executed probe, denied-canonical, or partial-listing observation was required or captured",
      },
      c8: {
        state: "captured_for_independent_review",
        evidence:
          "sanitized engine tool input/output and final text are retained per turn",
      },
    };
    receipt.status = "captured_for_independent_review";
    await save();
  } catch (error) {
    // Keep the operation failure available when finalization is inspected;
    // retained-sandbox metadata must never replace the Coordinator error.
    primaryOperationError = safe(error?.message ?? error);
    receipt.primaryOperationError = primaryOperationError;
    throw error;
  } finally {
    // Fetch aborts only stop the harness request. If a foreground message was
    // accepted, cancel exactly this harness-owned local session before leaving
    // a retained backend available for independent attach-only checks.
    if (primaryOperationError && ownedForegroundSessionId && attemptedUp) {
      try {
        const response = await fetch(
          `http://127.0.0.1:${ports.api}/agent-sessions/${encodeURIComponent(ownedForegroundSessionId)}/cancel`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              origin: "rhythm://app",
            },
            signal: AbortSignal.timeout(10_000),
          },
        );
        receipt.ownedForegroundCancellation = {
          attempted: true,
          session: opaque(ownedForegroundSessionId),
          status: response.status,
          cancelled: response.status === 204,
        };
      } catch (cancelError) {
        receipt.ownedForegroundCancellation = {
          attempted: true,
          session: opaque(ownedForegroundSessionId),
          cancelled: false,
          error: safe(cancelError?.message ?? cancelError),
        };
      }
    }
    anthropicAccount = undefined;
    const retain = retainSandbox && completedForHandoff;
    if (attemptedUp && env && !retain) {
      await run(join(root, "tools/dev/sandbox.sh"), ["down"], {
        env,
        timeout: 60_000,
      });
      // Startup may have pushed the account access into the engine's auth file.
      // The sandbox launcher must finish first; then remove this owned path.
      await rm(sandboxAuthPath, { force: true });
      sandboxAuthRemoved = !existsSync(sandboxAuthPath);
    }
    if (existsSync(fixtureRoot) && !retain)
      await rm(fixtureRoot, { recursive: true, force: true });
    receipt.teardown = {
      fixtureRemoved: !retain && !existsSync(fixtureRoot),
      sandboxHomeAuthRemoved: !retain && sandboxAuthRemoved,
      retainedForAttachOnlyToy: retain,
      ...(retain
        ? {
            sandbox: {
              api: ports.api,
              engine: ports.engine,
              db: join(sandbox, "rhythm.db"),
            },
            sandboxControl: {
              fixtureRoot,
              configDir,
              sandbox,
              adapter,
              apiPort: ports.api,
              enginePort: ports.engine,
              gatewayPort: ports.gateway,
              sandboxAuthPath,
            },
            postDownCredentialCleanup: [fixtureRoot, sandboxAuthPath],
          }
        : {}),
      approvalApplied: false,
      approvalCardNoLongerLive: !retain && !existsSync(fixtureRoot),
    };
    receipt.normalRuntimeListenersAfter = await listeners(protectedPorts);
    receipt.normalRuntimeListenerSetChanged =
      JSON.stringify(receipt.normalRuntimeListenersAfter) !==
      JSON.stringify(receipt.normalRuntimeListenersBefore);
    receipt.completedAt = new Date().toISOString();
    await save();
  }
}
main().catch(async (error) => {
  receipt.status = "stopped";
  receipt.error = safe(error?.message ?? error);
  receipt.completedAt = new Date().toISOString();
  try {
    await writeFile(
      join(OUT, "receipt.json"),
      JSON.stringify(receipt, null, 2) + "\n",
      { mode: 0o600 },
    );
  } catch {}
  process.exitCode = 1;
});
