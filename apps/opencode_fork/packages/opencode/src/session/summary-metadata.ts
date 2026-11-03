import { Database, and, asc, desc, eq, or, sql } from "@/storage/db"
import { MessageTable, PartTable } from "./session.sql"
import type { MessageID, SessionID } from "./schema"
import type { MessageV2 } from "./message-v2"

/** Project only snapshot boundaries; historical tool/media/patch bytes stay in SQLite. */
export function summarySnapshotRange(sessionID: SessionID, messageID?: MessageID) {
  const belongsToTurn = messageID
    ? or(
        eq(MessageTable.id, messageID),
        and(
          sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`,
          sql`json_extract(${MessageTable.data}, '$.parentID') = ${messageID}`,
        ),
      )
    : undefined
  const boundary = (type: "step-start" | "step-finish", last: boolean) =>
    Database.use((db) => {
      const order = last ? desc : asc
      return db
        .select({ snapshot: sql<string>`json_extract(${PartTable.data}, '$.snapshot')` })
        .from(PartTable)
        .innerJoin(MessageTable, eq(MessageTable.id, PartTable.message_id))
        .where(
          and(
            eq(PartTable.session_id, sessionID),
            eq(MessageTable.session_id, sessionID),
            belongsToTurn,
            sql`json_extract(${PartTable.data}, '$.type') = ${type}`,
            sql`json_type(${PartTable.data}, '$.snapshot') = 'text'`,
            sql`length(json_extract(${PartTable.data}, '$.snapshot')) > 0`,
          ),
        )
        .orderBy(order(MessageTable.time_created), order(MessageTable.id), order(PartTable.id))
        .limit(1)
        .get()?.snapshot
    })
  return { from: boundary("step-start", false), to: boundary("step-finish", true) }
}

/** Keep the selected user's metadata, excluding the old potentially huge diff being replaced. */
export function summaryTargetMessage(sessionID: SessionID, messageID: MessageID): MessageV2.User | undefined {
  const row = Database.use((db) =>
    db
      .select({ data: sql<string>`json_remove(${MessageTable.data}, '$.summary.diffs')` })
      .from(MessageTable)
      .where(
        and(
          eq(MessageTable.session_id, sessionID),
          eq(MessageTable.id, messageID),
          sql`json_extract(${MessageTable.data}, '$.role') = 'user'`,
        ),
      )
      .get(),
  )
  if (!row) return
  return { ...JSON.parse(row.data), id: messageID, sessionID } as MessageV2.User
}
