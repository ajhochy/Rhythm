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

import { logger } from '../../utils/logger';
import type { OrgAuditGap } from '../org_audit_service';
import type {
  DiscoverCandidatesFn,
  ExternalCandidate,
  ExternalCandidateProvenance,
} from './external_discovery_generator';
import { scoreSkillBody, type SkillPurpose } from '../skill_refiner';
import { scanContextContent } from '../../security/context_scanner';

const SKILLS_SH_SEARCH = 'https://skills.sh/api/search';
/** skills.sh serves raw skill bodies from GitHub; overridable for a mirror/test double. */
const DOWNLOAD_BASE_URL = process.env.RHYTHM_SKILLS_DOWNLOAD_BASE ?? 'https://raw.githubusercontent.com';
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
}

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
function skillDownloadUrl(hit: SkillsShHit): string | null {
  const src = (hit.source ?? '').trim().replace(/^https?:\/\/github\.com\//, '');
  if (!src || !src.includes('/')) return null;
  const parts = src.split('/');
  const owner = parts[0];
  const repo = parts[1];
  const sub = parts.slice(2).join('/');
  const path = sub ? `${sub}/SKILL.md` : 'SKILL.md';
  return `${DOWNLOAD_BASE_URL}/${owner}/${repo}/HEAD/${path}`;
}

/** Complete provenance for a skills.sh hit via the GitHub repo metadata API. Null if incomplete. */
async function buildSkillProvenance(hit: SkillsShHit): Promise<ExternalCandidateProvenance | null> {
  const src = (hit.source ?? '').trim().replace(/^https?:\/\/github\.com\//, '');
  const parts = src.split('/');
  if (parts.length < 2) return null;
  const repoSlug = `${parts[0]}/${parts[1]}`;
  const meta = await fetchJson<GithubRepoMeta>(`https://api.github.com/repos/${repoSlug}`, {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'rhythm-external-discovery',
  });
  if (!meta) return null;
  const license = meta.license?.spdx_id ?? null;
  const maintainer = meta.owner?.login ?? parts[0];
  if (!license || !maintainer || !meta.pushed_at) return null;
  return {
    source: 'skills.sh',
    stars: typeof meta.stargazers_count === 'number' ? meta.stargazers_count : undefined,
    downloads: typeof hit.installs === 'number' ? hit.installs : undefined,
    lastUpdated: meta.pushed_at,
    maintainer,
    license,
    installCommand: `npx skills add ${hit.id}`,
  };
}

/** Search skills.sh for one gap; map hits to skill candidates with provenance + downloadUrl. */
async function searchSkillCandidates(gap: OrgAuditGap): Promise<ExternalCandidate[]> {
  const query = buildQuery(gap);
  if (!query) return [];
  const res = await fetchJson<{ skills?: SkillsShHit[] }>(
    `${SKILLS_SH_SEARCH}?q=${encodeURIComponent(query)}&limit=10`,
  );
  const hits = res?.skills ?? [];
  const out: ExternalCandidate[] = [];
  for (const hit of hits.slice(0, MAX_PER_GAP)) {
    const downloadUrl = skillDownloadUrl(hit);
    if (!downloadUrl) continue;
    const provenance = await buildSkillProvenance(hit);
    if (!provenance) continue; // incomplete provenance — generator would drop it anyway

    const body = await downloadSkillBody(downloadUrl);
    if (!body) continue; // unreachable/empty body — cannot judge or adopt

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

    // Judge: only a candidate STRICTLY better than the would-be draft is shortlisted.
    if (!(await candidateBeatsDraft(gap, body))) continue;

    out.push({
      kind: 'skill',
      name: hit.name,
      gapId: gap.gapId,
      provenance,
      rationale: `skills.sh match judged better than the bespoke draft for "${gap.intentTitle ?? gap.gapId}" (${hit.installs} installs)`,
      downloadUrl,
      agentConfigId: gap.agentConfigId,
      sampleSessionId: gap.sampleSessionId,
      categories: gap.intentTags,
    });
  }
  return out;
}

/** Build the ecosystem search query from a capability-gap's intent (title + tags). */
function buildQuery(gap: OrgAuditGap): string {
  const parts = [gap.intentTitle ?? '', ...(gap.intentTags ?? [])].map((s) => s.trim()).filter(Boolean);
  return parts.join(' ').slice(0, 120);
}

/**
 * Render the "would-be bespoke draft" body the harvester WOULD have produced
 * for this intent, so the judge scores the real candidate against the concrete
 * alternative (not an abstraction). Mirrors skill_refiner.renderCandidateBody's
 * shape (title + purpose + problem) so both bodies are scored on equal footing.
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
 * step uses (scoreSkillBody). Returns true iff the candidate is STRICTLY better
 * than the draft — only winners are shortlisted. Never throws (scoreSkillBody
 * fail-closes a throwing scorer to 0, so a scorer failure ties/loses → dropped).
 */
async function candidateBeatsDraft(gap: OrgAuditGap, candidateBody: string): Promise<boolean> {
  const purpose: SkillPurpose = {
    name: gap.intentTitle ?? gap.gapId,
    description: gap.intentProblem ?? null,
    whenToUse: (gap.intentTags ?? []).join(', ') || null,
  };
  const draftBody = renderWouldBeDraft(gap);
  const candScore = await scoreSkillBody(purpose, candidateBody);
  const draftScore = await scoreSkillBody(purpose, draftBody);
  const wins = candScore.score > draftScore.score;
  logger.info(
    `[external-discovery-search] judge gap=${gap.gapId}: candidate=${candScore.score} vs would-be-draft=${draftScore.score} -> ${wins ? 'shortlist' : 'drop'}`,
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

/**
 * Search the mcp-registry for connector candidates addressing a gap. The
 * registry is reached via its MCP tools, which are only available inside an
 * agent turn — from this server-side path we query its public HTTP search
 * endpoint. A miss (or no HTTP endpoint configured) degrades to zero MCP
 * candidates; skills.sh remains the primary ecosystem source.
 */
async function searchMcpCandidates(gap: OrgAuditGap): Promise<ExternalCandidate[]> {
  const base = process.env.RHYTHM_MCP_REGISTRY_SEARCH_URL;
  if (!base) return []; // no server-side registry endpoint wired — skills-only this run
  const query = buildQuery(gap);
  if (!query) return [];
  const res = await fetchJson<{ servers?: Array<{ name: string; maintainer?: string; license?: string; lastUpdated?: string; installs?: number; installCommand?: string }> }>(
    `${base}?q=${encodeURIComponent(query)}&limit=10`,
  );
  const servers = res?.servers ?? [];
  const out: ExternalCandidate[] = [];
  for (const s of servers.slice(0, MAX_PER_GAP)) {
    if (!s.maintainer || !s.license || !s.lastUpdated || !s.installCommand) continue;
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
      rationale: `mcp-registry match for capability-gap "${gap.intentTitle ?? gap.gapId}"`,
      agentConfigId: gap.agentConfigId,
      sampleSessionId: gap.sampleSessionId,
      categories: gap.intentTags,
    });
  }
  return out;
}
