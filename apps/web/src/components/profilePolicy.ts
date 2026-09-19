/** Lossless edits: JSON is validated, but untouched values are never reserialized. */
export type PermissionAction = 'allow' | 'ask' | 'deny';
export type Policy = { raw: string | null; value: Record<string, unknown> | null };
export type StructuredEdit =
  | { kind: 'default'; tool: string; action: PermissionAction | 'inherit' }
  | { kind: 'pattern'; tool: string; pattern: string; action: PermissionAction }
  | { kind: 'remove-pattern'; tool: string; pattern: string };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const isAction = (value: unknown): value is PermissionAction =>
  value === 'allow' || value === 'ask' || value === 'deny';

export function parsePolicy(raw: string | null | undefined): Policy {
  if (raw == null || !raw.trim()) return { raw: raw ?? null, value: null };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Enter valid permission JSON before saving or using structured controls.'); }
  if (!isRecord(value)) throw new Error('Permission JSON must be an object. Leave it blank to inherit engine policy.');
  return { raw, value };
}

export function serializePolicy(policy: Policy): string | null { return policy.raw; }

type Entry = { key: string; start: number; valueStart: number; end: number };
// Input has already passed JSON.parse. Scan quoted strings and nested values to
// locate only the property being edited, preserving escapes, numbers and order.
function entries(raw: string): Entry[] {
  const result: Entry[] = [];
  let i = raw.indexOf('{') + 1;
  const whitespace = () => { while (/\s/.test(raw[i] ?? '') && i < raw.length) i++; };
  const stringEnd = () => {
    i++;
    while (i < raw.length) { if (raw[i] === '\\') i += 2; else if (raw[i++] === '"') break; }
  };
  while (i < raw.length) {
    whitespace();
    if (raw[i] === '}') break;
    const start = i;
    stringEnd();
    const key = JSON.parse(raw.slice(start, i)) as string;
    whitespace(); i++; whitespace();
    const valueStart = i;
    let depth = 0;
    while (i < raw.length) {
      const c = raw[i];
      if (c === '"') { stringEnd(); continue; }
      if (depth === 0 && (c === ',' || c === '}')) break;
      if (c === '{' || c === '[') depth++;
      if (c === '}' || c === ']') depth--;
      i++;
    }
    let end = i;
    while (/\s/.test(raw[end - 1] ?? '')) end--;
    result.push({ key, start, valueStart, end });
    if (raw[i] === ',') i++; else break;
  }
  if (new Set(result.map(entry => entry.key)).size !== result.length) {
    throw new Error('Duplicate JSON keys need review in Advanced (JSON) before structured editing.');
  }
  return result;
}

function editProperty(raw: string, key: string, value: string | undefined, prepend = false): string {
  const props = entries(raw);
  const index = props.findIndex(entry => entry.key === key);
  const current = props[index];
  if (current && value !== undefined) return raw.slice(0, current.valueStart) + value + raw.slice(current.end);
  if (current) {
    if (props.length === 1) return raw.slice(0, current.start) + raw.slice(current.end);
    if (index < props.length - 1) return raw.slice(0, current.start) + raw.slice(props[index + 1].start);
    return raw.slice(0, props[index - 1].end) + raw.slice(current.end);
  }
  if (value === undefined) return raw;
  const property = `${JSON.stringify(key)}: ${value}`;
  if (prepend && props.length) return raw.slice(0, props[0].start) + property + ', ' + raw.slice(props[0].start);
  const end = raw.lastIndexOf('}');
  return raw.slice(0, end) + (props.length ? ', ' : '') + property + raw.slice(end);
}

function propertyText(raw: string, key: string): string | undefined {
  const entry = entries(raw).find(item => item.key === key);
  return entry ? raw.slice(entry.valueStart, entry.end) : undefined;
}

export function applyStructuredEdit(policy: Policy, edit: StructuredEdit): Policy {
  if (!edit.tool.trim()) throw new Error('Choose a tool category.');
  const raw = policy.value === null ? '{}' : policy.raw!;
  const current = policy.value && Object.hasOwn(policy.value, edit.tool) ? policy.value[edit.tool] : undefined;
  if (current !== undefined && !isAction(current) && !isRecord(current)) {
    throw new Error('This category contains an advanced value. Edit it in Advanced (JSON).');
  }
  if (current === undefined && (edit.kind === 'remove-pattern' || edit.kind === 'default' && edit.action === 'inherit')) return policy;
  let next: string;
  if (edit.kind === 'default') {
    if (edit.action !== 'inherit' && !isAction(edit.action)) throw new Error('Choose allow, ask, deny, or inherit.');
    if (isRecord(current)) {
      if (Object.hasOwn(current, '*') && !isAction(current['*'])) throw new Error('The default contains an advanced value. Edit it in Advanced (JSON).');
      const nested = editProperty(propertyText(raw, edit.tool)!, '*', edit.action === 'inherit' ? undefined : JSON.stringify(edit.action), true);
      next = editProperty(raw, edit.tool, nested);
    } else {
      next = editProperty(raw, edit.tool, edit.action === 'inherit' ? undefined : JSON.stringify(edit.action));
    }
  } else {
    if (!edit.pattern.trim()) throw new Error('Enter a non-empty pattern.');
    if (edit.pattern === '*') throw new Error('Use the category default control to edit the * rule.');
    const nested = isRecord(current) ? propertyText(raw, edit.tool)! : isAction(current) ? JSON.stringify({ '*': current }) : '{}';
    if (edit.kind === 'pattern' && !isAction(edit.action)) throw new Error('Choose allow, ask, or deny.');
    if (isRecord(current) && Object.hasOwn(current, edit.pattern) && !isAction(current[edit.pattern])) {
      throw new Error('This pattern contains an advanced value. Edit it in Advanced (JSON).');
    }
    // Removing the last pattern leaves an explicit object; it does not silently
    // turn an explicit policy into an inherited/null policy.
    next = editProperty(raw, edit.tool, editProperty(nested, edit.pattern, edit.kind === 'remove-pattern' ? undefined : JSON.stringify(edit.action)));
  }
  return parsePolicy(next);
}

export function permissionDefault(value: unknown): PermissionAction | 'inherit' | 'advanced' {
  if (value === undefined) return 'inherit';
  if (isAction(value)) return value;
  if (isRecord(value)) return value['*'] === undefined ? 'inherit' : isAction(value['*']) ? value['*'] : 'advanced';
  return 'advanced';
}

export type McpSelection = { raw: string | null; map: Record<string, unknown> | null; error?: string };
export function parseMcpSelection(raw: string | null | undefined): McpSelection {
  if (raw == null) return { raw: null, map: null };
  try {
    const value: unknown = JSON.parse(raw);
    if (isRecord(value)) return { raw, map: value };
    if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
      return { raw: JSON.stringify(Object.fromEntries(value.map(name => [name.trim(), []]))), map: Object.fromEntries(value.map(name => [name.trim(), []])) };
    }
  } catch { /* Keep invalid policy unchanged; never turn it into inherited access. */ }
  return { raw, map: {}, error: 'MCP selection has an unsupported format. Existing policy is preserved; tool editing is unavailable.' };
}

export function mcpGroupSelection(policy: McpSelection, server: string, catalog: string[]) {
  if (policy.map === null) return { inherited: true, selected: catalog };
  if (!Object.hasOwn(policy.map, server)) return { inherited: false, selected: [] as string[] };
  const value = policy.map[server];
  const grants = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.allowedTools) ? value.allowedTools : [];
  const selected = grants.filter((item): item is string => typeof item === 'string');
  return { inherited: selected.length === 0, selected: selected.length ? selected : catalog };
}

export function editMcpGroup(policy: McpSelection, server: string, selected: string[], catalog: Array<{ name: string; tools: string[] }>): string {
  if (policy.error) throw new Error(policy.error);
  // Editing unrestricted access explicitly narrows to the known catalog. Do not
  // materialize empty server arrays: the backend interprets those as inherit-all.
  let raw = policy.map === null
    ? JSON.stringify(Object.fromEntries(catalog.filter(item => item.tools.length).map(item => [item.name, item.tools])))
    : policy.raw!;
  const current = policy.map && Object.hasOwn(policy.map, server) ? policy.map[server] : undefined;
  const replacement = selected.length === 0 ? undefined
    : isRecord(current) ? editProperty(propertyText(raw, server)!, 'allowedTools', JSON.stringify(selected))
      : JSON.stringify(selected);
  raw = editProperty(raw, server, replacement);
  return raw;
}

export function parseSkillSelection(raw: string | null | undefined): { inherited: boolean; selected: string[]; error?: string } {
  if (raw == null) return { inherited: true, selected: [] };
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value) && value.every(item => typeof item === 'string')) return { inherited: false, selected: value };
  } catch { /* Invalid explicit data must not be displayed as inheritance. */ }
  return { inherited: false, selected: [], error: 'Skill selection has an unsupported format. Existing policy is preserved; skill editing is unavailable.' };
}
