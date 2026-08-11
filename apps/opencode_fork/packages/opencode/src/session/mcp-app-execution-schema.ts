import { Schema } from "effect"

export const McpAppExecutionProof = Schema.Struct({
  proof: Schema.String,
  expiresAt: Schema.String,
})

export const McpAppExecutionRequest = Schema.Struct({
  proof: Schema.String,
  toolKey: Schema.String,
  input: Schema.Record(Schema.String, Schema.Unknown),
  requestID: Schema.String,
})

export const McpAppExecutionResult = Schema.Struct({
  content: Schema.optional(Schema.Array(Schema.Unknown)),
  structuredContent: Schema.optional(Schema.Unknown),
  isError: Schema.optional(Schema.Boolean),
})
