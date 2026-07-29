import { EventEmitter } from "events"
import { Identifier } from "@/id/id"

export type GlobalEvent = {
  directory?: string
  project?: string
  workspace?: string
  payload: any
}

class GlobalBusEmitter extends EventEmitter<{
  event: [GlobalEvent]
}> {
  // This emitter only ever carries the "event" channel; the wide
  // string|symbol signature is what the base emit overloads require under
  // tsgo, with the payload hook applied only to the "event" channel.
  override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (eventName === "event") {
      const event = args[0] as GlobalEvent
      if (event.payload && typeof event.payload === "object" && !("id" in event.payload)) {
        event.payload.id = event.payload.syncEvent?.id ?? Identifier.create("evt", "ascending")
      }
    }
    return super.emit(eventName as "event", ...(args as [GlobalEvent]))
  }
}

export const GlobalBus = new GlobalBusEmitter()
