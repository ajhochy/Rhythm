#!/usr/bin/env node
/*
 * Config Doctor — MCP tool-schema scanner.
 *
 * Enumerates every enabled MCP server in opencode.json and flags any tool whose
 * inputSchema has a TOP-LEVEL oneOf / anyOf / allOf. That is the exact shape the
 * Anthropic Messages API rejects:
 *   "tools.N.custom.input_schema: input_schema does not support oneOf, allOf, or
 *    anyOf at the top level"
 * A single offending tool 400s every model turn that loads it. (Anthropic accepts
 * NESTED combinators — e.g. a nullable field — only TOP-LEVEL is forbidden.)
 *
 * Read-only: it performs an MCP initialize -> tools/list handshake per server.
 * Exit code 1 if any offender, 3 on setup error, else 0.
 *
 * Usage: node mcp-scan.cjs
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const CONF = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode");
const CFG = path.join(CONF, "opencode.json");
const PER_SERVER_TIMEOUT = 20000;

function topCombinator(schema) {
  if (!schema || typeof schema !== "object") return null;
  for (const k of ["oneOf", "anyOf", "allOf"]) if (schema[k]) return k;
  return null;
}
const INIT = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "config-doctor", version: "1" } },
};

function scanStdio(name, command, args, env) {
  return new Promise((resolve) => {
    let done = false;
    let child;
    const finish = (r) => { if (!done) { done = true; try { child.kill(); } catch (_) {} resolve(r); } };
    try {
      child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, ...(env || {}) } });
    } catch (e) { return resolve({ name, status: "spawn-error: " + e.message, tools: [], offenders: [] }); }
    const timer = setTimeout(() => finish({ name, status: "timeout", tools: [], offenders: [] }), PER_SERVER_TIMEOUT);
    child.on("error", (e) => { clearTimeout(timer); finish({ name, status: "spawn-error: " + e.message, tools: [], offenders: [] }); });
    let buf = "";
    const send = (o) => { try { child.stdin.write(JSON.stringify(o) + "\n"); } catch (_) {} };
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        let msg; try { msg = JSON.parse(line); } catch (_) { continue; }
        if (msg.id === 1) { send({ jsonrpc: "2.0", method: "notifications/initialized" }); send({ jsonrpc: "2.0", id: 2, method: "tools/list" }); }
        else if (msg.id === 2) {
          clearTimeout(timer);
          const tools = (msg.result && msg.result.tools) || [];
          const offenders = tools.filter((t) => topCombinator(t.inputSchema)).map((t) => ({ tool: t.name, kind: topCombinator(t.inputSchema) }));
          finish({ name, status: "ok", tools: tools.map((t) => t.name), offenders });
        }
      }
    });
    send(INIT);
  });
}

async function scanHttp(name, url, headers) {
  const base = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", ...(headers || {}) };
  const parseBody = async (res) => {
    const txt = await res.text();
    if (txt.includes("data:")) {
      for (const line of txt.split(/\r?\n/)) {
        const m = line.match(/^data:\s?(.*)$/);
        if (m) { try { return JSON.parse(m[1]); } catch (_) {} }
      }
    }
    try { return JSON.parse(txt); } catch (_) { return null; }
  };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), PER_SERVER_TIMEOUT);
  try {
    let res = await fetch(url, { method: "POST", headers: base, body: JSON.stringify(INIT), signal: ctrl.signal });
    const sid = res.headers.get("mcp-session-id");
    const h2 = sid ? { ...base, "Mcp-Session-Id": sid } : base;
    await fetch(url, { method: "POST", headers: h2, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), signal: ctrl.signal }).catch(() => {});
    res = await fetch(url, { method: "POST", headers: h2, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }), signal: ctrl.signal });
    const msg = await parseBody(res);
    const tools = (msg && msg.result && msg.result.tools) || [];
    const offenders = tools.filter((t) => topCombinator(t.inputSchema)).map((t) => ({ tool: t.name, kind: topCombinator(t.inputSchema) }));
    return { name, status: tools.length ? "ok" : "no-tools", tools: tools.map((t) => t.name), offenders };
  } catch (e) {
    return { name, status: "http-error: " + (e.name === "AbortError" ? "timeout" : e.message), tools: [], offenders: [] };
  } finally { clearTimeout(to); }
}

(async () => {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(CFG, "utf8")); }
  catch (e) { console.error("cannot read " + CFG + ": " + e.message); process.exit(3); }
  const mcp = cfg.mcp || {};
  const names = Object.keys(mcp);
  if (!names.length) { console.log("no mcp servers configured in " + CFG); process.exit(0); }

  console.log("MCP tool-schema scan (" + CFG + ")\n");
  const results = [];
  for (const name of names) {
    const s = mcp[name] || {};
    if (s.enabled === false) { results.push({ name, status: "disabled", tools: [], offenders: [] }); continue; }
    const type = s.type || (s.url ? "remote" : "local");
    if (type === "remote" || type === "http" || s.url) results.push(await scanHttp(name, s.url, s.headers));
    else {
      let command, args;
      if (Array.isArray(s.command)) { command = s.command[0]; args = s.command.slice(1); }
      else { command = s.command; args = s.args || []; }
      results.push(await scanStdio(name, command, args, s.environment));
    }
  }

  let bad = 0;
  for (const r of results) {
    console.log((r.offenders.length ? "BAD  " : "ok   ") + r.name.padEnd(18) + " [" + r.status + "] tools=" + r.tools.length + (r.offenders.length ? "  <<< TOP-LEVEL COMBINATOR" : ""));
    for (const o of r.offenders) { bad++; console.log("       - " + o.tool + " : top-level " + o.kind + " (Anthropic will reject)"); }
  }
  console.log();
  if (bad) {
    console.log(">>> " + bad + " offending tool(s). Anthropic-routed sessions 400 with 'input_schema does not support oneOf/allOf/anyOf at the top level'.");
    console.log(">>> Fix (config-only): pin/downgrade that server to a good version, OR set \"enabled\": false on it in opencode.json, OR scope it out of the agent's mcpAllowlist. Then relaunch Rhythm.");
    process.exit(1);
  }
  console.log(">>> No top-level combinators — no server will trip the Anthropic tool-schema check.");
  process.exit(0);
})();
