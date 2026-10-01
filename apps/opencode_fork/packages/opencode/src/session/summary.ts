import { Effect, Layer, Context, Schema, Semaphore, Scope } from "effect"
import { Bus } from "@/bus"
import { Snapshot } from "@/snapshot"
import { Storage } from "@/storage/storage"
import * as Session from "./session"
import { MessageV2 } from "./message-v2"
import { SessionID, MessageID } from "./schema"
import { InstanceState } from "@/effect/instance-state"
import { summarySnapshotRange, summaryTargetMessage } from "./summary-metadata"

type SummaryInput = { sessionID: SessionID; messageID: MessageID }
// Prompt and processor can resolve separate service layers for the same directory.
// Share scheduling so both entry points coalesce instead of retaining one job per step.
const activeSummaries = new Map<string, { pending: SummaryInput | undefined; newest: SummaryInput }>()
const summarySlots = Semaphore.makeUnsafe(2)

function unquoteGitPath(input: string) {
  if (!input.startsWith('"')) return input
  if (!input.endsWith('"')) return input
  const body = input.slice(1, -1)
  const bytes: number[] = []

  for (let i = 0; i < body.length; i++) {
    const char = body[i]!
    if (char !== "\\") {
      bytes.push(char.charCodeAt(0))
      continue
    }

    const next = body[i + 1]
    if (!next) {
      bytes.push("\\".charCodeAt(0))
      continue
    }

    if (next >= "0" && next <= "7") {
      const chunk = body.slice(i + 1, i + 4)
      const match = chunk.match(/^[0-7]{1,3}/)
      if (!match) {
        bytes.push(next.charCodeAt(0))
        i++
        continue
      }
      bytes.push(parseInt(match[0], 8))
      i += match[0].length
      continue
    }

    const escaped =
      next === "n"
        ? "\n"
        : next === "r"
          ? "\r"
          : next === "t"
            ? "\t"
            : next === "b"
              ? "\b"
              : next === "f"
                ? "\f"
                : next === "v"
                  ? "\v"
                  : next === "\\" || next === '"'
                    ? next
                    : undefined

    bytes.push((escaped ?? next).charCodeAt(0))
    i++
  }

  return Buffer.from(bytes).toString()
}

export interface Interface {
  readonly summarize: (input: { sessionID: SessionID; messageID: MessageID }) => Effect.Effect<void>
  readonly diff: (input: { sessionID: SessionID; messageID?: MessageID }) => Effect.Effect<Snapshot.FileDiff[]>
  readonly computeDiff: (input: { messages: MessageV2.WithParts[] }) => Effect.Effect<Snapshot.FileDiff[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSummary") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const snapshot = yield* Snapshot.Service
    const storage = yield* Storage.Service
    const bus = yield* Bus.Service
    const scope = yield* Scope.Scope

    const computeDiff = Effect.fn("SessionSummary.computeDiff")(function* (input: { messages: MessageV2.WithParts[] }) {
      let from: string | undefined
      let to: string | undefined
      for (const item of input.messages) {
        if (!from) {
          for (const part of item.parts) {
            if (part.type === "step-start" && part.snapshot) {
              from = part.snapshot
              break
            }
          }
        }
        for (const part of item.parts) {
          if (part.type === "step-finish" && part.snapshot) to = part.snapshot
        }
      }
      if (from && to) return yield* snapshot.diffFull(from, to)
      return []
    })

    const summarizeOnce = Effect.fn("SessionSummary.summarizeOnce")(function* (input: SummaryInput) {
      const range = summarySnapshotRange(input.sessionID)
      const turn = summarySnapshotRange(input.sessionID, input.messageID)
      const diffs = range.from && range.to ? yield* snapshot.diffFull(range.from, range.to) : []
      yield* sessions.setSummary({
        sessionID: input.sessionID,
        summary: {
          additions: diffs.reduce((sum, x) => sum + x.additions, 0),
          deletions: diffs.reduce((sum, x) => sum + x.deletions, 0),
          files: diffs.length,
        },
      })
      yield* storage.write(["session_diff", input.sessionID], diffs).pipe(Effect.ignore)
      yield* bus.publish(Session.Event.Diff, { sessionID: input.sessionID, diff: diffs })

      const msgDiffs = turn.from && turn.to
        ? turn.from === range.from && turn.to === range.to
          ? diffs
          : yield* snapshot.diffFull(turn.from, turn.to)
        : []
      // Read after the slow diff work, preserving current user metadata and never
      // parsing the previous full patch array back into the JS heap.
      const target = summaryTargetMessage(input.sessionID, input.messageID)
      if (!target) return
      target.summary = { ...target.summary, diffs: msgDiffs }
      yield* sessions.updateMessage(target)
    })

    const summarize: Interface["summarize"] = Effect.fn("SessionSummary.summarize")(function* (input: SummaryInput) {
      const directory = yield* InstanceState.directory
      const key = `${directory}\0${input.sessionID}`
      yield* Effect.uninterruptibleMask((restore) => Effect.suspend(() => {
        const existing = activeSummaries.get(key)
        if (existing) {
          // Message IDs are chronologically sortable. A late event for an older
          // turn must not replace the newest user-summary request.
          if (input.messageID >= existing.newest.messageID) existing.newest = input
          existing.pending = existing.newest
          return Effect.void
        }
        const worker = { pending: input as SummaryInput | undefined, newest: input }
        activeSummaries.set(key, worker)
        return restore(Effect.gen(function* () {
          while (worker.pending) {
            const next = worker.pending
            worker.pending = undefined
            yield* summarySlots.withPermits(1)(summarizeOnce(next))
          }
        })).pipe(Effect.ensuring(Effect.gen(function* () {
          if (activeSummaries.get(key) === worker) activeSummaries.delete(key)
          // A caller can be cancelled while a later caller has already handed
          // off its request. Keep that single pending request in this service's
          // lifetime, rather than losing it with the interrupted owner.
          if (worker.pending) yield* summarize(worker.pending).pipe(Effect.forkIn(scope))
        })))
      }))
    })

    const diff = Effect.fn("SessionSummary.diff")(function* (input: { sessionID: SessionID; messageID?: MessageID }) {
      const diffs = yield* storage
        .read<Snapshot.FileDiff[]>(["session_diff", input.sessionID])
        .pipe(Effect.catch(() => Effect.succeed([] as Snapshot.FileDiff[])))
      const next = diffs.map((item) => {
        if (item.file === undefined) return item
        const file = unquoteGitPath(item.file)
        if (file === item.file) return item
        return { ...item, file }
      })
      const changed = next.some((item, i) => item.file !== diffs[i]?.file)
      if (changed) yield* storage.write(["session_diff", input.sessionID], next).pipe(Effect.ignore)
      return next
    })

    return Service.of({ summarize, diff, computeDiff })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Session.defaultLayer),
    Layer.provide(Snapshot.defaultLayer),
    Layer.provide(Storage.defaultLayer),
    Layer.provide(Bus.layer),
  ),
)

export const DiffInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
})
export type DiffInput = Schema.Schema.Type<typeof DiffInput>

export * as SessionSummary from "./summary"
