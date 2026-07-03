/**
 * skill_frontmatter.ts — #874/#875/#876 shared extended-frontmatter parser.
 *
 * The opencode fork's own SKILL.md loader (apps/opencode_fork/.../skill/index.ts)
 * only ever extracts `name` + `description` from frontmatter (see
 * `isSkillFrontmatter`) — everything else in the YAML block is opaque to it, but
 * the fork's `Skill.Info` schema DOES carry the full raw `content` (frontmatter +
 * body) through `GET /skill` / `POST /skill/reload`. That raw content is what
 * this module parses, entirely on the api_server side, so Rhythm can read the
 * extra fields these three issues add WITHOUT touching the vendored fork:
 *
 *   - #874 `required_env`         — env vars a skill needs to run
 *   - #875 `requires_toolsets` / `fallback_for_toolsets` (under `metadata.rhythm`)
 *   - #876 `python_dependencies`  — PyPI packages to lazy-install on first use
 *
 * This is intentionally a hand-rolled, indentation-based YAML-subset parser
 * (no new dependency) — SKILL.md frontmatter is simple, flat/nested-list YAML
 * that Rhythm itself writes for managed skills via `renderSkillMarkdown`, so a
 * full YAML implementation is unnecessary. Unknown/unparseable frontmatter
 * shapes degrade to "no extended fields" rather than throwing — a skill that
 * doesn't declare any of these fields must behave exactly as before.
 */

export interface RequiredEnvVar {
  name: string;
  prompt?: string;
  help?: string;
}

export interface PythonDependency {
  package: string;
  version?: string;
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  /** #874 — env vars the skill needs; [] when the field is absent. */
  requiredEnv: RequiredEnvVar[];
  /** #875 — toolsets that must be connected for the skill to be visible. */
  requiresToolsets: string[];
  /** #875 — toolsets whose ABSENCE is required for the skill to be visible. */
  fallbackForToolsets: string[];
  /** #876 — PyPI packages to lazy-install on first use. */
  pythonDependencies: PythonDependency[];
}

const EMPTY_FRONTMATTER: SkillFrontmatter = {
  requiredEnv: [],
  requiresToolsets: [],
  fallbackForToolsets: [],
  pythonDependencies: [],
};

/** Split a SKILL.md's leading `---\n...\n---` block from the body. Returns null if absent. */
function extractFrontmatterBlock(content: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  return match ? match[1] : null;
}

/** Strip a single layer of matching quotes (' or ") from a scalar value. */
function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    const inner = v.slice(1, -1);
    return v[0] === '"' ? inner.replace(/\\"/g, '"') : inner;
  }
  return v;
}

/** Parse an inline flow-style list `[a, b, c]` into trimmed/unquoted strings. */
function parseInlineList(value: string): string[] {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (inner.trim() === '') return [];
  return inner
    .split(',')
    .map((s) => unquote(s.trim()))
    .filter((s) => s.length > 0);
}

function indentOf(line: string): number {
  const m = /^(\s*)/.exec(line);
  return m ? m[1].length : 0;
}

/**
 * Parse the `required_environment_variables` (#874) list block. Each entry is
 * a `- name: X` mapping, optionally followed by indented `prompt:`/`help:`
 * lines. Malformed/entry-less blocks yield [] rather than throwing.
 */
function parseRequiredEnvBlock(lines: string[], startIdx: number, baseIndent: number): RequiredEnvVar[] {
  const out: RequiredEnvVar[] = [];
  let i = startIdx;
  let current: RequiredEnvVar | null = null;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    const indent = indentOf(line);
    if (indent <= baseIndent) break; // dedent out of the list block

    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      if (current && current.name) out.push(current);
      current = { name: '' };
      const rest = trimmed.slice(2).trim();
      const kv = /^([a-zA-Z0-9_]+):\s*(.*)$/.exec(rest);
      if (kv) {
        applyEnvField(current, kv[1], kv[2]);
      }
    } else if (current) {
      const kv = /^([a-zA-Z0-9_]+):\s*(.*)$/.exec(trimmed);
      if (kv) applyEnvField(current, kv[1], kv[2]);
    }
    i++;
  }
  if (current && current.name) out.push(current);
  return out;
}

function applyEnvField(target: RequiredEnvVar, key: string, rawValue: string): void {
  const value = unquote(rawValue);
  if (key === 'name') target.name = value;
  else if (key === 'prompt') target.prompt = value;
  else if (key === 'help') target.help = value;
}

/**
 * Parse the `python_dependencies` (#876) list block. Each entry is a
 * `- package: X` mapping, optionally followed by an indented `version:` line.
 */
function parsePythonDependenciesBlock(
  lines: string[],
  startIdx: number,
  baseIndent: number,
): PythonDependency[] {
  const out: PythonDependency[] = [];
  let i = startIdx;
  let current: PythonDependency | null = null;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    const indent = indentOf(line);
    if (indent <= baseIndent) break;

    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      if (current && current.package) out.push(current);
      current = { package: '' };
      const rest = trimmed.slice(2).trim();
      const kv = /^([a-zA-Z0-9_]+):\s*(.*)$/.exec(rest);
      if (kv) applyDepField(current, kv[1], kv[2]);
    } else if (current) {
      const kv = /^([a-zA-Z0-9_]+):\s*(.*)$/.exec(trimmed);
      if (kv) applyDepField(current, kv[1], kv[2]);
    }
    i++;
  }
  if (current && current.package) out.push(current);
  return out;
}

function applyDepField(target: PythonDependency, key: string, rawValue: string): void {
  const value = unquote(rawValue);
  if (key === 'package') target.package = value;
  else if (key === 'version') target.version = value;
}

/**
 * Parse the `metadata: \n  rhythm: \n    requires_toolsets: [...]` (#875)
 * nested block starting at the `metadata:` line. Tolerates the fields being
 * inline flow lists or (for forward-compat) block lists.
 */
function parseMetadataRhythmBlock(
  lines: string[],
  startIdx: number,
  baseIndent: number,
): { requiresToolsets: string[]; fallbackForToolsets: string[] } {
  const result = { requiresToolsets: [] as string[], fallbackForToolsets: [] as string[] };
  let i = startIdx;
  let inRhythm = false;
  let rhythmIndent = -1;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    const indent = indentOf(line);
    if (indent <= baseIndent) break;

    const trimmed = line.trim();
    if (!inRhythm) {
      if (/^rhythm:\s*$/.test(trimmed)) {
        inRhythm = true;
        rhythmIndent = indent;
      }
      i++;
      continue;
    }
    // Inside `rhythm:` — a dedent back to/below rhythmIndent ends the block.
    if (indent <= rhythmIndent) break;

    const inlineMatch = /^(requires_toolsets|fallback_for_toolsets):\s*(\[.*\])\s*$/.exec(trimmed);
    if (inlineMatch) {
      const list = parseInlineList(inlineMatch[2]);
      if (inlineMatch[1] === 'requires_toolsets') result.requiresToolsets = list;
      else result.fallbackForToolsets = list;
    } else {
      const blockHeaderMatch = /^(requires_toolsets|fallback_for_toolsets):\s*$/.exec(trimmed);
      if (blockHeaderMatch) {
        const list = parseSimpleBlockList(lines, i + 1, indent);
        if (blockHeaderMatch[1] === 'requires_toolsets') result.requiresToolsets = list;
        else result.fallbackForToolsets = list;
      }
    }
    i++;
  }
  return result;
}

/** Parse a plain `- item` block list of scalar strings. */
function parseSimpleBlockList(lines: string[], startIdx: number, baseIndent: number): string[] {
  const out: string[] = [];
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    const indent = indentOf(line);
    if (indent <= baseIndent) break;
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      out.push(unquote(trimmed.slice(2).trim()));
    }
    i++;
  }
  return out;
}

/**
 * Parse a SKILL.md's frontmatter, extracting the fields #874/#875/#876 care
 * about. Never throws — any parse failure yields {@link EMPTY_FRONTMATTER}
 * (with `name`/`description` best-effort filled if a simple scalar match is
 * found), which is exactly the "behaves as before" regression contract each
 * issue requires for skills that don't declare these fields.
 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter {
  try {
    const block = extractFrontmatterBlock(content ?? '');
    if (block === null) return { ...EMPTY_FRONTMATTER };

    const lines = block.split(/\r?\n/);
    const result: SkillFrontmatter = {
      requiredEnv: [],
      requiresToolsets: [],
      fallbackForToolsets: [],
      pythonDependencies: [],
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '' || indentOf(line) > 0) continue; // only top-level keys here
      const trimmed = line.trim();

      const scalarMatch = /^(name|description):\s*(.*)$/.exec(trimmed);
      if (scalarMatch) {
        const value = unquote(scalarMatch[2]);
        if (scalarMatch[1] === 'name') result.name = value;
        else result.description = value;
        continue;
      }

      const inlineEnvMatch = /^required_environment_variables:\s*(\[.*\])\s*$/.exec(trimmed);
      if (inlineEnvMatch) {
        // Inline flow-list of bare names (rare, but tolerate it): treat each
        // entry as { name }.
        result.requiredEnv = parseInlineList(inlineEnvMatch[1]).map((name) => ({ name }));
        continue;
      }
      if (/^required_environment_variables:\s*$/.test(trimmed)) {
        result.requiredEnv = parseRequiredEnvBlock(lines, i + 1, 0);
        continue;
      }

      const inlineDepsMatch = /^python_dependencies:\s*(\[.*\])\s*$/.exec(trimmed);
      if (inlineDepsMatch) {
        result.pythonDependencies = parseInlineList(inlineDepsMatch[1]).map((pkg) => ({ package: pkg }));
        continue;
      }
      if (/^python_dependencies:\s*$/.test(trimmed)) {
        result.pythonDependencies = parsePythonDependenciesBlock(lines, i + 1, 0);
        continue;
      }

      if (/^metadata:\s*$/.test(trimmed)) {
        const { requiresToolsets, fallbackForToolsets } = parseMetadataRhythmBlock(lines, i + 1, 0);
        result.requiresToolsets = requiresToolsets;
        result.fallbackForToolsets = fallbackForToolsets;
        continue;
      }
    }

    return result;
  } catch {
    return { ...EMPTY_FRONTMATTER };
  }
}
