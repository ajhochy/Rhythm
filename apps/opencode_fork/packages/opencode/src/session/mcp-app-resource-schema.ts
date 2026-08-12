import { Schema } from "effect"

export const McpAppResourceContent = Schema.Struct({
  mimeType: Schema.Literal("text/html;profile=mcp-app"),
  text: Schema.String,
}).annotate({ identifier: "McpAppResourceContent" })
