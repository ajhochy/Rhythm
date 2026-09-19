/** Identify disposable rows owned by this smoke invocation. */
export function ownsMegaSmokeRow(row: Record<string, unknown>, marker: string): boolean {
  return ['name', 'title', 'label'].some((field) => {
    const value = row[field];
    return typeof value === 'string' && (value === marker || value.startsWith(`${marker}-`));
  });
}

/** Allow only this invocation's named creates and exact cleanup URLs. */
export function permitsMegaSmokeWrite(
  write: { method: string; url: string; body: string },
  marker: string,
  allowedDeleteUrls: ReadonlySet<string>,
): boolean {
  if (write.method === 'DELETE') return allowedDeleteUrls.has(write.url);
  if (write.method !== 'POST') return false;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(write.body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    body = parsed as Record<string, unknown>;
  } catch {
    return false;
  }
  if (!ownsMegaSmokeRow(body, marker)) return false;
  const url = new URL(write.url);
  if (['/facilities', '/project-templates', '/message-threads', '/automation-rules', '/projects', '/agent-configs'].includes(url.pathname)) return true;
  const reservation = url.pathname.match(/^\/facilities\/([^/]+)\/reservations$/);
  return reservation != null && allowedDeleteUrls.has(`${url.origin}/facilities/${reservation[1]}`);
}
