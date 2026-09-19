export type AgentSessionLink = { sessionId: string } | { error: string };

/** The sessionId is Rhythm's local ID, never an engine SDK session ID. */
export function agentSessionLinkFromHash(hash: string): AgentSessionLink | null {
  const value = hash.replace(/^#/, '');
  const separator = value.indexOf('?');
  if (separator < 0 || value.slice(0, separator) !== '/agents') return null;
  const values = new URLSearchParams(value.slice(separator + 1)).getAll('sessionId');
  if (!values.length) return null;
  if (values.length !== 1 || !/^[a-zA-Z0-9_-]{1,128}$/.test(values[0])) {
    return { error: 'The session link is invalid' };
  }
  return { sessionId: values[0] };
}
