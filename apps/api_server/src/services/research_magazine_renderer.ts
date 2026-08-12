import { Marked, Renderer, type Tokens } from 'marked';

export interface ResearchMagazineInput {
  project: { id: string; name: string; question: string };
  run: {
    id: string;
    status: string;
    startedAt?: string | null;
    completedAt?: string | null;
    usage?: { tokens?: number; costUsd?: number };
    progress?: Record<string, unknown>;
    diagnostics?: Record<string, unknown>;
  };
  synthesis: string;
  critic?: string | null;
  sources?: Record<string, unknown>[];
}

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function sourceUrl(source: Record<string, unknown>): string | null {
  return safeUrl(source.canonical_url ?? source.canonicalUrl ?? source.url);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
}

function markdownRenderer(markdown: string): { html: string; toc: Array<{ depth: number; label: string; id: string }> } {
  const marked = new Marked();
  const renderer = new Renderer();
  const counts = new Map<string, number>();
  const toc: Array<{ depth: number; label: string; id: string }> = [];

  renderer.html = ({ text }: Tokens.HTML) => `<p>${escapeHtml(text)}</p>`;
  renderer.image = ({ text }: Tokens.Image) => escapeHtml(text);
  renderer.link = function ({ href, title, tokens }: Tokens.Link) {
    const label = this.parser.parseInline(tokens);
    const url = safeUrl(href);
    if (!url) return label;
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(url)}" rel="noreferrer noopener"${titleAttribute}>${label}</a>`;
  };
  renderer.heading = function ({ tokens, depth, text }: Tokens.Heading) {
    const base = slug(text);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count + 1}`;
    const label = this.parser.parseInline(tokens);
    toc.push({ depth, label: text, id });
    return `<h${depth} id="${id}">${label}</h${depth}>`;
  };
  marked.setOptions({ async: false, gfm: true, renderer });
  return { html: marked.parse(markdown) as string, toc };
}

function sourceList(sources: Record<string, unknown>[] = []): Array<{ url: string; status: string }> {
  const unique = new Map<string, { url: string; status: string }>();
  for (const source of sources) {
    const url = sourceUrl(source);
    if (!url || unique.has(url)) continue;
    unique.set(url, {
      url,
      status: typeof source.capture_status === 'string'
        ? source.capture_status
        : typeof source.captureStatus === 'string' ? source.captureStatus : 'curated',
    });
  }
  return [...unique.values()];
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Not recorded' : date.toISOString();
}

export function researchMagazineHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'private, no-store',
  };
}

export function renderResearchMagazine(input: ResearchMagazineInput): string {
  const synthesis = markdownRenderer(input.synthesis);
  const critic = input.critic ? markdownRenderer(input.critic).html : '';
  const sources = sourceList(input.sources);
  const tokens = Math.max(0, Number(input.run.usage?.tokens ?? 0));
  const cost = Math.max(0, Number(input.run.usage?.costUsd ?? 0));
  const progress = input.run.progress ?? {};
  const completed = Math.max(0, Number(progress.completedJobs ?? 0));
  const total = Math.max(0, Number(progress.totalJobs ?? 0));
  const toc = synthesis.toc
    .map(({ depth, label, id }) => `<li class="depth-${depth}"><a href="#${escapeHtml(id)}">${escapeHtml(label)}</a></li>`)
    .join('');
  const sourceItems = sources
    .map(({ url, status }) => `<li><a href="${escapeHtml(url)}" rel="noreferrer noopener">${escapeHtml(url)}</a><span>${escapeHtml(status)}</span></li>`)
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(CSP)}"><title>${escapeHtml(input.project.name)} — Research</title>
<style>
:root{color-scheme:light;--ink:#18211d;--muted:#607069;--paper:#f7f3e9;--card:#fffdf7;--line:#d9d2c2;--accent:#8b3d2e;--sage:#365c50}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.7 Georgia,serif}.hero{padding:5rem max(5vw,2rem) 3rem;background:var(--ink);color:#fff}.eyebrow,.stats,nav,details{font-family:system-ui,sans-serif}.eyebrow{color:#e8b99e;text-transform:uppercase;letter-spacing:.14em;font-size:.75rem}.hero h1{font-size:clamp(2.5rem,7vw,5.5rem);line-height:1;margin:.4rem 0 1.2rem;max-width:18ch}.summary{max-width:68ch;font-size:1.25rem;color:#e7ece9}.layout{display:grid;grid-template-columns:minmax(12rem,18rem) minmax(0,46rem);gap:4rem;max-width:72rem;margin:0 auto;padding:3rem 2rem}.table-of-contents{position:sticky;top:2rem;align-self:start;border-top:3px solid var(--accent);padding-top:1rem}.table-of-contents ol{padding-left:1.2rem}.table-of-contents li{margin:.45rem 0}.table-of-contents .depth-2{margin-left:1rem}.table-of-contents a{color:var(--sage)}article h1,article h2,article h3{line-height:1.2;margin-top:2em}article a{color:var(--accent);overflow-wrap:anywhere}article blockquote,.uncertainty-callout{border-left:4px solid var(--accent);background:#efe5d6;padding:1rem 1.4rem;margin:2rem 0}.critic{border:1px solid var(--line);padding:1.5rem;margin:3rem 0;background:var(--card)}.stats{display:flex;flex-wrap:wrap;gap:.7rem;margin-top:2rem}.stats span{border:1px solid #ffffff55;border-radius:999px;padding:.35rem .8rem;font-size:.85rem}details{border-top:1px solid var(--line);padding:1.5rem 0;margin-top:3rem}details li{display:grid;grid-template-columns:1fr auto;gap:1rem;margin:.7rem 0}details a{overflow-wrap:anywhere}details span{color:var(--muted)}footer{color:var(--muted);font-size:.85rem;margin-top:3rem}@media(max-width:760px){.layout{grid-template-columns:1fr}.table-of-contents{position:static}}@media print{body{background:#fff;font-size:11pt}.hero{background:#fff;color:#000;padding:0 0 1.5rem;border-bottom:2px solid #000}.eyebrow,.summary{color:#222}.layout{display:block;max-width:none;padding:1rem 0}.table-of-contents{position:static;break-after:page}a{color:#000!important;text-decoration:none}a[href^="http"]::after{content:" (" attr(href) ")";font-size:8pt}.stats span{border-color:#777}.critic,details{break-inside:avoid}@page{margin:18mm}}
</style></head><body>
<header class="hero"><div class="eyebrow">Rhythm Research Magazine</div><h1>${escapeHtml(input.project.name)}</h1><p class="summary">${escapeHtml(input.project.question)}</p><div class="stats"><span>${escapeHtml(input.run.status)}</span><span>${tokens} tokens</span><span>$${cost.toFixed(2)}</span><span>${completed}/${total} stages</span></div></header>
<main class="layout"><nav class="table-of-contents" aria-label="Table of contents"><strong>Contents</strong><ol>${toc}</ol></nav><article>
<section class="uncertainty-callout"><strong>Evidence note.</strong> This report preserves uncertainty and disagreement from the canonical synthesis; follow source links before acting on consequential claims.</section>
${synthesis.html}${critic ? `<aside class="critic" aria-label="Contrarian review">${critic}</aside>` : ''}
<details><summary>Curated sources (${sources.length})</summary><ol>${sourceItems}</ol></details>
<footer>Run ${escapeHtml(input.run.id)} · Started ${escapeHtml(formatDate(input.run.startedAt))} · Completed ${escapeHtml(formatDate(input.run.completedAt))}</footer>
</article></main></body></html>`;
}

function markdownSafeText(value: string): string {
  return value
    .replace(/\[([^\]]+)]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (full, label: string, target: string) =>
      safeUrl(target) ? full : label)
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function renderResearchMarkdownExport(input: ResearchMagazineInput): string {
  const sources = sourceList(input.sources);
  const tokens = Math.max(0, Number(input.run.usage?.tokens ?? 0));
  const cost = Math.max(0, Number(input.run.usage?.costUsd ?? 0));
  const sourceMarkdown = sources.length === 0
    ? '- No curated sources recorded.'
    : sources.map(({ url, status }) => `- ${url} — ${status}`).join('\n');
  return [
    `# ${markdownSafeText(input.project.name)}`,
    '',
    markdownSafeText(input.project.question),
    '',
    `Status: ${input.run.status}`,
    `Run: ${input.run.id}`,
    `Started: ${formatDate(input.run.startedAt)}`,
    `Completed: ${formatDate(input.run.completedAt)}`,
    `Usage: ${tokens} tokens · $${cost.toFixed(2)}`,
    '',
    markdownSafeText(input.synthesis),
    input.critic ? `\n${markdownSafeText(input.critic)}` : '',
    '',
    '## Curated sources',
    '',
    sourceMarkdown,
    '',
  ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
}
