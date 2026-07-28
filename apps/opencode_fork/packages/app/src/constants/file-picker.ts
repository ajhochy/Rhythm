export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

// Issue #1137: selection is deliberately unrestricted. Type handling belongs
// at consumption time, where the agent can use a built-in reader or discover a
// compatible skill/MCP server instead of making the format unreachable here.
export const ACCEPTED_FILE_TYPES: string[] = []
export const ACCEPTED_FILE_EXTENSIONS: string[] = []

export function filePickerFilters(ext?: string[]) {
  if (!ext || ext.length === 0) return undefined
  return [{ name: "Files", extensions: ext }]
}
