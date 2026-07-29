import { EventEmitter } from "events"
import { Identifier } from "@/id/id"

export type GlobalEvent = {
  directory?: string
  project?: string
  workspace?: string
  payload: any
}

export const GlobalBus = new EventEmitter<{
  event: [GlobalEvent]
}>()

// Every "event" payload gets a stable id before fan-out. An instance-level
// wrapper (not a subclass override) because tsc and tsgo disagree on
// override-assignability against the typed EventEmitter emit overloads.
const superEmit = GlobalBus.emit.bind(GlobalBus)
GlobalBus.emit = ((eventName: "event", ...args: [GlobalEvent]) => {
  if (eventName === "event") {
    const event = args[0]
    if (event.payload && typeof event.payload === "object" && !("id" in event.payload)) {
      event.payload.id = event.payload.syncEvent?.id ?? Identifier.create("evt", "ascending")
    }
  }
  return superEmit(eventName, ...args)
}) as typeof GlobalBus.emit
