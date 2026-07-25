import { describe, expect, test } from "bun:test"
import { attachmentMime } from "./files"
import { pasteMode } from "./paste"
import { ACCEPTED_FILE_EXTENSIONS, ACCEPTED_FILE_TYPES, filePickerFilters } from "@/constants/file-picker"

describe("issue-1137-c1: file picker does not gate by type", () => {
  test("offers an unrestricted picker instead of a hardcoded MIME or extension allow-list", () => {
    // Regression caught: a format absent from these lists could not even be
    // selected, so reader discovery at consumption time was unreachable.
    expect(ACCEPTED_FILE_TYPES).toEqual([])
    expect(ACCEPTED_FILE_EXTENSIONS).toEqual([])
    expect(filePickerFilters(ACCEPTED_FILE_EXTENSIONS)).toBeUndefined()
  })
})

describe("attachmentMime", () => {
  test("keeps PDFs when the browser reports the mime", async () => {
    const file = new File(["%PDF-1.7"], "guide.pdf", { type: "application/pdf" })
    expect(await attachmentMime(file)).toBe("application/pdf")
  })

  test("normalizes structured text types to text/plain", async () => {
    const file = new File(['{"ok":true}\n'], "data.json", { type: "application/json" })
    expect(await attachmentMime(file)).toBe("text/plain")
  })

  test("accepts text files even with a misleading browser mime", async () => {
    const file = new File(["export const x = 1\n"], "main.ts", { type: "video/mp2t" })
    expect(await attachmentMime(file)).toBe("text/plain")
  })

  test("rejects binary files", async () => {
    const file = new File([Uint8Array.of(0, 255, 1, 2)], "blob.bin", { type: "application/octet-stream" })
    expect(await attachmentMime(file)).toBeUndefined()
  })
})

describe("pasteMode", () => {
  test("uses native paste for short single-line text", () => {
    expect(pasteMode("hello world")).toBe("native")
  })

  test("uses manual paste for multiline text", () => {
    expect(
      pasteMode(`{
  "ok": true
}`),
    ).toBe("manual")
    expect(pasteMode("a\r\nb")).toBe("manual")
  })

  test("uses manual paste for large text", () => {
    expect(pasteMode("x".repeat(8000))).toBe("manual")
  })
})
