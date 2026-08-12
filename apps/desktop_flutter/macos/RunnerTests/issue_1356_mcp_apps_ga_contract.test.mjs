import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const readPending = (path) => {
  try { return read(path); }
  catch { return ''; }
};

const swiftPolicy = read('apps/desktop_flutter/macos/Runner/McpAppHostPolicy.swift');
const dartPolicy = read('apps/desktop_flutter/lib/features/agents/mcp_apps/mcp_app_host_policy.dart');
const forkMcp = read('apps/opencode_fork/packages/opencode/src/mcp/index.ts');
const executionGate = read('apps/opencode_fork/packages/opencode/src/session/mcp-app-execution.ts');
const contextPolicy = readPending('apps/desktop_flutter/lib/features/agents/mcp_apps/mcp_app_context_policy.dart');
const matrix = JSON.parse(read('apps/desktop_flutter/macos/RunnerTests/fixtures/mcp_apps_malicious_matrix.json'));

const maliciousMatrix = [
  ['scripts', /script-src/],
  ['localhost/private networking', /localhost|127\.0\.0\.1|privateNetwork/],
  ['navigation', /allowsNavigation/],
  ['external links', /allowsExternalLink|openExternalLink/],
  ['storage', /nonPersistent/],
  ['oversized messages', /maxMessageBytes/],
  ['flooded messages', /maxMessagesPerSecond|messageRate/],
  ['stale nonces', /invalid_nonce/],
  ['proof replay', /proof replay|proofReplay|replayedProof/i],
  ['device permissions', /camera|microphone|geolocation|mediaCapture/],
  ['teardown abuse', /teardown|closedView/],
];

test('issue-1356-c1: malicious fixture matrix fails closed for every named attack', () => {
  // Regression caught: a newly exposed browser capability has no adversarial fixture.
  const securitySources = `${swiftPolicy}\n${dartPolicy}\n${executionGate}\n${JSON.stringify(matrix)}`;
  for (const [attack, evidence] of maliciousMatrix) {
    assert.match(securitySources, evidence, `missing fail-closed fixture/policy for ${attack}`);
  }
  assert.equal(matrix.length, 14);
  assert.ok(matrix.every((item) => item.expected && !/allow/i.test(item.expected)));
  assert.match(executionGate, /consumed\.add\(payload\.nonce\)[\s\S]*deps\.execute/);
});

test('issue-1356-c2: context updates require confirmation, bounds, scanning, taint records, and untrusted fencing', () => {
  // Regression caught: app text can enter trusted context without an explicit consent/security chain.
  for (const token of ['confirmed', 'maxContextBytes', 'scan', 'taint', 'untrusted']) {
    assert.match(contextPolicy, new RegExp(token, 'i'), `context policy omits ${token}`);
  }
  assert.match(contextPolicy, /RHYTHM_MCP_APPS_MODE|interactive/);
  assert.match(contextPolicy, /confirmation_required/);
  assert.match(contextPolicy, /external_untrusted/);
});

test('issue-1356-c3: packaged macOS source enforces CSP, network denial, and ephemeral storage', () => {
  // Regression caught: debug fixtures stay safe while the Runner target omits the production policy.
  const project = read('apps/desktop_flutter/macos/Runner.xcodeproj/project.pbxproj');
  assert.match(project, /McpAppHostPolicy\.swift in Sources/);
  assert.match(swiftPolicy, /Content-Security-Policy/);
  assert.match(swiftPolicy, /connect-src 'none'/);
  assert.match(swiftPolicy, /WKWebsiteDataStore\.nonPersistent\(\)/);
  assert.match(swiftPolicy, /allowsNetworkRequest[\s\S]*false/);
});

test('issue-1356-c4: exact three modes default off across fork and desktop', () => {
  // Regression caught: one layer treats an invalid/missing value as enabled and defeats rollback.
  for (const source of [swiftPolicy, dartPolicy, forkMcp]) {
    for (const mode of ['off', 'readonly', 'interactive']) assert.match(source, new RegExp(`\\b${mode}\\b`));
  }
  assert.match(swiftPolicy, /guard let raw[\s\S]*return \.off/);
  assert.match(dartPolicy, /(?:return McpAppHostMode\.off|_\s*=>\s*off)/);
  assert.match(forkMcp, /return "off"/);
});

test('issue-1356-c5: architecture, methods, operations, troubleshooting, and manual smoke are documented', () => {
  // Regression caught: operators cannot safely enable, diagnose, or roll back packaged MCP Apps.
  const guide = readPending('docs/ai/mcp-apps.md');
  for (const heading of ['Architecture', 'Supported methods', 'Operations', 'Troubleshooting']) {
    assert.match(guide, new RegExp(`^#+ ${heading}$`, 'im'), `missing ${heading} documentation`);
  }
  const smoke = read('docs/testing/manual-smoke.md');
  for (const token of ['MCP Apps', 'Open Design', 'rhythm_get_dashboard', 'off', 'readonly', 'interactive', 'packaged']) {
    assert.match(smoke, new RegExp(token, 'i'), `manual smoke omits ${token}`);
  }
});

test('issue-1356-c6: interactive mode remains human-approved opt-in', () => {
  // Regression caught: interactive ships as the default or can be promoted without recorded human smoke.
  const guide = readPending('docs/ai/mcp-apps.md');
  assert.match(guide, /interactive[\s\S]{0,180}(opt-in|human smoke approval)/i);
  assert.match(guide, /(default|rollback)[\s\S]{0,100}`?off`?/i);
  assert.doesNotMatch(swiftPolicy, /RHYTHM_MCP_APPS_MODE[^\n]*interactive/);
});
