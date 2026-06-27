import { Effect, Exit, Layer, PubSub, Scope, Context, Stream, Schema } from "effect"
import { EffectBridge } from "@/effect/bridge"
import * as Log from "@opencode-ai/core/util/log"
import { BusEvent } from "./bus-event"
import { GlobalBus } from "./global"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "bus" })

type BusProperties<D extends BusEvent.Definition<string, Schema.Top>> = Schema.Schema.Type<D["properties"]>

export const InstanceDisposed = BusEvent.define(
  "server.instance.disposed",
  Schema.Struct({
    directory: Schema.String,
  }),
)

export type Payload<D extends BusEvent.Definition = BusEvent.Definition> = {
  id: string
  type: D["type"]
  properties: BusProperties<D>
}

type State = {
  wildcard: PubSub.PubSub<Payload>
  typed: Map<string, PubSub.PubSub<Payload>>
}

// #764: the namespace `Bus` runs over a module-level `makeRuntime(Service, layer)`
// (bus B) while `/event` subscribes through the per-request DI `Bus.Service`
// (bus A). Each `Bus.layer` build owns its own `InstanceState` ScopedCache, so
// the two runtimes held SEPARATE `{wildcard, typed}` PubSubs for the same
// directory — SyncEvent publishes (`sync/index.ts` → namespace `Bus.publish`)
// landed on bus B and never reached the live `/event` subscriber on bus A
// (duplicate messages + empty token/context gauge in Rhythm). This module-level
// registry collapses every build to ONE State per directory: whichever runtime
// builds the state first creates and owns it (and the disposal finalizer);
// every later build — in either runtime — resolves the same object. Keyed by
// directory string so it is independent of how many runtimes/caches exist.
const shared = new Map<string, State>()

export interface Interface {
  readonly publish: <D extends BusEvent.Definition>(
    def: D,
    properties: BusProperties<D>,
    options?: { id?: string },
  ) => Effect.Effect<void>
  readonly subscribe: <D extends BusEvent.Definition>(def: D) => Stream.Stream<Payload<D>>
  readonly subscribeAll: () => Stream.Stream<Payload>
  readonly subscribeAllStream: () => Effect.Effect<Stream.Stream<Payload>>
  readonly subscribeCallback: <D extends BusEvent.Definition>(
    def: D,
    callback: (event: Payload<D>) => unknown,
  ) => Effect.Effect<() => void>
  readonly subscribeAllCallback: (callback: (event: any) => unknown) => Effect.Effect<() => void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Bus") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(
      Effect.fn("Bus.state")(function* (ctx) {
        // Fast path: another runtime already built the State for this directory.
        const existing = shared.get(ctx.directory)
        if (existing) return existing

        const wildcard = yield* PubSub.unbounded<Payload>()
        const typed = new Map<string, PubSub.PubSub<Payload>>()

        // The `PubSub.unbounded` above is a fiber yield point, so two caches
        // (namespace + DI) can each pass the fast-path check for a fresh
        // directory before either registers. Re-check after allocation: the
        // loser discards its throwaway wildcard and adopts the winner's State,
        // so both runtimes still converge on one PubSub.
        const raced = shared.get(ctx.directory)
        if (raced) {
          yield* PubSub.shutdown(wildcard)
          return raced
        }

        const created: State = { wildcard, typed }
        shared.set(ctx.directory, created)

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            // Only the owning builder clears the shared entry, so a late reader
            // cannot resurrect a shut-down PubSub for this directory.
            if (shared.get(ctx.directory) === created) shared.delete(ctx.directory)
            // Publish InstanceDisposed before shutting down so subscribers see it
            yield* PubSub.publish(wildcard, {
              type: InstanceDisposed.type,
              id: createID(),
              properties: { directory: ctx.directory },
            })
            yield* PubSub.shutdown(wildcard)
            for (const ps of typed.values()) {
              yield* PubSub.shutdown(ps)
            }
          }),
        )

        return created
      }),
    )

    function getOrCreate<D extends BusEvent.Definition>(state: State, def: D) {
      return Effect.gen(function* () {
        let ps = state.typed.get(def.type)
        if (!ps) {
          ps = yield* PubSub.unbounded<Payload>()
          state.typed.set(def.type, ps)
        }
        return ps as unknown as PubSub.PubSub<Payload<D>>
      })
    }

    function publish<D extends BusEvent.Definition>(def: D, properties: BusProperties<D>, options?: { id?: string }) {
      return Effect.gen(function* () {
        const s = yield* InstanceState.get(state)
        const payload: Payload = { id: options?.id ?? createID(), type: def.type, properties }
        log.info("publishing", { type: def.type })

        const ps = s.typed.get(def.type)
        if (ps) yield* PubSub.publish(ps, payload)
        yield* PubSub.publish(s.wildcard, payload)

        const dir = yield* InstanceState.directory
        const context = yield* InstanceState.context
        const workspace = yield* InstanceState.workspaceID

        GlobalBus.emit("event", {
          directory: dir,
          project: context.project.id,
          workspace,
          payload,
        })
      })
    }

    function subscribe<D extends BusEvent.Definition>(def: D): Stream.Stream<Payload<D>> {
      log.info("subscribing", { type: def.type })
      return Stream.unwrap(
        Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          const ps = yield* getOrCreate(s, def)
          return Stream.fromPubSub(ps)
        }),
      ).pipe(Stream.ensuring(Effect.sync(() => log.info("unsubscribing", { type: def.type }))))
    }

    function subscribeAll(): Stream.Stream<Payload> {
      log.info("subscribing", { type: "*" })
      return Stream.unwrap(
        Effect.gen(function* () {
          const s = yield* InstanceState.get(state)
          return Stream.fromPubSub(s.wildcard)
        }),
      ).pipe(Stream.ensuring(Effect.sync(() => log.info("unsubscribing", { type: "*" }))))
    }

    // Eagerly resolves the concrete wildcard PubSub while the caller's Instance
    // context (InstanceRef fiber-local) is still bound, then streams from that
    // concrete PubSub. The lazy `subscribeAll()` above defers `InstanceState.get`
    // until the stream is consumed; that works when the consumer fiber inherits
    // the caller's context (e.g. `Effect.forkScoped` in plugin/index.ts), but
    // NOT for an HTTP SSE response body, which is pumped by a server fiber that
    // never inherits the handler's InstanceRef. There the lazy get cannot
    // resolve the instance and the stream collapses immediately after
    // `server.connected`. Resolving the PubSub here mirrors the working
    // `subscribeAllCallback`/`on()` path used by the TUI. (fixes #759)
    const subscribeAllStream = Effect.fn("Bus.subscribeAllStream")(function* () {
      log.info("subscribing", { type: "*" })
      const s = yield* InstanceState.get(state)
      return Stream.fromPubSub(s.wildcard).pipe(
        Stream.ensuring(Effect.sync(() => log.info("unsubscribing", { type: "*" }))),
      )
    })

    function on<T>(pubsub: PubSub.PubSub<T>, type: string, callback: (event: T) => unknown) {
      return Effect.gen(function* () {
        log.info("subscribing", { type })
        const bridge = yield* EffectBridge.make()
        const scope = yield* Scope.make()
        const subscription = yield* Scope.provide(scope)(PubSub.subscribe(pubsub))

        yield* Scope.provide(scope)(
          Stream.fromSubscription(subscription).pipe(
            Stream.runForEach((msg) =>
              Effect.tryPromise({
                try: () => Promise.resolve().then(() => callback(msg)),
                catch: (cause) => {
                  log.error("subscriber failed", { type, cause })
                },
              }).pipe(Effect.ignore),
            ),
            Effect.forkScoped,
          ),
        )

        return () => {
          log.info("unsubscribing", { type })
          bridge.fork(Scope.close(scope, Exit.void))
        }
      })
    }

    const subscribeCallback = Effect.fn("Bus.subscribeCallback")(function* <D extends BusEvent.Definition>(
      def: D,
      callback: (event: Payload<D>) => unknown,
    ) {
      const s = yield* InstanceState.get(state)
      const ps = yield* getOrCreate(s, def)
      return yield* on(ps, def.type, callback)
    })

    const subscribeAllCallback = Effect.fn("Bus.subscribeAllCallback")(function* (callback: (event: any) => unknown) {
      const s = yield* InstanceState.get(state)
      return yield* on(s.wildcard, "*", callback)
    })

    return Service.of({ publish, subscribe, subscribeAll, subscribeAllStream, subscribeCallback, subscribeAllCallback })
  }),
)

export const defaultLayer = layer

const { runPromise, runSync } = makeRuntime(Service, layer)

// runSync is safe here because the subscribe chain (InstanceState.get, PubSub.subscribe,
// Scope.make, Effect.forkScoped) is entirely synchronous. If any step becomes async, this will throw.
export function createID() {
  return Identifier.create("evt", "ascending")
}

export async function publish<D extends BusEvent.Definition>(
  def: D,
  properties: BusProperties<D>,
  options?: { id?: string },
) {
  return runPromise((svc) => svc.publish(def, properties, options))
}

export function subscribe<D extends BusEvent.Definition>(def: D, callback: (event: Payload<D>) => unknown) {
  return runSync((svc) => svc.subscribeCallback(def, callback))
}

export function subscribeAll(callback: (event: any) => unknown) {
  return runSync((svc) => svc.subscribeAllCallback(callback))
}

export * as Bus from "."
