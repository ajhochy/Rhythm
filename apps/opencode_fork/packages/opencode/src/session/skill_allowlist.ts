/**
 * Rhythm carried patch (skill-scope, #775): per-session skill allowlisting.
 *
 * Pure helper mirroring session/mcp_allowlist.ts. Kept in its own module so it
 * can be unit-tested without pulling in the full Effect runtime, and so both
 * skill-listing seams (SystemPrompt.skills + ToolRegistry.describeSkill) and the
 * skill tool's execute-time guard share one implementation.
 *
 * Background: the model only ever learns about / loads skills the fork lists for
 * it. Before this patch the listing was filtered ONLY by the agent's `skill`
 * permission, so a per-profile `allowed_skills_json` set in Rhythm never reached
 * the engine and the model saw every discovered skill — the same false-green
 * shape as the #765 MCP allowlist bug. This filter is the skill analogue of
 * filterMcpToolsByAllowlist: it drops out-of-scope skills before they are
 * injected into the model context.
 */

/**
 * Filter a list of skill names by a session's skillAllowlist.
 *
 * @param skillNames   All discovered skill names (SKILL.md frontmatter `name`).
 * @param skillAllowlist The session's allowlist, or undefined (back-compat pass-through).
 * @returns The subset of skillNames that pass the allowlist check.
 *
 * Filtering logic (mirrors filterMcpToolsByAllowlist):
 *   - undefined allowlist → all names pass (back-compat; an unrestricted profile).
 *   - else keep name n iff skillAllowlist.skills.includes(n).
 *   - An entry in skillAllowlist.skills that matches no discovered skill is
 *     silently absent (no error) — same as a tool id mapping to no server.
 */
export function filterSkillsByAllowlist(
  skillNames: string[],
  skillAllowlist: { skills: string[] } | undefined,
): string[] {
  if (skillAllowlist === undefined) {
    return skillNames
  }
  return skillNames.filter((n) => skillAllowlist.skills.includes(n))
}

/**
 * Convenience predicate for the execute-time guard: is a single skill name
 * permitted under the (possibly undefined) allowlist?
 *   - undefined allowlist → always permitted (back-compat).
 *   - else permitted iff the name is in skillAllowlist.skills.
 */
export function isSkillAllowed(
  skillName: string,
  skillAllowlist: { skills: string[] } | undefined,
): boolean {
  if (skillAllowlist === undefined) return true
  return skillAllowlist.skills.includes(skillName)
}
