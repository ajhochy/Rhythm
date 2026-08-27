/**
 * external_discovery_search.ts — Stage B (Plan B).
 *
 * The REAL server-side implementation of external_discovery_generator's
 * `DiscoverCandidatesFn` seam. Given the current audit gaps, it searches the
 * public ecosystem for candidates that address each OPEN capability-gap:
 *   • skills.sh  (GET /api/search?q=&limit=10)  -> skill candidates
 *   • mcp-registry search                        -> mcp (connector) candidates
 * and maps each hit to an ExternalCandidate with COMPLETE provenance. The
 * generator (not this module) enforces gap-grounding / provenance-completeness
 * / dedup / per-run cap — this module only composes sources and maps shapes.
 *
 * Later tasks add: an LLM judge (candidate body vs. the would-be bespoke draft,
 * Task 4) and a #873 pre-vet scan of the downloaded body (Task 5). Both gate
 * INSIDE this module so only vetted winners ever become proposals.
 *
 * Operational envelope: NEVER throws. Any fetch/parse failure degrades that
 * source to zero candidates for the run (the generator's own try/catch is a
 * second backstop).
 */

import { createHash } from 'node:crypto';
import { logger } from '../../utils/logger';
import type { OrgAuditGap } from '../org_audit_service';
import type {
  DiscoverCandidatesFn,
  ExternalCandidate,
  ExternalCandidateProvenance,
} from './external_discovery_generator';
import { scoreSkillBody, KEEP_SCORE_BAR, type SkillPurpose } from '../skill_refiner';
import { scanContextContent } from '../../security/context_scanner';

const SKILLS_SH_SEARCH = process.env.RHYTHM_EXTERNAL_DISCOVERY_SEARCH_URL ?? 'https://skills.sh/api/search';
const GITHUB_API_ORIGIN = (process.env.RHYTHM_EXTERNAL_DISCOVERY_GITHUB_ORIGIN ?? 'https://api.github.com').replace(/\/$/, '');
/** skills.sh serves raw skill bodies from GitHub; overridable for a mirror/test double. */
export const RHYTHM_SKILLS_DOWNLOAD_BASE = (
  process.env.RHYTHM_SKILLS_DOWNLOAD_BASE ?? 'https://raw.githubusercontent.com'
).replace(/\/$/, '');
const FETCH_TIMEOUT_MS = 8000;
/** Per-gap cap on candidates pulled from each source before the generator's own cap. */
const MAX_PER_GAP = 3;

/** A single skills.sh search hit (the fields the CLI returns). */
interface SkillsShHit {
  name: string;
  id: string;
  source: string;
  installs: number;
}

/** GitHub repo metadata used to complete provenance (maintainer/license/lastUpdated/stars). */
interface GithubRepoMeta {
  full_name: string;
  pushed_at: string;
  stargazers_count: number;
  license: { spdx_id?: string | null } | null;
  owner: { login: string } | null;
  default_branch?: string;
}

interface GithubCommitMeta { sha: string; }

/** fetch JSON with a hard timeout; returns null on any failure. Never throws. */
async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal, headers });
    if (!resp.ok) {
      logger.info(`[external-discovery-search] ${url} -> HTTP ${resp.status}`);
      return null;
    }
    return (await resp.json()) as T;
  } catch (err) {
    logger.info(`[external-discovery-search] fetch failed for ${url} (non-fatal): ${String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** fetch raw text (skill body) with a hard timeout; null on any failure. Never throws. */
export async function downloadSkillBody(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      logger.info(`[external-discovery-search] body download ${url} -> HTTP ${resp.status}`);
      return null;
    }
    const text = await resp.text();
    return text.trim().length > 0 ? text : null;
  } catch (err) {
    logger.info(`[external-discovery-search] body download failed for ${url} (non-fatal): ${String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the raw SKILL.md download URL for a skills.sh hit. skills.sh `source`
 * is an "owner/repo[/path]" GitHub coordinate; the SKILL.md lives at the repo's
 * default branch. This composes the raw.githubusercontent.com URL used both to
 * pre-vet (Task 5) and to download at apply time.
 */
function skillDownloadUrlCandidates(hit: SkillsShHit, commitSha: string): string[] {
  const src = (hit.source ?? '').trim().replace(/^https?:\/\/github\.com\//, '');
  if (!src || !src.includes('/')) return [];
  const parts = src.split('/');
  const owner = parts[0];
  const repo = parts[1];
  const base = `${RHYTHM_SKILLS_DOWNLOAD_BASE}/${owner}/${repo}/${commitSha}`;
  // The skills.sh `source` is usually just owner/repo; the skill lives in a
  // subdirectory named by the skill (`hit.name`), commonly nested under skills/
  // (e.g. github/awesome-copilot -> skills/<name>/SKILL.md). `source` may also
  // already carry a sub path (3+ segments). Try the common layouts for every
  // candidate subdir; the first that actually downloads wins.
  const subs = new Set<string>();
  const sourceSub = parts.slice(2).join('/');
  if (sourceSub) subs.add(sourceSub);
  const name = (hit.name ?? '').trim();
  if (name) subs.add(name);
  const rel: string[] = [];
  for (const s of subs) {
    rel.push(`skills/${s}/SKILL.md`, `${s}/SKILL.md`, `skills/${s}.md`, `${s}.md`);
  }
  rel.push('SKILL.md'); // root fallback
  return rel.map((r) => `${base}/${r}`);
}

/** Complete provenance for a skills.sh hit via the GitHub repo metadata API. Null if incomplete. */
async function buildSkillProvenance(
  hit: SkillsShHit,
): Promise<{ provenance: ExternalCandidateProvenance; commitSha: string } | null> {
  const src = (hit.source ?? '').trim().replace(/^https?:\/\/github\.com\//, '');
  const parts = src.split('/');
  if (parts.length < 2) return null;
  const repoSlug = `${parts[0]}/${parts[1]}`;
  const meta = await fetchJson<GithubRepoMeta>(`${GITHUB_API_ORIGIN}/repos/${repoSlug}`, {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'rhythm-external-discovery',
  });
  if (!meta) return null;
  const license = meta.license?.spdx_id ?? null;
  const maintainer = meta.owner?.login ?? parts[0];
  if (!license || !maintainer || !meta.pushed_at) return null;
  const commit = await fetchJson<GithubCommitMeta>(
    `${GITHUB_API_ORIGIN}/repos/${repoSlug}/commits/${encodeURIComponent(meta.default_branch ?? 'HEAD')}`,
    { Accept: 'application/vnd.github+json', 'User-Agent': 'rhythm-external-discovery' },
  );
  if (!commit || !/^[0-9a-f]{40}$/i.test(commit.sha)) return null;
  return { provenance: {
    source: 'skills.sh',
    stars: typeof meta.stargazers_count === 'number' ? meta.stargazers_count : undefined,
    downloads: typeof hit.installs === 'number' ? hit.installs : undefined,
    lastUpdated: meta.pushed_at,
    maintainer,
    license,
    installCommand: `npx skills add ${hit.id}`,
  }, commitSha: commit.sha };
}

/**
 * Search skills.sh for one gap; map hits to skill candidates with provenance +
 * downloadUrl. Exported so the regression suite can drive the whole skills lane
 * (search -> provenance -> body download -> pre-vet -> relevance floor -> judge)
 * against a mocked fetch, instead of only unit-testing the judge in isolation.
 */
export async function searchSkillCandidates(
  gap: OrgAuditGap,
  scorer?: typeof scoreSkillBody,
): Promise<ExternalCandidate[]> {
  const query = buildQuery(gap);
  if (!query) return [];
  const res = await fetchJson<{ skills?: SkillsShHit[] }>(
    `${SKILLS_SH_SEARCH}?q=${encodeURIComponent(query)}&limit=10`,
  );
  const hits = res?.skills ?? [];
  const out: ExternalCandidate[] = [];
  for (const hit of hits.slice(0, MAX_PER_GAP)) {
    const resolved = await buildSkillProvenance(hit);
    if (!resolved) continue; // incomplete provenance or unpinnable commit
    const { provenance, commitSha } = resolved;
    const urlCandidates = skillDownloadUrlCandidates(hit, commitSha);
    if (urlCandidates.length === 0) continue;

    // Resolve the real SKILL.md path by trying the common repo layouts; first hit wins.
    let downloadUrl: string | null = null;
    let body: string | null = null;
    for (const candidateUrl of urlCandidates) {
      const b = await downloadSkillBody(candidateUrl);
      if (b) {
        downloadUrl = candidateUrl;
        body = b;
        break;
      }
    }
    if (!downloadUrl || !body) continue; // unreachable/empty body — cannot judge or adopt

    // #873 PRE-VET — the candidate body must pass the injection scan BEFORE it
    // is ever proposed. A high-confidence match drops the candidate here so a
    // gated proposal never even references injection-bearing content. The
    // applier re-scans at write time as a hard second gate (Task 6).
    const preScan = scanContextContent(body, `external-adoption candidate "${hit.name}"`);
    if (preScan.blocked) {
      logger.warn(
        `[external-discovery-search] dropped candidate "${hit.name}" for gap ${gap.gapId} — pre-vet injection scan blocked it`,
      );
      continue;
    }

    // RELEVANCE FLOOR (stack half) — a candidate anchored to an ecosystem this
    // repo does not use cannot be relevant to the gap, however well it scores
    // against a harvested intent that may itself be off-stack.
    const foreign = foreignStackToken(`${hit.name} ${hit.id} ${hit.source}`, body);
    if (foreign) {
      logger.info(
        `[external-discovery-search] dropped candidate "${hit.name}" for gap ${gap.gapId} — off-stack: anchored to "${foreign}", which this repo does not use`,
      );
      continue;
    }

    // Judge: the candidate must clear the absolute adoption floor AND beat the
    // would-be draft. A scorer outage drops the candidate (fail-closed).
    if (!(await candidateBeatsDraft(gap, body, scorer ?? scoreSkillBody))) continue;

    out.push({
      kind: 'skill',
      name: hit.name,
      gapId: gap.gapId,
      provenance,
      // The rationale states the basis the decision ACTUALLY used. It used to
      // cite "(N installs)", which implied a popularity justification that no
      // gate ever applied — install count is data for the human reviewer
      // (carried in provenance.downloads), not a reason this was shortlisted.
      rationale: `skills.sh match for "${gap.intentTitle ?? gap.gapId}": on-stack, cleared the adoption score floor (>=${KEEP_SCORE_BAR}/100) and scored above the bespoke draft`,
      downloadUrl,
      agentConfigId: gap.agentConfigId,
      sampleSessionId: gap.sampleSessionId,
      categories: gap.intentTags,
      contentSha256: createHash('sha256').update(body).digest('hex'),
      body,
    });
  }
  return out;
}

/** Build the ecosystem search query from a capability-gap's intent (title + tags). */
function buildQuery(gap: OrgAuditGap): string {
  const parts = [gap.intentTitle ?? '', ...(gap.intentTags ?? [])].map((s) => s.trim()).filter(Boolean);
  return parts.join(' ').slice(0, 120);
}

// ── Relevance floor — the stack half ────────────────────────────────────────
//
// buildQuery sends a harvested intent's free text to `skills.sh?limit=10` and
// the judge then scores each hit AGAINST THAT SAME INTENT. When the intent is
// itself off-stack, that loop has no way to notice: `angular-testing` was
// shortlisted for the intent "Update Angular tests after SDK method migration"
// in a repo with no @angular dependency anywhere, and NVIDIA's
// `nemo-rl-session-memory` (reinforcement-learning session memory) for
// "Consolidate Session Memories" — a pure phrase collision. Both score fine
// against their intent; both are irrelevant to Rhythm.
//
// Rhythm is TypeScript/Node (api_server), React/Expo (mobile), Flutter/Dart
// (desktop), SQLite/Postgres, Obsidian. A third-party skill anchored to a
// framework, runtime or research domain the repo does not contain cannot be
// relevant to a Rhythm gap however well it scores, so it is dropped here.
//
// ponytail: a hand-written denylist of foreign ecosystems, NOT a relevance
// model. It is deliberately the complement of "must overlap the repo's own
// dependencies" — an allowlist would also reject every stack-NEUTRAL skill
// (conventional-commits, changelog writing, code review), which is most of the
// lane's legitimate reach. Ceiling: a foreign ecosystem not listed here still
// has to clear the absolute score floor below, and nothing else. Upgrade path:
// when a false proposal names a new ecosystem, add its token — the drop log
// line names the token that fired, so the list is grep-able from run logs.
const FOREIGN_STACK_TOKENS = new Set([
  // front-end frameworks Rhythm does not use (it is React/Expo + Flutter)
  'angular', 'angularjs', 'vue', 'vuejs', 'nuxt', 'svelte', 'sveltekit', 'ember', 'jquery', 'backbone',
  // other server stacks / languages
  'django', 'flask', 'fastapi', 'laravel', 'symfony', 'dotnet', 'aspnet', 'blazor', 'csharp',
  'golang', 'clojure', 'haskell', 'elixir', 'scala', 'perl', 'cobol', 'fortran', 'matlab', 'rust',
  // infrastructure Rhythm does not run
  'kubernetes', 'k8s', 'terraform', 'ansible', 'openshift', 'hadoop', 'kafka', 'rabbitmq',
  'elasticsearch', 'jenkins',
  // ML / research domains
  'pytorch', 'tensorflow', 'keras', 'huggingface', 'cuda', 'nvidia', 'nemo', 'kubeflow',
  'sagemaker', 'mlflow', 'reinforcement',
  // CMS / enterprise platforms
  'wordpress', 'drupal', 'magento', 'shopify', 'salesforce', 'sharepoint',
  // databases Rhythm does not use
  'mongodb', 'cassandra', 'dynamodb', 'mysql',
  // other mobile toolchains
  'ionic', 'cordova', 'xamarin',
]);

/**
 * How much of a candidate body is treated as its self-description for the
 * stack check. A skill states what it is for in its frontmatter/opening lines;
 * scanning the WHOLE body would drop candidates over an incidental prose
 * mention ("unlike Django, ...").
 */
const STACK_CHECK_BODY_CHARS = 400;

/**
 * The foreign-ecosystem token a candidate is anchored to, or null when it is
 * on-stack / stack-neutral. Scans the candidate's IDENTITY (name, id, source
 * slug) plus the opening of its body. Exported for the regression suite.
 */
export function foreignStackToken(identity: string, body?: string | null): string | null {
  const haystack = `${identity} ${(body ?? '').slice(0, STACK_CHECK_BODY_CHARS)}`.toLowerCase();
  for (const word of haystack.split(/[^a-z0-9]+/)) {
    if (FOREIGN_STACK_TOKENS.has(word)) return word;
  }
  return null;
}

/**
 * Render the "would-be bespoke draft" body the harvester WOULD have produced
 * for this intent, so the judge scores the real candidate against the concrete
 * alternative (not an abstraction). Mirrors skill_refiner.renderCandidateBody's
 * shape (title + purpose + problem) so both bodies are scored on equal footing.
 *
 * HONEST LIMITATION: this is a ~5-line placeholder, not a representative draft.
 * It is a title, the intent's problem statement, and a tag list — it contains
 * no procedure, so almost any real third-party skill outscores it. "Beats the
 * draft" therefore means "beats a stub", NOT "fits this repo", and that is why
 * weak candidates used to win. Making it representative would mean actually
 * running the harvester's generative path per candidate (an LLM call per hit,
 * on a lane that already makes one judge call per hit) — deliberately not done.
 * The real quality guard is the ABSOLUTE floor in candidateBeatsDraft
 * (KEEP_SCORE_BAR); this relative comparison is kept only as a cheap
 * "is adopting even better than writing our own?" tiebreak on top of it.
 */
function renderWouldBeDraft(gap: OrgAuditGap): string {
  const parts: string[] = [`# ${gap.intentTitle ?? gap.gapId}`, ''];
  if (gap.intentProblem && gap.intentProblem.trim()) {
    parts.push('## Problem', '', gap.intentProblem.trim(), '');
  }
  if (gap.intentTags && gap.intentTags.length) {
    parts.push('## Topics', '', gap.intentTags.map((t) => `- ${t}`).join('\n'), '');
  }
  return parts.join('\n');
}

/**
 * Judge a downloaded candidate body against the would-be bespoke draft, both
 * scored against the intent via the SAME purpose-anchored scorer the measure
 * step uses (scoreSkillBody). Returns true iff the candidate BOTH clears the
 * absolute adoption floor AND is strictly better than the draft — only winners
 * are shortlisted. Never throws (scoreSkillBody fail-closes a throwing scorer
 * to 0, so a scorer failure loses → dropped).
 *
 * FAIL-CLOSED (was fail-open). The previous shape was:
 *
 *     const wins = unavailable || candScore.score > draftScore.score;
 *
 * where `unavailable` was a 0/0 scorer result. A scorer outage therefore
 * shortlisted EVERY candidate unjudged — a service failure became blanket
 * approval, on the one lane that runs `npx skills add <arbitrary-github-repo>`
 * and downloads raw third-party prompt content. Since scheduler-originated runs
 * are now UNATTENDED (docs/ai/decisions/2026-08-04-unattended-scheduled-run-
 * autonomy.md, PR #1312) there is no human between that shortlist and the
 * queue, so "cannot judge" must mean "do not adopt". A dropped candidate is
 * re-discoverable on the next pass at zero cost; an unjudged one is not
 * un-adoptable.
 *
 * The ABSOLUTE floor is the second half. The comparison bar is a ~5-line
 * placeholder (renderWouldBeDraft), so "beats the draft" only ever meant
 * "beats a stub" — a weak candidate cleared it easily. Requiring
 * KEEP_SCORE_BAR (skill_refiner's own rubric band: "61-80: accurate,
 * reasonably complete, and actionable") means the candidate must be good in
 * its own right, not merely better than a placeholder.
 */
export async function candidateBeatsDraft(
  gap: OrgAuditGap,
  candidateBody: string,
  scorer: typeof scoreSkillBody = scoreSkillBody,
): Promise<boolean> {
  const purpose: SkillPurpose = {
    name: gap.intentTitle ?? gap.gapId,
    description: gap.intentProblem ?? null,
    whenToUse: (gap.intentTags ?? []).join(', ') || null,
  };
  const draftBody = renderWouldBeDraft(gap);
  const candScore = await scorer(purpose, candidateBody);
  const draftScore = await scorer(purpose, draftBody);
  // A 0/0 result means the judge scored nothing — it could not distinguish a
  // provenance-clean full candidate from the skeletal draft. That is a scorer
  // outage, not a verdict, so nothing is shortlisted off it.
  if (candScore.score === 0 && draftScore.score === 0) {
    logger.warn(
      `[external-discovery-search] judge gap=${gap.gapId}: SCORER UNAVAILABLE (candidate=0 would-be-draft=0, reason="${candScore.reason}") -> drop-unjudged (fail-closed). No external-adoption proposal is filed for this candidate; it is re-discovered on the next pass.`,
    );
    return false;
  }
  const clearsFloor = candScore.score >= KEEP_SCORE_BAR;
  const wins = clearsFloor && candScore.score > draftScore.score;
  logger.info(
    `[external-discovery-search] judge gap=${gap.gapId}: candidate=${candScore.score} vs would-be-draft=${draftScore.score} (floor=${KEEP_SCORE_BAR}) -> ${wins ? 'shortlist' : clearsFloor ? 'drop-not-better-than-draft' : 'drop-below-adoption-floor'}`,
  );
  return wins;
}

/**
 * The production DiscoverCandidatesFn. Only capability-gap gaps drive an
 * ecosystem search (the hygiene kinds are handled by other generators). Never
 * throws — each gap's search is independently guarded.
 */
export const discoverCandidatesFromEcosystem: DiscoverCandidatesFn = async (gaps) => {
  const capabilityGaps = gaps.filter((g) => g.kind === 'capability-gap');
  if (capabilityGaps.length === 0) return [];

  const candidates: ExternalCandidate[] = [];
  for (const gap of capabilityGaps) {
    try {
      const skillHits = await searchSkillCandidates(gap);
      candidates.push(...skillHits);
      const mcpHits = await searchMcpCandidates(gap);
      candidates.push(...mcpHits);
    } catch (err) {
      logger.warn(`[external-discovery-search] gap ${gap.gapId} search failed (non-fatal): ${String(err)}`);
    }
  }
  return candidates;
};

/** A single mcp-registry search hit (the fields the HTTP endpoint returns). */
interface McpRegistryHit {
  name: string;
  maintainer?: string;
  license?: string;
  lastUpdated?: string;
  installs?: number;
  installCommand?: string;
}

/**
 * Render a text summary of an MCP registry hit for the #1114 judge — MCP
 * candidates have no downloadable SKILL.md body to score, so this composes
 * the available registry metadata (name/maintainer/license/install command)
 * into the same purpose-anchored shape renderWouldBeDraft produces, so
 * candidateBeatsDraft can score it on equal footing with the draft.
 */
function renderMcpCandidateSummary(hit: McpRegistryHit): string {
  const lines = [`# ${hit.name}`, '', 'MCP server candidate.'];
  if (hit.maintainer) lines.push(`Maintainer: ${hit.maintainer}`);
  if (hit.license) lines.push(`License: ${hit.license}`);
  if (hit.installCommand) lines.push(`Install: ${hit.installCommand}`);
  return lines.join('\n');
}

/**
 * Search the mcp-registry for connector candidates addressing a gap. The
 * registry is reached via its MCP tools, which are only available inside an
 * agent turn — from this server-side path we query its public HTTP search
 * endpoint. A miss (or no HTTP endpoint configured) degrades to zero MCP
 * candidates; skills.sh remains the primary ecosystem source.
 *
 * #1114 — MCP candidates now pass the SAME two gates the skill path already
 * enforces, so a fix-kind choice between {skill, MCP} is judged on equal
 * footing and neither kind is a softer target for an attacker:
 *   1. #873 pre-vet — the registry metadata (name/maintainer/license/install
 *      command are all attacker-influenceable if the registry itself is
 *      compromised or a malicious server self-registers) is scanned for
 *      injection content BEFORE it is ever proposed. The applier re-scans
 *      nothing further for MCP today (there is no downloadable body to
 *      re-scan at install time, unlike a skill's SKILL.md), so this pre-vet
 *      is the only gate — drop on any high-confidence match.
 *   2. Relevance floor — a candidate anchored to an ecosystem this repo does
 *      not use is dropped ({@link foreignStackToken}), exactly like skills.sh
 *      hits.
 *   3. candidateBeatsDraft judge — the candidate must clear the absolute
 *      adoption floor AND beat the would-be bespoke draft, exactly like
 *      skills.sh hits. A scorer outage drops it (fail-closed).
 *
 * `scorer` is an injectable pass-through to candidateBeatsDraft (defaults to
 * the real opencode-backed judge) — exported and parameterized for the same
 * reason candidateBeatsDraft itself takes one: a unit test can exercise the
 * pre-vet/judge gates deterministically, with no live model call.
 */
export async function searchMcpCandidates(
  gap: OrgAuditGap,
  scorer?: typeof scoreSkillBody,
): Promise<ExternalCandidate[]> {
  const base = process.env.RHYTHM_MCP_REGISTRY_SEARCH_URL;
  if (!base) return []; // no server-side registry endpoint wired — skills-only this run
  const query = buildQuery(gap);
  if (!query) return [];
  const res = await fetchJson<{ servers?: McpRegistryHit[] }>(
    `${base}?q=${encodeURIComponent(query)}&limit=10`,
  );
  const servers = res?.servers ?? [];
  const out: ExternalCandidate[] = [];
  for (const s of servers.slice(0, MAX_PER_GAP)) {
    if (!s.maintainer || !s.license || !s.lastUpdated || !s.installCommand) continue;

    const summary = renderMcpCandidateSummary(s);

    const preScan = scanContextContent(summary, `external-adoption MCP candidate "${s.name}"`);
    if (preScan.blocked) {
      logger.warn(
        `[external-discovery-search] dropped MCP candidate "${s.name}" for gap ${gap.gapId} — pre-vet injection scan blocked it`,
      );
      continue;
    }

    // Same relevance floor the skills lane applies — neither kind is a softer target.
    const foreign = foreignStackToken(s.name, summary);
    if (foreign) {
      logger.info(
        `[external-discovery-search] dropped MCP candidate "${s.name}" for gap ${gap.gapId} — off-stack: anchored to "${foreign}", which this repo does not use`,
      );
      continue;
    }

    const wins = scorer ? await candidateBeatsDraft(gap, summary, scorer) : await candidateBeatsDraft(gap, summary);
    if (!wins) continue;

    out.push({
      kind: 'mcp',
      name: s.name,
      gapId: gap.gapId,
      provenance: {
        source: 'mcp-registry',
        downloads: typeof s.installs === 'number' ? s.installs : undefined,
        stars: undefined,
        lastUpdated: s.lastUpdated,
        maintainer: s.maintainer,
        license: s.license,
        installCommand: s.installCommand,
      },
      rationale: `mcp-registry match for "${gap.intentTitle ?? gap.gapId}": on-stack, cleared the adoption score floor (>=${KEEP_SCORE_BAR}/100) and scored above the bespoke draft`,
      agentConfigId: gap.agentConfigId,
      sampleSessionId: gap.sampleSessionId,
      categories: gap.intentTags,
    });
  }
  return out;
}
