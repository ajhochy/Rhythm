/**
 * G2 workflow-lane native guard: manager-lineage inheritance, Task resume containment,
 * corrupt-marker error semantics, and the ordinary-fallback gate. Real Session / Storage /
 * TaskTool / providerGuardMiddleware; nothing about the guard under test is mocked
 * (only the admission transport seam, as in the sibling native test).
 */
import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Session } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { Bus } from "@/bus"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "@/sync"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { GlobalBus } from "../../src/bus/global"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import {
  ENGINE_GENERATION,
  enrollGuard,
  enrollWorkflowGuard,
  readGuardRecord,
  runnerGenerations,
  sha256Hex,
  parseGuardRequest,
  workflowGuardFor,
  type WorkflowBinding,
} from "../../src/session/rhythm_provider_guard"
import {
  clearRunnerCertificates,
  guardTransport,
  providerGuardMiddleware,
  resetGuardCaches,
  trustedRhythmIntegration,
  type GuardAttemptContext,
} from "../../src/session/rhythm_provider_projection"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

const binding = (managerSdkSessionId: string): WorkflowBinding => ({
  schemaVersion: 1,
  jobId: "job_wf_1",
  rootSdkSessionId: "ses_wf_root",
  managerSdkSessionId,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
})
const enrollManager = (sessionID: string) =>
  enrollWorkflowGuard(sessionID, {
    schemaVersion: 2,
    kind: "coordinator_workflow_enrollment",
    binding: binding(sessionID),
    scope: { kind: "manager_lineage" },
  })

const key = (id: string) => ["rhythm", "dayflow-guard", id]

// ---- 1. createNext inherits the binding BEFORE Session.Created is published ----------------
const events: string[] = []
const spyStorage = Layer.effect(
  Storage.Service,
  Effect.gen(function* () {
    const real = yield* Storage.Service
    return Storage.Service.of({
      ...real,
      write: (k, v) =>
        Effect.sync(() => {
          if (k[0] === "rhythm" && k[1] === "dayflow-guard") events.push(`guard-write:${k[2]}`)
        }).pipe(Effect.andThen(real.write(k, v))),
    })
  }),
).pipe(Layer.provide(Storage.defaultLayer))
const spyIt = testEffect(
  Layer.mergeAll(
    Session.layer.pipe(
      Layer.provide(Bus.layer),
      Layer.provide(spyStorage),
      Layer.provide(SyncEvent.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
    ),
    spyStorage,
    CrossSpawnSpawner.defaultLayer,
  ),
)

describe("G2 manager lineage inheritance", () => {
  spyIt.instance("createNext child inherits the workflow binding before Session.Created is published", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const storage = yield* Storage.Service
      const parent = yield* sessions.create({ title: "wf manager" })
      yield* enrollManager(parent.id).pipe(Effect.provideService(Storage.Service, storage))
      events.length = 0
      const listener = (event: { payload?: { type?: string; properties?: any } }) => {
        if (event.payload?.type === Session.Event.Created.type) events.push(`created:${event.payload.properties.info.id}`)
      }
      GlobalBus.on("event", listener as never)
      yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", listener as never)))

      const child = yield* sessions.create({ parentID: parent.id, title: "wf child" })

      expect(events).toContain(`guard-write:${child.id}`)
      expect(events).toContain(`created:${child.id}`)
      expect(events.indexOf(`guard-write:${child.id}`)).toBeLessThan(events.indexOf(`created:${child.id}`))
      const marker = yield* sessions.workflowGuard(child.id)
      expect(marker?.kind).toBe("manager_lineage")
      expect(marker?.kind === "manager_lineage" && marker.binding.managerSdkSessionId).toBe(parent.id)
      // an unmarked parent's child stays ordinary (no taint by default)
      const plain = yield* sessions.create({ title: "plain" })
      const plainChild = yield* sessions.create({ parentID: plain.id, title: "plain child" })
      expect(yield* sessions.workflowGuard(plainChild.id)).toBeUndefined()
    }),
  )
})

// ---- 2/3. Task resume containment and corrupt-marker error state ----------------------------
const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    Storage.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
  ),
)

const seed = Effect.fn("WorkflowTest.seed")(function* () {
  const session = yield* Session.Service
  const chat = yield* session.create({ title: "manager" })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(), role: "user", sessionID: chat.id, agent: "build", model: ref, time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(), role: "assistant", parentID: user.id, sessionID: chat.id, mode: "build", agent: "build",
    cost: 0, path: { cwd: "/tmp", root: "/tmp" }, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID, providerID: ref.providerID, time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

const ops = (seen: SessionPrompt.PromptInput[]): TaskPromptOps => ({
  cancel: () => Effect.void,
  resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
  prompt: (input) =>
    Effect.sync(() => {
      seen.push(input)
      const id = MessageID.ascending()
      return {
        info: {
          id, role: "assistant", parentID: input.messageID ?? MessageID.ascending(), sessionID: input.sessionID,
          mode: "general", agent: "general", cost: 0, path: { cwd: "/tmp", root: "/tmp" },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ref.modelID, providerID: ref.providerID, time: { created: Date.now() }, finish: "stop",
        },
        parts: [{ id: PartID.ascending(), messageID: id, sessionID: input.sessionID, type: "text", text: "ok" }],
      } as MessageV2.WithParts
    }),
})

const resume = (chat: Session.Info, assistant: MessageV2.Assistant, taskId: string, seen: SessionPrompt.PromptInput[]) =>
  Effect.gen(function* () {
    const tool = yield* TaskTool
    const def = yield* tool.init()
    return yield* def.execute(
      { description: "resume", prompt: "continue", subagent_type: "general", task_id: taskId },
      {
        sessionID: chat.id, messageID: assistant.id, agent: "build", abort: new AbortController().signal,
        extra: { promptOps: ops(seen) }, messages: [], metadata: () => Effect.void, ask: () => Effect.void,
      },
    )
  })

describe("G2 Task resume and corrupt markers", () => {
  it.instance("Task resume of an unrelated SDK session is refused for a workflow-marked lane", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      yield* enrollManager(chat.id)
      const seen: SessionPrompt.PromptInput[] = []

      // unrelated (not a descendant) session
      const unrelated = yield* sessions.create({ title: "unrelated" })
      expect((yield* Effect.exit(resume(chat, assistant, unrelated.id, seen)))._tag).toBe("Failure")

      // a child of this manager that predates its marker (no inherited binding) is not promoted either
      const storage = yield* Storage.Service
      const orphan = yield* sessions.create({ parentID: chat.id, title: "orphan" })
      yield* storage.remove(key(orphan.id))
      expect((yield* Effect.exit(resume(chat, assistant, orphan.id, seen)))._tag).toBe("Failure")
      expect(seen).toHaveLength(0)

      // control: the genuine marked descendant resumes
      const child = yield* sessions.create({ parentID: chat.id, title: "genuine" })
      const ok = yield* resume(chat, assistant, child.id, seen)
      expect(ok.metadata.sessionId).toBe(child.id)
      expect(seen).toHaveLength(1)
    }),
  )

  it.instance("a corrupt workflow binding is an error state, never absent/ordinary", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const storage = yield* Storage.Service
      const id = `ses_wf_corrupt_${Date.now()}`
      const good = binding(id)
      for (const workflow of [
        { kind: "manager_lineage", binding: { ...good, expiresAt: "not-a-date" }, engineGeneration: ENGINE_GENERATION },
        { kind: "manager_lineage", binding: { ...good, rootSdkSessionId: id }, engineGeneration: ENGINE_GENERATION },
        { kind: "manager_lineage", binding: good, engineGeneration: ENGINE_GENERATION, extra: 1 },
        { kind: "root_turns", entries: "nope" },
      ]) {
        yield* storage.write(key(id), { schemaVersion: 2, managedSeen: true, guarded: true, workflow })
        expect(yield* readGuardRecord(id)).toEqual({ state: "error" })
        // the marker lookup must not report "no marker" (which callers treat as ordinary)
        expect((yield* Effect.exit(workflowGuardFor(id)))._tag).toBe("Failure")
        expect((yield* Effect.exit(sessions.workflowGuard(id as never)))._tag).toBe("Failure")
      }
      // a corrupt workflow record is never overwritten downward by a v1 enrollment
      expect((yield* Effect.exit(enrollManager(id)))._tag).toBe("Failure")
      expect((yield* Effect.exit(enrollGuard(id)))._tag).toBe("Failure")
      expect(yield* readGuardRecord(id)).toEqual({ state: "error" })

      // and a corrupt parent marker holds Task resume instead of falling to the ordinary path
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })
      yield* storage.write(key(chat.id), { schemaVersion: 2, managedSeen: true, guarded: true, workflow: { kind: "manager_lineage", binding: "bad" } })
      const seen: SessionPrompt.PromptInput[] = []
      expect((yield* Effect.exit(resume(chat, assistant, child.id, seen)))._tag).toBe("Failure")
      expect(seen).toHaveLength(0)
      // truly absent is still undefined
      expect(yield* workflowGuardFor(`ses_wf_absent_${Date.now()}`)).toBeUndefined()
    }),
  )

  it.instance("a workflow mark without the G2 gate cannot take the known-ordinary fallback", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const s = yield* sessions.create({ title: "wf lane" })
      const sdk = s.id as string
      const params = { prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] } as never
      const integration = trustedRhythmIntegration({
        mcp: { rhythm: { type: "local" as const, command: ["x"], environment: { RHYTHM_AGENT_URL: "http://127.0.0.1:4001", RHYTHM_API_TOKEN: "synthetic-token" } } },
      })
      const ctx = (over: Partial<GuardAttemptContext>): GuardAttemptContext => ({
        sdkSessionId: sdk, userMessageId: "msg_wf_user", agentName: "secretary", purpose: "answer", userKind: "authored",
        initiatingUserMessageId: null, origins: undefined, userSystem: undefined,
        record: { schemaVersion: 1, managedSeen: true, guarded: false }, integration,
        signal: new AbortController().signal, isWorkflow: false, ...over,
      })
      const run = (c: GuardAttemptContext) =>
        Effect.promise(() => providerGuardMiddleware(c).transformParams!({ type: "stream", params, model: {} as never }).then(() => "passed", (e) => String(e)))
      runnerGenerations.set(sdk, "run_wf")
      resetGuardCaches()
      yield* Effect.addFinalizer(() => Effect.sync(() => { runnerGenerations.delete(sdk); clearRunnerCertificates(sdk); resetGuardCaches() }))

      // prime the known-ordinary cache for this sdk/agent with a never-enrolled v1 record
      guardTransport.fetch = async (_url, init) => {
        const parsed = parseGuardRequest(JSON.parse(String(init.body)))
        if (!parsed.ok) throw new Error("bad request")
        return new Response(JSON.stringify({
          schemaVersion: 1, request: parsed.value, decision: "ordinary", rawHistoryReusable: true, guardRegistrationVersion: 1,
          basisDigest: "b".repeat(64), overlay: null, projection: null, reason: "none",
        }), { status: 200 })
      }
      expect(yield* run(ctx({}))).toBe("passed")
      let fetches = 0
      guardTransport.fetch = async () => { fetches++; throw new Error("api down") }
      // control: with the API down the known-ordinary v1 SDK still passes (cache is primed)
      expect(yield* run(ctx({}))).toBe("passed") // attempted the API once, then took the ordinary fallback
      expect(fetches).toBe(1)
      fetches = 0

      const marker = { kind: "manager_lineage" as const, binding: binding(sdk), engineGeneration: ENGINE_GENERATION }
      const v2 = { schemaVersion: 2 as const, managedSeen: true as const, guarded: true as const, workflow: marker }
      // marked lane, real G2 facts present, but the API gate is down: it must reach the gate and HOLD
      expect(yield* run(ctx({ record: v2, outputAssistantId: "msg_wf_asst" }))).toContain("provider guard held")
      expect(fetches).toBe(1)
      // marked lane with no accounting identity (auxiliary call): held before any exposure
      fetches = 0
      expect(yield* run(ctx({ record: v2 }))).toContain("provider guard held")
      expect(fetches).toBe(0)
      // an expired marker has no fallback either
      const expired = { ...v2, workflow: { ...marker, binding: { ...marker.binding, expiresAt: new Date(Date.now() - 1000).toISOString() } } }
      expect(yield* run(ctx({ record: expired, outputAssistantId: "msg_wf_asst" }))).toContain("provider guard held")
      void sha256Hex
    }),
  )
})
