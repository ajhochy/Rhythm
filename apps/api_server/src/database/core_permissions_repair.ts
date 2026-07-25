/**
 * #1138 follow-up — one-time data repair for the LEGACY numbered-key
 * corePermissionsJson shape.
 *
 * The old Tool Permissions panel persisted an indexed-list shape:
 *   {"0":{"permission":"*","pattern":"*","action":"allow"},
 *    "1":{"permission":"doom_loop","pattern":"*","action":"ask"}, ...}
 * The projector (opencode_agent_writer.ts parseCorePermissions, hardened by
 * #1149) expects the FLAT map {"read":"allow","bash":{"pattern":"action"}}
 * and now SKIPS malformed entries — so legacy rows' permissions are silently
 * never applied and the Flutter Tool Permissions matrix renders junk "0"/"1"
 * rows. Current code no longer writes the bad shape; this converter repairs
 * the stale rows already sitting in real local DBs.
 *
 * Shared by the SQLite one-time repair (migrations.ts, runOnce-guarded) and
 * its Postgres twin (postgres_bootstrap.ts, schema_meta-marker-guarded).
 */

const VALID_ACTIONS = new Set(['allow', 'ask', 'deny']);

interface NumberedEntry {
  permission: string;
  action: string;
  pattern?: string;
}

/**
 * True iff `parsed` is the legacy numbered-override map: a plain non-empty
 * object whose EVERY key is all-digits and whose EVERY value is an object
 * with string `permission`/`action` (and an optional string `pattern`).
 * Anything else — the correct flat shape included — is not ours to touch.
 */
function isLegacyNumberedMap(parsed: unknown): parsed is Record<string, NumberedEntry> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every(([key, value]) => {
    if (!/^\d+$/.test(key)) return false;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const entry = value as Record<string, unknown>;
    return (
      typeof entry.permission === 'string' &&
      typeof entry.action === 'string' &&
      (entry.pattern === undefined || typeof entry.pattern === 'string')
    );
  });
}

/**
 * Convert a raw core_permissions_json value from the legacy numbered shape to
 * the flat {permission: action | {pattern: action}} map.
 *
 * Returns:
 *  - `undefined` — row is NOT the legacy shape (flat map, malformed JSON,
 *    array, empty, NULL, …): leave the stored value byte-for-byte untouched.
 *  - `null`      — legacy shape but every entry was invalid: clear to NULL.
 *  - `string`    — the repaired flat-map JSON to store.
 */
export function convertLegacyNumberedCorePermissions(
  raw: string | null,
): string | null | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isLegacyNumberedMap(parsed)) return undefined;

  // perm → (pattern → action); insertion order by numeric key, duplicate
  // perm+pattern pairs merge with last-write-wins.
  const byPerm = new Map<string, Map<string, string>>();
  const orderedKeys = Object.keys(parsed).sort((a, b) => Number(a) - Number(b));
  for (const key of orderedKeys) {
    const entry = parsed[key];
    const perm = entry.permission.trim();
    const action = entry.action;
    if (!perm || !VALID_ACTIONS.has(action)) continue; // skip invalid entries
    const pattern = entry.pattern ?? '*';
    let patterns = byPerm.get(perm);
    if (!patterns) {
      patterns = new Map<string, string>();
      byPerm.set(perm, patterns);
    }
    patterns.set(pattern, action);
  }

  if (byPerm.size === 0) return null;

  const flat: Record<string, string | Record<string, string>> = {};
  for (const [perm, patterns] of byPerm) {
    if (patterns.size === 1 && patterns.has('*')) {
      flat[perm] = patterns.get('*')!;
    } else {
      flat[perm] = Object.fromEntries(patterns);
    }
  }
  return JSON.stringify(flat);
}
