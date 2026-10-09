import { describe, expect, it, vi } from "vitest"
import { OpencodeClientService } from "./opencode_client_service"
import { applySelectiveDeferral } from "./tool_surface_estimator"
import type { McpRoleConfig } from "./agent_profile_scope"

const wholeServerProfile: McpRoleConfig = {
  role: "secretary",
  mcpServers: { rhythm: {} },
  allowedToolsJson: "{}",
}

function injectReadyClient(service: OpencodeClientService, client: unknown) {
  ;(service as unknown as Record<string, unknown>).status = "ready"
  ;(service as unknown as Record<string, unknown>).client = client
}

describe("lazy tool loading defaults", () => {
  it("does not use the legacy 25-tool estimate or 30-tool cutoff to choose lazy loading", () => {
    for (const reportedCount of [0, 25, 29, 30, 107]) {
      expect(
        applySelectiveDeferral({ servers: ["rhythm"], tools: [] }, { rhythm: reportedCount }),
      ).toMatchObject({
        servers: ["rhythm"],
        tools: [],
        deferred: true,
      })
    }
  })

  it.each([undefined, "anthropic", "openai", "google"]) (
    "creates profiled sessions with lazy loading on for provider %s without widening the grant",
    async (providerId) => {
      const service = new OpencodeClientService()
      let body: Record<string, unknown> = {}
      injectReadyClient(service, {
        session: {
          create: vi.fn(async (input: { body: Record<string, unknown> }) => {
            body = input.body
            return { data: { id: "sdk-lazy-create" } }
          }),
        },
      })

      await service.createSession("lazy default", "/fixture", wholeServerProfile, undefined, providerId)

      expect(body.mcpAllowlist).toEqual({ servers: ["rhythm"], tools: [], deferred: true })
    },
  )

  it.each([undefined, "anthropic", "openai", "google"]) (
    "updates profiled sessions with lazy loading on for provider %s without widening the grant",
    async (providerId) => {
      const service = new OpencodeClientService()
      const update = vi.fn(async (input: Record<string, unknown>) => ({ data: { id: input.sessionID } }))
      service.__setTestV2Client({ session: { update } } as never)

      await expect(service.updateSessionAllowlist("sdk-lazy-update", wholeServerProfile, providerId)).resolves.toBe(true)

      expect(update).toHaveBeenCalledWith({
        sessionID: "sdk-lazy-update",
        mcpAllowlist: { servers: ["rhythm"], tools: [], deferred: true },
      })
    },
  )
})
