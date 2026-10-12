// A1: Read must preserve tabular types/order and refuse unsafe workbooks, not generic binary refusal.
import { afterEach, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import path from "node:path"
import { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from "@zip.js/zip.js"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Git } from "@/git"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LSP } from "@/lsp/lsp"
import { Reference } from "@/reference/reference"
import { Instruction } from "@/session/instruction"
import { SessionID, MessageID } from "@/session/schema"
import { ReadTool } from "@/tool/read"
import { readXlsx } from "@/tool/read-xlsx"
import { Truncate } from "@/tool/truncate"
import { disposeAllInstances, provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(disposeAllInstances)
const it = testEffect(Layer.mergeAll(Agent.defaultLayer, AppFileSystem.defaultLayer,
  CrossSpawnSpawner.defaultLayer, Instruction.defaultLayer, LSP.defaultLayer, Truncate.defaultLayer,
  Reference.layer.pipe(Layer.provide(Config.defaultLayer), Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Git.defaultLayer), Layer.provide(RuntimeFlags.layer({}))),
))
const entries = () => ({
  "[Content_Types].xml": '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
  "xl/workbook.xml": '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="First" sheetId="1" r:id="a"/><sheet name="Second" sheetId="2" r:id="b"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="a" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/a.xml"/><Relationship Id="b" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/b.xml"/></Relationships>',
  "xl/worksheets/a.xml": '<worksheet><dimension ref="A1:C3"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>001 &amp; A</t></is></c><c r="B1" t="b"><v>0</v></c><c r="C1" t="e"><v>#DIV/0!</v></c></row><row r="2"><c r="A2"><v>17</v></c><c r="B2"/><c r="C2"><f>A2*2</f><v>34</v></c></row><row r="3"><c r="A3" t="d"><v>2026-10-01T00:00:00Z</v></c><c r="C3"><f>A2+1</f></c></row></sheetData></worksheet>',
  "xl/worksheets/b.xml": '<worksheet><dimension ref="A1:A1"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>second</t></is></c></row></sheetData></worksheet>',
})
async function zip(files: Record<string, string>, password?: string) {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  for (const [name, xml] of Object.entries(files)) await writer.add(name, new Uint8ArrayReader(Buffer.from(xml)), { level: xml.length > 1000000 ? 9 : 0, password })
  return writer.close()
}
const read = (bytes: Uint8Array) => Effect.gen(function* () {
  const dir = yield* tmpdirScoped()
  const fs = yield* AppFileSystem.Service
  const file = path.join(dir, "selected.xlsx")
  yield* fs.writeWithDirs(file, bytes)
  return yield* provideInstance(dir)(Effect.gen(function* () {
    const tool = yield* (yield* ReadTool).init()
    return yield* tool.execute({ filePath: file }, {
      sessionID: SessionID.make("ses_a1"), messageID: MessageID.make("msg_a1"), callID: "", agent: "build",
      abort: AbortSignal.any([]), messages: [], metadata: () => Effect.void, ask: () => Effect.void,
    })
  }))
})
it.live("A1 XLSX exact ordered rows/cell addresses/value types/blanks/formula caches", () => Effect.gen(function* () {
  const exit = yield* read(yield* Effect.promise(() => zip(entries()))).pipe(Effect.exit)
  expect(Exit.isSuccess(exit)).toBe(true)
  if (!Exit.isSuccess(exit)) return
  const result = exit.value
  expect(JSON.parse(result.output)).toEqual({ format: "xlsx", sheets: [
    { name: "First", range: "A1:C3", rows: [
      { row: 1, cells: [{ address: "A1", type: "string", value: "001 & A" }, { address: "B1", type: "boolean", value: false }, { address: "C1", type: "error", value: "#DIV/0!" }] },
      { row: 2, cells: [{ address: "A2", type: "number", value: 17 }, { address: "B2", type: "blank", value: null }, { address: "C2", type: "formula", formula: "A2*2", cached: { type: "number", value: 34 } }] },
      { row: 3, cells: [{ address: "A3", type: "date", value: "2026-10-01T00:00:00Z" }, { address: "B3", type: "blank", value: null }, { address: "C3", type: "formula", formula: "A2+1", cached: { type: "missing", value: null } }] },
    ] },
    { name: "Second", range: "A1:A1", rows: [{ row: 1, cells: [{ address: "A1", type: "string", value: "second" }] }] },
  ] })
  expect(result.metadata.truncated).toBe(false)
}))
for (const [name, mutate, code] of [
  ["archive traversal", (f: Record<string, string>) => { f["../outside.xml"] = "secret" }, "XLSX_UNSAFE"],
  ["external relationship", (f: Record<string, string>) => { f["xl/_rels/workbook.xml.rels"] = '<Relationships><Relationship Id="a" TargetMode="External" Target="https://example.invalid/secret"/></Relationships>' }, "XLSX_UNSAFE"],
  ["relationship traversal", (f: Record<string, string>) => { f["xl/_rels/workbook.xml.rels"] = '<Relationships><Relationship Id="a" Target="../../secret.xml"/></Relationships>' }, "XLSX_UNSAFE"],
  ["macros", (f: Record<string, string>) => { f["xl/vbaProject.bin"] = "binary macro" }, "XLSX_UNSAFE"],
  ["XML entity expansion", (f: Record<string, string>) => { f["xl/workbook.xml"] = '<!DOCTYPE workbook [<!ENTITY x "unsafe">]><workbook>&x;</workbook>' }, "XLSX_UNSAFE"],
  ["expanded archive", (f: Record<string, string>) => { f["xl/large.xml"] = "x".repeat(17 * 1024 * 1024) }, "XLSX_LIMIT"],
  ["dimension expansion", (f: Record<string, string>) => { f["xl/worksheets/a.xml"] = '<worksheet><dimension ref="A1:XFD1048576"/><sheetData/></worksheet>' }, "XLSX_LIMIT"],
  ["sheet count", (f: Record<string, string>) => { f["xl/workbook.xml"] = '<workbook><sheets>' + Array.from({ length: 33 }, (_, i) => `<sheet name="s${i}" sheetId="${i + 1}"/>`).join("") + '</sheets></workbook>' }, "XLSX_LIMIT"],
  ["cell count", (f: Record<string, string>) => { f["xl/worksheets/a.xml"] = '<worksheet><sheetData><row r="1">' + '<c r="A1"><v>1</v></c>'.repeat(10001) + '</row></sheetData></worksheet>' }, "XLSX_LIMIT"],
  ["output expansion", (f: Record<string, string>) => { f["xl/worksheets/b.xml"] = '<worksheet><dimension ref="A1:A1"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>' + 'X'.repeat(60000) + '</t></is></c></row></sheetData></worksheet>' }, "XLSX_LIMIT"],
  ["corrupt XML", (f: Record<string, string>) => { f["xl/workbook.xml"] = "<workbook><broken></workbook>" }, "XLSX_CORRUPT"],
] as const) it.live(`A1 XLSX rejects ${name} with precise model-visible error`, () => Effect.gen(function* () {
  const files: Record<string, string> = entries(); mutate(files)
  const bytes = yield* Effect.promise(() => zip(files))
  if (name === "expanded archive") expect(bytes.length).toBeLessThan(100000) // Compressed archive, not merely an oversized source.
  const exit = yield* read(bytes).pipe(Effect.exit)
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) expect(String(Cause.squash(exit.cause))).toContain(code)
}))
it.live("A1 XLSX refuses encrypted ZIP, no password prompt or shell recovery", () => Effect.gen(function* () {
  const exit = yield* read(yield* Effect.promise(() => zip(entries(), "synthetic"))).pipe(Effect.exit)
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) expect(String(Cause.squash(exit.cause))).toContain("XLSX_ENCRYPTED")
}))
it.live("A1 XLSX refuses corrupt ZIP with accurate error", () => Effect.gen(function* () {
  const exit = yield* read(Buffer.from("corrupt ZIP")).pipe(Effect.exit)
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) expect(String(Cause.squash(exit.cause))).toContain("XLSX_CORRUPT")
}))

it.live("A1 XLSX rejects entry 257 before parsing a malformed later entry", () => Effect.gen(function* () {
  const files: Record<string, string> = {}
  for (let index = 0; index < 258; index++) files[`extra-${index}.txt`] = ""
  const bytes = Buffer.from(yield* Effect.promise(() => zip(files)))
  const lastHeader = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  expect(lastHeader).toBeGreaterThan(0)
  bytes[lastHeader] = 0
  const exit = yield* read(bytes).pipe(Effect.exit)
  expect(Exit.isFailure(exit)).toBe(true)
  if (Exit.isFailure(exit)) expect(String(Cause.squash(exit.cause))).toContain("XLSX_LIMIT")
}))

it.live("A1 XLSX rejects repeated shared strings before serializing expanded output", () => Effect.gen(function* () {
  const files: Record<string, string> = entries()
  const col = (index: number) => {
    let result = ""
    for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result
    return result
  }
  files["xl/workbook.xml"] = '<workbook><sheets><sheet name="First" sheetId="1" r:id="a"/></sheets></workbook>'
  files["xl/_rels/workbook.xml.rels"] = '<Relationships><Relationship Id="a" Target="worksheets/a.xml"/></Relationships>'
  files["xl/sharedStrings.xml"] = `<sst><si><t>${"S".repeat(8192)}</t></si></sst>`
  files["xl/worksheets/a.xml"] = '<worksheet><dimension ref="A1:CV100"/><sheetData>' +
    Array.from({ length: 100 }, (_, row) => `<row r="${row + 1}">` +
      Array.from({ length: 100 }, (_, column) => `<c r="${col(column + 1)}${row + 1}" t="s"><v>0</v></c>`).join("") +
      '</row>').join("") + '</sheetData></worksheet>'
  const bytes = yield* Effect.promise(() => zip(files))
  const stringify = JSON.stringify
  JSON.stringify = ((value: unknown) => {
    if (value && typeof value === "object" && "format" in value && value.format === "xlsx") {
      throw new Error("oversized workbook serialization attempted")
    }
    return stringify(value)
  }) as typeof JSON.stringify
  try {
    const exit = yield* Effect.promise(() => readXlsx(bytes)).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(String(Cause.squash(exit.cause))).toContain("XLSX_LIMIT")
  } finally {
    JSON.stringify = stringify
  }
}))
