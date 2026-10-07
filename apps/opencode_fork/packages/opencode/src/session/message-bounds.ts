/**
 * Byte bounds for paginated transcript pages.
 *
 * `limit` bounds how many MESSAGES a page carries, never how many bytes. A
 * single tool part can hold megabytes of output — measured 2026-10-06, one
 * part in a real session was 18 MB, and a 20-message page of that session
 * serialized to 15.7 MB against a mobile gateway that rejects anything over
 * 8 MB. That page could never be delivered, so the client never seeded its
 * transcript, so live deltas had no parent message to attach to and the chat
 * silently froze. Building the undeliverable page also pinned the engine's
 * main thread and allocated gigabytes.
 *
 * These bounds trim oversized part bodies in LIST responses only. Part
 * identity (`id`, `messageID`, `sessionID`, `type`) is always preserved so
 * delta application still attaches parts to their parent message, and every
 * trimmed body is recorded in the part's existing open `metadata` record so a
 * client can render it honestly and fetch the full body from the
 * single-message route on demand. No schema change, so no SDK regeneration.
 */

/** Largest body kept inline for one field of one part. */
export const PART_BODY_LIMIT_BYTES = 32 * 1024

/**
 * Whole-page budget, deliberately well under the mobile gateway's 8 MB cap so
 * a page still fits after transport framing.
 */
export const PAGE_BUDGET_BYTES = 4 * 1024 * 1024

/** Body kept for parts trimmed once the page budget is already spent. */
export const EXHAUSTED_BODY_LIMIT_BYTES = 1024

export interface TruncatedBodyMark {
  readonly field: string
  readonly originalLength: number
  readonly keptLength: number
}

const utf8Length = (value: string) => Buffer.byteLength(value, "utf8")

/**
 * Cut on a UTF-8 boundary. Slicing by code units can split a surrogate pair,
 * which would emit half a character.
 */
function clampText(value: string, limit: number): string {
  if (utf8Length(value) <= limit) return value
  const text = Buffer.from(value, "utf8").subarray(0, limit).toString("utf8")
  return text.endsWith("�") ? text.slice(0, -1) : text
}

type AnyPart = Record<string, any>

function addMark(part: AnyPart, mark: TruncatedBodyMark): void {
  const existing = Array.isArray(part.metadata?.truncated) ? part.metadata.truncated : []
  part.metadata = { ...(part.metadata ?? {}), truncated: [...existing, mark] }
}

/**
 * The string fields on a part that can realistically hold megabytes.
 *
 * Measured 2026-10-06 on a real 20-message page: `state.attachments[].url`
 * was 15,575,354 of 15,714,325 bytes (99.1%) — inline base64 data URIs around
 * 508 KB each. `state.output` was 10 KB across the whole page. Bounding the
 * text fields alone changed nothing, so attachment URLs are the payload that
 * actually matters here.
 */
function bodyFields(part: AnyPart): Array<{ owner: AnyPart; field: string }> {
  if (part.type === "text" || part.type === "reasoning") return [{ owner: part, field: "text" }]
  if (part.type === "tool" && part.state && typeof part.state === "object") {
    const state = part.state as AnyPart
    const fields = [
      { owner: state, field: "output" },
      { owner: state, field: "error" },
    ]
    if (Array.isArray(state.attachments)) {
      for (const attachment of state.attachments) {
        if (attachment && typeof attachment === "object") {
          fields.push({ owner: attachment as AnyPart, field: "url" })
        }
      }
    }
    return fields
  }
  return []
}

/** Bytes this part currently contributes through its body fields. */
function bodyBytes(part: AnyPart): number {
  let total = 0
  for (const { owner, field } of bodyFields(part)) {
    const value = owner[field]
    if (typeof value === "string") total += utf8Length(value)
  }
  return total
}

/**
 * An inline attachment URL is a base64 data URI: truncating it yields a
 * corrupt image rather than a smaller one, so an oversized URL is dropped
 * outright and marked. The client re-fetches that part from the
 * single-message route when the user actually opens the attachment.
 */
function boundAttachments(state: AnyPart, limit: number, marks: TruncatedBodyMark[]): unknown[] | undefined {
  if (!Array.isArray(state.attachments)) return undefined
  let changed = false
  const next = state.attachments.map((candidate: unknown) => {
    if (!candidate || typeof candidate !== "object") return candidate
    const attachment = candidate as AnyPart
    const url = attachment.url
    if (typeof url !== "string" || utf8Length(url) <= limit) return candidate
    changed = true
    marks.push({ field: `attachments.${attachment.id ?? "?"}.url`, originalLength: utf8Length(url), keptLength: 0 })
    return { ...attachment, url: "" }
  })
  return changed ? next : undefined
}

/**
 * Return a trimmed clone of `part`, or the original reference when nothing
 * exceeded `limit`. Clones only the levels it modifies.
 */
function boundPart(part: AnyPart, limit: number): AnyPart {
  const marks: TruncatedBodyMark[] = []
  const next: AnyPart = { ...part }
  let changed = false

  if (part.type === "text" || part.type === "reasoning") {
    const text = part.text
    if (typeof text === "string" && utf8Length(text) > limit) {
      const kept = clampText(text, limit)
      next.text = kept
      marks.push({ field: "text", originalLength: utf8Length(text), keptLength: utf8Length(kept) })
      changed = true
    }
  }

  if (part.type === "tool" && part.state && typeof part.state === "object") {
    const state = part.state as AnyPart
    const nextState: AnyPart = { ...state }
    let stateChanged = false
    for (const field of ["output", "error"]) {
      const value = state[field]
      if (typeof value === "string" && utf8Length(value) > limit) {
        const kept = clampText(value, limit)
        nextState[field] = kept
        marks.push({ field, originalLength: utf8Length(value), keptLength: utf8Length(kept) })
        stateChanged = true
      }
    }
    const attachments = boundAttachments(state, limit, marks)
    if (attachments) {
      nextState.attachments = attachments
      stateChanged = true
    }
    if (stateChanged) {
      next.state = nextState
      changed = true
    }
  }

  if (!changed) return part
  for (const mark of marks) addMark(next, mark)
  return next
}

export interface MessageWithParts {
  info: unknown
  parts: unknown[]
}

/**
 * Bound a transcript page by bytes. Messages and parts are never dropped —
 * only oversized bodies are trimmed — so ordering, counts and part identity
 * are unchanged and delta application still works.
 */
export function boundPageBytes<T extends MessageWithParts>(items: readonly T[]): T[] {
  let spent = 0
  const replaced = new Array<unknown[] | undefined>(items.length)

  // Newest messages are what a client renders first, so spend the budget from
  // the tail backwards and trim hardest at the far end of the history.
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const parts = items[index]?.parts
    if (!Array.isArray(parts)) continue
    let changed = false
    const next = parts.map((candidate) => {
      if (!candidate || typeof candidate !== "object") return candidate
      const limit = spent >= PAGE_BUDGET_BYTES ? EXHAUSTED_BODY_LIMIT_BYTES : PART_BODY_LIMIT_BYTES
      const bounded = boundPart(candidate as AnyPart, limit)
      if (bounded !== candidate) changed = true
      spent += bodyBytes(bounded)
      return bounded
    })
    if (changed) replaced[index] = next
  }

  if (replaced.every((entry) => entry === undefined)) return items as T[]
  return items.map((message, index) =>
    replaced[index] ? ({ ...message, parts: replaced[index] } as T) : message,
  )
}
