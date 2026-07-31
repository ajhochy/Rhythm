import { realpathSync } from 'node:fs';

export const RHYTHM_MANAGED_PLUGIN_NAMES = [
  'rhythm-anthropic-accounts',
  'rhythm-telemetry',
  'rhythm-session-context',
] as const;

export type RhythmManagedPluginName =
  (typeof RHYTHM_MANAGED_PLUGIN_NAMES)[number];

export type ManagedPluginPaths = Partial<
  Record<RhythmManagedPluginName, string | null>
>;

const MANAGED_PATH_MARKER = 'opencode_plugins';
const MANAGED_IDENTITY_PREFIX = 'rhythm-managed:';

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function managedNameFromMarkedPath(
  entry: string,
): RhythmManagedPluginName | null {
  const segments = entry.split(/[\\/]+/).filter(Boolean);
  const name = segments.at(-1);
  const marker = segments.at(-2);
  if (
    marker !== MANAGED_PATH_MARKER ||
    !RHYTHM_MANAGED_PLUGIN_NAMES.includes(
      name as RhythmManagedPluginName,
    )
  ) {
    return null;
  }
  return name as RhythmManagedPluginName;
}

/**
 * Return a checkout-independent identity only for entries positively known
 * to be Rhythm-managed:
 *
 * - the reserved managed plugin name itself;
 * - a path under the reserved `opencode_plugins/<managed-name>` marker,
 *   including a deleted/stale worktree path that can no longer be realpathed;
 * - any existing path/symlink whose realpath is the active managed plugin.
 *
 * A same-named directory outside the reserved marker is deliberately not
 * classified as managed unless it resolves to the active plugin. That
 * conservative boundary prevents cleanup from deleting user-authored local
 * plugins.
 */
export function canonicalManagedPluginIdentity(
  entry: string,
  activePaths: ManagedPluginPaths,
): string | null {
  if (
    RHYTHM_MANAGED_PLUGIN_NAMES.includes(entry as RhythmManagedPluginName)
  ) {
    return `${MANAGED_IDENTITY_PREFIX}${entry}`;
  }

  const markedName = managedNameFromMarkedPath(entry);
  if (markedName) {
    return `${MANAGED_IDENTITY_PREFIX}${markedName}`;
  }

  const entryRealpath = safeRealpath(entry);
  if (!entryRealpath) return null;

  for (const name of RHYTHM_MANAGED_PLUGIN_NAMES) {
    const activePath = activePaths[name];
    if (activePath && safeRealpath(activePath) === entryRealpath) {
      return `${MANAGED_IDENTITY_PREFIX}${name}`;
    }
  }
  return null;
}
