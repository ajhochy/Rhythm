// rhythm-session-context — authoritative ambient provenance for memory tools.
//
// The model cannot reliably know its engine session id, and MCP clients are
// cached across sessions. OpenCode's tool.execute.before hook is the narrow
// execution boundary that carries the authoritative sessionID for every call.
// Overwrite the reserved sdkSessionId argument there so model-supplied values
// cannot suppress or forge the normal-session provenance stamp.

const REMEMBER_TOOL = 'rhythm_rhythm_remember_memory'

export default async function rhythmSessionContextPlugin() {
  return {
    'tool.execute.before': async (input, output) => {
      if (input?.tool !== REMEMBER_TOOL) return
      if (!input?.sessionID || !output?.args || typeof output.args !== 'object') {
        return
      }
      output.args.sdkSessionId = input.sessionID
    },
  }
}
