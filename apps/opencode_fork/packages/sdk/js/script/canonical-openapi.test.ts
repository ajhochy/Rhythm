import { describe, expect, test } from "bun:test"
import { canonicalizeOpenApi } from "./canonical-openapi"

describe("canonicalizeOpenApi", () => {
  test("normalizes component and ref-union order without reordering inline unions", () => {
    const first = {
      components: {
        schemas: {
          Zebra: { type: "string" },
          Alpha: { type: "number" },
        },
      },
      event: {
        anyOf: [{ $ref: "#/components/schemas/Zebra" }, { $ref: "#/components/schemas/Alpha" }],
      },
      inline: {
        anyOf: [{ type: "string" }, { type: "number" }],
      },
    }
    const second = {
      ...first,
      components: {
        schemas: {
          Alpha: { type: "number" },
          Zebra: { type: "string" },
        },
      },
      event: {
        anyOf: [{ $ref: "#/components/schemas/Alpha" }, { $ref: "#/components/schemas/Zebra" }],
      },
    }

    const canonical = canonicalizeOpenApi(first)

    expect(Object.keys(canonical.components.schemas)).toEqual(["Alpha", "Zebra"])
    expect(canonical.event.anyOf.map((item) => item.$ref)).toEqual([
      "#/components/schemas/Alpha",
      "#/components/schemas/Zebra",
    ])
    expect(canonical.inline.anyOf).toEqual([{ type: "string" }, { type: "number" }])
    expect(canonical).toEqual(canonicalizeOpenApi(second))
    expect(canonical).toEqual(canonicalizeOpenApi(canonical))
  })
})
