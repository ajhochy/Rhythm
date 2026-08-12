import { describe, expect, it } from "bun:test"
import { engineIdentity } from "../../src/server/engine-identity"

describe("global health engine identity", () => {
  it("returns a stable per-boot id and the current process id", () => {
    const first = engineIdentity("1.14.49")
    const second = engineIdentity("1.14.49")

    expect(first).toEqual(second)
    expect(first.healthy).toBe(true)
    expect(first.version).toBe("1.14.49")
    expect(first.pid).toBe(process.pid)
    expect(first.bootId).toMatch(/^[0-9a-f-]{36}$/)
  })
})
