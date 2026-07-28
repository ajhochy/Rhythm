#!/usr/bin/env bun

/**
 * Build the fork SDK, then materialize the exact package consumed by Rhythm's
 * api_server. The output is committed so API TypeScript, Docker, and the
 * detached macOS app bundle never compile or reach into fork source.
 */
import { $ } from "bun"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const sdkDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const vendorDir = resolve(sdkDir, "../../../../api_server/vendor/opencode-ai-sdk")

await $`bun ./script/build.ts`.cwd(sdkDir)

const sourcePackage = JSON.parse(await readFile(resolve(sdkDir, "package.json"), "utf8")) as {
  name: string
  version: string
  type: string
  license: string
  exports: Record<string, unknown>
}

function artifactExports(exports: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(exports).map(([key, value]) => {
      if (typeof value === "string") {
        const file = value.replace("./src/", "./").replace(/\.ts$/, "")
        return [key, { import: `${file}.js`, types: `${file}.d.ts` }]
      }
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return [key, artifactExports(value as Record<string, unknown>)]
      }
      return [key, value]
    }),
  )
}

await rm(vendorDir, { recursive: true, force: true })
await mkdir(vendorDir, { recursive: true })
await cp(resolve(sdkDir, "dist"), vendorDir, { recursive: true })
await writeFile(
  resolve(vendorDir, "package.json"),
  `${JSON.stringify(
    {
      name: sourcePackage.name,
      version: `${sourcePackage.version}-rhythm`,
      private: true,
      type: sourcePackage.type,
      license: sourcePackage.license,
      main: "./index.js",
      types: "./index.d.ts",
      exports: artifactExports(sourcePackage.exports),
      dependencies: {
        "cross-spawn": "7.0.6",
      },
    },
    null,
    2,
  )}\n`,
)

console.log(`Rhythm SDK artifact refreshed: ${vendorDir}`)
