import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { Cause, Deferred, Effect } from "effect"

export function waitGlobalBusEvent(input: {
  timeout?: number
  message?: string
  predicate: (event: GlobalEvent) => boolean
  subscribed?: Deferred.Deferred<void>
}) {
  return Effect.callback<GlobalEvent, unknown>((resume) => {
    const cleanup = () => GlobalBus.off("event", handler)

    const handler = (event: GlobalEvent) => {
      try {
        if (!input.predicate(event)) return
        cleanup()
        resume(Effect.succeed(event))
      } catch (error) {
        cleanup()
        resume(Effect.fail(error))
      }
    }

    GlobalBus.on("event", handler)
    if (input.subscribed) Effect.runSync(Deferred.succeed(input.subscribed, undefined).pipe(Effect.ignore))
    return Effect.sync(cleanup)
  }).pipe(
    Effect.timeout(input.timeout ?? 10_000),
    Effect.mapError((error) =>
      Cause.isTimeoutError(error) ? new Error(input.message ?? "timed out waiting for global bus event") : error,
    ),
  )
}
