import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { toolError, toolResult } from '../api_client.js';
import { registerTool } from './_tool.js';

type FetchLike = typeof fetch;

const MAX_BODY_LENGTH = 60_000;
const DEFAULT_REPO = 'ajhochy/Rhythm';

interface GithubIssueResponse {
  number: number;
  html_url: string;
}

/**
 * #870 — first-class GitHub issue-creation tool. Calls the GitHub REST API
 * directly (no api_server hop, no new deps) so the write path stays scoped to
 * whichever profile is granted this tool (see .mcp-roles/dev.mcp.json).
 *
 * Token comes from RHYTHM_GITHUB_TOKEN (falls back to GITHUB_TOKEN) and is
 * NEVER written into opencode.json or any checked-in config — env only. A
 * missing token is a hard error, never a hallucinated success.
 */
export function registerGithubIssueTools(server: McpServer, fetchImpl?: FetchLike) {
  registerTool(
    server,
    'rhythm_create_issue',
    'File a new GitHub issue against the configured Rhythm repo (default ajhochy/Rhythm, override via RHYTHM_GITHUB_REPO). Requires RHYTHM_GITHUB_TOKEN or GITHUB_TOKEN to be set. Returns the created issue number and URL.',
    {
      title: z.string().describe('Issue title. Must be non-empty.'),
      body: z.string().optional().describe('Issue body (markdown). Capped at 60,000 characters.'),
      labels: z.array(z.string()).optional().describe('Optional list of label names to apply.'),
    },
    async ({ title, body, labels }: { title: string; body?: string; labels?: string[] }) => {
      try {
        const trimmedTitle = title.trim();
        if (!trimmedTitle) {
          throw new Error('Issue title must not be empty.');
        }
        if (body && body.length > MAX_BODY_LENGTH) {
          throw new Error(
            `Issue body is too large (${body.length} chars). Maximum is ${MAX_BODY_LENGTH} characters.`,
          );
        }

        const token = process.env.RHYTHM_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
        if (!token) {
          throw new Error(
            'GitHub token not configured. Set RHYTHM_GITHUB_TOKEN (or GITHUB_TOKEN) in the environment.',
          );
        }

        const repo = process.env.RHYTHM_GITHUB_REPO || DEFAULT_REPO;
        const doFetch = fetchImpl ?? fetch;

        const res = await doFetch(`https://api.github.com/repos/${repo}/issues`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'User-Agent': 'rhythm-mcp-server',
          },
          body: JSON.stringify({
            title: trimmedTitle,
            ...(body ? { body } : {}),
            ...(labels && labels.length > 0 ? { labels } : {}),
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          throw new Error(`GitHub API error ${res.status}: ${errText}`);
        }

        const issue = (await res.json()) as GithubIssueResponse;
        return toolResult(
          JSON.stringify({ number: issue.number, url: issue.html_url }, null, 2),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
