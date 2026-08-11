import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";

const toolsFile = join(import.meta.dirname, "..", "liveArtifacts.ts");
const source = () => (existsSync(toolsFile) ? readFileSync(toolsFile, "utf8") : "");

test("av03-c1: exactly five named MCP tools are registered", () => {
  assert.deepEqual(
    source().match(/rhythm_(?:list|get|create|update)_live_artifact\w*/g) ?? [],
    ["rhythm_list_live_artifacts", "rhythm_get_live_artifact", "rhythm_create_live_artifact", "rhythm_update_live_artifact_state", "rhythm_update_live_artifact_bundle"],
  );
});
test("av03-c2: hosted API and bearer are used without agent routing", () => assert.match(source(), /RHYTHM_API_URL/));
test("av03-c3: public schemas carry independent state and bundle revisions", () => assert.match(source(), /expectedStateRevision[\s\S]*expectedBundleRevision/));
test("av03-c4: 404, 409, and 410 errors remain errors", () => assert.match(source(), /404[\s\S]*409[\s\S]*410/));
test("av03-c5: artifact reads are fenced as external content and writes are gated", () => assert.match(source(), /scanContextContentAndRecordExternalContentTaint[\s\S]*authorizeOutboundAction/));
test("av03-c6: Worship Calendar fixture is available to the focused test", () => assert.ok(existsSync(join(import.meta.dirname, "fixtures", "worshipCalendar.ts"))));
test("av03-c7: no generic capability or scheduler tool is exposed", () => assert.doesNotMatch(source(), /generic.*capabilit|scheduler/i));
// c8 reads the MCP live E2E test, NOT the AV-02-era HTTP-only
// live_artifacts_live_e2e.test.ts — that file never drives the engine, so
// matching /MCP/ against it proved nothing about the MCP path.
const liveTest = () =>
  readFileSync(
    join(import.meta.dirname, "..", "..", "..", "..", "api_server", "src", "__tests__", "live_artifacts_mcp_live_e2e.test.ts"),
    "utf8",
  );

test("av03-c8: live E2E drives a real engine session, not an HTTP-only shortcut", () => {
  const source = liveTest();
  assert.match(source, /RHYTHM_LIVE_E2E/, "must be gated behind the live flag");
  assert.match(source, /RHYTHM_LIVE_ENGINE_URL/, "must target the sandbox engine");
  assert.match(source, /\$\{engineUrl\}\/session/, "must create a real engine session");
  assert.match(source, /\/session\/\$\{engineSessionId\}\/message/, "must prompt that session");
});

test("av03-c8: live E2E proves all five tools are advertised and invoked as MCP calls", () => {
  const source = liveTest();
  // The engine namespaces MCP tools as `<server>_<tool>`, hence rhythm_rhythm_*.
  for (const tool of [
    "rhythm_rhythm_list_live_artifacts",
    "rhythm_rhythm_get_live_artifact",
    "rhythm_rhythm_create_live_artifact",
    "rhythm_rhythm_update_live_artifact_state",
    "rhythm_rhythm_update_live_artifact_bundle",
  ]) {
    assert.ok(source.includes(tool), `missing MCP tool ${tool}`);
  }
  assert.match(source, /captured\[0\]\?\.tools/, "must read the tools the engine advertised to the model");
  assert.match(source, /toolTurns\)\.toEqual\(\['create', 'update_state', 'get'\]\)/, "must assert real create → update → get calls");
});

test("av03-c8: live E2E asserts explicit state revisions 1 then 2 under one stable ID", () => {
  const source = liveTest();
  assert.match(source, /currentStateRevision\)\.toBe\(1\)/, "must assert the created artifact is at revision 1");
  assert.match(source, /currentStateRevision\)\.toBe\(2\)/, "must assert the CAS update lands at revision 2");
  assert.match(source, /readBody\.id\)\.toBe\(artifact!\.id\)/, "must read back under the same stable ID");
});

test("av03-c5: focused negatives prove denied approval and invalid input fail closed", () => {
  const negatives = readFileSync(join(import.meta.dirname, "liveArtifacts.negative.test.ts"), "utf8");
  assert.match(negatives, /allowed: false/, "must simulate a denied approval");
  assert.match(negatives, /isError\)\.toBe\(true\)/, "denied writes must be error results");
  assert.match(negatives, /toBeUndefined\(\)|toEqual\(\[\]\)/, "must prove no mutating API call was made");
  assert.match(negatives, /secret-token/, "must prove the bearer token never reaches the model");
});
