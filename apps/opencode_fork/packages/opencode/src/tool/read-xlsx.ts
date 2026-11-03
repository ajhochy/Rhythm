import { ZipReader, Uint8ArrayReader } from "@zip.js/zip.js"
import { XMLParser, XMLValidator } from "fast-xml-parser"
import path from "node:path"

const MAX_ARCHIVE = 20 * 1024 * 1024
const MAX_EXPANDED = 16 * 1024 * 1024
const MAX_CELLS = 10000
const MAX_OUTPUT = 50 * 1024
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true,
  parseTagValue: false, parseAttributeValue: false, alwaysCreateTextNode: true })
const array = (value: any): any[] => value === undefined ? [] : Array.isArray(value) ? value : [value]
const text = (value: any): string => typeof value === "string" ? value : value?.["#text"] ?? ""
const richText = (value: any): string => array(value?.t).map(text).join("") + array(value?.r).map((r) => text(r.t)).join("")
const fail = (code: string, message: string): never => { throw new Error(`${code}: ${message}`) }
const limit = () => fail("XLSX_LIMIT", "Workbook exceeds safe reading limits. Split the workbook or reduce its rows, cells, or content.")
const corrupt = () => fail("XLSX_CORRUPT", "Workbook is corrupt or not a valid XLSX. Export a valid, unencrypted XLSX.")
const unsafe = () => fail("XLSX_UNSAFE", "Workbook contains unsafe paths, external relationships, entities, or executable content. Export a plain XLSX without these features.")
function jsonBytes(value: unknown): number {
  if (typeof value === "string") {
    let bytes = 2 // Quotes around the JSON string.
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i)
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) bytes += 2
      else if (code < 32) bytes += 6
      else if (code < 128) bytes++
      else if (code < 2048) bytes += 2
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++ }
      else if (code >= 0xd800 && code <= 0xdfff) bytes += 6
      else bytes += 3
      if (bytes > MAX_OUTPUT) return bytes
    }
    return bytes
  }
  if (value === null) return 4
  if (Array.isArray(value)) return value.reduce((n, item) => n + (n > 2 ? 1 : 0) + (item === undefined ? 4 : jsonBytes(item)), 2)
  if (typeof value === "object") {
    let bytes = 2
    let first = true
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue
      bytes += (first ? 0 : 1) + jsonBytes(key) + 1 + jsonBytes(item)
      first = false
      if (bytes > MAX_OUTPUT) return bytes
    }
    return bytes
  }
  return Buffer.byteLength(JSON.stringify(value))
}
function coordinate(value: string): [number, number] {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(value)
  if (!match) return corrupt()
  const column = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)
  const row = Number(match[2])
  if (row > 2000 || column > 100) return limit()
  return [row, column]
}
function address(row: number, col: number) {
  let name = ""
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name
  return name + row
}

/** Read a bounded OOXML package in memory; never extract files or evaluate formulas/macros. */
export async function readXlsx(bytes: Uint8Array): Promise<string> {
  if (bytes.length > MAX_ARCHIVE) return limit()
  // OLE Compound File is how Office stores encrypted XLSX packages.
  if (Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) {
    return fail("XLSX_ENCRYPTED", "Encrypted workbooks cannot be read. Export an unencrypted XLSX.")
  }
  // zip.js slices with Uint8Array semantics; Buffer.slice retains pooled offsets instead.
  const reader = new ZipReader(new Uint8ArrayReader(Uint8Array.from(bytes)), { useWebWorkers: false })
  try {
    const files: Awaited<ReturnType<typeof reader.getEntries>> = []
    for await (const file of reader.getEntriesGenerator()) {
      if (files.length >= 256) return limit()
      files.push(file)
    }
    let declared = 0
    const names = new Set<string>()
    for (const file of files) {
      const name = file.filename
      if (name.startsWith("/") || name.includes("\\") || name.includes("\0") || name.includes(":") || name.split("/").some((p) => p === ".." || p === ".")) return unsafe()
      if (names.has(name)) return corrupt()
      names.add(name)
      if (file.encrypted) return fail("XLSX_ENCRYPTED", "Encrypted workbooks cannot be read. Export an unencrypted XLSX.")
      if (/vbaProject|activeX|embeddings|macrosheet/i.test(name)) return unsafe()
      declared += file.uncompressedSize
      if (!Number.isSafeInteger(declared) || declared > MAX_EXPANDED) return limit()
    }
    const xml = new Map<string, any>()
    let expanded = 0
    for (const file of files) {
      if (file.directory || !/\.(xml|rels)$/i.test(file.filename)) continue
      if (!file.getData) return corrupt()
      let size = 0
      const chunks: Buffer[] = []
      await file.getData(new WritableStream<Uint8Array>({ write(chunk) {
        size += chunk.byteLength; expanded += chunk.byteLength
        if (size > MAX_EXPANDED || expanded > MAX_EXPANDED) return limit()
        chunks.push(Buffer.from(chunk))
      } }), { checkSignature: true, signal: AbortSignal.timeout(5000), useWebWorkers: false })
      if (size !== file.uncompressedSize) return corrupt()
      const source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))
      if (/<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject|activeX/i.test(source)) return unsafe()
      if (XMLValidator.validate(source) !== true) return corrupt()
      const node = parser.parse(source)
      xml.set(file.filename, node)
      if (/\.rels$/i.test(file.filename)) {
        for (const relation of array(node.Relationships?.Relationship)) {
          const target = relation["@Target"]
          if (typeof target !== "string" || relation["@TargetMode"] === "External" || /[\\:\0]|^\//.test(target)) return unsafe()
          const base = path.posix.dirname(file.filename).replace(/(?:^|\/)\_rels$/, "") || "."
          const normalized = path.posix.normalize(path.posix.join(base, target))
          if (normalized === ".." || normalized.startsWith("../")) return unsafe()
        }
      }
    }
    const sheets = array(xml.get("xl/workbook.xml")?.workbook?.sheets?.sheet)
    if (sheets.length > 32) return limit()
    if (!sheets.length || !xml.has("[Content_Types].xml")) return corrupt()
    const relations = array(xml.get("xl/_rels/workbook.xml.rels")?.Relationships?.Relationship)
    const strings = array(xml.get("xl/sharedStrings.xml")?.sst?.si).map(richText)
    const valueOf = (cell: any): { type: string; value: string | number | boolean | null } => {
      if (cell.is !== undefined) return { type: "string", value: richText(cell.is) }
      if (cell.v === undefined) return { type: "blank", value: null }
      const value = text(cell.v)
      switch (cell["@t"]) {
        case "s": {
          if (!/^\d+$/.test(value) || strings[Number(value)] === undefined) return corrupt()
          return { type: "string", value: strings[Number(value)] }
        }
        case "str": return { type: "string", value }
        case "b": if (value !== "0" && value !== "1") return corrupt(); return { type: "boolean", value: value === "1" }
        case "e": return { type: "error", value }
        case "d": if (!Number.isFinite(Date.parse(value))) return corrupt(); return { type: "date", value }
        case undefined:
        case "n": {
          if (!value.trim() || !Number.isFinite(Number(value))) return corrupt()
          // Retain large integer literals exactly rather than rounding them in JavaScript.
          return { type: "number", value: /^-?\d+$/.test(value) && !Number.isSafeInteger(Number(value)) ? value : Number(value) }
        }
        default: return corrupt()
      }
    }
    let totalCells = 0
    let outputCells = 0
    const parsedSheets = sheets.map((sheet) => {
      const relationship = relations.find((r) => r["@Id"] === sheet["@id"])
      if (!relationship || typeof sheet["@name"] !== "string") return corrupt()
      const target = path.posix.normalize(path.posix.join("xl", relationship["@Target"]))
      const worksheet = xml.get(target)?.worksheet
      if (!worksheet) return corrupt()
      const sourceRows = array(worksheet.sheetData?.row)
      totalCells += sourceRows.reduce((n, row) => n + array(row.c).length, 0)
      if (totalCells > MAX_CELLS || sourceRows.length > 2000) return limit()
      const cells = new Map<string, any>()
      let maxRow = 0, maxCol = 0, minRow = 1, minCol = 1, previousRow = 0
      for (const row of sourceRows) {
        const rowNumber = row["@r"] === undefined ? previousRow + 1 : Number(row["@r"])
        if (!Number.isSafeInteger(rowNumber) || rowNumber <= previousRow) return corrupt()
        if (rowNumber > 2000) return limit()
        previousRow = rowNumber; maxRow = Math.max(maxRow, rowNumber)
        let previousCol = 0
        for (const cell of array(row.c)) {
          const cellAddress = cell["@r"] ?? address(rowNumber, previousCol + 1)
          const [r, col] = coordinate(cellAddress)
          if (r !== rowNumber || col <= previousCol || cells.has(cellAddress)) return corrupt()
          previousCol = col; maxCol = Math.max(maxCol, col)
          const value = valueOf(cell)
          const formula = cell.f === undefined ? undefined : text(cell.f)
          cells.set(cellAddress, formula === undefined ? { address: cellAddress, ...value } : {
            address: cellAddress, type: "formula", formula: formula || null,
            cached: cell.v === undefined ? { type: "missing", value: null } : value,
            ...(cell.f["@t"] ? { formulaType: cell.f["@t"], formulaRef: cell.f["@ref"] ?? null, sharedIndex: cell.f["@si"] ?? null } : {}),
          })
        }
      }
      const dimension = worksheet.dimension?.["@ref"]
      if (dimension) {
        const parts = dimension.split(":")
        if (parts.length > 2) return corrupt()
        const [firstRow, firstCol] = coordinate(parts[0])
        const [lastRow, lastCol] = coordinate(parts.at(-1)!)
        if (lastRow < firstRow || lastCol < firstCol) return corrupt()
        minRow = Math.min(firstRow, sourceRows.length ? Number(sourceRows[0]["@r"] ?? 1) : firstRow)
        minCol = Math.min(firstCol, cells.size ? Math.min(...[...cells.keys()].map((a) => coordinate(a)[1])) : firstCol)
        maxRow = Math.max(maxRow, lastRow); maxCol = Math.max(maxCol, lastCol)
      }
      outputCells += Math.max(0, maxRow - minRow + 1) * Math.max(0, maxCol - minCol + 1)
      if (outputCells > MAX_CELLS) return limit()
      const rows = Array.from({ length: Math.max(0, maxRow - minRow + 1) }, (_, i) => {
        const row = minRow + i
        return { row, cells: Array.from({ length: Math.max(0, maxCol - minCol + 1) }, (_, j) => {
          const a = address(row, minCol + j)
          return cells.get(a) ?? { address: a, type: "blank", value: null }
        }) }
      })
      return { name: sheet["@name"], range: maxRow && maxCol ? `${address(minRow, minCol)}:${address(maxRow, maxCol)}` : null, rows }
    })
    const chunks: string[] = []
    let outputBytes = 0
    const append = (piece: string, bytes = Buffer.byteLength(piece)) => {
      if (outputBytes + bytes > MAX_OUTPUT) return limit()
      outputBytes += bytes
      chunks.push(piece)
    }
    const appendJson = (value: unknown) => {
      const bytes = jsonBytes(value)
      if (outputBytes + bytes > MAX_OUTPUT) return limit()
      append(JSON.stringify(value), bytes)
    }
    append('{"format":"xlsx","sheets":[')
    for (const [sheetIndex, sheet] of parsedSheets.entries()) {
      if (sheetIndex) append(",")
      append('{"name":'); appendJson(sheet.name)
      append(',"range":'); appendJson(sheet.range)
      append(',"rows":[')
      for (const [rowIndex, row] of sheet.rows.entries()) {
        if (rowIndex) append(",")
        append('{"row":'); appendJson(row.row)
        append(',"cells":[')
        for (const [cellIndex, cell] of row.cells.entries()) {
          if (cellIndex) append(",")
          appendJson(cell)
        }
        append("]}")
      }
      append("]}")
    }
    append("]}")
    return chunks.join("")
  } catch (error) {
    if (error instanceof Error && /^XLSX_/.test(error.message)) throw error
    return corrupt()
  } finally { await reader.close() }
}
