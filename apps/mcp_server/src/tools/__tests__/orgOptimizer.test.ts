import { describe, expect, it, vi } from "vitest";
import { registerOrgOptimizerTools } from "../orgOptimizer.js";

type ToolHandler = (args: Record<string, unknown>, extra?: unknown) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}>;

interface RegisteredTool {
  description: string;
  handler: ToolHandler;
}

function makeStubServer(): { server: unknown; tools: Map<string, RegisteredTool> } {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    tool(
      name: string,
      description: string,
      _shape: Record<string, unknown>,
      handler: ToolHandler,
    ) {
      tools.set(name, { description, handler });
    },
  };
  return { server, tools };
}

describe("retired Org Self-Optimizer MCP tools", () => {
  it.each([
    "rhythm_run_org_optimizer",
    "rhythm_run_external_discovery",
  ])("keeps %s registered but performs no API request", async (toolName) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { server, tools } = makeStubServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerOrgOptimizerTools(server as any, "http://127.0.0.1:1", "token");

    const tool = tools.get(toolName)!;
    const result = await tool.handler({
      maxProposalsPerRun: 20,
      maxLlmCallsPerRun: 40,
      approval_id: "legacy-approval",
    });

    expect(tool.description).toContain("Retired compatibility tool");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("weekly Org Reviewer");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
