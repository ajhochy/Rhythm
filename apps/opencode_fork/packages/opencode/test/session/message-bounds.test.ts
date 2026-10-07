import { describe, expect, test } from "bun:test"
import {
  boundPageBytes,
  EXHAUSTED_BODY_LIMIT_BYTES,
  PAGE_BUDGET_BYTES,
  PART_BODY_LIMIT_BYTES,
} from "../../src/session/message-bounds"

const GATEWAY_CAP_BYTES = 8 * 1024 * 1024

const toolPart = (id: string, messageID: string, outputBytes: number) => ({
  id,
  messageID,
  sessionID: "ses_test",
  type: "tool",
  callID: `call_${id}`,
  tool: "read",
  state: {
    status: "completed",
    input: {},
    output: "x".repeat(outputBytes),
    title: "read",
    metadata: {},
  },
})

const textPart = (id: string, messageID: string, textBytes: number) => ({
  id,
  messageID,
  sessionID: "ses_test",
  type: "text",
  text: "y".repeat(textBytes),
})

const message = (id: string, parts: unknown[]) => ({ info: { id, sessionID: "ses_test" }, parts })

const serializedBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8")

describe("boundPageBytes", () => {
  test("an 18MB tool part cannot blow the gateway budget", () => {
    // The measured real-world shape: one part held 18 MB and a 20-message page
    // serialized to 15.7 MB against an 8 MB cap.
    const page = [message("msg_1", [toolPart("prt_1", "msg_1", 18 * 1024 * 1024)])]
    expect(serializedBytes(page)).toBeGreaterThan(GATEWAY_CAP_BYTES)

    const bounded = boundPageBytes(page)
    expect(serializedBytes(bounded)).toBeLessThan(GATEWAY_CAP_BYTES)
  })

  test("a 20-message page of oversized parts stays under the page budget", () => {
    const page = Array.from({ length: 20 }, (_, index) =>
      message(`msg_${index}`, [toolPart(`prt_${index}`, `msg_${index}`, 2 * 1024 * 1024)]),
    )
    const bounded = boundPageBytes(page)
    expect(serializedBytes(bounded)).toBeLessThan(GATEWAY_CAP_BYTES)
    // 20 parts each trimmed to the per-field cap, plus envelope, is far under
    // the whole-page budget.
    expect(serializedBytes(bounded)).toBeLessThan(PAGE_BUDGET_BYTES)
  })

  test("part identity survives so delta application can still attach parts", () => {
    // #1587's delta path finds a part's parent by info.id === part.messageID,
    // then the part by id. Losing either would silently drop every delta.
    const page = [message("msg_1", [toolPart("prt_1", "msg_1", 5 * 1024 * 1024)])]
    const part = boundPageBytes(page)[0].parts[0] as Record<string, unknown>
    expect(part.id).toBe("prt_1")
    expect(part.messageID).toBe("msg_1")
    expect(part.sessionID).toBe("ses_test")
    expect(part.type).toBe("tool")
    expect(boundPageBytes(page)[0].info).toEqual({ id: "msg_1", sessionID: "ses_test" })
  })

  test("a trimmed body is marked with its original length so clients can fetch the rest", () => {
    const original = 5 * 1024 * 1024
    const page = [message("msg_1", [toolPart("prt_1", "msg_1", original)])]
    const part = boundPageBytes(page)[0].parts[0] as any
    expect(part.metadata.truncated).toEqual([
      { field: "output", originalLength: original, keptLength: PART_BODY_LIMIT_BYTES },
    ])
    expect(part.state.output.length).toBe(PART_BODY_LIMIT_BYTES)
  })

  test("messages and parts are never dropped, only bodies trimmed", () => {
    const page = [
      message("msg_1", [toolPart("prt_1", "msg_1", 3 * 1024 * 1024), textPart("prt_2", "msg_1", 10)]),
      message("msg_2", [textPart("prt_3", "msg_2", 10)]),
    ]
    const bounded = boundPageBytes(page)
    expect(bounded).toHaveLength(2)
    expect(bounded[0].parts).toHaveLength(2)
    expect(bounded[1].parts).toHaveLength(1)
  })

  test("a page already under the limits is returned untouched", () => {
    const page = [message("msg_1", [textPart("prt_1", "msg_1", 100)])]
    // Reference equality: no gratuitous copying for the common small page.
    expect(boundPageBytes(page)).toBe(page as never)
  })

  test("trimming cuts on a UTF-8 boundary, never half a character", () => {
    // Each emoji is 4 UTF-8 bytes, so a cap that is not a multiple of 4 forces
    // a cut mid-sequence.
    const emoji = "😀".repeat(20000)
    const page = [message("msg_1", [textPart("prt_1", "msg_1", 0)])]
    ;(page[0].parts[0] as any).text = emoji
    const text = (boundPageBytes(page)[0].parts[0] as any).text as string
    expect(text).not.toContain("�")
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(PART_BODY_LIMIT_BYTES)
    // Still valid text: re-encoding is stable.
    expect(Buffer.from(text, "utf8").toString("utf8")).toBe(text)
  })

  test("once the page budget is spent, later bodies trim harder", () => {
    // Enough oversized parts to exhaust PAGE_BUDGET_BYTES; the page is walked
    // newest-first, so the OLDEST message is the one trimmed to the stub.
    const count = Math.ceil(PAGE_BUDGET_BYTES / PART_BODY_LIMIT_BYTES) + 4
    const page = Array.from({ length: count }, (_, index) =>
      message(`msg_${index}`, [toolPart(`prt_${index}`, `msg_${index}`, 1024 * 1024)]),
    )
    const bounded = boundPageBytes(page)
    const oldest = bounded[0].parts[0] as any
    const newest = bounded[count - 1].parts[0] as any
    expect(newest.state.output.length).toBe(PART_BODY_LIMIT_BYTES)
    expect(oldest.state.output.length).toBe(EXHAUSTED_BODY_LIMIT_BYTES)
  })
})
