#!/usr/bin/env node
/*
 * Config Doctor — agent-profile loader replay.
 *
 * Mirrors opencode's config/markdown.ts parse pipeline (strict gray-matter/js-yaml,
 * then a permissive fallback sanitizer) over every <config>/agents/*.md and classifies:
 *
 *   FATAL   parses, but a schema-required object field (options/permission) came out
 *           NON-object -> this THROWS in config/agent.ts and kills the ENTIRE engine
 *           config load: /opencode/mcp returns 502 and every session hangs on "Starting".
 *   SKIPPED fails YAML parse even after the fallback -> opencode silently skips the file,
 *           so that one agent is unavailable, but the runtime stays up (non-fatal).
 *   WARN    only parsed via the fallback sanitizer (a top-level colon value was turned
 *           into a block-scalar string) -> not currently broken, but fragile.
 *   OK      strict parse, types intact.
 *
 * Exit code: 1 if any FATAL, 3 on setup error, else 0. This replay is the AUTHORITATIVE
 * pre-restart check — it reflects what a fresh engine boot will parse from disk.
 *
 * Usage: node classify.cjs [agentsDir]   (default: $HOME/.config/opencode/agents)
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

function resolveYaml() {
  const candidates = [
    path.join(__dirname, "node_modules", "js-yaml"),
    "/Applications/Rhythm.app/Contents/Resources/api_server/node_modules/js-yaml",
  ];
  for (const c of candidates) {
    try { return require(c); } catch (_) {}
  }
  try { return require("js-yaml"); } catch (_) {}
  return null;
}

const yaml = resolveYaml();
if (!yaml) {
  console.error(
    "js-yaml not found. Provision it once:\n  cd " + __dirname + " && npm i js-yaml@4",
  );
  process.exit(3);
}

const dir = process.argv[2] || path.join(os.homedir(), ".config", "opencode", "agents");

function frontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : "";
}

// Faithful mirror of config/markdown.ts fallbackSanitization().
function fallbackSanitization(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return content;
  const fm = match[1];
  const lines = fm.split(/\r?\n/);
  const result = [];
  for (const line of lines) {
    if (line.trim().startsWith("#") || line.trim() === "") { result.push(line); continue; }
    if (line.match(/^\s+/)) { result.push(line); continue; }
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (!kv) { result.push(line); continue; }
    const key = kv[1];
    const value = kv[2].trim();
    if (value === "" || value === ">" || value === "|" || value.startsWith('"') || value.startsWith("'")) {
      result.push(line); continue;
    }
    if (value.includes(":")) { result.push(key + ": |-"); result.push("  " + value); continue; }
    result.push(line);
  }
  return content.replace(fm, () => result.join("\n"));
}

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

let files;
try {
  files = fs.readdirSync(dir).filter((x) => x.endsWith(".md")).sort();
} catch (e) {
  console.error("cannot read " + dir + ": " + e.message);
  process.exit(3);
}

let fatal = 0, skipped = 0, warn = 0, ok = 0;
const rows = [];
for (const f of files) {
  const c = fs.readFileSync(path.join(dir, f), "utf8");
  let data, via, perr = null;
  try { data = yaml.load(frontmatter(c), {}); via = "strict"; }
  catch (e1) {
    try { data = yaml.load(frontmatter(fallbackSanitization(c)), {}); via = "fallback"; }
    catch (e2) { via = "FAILED"; perr = e2.message.split("\n")[0]; }
  }
  let tag, detail;
  if (via === "FAILED") {
    tag = "SKIPPED"; skipped++;
    detail = "YAML parse fails -> agent silently skipped: " + perr;
  } else if (data && "options" in data && !isObj(data.options)) {
    tag = "FATAL"; fatal++;
    detail = "options is " + (Array.isArray(data.options) ? "array" : typeof data.options) + " -> KILLS the whole config load";
  } else if (data && "permission" in data && !isObj(data.permission)) {
    tag = "FATAL"; fatal++;
    detail = "permission is " + (Array.isArray(data.permission) ? "array" : typeof data.permission) + " -> KILLS the whole config load";
  } else if (via === "fallback") {
    tag = "WARN"; warn++;
    detail = "parsed only via fallback (a top-level colon value was stringified) — fragile";
  } else {
    tag = "OK"; ok++;
    detail = "options=" + (data && data.options ? "object" : "none");
  }
  rows.push({ tag, f, detail });
}

const mark = (t) => (t === "FATAL" ? "FATAL " : t === "SKIPPED" ? "SKIP  " : t === "WARN" ? "WARN  " : "OK    ");
for (const r of rows) console.log(mark(r.tag) + " " + r.f.padEnd(38) + "  " + r.detail);
console.log("\nTOTALS  FATAL=" + fatal + "  SKIPPED=" + skipped + "  WARN=" + warn + "  OK=" + ok);
if (fatal > 0) {
  console.log('\n>>> FATAL present: the engine config load will THROW -> 502 on /opencode/mcp, sessions stuck on "Starting". Fix the FATAL file(s), then relaunch Rhythm.');
  process.exit(1);
}
console.log("\n>>> No FATAL files. A relaunch will boot with a healthy config load.");
process.exit(0);
