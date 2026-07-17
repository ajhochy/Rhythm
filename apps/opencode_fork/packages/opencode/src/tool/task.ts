import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { Effect, Exit, Schema } from "effect"
import { EffectBridge } from "@/effect/bridge"

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"
const CHILD_PROVIDER_RETRY_ATTEMPTS = 1

function isMcpAllowlist(value: unknown): value is NonNullable<Session.Info["mcpAllowlist"]> {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return (
    Array.isArray(candidate.servers) &&
    candidate.servers.every((item): item is string => typeof item === "string") &&
    Array.isArray(candidate.tools) &&
    candidate.tools.every((item): item is string => typeof item === "string") &&
    (candidate.deferred === undefined || typeof candidate.deferred === "boolean")
  )
}

export function isSkillAllowlist(value: unknown): value is NonNullable<Session.Info["skillAllowlist"]> {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return Array.isArray(candidate.skills) && candidate.skills.every((item): item is string => typeof item === "string")
}

export function childSkillAllowlist(agent: Agent.Info, parent: Session.Info): Session.Info["skillAllowlist"] {
  // Mirror childMcpAllowlist (#1012): the projected profile carries its expanded
  // skill scope in options.skillAllowlist (opencode_agent_writer). Read it so the
  // task tool scopes the delegated child instead of injecting all discovered
  // skills (~89k first-turn tokens with 105 skills installed).
  const value = agent.options.skillAllowlist
  if (isSkillAllowlist(value)) return { skills: [...value.skills] }
  // Profile declares no skill scope: inherit the PARENT session's scope rather
  // than falling back to "all skills". undefined only survives if the parent is
  // also unscoped (a genuinely unrestricted root). Never changes ROOT-session
  // behavior — root scope is set per-turn by api_server ws_gateway, and those
  // sessions never pass through this helper.
  return parent.skillAllowlist
}

function childMcpAllowlist(agent: Agent.Info, model: { providerID: string }): Session.Info["mcpAllowlist"] {
  // ConfigAgent preserves custom agent-file frontmatter in `options`. The
  // resolved target profile carries its already-expanded session shape there,
  // so the task tool does not re-implement api-server DB resolution or
  // allowlist expansion.
  const value = agent.options.mcpAllowlist
  if (!isMcpAllowlist(value)) return undefined

  return {
    servers: [...value.servers],
    tools: [...value.tools],
    // A scoped Gemini child must advertise its catalog through the single
    // dispatcher declaration, rather than risk exceeding Gemini's 512-tool cap.
    ...(model.providerID === "google" || value.deferred === true ? { deferred: true } : {}),
  }
}

function childErrorName(error: NonNullable<MessageV2.Assistant["error"]>) {
  return "name" in error ? error.name : "Error"
}

function childErrorMessage(error: NonNullable<MessageV2.Assistant["error"]>) {
  return "data" in error && error.data && typeof error.data === "object" && "message" in error.data
    ? String(error.data.message)
    : ""
}

function isRetryableChildProviderError(error: NonNullable<MessageV2.Assistant["error"]>) {
  return MessageV2.APIError.isInstance(error) && error.data.isRetryable
}

function retryPrompt(original: string, error: NonNullable<MessageV2.Assistant["error"]>) {
  const message = childErrorMessage(error)
  return [
    "The previous attempt for this delegated task hit a retryable provider error.",
    message ? `Provider error: ${message}` : undefined,
    "Continue the original delegated task now. Reuse any progress already visible in this session and return the requested final result.",
    "",
    "<original_task>",
    original,
    "</original_task>",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n")
}

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const taskID = params.task_id
      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const parent = yield* sessions.get(ctx.sessionID)
      const parentAgent = parent.agent
        ? yield* agent.get(parent.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(Effect.orDie)
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          mcpAllowlist: childMcpAllowlist(next, model),
          skillAllowlist: childSkillAllowlist(next, parent),
          permission: [
            ...deriveSubagentSessionPermission({
              parentSessionPermission: parent.permission ?? [],
              parentAgent,
              subagent: next,
            }),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
          ],
        }))

      yield* ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: nextSession.id,
          model,
        },
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))
      const runCancel = yield* EffectBridge.make()

      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            let promptText = params.prompt
            let result: MessageV2.WithParts | undefined

            for (let attempt = 0; attempt <= CHILD_PROVIDER_RETRY_ATTEMPTS; attempt++) {
              const parts = yield* ops.resolvePromptParts(promptText)
              result = yield* ops.prompt({
                messageID: MessageID.ascending(),
                sessionID: nextSession.id,
                model: {
                  modelID: model.modelID,
                  providerID: model.providerID,
                },
                agent: next.name,
                tools: {
                  ...(next.permission.some((rule) => rule.permission === "todowrite") ? {} : { todowrite: false }),
                  ...(next.permission.some((rule) => rule.permission === id) ? {} : { task: false }),
                  ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
                },
                parts,
              })

              const childError = result.info.role === "assistant" ? result.info.error : undefined
              if (!childError) break
              if (attempt < CHILD_PROVIDER_RETRY_ATTEMPTS && isRetryableChildProviderError(childError)) {
                promptText = retryPrompt(params.prompt, childError)
                continue
              }

              const name = childErrorName(childError)
              const message = childErrorMessage(childError)
              const reason = isRetryableChildProviderError(childError) ? "retryable provider error" : "error"
              return yield* Effect.fail(
                new Error(
                  `subagent ${next.name} failed with ${reason} (task_id: ${nextSession.id}): ${name}${message ? `: ${message}` : ""}`,
                ),
              )
            }

            if (!result) {
              return yield* Effect.fail(
                new Error(`subagent ${next.name} failed without producing a result (task_id: ${nextSession.id})`),
              )
            }

            return {
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model,
              },
              output: [
                `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
                "",
                "<task_result>",
                result.parts.findLast((item) => item.type === "text")?.text ?? "",
                "</task_result>",
              ].join("\n"),
            }
          }),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit)) yield* cancel
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                ctx.abort.removeEventListener("abort", onAbort)
              }),
            ),
          ),
      )
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
