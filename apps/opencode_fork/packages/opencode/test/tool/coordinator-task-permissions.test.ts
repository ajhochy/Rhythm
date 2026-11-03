import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "../../src/config/config"
import { Permission } from "../../src/permission"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "../../src/tool/truncate"
import { ToolRegistry } from "../../src/tool/registry"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(SessionPrompt.defaultLayer, Session.defaultLayer, Agent.defaultLayer,
  Config.defaultLayer, Truncate.defaultLayer, ToolRegistry.defaultLayer, CrossSpawnSpawner.defaultLayer))
const model = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }
const scopedRules: Permission.Ruleset = [
  { permission: "external_directory", pattern: "*", action: "deny" },
  { permission: "external_directory", pattern: "/fixture-vault/Projects/*", action: "allow" },
  { permission: "edit", pattern: "*", action: "deny" },
  { permission: "bash", pattern: "*", action: "ask" },
  { permission: "doom_loop", pattern: "*", action: "ask" },
]

it.instance("coordinator c3 real Task prompt retains scoped rules through depth three and resume", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const agents = yield* Agent.Service
    const root = yield* sessions.create({ title: "Scoped fixture root", permission: scopedRules })
    const task = yield* TaskTool
    const def = yield* task.init()
    const promptOps: TaskPromptOps = {
      cancel: () => Effect.void,
      resolvePromptParts: text => Effect.succeed([{ type: "text", text }]),
      prompt: input => Effect.gen(function* () {
        // Exercise the production prompt's durable policy transition, without a
        // provider request. A stub that merely inspected Task's create rules
        // would miss the permission replacement being reproduced here.
        const user = yield* prompt.prompt({ ...input, noReply: true })
        const info: MessageV2.Assistant = {
          id: MessageID.ascending(), role: "assistant", parentID: user.info.id,
          sessionID: input.sessionID, agent: input.agent!, mode: input.agent!,
          cost: 0, path: { cwd: "/fixture", root: "/fixture" },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: model.modelID, providerID: model.providerID, time: { created: Date.now() },
        }
        yield* sessions.updateMessage(info)
        return { info, parts: [] }
      }),
    }
    let parent = root
    for (let depth = 1; depth <= 3; depth++) {
      const user = yield* sessions.updateMessage({ id: MessageID.ascending(), role: "user",
        sessionID: parent.id, agent: "build", model, time: { created: Date.now() } })
      const assistant = yield* sessions.updateMessage({ id: MessageID.ascending(), role: "assistant",
        sessionID: parent.id, parentID: user.id, agent: "build", mode: "build", cost: 0,
        path: { cwd: "/fixture", root: "/fixture" }, modelID: model.modelID, providerID: model.providerID,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: Date.now() } })
      const target = depth < 3 ? "fixture-manager" : "general"
      const ctx = { sessionID: parent.id, messageID: assistant.id, agent: "build",
        abort: new AbortController().signal, messages: [], extra: { promptOps },
        metadata: () => Effect.void, ask: () => Effect.void }
      const args = { description: "Inspect fixture", prompt: "Inspect only approved scope", subagent_type: target }
      const result = yield* def.execute(args, ctx)
      const child = yield* sessions.get(result.metadata.sessionId)
      expect(child.parentID).toBe(parent.id)
      const agent = yield* agents.get(target)
      const effective = Permission.merge(agent!.permission, child.permission ?? [])
      expect(Permission.evaluate("external_directory", "/fixture-vault/Projects/*", effective).action).toBe("allow")
      expect(Permission.evaluate("external_directory", "/unapproved/*", effective).action).toBe("deny")
      expect(Permission.evaluate("edit", "/fixture-vault/Projects/a.md", effective).action).toBe("deny")
      expect(Permission.evaluate("bash", "echo fixture", effective).action).toBe("ask")
      expect(Permission.evaluate("doom_loop", "*", effective).action).toBe("ask")
      if (depth === 3) {
        expect(Permission.evaluate("task", "general", effective).action).toBe("deny")
        expect(Permission.evaluate("todowrite", "*", effective).action).toBe("deny")
        yield* def.execute({ ...args, task_id: child.id }, ctx)
        expect((yield* sessions.get(child.id)).permission).toEqual(child.permission)
      }
      parent = child
    }
  }),
  { config: { agent: { "fixture-manager": { mode: "subagent", permission: { task: "allow", todowrite: "allow" } } } } },
)

it.instance("coordinator c3 real Task prompt retains experimental primary tool prohibitions", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const root = yield* sessions.create({ title: "Primary tool fixture", permission: scopedRules })
    const user = yield* sessions.updateMessage({ id: MessageID.ascending(), role: "user", sessionID: root.id, agent: "build", model, time: { created: Date.now() } })
    const assistant = yield* sessions.updateMessage({ id: MessageID.ascending(), role: "assistant", sessionID: root.id, parentID: user.id, agent: "build", mode: "build", cost: 0,
      path: { cwd: "/fixture", root: "/fixture" }, modelID: model.modelID, providerID: model.providerID,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: Date.now() } })
    const task = yield* TaskTool
    const result = yield* (yield* task.init()).execute({ description: "Primary scope", prompt: "Inspect fixture", subagent_type: "general" }, {
      sessionID: root.id, messageID: assistant.id, agent: "build", abort: new AbortController().signal, messages: [], metadata: () => Effect.void, ask: () => Effect.void,
      extra: { promptOps: { cancel: () => Effect.void, resolvePromptParts: text => Effect.succeed([{ type: "text", text }]), prompt: input => prompt.prompt({ ...input, noReply: true }) } satisfies TaskPromptOps },
    })
    const child = yield* sessions.get(result.metadata.sessionId)
    expect(Permission.evaluate("read", "fixture.md", child.permission ?? []).action).toBe("deny")
    expect(Permission.evaluate("bash", "echo fixture", child.permission ?? []).action).toBe("deny")
    expect(Permission.evaluate("external_directory", "/fixture-vault/Projects/*", child.permission ?? []).action).toBe("allow")
    expect(Permission.evaluate("edit", "fixture.md", child.permission ?? []).action).toBe("deny")
  }),
  { config: { experimental: { primary_tools: ["read", "bash"] } } },
)
