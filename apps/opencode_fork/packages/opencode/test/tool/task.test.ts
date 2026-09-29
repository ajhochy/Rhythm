import { afterEach, describe, expect, mock, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Session } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { TaskTool, childMcpAllowlist, childSkillAllowlist, isSkillAllowlist, type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { modelStreamScheduler } from "@/session/model-stream-scheduler"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { ConfigAgent } from "@/config/agent"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
  ),
)

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const seed = Effect.fn("TaskToolTest.seed")(function* (title = "Pinned") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        return reply(input, opts?.text ?? "done")
      }),
  }
}

function reply(input: SessionPrompt.PromptInput, text: string): MessageV2.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

function failedReply(input: SessionPrompt.PromptInput, error: MessageV2.Assistant["error"]): MessageV2.WithParts {
  const result = reply(input, "")
  if (result.info.role === "assistant") result.info.error = error
  result.parts = []
  return result
}

describe("tool.task", () => {
  it.instance(
    "description sorts subagents by name and is stable across calls",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const get = Effect.fnUntraced(function* () {
          const tools = yield* registry.tools({ ...ref, agent: build })
          return tools.find((tool) => tool.id === TaskTool.id)?.description ?? ""
        })
        const first = yield* get()
        const second = yield* get()

        expect(first).toBe(second)

        const alpha = first.indexOf("- alpha: Alpha agent")
        const explore = first.indexOf("- explore:")
        const general = first.indexOf("- general:")
        const zebra = first.indexOf("- zebra: Zebra agent")

        expect(alpha).toBeGreaterThan(-1)
        expect(explore).toBeGreaterThan(alpha)
        expect(general).toBeGreaterThan(explore)
        expect(zebra).toBeGreaterThan(general)
      }),
    {
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance(
    "description hides denied subagents for the caller",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const description =
          (yield* registry.tools({ ...ref, agent: build })).find((tool) => tool.id === TaskTool.id)?.description ?? ""

        expect(description).toContain("- alpha: Alpha agent")
        expect(description).not.toContain("- zebra: Zebra agent")
      }),
    {
      config: {
        permission: {
          task: {
            "*": "allow",
            zebra: "deny",
          },
        },
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance("execute resumes an existing task session from task_id", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "Existing child" })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "resumed", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: child.id,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(child.id)
      expect(result.metadata.sessionId).toBe(child.id)
      expect(result.output).toContain(`task_id: ${child.id}`)
      expect(seen?.sessionID).toBe(child.id)
    }),
  )

  it.instance("execute yields the parent model-stream lease before awaiting the child", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const parentLease = yield* Effect.promise(() =>
        modelStreamScheduler.acquire({
          sessionID: chat.id,
          providerID: "test",
          modelID: "parent",
        }),
      )
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let activeWhileChildRuns = -1
      const promptOps = stubOps({
        onPrompt: () => {
          activeWhileChildRuns = modelStreamScheduler.snapshot().active
        },
      })

      yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(activeWhileChildRuns).toBe(0)
      expect(modelStreamScheduler.snapshot().active).toBe(0)
      parentLease.release()
    }),
  )

  it.instance("execute asks by default and skips checks when bypassed", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const calls: unknown[] = []
      const promptOps = stubOps()

      const exec = (extra?: Record<string, any>) =>
        def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps, ...extra },
            messages: [],
            metadata: () => Effect.void,
            ask: (input) =>
              Effect.sync(() => {
                calls.push(input)
              }),
          },
        )

      yield* exec()
      yield* exec({ bypassAgentCheck: true })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        permission: "task",
        patterns: ["general"],
        always: ["*"],
        metadata: {
          description: "inspect bug",
          subagent_type: "general",
        },
      })
    }),
  )

  it.instance("execute cancels child session when abort signal fires", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const ready = defer<SessionPrompt.PromptInput>()
      const cancelled = defer<SessionID>()
      const abort = new AbortController()
      const promptOps: TaskPromptOps = {
        cancel: (sessionID) =>
          Effect.sync(() => {
            cancelled.resolve(sessionID)
          }),
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) =>
          Effect.promise(() => {
            ready.resolve(input)
            return cancelled.promise
          }).pipe(Effect.as(reply(input, "cancelled"))),
      }

      const fiber = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: abort.signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)

      const input = yield* Effect.promise(() => ready.promise)
      abort.abort()
      expect(yield* Effect.promise(() => cancelled.promise)).toBe(input.sessionID)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.instance("execute creates a child when task_id does not exist", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "created", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: "ses_missing",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(result.metadata.sessionId)
      expect(result.metadata.sessionId).not.toBe("ses_missing")
      expect(result.output).toContain(`task_id: ${result.metadata.sessionId}`)
      expect(seen?.sessionID).toBe(result.metadata.sessionId)
    }),
  )

  it.instance("execute fails when the child prompt returns an assistant error", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const promptOps: TaskPromptOps = {
        cancel: () => Effect.void,
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) =>
          Effect.succeed(
            failedReply(
              input,
              new MessageV2.AbortedError({ message: "Aborted" }).toObject() as MessageV2.Assistant["error"],
            ),
          ),
      }

      const exit = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause)
        const message = failure instanceof Error ? failure.message : String(failure)
        expect(message).toContain("subagent general failed with error (task_id: ")
        expect(message).toContain("MessageAbortedError: Aborted")
      }
    }),
  )

  it.instance("issue-1211-c2: propagates a provider inactivity timeout from child to parent task", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const promptOps: TaskPromptOps = {
        cancel: () => Effect.void,
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) =>
          Effect.succeed(
            failedReply(
              input,
              new MessageV2.APIError({
                message: "Provider stream inactive for 50ms",
                isRetryable: false,
              }).toObject() as MessageV2.Assistant["error"],
            ),
          ),
      }

      const exit = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = Cause.squash(exit.cause)
        const message = failure instanceof Error ? failure.message : String(failure)
        expect(message).toContain("subagent general failed with error")
        expect(message).toContain("Provider stream inactive for 50ms")
      }
    }),
  )

  it.instance("execute retries the same child task after a retryable child provider error", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const seen: SessionPrompt.PromptInput[] = []
      const promptOps: TaskPromptOps = {
        cancel: () => Effect.void,
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) =>
          Effect.sync(() => {
            seen.push(input)
            if (seen.length === 1) {
              return failedReply(
                input,
                new MessageV2.APIError({
                  message: "An error occurred while processing your request.",
                  isRetryable: true,
                }).toObject() as MessageV2.Assistant["error"],
              )
            }
            return reply(input, "finished after retry")
          }),
      }

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(seen).toHaveLength(2)
      expect(seen[0]?.sessionID).toBe(seen[1]?.sessionID)
      expect(result.output).toContain(`task_id: ${seen[0]?.sessionID}`)
      expect(result.output).toContain("finished after retry")
    }),
  )

  it.instance(
    "execute shapes child permissions for task, todowrite, and primary tools",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "reviewer",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const child = yield* sessions.get(result.metadata.sessionId)
        expect(child.parentID).toBe(chat.id)
        expect(child.permission).toEqual([
          {
            permission: "todowrite",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "bash",
            pattern: "*",
            action: "allow",
          },
          {
            permission: "read",
            pattern: "*",
            action: "allow",
          },
        ])
        expect(seen?.tools).toEqual({
          todowrite: false,
          bash: false,
          read: false,
        })
      }),
    {
      config: {
        agent: {
          reviewer: {
            mode: "subagent",
            permission: {
              task: "allow",
            },
          },
        },
        experimental: {
          primary_tools: ["bash", "read"],
        },
      },
    },
  )

  it.instance(
    "execute applies the target subagent's resolved MCP scope and defers an over-cap Gemini catalog",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()

        const result = yield* def.execute(
          {
            description: "inspect scoped tools",
            prompt: "list the current tasks",
            subagent_type: "rhythm-only",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const child = yield* sessions.get(result.metadata.sessionId)
        expect(child.mcpAllowlist).toEqual({
          servers: ["rhythm"],
          tools: Array.from({ length: 513 }, (_, index) => `rhythm_tool_${index}`),
          deferred: true,
        })
      }),
    {
      config: {
        agent: {
          "rhythm-only": {
            mode: "subagent",
            model: "google/gemini-2.5-flash",
            // The agent config loader preserves unknown frontmatter fields in options.
            // Regression: without the child scope, task.ts creates an unscoped
            // session and Gemini receives every MCP declaration.
            mcpAllowlist: {
              servers: ["rhythm"],
              tools: Array.from({ length: 513 }, (_, index) => `rhythm_tool_${index}`),
            },
          },
        },
      },
    },
  )

  it.instance(
    "execute applies the target subagent's resolved skill scope",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()

        const result = yield* def.execute(
          {
            description: "inspect scoped skills",
            prompt: "list the current tasks",
            subagent_type: "skill-scoped",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const child = yield* sessions.get(result.metadata.sessionId)
        expect(child.skillAllowlist).toEqual({ skills: ["alpha", "beta"] })
      }),
    {
      config: {
        agent: {
          "skill-scoped": {
            mode: "subagent",
            // Same promotion path as mcpAllowlist above: unknown frontmatter keys
            // land in agent.options via ConfigAgent.normalize.
            skillAllowlist: { skills: ["alpha", "beta"] },
          },
        },
      },
    },
  )
})

describe("tool.task childSkillAllowlist / isSkillAllowlist", () => {
  test("isSkillAllowlist accepts well-shaped skill lists", () => {
    expect(isSkillAllowlist({ skills: [] })).toBe(true)
    expect(isSkillAllowlist({ skills: ["a"] })).toBe(true)
  })

  test("isSkillAllowlist rejects malformed values", () => {
    expect(isSkillAllowlist(null)).toBe(false)
    expect(isSkillAllowlist({})).toBe(false)
    expect(isSkillAllowlist({ skills: [1] })).toBe(false)
    expect(isSkillAllowlist({ skills: "a" })).toBe(false)
  })

  test("childSkillAllowlist returns a fresh copy of the profile's declared scope", () => {
    const skills = ["a", "b"]
    const agent = { options: { skillAllowlist: { skills } } } as unknown as Agent.Info
    const parent = { skillAllowlist: undefined } as unknown as Session.Info

    const result = childSkillAllowlist(agent, parent)

    expect(result).toEqual({ skills: ["a", "b"] })
    expect(result?.skills).not.toBe(skills)
  })

  test("childSkillAllowlist inherits the parent session's scope when the profile declares none", () => {
    const agent = { options: {} } as unknown as Agent.Info
    const parent = { skillAllowlist: { skills: ["x"] } } as unknown as Session.Info

    expect(childSkillAllowlist(agent, parent)).toEqual({ skills: ["x"] })
  })

  test("childSkillAllowlist stays undefined when neither the profile nor the parent are scoped", () => {
    const agent = { options: {} } as unknown as Agent.Info
    const parent = { skillAllowlist: undefined } as unknown as Session.Info

    expect(childSkillAllowlist(agent, parent)).toBeUndefined()
  })
})

describe("tool.task childMcpAllowlist", () => {
  const model = { providerID: "test" }

  test("childMcpAllowlist inherits the parent session's scope when the profile declares none", () => {
    // Regression (unscoped child-session inheritance): built-in child agents
    // (general/explore) are never projected into ~/.config/opencode/agents/, so
    // they carry no options.mcpAllowlist. Without this fallback the child got
    // every MCP server/tool instead of the parent's scope.
    const agent = { options: {} } as unknown as Agent.Info
    const parent = { mcpAllowlist: { servers: ["rhythm"], tools: ["rhythm_a"] } } as unknown as Session.Info

    expect(childMcpAllowlist(agent, model, parent)).toEqual({ servers: ["rhythm"], tools: ["rhythm_a"] })
  })

  test("childMcpAllowlist keeps the profile's own scope over the parent's", () => {
    const agent = { options: { mcpAllowlist: { servers: ["own"], tools: ["own_a"] } } } as unknown as Agent.Info
    const parent = { mcpAllowlist: { servers: ["rhythm"], tools: ["rhythm_a"] } } as unknown as Session.Info

    expect(childMcpAllowlist(agent, model, parent)).toEqual({ servers: ["own"], tools: ["own_a"] })
  })

  test("childMcpAllowlist stays undefined when neither the profile nor the parent are scoped", () => {
    const agent = { options: {} } as unknown as Agent.Info
    const parent = { mcpAllowlist: undefined } as unknown as Session.Info

    expect(childMcpAllowlist(agent, model, parent)).toBeUndefined()
  })
})

// The whole child-scoping design rests on one link the synthetic tests above
// stub out: opencode_agent_writer projects a Rhythm profile's expanded scope
// into ~/.config/opencode/agents/<id>.md frontmatter, ConfigAgent preserves it
// in `agent.options`, and childMcpAllowlist reads it. These load REAL projected
// frontmatter through ConfigAgent.load so the link is proven end to end.
describe("tool.task child scoping through projected profile frontmatter", () => {
  const model = { providerID: "test" }

  // Verbatim `options:` lines as opencode_agent_writer emits them (single-line
  // flow YAML), taken from the installed coding-agent.md / workflow-orchestrator.md.
  const CHILD_OPTIONS =
    '{"mcpAllowlist":{"servers":["gitnexus"],"tools":[]},"skillAllowlist":{"skills":["acceptance-contract","coding-agent"]},"effort":"xhigh"}'
  const PARENT_OPTIONS =
    '{"mcpAllowlist":{"servers":["gitnexus","obsidian","playwright","duckduckgo"],"tools":["rhythm_rhythm_ping","rhythm_rhythm_delegate"]},"skillAllowlist":{"skills":["workflow-orchestrator"]},"effort":"xhigh"}'

  async function loadProjected() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "task-scope-"))
    await fs.mkdir(path.join(dir, "agents"), { recursive: true })
    for (const [name, options] of [
      ["coding-agent", CHILD_OPTIONS],
      ["workflow-orchestrator", PARENT_OPTIONS],
    ] as const) {
      await fs.writeFile(
        path.join(dir, "agents", `${name}.md`),
        `---\nname: ${name}\ndescription: ${name}\nmode: all\noptions: ${options}\n---\nbody\n`,
      )
    }
    try {
      const loaded = await ConfigAgent.load(dir)
      return {
        child: { options: loaded["coding-agent"]!.options ?? {} } as unknown as Agent.Info,
        parent: { options: loaded["workflow-orchestrator"]!.options ?? {} } as unknown as Agent.Info,
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }

  test("a projected child keeps its OWN scope, which differs from the dispatching parent's", async () => {
    const { child, parent } = await loadProjected()
    // The parent session is scoped from the parent's own projected profile.
    const parentSession = {
      mcpAllowlist: childMcpAllowlist(parent, model, {} as unknown as Session.Info),
      skillAllowlist: childSkillAllowlist(parent, {} as unknown as Session.Info),
    } as unknown as Session.Info

    expect(parentSession.mcpAllowlist).toEqual({
      servers: ["gitnexus", "obsidian", "playwright", "duckduckgo"],
      tools: ["rhythm_rhythm_ping", "rhythm_rhythm_delegate"],
    })

    const childMcp = childMcpAllowlist(child, model, parentSession)
    const childSkills = childSkillAllowlist(child, parentSession)

    expect(childMcp).toEqual({ servers: ["gitnexus"], tools: [] })
    expect(childSkills).toEqual({ skills: ["acceptance-contract", "coding-agent"] })
    // The point of the whole design: the child is NOT the parent.
    expect(childMcp).not.toEqual(parentSession.mcpAllowlist)
    expect(childSkills).not.toEqual(parentSession.skillAllowlist)
  })

  test("a profile-less built-in child (general/explore is never projected) falls back to the parent", async () => {
    const { parent } = await loadProjected()
    const parentSession = {
      mcpAllowlist: childMcpAllowlist(parent, model, {} as unknown as Session.Info),
      skillAllowlist: childSkillAllowlist(parent, {} as unknown as Session.Info),
    } as unknown as Session.Info
    const builtin = { options: {} } as unknown as Agent.Info

    expect(childMcpAllowlist(builtin, model, parentSession)).toEqual(parentSession.mcpAllowlist!)
    expect(childSkillAllowlist(builtin, parentSession)).toEqual(parentSession.skillAllowlist!)
  })

  test("an unrestricted parent plus a profile-less child stays unrestricted", () => {
    const builtin = { options: {} } as unknown as Agent.Info
    const parentSession = { mcpAllowlist: undefined, skillAllowlist: undefined } as unknown as Session.Info

    expect(childMcpAllowlist(builtin, model, parentSession)).toBeUndefined()
    expect(childSkillAllowlist(builtin, parentSession)).toBeUndefined()
  })
})

// The frontmatter tests above prove ConfigAgent.load -> childXAllowlist works on
// a HAND-WRITTEN copy of what opencode_agent_writer emits. The one link never
// tested end to end is the writer itself (apps/api_server, a separate
// package/runtime): a projection-format change there would silently unscope
// every delegated child. Bun can import that package's TypeScript directly, so
// this calls the REAL writer and feeds its REAL output into the REAL reader —
// nothing here is reimplemented on either side.
describe("tool.task writer/reader contract (real opencode_agent_writer -> real ConfigAgent.load)", () => {
  const model = { providerID: "test" }

  test("a profile written by the real opencode_agent_writer is parsed correctly by ConfigAgent + childMcpAllowlist/childSkillAllowlist", async () => {
    const scratchHome = await fs.mkdtemp(path.join(os.tmpdir(), "task-writer-contract-"))
    const env = { VITEST: process.env.VITEST, NODE_ENV: process.env.NODE_ENV }
    const realOs = { ...os }
    try {
      // shouldWriteAgentFile() no-ops under VITEST/test env, and writes under
      // os.homedir() (bun's os.homedir() ignores $HOME, unlike Node's) — so
      // both must be overridden for the real writer to actually write, into a
      // scratch HOME rather than the developer's real ~/.config/opencode.
      // mock.module patches the shared module record for the WHOLE bun test
      // run (every file, not just this one) until restored — spread the real
      // module so every other export (os.tmpdir, used by this suite's own
      // fixture harness) keeps working, and restore it in `finally` below.
      mock.module("os", () => ({ ...realOs, homedir: () => scratchHome, default: { ...realOs, homedir: () => scratchHome } }))
      process.env.VITEST = "false"
      process.env.NODE_ENV = "development"

      // Built at runtime (not a string literal) so tsgo/tsc cannot statically
      // resolve and typecheck api_server's whole graph through this dynamic
      // import — that package has its own tsconfig and pre-existing unrelated
      // errors under this package's stricter settings. Bun resolves the
      // module fine at runtime regardless.
      const writerModulePath = ["..", "..", "..", "..", "..", "api_server", "src", "services", "opencode_agent_writer.ts"].join(
        "/",
      )
      const { writeAgentProfileFile } = await import(writerModulePath)
      const now = new Date().toISOString()
      writeAgentProfileFile({
        id: "writer-contract-child",
        label: "Writer Contract Child",
        icon: "smart_toy",
        enabled: true,
        isAgent: true,
        isManager: false,
        systemPrompt: "Do the thing.",
        allowedMcpsJson: JSON.stringify(["gitnexus"]),
        allowedSkillsJson: JSON.stringify(["coding-agent"]),
        corePermissionsJson: null,
        allowedDelegatesJson: null,
        presetId: null,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
        modelProvider: null,
        modelId: null,
        ocAgent: "writer-contract-child",
        sessionSelectable: true,
        modelTierHint: null,
        defaultAnthropicAccountId: null,
      } as any)

      const loaded = await ConfigAgent.load(path.join(scratchHome, ".config", "opencode"))
      const child = { options: loaded["writer-contract-child"]!.options ?? {} } as unknown as Agent.Info
      // An unrestricted parent so any pass-through-to-parent bug (rather than a
      // parse failure) would still be caught by these exact-match assertions.
      const parent = { mcpAllowlist: undefined, skillAllowlist: undefined } as unknown as Session.Info

      expect(childMcpAllowlist(child, model, parent)).toEqual({ servers: ["gitnexus"], tools: [] })
      expect(childSkillAllowlist(child, parent)).toEqual({ skills: ["coding-agent"] })
    } finally {
      mock.module("os", () => ({ ...realOs, default: { ...realOs } }))
      process.env.VITEST = env.VITEST
      process.env.NODE_ENV = env.NODE_ENV
      await fs.rm(scratchHome, { recursive: true, force: true })
    }
  })
})
