import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { MCP } from "../../src/mcp"
import { Skill } from "../../src/skill"
import { testEffect } from "../lib/effect"

type PromptCatalog = Record<string, { client: string; name: string; description?: string }>

let prompts: PromptCatalog = {}

const mcp = MCP.Service.of({
  prompts: () => Effect.sync(() => prompts),
  getPrompt: () => Effect.succeed(undefined),
} as unknown as MCP.Interface)

const config = Config.Service.of({
  get: () => Effect.succeed({ command: {} }),
} as Config.Interface)

const skill = Skill.Service.of({
  all: () => Effect.succeed([]),
} as unknown as Skill.Interface)

const layer = Layer.provideMerge(Command.layer, Bus.layer).pipe(
  Layer.provide(Layer.succeed(MCP.Service, mcp)),
  Layer.provide(Layer.succeed(Config.Service, config)),
  Layer.provide(Layer.succeed(Skill.Service, skill)),
)

const it = testEffect(layer)

it.instance("passive /command refreshes after scoped MCP acquisition and retains prompts through idle", () =>
  Effect.gen(function* () {
    prompts = {}
    const command = yield* Command.Service
    const bus = yield* Bus.Service

    // Before the session selects its MCP, command discovery is passive and
    // does not fabricate the fixture prompt.
    expect((yield* command.list()).map((item) => item.name)).not.toContain("allowed:fixture_prompt")
    yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)))

    prompts = {
      "allowed:fixture_prompt": {
        client: "allowed",
        name: "fixture_prompt",
        description: "fixture prompt",
      },
    }
    yield* bus.publish(MCP.MetadataChanged, { server: "allowed" })
    yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)))

    expect((yield* command.list()).map((item) => item.name)).toContain("allowed:fixture_prompt")

    // Idle retirement drops only the transport. The command metadata remains
    // available; executing it will re-acquire through MCP.getPrompt.
    prompts = {}
    expect((yield* command.list()).map((item) => item.name)).toContain("allowed:fixture_prompt")
  }),
)
