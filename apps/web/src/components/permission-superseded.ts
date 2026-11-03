/**
 * A live permission card is kept by `permission.asked` until a matching
 * `permission.replied` frame arrives. Server auto-resolutions broadcast
 * `permission.resolved` instead, so the card can outlive a tool call that
 * actually ran. The transcript's own tool parts are the native evidence:
 * a call still awaiting permission stays `pending`/`running`, so a completed
 * call of the same tool with none still in flight means nothing is waiting.
 */
type ToolLike = { tool?: { name?: string; status?: string } };

export function permissionSupersededByTool(
  permission: { tool: string },
  messages: ReadonlyArray<{ blocks: ReadonlyArray<unknown> }>,
): boolean {
  const name = permission.tool.trim().toLowerCase();
  if (!name) return false;
  let completed = false;
  for (const message of messages) {
    for (const block of message.blocks as ReadonlyArray<ToolLike>) {
      if (block.tool?.name?.toLowerCase() !== name) continue;
      if (block.tool.status === 'pending' || block.tool.status === 'running') return false;
      if (block.tool.status === 'completed') completed = true;
    }
  }
  return completed;
}
