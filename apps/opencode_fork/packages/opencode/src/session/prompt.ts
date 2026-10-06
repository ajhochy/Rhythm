import path from "path"
import os from "os"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import * as Log from "@opencode-ai/core/util/log"
import { SessionRevert } from "./revert"
import * as Session from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { SessionCompaction } from "./compaction"
import { Bus } from "../bus"
import { ProviderTransform } from "@/provider/transform"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import PROMPT_PLAN from "../session/prompt/plan.txt"
import BUILD_SWITCH from "../session/prompt/build-switch.txt"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { ToolRegistry } from "@/tool/registry"
import { ToolJsonSchema } from "@/tool/json-schema"
import { MCP } from "../mcp"
import { filterMcpToolsByAllowlist } from "./mcp_allowlist"
import {
  assertFunctionDeclarationCap,
  buildDeferredToolCatalog,
  DEFERRED_BUILTIN_SERVER,
  type DeferredMcpToolEntry,
  formatDeferredToolCatalog,
  GEMINI_FUNCTION_DECLARATION_CAP,
  isDeferredMcpToolAllowed,
  isMcpToolDeferred,
  measureSerializedMcpToolSurface,
  MCP_DISPATCH_TOOL_ID,
  parseDeferredMcpDispatchRequest,
  resolveDeferredMcpDescribeName,
  searchDeferredToolCatalog,
  shouldAutoDeferMcpTools,
  uniqueRawNames,
  validateDeferredMcpArguments,
} from "./mcp_deferred_tools"
import { buildProviderOrigins, sealCleanGroup } from "./rhythm_provider_projection"
import { LSP } from "@/lsp/lsp"
import { ulid } from "ulid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionProcessor } from "./processor"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { Shell } from "@/shell/shell"
import { ShellID } from "@/tool/shell/id"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Truncate } from "@/tool/truncate"
import * as ImageGeneration from "@/tool/image-generation"
import { decodeDataUrl, decodeDataUrlBytes } from "@/util/data-url"
import { Process } from "@/util/process"
import { Cause, Duration, Effect, Exit, Latch, Layer, Option, Scope, Context, Schema, Semaphore, Types } from "effect"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { InstanceState } from "@/effect/instance-state"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { SessionRunState } from "./run-state"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { SyncEvent } from "@/sync"
import { SessionEvent } from "@/v2/session-event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AgentAttachment, FileAttachment, ReferenceAttachment, Source } from "@opencode-ai/core/session-prompt"
import { Reference } from "@/reference/reference"
import * as DateTime from "effect/DateTime"
import { eq } from "@/storage/db"
import * as Database from "@/storage/db"
import { SessionTable } from "./session.sql"
import { Global } from "@opencode-ai/core/global"
import { mcpResultEnvelope } from "./mcp-result-envelope"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const decodeMessageInfo = Schema.decodeUnknownExit(MessageV2.Info)
const decodeMessagePart = Schema.decodeUnknownExit(MessageV2.Part)

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

const log = Log.create({ service: "session.prompt" })
const elog = EffectLogger.create({ service: "session.prompt" })

// Rhythm carried patch (tokens-03, #843): deferred MCP tool schema loading.
// See session/mcp_deferred_tools.ts for the full design rationale (mirrors
// the skill-scope dispatcher pattern in tool/skill.ts, #775).
const MCP_DISPATCH_DESCRIPTION =
  "Discover and call MCP tools and hosted builtin tools by name. Use action=search to find a tool, action=describe to obtain its complete required input schema, and action=execute to call it. " +
  'Search matches every word in any order. Always execute the canonical name that search/describe returns. ' +
  'For backward compatibility, { "name": "<tool_name>", "arguments": { ... } } defaults to action=execute.'

/** composedKey -> description, read from the AI SDK Tool objects mcp.tools() returns. */
function deferredDescriptions(mcpToolsAll: Record<string, AITool>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(mcpToolsAll)) {
    out[key] = item.description ?? ""
  }
  return out
}

type ReferencePromptMetadata = {
  name: string
  kind: "local" | "git" | "invalid"
  path?: string
  repository?: string
  branch?: string
  target?: string
  targetPath?: string
  problem?: string
  source: { value: string; start: number; end: number }
}

function stringField(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string" ? record[key] : undefined
}

function referencePromptMetadata(input: unknown): ReferencePromptMetadata | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  const record = input as Record<string, unknown>
  const name = stringField(record, "name")
  const kind = stringField(record, "kind")
  if (!name || (kind !== "local" && kind !== "git" && kind !== "invalid")) return
  if (!record.source || typeof record.source !== "object" || Array.isArray(record.source)) return
  const source = record.source as Record<string, unknown>
  const value = stringField(source, "value")
  if (!value || typeof source.start !== "number" || typeof source.end !== "number") return
  return {
    name,
    kind,
    path: stringField(record, "path"),
    repository: stringField(record, "repository"),
    branch: stringField(record, "branch"),
    target: stringField(record, "target"),
    targetPath: stringField(record, "targetPath"),
    problem: stringField(record, "problem"),
    source: { value, start: source.start, end: source.end },
  }
}

function referenceTextPart(input: {
  reference: Reference.Resolved
  source: ReferencePromptMetadata["source"]
  target?: string
  targetPath?: string
  problem?: string
}): MessageV2.TextPartInput {
  const metadata: ReferencePromptMetadata = {
    name: input.reference.name,
    kind: input.reference.kind,
    ...(input.reference.kind === "invalid"
      ? { repository: input.reference.repository }
      : { path: input.reference.path }),
    ...(input.reference.kind === "git"
      ? { repository: input.reference.repository, branch: input.reference.branch }
      : {}),
    ...(input.target === undefined ? {} : { target: input.target }),
    ...(input.targetPath ? { targetPath: input.targetPath } : {}),
    problem: input.problem ?? (input.reference.kind === "invalid" ? input.reference.message : undefined),
    source: input.source,
  }
  const label = metadata.target === undefined ? `@${metadata.name}` : `@${metadata.name}/${metadata.target}`
  return {
    type: "text",
    synthetic: true,
    text: [
      `Referenced configured reference ${label}.`,
      ...(metadata.kind === "local" ? ["Kind: local directory"] : []),
      ...(metadata.kind === "git" ? ["Kind: git repository"] : []),
      ...(metadata.repository ? [`Repository: ${metadata.repository}`] : []),
      ...(metadata.branch ? [`Branch/ref: ${metadata.branch}`] : []),
      ...(metadata.path ? [`Reference root: ${metadata.path}`] : []),
      ...(metadata.targetPath ? [`Resolved path: ${metadata.targetPath}`] : []),
      ...(metadata.problem
        ? [`Problem: ${metadata.problem}`]
        : [
            "For targeted context, inspect the reference path directly with Read, Glob, and Grep. For broader research, call the task tool with subagent scout and include this reference path.",
          ]),
    ].join("\n"),
    metadata: { reference: metadata },
  }
}

export interface Interface {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts>
  readonly loop: (input: LoopInput) => Effect.Effect<MessageV2.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<MessageV2.WithParts>
  readonly command: (input: CommandInput) => Effect.Effect<MessageV2.WithParts>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const fsys = yield* AppFileSystem.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const truncate = yield* Truncate.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    // Busy-session inputs are durable immediately, but their provider turns
    // must execute one at a time. Otherwise SessionRunState coalesces every
    // caller onto the active loop and only the newest queued user survives as
    // the next provider turn (#1424).
    const promptLocks = new Map<SessionID, Semaphore.Semaphore>()
    const promptLock = (sessionID: SessionID) => {
      const existing = promptLocks.get(sessionID)
      if (existing) return existing
      const next = Semaphore.makeUnsafe(1)
      promptLocks.set(sessionID, next)
      return next
    }
    yield* Effect.addFinalizer(() => Effect.sync(() => promptLocks.clear()))
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    const references = yield* Reference.Service
    const sync = yield* SyncEvent.Service
    const flags = yield* RuntimeFlags.Service
    const runner = Effect.fn("SessionPrompt.runner")(function* () {
      return yield* EffectBridge.make()
    })
    const ops = Effect.fn("SessionPrompt.ops")(function* () {
      return {
        cancel: (sessionID: SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input),
      } satisfies TaskPromptOps
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      yield* elog.info("cancel", { sessionID })
      yield* state.cancel(sessionID)
    })

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: Types.DeepMutable<PromptInput["parts"]> = [{ type: "text", text: template }]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      const mentionSource = (match: RegExpMatchArray) => {
        const start = match.index ?? 0
        return { value: match[0], start, end: start + match[0].length }
      }
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (!name) return
          if (seen.has(name)) return
          seen.add(name)

          const slash = name.indexOf("/")
          const alias = slash === -1 ? name : name.slice(0, slash)
          const reference = yield* references.get(alias)
          if (reference) {
            const source = mentionSource(match)
            if (reference.kind === "invalid") {
              parts.push(
                referenceTextPart({ reference, source, target: slash === -1 ? undefined : name.slice(slash + 1) }),
              )
              return
            }

            yield* references.ensure(reference.path)
            if (slash === -1) {
              parts.push(referenceTextPart({ reference, source }))
              return
            }

            const target = name.slice(slash + 1)
            const targetPath = path.resolve(reference.path, target)
            if (!AppFileSystem.contains(reference.path, targetPath)) {
              parts.push(
                referenceTextPart({
                  reference,
                  source,
                  target,
                  targetPath,
                  problem: `Path escapes configured reference @${alias}: ${target}`,
                }),
              )
              return
            }

            const info = yield* fsys.stat(targetPath).pipe(Effect.option)
            if (Option.isNone(info)) {
              parts.push(
                referenceTextPart({
                  reference,
                  source,
                  target,
                  targetPath,
                  problem: `Path does not exist inside configured reference @${alias}: ${target}`,
                }),
              )
              return
            }

            parts.push({
              type: "file",
              url: pathToFileURL(targetPath).href,
              filename: name,
              mime: info.value.type === "Directory" ? "application/x-directory" : "text/plain",
            })
            return
          }

          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(ctx.worktree, name)

          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
          })
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })

    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
      session: Session.Info
      history: MessageV2.WithParts[]
      providerID: ProviderID
      modelID: ModelID
    }) {
      if (input.session.parentID) return
      if (!Session.isDefaultTitle(input.session.title)) return

      const real = (m: MessageV2.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const idx = input.history.findIndex(real)
      if (idx === -1) return
      if (input.history.filter(real).length !== 1) return

      const context = input.history.slice(0, idx + 1)
      const firstUser = context[idx]
      if (!firstUser || firstUser.info.role !== "user") return
      const firstInfo = firstUser.info

      const subtasks = firstUser.parts.filter((p): p is MessageV2.SubtaskPart => p.type === "subtask")
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

      const ag = yield* agents.get("title")
      if (!ag) return
      const mdl = ag.model
        ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
        : ((yield* provider.getSmallModel(input.providerID)) ??
          (yield* provider.getModel(input.providerID, input.modelID)))
      const msgs = onlySubtasks
        ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
        : yield* MessageV2.toModelMessagesEffect(context, mdl)
      const text = yield* llm
        .stream({
          agent: ag,
          user: firstInfo,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID: input.session.id,
          retries: 2,
          messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
          // The title call carries the first user's stored input: same guard, real identities.
          // The title is a derived, history-only summary on every branch (never an answer).
          guardPurpose: "summary" as const,
          ...(onlySubtasks
            ? {}
            : {
                origins: () =>
                  buildProviderOrigins({
                    purpose: "summary",
                    userMessageId: firstInfo.id,
                    messages: context,
                    convertedCount: async (m) =>
                      (await MessageV2.toModelMessages([m as MessageV2.WithParts], mdl)).length,
                    leadingStatic: 1,
                  }),
              }),
        })
        .pipe(
          Stream.filter((e): e is Extract<LLM.Event, { type: "text-delta" }> => e.type === "text-delta"),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.orDie,
        )
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (!cleaned) return
      const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      yield* sessions
        .setTitle({ sessionID: input.session.id, title: t })
        .pipe(Effect.catchCause((cause) => elog.error("failed to generate title", { error: Cause.squash(cause) })))
    })

    const insertReminders = Effect.fn("SessionPrompt.insertReminders")(function* (input: {
      messages: MessageV2.WithParts[]
      agent: Agent.Info
      session: Session.Info
    }) {
      const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
      if (!userMessage) return input.messages

      if (!flags.experimentalPlanMode) {
        if (input.agent.name === "plan") {
          userMessage.parts.push({
            id: PartID.ascending(),
            messageID: userMessage.info.id,
            sessionID: userMessage.info.sessionID,
            type: "text",
            text: PROMPT_PLAN,
            synthetic: true,
          })
        }
        const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
        if (wasPlan && input.agent.name === "build") {
          userMessage.parts.push({
            id: PartID.ascending(),
            messageID: userMessage.info.id,
            sessionID: userMessage.info.sessionID,
            type: "text",
            text: BUILD_SWITCH,
            synthetic: true,
          })
        }
        return input.messages
      }

      const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")
      if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
        const ctx = yield* InstanceState.context
        const plan = Session.plan(input.session, ctx)
        if (!(yield* fsys.existsSafe(plan))) return input.messages
        const part = yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text: `${BUILD_SWITCH}\n\nA plan file exists at ${plan}. You should execute on the plan defined within it`,
          synthetic: true,
        })
        userMessage.parts.push(part)
        return input.messages
      }

      if (input.agent.name !== "plan" || assistantMessage?.info.agent === "plan") return input.messages

      const ctx = yield* InstanceState.context
      const plan = Session.plan(input.session, ctx)
      const exists = yield* fsys.existsSafe(plan)
      if (!exists) yield* fsys.ensureDir(path.dirname(plan)).pipe(Effect.catch(Effect.die))
      const part = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: `<system-reminder>
Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan File Info:
${exists ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.` : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the explore subagent type.

1. Focus on understanding the user's request and the code associated with their request

2. **Launch up to 3 explore agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase.
 - Use 1 agent when the task is isolated to known files, the user provided specific file paths, or you're making a small targeted change.
 - Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
 - Quality over quantity - 3 agents maximum, but you should try to use the minimum number of agents necessary (usually just 1)
 - If using multiple agents: Provide each agent with a specific search focus or area to explore. Example: One agent searches for existing implementations, another explores related components, a third investigates testing patterns

3. After exploring the code, use the question tool to clarify ambiguities in the user request up front.

### Phase 2: Design
Goal: Design an implementation approach.

Launch general agent(s) to design the implementation based on the user's intent and your exploration results from Phase 1.

You can launch up to 1 agent(s) in parallel.

**Guidelines:**
- **Default**: Launch at least 1 Plan agent for most tasks - it helps validate your understanding and consider alternatives
- **Skip agents**: Only for truly trivial tasks (typo fixes, single-line changes, simple renames)

Examples of when to use multiple agents:
- The task touches multiple parts of the codebase
- It's a large refactor or architectural change
- There are many edge cases to consider
- You'd benefit from exploring different approaches

Example perspectives by task type:
- New feature: simplicity vs performance vs maintainability
- Bug fix: root cause vs workaround vs prevention
- Refactoring: minimal change vs clean architecture

In the agent prompt:
- Provide comprehensive background context from Phase 1 exploration including filenames and code path traces
- Describe requirements and constraints
- Request a detailed implementation plan

### Phase 3: Review
Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.
1. Read the critical files identified by agents to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use question tool to clarify any remaining questions with the user

### Phase 4: Final Plan
Goal: Write your final plan to the plan file (the only file you can edit).
- Include only your recommended approach, not all alternatives
- Ensure that the plan file is concise enough to scan quickly, but detailed enough to execute effectively
- Include the paths of critical files to be modified
- Include a verification section describing how to test the changes end-to-end (run the code, use MCP tools, run tests)

### Phase 5: Call plan_exit tool
At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call plan_exit to indicate to the user that you are done planning.
This is critical - your turn should only end with either asking the user a question or calling plan_exit. Do not stop unless it's for these 2 reasons.

**Important:** Use question tool to clarify requirements/approach, use plan_exit to request plan approval. Do NOT use question tool to ask "Is this plan okay?" - that's what plan_exit does.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.
</system-reminder>`,
        synthetic: true,
      })
      userMessage.parts.push(part)
      return input.messages
    })

    const resolveTools = Effect.fn("SessionPrompt.resolveTools")(function* (input: {
      agent: Agent.Info
      model: Provider.Model
      session: Session.Info
      tools?: Record<string, boolean>
      processor: Pick<SessionProcessor.Handle, "message" | "toolCallIdentity" | "updateToolCall" | "completeToolCall">
      bypassAgentCheck: boolean
      messages: MessageV2.WithParts[]
    }) {
      using _ = log.time("resolveTools")
      const tools: Record<string, AITool> = {}
      const run = yield* runner()
      const promptOps = yield* ops()

      // `nativeInput` is what the native tool part holds as its input. It differs
      // from `args` only for a deferred call, where the outer part carries the
      // dispatcher arguments and `args` are the underlying tool's.
      const context = (args: any, options: ToolExecutionOptions, nativeInput: unknown = args): Tool.Context => ({
        sessionID: input.session.id,
        abort: options.abortSignal!,
        messageID: input.processor.message.id,
        callID: options.toolCallId,
        extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck, promptOps },
        agent: input.agent.name,
        messages: input.messages,
        metadata: (val) =>
          input.processor.updateToolCall(options.toolCallId, (match) => {
            if (!["running", "pending"].includes(match.state.status)) return match
            return {
              ...match,
              state: {
                title: val.title,
                metadata: val.metadata,
                status: "running",
                input: nativeInput as Record<string, any>,
                time: { start: Date.now() },
              },
            }
          }),
        // Permissions are read from the CURRENT session at every ask (not the
        // request snapshot), so a revocation made after the request was built — or
        // during an awaited hook — governs the effect. An unavailable or mismatched
        // session fails closed (die) instead of authorizing.
        ask: (req) =>
          Effect.gen(function* () {
            const current = yield* sessions.get(input.session.id)
            if (current.id !== input.session.id) return yield* Effect.die(new Error("Permission session is not current"))
            return yield* permission.ask({
              ...req,
              sessionID: input.session.id,
              tool: { messageID: input.processor.message.id, callID: options.toolCallId },
              ruleset: Permission.merge(input.agent.permission, current.permission ?? []),
            })
          }).pipe(Effect.orDie),
      })

      const registryQuery = (session: Pick<Session.Info, "skillAllowlist" | "permission">) => ({
        modelID: ModelID.make(input.model.api.id),
        providerID: input.model.providerID,
        agent: input.agent,
        // Rhythm carried patch (skill-scope, #775): scope the skill tool description.
        skillAllowlist: session.skillAllowlist,
        sessionPermission: session.permission,
      })
      type RegistryTool = Effect.Success<ReturnType<typeof registry.tools>>[number]

      // The single builtin execution pipeline (original Schema decode, ask,
      // plugin hooks, abort, metadata, attachments inside `item.execute`). The
      // eager definition and the deferred dispatcher both run exactly this.
      const runBuiltin = (item: RegistryTool, args: any, options: ToolExecutionOptions, nativeInput: unknown = args) =>
        Effect.gen(function* () {
          const ctx = context(args, options, nativeInput)
          yield* plugin.trigger(
            "tool.execute.before",
            { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
            { args },
          )
          const result = yield* item.execute(args, ctx)
          const output = {
            ...result,
            attachments: result.attachments?.map((attachment) => ({
              ...attachment,
              id: PartID.ascending(),
              sessionID: ctx.sessionID,
              messageID: input.processor.message.id,
            })),
          }
          yield* plugin.trigger(
            "tool.execute.after",
            { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
            output,
          )
          if (options.abortSignal?.aborted) {
            yield* input.processor.completeToolCall(options.toolCallId, output)
          }
          return output
        })

      // Hosted builtins are lazy unless `deferred === false` (the explicit
      // compatibility opt-out). A legacy MCP `deferredServers` selection only
      // shapes MCP behavior and is not a builtin opt-out. `invalid` stays eager: the
      // provider-call repair hook in llm.ts rewrites unknown/malformed calls to
      // toolName "invalid", which must resolve to a defined tool.
      const hostedAllowlist = input.session.mcpAllowlist
      const deferHostedBuiltins = hostedAllowlist?.deferred !== false
      const hostedItems = new Map<string, RegistryTool>()
      for (const item of yield* registry.tools(registryQuery(input.session))) {
        if (deferHostedBuiltins && item.id !== "invalid") {
          hostedItems.set(item.id, item)
          continue
        }
        const schema = ProviderTransform.schema(input.model, ToolJsonSchema.fromTool(item))
        tools[item.id] = tool({
          description: item.description,
          inputSchema: jsonSchema(schema),
          execute(args, options) {
            return run.promise(runBuiltin(item, args, options))
          },
        })
      }
      // Same gate LLM.resolveTools applies to eager keys (user tools + Permission.disabled),
      // re-applied here because deferred builtins never reach that filter.
      const hostedEligibleIds = (ids: string[], sessionPermission: Session.Info["permission"]) => {
        const disabled = Permission.disabled(ids, Permission.merge(input.agent.permission, sessionPermission ?? []))
        return ids.filter((id) => input.tools?.[id] !== false && !disabled.has(id))
      }
      // Current builtin inventory for one session snapshot, restricted to the ids
      // that were deferred for this request.
      const currentHostedTools = Effect.fn("SessionPrompt.currentHostedTools")(function* (
        session: Pick<Session.Info, "skillAllowlist" | "permission">,
      ) {
        const current = new Map<string, RegistryTool>()
        if (hostedItems.size === 0) return current
        const items = (yield* registry.tools(registryQuery(session))).filter((item) => hostedItems.has(item.id))
        const eligible = new Set(
          hostedEligibleIds(
            items.map((item) => item.id),
            session.permission,
          ),
        )
        for (const item of items) if (eligible.has(item.id)) current.set(item.id, item)
        return current
      })
      const hostedEntries = (items: Map<string, RegistryTool>): DeferredMcpToolEntry[] =>
        [...items.values()]
          .map((item) => ({
            name: item.id,
            server: DEFERRED_BUILTIN_SERVER,
            description: item.description,
            family: "builtin" as const,
          }))
          .toSorted((a, b) => a.name.localeCompare(b.name))

      // Rhythm carried patch (mcp-scope): build keyToServer from MCP metadata (not string-split)
      // then filter by session's mcpAllowlist before injecting tool schemas into model context.
      const mcpToolsAll = yield* mcp.tools(input.session.mcpAllowlist)
      const mcpAppTools = yield* mcp.appTools()
      const keyToServer = yield* mcp.toolClientNames()
      const allowedKeys = new Set(
        filterMcpToolsByAllowlist(Object.keys(mcpToolsAll), keyToServer, input.session.mcpAllowlist),
      )

      // Rhythm carried patch (tokens-03, #843): wraps ONE MCP tool's raw execute
      // with the same permission/plugin-trigger/truncation pipeline every MCP
      // tool has always gone through. Extracted to a closure so both the eager
      // path (below, unchanged behavior) and the deferred dispatcher's execute
      // (mcp_dispatch, only built when input.session.mcpAllowlist?.deferred is
      // true) share exactly one wrapping implementation — the dispatcher must
      // never grow a second, divergent execution path for MCP tool calls.
      // `stillEligible` (deferred calls only) is re-read at the LAST await before the underlying call,
      // so an allowlist revocation made while hooks/approval were pending cannot produce an effect.
      const wrapMcpTool = Effect.fn("SessionPrompt.wrapMcpTool")(function* (
        key: string,
        item: AITool,
        stillEligible?: Effect.Effect<boolean>,
      ) {
        const execute = item.execute
        if (!execute) return undefined

        const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
        const transformed = ProviderTransform.schema(input.model, schema)
        const wrapped: AITool = {
          ...item,
          inputSchema: jsonSchema(transformed),
          execute: (args, opts) =>
          run.promise(
            Effect.gen(function* () {
              const ctx = context(args, opts)
              yield* plugin.trigger(
                "tool.execute.before",
                { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
                { args },
              )
              const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* Effect.gen(function* () {
                yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
                if (stillEligible && !(yield* stillEligible)) {
                  return yield* Effect.die(new Error(`MCP tool "${key}" is no longer permitted for this session's allowlist.`))
                }
                const trustedOptions = MCP.withRhythmSecurityContext(opts, {
                  sdkSessionId: ctx.sessionID,
                  turnId: ctx.messageID,
                  agentName: ctx.agent,
                  toolCallId: opts.toolCallId,
                })
                return yield* Effect.promise(() => execute(args, trustedOptions))
              }).pipe(
                Effect.withSpan("Tool.execute", {
                  attributes: {
                    "tool.name": key,
                    "tool.call_id": opts.toolCallId,
                    "session.id": ctx.sessionID,
                    "message.id": input.processor.message.id,
                  },
                }),
              )
              let appOriginCommitted = false
              return yield* Effect.gen(function* () {
                yield* plugin.trigger(
                "tool.execute.after",
                { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
                result,
              )

              const textParts: string[] = []
              const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []
              for (const contentItem of result.content) {
                if (contentItem.type === "text") textParts.push(contentItem.text)
                else if (contentItem.type === "image") {
                  attachments.push({
                    type: "file",
                    mime: contentItem.mimeType,
                    url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
                  })
                } else if (contentItem.type === "resource") {
                  const { resource } = contentItem
                  if (resource.text) textParts.push(resource.text)
                  if (resource.blob) {
                    attachments.push({
                      type: "file",
                      mime: resource.mimeType ?? "application/octet-stream",
                      url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                      filename: resource.uri,
                    })
                  }
                }
              }

              const truncated = yield* truncate.output(textParts.join("\n\n"), {}, input.agent)
              const metadata = {
                ...result.metadata,
                truncated: truncated.truncated,
                ...(truncated.truncated && { outputPath: truncated.outputPath }),
              }

              const appTool = mcpAppTools[key]
              const part = appTool ? yield* input.processor.toolCallIdentity(opts.toolCallId) : undefined
              const advertisedAtMs = Date.now()
              const appOrigin = appTool && part
                ? {
                    sessionID: ctx.sessionID,
                    callID: opts.toolCallId,
                    serverName: appTool.client,
                    cwd: input.session.directory,
                    resourceUri: appTool.ui.resourceUri,
                    advertisedAt: new Date(advertisedAtMs).toISOString(),
                    expiresAt: new Date(advertisedAtMs + 10 * 60 * 1000).toISOString(),
                    part,
                  }
                : undefined
              // The MCP executor has already reserved the exact producing
              // transport under this trusted call identity. Commit only after
              // output assembly has succeeded and the running tool part still
              // exists; the processor confirms matching persistence by event.
              if (appOrigin && mcp.retainAppOrigin) {
                appOriginCommitted = yield* mcp.retainAppOrigin(appOrigin)
              }
              const output = {
                title: "",
                metadata,
                output: truncated.content,
                mcpResult: mcpResultEnvelope(result),
                mcpAppResource: appOriginCommitted ? appOrigin : undefined,
                attachments: attachments.map((attachment) => ({
                  ...attachment,
                  id: PartID.ascending(),
                  sessionID: ctx.sessionID,
                  messageID: input.processor.message.id,
                })),
                content: result.content,
              }
              if (opts.abortSignal?.aborted) {
                yield* input.processor.completeToolCall(opts.toolCallId, output)
              }
              return output
              }).pipe(
                Effect.ensuring(
                  Effect.suspend(() =>
                    appOriginCommitted
                      ? Effect.void
                      : (mcp.releaseProvisionalAppOrigin?.(ctx.sessionID, opts.toolCallId) ?? Effect.void),
                  ),
                ),
              )
            }),
          )
        }
        return wrapped
      })

      // MCP definitions are lazy by default. The sole eager MCP control is
      // mcp_dispatch; it searches/describes/executes current authorized tools
      // without adding every full schema to the provider request. An explicit
      // historical `deferred: false` remains the narrow eager compatibility
      // escape hatch, while an omitted legacy allowlist now takes this path.
      const autoDeferMcp = shouldAutoDeferMcpTools(
        input.model.providerID,
        Object.keys(tools).length,
        allowedKeys.size,
      )
      const hasLegacySelectiveDeferral = (input.session.mcpAllowlist?.deferredServers?.length ?? 0) > 0
      const deferredMcp =
        input.session.mcpAllowlist?.deferred === true ||
        autoDeferMcp ||
        (!hasLegacySelectiveDeferral && input.session.mcpAllowlist?.deferred !== false)
      const deferredKeys = new Set(
        [...allowedKeys].filter((key) =>
          autoDeferMcp || isMcpToolDeferred(key, keyToServer, input.session.mcpAllowlist),
        ),
      )
      const eagerKeys = new Set([...allowedKeys].filter((key) => !deferredKeys.has(key)))
      // One fresh read of the exact session, the real MCP inventory (with authoritative origins) and
      // the current allowlist/deferred eligibility. Captured request-time state is never authority.
      const readCurrentMcp = Effect.fn("SessionPrompt.readCurrentMcp")(function* () {
        // The selection passed to mcp.tools() needs a session, but that read is NOT authority: the
        // allowlist/deferred/native gates are applied from a session read made AFTER every inventory,
        // server and origin await below, so a revocation during those awaits can only remove keys.
        const selectionSession = yield* sessions.get(input.session.id).pipe(Effect.orDie)
        const currentMcpTools = yield* mcp.tools(selectionSession.mcpAllowlist)
        const currentKeyToServer = yield* mcp.toolClientNames()
        const origins = mcp.toolOrigins ? yield* mcp.toolOrigins() : []
        const currentSession = yield* sessions.get(input.session.id).pipe(Effect.orDie)
        const keys = new Set(
          [...deferredKeys].filter(
            (key) =>
              !!currentMcpTools[key] &&
              isMcpToolDeferred(key, currentKeyToServer, currentSession.mcpAllowlist) &&
              isDeferredMcpToolAllowed(key, currentKeyToServer, currentSession.mcpAllowlist),
          ),
        )
        return { currentSession, currentMcpTools, currentKeyToServer, origins, keys }
      })
      // Identity of the SELECTED definition: its actual origin (server + registered tool name) plus the
      // current model-facing description and schema, taken from the cached definition. Key membership
      // alone is not identity (one canonical key can be re-pointed or re-schemed), and wrapper object
      // identity is not usable (tools() builds fresh wrappers on every read). Undefined = unprovable.
      const descriptorOf = (
        cur: { currentMcpTools: Record<string, AITool>; origins: ReadonlyArray<{ key: string; serverName: string; toolName: string }> },
        key: string,
      ): string | undefined => {
        const item = cur.currentMcpTools[key]
        if (!item) return undefined
        const schema = asSchema(item.inputSchema).jsonSchema
        if (typeof (schema as PromiseLike<unknown>)?.then === "function") return undefined
        const origins = cur.origins
          .filter((origin) => origin.key === key)
          .map((origin) => [origin.serverName, origin.toolName])
          .toSorted((a, b) => `${a[0]}\u0000${a[1]}`.localeCompare(`${b[0]}\u0000${b[1]}`))
        return JSON.stringify({ key, origins, description: item.description ?? "", schema })
      }
      const catalog = [
        ...hostedEntries(
          new Map(
            [...hostedItems].filter(([id]) => hostedEligibleIds([id], input.session.permission).length > 0),
          ),
        ),
        ...buildDeferredToolCatalog(deferredKeys, keyToServer, deferredDescriptions(mcpToolsAll)),
      ]
      const dispatchInputSchema: JSONSchema7 = {
        type: "object",
        properties: {
          family: {
            type: "string",
            enum: ["mcp", "builtin"],
            description: "Tool namespace: mcp (default) for MCP tools, builtin for hosted builtin tools such as read, bash or task.",
          },
          action: {
            type: "string",
            enum: ["search", "describe", "execute"],
            description: "search finds authorized tools, describe returns one selected tool's full schema, and execute calls it. Defaults to execute for legacy calls.",
          },
          query: {
            type: "string",
            description: "Search words for action=search.",
          },
          name: {
            type: "string",
            description:
              "describe: the exact catalog name or an unambiguous registered tool name. execute: the exact canonical name returned by search/describe.",
          },
          arguments: {
            type: "object",
            description: "The JSON object for action=execute. Call describe first when the required schema is not already known.",
          },
        },
        additionalProperties: false,
      }
      const dispatchDescription = MCP_DISPATCH_DESCRIPTION + "\n\n" + formatDeferredToolCatalog(catalog)
      const lazyMcpBootstrap = {
        name: MCP_DISPATCH_TOOL_ID,
        description: dispatchDescription,
        inputSchema: dispatchInputSchema,
      }

      // Full-deferred sessions keep their dispatcher even with an empty
      // catalog (contract: dispatch of any name is rejected with the
      // "No MCP tools" message); per-server deferral only materializes the
      // dispatcher when it actually has entries.
      if (deferredMcp || deferredKeys.size > 0 || hostedItems.size > 0) {
        tools[MCP_DISPATCH_TOOL_ID] = tool({
          description: dispatchDescription,
          inputSchema: jsonSchema(dispatchInputSchema),
          execute: (rawArgs: unknown, options: ToolExecutionOptions) =>
            run.promise(
              Effect.gen(function* () {
                const request = parseDeferredMcpDispatchRequest(rawArgs)
                // Hosted builtins are re-resolved from the CURRENT session (skill
                // scope, permission) and the same user-tool/Permission.disabled gate
                // used for eager keys, at discovery and again at execution.
                const session0 = yield* sessions.get(input.session.id).pipe(Effect.orDie)
                const hostedAtStart = request.family === "mcp" ? new Map<string, RegistryTool>() : yield* currentHostedTools(session0)
                // The freshest eligibility read is always the LAST await before anything is exposed
                // or run, so a revocation/replacement during earlier awaits cannot leak a schema,
                // result or effect from captured state.
                const stillHosted = (session: Pick<Session.Info, "permission">) =>
                  new Map(
                    [...hostedAtStart].filter(([id]) => hostedEligibleIds([id], session.permission).length > 0),
                  )
                if (request.action === "search") {
                  let hostedNow = new Map<string, RegistryTool>()
                  let currentCatalog: DeferredMcpToolEntry[] = []
                  if (request.family === "builtin") {
                    hostedNow = stillHosted(yield* sessions.get(input.session.id).pipe(Effect.orDie))
                  } else {
                    const cur = yield* readCurrentMcp()
                    hostedNow = stillHosted(cur.currentSession)
                    currentCatalog = buildDeferredToolCatalog(
                      cur.keys,
                      cur.currentKeyToServer,
                      deferredDescriptions(cur.currentMcpTools),
                      uniqueRawNames(cur.keys, cur.origins),
                    )
                  }
                  const entries =
                    request.family === "builtin"
                      ? hostedEntries(hostedNow)
                      : request.family === "mcp"
                        ? currentCatalog
                        : [...hostedEntries(hostedNow), ...currentCatalog]
                  return {
                    title: "mcp_dispatch search",
                    metadata: {},
                    output: JSON.stringify({
                      tools: searchDeferredToolCatalog(entries, request.query).map((entry) => ({
                        ...entry,
                        family: entry.family ?? "mcp",
                      })),
                    }),
                  }
                }
                if (request.family === "builtin") {
                  const latest = yield* sessions.get(input.session.id).pipe(Effect.orDie)
                  const item = stillHosted(latest).get(request.name)
                  if (!item) {
                    throw new Error(`Builtin tool "${request.name}" is not permitted or not available for this session.`)
                  }
                  if (request.action === "describe") {
                    return {
                      title: `mcp_dispatch describe ${request.name}`,
                      metadata: {},
                      output: JSON.stringify({
                        family: "builtin",
                        name: item.id,
                        description: item.description,
                        inputSchema: ProviderTransform.schema(input.model, ToolJsonSchema.fromTool(item)),
                      }),
                    }
                  }
                  // Original wrapped executor: Schema decode, ask, plugin hooks, abort,
                  // metadata, attachments — with the real outer call's options.
                  return yield* runBuiltin(item, request.arguments, options, rawArgs)
                }
                const cur = yield* readCurrentMcp()
                const currentMcpTools = cur.currentMcpTools
                // describe accepts the canonical key or an unambiguous registered tool name, resolved
                // only inside the fresh permitted inventory. execute is canonical-only.
                let selected = request.name
                if (request.action === "describe") {
                  const resolved = resolveDeferredMcpDescribeName(request.name, cur.keys, cur.origins)
                  if (!resolved.ok && resolved.reason === "ambiguous") {
                    throw new Error(
                      `MCP tool name "${request.name}" matches more than one permitted tool; describe one of these exact names: ${resolved.candidates.join(", ")}.`,
                    )
                  }
                  if (resolved.ok) selected = resolved.key
                }
                if (!cur.keys.has(selected)) {
                  throw new Error(`MCP tool "${request.name}" is not permitted for this session's allowlist.`)
                }
                const rawItem = currentMcpTools[selected]
                if (!rawItem) {
                  throw new Error(`MCP tool "${request.name}" is not available in the current inventory.`)
                }
                // The selected definition's identity (origin + current description/schema). Describe
                // exposes it synchronously from this same read; execute re-proves it at the last await.
                const proof = descriptorOf(cur, selected)
                if (proof === undefined) {
                  throw new Error(`MCP tool "${request.name}" could not be verified against its current definition.`)
                }
                if (request.action === "describe") {
                  const described = asSchema(rawItem.inputSchema).jsonSchema as JSONSchema7
                  const registered = uniqueRawNames([selected], cur.origins)[selected]
                  return {
                    title: `mcp_dispatch describe ${selected}`,
                    metadata: {},
                    output: JSON.stringify({
                      name: selected,
                      ...(registered !== undefined && registered !== selected ? { registeredName: registered } : {}),
                      description: rawItem.description ?? "",
                      inputSchema: described,
                    }),
                  }
                }
                const inputSchema = yield* Effect.promise(() => Promise.resolve(asSchema(rawItem.inputSchema).jsonSchema))
                const validation = yield* Effect.promise(() =>
                  Promise.resolve(asSchema(rawItem.inputSchema).validate?.(request.arguments)),
                )
                if (validation && !validation.success) {
                  throw new Error(`MCP tool "${request.name}" arguments are invalid: ${validation.error.message}`)
                }
                // JSON-schema-only definitions carry no validate hook, so the
                // advertised schema itself is enforced (fail closed) before any effect.
                const schemaError = validateDeferredMcpArguments(inputSchema, request.arguments)
                if (schemaError) {
                  throw new Error(`MCP tool "${request.name}" arguments are invalid: ${schemaError}`)
                }
                const wrapped = yield* wrapMcpTool(
                  request.name,
                  rawItem,
                  // Last await before the underlying call: still permitted AND still the same selected
                  // definition. A replaced origin/schema/description holds; the old executor is never run.
                  readCurrentMcp().pipe(
                    Effect.map((latest) => latest.keys.has(request.name) && descriptorOf(latest, request.name) === proof),
                  ),
                )
                if (!wrapped?.execute) {
                  throw new Error(`MCP tool "${request.name}" has no executable implementation.`)
                }
                // Carry the original SDK options through the inner call. The
                // active-run registration below maps this real outer call to
                // the selected key only while it is executing; no synthetic
                // call id or transcript is created.
                return yield* state.withDeferredMcpToolCall(
                  input.session.id,
                  input.processor.message.id,
                  options.toolCallId,
                  request.name,
                  Effect.promise(() => wrapped.execute!(request.arguments, options)),
                )
              }),
            ),
        })
      }
      if (autoDeferMcp) {
        log.warn("Gemini function declarations auto-deferred", {
          deferred: deferredKeys.size,
          reason: "provider_cap",
          cap: GEMINI_FUNCTION_DECLARATION_CAP,
        })
      }
      for (const [key, item] of Object.entries(mcpToolsAll)) {
        if (!eagerKeys.has(key)) continue
        const wrapped = yield* wrapMcpTool(key, item)
        if (!wrapped) continue
        tools[key] = wrapped
      }

      const mcpSurface = deferredMcp || deferredKeys.size > 0
        ? measureSerializedMcpToolSurface({
            eagerDefinitions: Object.fromEntries(
              yield* Effect.forEach([...allowedKeys].toSorted(), (key) =>
                Effect.promise(async () => {
                  const item = mcpToolsAll[key]
                  return [
                    key,
                    {
                      name: key,
                      description: item?.description ?? "",
                      inputSchema: ProviderTransform.schema(
                        input.model,
                        await asSchema(item?.inputSchema).jsonSchema,
                      ),
                    },
                  ]
                }),
              ),
            ),
            lazyBootstrap: lazyMcpBootstrap,
          })
        : undefined

      // Rhythm carried patch (#1094): native OpenAI image generation. Injected
      // here rather than through ToolRegistry because a provider tool has no
      // `execute` — OpenAI runs it server-side on this turn's own connection.
      const imageRuleset = Permission.merge(input.agent.permission, input.session.permission ?? [])
      const imageAction = ImageGeneration.enabledFor(input.model, imageRuleset)
      if (imageAction) {
        // Provider-executed means the image already exists by the time the call
        // reaches us, so there is no mid-call hook to ask from. `ask` therefore
        // resolves once, up front, before the tool is offered at all. Passing an
        // empty ruleset makes the prompt unconditional (the action is already
        // decided above); the instance-level approvals `ask` keeps internally
        // still short-circuit it after an "always" reply, so this is one prompt
        // per engine boot, not one per turn. A rejection just withholds the tool.
        const approved =
          imageAction === "allow" ||
          (yield* permission
            .ask({
              permission: ImageGeneration.ID,
              patterns: ["*"],
              always: ["*"],
              sessionID: input.session.id,
              metadata: {},
              ruleset: [],
            })
            .pipe(
              Effect.as(true),
              Effect.catch(() => Effect.succeed(false)),
            ))
        if (approved) tools[ImageGeneration.ID] = ImageGeneration.tool()
      }

      assertFunctionDeclarationCap(input.model.providerID, Object.keys(tools).length)

      // Rhythm carried patch (mcp-scope): measurement instrument for the per-session
      // MCP allowlist. resolveToolsCount is the number of tool schemas injected into
      // model context; allowlistActive indicates whether the session was scoped by a
      // profile (false → all MCP tools injected, back-compat). Read from engine logs
      // during the Secretary smoke (see docs/ai/testing-guide.md "MCP allowlist smoke").
      // deferredMcpActive (tokens-03, #843) indicates whether THIS session used the
      // names-only catalog + dispatcher instead of per-tool schema injection;
      // deferredMcpCatalogSize is the number of MCP tools in that catalog (the count
      // that would otherwise have been individually schema-injected).
      log.debug("resolveTools complete", {
        resolveToolsCount: Object.keys(tools).length,
        // #1094: undefined when the profile does not grant image_generation or
        // the model is not an OpenAI Responses one — the two ways this stays off.
        imageGeneration: imageAction,
        imageGenerationOffered: ImageGeneration.ID in tools,
        allowlistActive: !!input.session.mcpAllowlist,
        deferredMcpActive: deferredMcp || deferredKeys.size > 0,
        deferredMcpCatalogSize: deferredKeys.size > 0 ? deferredKeys.size : undefined,
        eagerMcpDefinitionBytes: mcpSurface?.eagerDefinitionBytes,
        lazyMcpBootstrapBytes: mcpSurface?.lazyBootstrapBytes,
        // Hosted builtins withheld from the request (exact serialized UTF-8 bytes they would add).
        hostedBuiltinDeferredCount: hostedItems.size,
        hostedBuiltinDeferredDefinitionBytes:
          hostedItems.size > 0
            ? measureSerializedMcpToolSurface({
                eagerDefinitions: Object.fromEntries(
                  [...hostedItems].map(([id, item]) => [
                    id,
                    {
                      name: id,
                      description: item.description,
                      inputSchema: ProviderTransform.schema(input.model, ToolJsonSchema.fromTool(item)),
                    },
                  ]),
                ),
                lazyBootstrap: undefined,
              }).eagerDefinitionBytes
            : undefined,
        // Heuristic ceil(UTF-8 bytes / 4); not provider tokens.
        eagerMcpBytesDiv4Estimate: mcpSurface?.eagerBytesDiv4Estimate,
        lazyMcpBytesDiv4Estimate: mcpSurface?.lazyBytesDiv4Estimate,
      })

      return tools
    })

    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
      task: MessageV2.SubtaskPart
      model: Provider.Model
      lastUser: MessageV2.User
      sessionID: SessionID
      session: Session.Info
      msgs: MessageV2.WithParts[]
    }) {
      const { task, model, lastUser, sessionID, session, msgs } = input
      const ctx = yield* InstanceState.context
      const promptOps = yield* ops()
      const { task: taskTool } = yield* registry.named()
      const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
      const assistantMessage: MessageV2.Assistant = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: lastUser.id,
        sessionID,
        mode: task.agent,
        agent: task.agent,
        variant: lastUser.model.variant,
        path: { cwd: ctx.directory, root: ctx.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: taskModel.id,
        providerID: taskModel.providerID,
        time: { created: Date.now() },
      })
      let part: MessageV2.ToolPart = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: "tool",
        callID: ulid(),
        tool: TaskTool.id,
        state: {
          status: "running",
          input: {
            prompt: task.prompt,
            description: task.description,
            subagent_type: task.agent,
            command: task.command,
          },
          time: { start: Date.now() },
        },
      })
      const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      }
      yield* plugin.trigger(
        "tool.execute.before",
        { tool: TaskTool.id, sessionID, callID: part.id },
        { args: taskArgs },
      )

      const taskAgent = yield* agents.get(task.agent)
      if (!taskAgent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
        throw error
      }

      let error: Error | undefined
      const taskAbort = new AbortController()
      const result = yield* taskTool
        .execute(taskArgs, {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID,
          abort: taskAbort.signal,
          callID: part.callID,
          extra: { bypassAgentCheck: true, promptOps },
          messages: msgs,
          metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
            Effect.gen(function* () {
              part = yield* sessions.updatePart({
                ...part,
                type: "tool",
                state: { ...part.state, ...val },
              } satisfies MessageV2.ToolPart)
            }),
          ask: (req: any) =>
            permission
              .ask({
                ...req,
                sessionID,
                ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
              })
              .pipe(Effect.orDie),
        })
        .pipe(
          Effect.catchCause((cause) => {
            const defect = Cause.squash(cause)
            error = defect instanceof Error ? defect : new Error(String(defect))
            log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
            return Effect.void
          }),
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              taskAbort.abort()
              assistantMessage.finish = "tool-calls"
              assistantMessage.time.completed = Date.now()
              yield* sessions.updateMessage(assistantMessage)
              if (part.state.status === "running") {
                yield* sessions.updatePart({
                  ...part,
                  state: {
                    status: "error",
                    error: "Cancelled",
                    time: { start: part.state.time.start, end: Date.now() },
                    metadata: part.state.metadata,
                    input: part.state.input,
                  },
                } satisfies MessageV2.ToolPart)
              }
            }),
          ),
        )

      const attachments = result?.attachments?.map((attachment) => ({
        ...attachment,
        id: PartID.ascending(),
        sessionID,
        messageID: assistantMessage.id,
      }))

      yield* plugin.trigger(
        "tool.execute.after",
        { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
        result,
      )

      assistantMessage.finish = "tool-calls"
      assistantMessage.time.completed = Date.now()
      yield* sessions.updateMessage(assistantMessage)

      if (result && part.state.status === "running") {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: { ...part.state.time, end: Date.now() },
          },
        } satisfies MessageV2.ToolPart)
      }

      if (!result) {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "error",
            error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
            time: {
              start: part.state.status === "running" ? part.state.time.start : Date.now(),
              end: Date.now(),
            },
            metadata: part.state.status === "pending" ? undefined : part.state.metadata,
            input: part.state.input,
          },
        } satisfies MessageV2.ToolPart)
      }

      if (!task.command) return

      const summaryUserMsg: MessageV2.User = {
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: lastUser.agent,
        model: lastUser.model,
      }
      yield* sessions.updateMessage(summaryUserMsg)
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: summaryUserMsg.id,
        sessionID,
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
        synthetic: true,
      } satisfies MessageV2.TextPart)
    })

    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput, ready?: Latch.Latch) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
          const { msg, part, cwd } = yield* Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
            if (session.revert) {
              yield* revert.cleanup(session)
            }
            const agent = yield* agents.get(input.agent)
            if (!agent) {
              const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
              const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
              const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
              yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
              throw error
            }
            const model = input.model ?? agent.model ?? (yield* currentModel(input.sessionID))
            const userMsg: MessageV2.User = {
              id: input.messageID ?? MessageID.ascending(),
              sessionID: input.sessionID,
              time: { created: Date.now() },
              role: "user",
              agent: input.agent,
              model: { providerID: model.providerID, modelID: model.modelID },
            }
            yield* sessions.updateMessage(userMsg)
            const userPart: MessageV2.Part = {
              type: "text",
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: input.sessionID,
              text: "The following tool was executed by the user",
              synthetic: true,
            }
            yield* sessions.updatePart(userPart)

            const msg: MessageV2.Assistant = {
              id: MessageID.ascending(),
              sessionID: input.sessionID,
              parentID: userMsg.id,
              mode: input.agent,
              agent: input.agent,
              cost: 0,
              path: { cwd: ctx.directory, root: ctx.worktree },
              time: { created: Date.now() },
              role: "assistant",
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: model.modelID,
              providerID: model.providerID,
            }
            yield* sessions.updateMessage(msg)
            const callID = ulid()
            const started = Date.now()
            const part: MessageV2.ToolPart = {
              type: "tool",
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: input.sessionID,
              tool: ShellID.ToolID,
              callID: ulid(),
              state: {
                status: "running",
                time: { start: started },
                input: { command: input.command },
              },
            }
            yield* sessions.updatePart(part)
            if (flags.experimentalEventSystem) {
              yield* sync.run(SessionEvent.Shell.Started.Sync, {
                sessionID: input.sessionID,
                timestamp: DateTime.makeUnsafe(started),
                callID,
                command: input.command,
              })
            }
            return { msg, part, cwd: ctx.directory }
          }).pipe(Effect.ensuring(markReady))

          const cfg = yield* config.get()
          const sh = Shell.preferred(cfg.shell)
          const args = Shell.args(sh, input.command, cwd)
          let output = ""
          let aborted = false

          const finish = Effect.uninterruptible(
            Effect.gen(function* () {
              if (aborted) {
                output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
              }
              const completed = Date.now()
              if (flags.experimentalEventSystem) {
                yield* sync.run(SessionEvent.Shell.Ended.Sync, {
                  sessionID: input.sessionID,
                  timestamp: DateTime.makeUnsafe(completed),
                  callID: part.callID,
                  output,
                })
              }
              if (!msg.time.completed) {
                msg.time.completed = completed
                yield* sessions.updateMessage(msg)
              }
              if (part.state.status === "running") {
                part.state = {
                  status: "completed",
                  time: { ...part.state.time, end: completed },
                  input: part.state.input,
                  title: "",
                  metadata: { output, description: "" },
                  output,
                }
                yield* sessions.updatePart(part)
              }
            }),
          )

          const exit = yield* restore(
            Effect.gen(function* () {
              const shellEnv = yield* plugin.trigger(
                "shell.env",
                { cwd, sessionID: input.sessionID, callID: part.callID },
                { env: {} },
              )
              const cmd = ChildProcess.make(sh, args, {
                cwd,
                extendEnv: true,
                env: { ...shellEnv.env, TERM: "dumb" },
                stdin: "ignore",
                forceKillAfter: Duration.millis(flags.shellKillGraceMs),
              })
              const handle = yield* spawner.spawn(cmd)
              yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                Effect.gen(function* () {
                  output += chunk
                  if (part.state.status === "running") {
                    part.state.metadata = { output, description: "" }
                    yield* sessions.updatePart(part)
                  }
                }),
              )
              yield* handle.exitCode
            }).pipe(Effect.scoped, Effect.orDie),
          ).pipe(Effect.exit)

          if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause)) {
            aborted = true
          }
          yield* finish

          if (Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause)) {
            return yield* Effect.failCause(exit.cause)
          }

          return { info: msg, parts: [part] }
        }),
      )
    })

    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderID,
      modelID: ModelID,
      sessionID: SessionID,
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return exit.value
      const err = Cause.squash(exit.cause)
      if (Provider.ModelNotFoundError.isInstance(err)) {
        const hint = err.data.suggestions?.length ? ` Did you mean: ${err.data.suggestions.join(", ")}?` : ""
        yield* bus.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${err.data.providerID}/${err.data.modelID}.${hint}`,
          }).toObject(),
        })
      }
      return yield* Effect.failCause(exit.cause)
    })

    const currentModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const current = Database.use((db) =>
        db.select({ model: SessionTable.model }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
      )
      if (current?.model) {
        return {
          providerID: ProviderID.make(current.model.providerID),
          modelID: ModelID.make(current.model.id),
          ...(current.model.variant && current.model.variant !== "default" ? { variant: current.model.variant } : {}),
        }
      }
      const match = yield* sessions
        .findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
        .pipe(Effect.orDie)
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      return yield* provider.defaultModel()
    })

    const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
      const agentName = input.agent
      const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!ag) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const current = Database.use((db) =>
        db
          .select({ agent: SessionTable.agent, model: SessionTable.model })
          .from(SessionTable)
          .where(eq(SessionTable.id, input.sessionID))
          .get(),
      )
      const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
      const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
      const full =
        !input.variant && ag.variant && same
          ? yield* provider.getModel(model.providerID, model.modelID).pipe(Effect.catchDefect(() => Effect.void))
          : undefined
      const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)

      const info: MessageV2.User = {
        id: input.messageID ?? MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        time: { created: Date.now() },
        tools: input.tools,
        agent: ag.name,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
          variant,
        },
        system: input.system,
        format: input.format,
      }

      if (current?.agent !== info.agent) {
        yield* sync.run(SessionEvent.AgentSwitched.Sync, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(info.time.created),
          agent: info.agent,
        })
      }
      if (
        current?.model?.providerID !== info.model.providerID ||
        current.model.id !== info.model.modelID ||
        (current.model.variant === "default" ? undefined : current.model.variant) !== info.model.variant
      ) {
        yield* sync.run(SessionEvent.ModelSwitched.Sync, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(info.time.created),
          model: {
            id: ModelV2.ID.make(info.model.modelID),
            providerID: ProviderV2.ID.make(info.model.providerID),
            variant: ModelV2.VariantID.make(info.model.variant ?? "default"),
          },
        })
      }

      yield* Effect.addFinalizer(() => instruction.clear(info.id))

      type Draft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never
      const assign = (part: Draft<MessageV2.Part>): MessageV2.Part => ({
        ...part,
        id: part.id ? PartID.make(part.id) : PartID.ascending(),
      })

      const referenceContextFromFilePart = Effect.fnUntraced(function* (
        part: Extract<PromptInput["parts"][number], { type: "file" }>,
        filepath: string,
      ) {
        const name = part.filename?.replace(/#\d+(?:-\d*)?$/, "")
        if (!name) return
        const slash = name.indexOf("/")
        if (slash === -1) return

        const reference = yield* references.get(name.slice(0, slash))
        if (!reference || reference.kind === "invalid") return
        if (!AppFileSystem.contains(reference.path, filepath)) return

        const target = path.relative(reference.path, filepath).split(path.sep).join("/")
        if (!target || target.startsWith("../") || target === "..") return

        return referenceTextPart({
          reference,
          source: part.source?.text ?? { value: `@${name}`, start: 0, end: name.length + 1 },
          target,
          targetPath: filepath,
        })
      })

      const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<MessageV2.Part>[]> = Effect.fn(
        "SessionPrompt.resolveUserPart",
      )(function* (part) {
        if (part.type === "file") {
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            log.info("mcp resource", { clientName, uri, mime: part.mime })
            const pieces: Draft<MessageV2.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]
            const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
            if (Exit.isSuccess(exit)) {
              const content = exit.value
              if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
              const items = Array.isArray(content.contents) ? content.contents : [content.contents]
              for (const c of items) {
                if ("text" in c && c.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: c.text,
                  })
                } else if ("blob" in c && c.blob) {
                  const mime = "mimeType" in c ? c.mimeType : part.mime
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary content: ${mime}]`,
                  })
                }
              }
              pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
            } else {
              const error = Cause.squash(exit.cause)
              log.error("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }
            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: decodeDataUrl(part.url),
                  },
                  { ...part, messageID: info.id, sessionID: input.sessionID },
                ]
              }
              if (part.mime.startsWith("image/") || part.mime === "application/pdf") break

              // Browsers cannot provide a stable local path. Persist the
              // selected binary in the engine-owned temp tree so the same
              // real Read → reader-discovery path used by native clients runs
              // instead of forwarding opaque bytes to the provider.
              const safeName = path
                .basename(part.filename || "attachment.bin")
                .replaceAll(/[^A-Za-z0-9._-]/g, "_")
              const filepath = path.join(
                Global.Path.tmp,
                "attachments",
                input.sessionID,
                `${ulid()}-${safeName || "attachment.bin"}`,
              )
              yield* fsys.writeWithDirs(filepath, decodeDataUrlBytes(part.url), 0o600).pipe(Effect.orDie)
              return yield* resolvePart({
                ...part,
                url: pathToFileURL(filepath).href,
                filename: part.filename || safeName,
              })
            case "file:": {
              log.info("file", { mime: part.mime })
              const filepath = fileURLToPath(part.url)
              const referenceContext = yield* referenceContextFromFilePart(part, filepath)
              const mime = (yield* fsys.isDir(filepath)) ? "application/x-directory" : part.mime

              const { read } = yield* registry.named()
              const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
                const controller = new AbortController()
                return read
                  .execute(args, {
                    sessionID: input.sessionID,
                    abort: controller.signal,
                    agent: input.agent!,
                    messageID: info.id,
                    extra: { bypassCwdCheck: true, ...extra },
                    messages: [],
                    metadata: () => Effect.void,
                    ask: () => Effect.void,
                  })
                  .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
              }

              if (mime === "text/plain") {
                let offset: number | undefined
                let limit: number | undefined
                const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  if (start === end) {
                    const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                    for (const symbol of symbols) {
                      let r: LSP.Range | undefined
                      if ("range" in symbol) r = symbol.range
                      else if ("location" in symbol) r = symbol.location.range
                      if (r?.start?.line && r?.start?.line === start) {
                        start = r.start.line
                        end = r?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) limit = end - (offset - 1)
                }
                const args = { filePath: filepath, offset, limit }
                const pieces: Draft<MessageV2.Part>[] = [
                  ...(referenceContext
                    ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                    : []),
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]
                const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
                  Effect.flatMap((mdl) => execRead(args, { model: mdl })),
                  Effect.exit,
                )
                if (Exit.isSuccess(exit)) {
                  const result = exit.value
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((a) => ({
                        ...a,
                        synthetic: true,
                        filename: a.filename ?? part.filename,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })),
                    )
                  } else {
                    pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
                  }
                } else {
                  const error = Cause.squash(exit.cause)
                  log.error("failed to read file", { error })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* bus.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  })
                }
                return pieces
              }

              if (mime === "application/x-directory") {
                const args = { filePath: filepath }
                const exit = yield* execRead(args).pipe(Effect.exit)
                if (Exit.isFailure(exit)) {
                  const error = Cause.squash(exit.cause)
                  log.error("failed to read directory", { error })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* bus.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  return [
                    ...(referenceContext
                      ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                      : []),
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    },
                  ]
                }
                return [
                  ...(referenceContext
                    ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                    : []),
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: exit.value.output,
                  },
                  { ...part, mime, messageID: info.id, sessionID: input.sessionID },
                ]
              }

              const args = { filePath: filepath }
              const pieces: Draft<MessageV2.Part>[] = [
                ...(referenceContext ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }] : []),
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                },
              ]
              const exit = yield* execRead(args).pipe(Effect.exit)
              if (Exit.isSuccess(exit)) {
                pieces.push({
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: exit.value.output,
                })
                if (exit.value.attachments?.length) {
                  pieces.push(
                    ...exit.value.attachments.map((attachment) => ({
                      ...attachment,
                      synthetic: true,
                      filename: attachment.filename ?? part.filename,
                      messageID: info.id,
                      sessionID: input.sessionID,
                    })),
                  )
                }
                return pieces
              }

              const error = Cause.squash(exit.cause)
              const message = error instanceof Error ? error.message : String(error)
              log.error("failed to read attached file", { error, filepath, mime })
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Read tool failed to read ${filepath} with the following error: ${message}`,
              })
              if (message.includes("Cannot read binary file:")) {
                const extension = path.extname(filepath).toLowerCase() || "(no extension)"
                const officeHint =
                  extension === ".docx"
                    ? " Check the existing `docx` skill first."
                    : extension === ".xlsx"
                      ? " Check the existing `xlsx` skill first."
                      : extension === ".pptx"
                        ? " Check the existing `pptx` skill first."
                        : ""
                const extensionTerm = extension.startsWith(".") ? extension.slice(1) : ""
                const mimeSubtype = mime.toLowerCase().split("/")[1] ?? ""
                const terms = [extensionTerm, ...mime.toLowerCase().split(/[^a-z0-9]+/)].filter(
                  (term) =>
                    term.length >= 3 &&
                    !["application", "binary", "file", "octet", "stream"].includes(term),
                )
                const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "")
                const score = (value: string) => {
                  const normalized = value.toLowerCase()
                  const compacted = compact(value)
                  let result = 0
                  // Exact format signals dominate generic MIME words. Without
                  // this weighting, a large catalog full of unrelated "Rhythm"
                  // descriptions alphabetically crowds a real
                  // `rhythmfixture-reader` out of the five surfaced results.
                  if (extensionTerm && compacted.includes(compact(extensionTerm))) result += 100
                  if (mimeSubtype && compacted.includes(compact(mimeSubtype))) result += 75
                  for (const term of terms) {
                    if (normalized.includes(term)) result += 10
                  }
                  return result
                }
                const strongest = <T extends { value: string; name: string }>(items: T[]) => {
                  const ranked = items
                    .map((item) => ({ item, score: score(item.value) }))
                    .filter((entry) => entry.score > 0)
                    .toSorted(
                      (a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name),
                    )
                  const best = ranked[0]?.score ?? 0
                  // When an exact extension/subtype match exists, omit weak
                  // one-token coincidences rather than calling them compatible.
                  const floor = best >= 50 ? best * 0.5 : 1
                  return ranked
                    .filter((entry) => entry.score >= floor)
                    .slice(0, 5)
                    .map((entry) => entry.item)
                }
                const currentSession = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
                const skillCatalog = (yield* sys.skills(ag, currentSession.skillAllowlist)) ?? ""
                const skillCandidates = strongest(
                  Array.from(
                    skillCatalog.matchAll(
                      /<skill>\s*<name>([^<]+)<\/name>\s*<description>([^<]*)<\/description>[\s\S]*?<\/skill>/g,
                    ),
                    (match) => ({
                      name: match[1],
                      description: match[2],
                      value: `${match[1]} ${match[2]}`,
                    }),
                  ),
                )

                const mcpTools = yield* mcp.tools(currentSession.mcpAllowlist)
                const keyToServer = yield* mcp.toolClientNames()
                const allowedMcp = filterMcpToolsByAllowlist(
                  Object.keys(mcpTools),
                  keyToServer,
                  currentSession.mcpAllowlist,
                )
                const mcpCandidates = strongest(
                  allowedMcp.map((name) => ({
                    name,
                    value: `${name} ${mcpTools[name]?.description ?? ""}`,
                  })),
                )
                const surfacedSkills = skillCandidates.length
                  ? `Compatible skills already available: ${skillCandidates
                      .map((item) => `\`${item.name}\` — ${item.description || "no description"}`)
                      .join("; ")}. Use the skill tool to load the best match.`
                  : "No installed skill name or description exactly matches this format."
                const surfacedMcp = mcpCandidates.length
                  ? `Compatible MCP tools already available: ${mcpCandidates.map((item) => `\`${item.name}\``).join(", ")}.`
                  : "No allowlisted MCP tool name or description exactly matches this format."

                pieces.push({
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: [
                    "Attachment reader discovery required.",
                    `The local file ${filepath} has MIME type ${mime} and extension ${extension}, which the built-in Read tool cannot parse.`,
                    "Do not ignore or reject this attachment, and do not guess at its binary contents.",
                    `Before answering, inspect the session's available skills for a format-specific reader.${officeHint}`,
                    "Also inspect the available MCP tools and servers for a compatible reader.",
                    surfacedSkills,
                    surfacedMcp,
                    "If no compatible reader is available, use web search to search online for a trusted skill, MCP server, or tool that supports this exact format; surface the best option and any installation or permission requirement rather than silently failing.",
                    `Keep the original local path (${filepath}) so the selected reader can consume it.`,
                  ].join("\n"),
                })
                return pieces
              }

              yield* bus.publish(Session.Event.Error, {
                sessionID: input.sessionID,
                error: new NamedError.Unknown({ message }).toObject(),
              })
              return pieces
            }
          }
        }

        if (part.type === "agent") {
          const perm = Permission.evaluate("task", part.name, ag.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            { ...part, messageID: info.id, sessionID: input.sessionID },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
      })

      const resolvedParts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
        Effect.map((x) => x.flat().map(assign)),
      )

      yield* plugin.trigger(
        "chat.message",
        {
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          messageID: input.messageID,
          variant: input.variant,
        },
        { message: info, parts: resolvedParts },
      )

      const parts = resolvedParts

      const parsed = decodeMessageInfo(info, { errors: "all", propertyOrder: "original" })
      if (Exit.isFailure(parsed)) {
        log.error("invalid user message before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          agent: info.agent,
          model: info.model,
          cause: Cause.pretty(parsed.cause),
        })
      }
      parts.forEach((part, index) => {
        const p = decodeMessagePart(part, { errors: "all", propertyOrder: "original" })
        if (Exit.isSuccess(p)) return
        log.error("invalid user part before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          partID: part.id,
          partType: part.type,
          index,
          cause: Cause.pretty(p.cause),
          part,
        })
      })

      yield* sessions.updateMessage(info)
      for (const part of parts) yield* sessions.updatePart(part)
      const nextPrompt = parts.reduce(
        (result, part) => {
          if (part.type === "text") {
            if (part.synthetic) result.synthetic.push(part.text)
            else result.text.push(part.text)
            const reference = referencePromptMetadata(part.metadata?.reference)
            if (reference) {
              result.references.push(
                new ReferenceAttachment({
                  name: reference.name,
                  kind: reference.kind,
                  uri: reference.path ? pathToFileURL(reference.path).href : undefined,
                  repository: reference.repository,
                  branch: reference.branch,
                  target: reference.target,
                  targetUri: reference.targetPath ? pathToFileURL(reference.targetPath).href : undefined,
                  problem: reference.problem,
                  source: new Source({
                    start: reference.source.start,
                    end: reference.source.end,
                    text: reference.source.value,
                  }),
                }),
              )
            }
          }
          if (part.type === "file") {
            result.files.push(
              new FileAttachment({
                uri: part.url,
                mime: part.mime,
                name: part.filename,
                source: part.source
                  ? new Source({
                      start: part.source.text.start,
                      end: part.source.text.end,
                      text: part.source.text.value,
                    })
                  : undefined,
              }),
            )
          }
          if (part.type === "agent") {
            result.agents.push(
              new AgentAttachment({
                name: part.name,
                source: part.source
                  ? new Source({
                      start: part.source.start,
                      end: part.source.end,
                      text: part.source.value,
                    })
                  : undefined,
              }),
            )
          }
          return result
        },
        {
          text: [] as string[],
          files: [] as FileAttachment[],
          agents: [] as AgentAttachment[],
          references: [] as ReferenceAttachment[],
          synthetic: [] as string[],
        },
      )
      // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
      if (flags.experimentalEventSystem) {
        yield* sync.run(SessionEvent.Prompted.Sync, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(info.time.created),
          prompt: {
            text: nextPrompt.text.join("\n"),
            files: nextPrompt.files,
            agents: nextPrompt.agents,
            references: nextPrompt.references,
          },
        })
      }
      for (const text of nextPrompt.synthetic) {
        // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
        if (flags.experimentalEventSystem) {
          yield* sync.run(SessionEvent.Synthetic.Sync, {
            sessionID: input.sessionID,
            timestamp: DateTime.makeUnsafe(info.time.created),
            text,
          })
        }
      }

      return { info, parts }
    }, Effect.scoped)

    const prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.prompt")(
      function* (input: PromptInput) {
        const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
        yield* revert.cleanup(session)
        const message = yield* createUserMessage(input)
        yield* sessions.touch(input.sessionID)

        const permissions: Permission.Ruleset = []
        for (const [t, enabled] of Object.entries(input.tools ?? {})) {
          permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
        }
        if (permissions.length > 0) {
          session.permission = permissions
          yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
        }

        if (input.noReply === true) return message
        return yield* promptLock(input.sessionID).withPermits(1)(
          state.ensureRunning(
            input.sessionID,
            lastAssistant(input.sessionID),
            runLoop(input.sessionID, message.info.id),
          ),
        )
      },
    )

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user").pipe(Effect.orDie)
      if (Option.isSome(match)) return match.value
      const msgs = yield* sessions.messages({ sessionID, limit: 1 }).pipe(Effect.orDie)
      if (msgs.length > 0) return msgs[0]
      throw new Error("Impossible")
    })

    const runLoop: (
      sessionID: SessionID,
      throughUserMessageID?: MessageID,
    ) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.run")(
      function* (sessionID: SessionID, throughUserMessageID?: MessageID) {
        const ctx = yield* InstanceState.context
        const slog = elog.with({ sessionID })
        let structured: unknown
        let step = 0
        const internalUserMessageIDs = new Set<MessageID>()
        const autoCompactedAssistantIDs = new Set<MessageID>()
        const session = yield* sessions.get(sessionID).pipe(Effect.orDie)

        while (true) {
          yield* status.set(sessionID, { type: "busy" })
          yield* slog.info("loop", { step })

          let msgs = yield* MessageV2.filterCompactedEffect(sessionID)
          if (throughUserMessageID) {
            // Later queued user messages are already persisted, but they
            // belong to later provider turns. Only controls created while
            // handling this pinned turn are admitted alongside it.
            msgs = msgs.filter(
              (message) =>
                message.info.role !== "user" ||
                message.info.id <= throughUserMessageID ||
                internalUserMessageIDs.has(message.info.id),
            )
          }

          let lastUser: MessageV2.User | undefined
          let lastAssistant: MessageV2.Assistant | undefined
          let lastFinished: MessageV2.Assistant | undefined
          let tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] = []
          for (let i = msgs.length - 1; i >= 0; i--) {
            const msg = msgs[i]
            if (!lastUser && msg.info.role === "user") lastUser = msg.info
            if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info
            if (!lastFinished && msg.info.role === "assistant" && msg.info.finish) lastFinished = msg.info
            if (lastUser && lastFinished) break
            const task = msg.parts.filter((part) => part.type === "compaction" || part.type === "subtask")
            if (task && !lastFinished) tasks.push(...task)
          }

          if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

          const lastAssistantMsg = msgs.findLast(
            (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
          )
          // Some providers return "stop" even when the assistant message contains tool calls.
          // Keep the loop running so tool results can be sent back to the model.
          // Skip provider-executed tool parts — those were fully handled within the
          // provider's stream (e.g. DWS Agent Platform) and don't need a re-loop.
          const hasToolCalls =
            lastAssistantMsg?.parts.some((part) => part.type === "tool" && !part.metadata?.providerExecuted) ?? false

          if (
            lastAssistant?.finish &&
            !["tool-calls"].includes(lastAssistant.finish) &&
            !hasToolCalls &&
            (throughUserMessageID
              ? lastAssistant.parentID === lastUser.id
              : lastUser.id < lastAssistant.id)
          ) {
            yield* slog.info("exiting loop")
            break
          }

          step++
          if (step === 1)
            yield* title({
              session,
              modelID: lastUser.model.modelID,
              providerID: lastUser.model.providerID,
              history: msgs,
            }).pipe(Effect.ignore, Effect.forkIn(scope))

          const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
          const task = tasks.pop()

          if (task?.type === "subtask") {
            yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
            continue
          }

          if (task?.type === "compaction") {
            const result = yield* compaction.process({
              messages: msgs,
              parentID: lastUser.id,
              sessionID,
              auto: task.auto,
              overflow: task.overflow,
            })
            if (result.followup) internalUserMessageIDs.add(result.followup)
            if (result.status === "stop") break
            continue
          }

          if (
            lastFinished &&
            lastFinished.summary !== true &&
            (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }))
          ) {
            if (autoCompactedAssistantIDs.has(lastFinished.id)) {
              yield* slog.warn("auto compaction made no progress", { messageID: lastFinished.id })
              break
            }
            autoCompactedAssistantIDs.add(lastFinished.id)
            const control = yield* compaction.create({
              sessionID,
              agent: lastUser.agent,
              model: lastUser.model,
              auto: true,
            })
            internalUserMessageIDs.add(control.id)
            continue
          }

          const agent = yield* agents.get(lastUser.agent)
          if (!agent) {
            const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
            yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
            throw error
          }
          const maxSteps = agent.steps ?? Infinity
          const isLastStep = step >= maxSteps
          msgs = yield* insertReminders({ messages: msgs, agent, session })

          const msg: MessageV2.Assistant = {
            id: MessageID.ascending(),
            parentID: lastUser.id,
            role: "assistant",
            mode: agent.name,
            agent: agent.name,
            variant: lastUser.model.variant,
            path: { cwd: ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
            sessionID,
          }
          yield* sessions.updateMessage(msg)
          const handle = yield* processor.create({
            assistantMessage: msg,
            sessionID,
            model,
          })

          const outcome: "break" | "continue" = yield* state.withActiveProcessor(
            sessionID,
            {
              assistantID: handle.message.id,
              userMessageID: handle.message.parentID,
              agentName: handle.message.agent,
              toolCallIdentity: (callID) =>
                Effect.gen(function* () {
                  if (handle.message.sessionID !== sessionID) return
                  const identity = yield* handle.toolCallIdentity(callID)
                  if (!identity || identity.sessionID !== sessionID || identity.messageID !== handle.message.id) return
                  return identity
                }),
            },
            Effect.gen(function* () {
            const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
            const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

            const tools = yield* resolveTools({
              agent,
              session,
              model,
              tools: lastUser.tools,
              processor: handle,
              bypassAgentCheck,
              messages: msgs,
            })

            if (lastUser.format?.type === "json_schema") {
              tools["StructuredOutput"] = createStructuredOutputTool({
                schema: lastUser.format.schema,
                onSuccess(output) {
                  structured = output
                },
              })
            }

            if (step === 1)
              yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))

            if (step > 1 && lastFinished) {
              for (const m of msgs) {
                if (m.info.role !== "user" || m.info.id <= lastFinished.id) continue
                for (const p of m.parts) {
                  if (p.type !== "text" || p.ignored || p.synthetic) continue
                  if (!p.text.trim()) continue
                  p.text = [
                    "<system-reminder>",
                    "The user sent the following message:",
                    p.text,
                    "",
                    "Please address this message and continue with your tasks.",
                    "</system-reminder>",
                  ].join("\n")
                }
              }
            }

            yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

            const [skills, env, instructions, modelMsgs] = yield* Effect.all([
              sys.skills(agent, session.skillAllowlist),
              sys.environment(model),
              instruction.system().pipe(Effect.orDie),
              MessageV2.toModelMessagesEffect(msgs, model),
            ])
            const system = [...env, ...instructions, ...(skills ? [skills] : [])]
            const format = lastUser.format ?? { type: "text" as const }
            if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
            const result = yield* handle.process({
              user: lastUser,
              agent,
              permission: session.permission,
              sessionID,
              parentSessionID: session.parentID,
              system,
              messages: [...modelMsgs, ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
              tools,
              model,
              toolChoice: format.type === "json_schema" ? "required" : undefined,
              // Real stored identities of the converted messages (Dayflow provider guard), and the
              // real processor assistant this call's output is stored into.
              outputAssistantId: handle.message.id,
              origins: () =>
                buildProviderOrigins({
                  purpose: "answer",
                  userMessageId: lastUser.id,
                  messages: msgs,
                  convertedCount: async (m) =>
                    (await MessageV2.toModelMessages([m as MessageV2.WithParts], model)).length,
                  trailingStatic: isLastStep ? 1 : 0,
                }),
            })

            // Dayflow provider guard: the step completed canonically (processor cleanup ran), so finish the
            // provisional clean-group certificate ONCE from the exact stored group, or drop it when the group
            // is not a terminal clean success. Edits after this point can only fail the later comparison.
            yield* MessageV2.get({ sessionID, messageID: handle.message.id }).pipe(
              Effect.map((group) => sealCleanGroup(sessionID, handle.message.id, group)),
              Effect.catchCause(() => Effect.sync(() => sealCleanGroup(sessionID, handle.message.id, undefined))),
            )

            if (structured !== undefined) {
              handle.message.structured = structured
              handle.message.finish = handle.message.finish ?? "stop"
              yield* sessions.updateMessage(handle.message)
              return "break" as const
            }

            const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
            if (finished && !handle.message.error) {
              if (format.type === "json_schema") {
                handle.message.error = new MessageV2.StructuredOutputError({
                  message: "Model did not produce structured output",
                  retries: 0,
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                return "break" as const
              }
            }

            if (result === "stop") return "break" as const
            if (result === "compact") {
              const control = yield* compaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
                overflow: !handle.message.finish,
              })
              internalUserMessageIDs.add(control.id)
            }
            return "continue" as const
            }).pipe(Effect.ensuring(instruction.clear(handle.message.id))),
          )
          if (outcome === "break") break
          continue
        }

        yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
        return yield* lastAssistant(sessionID)
      },
    )

    const loop: (input: LoopInput) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.loop")(function* (
      input: LoopInput,
    ) {
      return yield* state.ensureRunning(input.sessionID, lastAssistant(input.sessionID), runLoop(input.sessionID))
    })

    const shell: (input: ShellInput) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.shell")(
      function* (input: ShellInput) {
        const ready = yield* Latch.make()
        return yield* state.startShell(input.sessionID, lastAssistant(input.sessionID), shellImpl(input, ready), ready)
      },
    )

    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
      yield* elog.info("command", { sessionID: input.sessionID, command: input.command, agent: input.agent })
      const cmd = yield* commands.get(input.command)
      if (!cmd) {
        const available = (yield* commands.list()).map((c) => c.name)
        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const agentName = cmd.agent ?? input.agent

      const raw = input.arguments.match(argsRegex) ?? []
      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
      const templateCommand = yield* Effect.promise(async () => cmd.template)

      const placeholders = templateCommand.match(placeholderRegex) ?? []
      let last = 0
      for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
      }

      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
      })
      const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
      let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

      if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
        template = template + "\n\n" + input.arguments
      }

      const shellMatches = ConfigMarkdown.shell(template)
      if (shellMatches.length > 0) {
        const cfg = yield* config.get()
        const sh = Shell.preferred(cfg.shell)
        const results = yield* Effect.promise(() =>
          Promise.all(
            shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
          ),
        )
        let index = 0
        template = template.replace(bashRegex, () => results[index++])
      }
      template = template.trim()

      const taskModel = yield* Effect.gen(function* () {
        if (cmd.model) return Provider.parseModel(cmd.model)
        if (cmd.agent) {
          const cmdAgent = yield* agents.get(cmd.agent)
          if (cmdAgent?.model) return cmdAgent.model
        }
        if (input.model) return Provider.parseModel(input.model)
        return yield* currentModel(input.sessionID)
      })

      yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID)

      const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!agent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const templateParts = yield* resolvePromptParts(template)
      const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
      const parts = isSubtask
        ? [
            {
              type: "subtask" as const,
              agent: agent.name,
              description: cmd.description ?? "",
              command: input.command,
              model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
            },
          ]
        : [...templateParts, ...(input.parts ?? [])]

      const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultInfo()).name) : agent.name
      const userModel = isSubtask
        ? input.model
          ? Provider.parseModel(input.model)
          : yield* currentModel(input.sessionID)
        : taskModel

      yield* plugin.trigger(
        "command.execute.before",
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        { parts },
      )

      const result = yield* prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: userModel,
        agent: userAgent,
        parts,
        variant: input.variant,
      })
      yield* bus.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
      })
      return result
    })

    return Service.of({
      cancel,
      prompt,
      loop,
      shell,
      command,
      resolvePromptParts,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(SessionRunState.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(SessionCompaction.defaultLayer),
    Layer.provide(SessionProcessor.defaultLayer),
    Layer.provide(Command.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provide(LSP.defaultLayer),
    Layer.provide(ToolRegistry.defaultLayer),
    Layer.provide(Truncate.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(
      Layer.mergeAll(
        Agent.defaultLayer,
        SystemPrompt.defaultLayer,
        LLM.defaultLayer,
        Reference.defaultLayer,
        Bus.layer,
        CrossSpawnSpawner.defaultLayer,
        SyncEvent.defaultLayer,
        RuntimeFlags.defaultLayer,
      ),
    ),
  ),
)
const ModelRef = Schema.Struct({
  providerID: ProviderID,
  modelID: ModelID,
})

export const PromptInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  model: Schema.optional(ModelRef),
  agent: Schema.optional(Schema.String),
  noReply: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description:
      "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
  }),
  format: Schema.optional(MessageV2.Format),
  system: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  parts: Schema.Array(
    Schema.Union([
      MessageV2.TextPartInput,
      MessageV2.FilePartInput,
      MessageV2.AgentPartInput,
      MessageV2.SubtaskPartInput,
    ]).annotate({ discriminator: "type" }),
  ),
})
export type PromptInput = Schema.Schema.Type<typeof PromptInput>

export class LoopInput extends Schema.Class<LoopInput>("SessionPrompt.LoopInput")({
  sessionID: SessionID,
}) {}

export const ShellInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  agent: Schema.String,
  model: Schema.optional(ModelRef),
  command: Schema.String,
})
export type ShellInput = Schema.Schema.Type<typeof ShellInput>

export const CommandInput = Schema.Struct({
  messageID: Schema.optional(MessageID),
  sessionID: SessionID,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  arguments: Schema.String,
  command: Schema.String,
  variant: Schema.optional(Schema.String),
  // Inlined (no identifier annotation) to keep the original SDK output — the
  // PromptInput call site below references FilePartInput by ref via the
  // Schema export in message-v2.ts.
  parts: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          id: Schema.optional(PartID),
          type: Schema.Literal("file"),
          mime: Schema.String,
          filename: Schema.optional(Schema.String),
          url: Schema.String,
          source: Schema.optional(MessageV2.FilePartSource),
        }),
      ]).annotate({ discriminator: "type" }),
    ),
  ),
})
export type CommandInput = Schema.Schema.Type<typeof CommandInput>

/** @internal Exported for testing */
export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  // Remove $schema property if present (not needed for tool input)
  const { $schema: _, ...toolSchema } = input.schema

  return tool({
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as JSONSchema7),
    async execute(args) {
      // AI SDK validates args against inputSchema before calling execute()
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput({ output }) {
      return {
        type: "text",
        value: output.output,
      }
    },
  })
}
const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export * as SessionPrompt from "./prompt"
