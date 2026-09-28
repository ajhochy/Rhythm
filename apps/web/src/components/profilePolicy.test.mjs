import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePolicy, applyStructuredEdit, serializePolicy, permissionDefault, parseMcpSelection, mcpGroupSelection, editMcpGroup, parseSkillSelection } from './profilePolicy.ts';

const edit = (raw, change) => serializePolicy(applyStructuredEdit(parsePolicy(raw), change));
test('unknown keys, inherited markers, advanced values and lexemes survive a targeted edit verbatim', () => {
  const unknown = '"future": { "inherit": true, "weight": 1e+03, "nested": ["\\u0061", null] }';
  const raw = `{ ${unknown}, "read":"ask", "bash": {"git *":"allow","rm *":"deny"}, "marker":"inherit" }`;
  const next = edit(raw, { kind: 'default', tool: 'read', action: 'deny' });
  assert.equal(next, raw.replace('"read":"ask"', '"read":"deny"'));
  assert.ok(next.includes(unknown));
  assert.equal(serializePolicy(parsePolicy(raw)), raw);
});
test('inherit and explicit empty policies remain distinct, including after removals', () => {
  for (const raw of [null, '', '  ', '{}', '{ "bash": {} }']) assert.equal(serializePolicy(parsePolicy(raw)), raw);
  const next = edit(null, { kind: 'default', tool: 'read', action: 'deny' });
  assert.deepEqual(JSON.parse(next), { read: 'deny' });
  assert.equal(permissionDefault(undefined), 'inherit');
  assert.equal(permissionDefault('inherit'), 'advanced');
  assert.deepEqual(JSON.parse(edit('{"bash":{"git *":"ask"}}', { kind: 'remove-pattern', tool: 'bash', pattern: 'git *' })), { bash: {} });
});
test('category default edits retain patterns, advanced entries and evaluation order', () => {
  const raw = '{"bash": {"git *":"allow", "*":"ask", "future": { "inherit": true }}, "read":"deny"}';
  assert.equal(edit(raw, { kind: 'default', tool: 'bash', action: 'deny' }), raw.replace('"*":"ask"', '"*":"deny"'));
  const next = edit('{"bash":{"git *":"allow"}}', { kind: 'default', tool: 'bash', action: 'deny' });
  assert.deepEqual(Object.keys(JSON.parse(next).bash), ['*', 'git *']);
  const inherited = edit(raw, { kind: 'default', tool: 'bash', action: 'inherit' });
  assert.deepEqual(JSON.parse(inherited).bash, { 'git *': 'allow', future: { inherit: true } });
});
test('adding patterns preserves scalar defaults; updating and removing target only one pattern', () => {
  const next = edit('{"bash":"deny","read":"allow"}', { kind: 'pattern', tool: 'bash', pattern: 'git *', action: 'ask' });
  assert.deepEqual(JSON.parse(next), { bash: { '*': 'deny', 'git *': 'ask' }, read: 'allow' });
  const changed = edit(next, { kind: 'pattern', tool: 'bash', pattern: 'git *', action: 'allow' });
  assert.deepEqual(JSON.parse(changed).bash, { '*': 'deny', 'git *': 'allow' });
  assert.deepEqual(JSON.parse(edit(changed, { kind: 'remove-pattern', tool: 'bash', pattern: 'git *' })).bash, { '*': 'deny' });
});
test('escaped keys, braces in strings, nested arrays, and prototype-like keys are lossless', () => {
  const raw = '{"__proto__": {"x":"deny"}, "future":["}\\\"",{"x":[1,2]}],"bash":{"a\\\"b":"ask"}}';
  assert.deepEqual(JSON.parse(edit(raw, { kind: 'pattern', tool: 'bash', pattern: 'a"b', action: 'deny' })).bash, { 'a"b': 'deny' });
  assert.equal(edit(raw, { kind: 'default', tool: '__proto__', action: 'ask' }).includes('"future":["}\\\"",{"x":[1,2]}]'), true);
});
test('invalid JSON, arrays, duplicate target keys and advanced target values are not flattened', () => {
  for (const raw of ['{', '[]', 'null', '"ask"']) assert.throws(() => parsePolicy(raw));
  assert.throws(() => edit('{"read":"inherit"}', { kind: 'default', tool: 'read', action: 'allow' }), /advanced/);
  assert.throws(() => edit('{"read":"ask","read":"deny"}', { kind: 'default', tool: 'read', action: 'allow' }), /Duplicate/);
  assert.throws(() => edit('{}', { kind: 'pattern', tool: 'bash', pattern: '*', action: 'allow' }), /default/);
});
test('removing first, middle and final rules retains valid JSON and neighboring values', () => {
  for (const tool of ['read', 'bash', 'write']) {
    const next = JSON.parse(edit('{ "read":"ask", "bash":"deny", "write":"allow" }', { kind: 'default', tool, action: 'inherit' }));
    const expected = { read: 'ask', bash: 'deny', write: 'allow' }; delete expected[tool];
    assert.deepEqual(next, expected);
  }
});
test('MCP inheritance agrees with backend null, legacy server lists and empty server grants', () => {
  for (const raw of [null, '["server"]', '{"server":[]}', '{"server":null}', '{"server":{}}', '{"server":{"allowedTools":[]}}']) {
    assert.deepEqual(mcpGroupSelection(parseMcpSelection(raw), 'server', ['a', 'b']), { inherited: true, selected: ['a', 'b'] });
  }
  assert.deepEqual(mcpGroupSelection(parseMcpSelection('{}'), 'server', ['a']), { inherited: false, selected: [] });
  assert.equal(parseSkillSelection(null).inherited, true);
  assert.equal(parseSkillSelection('[]').inherited, false);
});
test('clearing last MCP tool removes server grant instead of broadening to inherit-all', () => {
  const next = editMcpGroup(parseMcpSelection('{"server":["a"], "other": null}'), 'server', [], []);
  assert.deepEqual(JSON.parse(next), { other: null });
  assert.equal(mcpGroupSelection(parseMcpSelection(next), 'server', ['a']).inherited, false);
});
test('MCP edits preserve other servers and advanced server settings', () => {
  const raw = '{"server": {"allowedTools":["a"]}, "other":{"future": { "n":1e2 }}}';
  assert.equal(editMcpGroup(parseMcpSelection(raw), 'server', ['a', 'b'], []), raw.replace('["a"]', '["a","b"]'));
  const narrowed = JSON.parse(editMcpGroup(parseMcpSelection(null), 'server', ['a'], [{ name: 'server', tools: ['a', 'b'] }, { name: 'empty', tools: [] }]));
  assert.deepEqual(narrowed, { server: ['a'] });
  assert.ok(parseMcpSelection('bad').error);
  assert.ok(parseSkillSelection('{}').error);
  assert.throws(() => editMcpGroup(parseMcpSelection('bad'), 'server', ['a'], []));
});

test('advanced MCP server policies are explicit, read-only, and lossless while supported peers remain editable', () => {
  const raw = '{"rhythm":{"mode":"capability-rules","allowedTools":{"include":["tasks.*"],"exclude":["tasks.delete"]},"approval":{"write":"ask"},"future":{"weight":1e+03}},"github":{"allowedTools":["issues.read"]},"scalar":"future-mode","malformed":{"allowedTools":{"include":["read"]}}}';
  const policy = parseMcpSelection(raw);

  for (const server of ['rhythm', 'scalar', 'malformed']) {
    const group = mcpGroupSelection(policy, server, ['read', 'write']);
    assert.equal(group.inherited, false);
    assert.deepEqual(group.selected, []);
    assert.match(group.error, /advanced MCP policy/i);
    assert.throws(() => editMcpGroup(policy, server, ['read'], []), /advanced MCP policy/i);
    assert.equal(policy.raw, raw);
  }

  const next = editMcpGroup(policy, 'github', ['issues.read', 'pulls.read'], []);
  assert.equal(next, raw.replace('["issues.read"]', '["issues.read","pulls.read"]'));
  assert.ok(next.includes('"allowedTools":{"include":["tasks.*"],"exclude":["tasks.delete"]}'));
  assert.ok(next.includes('"future":{"weight":1e+03}'));
});

test('no-op inherit/removal preserves the root marker; prototype-like new categories are own JSON data', () => {
  for (const raw of [null, '', '  ', '{}']) {
    assert.equal(edit(raw, { kind: 'default', tool: 'read', action: 'inherit' }), raw);
    assert.equal(edit(raw, { kind: 'remove-pattern', tool: 'bash', pattern: 'missing' }), raw);
  }
  assert.deepEqual(JSON.parse(edit('{}', { kind: 'default', tool: '__proto__', action: 'deny' })), JSON.parse('{"__proto__":"deny"}'));
});
