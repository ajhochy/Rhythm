import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * MCP-2 — Curated MCP server registry.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CONTRACT (#787): this catalog is an INSTALL-TEMPLATE + ENRICHMENT layer ONLY.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The single source of truth for "what MCP servers exist" is the LIVE ENGINE
 * list — `GET /opencode/mcp` (backed by `opencodeClient.listMcp()`, the
 * opencode engine's own MCP status map). Display/listing of MCP servers MUST
 * always come from that live list, NEVER from this catalog.
 *
 * `CURATED_MCP_SERVERS` is the curated set of servers Rhythm offers to install,
 * and it MATERIALIZES INTO the engine — it does not stand alongside it as a
 * second display source. Curated entries become real engine servers via
 * `ensureCuratedMcps()` in opencode_client_service.ts, which idempotently
 * merges this list into opencode.json's `mcp` block (add missing, refresh
 * changed, no-op identical) and live-registers them. This is
 * materialize-on-install, mirroring how published DB skills materialize into
 * the engine's file store on publish (materialize-on-publish — see
 * docs/ai/decisions/2026-06-28-unify-skills-source-of-truth.md and
 * 2026-06-28-unify-mcp-source-of-truth.md).
 *
 * The ONLY sanctioned consumers of this catalog are template + enrichment:
 *   - `ensureCuratedMcps()` — materialize-on-install (write into the engine).
 *   - GET /opencode/mcp — enriches each LIVE engine entry with `requiredEnv`
 *     (via `findCuratedServer`); the entry LIST itself comes from the engine.
 *   - POST /:name/credentials — validates typed secrets against `requiredEnv`
 *     and builds the install config from the curated definition.
 *   - `resolveRemoteServerUrl` (OAuth start) — resolves a remote server's URL.
 *
 * DO NOT return `CURATED_MCP_SERVERS` (or any map/filter/derivative of it) as a
 * standalone display/listing payload from any route. Doing so re-introduces the
 * parallel "what servers exist" list that drifts from the engine — exactly the
 * drift this contract (and the guard in
 * src/__tests__/curated_mcp_no_display.test.ts) exists to prevent. Add server
 * definitions here when offering a new install; never wire a new read path that
 * surfaces this list to clients.
 *
 * `ensureCuratedMcps()` idempotently merges this list into the
 * `mcp` block (add missing, refresh changed, no-op identical).
 *
 * Verified catalog (2026-06-17) — pinned to packages whose existence + env
 * requirements were confirmed via npm + official docs:
 *   - pdf-tools  (local, zero-auth)  @modelcontextprotocol/server-pdf@1.7.4
 *   - canva      (remote, OAuth/DCR) https://mcp.canva.com/mcp        (official)
 *   - notion     (remote, OAuth/DCR) https://mcp.notion.com/mcp       (official)
 *   - stripe     (local, API key)    @stripe/mcp@0.3.3
 *   - mailchimp  (local, API key)    @agentx-ai/mailchimp-mcp-server@1.1.1
 *
 * DROPPED (no installable npm package; already brokered by the rhythm MCP):
 *   - google-workspace — @modelcontextprotocol/server-google-workspace does
 *     not exist on npm; the rhythm MCP brokers Gmail + Calendar (F3).
 *   - planning-center  — no installable PCO MCP package exists; the rhythm MCP
 *     brokers PCO (F4).
 *
 * NOTE: with google/pco dropped, NO curated entry sets `tokenProvider`, so the
 * OAuth token-bridge in `ensureCuratedMcps()` currently has no curated
 * consumer. The bridge mechanism + its types are intentionally left in place
 * (covered by a synthetic fixture in opc_curated_mcp_token_bridge.test.ts) for
 * future bridged servers.
 *
 * See docs/ai/decisions.md for per-server rationale, pins, and credential
 * approach.
 */

/**
 * MCP-6 — the Rhythm integration provider whose fresh OAuth access token is
 * injected into a curated server's `environment` at ensure time. This is the
 * key the token bridge in `ensureCuratedMcps()` keys off of; it is NOT
 * persisted into opencode.json (only `id/name/type/command|url/environment`
 * are). See `CuratedMcpServer.tokenProvider` / `.tokenEnvKey`.
 */
export type CuratedTokenProvider = "google" | "pco";

/**
 * A curated MCP server definition.
 *
 * - `type: 'local'`  → stdio server launched via `command` (argv array).
 * - `type: 'remote'` → HTTP server reachable at `url`.
 *
 * `requiredEnv` lists the environment variable names the server needs to
 * function. For zero-auth servers this is `[]`. The MCP-7 work uses it to
 * drive the "needs credentials" UI; MCP-2 only needs the empty case.
 */
export interface CuratedMcpServer {
  /** Stable identifier used as the key in opencode.json's `mcp` block. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Transport kind. */
  type: "local" | "remote";
  /** argv for local stdio servers (required when type === 'local'). */
  command?: string[];
  /** endpoint for remote servers (required when type === 'remote'). */
  url?: string;
  /** Environment variables persisted into the opencode.json entry. */
  environment?: Record<string, string>;
  /** Names of env vars the server requires; `[]` for zero-auth servers. */
  requiredEnv: string[];
  /**
   * MCP-6 — when set, this server's credential is bridged from Rhythm's stored
   * OAuth tokens. At ensure time `ensureCuratedMcps()` reads a FRESH access
   * token for this provider (via the existing `ensureFresh*Account` refresh
   * path) and injects it into `environment[tokenEnvKey]`. When no account is
   * connected (no row / no token), the server is SKIPPED entirely — it is never
   * written with an empty placeholder token. Omit for zero-auth servers.
   */
  tokenProvider?: CuratedTokenProvider;
  /**
   * MCP-6 — the `environment` key the bridged fresh access token is injected
   * into. Required when `tokenProvider` is set; ignored otherwise. This key is
   * also listed in `requiredEnv`.
   */
  tokenEnvKey?: string;
}

export interface CuratedMcpLoaderDeps {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: "utf8") => string;
  warn: (message: string) => void;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isCuratedMcpServer(value: unknown): value is CuratedMcpServer {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const server = value as Record<string, unknown>;
  const hasCommonFields =
    typeof server.id === "string" &&
    server.id.length > 0 &&
    typeof server.name === "string" &&
    server.name.length > 0 &&
    Array.isArray(server.requiredEnv) &&
    server.requiredEnv.every((entry) => typeof entry === "string") &&
    (server.environment === undefined || isStringRecord(server.environment)) &&
    (server.tokenProvider === undefined ||
      server.tokenProvider === "google" ||
      server.tokenProvider === "pco") &&
    (server.tokenEnvKey === undefined ||
      typeof server.tokenEnvKey === "string");

  if (!hasCommonFields) return false;

  if (server.type === "local") {
    return (
      Array.isArray(server.command) &&
      server.command.length > 0 &&
      server.command.every(
        (entry) => typeof entry === "string" && entry.length > 0,
      )
    );
  }

  return (
    server.type === "remote" &&
    typeof server.url === "string" &&
    server.url.length > 0
  );
}

const DEFAULT_LOCAL_LOADER_DEPS: CuratedMcpLoaderDeps = {
  existsSync: nodeExistsSync,
  readFileSync: nodeReadFileSync,
  warn: (message) => console.warn(message),
};

export function resolveLocalCuratedMcpServersPath(
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  } = {
    cwd: process.cwd(),
    env: process.env,
  },
): string {
  const override = options.env.RHYTHM_LOCAL_MCP_SERVERS_PATH?.trim();
  return (
    override ||
    join(options.cwd, "src", "config", "curated_mcp_servers.local.json")
  );
}

export function loadLocalCuratedMcpServers(
  path = resolveLocalCuratedMcpServersPath(),
  deps: CuratedMcpLoaderDeps = DEFAULT_LOCAL_LOADER_DEPS,
): CuratedMcpServer[] {
  if (!deps.existsSync(path)) return [];

  try {
    const parsed: unknown = JSON.parse(deps.readFileSync(path, "utf8"));
    if (!Array.isArray(parsed) || !parsed.every(isCuratedMcpServer)) {
      throw new Error("expected an array of valid MCP server definitions");
    }
    return parsed;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    deps.warn(
      `[curated_mcp_servers] Ignoring invalid local sidecar ${path}: ${detail}`,
    );
    return [];
  }
}

export const CURATED_MCP_SERVERS: CuratedMcpServer[] = [
  {
    id: "pdf-tools",
    name: "PDF Tools",
    type: "local",
    // Verified: @modelcontextprotocol/server-pdf@1.7.4. The package DEFAULTS to
    // an HTTP transport, so the MCP stdio handshake requires `--stdio` (its
    // absence was the prior "Connection closed"). `--silent` keeps npx noise off
    // the stdio channel. Zero-auth → requiredEnv: [] (never gated by the
    // needs-credentials UI).
    command: [
      "npx",
      "-y",
      "--silent",
      "@modelcontextprotocol/server-pdf",
      "--stdio",
    ],
    requiredEnv: [],
  },
  {
    id: "canva",
    name: "Canva",
    type: "remote",
    // Verified official Canva hosted MCP (OAuth/DCR on first use by opencode —
    // no API key, hence requiredEnv: []).
    url: "https://mcp.canva.com/mcp",
    requiredEnv: [],
  },
  {
    id: "comfyui-mcp",
    name: "ComfyUI",
    type: "local",
    command: [
      process.execPath,
      join(
        homedir(),
        "Library",
        "Application Support",
        "Rhythm",
        "creative-tools",
        "comfyui",
        "mcp",
        "node_modules",
        "@peleke.s",
        "comfyui-mcp",
        "dist",
        "index.js",
      ),
    ],
    environment: { COMFYUI_URL: "http://127.0.0.1:8188" },
    requiredEnv: [],
  },
  {
    id: "blender-mcp",
    name: "Blender",
    type: "local",
    command: [
      join(
        homedir(),
        "Library",
        "Application Support",
        "Rhythm",
        "creative-tools",
        "blender",
        ".venv",
        "bin",
        "blender-mcp",
      ),
    ],
    environment: {
      DISABLE_TELEMETRY: "true",
      BLENDER_HOST: "127.0.0.1",
      BLENDER_PORT: "9876",
    },
    requiredEnv: [],
  },
  {
    id: "openmontage",
    name: "OpenMontage",
    type: "local",
    command: [
      join(
        homedir(),
        "Library",
        "Application Support",
        "Rhythm",
        "creative-tools",
        "openmontage",
        "openmontage-mcp",
        "openmontage_mcp_server.py",
      ),
    ],
    environment: {
      OPENMONTAGE_ROOT: join(
        homedir(),
        "Library",
        "Application Support",
        "Rhythm",
        "creative-tools",
        "openmontage",
      ),
    },
    requiredEnv: [],
  },
  {
    id: "obsidian",
    name: "Obsidian",
    type: "local",
    command: [
      join(
        homedir(),
        "Library",
        "Application Support",
        "Rhythm",
        "creative-tools",
        "obsidian",
        ".venv",
        "bin",
        "mcp-obsidian",
      ),
    ],
    environment: {
      OBSIDIAN_HOST: "127.0.0.1",
      OBSIDIAN_PORT: "27123",
    },
    requiredEnv: ["OBSIDIAN_API_KEY"],
  },
  {
    id: "notion",
    name: "Notion",
    type: "remote",
    // Verified official Notion hosted MCP (OAuth/DCR on first use by opencode).
    url: "https://mcp.notion.com/mcp",
    requiredEnv: [],
  },
  {
    id: "stripe",
    name: "Stripe",
    type: "local",
    // Verified: @stripe/mcp@0.3.3. Reads its restricted secret key from
    // STRIPE_SECRET_KEY in the environment (alternatively `--api-key=`);
    // supplied via the needs-credentials secrets UI.
    command: ["npx", "-y", "@stripe/mcp", "--tools=all"],
    requiredEnv: ["STRIPE_SECRET_KEY"],
  },
  {
    id: "mailchimp",
    name: "Mailchimp",
    type: "local",
    // Verified: @agentx-ai/mailchimp-mcp-server@1.1.1. Reads MAILCHIMP_API_KEY
    // from the environment; the key MUST include its data-center suffix
    // (e.g. `<key>-us21`), so no separate server-prefix env var is needed.
    // Supplied via the needs-credentials secrets UI.
    command: ["npx", "-y", "@agentx-ai/mailchimp-mcp-server"],
    requiredEnv: ["MAILCHIMP_API_KEY"],
  },
  ...loadLocalCuratedMcpServers(),
];
