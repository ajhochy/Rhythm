import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import type { ContentPart } from "@/context/prompt"
import { attachmentMime } from "./files"
import { pasteMode } from "./paste"
import { ACCEPTED_FILE_EXTENSIONS, ACCEPTED_FILE_TYPES, filePickerFilters } from "@/constants/file-picker"

let createPromptAttachments: typeof import("./attachments").createPromptAttachments
let promptParts: ContentPart[] = []

beforeAll(async () => {
  mock.module("@/context/prompt", () => ({
    usePrompt: () => ({
      current: () => promptParts,
      cursor: () => 0,
      set: (parts: ContentPart[]) => {
        promptParts = parts
      },
    }),
  }))
  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string) => key,
    }),
  }))
  createPromptAttachments = (await import("./attachments")).createPromptAttachments
})

beforeEach(() => {
  promptParts = []
})

describe("issue-1137-c1: file picker does not gate by type", () => {
  test("offers an unrestricted picker instead of a hardcoded MIME or extension allow-list", () => {
    // Regression caught: a format absent from these lists could not even be
    // selected, so reader discovery at consumption time was unreachable.
    expect(ACCEPTED_FILE_TYPES).toEqual([])
    expect(ACCEPTED_FILE_EXTENSIONS).toEqual([])
    expect(filePickerFilters(ACCEPTED_FILE_EXTENSIONS)).toBeUndefined()
  })

  test("createPromptAttachments consumes an arbitrary binary after selection", async () => {
    const editor = document.createElement("div")
    document.body.append(editor)
    const file = new File([Uint8Array.of(0, 255, 1, 2)], "fixture.rhythmfixture", {
      type: "application/x-rhythm-fixture",
    })

    const added = await new Promise<boolean>((resolve, reject) => {
      createRoot((dispose) => {
        const attachments = createPromptAttachments({
          editor: () => editor,
          isDialogActive: () => false,
          setDraggingType: () => undefined,
          focusEditor: () => undefined,
          addPart: () => false,
        })
        void attachments.addAttachment(file).then(
          (ok) => {
            dispose()
            resolve(ok)
          },
          (error) => {
            dispose()
            reject(error)
          },
        )
      })
    })

    expect(added).toBe(true)
    expect(promptParts).toHaveLength(1)
    expect(promptParts[0]).toMatchObject({
      type: "image",
      filename: "fixture.rhythmfixture",
      mime: "application/x-rhythm-fixture",
    })
    if (promptParts[0]?.type === "image") {
      expect(promptParts[0].dataUrl).toStartWith("data:application/x-rhythm-fixture;base64,")
    }
    editor.remove()
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

  test("preserves a browser-reported binary MIME for deferred reader discovery", async () => {
    const file = new File([Uint8Array.of(0, 255, 1, 2)], "blob.bin", { type: "application/octet-stream" })
    expect(await attachmentMime(file)).toBe("application/octet-stream")
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
