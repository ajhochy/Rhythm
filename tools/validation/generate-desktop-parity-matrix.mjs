#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const categories = [
  'launch-auth-onboarding', 'nav-a11y', 'dashboard-planner-tasks-rhythms-projects-messages-facilities-automations-integrations',
  'profiles-providers-models', 'sessions-composer-attachments-stream-retry-cancel-reconnect-transcript',
  'permissions-questions-approvals-delegation', 'files-search-diffs-worktrees', 'mcp-skills-commands',
  'memory-research-gallery-playbooks-cookbook-schedules-run-quality', 'notifications', 'live-artifacts',
  'mobile-pairing-cloud-gateway', 'settings-updates', 'electron-windows-dialogs-deep-links-security-process-lifecycle-packaging',
  'empty-loading-error-offline-forbidden', 'ownership-isolation', 'terminal-pty',
];

// `electron` was absent while M1 was in flight, which is why the plan records that no mapping had an
// Electron source prefix. M1 shipped the hardened shell, the unsigned package, and their suites, so
// the corpus would otherwise report the Electron surface as unevidenced while its tests exist.
const surfaceRoots = {
  api: 'apps/api_server', mcp: 'apps/mcp_server', flutter: 'apps/desktop_flutter', mobile: 'apps/mobile',
  opencode_fork: 'apps/opencode_fork', imported_web: 'apps/web', electron: 'apps/electron',
  root: '.', tools: 'tools', docs: 'docs',
};
// test-results/playwright-report are written by any Playwright run and would otherwise make the
// hermetic-corpus check order-dependent; .agent-stack holds postmortems written mid-verification.
const excluded = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.dart_tool', '.next', 'vendor', 'derived-data', 'test-results', 'playwright-report', '.agent-stack']);
const textExtensions = new Set(['.md', '.mjs', '.cjs', '.js', '.ts', '.tsx', '.dart', '.json', '.sh', '.yml', '.yaml']);
const manualPattern = /\b(?:manual|smoke|checklist|validate|acceptance|verify)\b/i;
const declarationPattern = /\b(?:test|it|describe|suite|testWidgets)\s*\(\s*['"`]([^'"`\n]+)/;

function parseArgs(argv) {
  const get = (name, fallback) => argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback;
  return { root: resolve(get('--root', process.cwd())), out: get('--out', 'docs/ai/coverage/react-electron') };
}

async function walk(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (excluded.has(entry.name)) continue;
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(root, path));
    else if (entry.isFile() && textExtensions.has(entry.name.slice(entry.name.lastIndexOf('.')))) paths.push(path);
  }
  return paths;
}

// Separators are normalized to spaces and the rules match a STEM with no trailing boundary, because
// `_` is a word character and most of these terms appear pluralized or joined inside paths. With a
// trailing `\b`, `facilit` could never match `facilities`, `\bnotification\b` could never match the
// `notifications/` directory, and `\blive artifact\b` could never match `live_artifacts_*` — so real
// Flutter coverage for those behaviours silently scored into the catch-all bucket and made the
// corpus report them as blind. The leading boundary is kept so a stem still has to start a word.
function categoryFor(text) {
  const lower = text.toLowerCase().replace(/[_./\\-]+/g, ' ');
  const rules = [
    ['terminal-pty', /\b(?:terminal|pty)/], ['mobile-pairing-cloud-gateway', /\b(?:pair|mobile|gateway)/],
    ['electron-windows-dialogs-deep-links-security-process-lifecycle-packaging', /\b(?:electron|window|dialog|deep ?link|packag|process)/],
    ['sessions-composer-attachments-stream-retry-cancel-reconnect-transcript', /\b(?:session|composer|attachment|stream|retry|cancel|reconnect|transcript)/],
    ['permissions-questions-approvals-delegation', /\b(?:permission|approval|delegat|question|forbidden)/],
    ['mcp-skills-commands', /\b(?:mcp|skill|command)/], ['files-search-diffs-worktrees', /\b(?:file|search|diff|worktree)/],
    ['memory-research-gallery-playbooks-cookbook-schedules-run-quality', /\b(?:memory|research|gallery|playbook|cookbook|schedule|quality)/],
    ['dashboard-planner-tasks-rhythms-projects-messages-facilities-automations-integrations', /\b(?:dashboard|planner|task|rhythm|project|message|facilit|automation|integration)/],
    ['launch-auth-onboarding', /\b(?:launch|auth|login|onboard)/], ['nav-a11y', /\b(?:nav|accessib|a11y|focus)/],
    ['settings-updates', /\b(?:setting|update)/], ['notifications', /\bnotification/], ['live-artifacts', /\blive artifact/],
  ];
  return rules.find(([, pattern]) => pattern.test(lower))?.[0] ?? 'empty-loading-error-offline-forbidden';
}

function behavior(category) {
  const deferred = category === 'terminal-pty';
  return {
    behaviorId: `behavior:${category}`, taxonomy: category, actor: 'desktop user or agent',
    precondition: 'the applicable surface is available', action: `exercise ${category.replaceAll('-', ' ')}`,
    outcome: 'observable result matches the declared contract', failure: 'a visible, bounded failure state is shown',
    security: 'authorization and ownership boundaries remain enforced', layers: ['unit', 'integration', 'manual'],
    journeys: ['desktop parity'], status: deferred ? 'deferred' : 'planned', owner: 'parity-matrix',
    rationale: deferred ? 'Terminal/PTTY is explicitly deferred by Slice 6.' : 'Seeded non-Terminal taxonomy requires a planned or review-required owner.',
  };
}

function sourceRows(surface, path, content) {
  const rows = [];
  const isDocumentation = path.endsWith('.md') || path.endsWith('.sh');
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const match = line.match(declarationPattern);
    if (!match && !isDocumentation && !/^\s*(?:async\s+)?def test_[\w]+/.test(line)) continue;
    if (!match && isDocumentation && !manualPattern.test(line)) continue;
    const title = match?.[1] ?? line.trim().slice(0, 160);
    const kind = match || /^\s*(?:async\s+)?def test_[\w]+/.test(line) ? 'test_declaration' : /\b(?:manual|smoke|checklist)\b/i.test(line) ? 'manual_check' : 'check_declaration';
    const anchor = `L${index + 1}`;
    rows.push({ sourceId: `${surface}:${path}:${anchor}`, surface, path, anchor, line: index + 1, title, kind,
      parserLimitations: 'Line-oriented heuristic; multiline declarations, generated runtime tests, and binary/native checks may be missed.' });
  }
  return rows;
}

export async function generate({ root, out }) {
  const allRows = [];
  let flutterReference;
  const outputPath = relative(root, resolve(root, out)).split(sep).join('/');
  for (const [surface, rootPath] of Object.entries(surfaceRoots)) {
    let scanRoot = root;
    let temporaryRoot;
    try {
      if (surface === 'flutter') {
        try { await access(resolve(root, rootPath)); }
        catch (error) { if (error.code === 'ENOENT') continue; else throw error; }

        const ref = process.env.RHYTHM_PARITY_FLUTTER_REF ?? 'origin/main';
        let commit;
        try {
          ({ stdout: commit } = await execFileAsync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' }));
          commit = commit.trim();
        } catch (error) {
          const detail = error.stderr?.trim() || error.message;
          throw new Error(`Unable to resolve Flutter parity ref "${ref}": ${detail}`, { cause: error });
        }

        temporaryRoot = await mkdtemp(resolve(tmpdir(), 'rhythm-parity-flutter-'));
        const archive = resolve(temporaryRoot, 'flutter.tar');
        try {
          await execFileAsync('git', ['archive', '--format=tar', `--output=${archive}`, commit, '--', rootPath], { cwd: root });
          await execFileAsync('tar', ['-xf', archive, '-C', temporaryRoot]);
        } catch (error) {
          const detail = error.stderr?.trim() || error.message;
          throw new Error(`Unable to read Flutter parity surface from "${ref}" (${commit}): ${detail}`, { cause: error });
        }
        scanRoot = temporaryRoot;
        flutterReference = { ref, commit };
      }

      const absolute = resolve(scanRoot, rootPath);
      for (const file of await walk(absolute)) {
        const path = relative(scanRoot, file).split(sep).join('/');
        if (path === outputPath || path.startsWith(`${outputPath}/`)) continue;
        if (surface === 'root' && path.includes('/')) continue;
        if (surface === 'tools' && !path.startsWith('tools/')) continue;
        if (surface === 'docs' && !path.startsWith('docs/')) continue;
        // Execution evidence and project state report runs; they do not declare durable checks.
        if (surface === 'docs' && (path.startsWith('docs/ai/runs/') || path === 'docs/ai/project-state.md')) continue;
        const content = await readFile(file, 'utf8');
        allRows.push(...sourceRows(surface, path, content));
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    finally { if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true }); }
  }
  const rows = [...new Map(allRows.sort((a, b) => a.sourceId.localeCompare(b.sourceId)).map(row => [row.sourceId, row])).values()];
  const behaviors = { schemaVersion: 1, ...(flutterReference ? { flutterReference } : {}), taxonomy: categories, behaviors: categories.map(behavior) };
  const mappings = rows.map(row => {
    const taxonomy = categoryFor(`${row.path} ${row.title}`);
    const disposition = taxonomy === 'terminal-pty' ? 'deferred' : row.kind === 'manual_check' ? 'manual_check' : row.kind === 'check_declaration' ? 'review_required' : /(?:integration|e2e|live|gateway|route)/i.test(`${row.path} ${row.title}`) ? 'retained_integration' : 'retained_unit';
    return { sourceId: row.sourceId, behaviorId: `behavior:${taxonomy}`, disposition, rationale: `Conservative generated default from ${row.kind}; review before claiming browser or native coverage.`, owner: 'parity-matrix' };
  });
  const destination = resolve(root, out);
  await mkdir(destination, { recursive: true });
  await writeFile(resolve(destination, 'source-inventory.jsonl'), rows.map(JSON.stringify).join('\n') + (rows.length ? '\n' : ''));
  await writeFile(resolve(destination, 'behaviors.json'), `${JSON.stringify(behaviors, null, 2)}\n`);
  const columns = ['sourceId', 'behaviorId', 'disposition', 'rationale', 'owner'];
  const csv = [columns.join(','), ...mappings.map(row => columns.map(column => JSON.stringify(row[column])).join(','))].join('\n');
  await writeFile(resolve(destination, 'mappings.csv'), `${csv}\n`);
  const counts = { sources: rows.length, mappings: mappings.length, behaviors: behaviors.behaviors.length, reviewRequired: mappings.filter(row => row.disposition === 'review_required').length };
  const digest = createHash('sha256').update(JSON.stringify({ rows, mappings, behaviors })).digest('hex');
  return { counts, digest, flutterReference, limitations: 'Counts are unique records only; surfaces overlap by design and are not summed as a census.' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await generate(parseArgs(process.argv.slice(2)));
  const flutter = result.flutterReference ? ` flutter_ref=${result.flutterReference.ref} flutter_sha=${result.flutterReference.commit}` : '';
  process.stdout.write(`sources=${result.counts.sources} mappings=${result.counts.mappings} behaviors=${result.counts.behaviors} review_required=${result.counts.reviewRequired}${flutter}\nsha256=${result.digest}\nlimitations=${result.limitations}\n`);
}
