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
  // Mirror @types/node's generic EventEmitter signature while retaining the
  // event payload hook. A string | symbol override is too narrow because K is
  // intentionally unconstrained in the base declaration.
  override emit<K>(eventName: "event" | K, ...args: K extends "event" ? [GlobalEvent] : never): boolean {
    if (eventName === "event") {
      const event = args[0]
      if (event.payload && typeof event.payload === "object" && !("id" in event.payload)) {
        event.payload.id = event.payload.syncEvent?.id ?? Identifier.create("evt", "ascending")
      }
    }
    return super.emit(eventName, ...args)
  }
}

export const GlobalBus = new GlobalBusEmitter()
