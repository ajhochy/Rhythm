import { mkdir, writeFile } from "node:fs/promises"
import path from "path"
import { openai } from "@ai-sdk/openai"
import type { Tool as AITool } from "ai"
import type { Permission } from "@/permission"
import type { Provider } from "@/provider/provider"
import { Wildcard } from "@/util/wildcard"
import { ToolID } from "./schema"
import { TRUNCATION_DIR } from "./truncation-dir"

/**
 * Rhythm carried patch (#1094): OpenAI's native image generation.
 *
 * This is a *provider* tool — OpenAI executes it server-side as part of the
 * Responses call, so it never passes through ToolRegistry (every entry there
 * needs an `execute`) and it rides the chat turn's own authenticated
 * connection. There is no platform API key on this machine, so a REST
 * implementation could not authenticate; the provider tool is the only path
 * that works.
 */
export const ID = "image_generation"

export type Action = "allow" | "ask"

/** The OpenAI Responses stacks that understand `openai.image_generation`. */
function isSupportedModel(model: Pick<Provider.Model, "providerID" | "api">) {
  // ponytail: `@ai-sdk/azure` and github-copilot's vendored Responses model
  // also accept this provider tool id, but neither is exercised here. Add them
  // when there is a profile to test against.
  return model.providerID === "openai" || model.api.npm === "@ai-sdk/openai"
}

/**
 * Resolve the agent's `image_generation` permission, or undefined when the
 * tool should not be offered at all.
 *
 * Opt-in by design: only a rule that names `image_generation` counts. Most
 * agents inherit a catch-all `"*": "allow"` rule, so matching wildcards here
 * would hand the tool to every profile — the opposite of the per-profile
 * toggle this implements. A `deny`, or no naming rule, means not offered.
 */
export function enabledFor(
  model: Pick<Provider.Model, "providerID" | "api">,
  ruleset: Permission.Ruleset,
): Action | undefined {
  if (!isSupportedModel(model)) return undefined
  const rule = ruleset.findLast((item) => item.permission !== "*" && Wildcard.match(ID, item.permission))
  if (!rule || rule.action === "deny") return undefined
  return rule.action
}

export function tool(): AITool {
  // No args: OpenAI's defaults (gpt-image-1, png, no partial images). Partial
  // images would emit an extra tool-result per frame for the same call id.
  return openai.tools.imageGeneration()
}

/** True for the `{ result: <base64> }` payload a provider-executed call returns. */
export function isProviderResult(output: unknown): output is { result: string } {
  return typeof output === "object" && output !== null && typeof (output as any).result === "string"
}

/**
 * Persist the returned image and describe it for the transcript. The bytes go
 * to the tool-output dir (already allow-listed for `read` via
 * `Truncate.GLOB`, and swept after 7 days) rather than into the tool output,
 * which is re-sent to the model on every subsequent turn.
 */
export async function persist(base64: string) {
  const file = path.join(TRUNCATION_DIR, `${ToolID.ascending()}.png`)
  await mkdir(TRUNCATION_DIR, { recursive: true })
  await writeFile(file, Buffer.from(base64, "base64"))
  return {
    title: "Generated image",
    metadata: { path: file },
    output: `Image generated and saved to ${file}\nUse the read tool with that path to view it.`,
  }
}
