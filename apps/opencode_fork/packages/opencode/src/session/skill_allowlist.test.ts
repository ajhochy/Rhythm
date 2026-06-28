import { describe, test, expect } from "bun:test"

/**
 * Regression guard for issue #775 — per-session skill allowlist filtering.
 *
 * Tests the pure helper `filterSkillsByAllowlist` (and `isSkillAllowed`) that
 * the two skill-listing seams (SystemPrompt.skills + ToolRegistry.describeSkill)
 * and the skill tool's execute-time guard share. Mirrors mcp_allowlist.test.ts.
 *
 * Regression it catches: if the allowlist gate is bypassed (filter returns the
 * full list, or an out-of-scope name leaks through), a restricted agent would be
 * offered / could load skills outside its profile — the exact #765-shape failure
 * the issue is about (schema says scoped, runtime serves everything).
 */

import { filterSkillsByAllowlist, isSkillAllowed } from "./skill_allowlist"

const names = ["docx", "pptx", "engineering:code-review"]

describe("issue-775-c1: explicit skill allowlist keeps only listed names", () => {
  test("returns only docx when skills=['docx']", () => {
    const result = filterSkillsByAllowlist(names, { skills: ["docx"] })
    expect(result).toEqual(["docx"])
    expect(result).not.toContain("pptx")
    expect(result).not.toContain("engineering:code-review")
  })

  test("namespaced names are matched verbatim (no normalization)", () => {
    const result = filterSkillsByAllowlist(names, { skills: ["engineering:code-review"] })
    expect(result).toEqual(["engineering:code-review"])
  })
})

describe("issue-775-c2: empty allowlist denies every skill", () => {
  test("returns [] when skills=[]", () => {
    expect(filterSkillsByAllowlist(names, { skills: [] })).toEqual([])
  })
})

describe("issue-775-c3: undefined allowlist passes all (back-compat / unrestricted)", () => {
  test("returns all names when allowlist is undefined", () => {
    expect(filterSkillsByAllowlist(names, undefined)).toEqual(names)
  })
})

describe("issue-775-c4: unknown name in allowlist is silently absent", () => {
  test("does not throw and drops names that match no discovered skill", () => {
    expect(() => filterSkillsByAllowlist(names, { skills: ["nope"] })).not.toThrow()
    expect(filterSkillsByAllowlist(names, { skills: ["nope"] })).toEqual([])
  })
})

describe("issue-775-c5: isSkillAllowed gate (execute-time guard)", () => {
  test("undefined allowlist permits any skill (back-compat)", () => {
    expect(isSkillAllowed("docx", undefined)).toBe(true)
  })
  test("permits a listed skill and denies an unlisted one", () => {
    expect(isSkillAllowed("docx", { skills: ["docx"] })).toBe(true)
    expect(isSkillAllowed("pptx", { skills: ["docx"] })).toBe(false)
  })
  test("empty allowlist denies everything", () => {
    expect(isSkillAllowed("docx", { skills: [] })).toBe(false)
  })
})
