import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import { tmpdir } from "./fixture"

describe("tmpdir", () => {
  test("removes the owned directory when initialization throws before return", async () => {
    let owned = ""
    const failure = new Error("initialization failed")
    try {
      await using sentinel = await tmpdir()
      await expect(
        tmpdir({
          init: async (dir) => {
            owned = dir
            await fs.writeFile(`${dir}/active`, "active")
            throw failure
          },
        }),
      ).rejects.toBe(failure)
      expect(await fs.stat(owned).then(() => true, () => false)).toBe(false)
      expect(await fs.stat(sentinel.path).then(() => true, () => false)).toBe(true)
    } finally {
      if (owned) await fs.rm(owned, { recursive: true, force: true })
    }
  })

  test("retains successful fixtures until disposal even when the consumer fails", async () => {
    let owned = ""
    const failure = new Error("consumer failed")
    await expect(
      (async () => {
        await using tmp = await tmpdir({
          init: async (dir) => {
            await fs.writeFile(`${dir}/active`, "active")
            return "ready"
          },
          dispose: async (dir) => {
            expect(await fs.readFile(`${dir}/active`, "utf8")).toBe("active")
            return "ready"
          },
        })
        owned = tmp.path
        expect(tmp.extra).toBe("ready")
        expect(await fs.readFile(`${owned}/active`, "utf8")).toBe("active")
        throw failure
      })(),
    ).rejects.toBe(failure)
    expect(await fs.stat(owned).then(() => true, () => false)).toBe(false)
  })

  test("disables fsmonitor for git fixtures", async () => {
    await using tmp = await tmpdir({ git: true })

    const value = (await $`git config core.fsmonitor`.cwd(tmp.path).quiet().text()).trim()
    expect(value).toBe("false")
  })

  test("removes directories on dispose", async () => {
    const tmp = await tmpdir({ git: true })
    const dir = tmp.path

    await tmp[Symbol.asyncDispose]()

    const exists = await fs
      .stat(dir)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(false)
  })
})
