#!/usr/bin/env bun
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

import { $ } from "bun"
import path from "path"

import { createClient } from "@hey-api/openapi-ts"

const opencode = path.resolve(dir, "../../opencode")

await $`bun dev generate > ${dir}/openapi.json`.cwd(opencode)

// Effect's OpenAPI emitter currently drops Schema.NullOr from object
// properties. The fork accepts explicit null here to clear a persisted
// allowlist (#928); preserve that wire contract in the generated SDK instead
// of forcing consumers back to an untyped fetch/cast.
const openapi = (await Bun.file("./openapi.json").json()) as {
  paths?: Record<
    string,
    {
      patch?: {
        operationId?: string
        requestBody?: {
          content?: Record<
            string,
            {
              schema?: {
                properties?: Record<string, Record<string, unknown>>
              }
            }
          >
        }
      }
    }
  >
}
const update = openapi.paths?.["/session/{sessionID}"]?.patch
if (update?.operationId !== "session.update") {
  throw new Error("Rhythm SDK build: session.update OpenAPI operation is missing")
}
const properties = update.requestBody?.content?.["application/json"]?.schema?.properties
for (const name of ["mcpAllowlist", "skillAllowlist"]) {
  const schema = properties?.[name]
  if (!schema) throw new Error(`Rhythm SDK build: session.update.${name} schema is missing`)
  if (!("anyOf" in schema)) {
    properties![name] = { anyOf: [schema, { type: "null" }] }
  }
}
const openapiText = `${JSON.stringify(openapi, null, 2)}\n`
await Bun.write("./openapi.json", openapiText)
// Keep both checked-in specs identical to the schema that generated the SDK.
await Bun.write("../openapi.json", openapiText)
await Bun.write("../../docs/openapi.json", openapiText)

await createClient({
  input: "./openapi.json",
  output: {
    path: "./src/v2/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      instance: "OpencodeClient",
      exportFromIndex: false,
      auth: false,
      paramsStructure: "flat",
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})

await $`bun prettier --write src/gen`
await $`bun prettier --write src/v2`
// Composite builds cache emission in tsconfig.tsbuildinfo. Removing dist while
// leaving that cache makes tsc report success but emit only recently-changed
// files, producing a package with missing JS/.d.ts. Force a complete artifact.
await $`rm -rf dist tsconfig.tsbuildinfo`
await $`bun tsc --build --force tsconfig.json`
await $`rm openapi.json`
