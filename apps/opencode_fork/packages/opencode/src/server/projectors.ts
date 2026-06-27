import sessionProjectors from "../session/projectors"
import { SyncEvent } from "@/sync"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionTable, MessageTable, PartTable } from "@/session/session.sql"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"

export function initProjectors() {
  SyncEvent.init({
    projectors: sessionProjectors,
    // `SyncEvent` payloads are Effect `Schema.Class` instances. They reach the
    // in-process bus fine, but they do NOT survive JSON serialization to the
    // `/event` SSE wildcard stream (issue #762) — the HTTP subscriber receives
    // nothing. The fix, mirroring how `session.updated` already works, is to
    // reconstruct a plain, serializable payload from the just-persisted row.
    // The projector runs inside the same transaction and commits BEFORE this
    // post-commit `convertEvent` (see sync/index.ts process()), so the row is
    // always present here.
    convertEvent: (type, data) => {
      if (type === "session.updated") {
        const id = (data as SyncEvent.Event<typeof Session.Event.Updated>["data"]).sessionID
        const row = Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, id)).get())

        if (!row) return data

        return {
          sessionID: id,
          info: Session.fromRow(row),
        }
      }

      if (type === "message.updated") {
        const event = data as SyncEvent.Event<typeof MessageV2.Event.Updated>["data"]
        const row = Database.use((db) =>
          db.select().from(MessageTable).where(eq(MessageTable.id, event.info.id)).get(),
        )

        if (!row) return data

        return {
          sessionID: event.sessionID,
          info: MessageV2.infoFromRow(row),
        }
      }

      if (type === "message.part.updated") {
        const event = data as SyncEvent.Event<typeof MessageV2.Event.PartUpdated>["data"]
        const row = Database.use((db) => db.select().from(PartTable).where(eq(PartTable.id, event.part.id)).get())

        if (!row) return data

        return {
          sessionID: event.sessionID,
          part: MessageV2.partFromRow(row),
          time: event.time,
        }
      }

      return data
    },
  })
}

initProjectors()
